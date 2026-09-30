#!/usr/bin/env python3
"""Check new public text and paths without printing potentially private values."""
from pathlib import Path
import os
import re
import subprocess
import sys

# Example domains, loopback endpoints and package maintainer contacts belong in
# product documentation; real deployment identities and personal paths do not.
RULES = {
    "personal home path": re.compile(r"(?:/Users/|/home/)(?!demo\b|example\b|user\b|runner\b|test\b|alice\b|bob\b)[a-zA-Z0-9_.-]+"),
    "private repository URL": re.compile(r"(?:https?://|git@)(?:gitlab\.(?!com\b)[\w.-]+|git\.(?!github\.|example\.)[\w.-]+)"),
    "internal tracker reference": re.compile(r"\bOP#\d+\b"),
    "private network address": re.compile(r"(?<![\w.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})(?![\w.])"),
    # Reserved domains (RFC 2606/6761) and GitHub noreply addresses are not people.
    "e-mail address": re.compile(r"\b[A-Za-z0-9._%+-]+@(?!(?:users\.noreply\.github\.com|example\.(?:com|org|net)|[A-Za-z0-9.-]*\.?(?:invalid|test|example|localhost))(?=$|[^A-Za-z0-9.-]))[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "merge request reference": re.compile(r"(?<![\w!=])!\d+\b|\b[a-z0-9][a-z0-9_.-]*!\d+\b"),
}

# Exact public strings the rules above would otherwise flag. A match is allowed
# only where one of these covers it on the same line, so an entry never
# exempts anything but itself.
ALLOWED = (
    # The extension's UUID, the Debian maintainer, and GNOME Shell's source,
    # credited in NOTICE.
    'xdock@spencercnorton.github.io',
    'apt@globalentry.systems',
    'https://gitlab.gnome.org/GNOME/gnome-shell',
    # Dash to Dock at 248d42bb64c5e4d21203562f2ef68baf8c9ff083, as this tree
    # keeps it, generated from that commit: GNOME and other upstream URLs, GNOME
    # merge requests, a translation tool's version, the logo author's export
    # path, a catalogue's file name, and the addresses of translators, of the
    # BSD notice and of the lint config's SPDX line, and other extensions' UUIDs.
    '/home/michele/Dropbox/lavori/gnome-shell-extension/icon/g5218.png',
    'GNOME/gnome-shell!1892',
    'https://git.gnome.org/browse/gnome-shell/commit/?id=447bf55e45b00426ed908b1b1035f472c2466956',
    'https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/43.0/data/theme/gnome-shell-sass/_colors.scss',
    'https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/43.0/data/theme/gnome-shell-sass/_common.scss#L28',
    'https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/43.0/data/theme/gnome-shell-sass/widgets/_dash.scss',
    'https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/dash.js',
    'https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/2890',
    'https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/2047',
    'MR !1245',
    'Poedit 1.8.7.1',
    'sr@latin.po',
    '1132321739qq@gmail.com',
    '1403122061@qq.com',
    '19842332557@163.com',
    'amribrahim1987@hotmail.com',
    'anders.jonsson@norsjovallen.se',
    'baurthefirst@gmail.com',
    'byoungchan.lee@gmx.com',
    'carlos.spohr@gmail.com',
    'chamfay@gmail.com',
    'claudioandre.br@gmail.com',
    'correo@xmgz.eu',
    'cyigitsahin@outlook.com',
    'debonne.hooties@gmail.com',
    'desktop-scroller@obsidien.github.com',
    'dirosissaias@cosmotemail.gr',
    'eriks@remess.lv',
    'fnogueira@gnome.org',
    'gnome-si@googlegroups.com',
    'gnome-turk@gnome.org',
    'gnomefr@traduc.org',
    'grillinicolavocal@gmail.com',
    'harald@fsfe.org',
    'hasecilu@tuta.io',
    'hey@morrisjobke.de',
    'hugokarvalho@hotmail.com',
    'hugolabe@gmail.com',
    'ibaios@disroot.org',
    'iramosu@protonmail.com',
    'irenee.thirion@e.email',
    'jiri.doubravsky@gmail.com',
    'jmatsuzawa@gnome.org',
    'jonatan_zeidler@gmx.de',
    'jonatan_zeidler@hotmail.de',
    'jose1711@gmail.com',
    'kde-i18n-doc@kde.org',
    'kk_KZ@googlegroups.com',
    'libreajans@gmail.com',
    'lishaohui.qd@163.com',
    'lucaslucasfank@gmail.com',
    'mail@asciiwolf.com',
    'mateju@src.gnome.org',
    'milo@milo.name',
    'morgan.antonsson@gmail.com',
    'mreditor@mail.ru',
    'mustafa.akgun@gmail.com',
    'Opacify@gnome-shell.localdomain.pl',
    'papava.e@gtu.ge',
    'prescott66@gmail.com',
    'proninyaroslav@mail.ru',
    'psokol.l10n@gmail.com',
    'pswo10680@gmail.com',
    'rajatjain01970@gmail.com',
    'rastersoft@gmail.com',
    'ronaldocosta@oceanica.ufrj.br',
    'ryonakaknock3@gmail.com',
    'saikinmirai@gmail.com',
    'skarmoutsosv@gmail.com',
    'teknomobil@yandex.com',
    'translation@sicklylife.jp',
    'ubuntu-dock@ubuntu.com',
    'vantu5z@mail.ru',
    'vincent_chatelain@proton.me',
    'vistausss@outlook.com',
    'vuki03@mail.ru',
    'Xabre@archlinux.info',
    'xalt7x.service@gmail.com',
    'yakushabb@gmail.com',
    'yudi.al@gmail.com',
)

FORBIDDEN = re.compile(r"(?:^|/)(?:AGENTS/(?:journal|journal-archive).*|credentials|\.env(?:\.(?!example$)[^/]+)?|id_(?:rsa|ed25519)|[^/]+\.(?:sqlite3?|db|key|p12|pfx|log))$")

def git(*args):
    return subprocess.check_output(["git", *args])

def findings(line):
    """Names of the rules that match text on this line outside ALLOWED."""
    spans = [(m.start(), m.end()) for literal in ALLOWED
             for m in re.finditer(re.escape(literal), line)]
    for label, pattern in RULES.items():
        for m in pattern.finditer(line):
            if not any(s <= m.start() and m.end() <= e for s, e in spans):
                yield label

def main():
    base = os.environ.get("BASE_SHA", "")
    if base and set(base) != {"0"}:
        # An invalid base must fail closed rather than skip inspection.
        git("cat-file", "-e", base + "^{commit}")
    else:
        # A repository's first commit has no parent: all of it is new content,
        # so compare it with the empty tree rather than failing or skipping.
        parents = git("rev-list", "--parents", "-n", "1", "HEAD").decode().split()[1:]
        base = parents[0] if parents else git("hash-object", "-t", "tree", "/dev/null").decode().strip()
    paths = git("diff", "--name-only", "--diff-filter=ACMR", "-z", base, "HEAD").decode().split("\0")
    failures = []
    for name in filter(None, paths):
        path = Path(name)
        if FORBIDDEN.search(name):
            failures.append((name, "private file path"))
        if path.is_symlink():
            failures.append((name, "symlink requires explicit review"))
            continue
        # Binary pixels need visual review; their metadata and secrets remain
        # covered by the secret scanner and the review checklist.
        data = path.read_bytes()
        if b"\0" in data:
            if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".gif", ".mp4", ".ico", ".icns"}:
                failures.append((name, "binary requires explicit policy review"))
            continue
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            continue
        patch = git("diff", "--unified=0", base, "HEAD", "--", name).decode("utf-8", errors="replace")
        added = [line[1:] for line in patch.splitlines() if line.startswith("+") and not line.startswith("+++")]
        for label in sorted({label for line in added for label in findings(line)}):
            failures.append((name, label))
    for name, label in failures:
        print(f"{name}: {label}; review locally, do not paste the matched value")
    print(f"Public-content check: {len(failures)} finding(s)")
    return bool(failures)

if __name__ == "__main__":
    sys.exit(main())
