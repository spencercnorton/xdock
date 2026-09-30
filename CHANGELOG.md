# Changelog

All notable changes to XDock are documented here.

## 2.0.0 — 2026-09-30

The first public release, on Dash to Dock at `248d42b`.

- A launcher popup for the Applications button: most-used apps, search as you type, an *All Apps* view, and system actions for Settings, locking, logging out, restarting and powering off.
- Drawers in the launcher's sidebar, stored as GNOME app folders: create, delete, reorder by dragging, and file apps by dragging them onto a drawer.
- Dock motion: hover lift, press feedback, a hop when an app starts, a bounce for apps that need attention, and a dock slide that reverses from wherever it is.
- A blur behind the dock where its background is translucent, drawn by XDock itself and rounded to the dock's corners when GNOME Rounded Blur is installed. It is on by default, with a switch in the preferences.
- GNOME Shell 50 only. Dash to Dock also lists 45 to 49; XDock is not tested there, so it does not claim them.
- Preferences rebuilt on libadwaita.
- The UUID is `xdock@spencercnorton.github.io`. The settings schema, `org.gnome.shell.extensions.xdock`, and the gettext domain, `xdock`, are unchanged, so existing settings carry over.
- The About page shows the Dash to Dock logo with the XDock name and Michele Gaio's credit on it.
- Releases carry a zip for `gnome-extensions install` and a Debian package for Ubuntu 26.04, and `make install` installs from a checkout.
