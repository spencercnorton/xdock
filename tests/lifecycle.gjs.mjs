import {
    LifecycleState,
    RestorableValue,
    retryPendingRestorations,
    runCleanupTasks,
} from '../lifecycle.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function testActorFaultRollback() {
    const destroyed = [];
    let slider = null;
    let box = null;
    const lifecycle = new LifecycleState('GJS dock fault', () =>
        runCleanupTasks([
            ['box', () => box?.destroy()],
            ['slider', () => slider?.destroy()],
        ]));

    try {
        lifecycle.enable(() => {
            slider = {destroy: () => destroyed.push('slider')};
            box = {destroy: () => destroyed.push('box')};
            throw new Error('injected GJS dependency failure');
        });
        throw new Error('fault injection did not propagate');
    } catch (error) {
        assert(error.message === 'injected GJS dependency failure',
            'rollback masked the injected dependency failure');
    }

    assert(destroyed.join(',') === 'box,slider',
        'GJS actor rollback did not release both actors in reverse order');
}

function testDetachedRestoration() {
    let value = true;
    let failures = 1;
    const callbacks = [];
    const restorable = new RestorableValue(
        () => value,
        next => {
            if (next && failures-- > 0)
                throw new Error('injected GJS writer failure');
            value = next;
        });

    restorable.setTemporary(false);
    restorable.restoreEventually(callback => callbacks.push(callback), {attempts: 2});
    callbacks.shift()();
    callbacks.shift()();

    assert(value === true && !restorable.active,
        'detached GJS restoration did not recover the original value');
    assert(retryPendingRestorations().length === 0,
        'successful GJS restoration remained pending');
}

testActorFaultRollback();
testDetachedRestoration();
print('GJS lifecycle fault injection: PASS');
