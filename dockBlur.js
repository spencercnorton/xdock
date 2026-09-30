// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    Clutter,
    GObject,
    Mtk,
    Shell,
    St,
} from './dependencies/gi.js';

// gnome-rounded-blur's effect clips the blur to the dock's rounded corners.
// Without it, GNOME Shell's own effect blurs a plain rectangle.
const Blur = await import('gi://Blur').then(module => module.default, () => null);

export const EFFECT_NAME = 'xdock-blur';

/**
 * @param {Clutter.Actor} actor an actor on the stage
 * @param {Mtk.Region} clip the part of the stage being redrawn
 * @returns {boolean} whether the clip holds all of the actor
 */
function covers(clip, actor) {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    const [x1, y1] = [Math.ceil(x), Math.ceil(y)];
    const rect = new Mtk.Rectangle({
        x: x1,
        y: y1,
        width: Math.floor(x + width) - x1,
        height: Math.floor(y + height) - y1,
    });
    return clip.contains_rectangle(rect) === Mtk.RegionOverlap.IN;
}

/**
 * Keeps every redraw of the dock whole.
 *
 * A background blur copies the screen under it, and where a redraw covers only
 * part of the dock, the rest of that copy is the dock itself from the frame
 * before, which it would blur back in. This child of the dash is a clone of
 * the icons that paints nothing: Clutter redraws a clone whenever anything in
 * its source redraws, so a hover or an animation on one icon redraws the whole
 * dock in the same frame. A partial redraw from behind the dock, which no
 * clone hears of, is followed by one whole redraw.
 */
const WholeDockRedraw = GObject.registerClass(
class XDockWholeDockRedraw extends Clutter.Clone {
    vfunc_get_preferred_width(_forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [0, 0];
    }

    // All of the dash, while taking no room in its layout.
    vfunc_allocate(_box) {
        const [width, height] = this.get_parent().get_allocation_box().get_size();
        super.vfunc_allocate(Clutter.ActorBox.new(0, 0, width, height));
    }

    vfunc_get_paint_volume(volume) {
        return volume.set_from_allocation(this);
    }

    vfunc_paint(paintContext) {
        const clip = paintContext.get_redraw_clip();
        const partial = clip !== null && !covers(clip, this);
        if (partial && !this._followingUp)
            this.queue_redraw();
        // A follow-up that still looks partial is not followed up again, so
        // this never keeps the dock redrawing by itself.
        this._followingUp = partial && !this._followingUp;
    }
});

/**
 * @returns {Clutter.Effect} a background blur, rounded if it can be
 */
function createEffect() {
    if (Blur) {
        try {
            return new Blur.BlurEffect({mode: Blur.BlurMode.BACKGROUND});
        } catch (error) {
            logError(error, 'gnome-rounded-blur is installed but cannot be used');
        }
    }
    return new Shell.BlurEffect({mode: Shell.BlurMode.BACKGROUND});
}

/**
 * The blur behind the dock's background, owned by one dock's dash.
 *
 * Dash to Dock caches the whole dash in an offscreen framebuffer, and a
 * background blur painted into that framebuffer copies its empty contents
 * instead of the screen. While the blur is on, only the icons keep that cache,
 * and the background paints straight to the screen with the blur under it.
 * While it is off, the dash is exactly as Dash to Dock left it.
 */
export class DockBlur {
    /**
     * @param {object} dash the dock's DockDash
     * @param {Gio.Settings} settings the extension's settings
     */
    constructor(dash, settings) {
        this._dash = dash;
        this._settings = settings;
        this._effect = null;
        this._settingsIds = ['dock-blur', 'dock-blur-sigma', 'dock-blur-brightness'].map(key =>
            settings.connect(`changed::${key}`, () => this._update()));
        this._update();
    }

    _update() {
        if (this._settings.get_boolean('dock-blur'))
            this._attach();
        else
            this._detach();
        this._sync();
    }

    _attach() {
        if (this._effect)
            return;
        const {_background: background, _dashContainer: icons} = this._dash;
        const effect = createEffect();
        this._redraw = new WholeDockRedraw({source: icons});
        this._redirects = [this._dash.offscreen_redirect, icons.offscreen_redirect];
        this._dash.offscreen_redirect = Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY;
        icons.offscreen_redirect = Clutter.OffscreenRedirect.ALWAYS;
        background.add_effect_with_name(EFFECT_NAME, effect);
        this._effect = effect;
        this._dash.add_child(this._redraw);
        this._styleId = background.connect('style-changed', () => this._sync());
    }

    _detach() {
        if (!this._effect)
            return;
        const {_background: background, _dashContainer: icons} = this._dash;
        background.disconnect(this._styleId);
        this._redraw.destroy();
        background.remove_effect(this._effect);
        [this._dash.offscreen_redirect, icons.offscreen_redirect] = this._redirects;
        this._effect = this._redraw = null;
    }

    _sync() {
        const background = this._dash._background;
        // A theme node exists only on the stage; style-changed follows there.
        if (!this._effect || !background.get_stage())
            return;
        const node = background.get_theme_node();
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        this._effect.radius = this._settings.get_int('dock-blur-sigma') * scaleFactor;
        this._effect.brightness = this._settings.get_double('dock-blur-brightness');
        if (!(this._effect instanceof Shell.BlurEffect))
            this._effect.corner_radius = node.get_border_radius(St.Corner.TOPLEFT);
        // Nothing shows through an opaque background, such as the one high
        // contrast gives the dock.
        this._effect.enabled = node.get_background_color().alpha < 255;
    }

    destroy() {
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._detach();
    }
}
