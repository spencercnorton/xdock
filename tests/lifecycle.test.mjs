import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {URL} from 'node:url';

const [source, dockingSource, themingSource, utilsSource] = await Promise.all([
    readFile(new URL('../lifecycle.js', import.meta.url), 'utf8'),
    readFile(new URL('../docking.js', import.meta.url), 'utf8'),
    readFile(new URL('../theming.js', import.meta.url), 'utf8'),
    readFile(new URL('../utils.js', import.meta.url), 'utf8'),
]);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
    connectOwnedSignals,
    DeferredTask,
    disconnectOwnedSignals,
    LifecycleState,
    RestorableValue,
    retryPendingRestorations,
    runCleanupTasks,
} = await import(moduleUrl);

test('a second connection fault rolls back or retains every first signal', () => {
    const ownedSignals = new Map();
    const secondConnectFailure = new Error('second connect failed');
    const rollbackFailure = new Error('first rollback failed');
    const reported = [];
    let failRollback = true;
    const disconnected = [];
    const actor = {
        connect(signal) {
            assert.equal(ownedSignals.has(actor), true);
            if (signal === 'second')
                throw secondConnectFailure;
            return 41;
        },
        disconnect(id) {
            if (failRollback)
                throw rollbackFailure;
            disconnected.push(id);
        },
    };

    assert.throws(() => connectOwnedSignals(ownedSignals, actor, [
        ['first', () => {}],
        ['second', () => {}],
    ], (error, signalIndex) => reported.push({error, signalIndex})),
    error => error === secondConnectFailure);

    assert.deepEqual(ownedSignals.get(actor), [41]);
    assert.deepEqual(reported, [{error: rollbackFailure, signalIndex: 1}]);

    failRollback = false;
    assert.deepEqual(disconnectOwnedSignals(ownedSignals, actor), []);
    assert.deepEqual(disconnected, [41]);
    assert.equal(ownedSignals.has(actor), false);
});

test('cleanup continues in order after a task fails', () => {
    const calls = [];
    const reported = [];
    const failure = new Error('first cleanup failed');

    const errors = runCleanupTasks([
        ['first', () => calls.push('first')],
        ['failure', () => {
            calls.push('failure');
            throw failure;
        }],
        ['last', () => calls.push('last')],
    ], (error, name) => reported.push({error, name}));

    assert.deepEqual(calls, ['first', 'failure', 'last']);
    assert.deepEqual(errors, [{name: 'failure', error: failure}]);
    assert.deepEqual(reported, [{name: 'failure', error: failure}]);
});

test('a failing error reporter cannot interrupt cleanup', () => {
    const calls = [];

    const errors = runCleanupTasks([
        ['failure', () => {
            throw new Error('cleanup failed');
        }],
        ['last', () => calls.push('last')],
    ], () => {
        throw new Error('reporter failed');
    });

    assert.equal(errors.length, 1);
    assert.deepEqual(calls, ['last']);
});

test('successful cleanup returns no errors', () => {
    assert.deepEqual(runCleanupTasks([
        ['first', () => {}],
        ['second', () => {}],
    ]), []);
});

test('nested cleanup failures remain observable to the owner', () => {
    const nestedFailure = new Error('nested handler failed');
    const calls = [];

    const errors = runCleanupTasks([
        ['handler group', () => [{name: 'signal #2', error: nestedFailure}]],
        ['last', () => calls.push('last')],
    ]);

    assert.deepEqual(errors, [{
        name: 'handler group: signal #2',
        error: nestedFailure,
    }]);
    assert.deepEqual(calls, ['last']);
});

test('handler cleanup retains failed items for a later retry', () => {
    const removeStart = utilsSource.indexOf('    _removeLabel(label) {');
    const removeEnd = utilsSource.indexOf('\n    blockWithLabel(label)', removeStart);
    const removeBody = utilsSource.slice(removeStart, removeEnd);

    assert.notEqual(removeStart, -1);
    assert.notEqual(removeEnd, -1);
    assert.match(removeBody, /failedItems\.add\(item\)/);
    assert.match(removeBody, /items\.filter\(item => failedItems\.has\(item\)\)/);
    assert.match(removeBody, /\[\.\.\.retained, \.\.\.addedDuringRemoval\]/,
        'failed handlers and re-entrant additions must both remain owned');
});

test('initialization fault after a side effect rolls back and preserves the fault', () => {
    const externalRegistrations = [];
    const initializationFailure = new Error('fault after registration');
    let cleanupCalls = 0;
    const lifecycle = new LifecycleState('fault-injected component', () => {
        cleanupCalls++;
        externalRegistrations.length = 0;
    });

    assert.throws(() => lifecycle.enable(() => {
        externalRegistrations.push('global signal');
        throw initializationFailure;
    }), error => error === initializationFailure);

    assert.equal(lifecycle.destroyed, true);
    assert.deepEqual(externalRegistrations, []);
    assert.equal(cleanupCalls, 1);
    assert.deepEqual(lifecycle.destroy(), []);
    assert.equal(cleanupCalls, 1);
});

test('rollback failure cannot mask the initialization fault', () => {
    const initializationFailure = new Error('initialization failed');
    const cleanupFailure = new Error('cleanup also failed');
    const reported = [];
    let externalRegistration = true;
    const lifecycle = new LifecycleState('fault-injected component', () => {
        externalRegistration = false;
        throw cleanupFailure;
    }, (error, operation) => reported.push({error, operation}));

    assert.throws(() => lifecycle.enable(() => {
        throw initializationFailure;
    }), error => error === initializationFailure);
    assert.equal(externalRegistration, false);
    assert.deepEqual(reported, [{
        error: cleanupFailure,
        operation: 'fault-injected component',
    }]);
});

test('destroy is reentrancy-safe and cleanup runs once', () => {
    let cleanupCalls = 0;
    let lifecycle;
    lifecycle = new LifecycleState('reentrant component', () => {
        cleanupCalls++;
        assert.deepEqual(lifecycle.destroy(), []);
    });
    lifecycle.enable(() => {});

    assert.deepEqual(lifecycle.destroy(), []);
    assert.equal(cleanupCalls, 1);
    assert.equal(lifecycle.destroyed, true);
});

test('reentrant destroy cannot be overwritten by initialization completion', () => {
    let cleanupCalls = 0;
    let lifecycle;
    lifecycle = new LifecycleState('reentrant initialization', () => cleanupCalls++);

    assert.throws(() => lifecycle.enable(() => lifecycle.destroy()),
        /destroyed during initialization/);
    assert.equal(lifecycle.destroyed, true);
    assert.equal(lifecycle.enabled, false);
    assert.equal(cleanupCalls, 1);
});

test('lifecycle exposes nested rollback failures', () => {
    const nestedFailure = new Error('signal disconnect failed');
    const lifecycle = new LifecycleState('component', () => [
        {name: 'owned signal', error: nestedFailure},
    ]);
    lifecycle.enable(() => {});

    assert.deepEqual(lifecycle.destroy(), [{
        name: 'component: owned signal',
        error: nestedFailure,
    }]);
});

test('startup override captures once across repeated pre-startup rebuilds', () => {
    let hasOverview = true;
    let reads = 0;
    const writes = [];
    const override = new RestorableValue(
        () => {
            reads++;
            return hasOverview;
        },
        value => {
            writes.push(value);
            hasOverview = value;
        });

    override.setTemporary(false);
    override.setTemporary(false);

    assert.equal(reads, 1);
    assert.equal(hasOverview, false);
    assert.equal(override.active, true);
    assert.equal(override.restore(), true);
    assert.equal(hasOverview, true);
    assert.equal(override.active, false);
    assert.equal(override.restore(), false);
    assert.deepEqual(writes, [false, false, true]);
});

test('failed startup restoration retains its snapshot for a retry', () => {
    let hasOverview = true;
    let failRestoration = true;
    const override = new RestorableValue(
        () => hasOverview,
        value => {
            if (value && failRestoration)
                throw new Error('session mode is temporarily unavailable');
            hasOverview = value;
        });

    override.setTemporary(false);
    assert.throws(() => override.restore(), /temporarily unavailable/);
    assert.equal(override.active, true);
    assert.equal(hasOverview, false);

    failRestoration = false;
    assert.equal(override.restore(), true);
    assert.equal(override.active, false);
    assert.equal(hasOverview, true);
});

test('startup snapshot survives a failed temporary assignment', () => {
    let hasOverview = true;
    let failTemporaryWrite = true;
    const override = new RestorableValue(
        () => hasOverview,
        value => {
            if (!value && failTemporaryWrite)
                throw new Error('temporary assignment failed');
            hasOverview = value;
        });

    assert.throws(() => override.setTemporary(false), /temporary assignment failed/);
    assert.equal(override.active, true);
    failTemporaryWrite = false;
    assert.equal(override.restore(), true);
    assert.equal(hasOverview, true);
});

test('detached startup restoration retries later without its manager', () => {
    let hasOverview = true;
    let restorationFailures = 2;
    const scheduled = [];
    const reportedAttempts = [];
    const override = new RestorableValue(
        () => hasOverview,
        value => {
            if (value && restorationFailures-- > 0)
                throw new Error('session mode is temporarily unavailable');
            hasOverview = value;
        });

    override.setTemporary(false);
    assert.equal(override.restoreEventually(
        callback => scheduled.push(callback), {
            attempts: 3,
            onError: (_error, attempt) => reportedAttempts.push(attempt),
        }), true);

    // These callbacks retain only the RestorableValue and writer closure; the
    // manager that initiated teardown is no longer involved.
    scheduled.shift()();
    scheduled.shift()();
    scheduled.shift()();

    assert.deepEqual(reportedAttempts, [1, 2]);
    assert.equal(override.active, false);
    assert.equal(hasOverview, true);
    assert.deepEqual(retryPendingRestorations(), []);
});

test('exhausted restoration remains explicitly owned for a future enable', () => {
    let hasOverview = true;
    let restorationAvailable = false;
    const scheduled = [];
    const override = new RestorableValue(
        () => hasOverview,
        value => {
            if (value && !restorationAvailable)
                throw new Error('session mode remains unavailable');
            hasOverview = value;
        });

    override.setTemporary(false);
    override.restoreEventually(callback => scheduled.push(callback), {attempts: 2});
    scheduled.shift()();
    scheduled.shift()();

    assert.equal(override.active, true);
    assert.equal(hasOverview, false);
    assert.equal(retryPendingRestorations().length, 1);

    restorationAvailable = true;
    assert.deepEqual(retryPendingRestorations(), []);
    assert.equal(override.active, false);
    assert.equal(hasOverview, true);
});

test('dock actor slots clean up faults before and after parenting', () => {
    for (const faultAfter of ['slider', 'box']) {
        const destroyed = [];
        let slider = null;
        let box = null;
        const lifecycle = new LifecycleState('fault-injected dock', () =>
            runCleanupTasks([
                ['box', () => box?.destroy()],
                ['slider', () => slider?.destroy()],
            ]));

        assert.throws(() => lifecycle.enable(() => {
            slider = {destroy: () => destroyed.push('slider')};
            if (faultAfter === 'slider')
                throw new Error('fault after slider construction');
            box = {destroy: () => destroyed.push('box')};
            throw new Error('fault after box construction');
        }), /fault after/);

        assert.deepEqual(destroyed,
            faultAfter === 'slider' ? ['slider'] : ['box', 'slider']);
    }
});

test('production XDock wires unparented actors into rollback', () => {
    const initializeStart = dockingSource.indexOf('    _initializeDock() {');
    const initializeEnd = dockingSource.indexOf('\n    get position()', initializeStart);
    const initialize = dockingSource.slice(initializeStart, initializeEnd);
    const cleanupStart = dockingSource.indexOf('    _cleanup() {', initializeEnd);
    const cleanupEnd = dockingSource.indexOf(
        '\n    _updateAutoHideBarriers()', cleanupStart);
    const cleanup = dockingSource.slice(cleanupStart, cleanupEnd);

    assert.ok(initialize.indexOf('this._slider = null;') <
        initialize.indexOf('this._slider = new DashSlideContainer'));
    assert.ok(initialize.indexOf('this._motionController = null;') <
        initialize.indexOf('this._motionController = new Motion.DockMotionController'));
    assert.ok(initialize.indexOf('this._box = null;') <
        initialize.indexOf('this._box = new St.BoxLayout'));
    assert.ok(cleanup.indexOf("['motion controller'") <
        cleanup.indexOf("['dock slider actor'"));
    assert.ok(cleanup.indexOf("['dock signals'") <
        cleanup.indexOf("['dash'"),
    'dock-owned cross-component signals must disconnect before DockDash is disposed');
    assert.ok(cleanup.indexOf("['dock signals'") <
        cleanup.indexOf("['intellihide'"),
    'dock-owned cross-component signals must disconnect before intellihide teardown');
    assert.ok(cleanup.indexOf("['dock signals'") <
        cleanup.indexOf("['theme manager'"),
    'dock-owned cross-component signals must disconnect before theme teardown');
    assert.ok(cleanup.indexOf("['dock signals'") <
        cleanup.indexOf("['workspace switcher popup'"),
    'dock-owned cross-component signals must disconnect before popup disposal');
    assert.match(cleanup,
        /\['motion controller',[\s\S]*_motionController\?\.cancel\(\)/);
    assert.match(initialize,
        /set_name_by_id\(sourceId,[\s\S]*catch \(error\)[\s\S]*source_remove\(sourceId\)/);
    assert.match(cleanup, /\['dock box actor',[\s\S]*box\?\.destroy\(\)/);
    assert.match(cleanup, /\['dock slider actor',[\s\S]*slider\?\.destroy\(\)/);
});

test('production XDock exposes a versioned visual integration contract', () => {
    const contractStart = dockingSource.indexOf('    getBlurMyShellIntegration() {');
    const contractEnd = dockingSource.indexOf('\n    _untrackDock()', contractStart);
    const contract = dockingSource.slice(contractStart, contractEnd);

    assert.notEqual(contractStart, -1);
    assert.notEqual(contractEnd, -1);
    assert.match(contract, /version: 1/);
    assert.match(contract, /dashBox: this\._box/);
    assert.match(contract, /dash: this\.dash/);
    assert.match(contract, /background: this\.dash\?\._background \?\? null/);
});

test('production ThemeManager enters lifecycle before side-effecting init', () => {
    const managerStart = themingSource.indexOf('export class ThemeManager');
    const managerEnd = themingSource.indexOf(
        'Signals.addSignalMethods(ThemeManager.prototype)', managerStart);
    const manager = themingSource.slice(managerStart, managerEnd);

    assert.ok(manager.indexOf('this._lifecycle = new LifecycleState') <
        manager.indexOf('this._lifecycle.enable(() => this._initialize())'));
    assert.ok(manager.indexOf('_initialize() {') <
        manager.indexOf('this._bindSettingsChanges();'));
    assert.match(manager, /_cleanup\(\) \{[\s\S]*theme transparency[\s\S]*theme signals/);
});

test('production ThemeManager owns the high-contrast opaque fallback', () => {
    const managerStart = themingSource.indexOf('export class ThemeManager');
    const managerEnd = themingSource.indexOf(
        'Signals.addSignalMethods(ThemeManager.prototype)', managerStart);
    const manager = themingSource.slice(managerStart, managerEnd);

    assert.match(manager, /this\._shellSettings = St\.Settings\.get\(\)/);
    assert.match(manager,
        /this\._shellSettings, 'notify::high-contrast',[\s\S]*updateCustomTheme/);
    assert.match(manager, /const highContrast = this\._shellSettings\?\.high_contrast/);
    assert.match(manager,
        /if \(highContrast\) \{[\s\S]*background-color: rgba\([\s\S]*, 1\);[\s\S]*border-color: rgba\([\s\S]*, 1\);[\s\S]*transition-duration: 0ms/);
    assert.match(manager,
        /this\._shellSettings = null;[\s\S]*this\._signalsHandler = null/);
});

test('deferred teardown suppresses callbacks and retries failed cancellation', () => {
    let scheduledCallback;
    let cancellationAttempts = 0;
    let callbackCalls = 0;
    const task = new DeferredTask(callback => {
        scheduledCallback = callback;
        return 42;
    }, id => {
        assert.equal(id, 42);
        cancellationAttempts++;
        if (cancellationAttempts === 1)
            throw new Error('cancel raced');
    });

    assert.equal(task.schedule(() => callbackCalls++), true);
    assert.throws(() => task.deactivate(), /cancel raced/);
    assert.equal(task.pending, true);
    assert.equal(task.schedule(() => callbackCalls++), false);
    assert.equal(task.cancel(), true);
    assert.equal(task.pending, false);

    // A callback already dispatched by the scheduler may still race the
    // successful cancellation; deactivation makes that callback inert.
    scheduledCallback();
    assert.equal(callbackCalls, 0);
    assert.equal(cancellationAttempts, 2);
});

test('deferred callback can schedule its successor without stale pending state', () => {
    const scheduledCallbacks = [];
    const task = new DeferredTask(callback => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
    }, () => {});
    let calls = 0;

    task.schedule(() => {
        calls++;
        assert.equal(task.pending, false);
        assert.equal(task.schedule(() => calls++), true);
    });
    scheduledCallbacks[0]();

    assert.equal(task.pending, true);
    scheduledCallbacks[1]();
    assert.equal(task.pending, false);
    assert.equal(calls, 2);
});
