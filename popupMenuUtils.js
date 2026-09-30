// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {
    BoxPointer,
    PopupMenu,
} from './dependencies/shell/ui.js';

import {
    Config,
} from './dependencies/shell/misc.js';

import {
    usesPopupMenuParameterObject,
} from './popupMenuVersion.js';

// GNOME development builds use a non-numeric package version. Detect the
// conversion hook introduced with the parameter-object API first, then keep
// the released major version as a fallback for compatible downstream builds.
const USE_PARAMETER_OBJECT = usesPopupMenuParameterObject(
    Config.PACKAGE_VERSION,
    typeof PopupMenu.PopupMenu.prototype._getPopupAnimationFromParams === 'function');

function toLegacyAnimation({animate = true, fadeOnly = false} = {}) {
    if (!animate)
        return BoxPointer.PopupAnimation.NONE;
    if (fadeOnly)
        return BoxPointer.PopupAnimation.FADE;
    return BoxPointer.PopupAnimation.FULL;
}

/**
 * Open a GNOME Shell PopupMenu with the API used by the running Shell.
 * GNOME 45-50 accept a PopupAnimation enum; GNOME 51+ accepts an options object.
 *
 * @param {PopupMenu.PopupMenu} menu menu to open
 * @param {{animate?: boolean, fadeOnly?: boolean}} params animation options
 * @returns {boolean|undefined} whether the menu changed state, when provided
 */
export function open(menu, params = {}) {
    return USE_PARAMETER_OBJECT
        ? menu.open(params)
        : menu.open(toLegacyAnimation(params));
}

/**
 * Close a GNOME Shell PopupMenu with the API used by the running Shell.
 *
 * @param {PopupMenu.PopupMenu} menu menu to close
 * @param {{animate?: boolean, fadeOnly?: boolean}} params animation options
 * @returns {boolean|undefined} whether the menu changed state, when provided
 */
export function close(menu, params = {}) {
    return USE_PARAMETER_OBJECT
        ? menu.close(params)
        : menu.close(toLegacyAnimation(params));
}
