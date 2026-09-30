# Basic Makefile

UUID = xdock@spencercnorton.github.io
BASE_MODULES = metadata.json \
               COPYING \
               README.md \
               $(NULL)

# Every JavaScript file at the top level is part of the extension.
EXTRA_MODULES = $(sort $(wildcard *.js))

EXTRA_MEDIA = logo.svg \
              glossy.svg \
              highlight_stacked_bg.svg \
              highlight_stacked_bg_h.svg \
              $(NULL)

MSGSRC = $(wildcard po/*.po)
ifeq ($(strip $(DESTDIR)),)
	INSTALLTYPE = local
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
	INSTALLTYPE = system
	SHARE_PREFIX = $(DESTDIR)/usr/share
	INSTALLBASE = $(SHARE_PREFIX)/gnome-shell/extensions
endif

all: extension

clean:
	rm -f ./schemas/gschemas.compiled
	rm -f stylesheet.css
	rm -f ./po/*.mo
	rm -rf _build

extension: ./schemas/gschemas.compiled ./stylesheet.css $(MSGSRC:.po=.mo)

./schemas/gschemas.compiled: ./schemas/org.gnome.shell.extensions.xdock.gschema.xml
	glib-compile-schemas ./schemas/

potfile: ./po/xdock.pot

mergepo: potfile
	for l in $(MSGSRC); do \
		msgmerge -U $$l ./po/xdock.pot; \
	done;

./po/xdock.pot: ./po/POTFILES.in
	xgettext --keyword=__ --keyword=N__ --add-comments='Translators:' -o po/xdock.pot --package-name "XDock" --from-code=utf-8 --files-from=$<

./po/%.mo: ./po/%.po
	msgfmt -c $< -o $@

./stylesheet.css: ./_stylesheet.scss
ifeq ($(SASS), ruby)
	sass --sourcemap=none --no-cache --scss _stylesheet.scss stylesheet.css
else ifeq ($(SASS), dart)
	sass --no-source-map _stylesheet.scss stylesheet.css
else ifeq ($(SASS), sassc)
	sassc --omit-map-comment _stylesheet.scss stylesheet.css
else
	sassc --omit-map-comment _stylesheet.scss stylesheet.css
endif

install: install-local

install-local: _build
	rm -rf $(INSTALLBASE)/$(UUID)
	mkdir -p $(INSTALLBASE)/$(UUID)
	cp -r ./_build/* $(INSTALLBASE)/$(UUID)/
ifeq ($(INSTALLTYPE),system)
	# system-wide settings and locale files
	rm -r $(INSTALLBASE)/$(UUID)/schemas $(INSTALLBASE)/$(UUID)/locale
	mkdir -p $(SHARE_PREFIX)/glib-2.0/schemas $(SHARE_PREFIX)/locale
	cp -r ./schemas/*.gschema.xml $(SHARE_PREFIX)/glib-2.0/schemas
	cp -r ./_build/locale/* $(SHARE_PREFIX)/locale
endif
	-rm -fR _build
	echo done

uninstall remove:
	rm -rf $(INSTALLBASE)/$(UUID)

# The extension tree, as the release zip and `make install` ship it. The
# compiled schema lets a per-user install find its settings.
_build: all
	-rm -fR ./_build
	mkdir -p _build
	cp $(BASE_MODULES) $(EXTRA_MODULES) _build
	cp -a dependencies _build
	cp stylesheet.css _build
	mkdir -p _build/media
	cd media ; cp $(EXTRA_MEDIA) ../_build/media/
	mkdir -p _build/schemas
	cp schemas/*.gschema.xml schemas/gschemas.compiled _build/schemas/
	mkdir -p _build/locale
	for l in $(MSGSRC:.po=.mo) ; do \
		lf=_build/locale/`basename $$l .mo`; \
		mkdir -p $$lf; \
		mkdir -p $$lf/LC_MESSAGES; \
		cp $$l $$lf/LC_MESSAGES/xdock.mo; \
	done;

ifeq ($(strip $(ESLINT)),)
    ESLINT = eslint
endif

ifneq ($(strip $(ESLINT_TAP)),)
    ESLINT_ARGS = -f tap
endif

check: test
	ESLINT_USE_FLAT_CONFIG=false $(ESLINT) $(ESLINT_ARGS) .

check-js:
	./scripts/check-js.sh .

check-schema:
	glib-compile-schemas --strict --dry-run ./schemas/

check-translations:
	./scripts/check-translations.sh

test:
	node --test tests/*.test.mjs

GJS_TESTS = $(sort $(wildcard tests/*.gjs.mjs))

test-gjs:
	@test -n "$(GJS_TESTS)" || { \
		echo "no GJS test harnesses found" >&2; \
		exit 1; \
	}
	@if command -v gjs >/dev/null 2>&1; then \
		set -e; \
		for test_file in $(GJS_TESTS); do \
			gjs -m "$$test_file"; \
		done; \
	elif test "$(REQUIRE_GJS)" = 1; then \
		echo "gjs is required for this verification run" >&2; \
		exit 1; \
	else \
		echo "gjs not installed; skipping GJS fault injection"; \
	fi

verify: check check-js check-schema check-translations extension test test-gjs

.PHONY: all clean extension potfile mergepo install install-local uninstall \
	remove _build check check-js check-schema check-translations test \
	test-gjs verify
