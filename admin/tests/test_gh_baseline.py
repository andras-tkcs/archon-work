import importlib.util
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, "admin", "gh-baseline.py")
FAKE_GH = os.path.join(ROOT, "admin", "tests", "fixtures", "fake-gh")

spec = importlib.util.spec_from_file_location("gh_baseline", SCRIPT)
gb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gb)


def run_cli(*args):
    env = dict(os.environ, GH_BIN=FAKE_GH)
    return subprocess.run([sys.executable, SCRIPT, *args], env=env, capture_output=True, text=True)


class GhBaselineTest(unittest.TestCase):
    def test_help_lists_subcommands(self):
        p = run_cli("--help")
        self.assertEqual(p.returncode, 0)
        for word in ("snapshot", "audit", "apply"):
            self.assertIn(word, p.stdout)

    def test_audit_without_policy_exits_2(self):
        p = run_cli("audit", "OWNER/REPO")
        self.assertEqual(p.returncode, 2)

    def test_analyze_workflow_returns_uses(self):
        r = gb.analyze_workflow("steps:\n  - uses: actions/checkout@v4\n")
        self.assertEqual(r["uses"], ["actions/checkout@v4"])

    def test_not_bad_and_ok_differ(self):
        self.assertTrue(gb.not_bad(None))
        self.assertFalse(gb.ok(None))


if __name__ == "__main__":
    unittest.main()
