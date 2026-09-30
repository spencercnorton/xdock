// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/**
 * Run teardown operations independently so one failure cannot prevent the
 * remaining resources from being released.
 *
 * @param {Array<[string, Function]>} tasks cleanup name/callback pairs
 * @param {Function} [onError] optional error reporter
 * @returns {Array<{name: string, error: Error}>} the failed cleanup operations
 */
export function runCleanupTasks(tasks, onError = null) {
    const errors = [];

    for (const [name, cleanup] of tasks) {
        try {
            const nestedErrors = cleanup();
            if (Array.isArray(nestedErrors)) {
                for (const nested of nestedErrors) {
                    if (!nested?.error)
                        continue;
                    errors.push({
                        name: `${name}: ${nested.name ?? 'nested cleanup'}`,
                        error: nested.error,
                    });
                }
            }
        } catch (error) {
            errors.push({name, error});

            try {
                onError?.(error, name);
            } catch {
                // Error reporting must never interrupt the remaining cleanup.
            }
        }
    }

    return errors;
}

/**
 * Disconnect signal ids owned by one source. Successful ids are forgotten
 * immediately while failed ids remain in the ownership map for a later retry.
 *
 * @param {Map<object, number[]>} ownedSignals signal ownership map
 * @param {object} source object that owns the signal connections
 * @param {Function} [onError] optional error reporter
 * @returns {Array<{name: string, error: Error}>} disconnection failures
 */
export function disconnectOwnedSignals(ownedSignals, source, onError = null) {
    const signalIds = ownedSignals.get(source);
    if (!signalIds)
        return [];

    const errors = [];
    const retainedIds = [];
    signalIds.forEach((id, index) => {
        try {
            source.disconnect(id);
        } catch (error) {
            retainedIds.push(id);
            errors.push({name: `signal ${index + 1}`, error});
            try {
                onError?.(error, index + 1);
            } catch {
                // Reporting must not interrupt the remaining disconnections.
            }
        }
    });

    if (retainedIds.length)
        ownedSignals.set(source, retainedIds);
    else
        ownedSignals.delete(source);
    return errors;
}

/**
 * Publish signal ownership before the first connection. If a later connection
 * fails, already-created ids are disconnected; ids whose rollback fails stay
 * owned so component teardown can retry them.
 *
 * @param {Map<object, number[]>} ownedSignals signal ownership map
 * @param {object} source object to connect
 * @param {Array<[string, Function]>} signals signal/callback pairs
 * @param {Function} [onDisconnectError] optional rollback error reporter
 * @returns {number[]} connected signal ids
 */
export function connectOwnedSignals(ownedSignals, source, signals,
    onDisconnectError = null) {
    const signalIds = [];
    ownedSignals.set(source, signalIds);

    try {
        for (const [signal, callback] of signals)
            signalIds.push(source.connect(signal, callback));
        return signalIds;
    } catch (error) {
        disconnectOwnedSignals(ownedSignals, source, onDisconnectError);
        throw error;
    }
}

// A failed restoration must outlive the component that temporarily owned it.
// Keeping the value here also gives a later extension enable a synchronous
// opportunity to repair state after the bounded asynchronous retries finish.
const pendingRestorations = new Set();

/**
 * Retry every detached restoration once. Successfully restored values remove
 * themselves from the pending set; failed values remain explicitly owned.
 *
 * @param {Function} [onError] optional error reporter
 * @returns {Array<{value: RestorableValue, error: Error}>} restoration failures
 */
export function retryPendingRestorations(onError = null) {
    const errors = [];

    for (const value of [...pendingRestorations]) {
        try {
            value.restore();
        } catch (error) {
            errors.push({value, error});
            try {
                onError?.(error, value);
            } catch {
                // Reporting must not prevent the other values from restoring.
            }
        }
    }

    return errors;
}

/**
 * Small state machine for objects whose enable path can fail after registering
 * external state. Initialization failure runs the same idempotent cleanup as a
 * normal destroy and always rethrows the original initialization error.
 */
export class LifecycleState {
    constructor(name, cleanup, onError = null) {
        this._name = name;
        this._cleanup = cleanup;
        this._onError = onError;
        this._state = 'new';
    }

    get enabled() {
        return this._state === 'enabled';
    }

    get destroying() {
        return this._state === 'destroying';
    }

    get destroyed() {
        return this._state === 'destroyed';
    }

    enable(initialize) {
        if (this.enabled)
            return;
        if (this._state !== 'new')
            throw new Error(`${this._name} cannot be enabled while ${this._state}`);

        this._state = 'enabling';
        try {
            initialize();
            if (this._state !== 'enabling')
                throw new Error(`${this._name} was destroyed during initialization`);
            this._state = 'enabled';
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    destroy() {
        if (this.destroying || this.destroyed)
            return [];

        this._state = 'destroying';
        try {
            return runCleanupTasks([
                [this._name, () => this._cleanup?.()],
            ], this._onError);
        } finally {
            this._state = 'destroyed';
        }
    }
}

/**
 * Own a temporary external value. Repeated writes preserve the first value,
 * and failed restoration keeps the snapshot active so a later attempt can
 * retry rather than forgetting the original state.
 */
export class RestorableValue {
    constructor(read, write) {
        this._read = read;
        this._write = write;
        this._active = false;
    }

    get active() {
        return this._active;
    }

    setTemporary(value) {
        if (!this._active) {
            this._originalValue = this._read();
            this._active = true;
        }
        this._write(value);
    }

    restore() {
        if (!this._active)
            return false;

        this._write(this._originalValue);
        this._active = false;
        delete this._originalValue;
        pendingRestorations.delete(this);
        return true;
    }

    /**
     * Transfer an active snapshot to a callback that does not capture the
     * destroying component. Attempts are deliberately bounded; if all fail,
     * the module-level pending set retains the snapshot for the next explicit
     * retry rather than silently forgetting the external state.
     *
     * @param {Function} schedule one-shot callback scheduler
     * @param {object} [options] retry configuration
     * @param {number} [options.attempts] maximum asynchronous attempts
     * @param {Function} [options.onError] optional attempt error reporter
     * @returns {boolean} whether an active restoration was queued
     */
    restoreEventually(schedule, {attempts = 3, onError = null} = {}) {
        if (!this._active)
            return false;
        if (!(schedule instanceof Function))
            throw new TypeError('A restoration scheduler is required');
        if (!Number.isInteger(attempts) || attempts < 1)
            throw new RangeError('Restoration attempts must be a positive integer');

        pendingRestorations.add(this);
        if (this._restorationScheduled)
            return false;

        let remainingAttempts = attempts;
        const report = (error, attempt) => {
            try {
                onError?.(error, attempt);
            } catch {
                // Reporting cannot take ownership away from the restoration.
            }
        };
        const queueAttempt = () => {
            this._restorationScheduled = true;
            try {
                schedule(attemptRestore);
            } catch (error) {
                this._restorationScheduled = false;
                report(error, attempts - remainingAttempts + 1);
                throw error;
            }
        };
        const attemptRestore = () => {
            this._restorationScheduled = false;
            if (!this._active) {
                pendingRestorations.delete(this);
                return;
            }

            const attempt = attempts - remainingAttempts + 1;
            try {
                this.restore();
            } catch (error) {
                report(error, attempt);
                remainingAttempts--;
                if (remainingAttempts > 0) {
                    try {
                        queueAttempt();
                    } catch {
                        // The failed scheduler was already reported. The
                        // pending set deliberately retains the snapshot.
                    }
                }
            }
        };

        queueAttempt();
        return true;
    }
}

/**
 * Own one scheduled callback. Deactivation suppresses both new work and a
 * callback that races cancellation; a failed cancellation retains its id for
 * a later retry.
 */
export class DeferredTask {
    constructor(schedule, cancel) {
        this._schedule = schedule;
        this._cancel = cancel;
        this._active = true;
        this._id = null;
    }

    get pending() {
        return this._id !== null;
    }

    schedule(callback) {
        if (!this._active || this.pending)
            return false;

        this._id = this._schedule(() => {
            this._id = null;
            if (this._active)
                callback();
        });
        return true;
    }

    cancel() {
        if (!this.pending)
            return false;

        const id = this._id;
        this._cancel(id);
        if (this._id === id)
            this._id = null;
        return true;
    }

    deactivate() {
        this._active = false;
        return this.cancel();
    }
}
