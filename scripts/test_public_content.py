#!/usr/bin/env python3
"""Behavior checks for the public content gate in isolated Git repositories."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCANNER = Path(__file__).with_name("check_public_content.py").resolve()

class PublicContentTests(unittest.TestCase):
    def check_change(self, name, content, *, symlink=False):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=p, stderr=subprocess.DEVNULL).decode().strip()
            git("init", "-q")
            git("config", "user.name", "Demo")
            git("config", "user.email", "demo@example.com")
            (p / "README.md").write_text("Public example\n")
            git("add", ".")
            git("commit", "-qm", "baseline")
            base = git("rev-parse", "HEAD")
            target = p / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if symlink:
                target.symlink_to("README.md")
            elif isinstance(content, bytes):
                target.write_bytes(content)
            else:
                target.write_text(content)
            git("add", ".")
            git("commit", "-qm", "change")
            env = dict(os.environ, BASE_SHA=base)
            return subprocess.run(["python3", str(SCANNER)], cwd=p, env=env, capture_output=True, text=True)

    def test_public_examples_pass(self):
        self.assertEqual(self.check_change("docs/setup.md", "Use http://localhost:8409 and demo@example.com\n").returncode, 0)

    def test_environment_file_is_blocked(self):
        self.assertNotEqual(self.check_change(".env", "MODE=demo\n").returncode, 0)

    def test_personal_path_is_blocked_without_echoing_value(self):
        private = "/home/" + "private-person/notes"
        result = self.check_change("docs/setup.md", private)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(private, result.stdout)

    def test_internal_tracker_reference_is_blocked(self):
        self.assertNotEqual(self.check_change("docs/setup.md", "OP" + "#1234").returncode, 0)

    def test_private_address_is_blocked(self):
        self.assertNotEqual(self.check_change("docs/setup.md", "192." + "168.17.42").returncode, 0)

    def test_symlink_is_blocked(self):
        self.assertNotEqual(self.check_change("linked", "", symlink=True).returncode, 0)

    def test_binary_archive_is_blocked(self):
        self.assertNotEqual(self.check_change("backup.zip", b"PK\x00\x01").returncode, 0)

    def test_first_commit_is_checked_whole(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            def git(*args):
                subprocess.check_output(["git", *args], cwd=p, stderr=subprocess.DEVNULL)
            git("init", "-q")
            git("config", "user.name", "Demo")
            git("config", "user.email", "demo@example.com")
            (p / "notes.md").write_text("OP" + "#1234\n")
            git("add", ".")
            git("commit", "-qm", "first")
            env = {k: v for k, v in os.environ.items() if k != "BASE_SHA"}
            result = subprocess.run(["python3", str(SCANNER)], cwd=p, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("notes.md", result.stdout)

    def test_gnome_attribution_url_passes(self):
        url = "https://gitlab." + "gnome.org/GNOME/gnome-shell"
        self.assertEqual(self.check_change("NOTICE", f"Adapted from {url}, GPL-2.0-or-later.\n").returncode, 0)

    def test_other_gitlab_urls_are_still_blocked(self):
        for url in ("https://gitlab." + "gnome.org/GNOME/other-project",
                    "https://gitlab." + "example.net/GNOME/gnome-shell"):
            self.assertNotEqual(self.check_change("NOTICE", url + "\n").returncode, 0, url)

    def test_email_address_is_blocked(self):
        self.assertNotEqual(self.check_change("po/xx.po", "# Someone <someone" + "@" + "mail.example.net>\n").returncode, 0)

    def test_upstream_translator_address_passes(self):
        self.assertEqual(self.check_change("po/sl.po", "# Translator <" + "mateju@src.gnome.org>, 2025.\n").returncode, 0)

    def test_allowed_address_does_not_cover_a_longer_one(self):
        longer = "x.mateju" + "@" + "src.gnome.org.mail.example.net"
        self.assertNotEqual(self.check_change("po/sl.po", f"# <{longer}>\n").returncode, 0)

    def test_merge_request_reference_is_blocked(self):
        for text in ("Fixed in !" + "12", "see xdock!" + "7"):
            self.assertNotEqual(self.check_change("appIcons.js", f"// {text}\n").returncode, 0, text)

    def test_upstream_gnome_merge_request_passes(self):
        self.assertEqual(self.check_change("docking.js", "// See GNOME/gnome-shell!" + "1892\n").returncode, 0)

    def test_example_environment_file_passes(self):
        self.assertEqual(self.check_change(".env.example", "MODE=demo\n").returncode, 0)

if __name__ == "__main__":
    unittest.main()
