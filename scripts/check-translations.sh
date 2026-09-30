#!/bin/sh

set -eu

potfiles=po/POTFILES.in
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

while IFS= read -r source; do
    case "$source" in
        ''|'#'*) continue ;;
    esac

    if ! test -f "$source"; then
        printf 'POTFILES.in references missing source: %s\n' "$source" >&2
        exit 1
    fi
done < "$potfiles"

# Fail when a root extension module starts using our gettext aliases without
# being added to POTFILES.in. Extra listed files are allowed: they may contain
# translator comments or acquire strings again in an upstream update.
for source_path in ./*.js; do
    source=${source_path#./}
    if grep -Eq '(__|N__)\(' "$source" && ! grep -Fxq "$source" "$potfiles"; then
        printf 'Translatable source missing from POTFILES.in: %s\n' "$source" >&2
        exit 1
    fi
done

xgettext --keyword=__ --keyword=N__ --add-comments='Translators:' \
    --package-name='XDock' --from-code=utf-8 \
    --files-from="$potfiles" --output="$tmp_dir/xdock.pot"
test -s "$tmp_dir/xdock.pot"

metadata_domain=$(node -e '
    const fs = require("fs");
    process.stdout.write(JSON.parse(fs.readFileSync("metadata.json"))["gettext-domain"]);
')
if ! grep -Fq "<schemalist gettext-domain=\"$metadata_domain\">" \
    schemas/org.gnome.shell.extensions.xdock.gschema.xml; then
    printf 'GSettings and metadata gettext domains differ\n' >&2
    exit 1
fi

for catalog in po/*.po; do
    msgfmt -c "$catalog" -o /dev/null
    if ! awk '
        /^msgid "/ {
            brand = index($0, "XDock") > 0
            next
        }
        brand && /^msgstr(\[[0-9]+\])? "/ {
            if (index($0, "XDock") == 0)
                exit 1
            brand = 0
        }
    ' "$catalog"; then
        printf 'XDock brand token was translated away in %s\n' "$catalog" >&2
        exit 1
    fi
done
