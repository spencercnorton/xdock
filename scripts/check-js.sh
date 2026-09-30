#!/usr/bin/env bash

set -euo pipefail

root=${1:-.}
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf -- "$tmp_dir"' EXIT HUP INT TERM

# Node 18 treats .js as CommonJS unless a package.json declares ESM. GNOME
# Shell extensions are ESM but do not ship package.json, so parse each module
# through stdin with the module grammar explicitly selected. Capture find's
# output before the loop so traversal errors cannot be hidden by a pipeline.
if ! find "$root" \
    -path '*/.git' -prune -o \
    -path '*/_build' -prune -o \
    -path '*/debian' -prune -o \
    -path '*/node_modules' -prune -o \
    -path '*/.npm' -prune -o \
    -type f -name '*.js' -print0 > "$tmp_dir/sources"; then
    printf 'Unable to enumerate JavaScript sources: %s\n' "$root" >&2
    exit 1
fi

while IFS= read -r -d '' source; do
    if ! node --input-type=module --check < "$source"; then
        printf 'JavaScript parse failed: %s\n' "$source" >&2
        exit 1
    fi
done < "$tmp_dir/sources"

node "$script_dir/check-import-closure.mjs" "$root"
