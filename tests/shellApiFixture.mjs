const method = () => {};

const dashMethods = [
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
];

function prototypeWith(methods) {
    return Object.fromEntries(methods.map(name => [name, method]));
}

export function makeCompatibleShellApi({dummy = false} = {}) {
    function Dash() {}
    Object.assign(Dash.prototype, prototypeWith(dashMethods));

    function AppIcon() {}
    Object.assign(AppIcon.prototype, prototypeWith([
        '_init',
        '_onDestroy',
        '_onKeyboardPopupMenu',
        '_updateDotStyle',
        'activate',
        'shouldShowTooltip',
        'vfunc_leave_event',
        'setForcedHighlight',
        '_onMenuPoppedDown',
    ]));

    function AppSearchProvider() {}
    AppSearchProvider.prototype.createResultObject = method;
    function FolderIcon() {}

    function DashIcon() {}
    DashIcon.prototype._init = method;
    function DashItemContainer() {}
    Object.assign(DashItemContainer.prototype, prototypeWith([
        '_init',
        'setChild',
        'setLabelText',
        'animateOutAndDestroy',
    ]));
    function ShowAppsIcon() {}
    Object.assign(ShowAppsIcon.prototype, prototypeWith([
        '_init',
        '_createIcon',
    ]));

    function AppMenu() {}
    Object.assign(AppMenu.prototype, prototypeWith([
        'open',
        '_getMenuItems',
        '_updateFavoriteItem',
    ]));
    function PopupMenuBase() {}

    function ControlsLayout() {}
    Object.assign(ControlsLayout.prototype, prototypeWith([
        'vfunc_allocate',
        '_computeWorkspacesBoxForState',
        '_getAppDisplayBoxForState',
    ]));

    const stockDash = {
        ...prototypeWith([
            'hide',
            'show',
            'set_height',
            'setMaxSize',
            'allocate',
            'get_preferred_height',
        ]),
        showAppsButton: {},
        _maxHeight: -1,
    };
    const searchController = {
        _showAppsButton: stockDash.showAppsButton,
        _setSearchActive: method,
    };
    const layout = new ControlsLayout();
    Object.assign(layout, {
        _dash: stockDash,
        _searchEntry: {},
        _workspacesThumbnails: {},
        _searchController: searchController,
        _runPostAllocation: method,
    });
    const controls = {
        dash: stockDash,
        _searchEntry: {get_allocation_box: method},
        _thumbnailsBox: {shouldShow: false},
        _searchController: searchController,
        _stateAdjustment: {value: 0},
        _onShowAppsButtonToggled: method,
        appDisplay: {getAllItems: method},
        layout_manager: layout,
    };

    function Overview() {}
    Object.defineProperty(Overview.prototype, 'dash', {
        get() {
            return this._stockDash;
        },
    });
    const overview = Object.assign(new Overview(), {
        _stockDash: stockDash,
        _overview: dummy ? null : {controls},
        isDummy: dummy,
        visible: false,
        visibleTarget: false,
        animationInProgress: false,
        connect: method,
        disconnect: method,
        show: method,
        hide: method,
        toggle: method,
        shouldToggleByCornerOrButton: method,
    });

    function SecondaryMonitorDisplay() {}
    SecondaryMonitorDisplay.prototype._getWorkspacesBoxForState = method;
    function WorkspacesView() {}
    WorkspacesView.prototype._getFirstFitAllWorkspaceBox = method;
    function WorkspaceBackground() {}
    WorkspaceBackground.prototype.vfunc_allocate = method;
    function SwitcherPopup() {}
    SwitcherPopup.prototype._finish = method;

    return {
        AppDisplay: {AppIcon, AppSearchProvider, FolderIcon},
        AppMenu: {AppMenu},
        Dash: {
            Dash,
            DashIcon,
            DashItemContainer,
            ShowAppsIcon,
        },
        Main: {
            initializeDeferredWork: method,
            queueDeferredWork: method,
            layoutManager: {
                _queueUpdateRegions: method,
                _startingUp: false,
                addChrome: method,
                removeChrome: method,
                untrackChrome: method,
                findIndexForActor: method,
                findMonitorForActor: method,
                getWorkAreaForMonitor: method,
                panelBox: {},
                monitors: [],
                primaryIndex: 0,
                primaryMonitor: null,
            },
            overview,
            sessionMode: {
                currentMode: 'user',
                hasOverview: !dummy,
            },
        },
        OverviewControls: {
            ControlsState: {
                HIDDEN: 0,
                WINDOW_PICKER: 1,
                APP_GRID: 2,
            },
        },
        PopupMenu: {PopupMenuBase},
        SwitcherPopup: {SwitcherPopup},
        Workspace: {WorkspaceBackground},
        WorkspacesView: {SecondaryMonitorDisplay, WorkspacesView},
    };
}
