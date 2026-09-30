// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const REQUIRED_DASH_METHODS = Object.freeze([
    '_onItemDragBegin',
    '_onItemDragCancelled',
    '_onItemDragEnd',
    '_endItemDrag',
    '_onItemDragMotion',
    '_appIdListToHash',
    '_queueRedisplay',
    '_hookUpLabel',
    '_syncLabel',
    '_clearDragPlaceholder',
    '_clearEmptyDropTarget',
    'handleDragOver',
    'acceptDrop',
    '_onWindowDragBegin',
    '_onWindowDragEnd',
    '_itemMenuStateChanged',
]);

const REQUIRED_APP_ICON_METHODS = Object.freeze([
    '_init',
    '_onDestroy',
    '_onKeyboardPopupMenu',
    '_updateDotStyle',
    'activate',
    'shouldShowTooltip',
    'vfunc_leave_event',
    'setForcedHighlight',
    '_onMenuPoppedDown',
]);

const REQUIRED_DASH_ICON_METHODS = Object.freeze([
    '_init',
]);

const REQUIRED_DASH_ITEM_CONTAINER_METHODS = Object.freeze([
    '_init',
    'setChild',
    'setLabelText',
    'animateOutAndDestroy',
]);

const REQUIRED_SHOW_APPS_ICON_METHODS = Object.freeze([
    '_init',
    '_createIcon',
]);

const REQUIRED_OVERVIEW_METHODS = Object.freeze([
    'connect',
    'disconnect',
    'show',
    'hide',
    'toggle',
    'shouldToggleByCornerOrButton',
]);

const REQUIRED_LAYOUT_METHODS = Object.freeze([
    'addChrome',
    'removeChrome',
    'untrackChrome',
    'findIndexForActor',
    'findMonitorForActor',
    'getWorkAreaForMonitor',
    '_queueUpdateRegions',
]);

function readProperty(object, property) {
    if (object === null || object === undefined)
        return {found: false, value: undefined};

    try {
        if (!(property in Object(object)))
            return {found: false, value: undefined};
        const {[property]: value} = object;
        return {found: true, value};
    } catch (error) {
        return {found: false, value: undefined, error};
    }
}

function readPath(root, path) {
    let value = root;
    for (const property of path.split('.')) {
        const result = readProperty(value, property);
        if (!result.found)
            return result;
        ({value} = result);
    }
    return {found: true, value};
}

function requirePath(missing, root, path, label = path) {
    const result = readPath(root, path);
    if (!result.found)
        missing.add(label);
    return result.found ? result.value : undefined;
}

function requireFunction(missing, root, path, label = path) {
    const result = readPath(root, path);
    if (!result.found || typeof result.value !== 'function')
        missing.add(label);
    return typeof result.value === 'function' ? result.value : undefined;
}

function requireFunctions(missing, object, prefix, methods) {
    if (!object) {
        missing.add(prefix);
        return;
    }

    for (const method of methods) {
        if (typeof readProperty(object, method).value !== 'function')
            missing.add(`${prefix}.${method}`);
    }
}

function requireAssignableFunctions(missing, object, prefix, methods) {
    requireFunctions(missing, object, prefix, methods);
    for (const method of methods) {
        if (!canAssignProperty(object, method))
            missing.add(`${prefix}.${method}`);
    }
}

function requireValue(missing, root, path, predicate, label = path) {
    const result = readPath(root, path);
    if (!result.found || !predicate(result.value))
        missing.add(label);
    return result.value;
}

function findPropertyDescriptor(object, property) {
    let owner = object;
    while (owner) {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(owner, property);
            if (descriptor)
                return descriptor;
            owner = Object.getPrototypeOf(owner);
        } catch {
            return null;
        }
    }
    return null;
}

function canAssignProperty(object, property) {
    if (object === null || object === undefined)
        return false;

    const descriptor = findPropertyDescriptor(object, property);
    if (!descriptor)
        return Object.isExtensible(object);
    if ('writable' in descriptor) {
        return descriptor.writable &&
            (Object.prototype.hasOwnProperty.call(object, property) ||
                Object.isExtensible(object));
    }
    return typeof descriptor.set === 'function';
}

function canDefineOwnProperty(object, property) {
    if (object === null || object === undefined)
        return false;

    try {
        const descriptor = Object.getOwnPropertyDescriptor(object, property);
        return descriptor ? descriptor.configurable : Object.isExtensible(object);
    } catch {
        return false;
    }
}

function requireAssignableProperty(missing, object, property, label) {
    if (!readProperty(object, property).found ||
        !canAssignProperty(object, property))
        missing.add(label);
}

function probeCoreShellApi(api, missing) {
    for (const path of [
        'Dash.Dash',
        'Dash.DashIcon',
        'Dash.DashItemContainer',
        'Dash.ShowAppsIcon',
        'AppDisplay.AppIcon',
        'AppDisplay.AppSearchProvider',
        'AppDisplay.FolderIcon',
        'AppMenu.AppMenu',
        'PopupMenu.PopupMenuBase',
    ])
        requireFunction(missing, api, path);

    const dashPrototype = requirePath(missing, api, 'Dash.Dash.prototype');
    requireFunctions(missing, dashPrototype, 'Dash.Dash.prototype', REQUIRED_DASH_METHODS);

    for (const [path, methods] of [
        ['Dash.DashIcon.prototype', REQUIRED_DASH_ICON_METHODS],
        ['Dash.DashItemContainer.prototype', REQUIRED_DASH_ITEM_CONTAINER_METHODS],
        ['Dash.ShowAppsIcon.prototype', REQUIRED_SHOW_APPS_ICON_METHODS],
    ]) {
        const prototype = requirePath(missing, api, path);
        requireFunctions(missing, prototype, path, methods);
    }

    const appIconPrototype = requirePath(missing, api, 'AppDisplay.AppIcon.prototype');
    requireFunctions(missing, appIconPrototype,
        'AppDisplay.AppIcon.prototype', REQUIRED_APP_ICON_METHODS);

    const appSearchProviderPrototype = requirePath(missing, api,
        'AppDisplay.AppSearchProvider.prototype');
    requireAssignableFunctions(missing, appSearchProviderPrototype,
        'AppDisplay.AppSearchProvider.prototype', ['createResultObject']);
    requireAssignableFunctions(missing, appIconPrototype,
        'AppDisplay.AppIcon.prototype', ['activate']);

    const appMenuPrototype = requirePath(missing, api, 'AppMenu.AppMenu.prototype');
    requireFunctions(missing, appMenuPrototype, 'AppMenu.AppMenu.prototype', [
        'open',
        '_getMenuItems',
        '_updateFavoriteItem',
    ]);
    for (const method of ['open', '_updateFavoriteItem']) {
        if (!canAssignProperty(appMenuPrototype, method))
            missing.add(`AppMenu.AppMenu.prototype.${method}`);
    }

    for (const [prototype, path] of [
        [appIconPrototype, 'AppDisplay.AppIcon.prototype.updating'],
        [appSearchProviderPrototype,
            'AppDisplay.AppSearchProvider.prototype.updating'],
    ]) {
        if (!canDefineOwnProperty(prototype, 'updating'))
            missing.add(path);
    }

    for (const method of ['initializeDeferredWork', 'queueDeferredWork'])
        requireFunction(missing, api, `Main.${method}`);

    const layoutManager = requirePath(missing, api, 'Main.layoutManager');
    requireFunctions(missing, layoutManager, 'Main.layoutManager',
        REQUIRED_LAYOUT_METHODS);
    for (const property of [
        '_startingUp',
        'monitors',
        'primaryIndex',
        'primaryMonitor',
    ]) {
        if (!readProperty(layoutManager, property).found)
            missing.add(`Main.layoutManager.${property}`);
    }

    const sessionMode = requirePath(missing, api, 'Main.sessionMode');
    requireAssignableProperty(missing, sessionMode, 'hasOverview',
        'Main.sessionMode.hasOverview');
    if (!readProperty(sessionMode, 'currentMode').found)
        missing.add('Main.sessionMode.currentMode');

    const overview = requirePath(missing, api, 'Main.overview');
    requireFunctions(missing, overview, 'Main.overview',
        REQUIRED_OVERVIEW_METHODS);
    for (const property of [
        'isDummy',
        'visible',
        'visibleTarget',
        'animationInProgress',
    ]) {
        if (!readProperty(overview, property).found)
            missing.add(`Main.overview.${property}`);
    }

    const overviewPrototype = overview?.constructor?.prototype;
    let dashDescriptor = null;
    try {
        dashDescriptor = Object.getOwnPropertyDescriptor(overviewPrototype, 'dash');
    } catch {}
    if (typeof dashDescriptor?.get !== 'function')
        missing.add('Main.overview.constructor.prototype.dash.get');
    if (!canDefineOwnProperty(overview, 'dash'))
        missing.add('Main.overview.dash override');

    for (const state of ['HIDDEN', 'WINDOW_PICKER', 'APP_GRID']) {
        requireValue(missing, api, `OverviewControls.ControlsState.${state}`,
            value => typeof value === 'number');
    }

    return overview;
}

function probeOverviewControls(api, overview, missing) {
    const isDummy = readProperty(overview, 'isDummy').value;
    if (!overview || isDummy)
        return;

    const oldDash = requirePath(missing, overview, 'dash', 'Main.overview.dash');
    requireFunctions(missing, oldDash, 'Main.overview.dash', [
        'hide',
        'show',
        'set_height',
        'setMaxSize',
        'allocate',
        'get_preferred_height',
    ]);
    for (const property of ['showAppsButton', '_maxHeight']) {
        if (!readProperty(oldDash, property).found)
            missing.add(`Main.overview.dash.${property}`);
    }
    requireAssignableProperty(missing, oldDash, '_maxHeight',
        'Main.overview.dash._maxHeight');
    for (const method of ['setMaxSize', 'allocate', 'get_preferred_height']) {
        if (!canAssignProperty(oldDash, method))
            missing.add(`Main.overview.dash.${method}`);
    }

    const controls = requirePath(missing, overview, '_overview.controls',
        'Main.overview._overview.controls');
    if (!controls)
        return;

    requireFunction(missing, controls, '_onShowAppsButtonToggled',
        'overviewControls._onShowAppsButtonToggled');
    for (const property of ['dash', '_searchEntry', '_thumbnailsBox',
        '_searchController', '_stateAdjustment', 'appDisplay']) {
        if (!readProperty(controls, property).found)
            missing.add(`overviewControls.${property}`);
    }

    const searchEntry = readProperty(controls, '_searchEntry').value;
    const thumbnailsBox = readProperty(controls, '_thumbnailsBox').value;
    const stateAdjustment = readProperty(controls, '_stateAdjustment').value;
    const appDisplay = readProperty(controls, 'appDisplay').value;
    requireFunction(missing, searchEntry, 'get_allocation_box',
        'overviewControls._searchEntry.get_allocation_box');
    requirePath(missing, thumbnailsBox, 'shouldShow',
        'overviewControls._thumbnailsBox.shouldShow');
    requirePath(missing, stateAdjustment, 'value',
        'overviewControls._stateAdjustment.value');
    requireFunction(missing, appDisplay, 'getAllItems',
        'overviewControls.appDisplay.getAllItems');

    const searchController = readProperty(controls, '_searchController').value;
    requireFunction(missing, searchController, '_setSearchActive',
        'overviewControls._searchController._setSearchActive');
    requirePath(missing, searchController, '_showAppsButton',
        'overviewControls._searchController._showAppsButton');
    requireAssignableProperty(missing, controls, 'dash',
        'overviewControls.dash');
    requireAssignableProperty(missing, stateAdjustment, 'value',
        'overviewControls._stateAdjustment.value');
    requireAssignableProperty(missing, searchController, '_showAppsButton',
        'overviewControls._searchController._showAppsButton');

    const layout = requirePath(missing, controls, 'layout_manager',
        'overviewControls.layout_manager');
    if (!layout)
        return;

    const layoutConstructor = readProperty(layout, 'constructor').value;
    const layoutPrototype = readProperty(layoutConstructor, 'prototype').value;
    requireFunctions(missing, layoutPrototype,
        'overviewControls.layout_manager.constructor.prototype', [
            'vfunc_allocate',
            '_computeWorkspacesBoxForState',
            '_getAppDisplayBoxForState',
        ]);
    requireFunction(missing, layout, '_runPostAllocation',
        'overviewControls.layout_manager._runPostAllocation');
    for (const property of ['_dash', '_searchEntry', '_workspacesThumbnails',
        '_searchController']) {
        if (!readProperty(layout, property).found)
            missing.add(`overviewControls.layout_manager.${property}`);
    }
    requireAssignableProperty(missing, layout, '_dash',
        'overviewControls.layout_manager._dash');
    requireAssignableProperty(missing, layout, '_runPostAllocation',
        'overviewControls.layout_manager._runPostAllocation');

    for (const method of ['_computeWorkspacesBoxForState',
        '_getAppDisplayBoxForState']) {
        if (!canAssignProperty(layoutPrototype, method)) {
            missing.add(
                `overviewControls.layout_manager.constructor.prototype.${method}`);
        }
    }

    requireFunction(missing, api,
        'WorkspacesView.SecondaryMonitorDisplay.prototype._getWorkspacesBoxForState');
    requireFunction(missing, api,
        'WorkspacesView.WorkspacesView.prototype._getFirstFitAllWorkspaceBox');
    requireFunction(missing, api,
        'Workspace.WorkspaceBackground.prototype.vfunc_allocate');
    requireFunction(missing, api, 'SwitcherPopup.SwitcherPopup.prototype._finish');
    for (const [objectPath, method] of [
        ['WorkspacesView.SecondaryMonitorDisplay.prototype',
            '_getWorkspacesBoxForState'],
        ['WorkspacesView.WorkspacesView.prototype',
            '_getFirstFitAllWorkspaceBox'],
        ['SwitcherPopup.SwitcherPopup.prototype', '_finish'],
    ]) {
        const object = readPath(api, objectPath).value;
        if (!canAssignProperty(object, method))
            missing.add(`${objectPath}.${method}`);
    }

    const panelBox = requirePath(missing, api, 'Main.layoutManager.panelBox');
    if (!canDefineOwnProperty(panelBox, 'height'))
        missing.add('Main.layoutManager.panelBox.height override');
}

/**
 * Inspect the private overview/Dash capabilities that the GNOME 50/51 core
 * integration must have before it mutates the supplied Shell objects.
 *
 * @param {object} api injected GNOME Shell module namespaces
 * @returns {{supported: boolean, missing: string[]}}
 */
export function probeShellCapabilities(api) {
    const missing = new Set();
    const overview = probeCoreShellApi(api ?? {}, missing);
    probeOverviewControls(api ?? {}, overview, missing);

    return {
        supported: missing.size === 0,
        missing: [...missing],
    };
}

function failedProbeReport(error) {
    return {
        supported: false,
        missing: ['shell capability probe'],
        error,
    };
}

/**
 * Execute a mutation only after a successful probe. Probe failures take the
 * same fallback path as missing capabilities.
 *
 * @param {object} api injected GNOME Shell module namespaces
 * @param {Function} onSupported callback allowed to mutate Shell state
 * @param {Function} onUnsupported non-mutating or restoration callback
 * @param {Function} [probe] injectable capability probe
 * @returns {*} the selected callback's result
 */
export function runShellCapabilityGate(api, onSupported, onUnsupported,
    probe = probeShellCapabilities) {
    let report;
    try {
        report = probe(api);
    } catch (error) {
        report = failedProbeReport(error);
    }

    if (!report?.supported)
        return onUnsupported(report ?? failedProbeReport());
    return onSupported(report);
}

export function formatUnsupportedShellMessage(report) {
    const missing = report?.missing?.length
        ? report.missing.join(', ')
        : 'unknown private overview/Dash capability';
    return 'XDock was not enabled because this GNOME Shell is missing ' +
        `required private overview/Dash capabilities: ${missing}. ` +
        'The stock overview Dash remains active. Update XDock before ' +
        'enabling it on this GNOME Shell version.';
}

export class UnsupportedShellError extends Error {
    constructor(report) {
        super(formatUnsupportedShellMessage(report));
        this.name = 'UnsupportedShellError';
        this.report = report;
    }
}
