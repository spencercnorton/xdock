import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {URL, fileURLToPath} from 'node:url';

// Guards a whole bug class rather than the four sites that prompted it.
//
// GNOME Shell's JS modules export only some of their constants. An ES module
// namespace `[[Get]]` on a name the module does not export returns `undefined`
// -- silently, with no import error and no runtime warning. Feed that to a
// tween and it does not fail loudly:
//
//   St.Adjustment.ease  -> `Math.floor(params.duration || 0)` -> 0 -> the
//                          property is assigned directly, no transition object
//                          is created, and the `mode:` is discarded.
//   Clutter.Actor.ease  -> `params.duration ?? actor.get_easing_duration()`
//                          -> Clutter's implicit-animation default of 250ms.
//
// Either way the animation is wrong and nothing says so. Two constants were
// read this way for the life of the fork: `Util.SCROLL_TIME` (dash scroll,
// became an instant jump) and `Workspace.WINDOW_OVERLAY_FADE_TIME` (window
// preview close button, ran at an accidental 250ms instead of 200ms).
//
// The fix in both cases was a fork-local `const X = Namespace.X ?? <upstream
// value>;`, matching what dash.js already did for DASH_ANIMATION_TIME. This
// test enforces that shape: a duration may be a literal, or a local
// identifier, or a member of a local object -- but never read straight off an
// imported Shell namespace, because that is the read that can silently vanish.

const repoRoot = new URL('../', import.meta.url);

// `duration:` followed by Namespace.SYMBOL -- an uppercase-initial namespace
// (the import convention in this fork) dotted onto a SCREAMING_CASE constant.
const BARE_NAMESPACE_DURATION = /duration:\s*([A-Z][A-Za-z0-9_]*)\.([A-Z][A-Z0-9_]+)/g;

async function sourceFiles() {
    const entries = await readdir(repoRoot, {withFileTypes: true});
    return entries
        .filter(e => e.isFile() && e.name.endsWith('.js'))
        .map(e => e.name)
        .sort();
}

test('no tween reads its duration straight off a Shell namespace', async () => {
    const offenders = [];

    for (const name of await sourceFiles()) {
        const source = await readFile(new URL(name, repoRoot), 'utf8');
        const lines = source.split('\n');

        lines.forEach((line, i) => {
            for (const m of line.matchAll(BARE_NAMESPACE_DURATION)) {
                offenders.push(
                    `${name}:${i + 1}  duration: ${m[1]}.${m[2]}`);
            }
        });
    }

    assert.deepEqual(offenders, [],
        'A duration read directly off an imported Shell namespace is undefined ' +
        'whenever that module does not export the name, and both ease() paths ' +
        'swallow it. Define a fork-local `const X = ' +
        'Namespace.X ?? <upstream value>;` and use that instead.\n  ' +
        offenders.join('\n  '));
});

test('the two constants that regressed resolve to real upstream values', async () => {
    const dash = await readFile(new URL('dash.js', repoRoot), 'utf8');
    const preview = await readFile(new URL('windowPreview.js', repoRoot), 'utf8');

    // Upstream GNOME Shell 50.1: misc/animationUtils.js SCROLL_TIME = 100,
    // ui/windowPreview.js WINDOW_OVERLAY_FADE_TIME = 200. Neither is exported
    // from the module this fork imports, so the `??` fallback is what runs.
    assert.match(dash, /const SCROLL_TIME = Util\.SCROLL_TIME \?\? 100;/);
    assert.match(preview,
        /const WINDOW_OVERLAY_FADE_TIME = Workspace\.WINDOW_OVERLAY_FADE_TIME \?\? 200;/);

    // And the call sites use the local constant, not the namespace read.
    assert.equal(dash.includes('duration: Util.SCROLL_TIME'), false);
    assert.equal(
        preview.includes('duration: Workspace.WINDOW_OVERLAY_FADE_TIME'), false);
    assert.equal((dash.match(/duration: SCROLL_TIME,/g) ?? []).length, 2);
    assert.equal(
        (preview.match(/duration: WINDOW_OVERLAY_FADE_TIME,/g) ?? []).length, 2);
});

test('the guard has teeth', () => {
    // An assertion that has never been in a position to fail is not a check.
    const sample = '            duration: Util.SCROLL_TIME,\n';
    const hits = [...sample.matchAll(BARE_NAMESPACE_DURATION)];
    assert.equal(hits.length, 1);
    assert.equal(hits[0][1], 'Util');
    assert.equal(hits[0][2], 'SCROLL_TIME');

    // ...and does not fire on the shapes that are correct.
    for (const ok of [
        'duration: SCROLL_TIME,',                  // fork-local const
        'duration: animate ? DASH_ANIMATION_TIME : 0,',
        'duration: 250,',                          // literal
        'duration: this._settings.animationTime,', // settings-derived
        'duration: plan.durationMs,',              // motion.js
    ])
        assert.deepEqual([...ok.matchAll(BARE_NAMESPACE_DURATION)], []);
});
