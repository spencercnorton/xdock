// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {DockManager} from './docking.js';
import {Extension} from './dependencies/shell/extensions/extension.js';

// We export this so it can be accessed by other extensions
export let dockManager;

export default class XDockExtension extends Extension.Extension {
    enable() {
        const manager = new DockManager(this, {
            onFailClosed: failedManager => {
                // A runtime capability loss destroys its manager before GNOME
                // calls disable(). Do not leave the exported integration point
                // referring to that destroyed object in the meantime.
                if (dockManager === failedManager)
                    dockManager = null;
            },
        });
        dockManager = manager;
    }

    disable() {
        const manager = dockManager;
        try {
            manager?.destroy();
        } finally {
            // Keep the exported manager available to normal destroy callbacks,
            // matching the extension's historical disable semantics.
            if (dockManager === manager)
                dockManager = null;
        }
    }
}
