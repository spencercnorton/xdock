#!/usr/bin/env bash
# A still screen must not be repainted. Starts a headless GNOME Shell 50 with
# XDock and a probe extension that counts the frames painted while nothing
# changes, and fails if there were any. It runs on a private session bus in a
# throwaway home, so the desktop it is started from is left alone.
#   tests/shell/idle-frames.sh <extension directory or zip>
# e.g. `make _build && tests/shell/idle-frames.sh _build`
set -euo pipefail
extension=$(realpath "$1")
probe=$(cd "$(dirname "$0")" && pwd)/idle-frames@xdock.test
home=$(mktemp -d)
trap 'rm -rf "$home"' EXIT
export HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_DATA_HOME="$home/data" \
    XDG_CACHE_HOME="$home/cache" XDG_STATE_HOME="$home/state" \
    XDG_RUNTIME_DIR="$home/run" XDG_CURRENT_DESKTOP=GNOME
mkdir -m 0700 "$XDG_RUNTIME_DIR"
installed="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$installed/xdock@spencercnorton.github.io"
if [ -d "$extension" ]; then
    cp -r "$extension/." "$installed/xdock@spencercnorton.github.io/"
else
    unzip -q "$extension" -d "$installed/xdock@spencercnorton.github.io"
fi
cp -r "$probe" "$installed/"

log="$home/shell.log"
# shellcheck disable=SC2016 # expanded by the inner shell
dbus-run-session -- bash -c '
    gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"
    gsettings set org.gnome.shell enabled-extensions \
        "[\"xdock@spencercnorton.github.io\", \"idle-frames@xdock.test\"]"
    gnome-shell --headless --wayland --virtual-monitor 1280x800 > "$1" 2>&1 &
    shell=$!
    for _ in $(seq 180); do
        grep -q "IDLE-FRAMES done" "$1" && break
        kill -0 "$shell" 2>/dev/null || break
        sleep 1
    done
    kill "$shell" 2>/dev/null
    wait
' bash "$log" || true

if ! grep -q "IDLE-FRAMES done" "$log"; then
    tail -n 40 "$log"
    echo "GNOME Shell did not finish the run" >&2
    exit 1
fi
grep "IDLE-FRAMES" "$log" | sed 's/.*IDLE-FRAMES //'
grep -q "IDLE-FRAMES result: pass" "$log"
