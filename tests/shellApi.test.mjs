import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {URL} from 'node:url';

const shellApiSource = await readFile(
    new URL('../shellApi.js', import.meta.url), 'utf8');
const shellApiModuleUrl =
    `data:text/javascript;base64,${Buffer.from(shellApiSource).toString('base64')}`;
const {
    UnsupportedShellError,
    formatUnsupportedShellMessage,
    probeShellCapabilities,
    runShellCapabilityGate,
} = await import(shellApiModuleUrl);
import {makeCompatibleShellApi} from './shellApiFixture.mjs';

test('GNOME 50/51 overview and Dash fixture satisfies the capability table', () => {
    const api = makeCompatibleShellApi();
    assert.equal(api.AppDisplay.AppIcon.prototype._setPopupTimeout, undefined);
    assert.deepEqual(probeShellCapabilities(api), {
        supported: true,
        missing: [],
    });
});

test('dummy overview requires the Dash surface but not absent controls', () => {
    const api = makeCompatibleShellApi({dummy: true});
    assert.equal(api.Main.overview._overview, null);
    assert.deepEqual(probeShellCapabilities(api), {
        supported: true,
        missing: [],
    });
});

test('dummy overview still requires core layout and deferred-work surfaces', () => {
    const api = makeCompatibleShellApi({dummy: true});
    delete api.Main.layoutManager.monitors;
    delete api.Main.queueDeferredWork;

    const {missing} = probeShellCapabilities(api);
    assert.ok(missing.includes('Main.layoutManager.monitors'));
    assert.ok(missing.includes('Main.queueDeferredWork'));
    assert.ok(!missing.includes('Main.overview._overview.controls'));
});

test('missing Dash delegate fails the strict preflight', () => {
    const api = makeCompatibleShellApi();
    delete api.Dash.Dash.prototype._syncLabel;

    const report = probeShellCapabilities(api);
    assert.equal(report.supported, false);
    assert.deepEqual(report.missing, ['Dash.Dash.prototype._syncLabel']);
});

test('missing Dash superclass and default icon/menu hooks fail preflight', () => {
    const api = makeCompatibleShellApi();
    delete api.Dash.DashItemContainer.prototype.setLabelText;
    delete api.AppDisplay.AppIcon.prototype._onDestroy;
    delete api.AppMenu.AppMenu.prototype._updateFavoriteItem;
    Object.preventExtensions(api.AppDisplay.AppSearchProvider.prototype);

    const {missing} = probeShellCapabilities(api);
    assert.ok(missing.includes(
        'Dash.DashItemContainer.prototype.setLabelText'));
    assert.ok(missing.includes('AppDisplay.AppIcon.prototype._onDestroy'));
    assert.ok(missing.includes(
        'AppMenu.AppMenu.prototype._updateFavoriteItem'));
    assert.ok(missing.includes(
        'AppDisplay.AppSearchProvider.prototype.updating'));
});

test('missing overview controls fail before layout mutation', () => {
    const api = makeCompatibleShellApi();
    api.Main.overview._overview = null;

    const report = probeShellCapabilities(api);
    assert.equal(report.supported, false);
    assert.deepEqual(report.missing, ['Main.overview._overview.controls']);
});

test('missing controls layout or private layout method is reported', () => {
    const missingLayoutApi = makeCompatibleShellApi();
    delete missingLayoutApi.Main.overview._overview.controls.layout_manager;
    assert.ok(probeShellCapabilities(missingLayoutApi).missing.includes(
        'overviewControls.layout_manager'));

    const missingMethodApi = makeCompatibleShellApi();
    const {layout_manager: layout} =
        missingMethodApi.Main.overview._overview.controls;
    delete layout.constructor.prototype._computeWorkspacesBoxForState;
    assert.ok(probeShellCapabilities(missingMethodApi).missing.includes(
        'overviewControls.layout_manager.constructor.prototype.' +
        '_computeWorkspacesBoxForState'));
});

test('missing search and workspace hooks are reported together', () => {
    const api = makeCompatibleShellApi();
    delete api.Main.overview._overview.controls._searchController._setSearchActive;
    delete api.WorkspacesView.WorkspacesView.prototype._getFirstFitAllWorkspaceBox;

    const {missing} = probeShellCapabilities(api);
    assert.ok(missing.includes(
        'overviewControls._searchController._setSearchActive'));
    assert.ok(missing.includes(
        'WorkspacesView.WorkspacesView.prototype._getFirstFitAllWorkspaceBox'));
});

test('read-only private state fails before the first assignment', () => {
    const api = makeCompatibleShellApi();
    Object.defineProperty(api.Main.sessionMode, 'hasOverview', {
        configurable: true,
        value: true,
        writable: false,
    });
    Object.defineProperty(
        api.Main.overview._overview.controls._searchController,
        '_showAppsButton', {
            configurable: true,
            value: {},
            writable: false,
        });

    const {missing} = probeShellCapabilities(api);
    assert.ok(missing.includes('Main.sessionMode.hasOverview'));
    assert.ok(missing.includes(
        'overviewControls._searchController._showAppsButton'));
});

test('unsupported gate runs fallback and never invokes mutation callback', () => {
    const api = makeCompatibleShellApi();
    delete api.Dash.Dash.prototype.acceptDrop;
    let mutations = 0;
    let fallbacks = 0;

    const result = runShellCapabilityGate(api,
        () => ++mutations,
        report => {
            fallbacks++;
            return report.missing;
        });

    assert.equal(mutations, 0);
    assert.equal(fallbacks, 1);
    assert.deepEqual(result, ['Dash.Dash.prototype.acceptDrop']);
});

test('probe exceptions also fail closed without mutation', () => {
    let mutations = 0;
    const result = runShellCapabilityGate({},
        () => ++mutations,
        report => report,
        () => {
            throw new Error('injected probe failure');
        });

    assert.equal(mutations, 0);
    assert.equal(result.supported, false);
    assert.deepEqual(result.missing, ['shell capability probe']);
});

test('supported gate invokes the mutation exactly once', () => {
    let mutations = 0;
    const result = runShellCapabilityGate(makeCompatibleShellApi(),
        () => ++mutations,
        () => assert.fail('supported API must not use fallback'));

    assert.equal(result, 1);
    assert.equal(mutations, 1);
});

test('unsupported error gives one actionable stock-Dash message', () => {
    const report = {
        supported: false,
        missing: ['overviewControls.layout_manager'],
    };
    const message = formatUnsupportedShellMessage(report);
    const error = new UnsupportedShellError(report);

    assert.equal(error.message, message);
    assert.match(message, /stock overview Dash remains active/);
    assert.match(message, /Update XDock/);
    assert.equal(message.split('XDock was not enabled').length - 1, 1);
});

test('unsupported enable throws before manager export or Shell order', () => {
    const api = makeCompatibleShellApi();
    delete api.Dash.Dash.prototype.acceptDrop;
    const extensionOrder = [];
    // Model Ubuntu Dock having withdrawn while the user dock was attempted.
    let ubuntuDockManager = null;
    let exportedManager;
    let mutationCount = 0;

    const conditionallyEnableUbuntuDock = () => {
        const userDockActive = extensionOrder.includes(
            'xdock@spencercnorton.github.io');
        if (!userDockActive && !ubuntuDockManager)
            ubuntuDockManager = {kind: 'ubuntu-dock'};
        else if (userDockActive)
            ubuntuDockManager = null;
    };

    const extensionEnable = () => {
        const manager = runShellCapabilityGate(api,
            () => {
                mutationCount++;
                return {};
            }, report => {
                throw new UnsupportedShellError(report);
            });
        exportedManager = manager;
    };
    const shellCallExtensionEnable = () => {
        extensionEnable();
        extensionOrder.push('xdock@spencercnorton.github.io');
    };

    assert.throws(shellCallExtensionEnable, UnsupportedShellError);
    assert.equal(mutationCount, 0);
    assert.equal(exportedManager, undefined);
    assert.deepEqual(extensionOrder, []);
    conditionallyEnableUbuntuDock();
    assert.deepEqual(ubuntuDockManager, {kind: 'ubuntu-dock'});
});

test('production wiring gates before singleton and removes diagnostic probe', async () => {
    const [docking, extension, dash] = await Promise.all([
        readFile(new URL('../docking.js', import.meta.url), 'utf8'),
        readFile(new URL('../extension.js', import.meta.url), 'utf8'),
        readFile(new URL('../dash.js', import.meta.url), 'utf8'),
    ]);
    const constructorStart = docking.indexOf('export class DockManager');
    const initializeStart = docking.indexOf('    _initialize() {', constructorStart);
    const constructor = docking.slice(constructorStart, initializeStart);
    const failClosedStart = docking.indexOf(
        '    _failClosedForUnsupportedShell(report)');
    const failClosedEnd = docking.indexOf('\n    _createDock(', failClosedStart);
    const failClosed = docking.slice(failClosedStart, failClosedEnd);

    assert.ok(constructor.indexOf('runShellCapabilityGate(') <
        constructor.indexOf('DockManager._singleton = this'));
    assert.match(docking, /_createDocks\(\) \{[\s\S]*runShellCapabilityGate\(/);
    const createDocksStart = docking.indexOf('    _createDocks() {');
    const createDockCall = docking.indexOf('        this._createDock({', createDocksStart);
    assert.ok(docking.indexOf('this._oldDash = Main.overview.dash',
        createDocksStart) < createDockCall);
    assert.match(docking,
        /catch \(error\) \{[\s\S]*error instanceof UnsupportedShellError[\s\S]*_failClosedForUnsupportedShell/);
    assert.doesNotMatch(extension, /catch \(error\)/);
    assert.match(extension, /onFailClosed: failedManager =>/);
    assert.match(extension,
        /if \(dockManager === failedManager\)[\s\S]*dockManager = null/);
    assert.ok(extension.indexOf('new DockManager(this') <
        extension.indexOf('dockManager = manager'));
    assert.ok(failClosed.indexOf('onFailClosed?.(this)') <
        failClosed.indexOf('const errors = this.destroy()'));
    assert.doesNotMatch(dash, /checkShellApiCompatibility/);
});
