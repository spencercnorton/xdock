#!/usr/bin/env bash
# Build the release assets from this tree: the extension zip that
# `gnome-extensions install` takes (with its compiled schema, which a per-user
# install needs), and a Debian package that installs the extension
# system-wide, with its schema and translations in the system directories.
# Reproducible under SOURCE_DATE_EPOCH.
#   scripts/build.sh [out-dir]      (default: dist/)
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out=$(realpath -m "${1:-$root/dist}")
pkg=gnome-shell-extension-xdock
field() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$root/metadata.json" "$1"; }
version=$(field version-name)
uuid=$(field uuid)
stamp=${SOURCE_DATE_EPOCH:-$(git -C "$root" log -1 --format=%ct 2>/dev/null || date +%s)}
export SOURCE_DATE_EPOCH="$stamp"
mkdir -p "$out"

# The zip holds the tree `make install` would install, from `make _build`.
make -C "$root" --no-print-directory -s _build
find "$root/_build" -exec touch -h -d "@$stamp" {} +
rm -f "$out/xdock.shell-extension.zip"
(cd "$root/_build" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | TZ=UTC zip -qX "$out/xdock.shell-extension.zip" -@)

(cd "$root" && dpkg-buildpackage -us -uc -b)
# No grep -q below: it exits at the first match, dpkg-deb dies of SIGPIPE, and
# pipefail turns a good package into a failed build.
mv "$root/../${pkg}_${version}_all.deb" "$out/"
rm -f "$root/../${pkg}_${version}"_*.buildinfo "$root/../${pkg}_${version}"_*.changes
dpkg-deb -c "$out/${pkg}_${version}_all.deb" | grep -F "usr/share/gnome-shell/extensions/$uuid/extension.js" >/dev/null
dpkg-deb -c "$out/${pkg}_${version}_all.deb" | grep -F "usr/share/glib-2.0/schemas/org.gnome.shell.extensions.xdock.gschema.xml" >/dev/null
dpkg-deb -c "$out/${pkg}_${version}_all.deb" | grep -F "usr/share/locale/de/LC_MESSAGES/xdock.mo" >/dev/null
ls -l "$out"
