import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

// The motion spec is the NorviOS design-token set, authored outside this
// repository:
//
//   motion_easing.enter      easeOutCubic
//   motion_easing.exit       easeInCubic
//   motion_easing.reversible true
//   motion_ms                fast 190 | standard 250 | environmental 500 | reduced 0
//
// This fork's durations already largely conformed (190, 250, 500 and the
// `animate ? … : 0` reduced branches all match). The easing family conformed
// NOWHERE: 12 x EASE_OUT_QUAD against a spec that says easeOutCubic, plus an
// EASE_IN_QUAD and two EASE_IN_OUT_QUAD. EASE_OUT_QUAD is GNOME Shell's own
// default, i.e. what you get by not choosing -- which is exactly why the dock
// read as generic.
//
// This test enforces the token, and deliberately allows an escape hatch: a
// site may use any mode if the line above it carries a `motion-exception:`
// comment saying why. A gate that forbids every legitimate exception gets
// commented out within a month; one that demands a written reason does not.

const repoRoot = new URL('../', import.meta.url);

const ENTER = 'EASE_OUT_CUBIC';   // motion_easing.enter  = easeOutCubic
const EXIT = 'EASE_IN_CUBIC';     // motion_easing.exit   = easeInCubic
const CONFORMING = new Set([ENTER, EXIT]);

const MODE = /Clutter\.AnimationMode\.([A-Z][A-Z0-9_]+)/;

async function sourceFiles() {
    const entries = await readdir(repoRoot, { withFileTypes: true });
    return entries
        .filter(e => e.isFile() && e.name.endsWith('.js'))
        .map(e => e.name)
        .sort();
}

/** Every easing site: {file, line, mode, excepted}. */
async function census() {
    const sites = [];
    for (const name of await sourceFiles()) {
        const lines = (await readFile(new URL(name, repoRoot), 'utf8')).split('\n');
        lines.forEach((line, i) => {
            const m = line.match(MODE);
            if (!m) return;
            // An exception must be stated in the comment block immediately
            // above the site, so the reason travels with the code rather than
            // living in a doc. Six lines: enough for a real explanation,
            // tight enough that it cannot drift away from what it justifies.
            const preamble = lines.slice(Math.max(0, i - 6), i).join('\n');
            sites.push({
                file: name,
                line: i + 1,
                mode: m[1],
                excepted: /motion-exception:/.test(preamble),
            });
        });
    }
    return sites;
}

test('every easing site conforms to the token spec or states an exception', async () => {
    const offenders = (await census())
        .filter(s => !CONFORMING.has(s.mode) && !s.excepted)
        .map(s => `${s.file}:${s.line}  ${s.mode}`);

    assert.deepEqual(offenders, [],
        `Easing must be ${ENTER} (motion_easing.enter) or ${EXIT} ` +
        `(motion_easing.exit), per the NorviOS motion tokens. ` +
        `A different mode needs a "motion-exception:" comment in the six ` +
        `lines above it saying why.\n  ` + offenders.join('\n  '));
});

test('EASE_OUT_QUAD specifically is gone', async () => {
    // Named on its own because it is Shell's default: it is what a call site
    // gets when nobody chose, and 12 of 17 sites had it.
    const quad = (await census()).filter(s => s.mode === 'EASE_OUT_QUAD');
    assert.deepEqual(quad.map(s => `${s.file}:${s.line}`), [],
        'EASE_OUT_QUAD is GNOME Shell\'s default easing, not a choice.');
});

test('the exceptions that exist are the two documented overshoots', async () => {
    const excepted = (await census()).filter(s => s.excepted);
    assert.equal(excepted.length, 2, 'exactly two exceptions are expected');
    for (const s of excepted) {
        assert.equal(s.mode, 'EASE_OUT_BACK',
            `${s.file}:${s.line} claims an exception but is ${s.mode}`);
        assert.equal(s.file, 'appLauncher.js',
            'overshoot is reserved for direct manipulation (drag)');
    }
});

test('a bidirectional transition picks its curve by direction', async () => {
    // The census alone cannot catch this: one site serving BOTH reveal and
    // conceal passes by using either cubic mode, while silently applying the
    // enter curve to exits. motion_easing declares `reversible`, so the dock
    // slide must branch. Asserted structurally because there is exactly one
    // such site and it is the dock's most-seen motion.
    const docking = await readFile(new URL('docking.js', repoRoot), 'utf8');
    const start = docking.indexOf('startTransition:');
    assert.ok(start > 0, 'startTransition not found in docking.js');
    const block = docking.slice(start, start + 900);

    assert.match(block, /DockMotionTarget\.SHOWN/,
        'the dock slide must decide its curve from the target, not hardcode one');
    assert.ok(block.includes(ENTER) && block.includes(EXIT),
        `the dock slide must use ${ENTER} revealing and ${EXIT} concealing; ` +
        'a single mode applies the enter curve to conceals too');
});

test('the guard has teeth', async () => {
    // An assertion that has never been in a position to fail is not a check.
    const sites = await census();
    assert.ok(sites.length >= 15, `expected the full census, saw ${sites.length}`);

    // A non-conforming, unannotated mode must be caught...
    const bad = { mode: 'EASE_OUT_QUAD', excepted: false };
    assert.ok(!CONFORMING.has(bad.mode) && !bad.excepted);

    // ...and the same mode WITH a stated reason must be allowed through.
    const annotated = { mode: 'EASE_OUT_QUAD', excepted: true };
    assert.ok(!CONFORMING.has(annotated.mode) && annotated.excepted);

    // The regex must actually match the shape used in this codebase.
    assert.equal(
        'mode: Clutter.AnimationMode.EASE_OUT_CUBIC,'.match(MODE)[1],
        'EASE_OUT_CUBIC');
});
