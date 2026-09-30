// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

/**
 * GNOME Shell 51 changed PopupMenu.open()/close() from an animation enum to a
 * parameter object. Keep version parsing pure so both sides remain testable.
 *
 * @param {string} packageVersion GNOME Shell package version
 * @param {boolean} capabilityDetected whether the running PopupMenu prototype
 * exposes the parameter-object conversion hook
 * @returns {boolean} whether PopupMenu expects a parameter object
 */
export function usesPopupMenuParameterObject(
    packageVersion, capabilityDetected = false) {
    if (capabilityDetected)
        return true;

    const major = Number.parseInt(packageVersion, 10);
    return Number.isFinite(major) && major >= 51;
}
