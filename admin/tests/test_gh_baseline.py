import copy
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, "admin", "gh-baseline.py")
EXAMPLE = os.path.join(ROOT, "admin", "policy.example.json")
SNAPSHOT = os.path.join(ROOT, "admin", "tests", "fixtures", "snapshot-repo.json")
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


def example():
    with open(EXAMPLE) as fh:
        return json.load(fh)


class PolicyTest(unittest.TestCase):
    def audit(self, policy, *extra):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "policy.json")
            with open(path, "w") as fh:
                json.dump(policy, fh)
            return run_cli("audit", "--snapshot", SNAPSHOT, "--policy", path, *extra)

    def assert_policy_error(self, policy, message):
        p = self.audit(policy)
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertIn(f"policy error: {message}", p.stderr)

    def test_example_policy_loads(self):
        P = gb.load_policy(EXAMPLE)
        self.assertEqual(len(P["checks"]), 46)

    def test_unreadable_file(self):
        p = run_cli("audit", "--snapshot", SNAPSHOT, "--policy", "/nonexistent/policy.json")
        self.assertEqual(p.returncode, 2)
        self.assertIn("policy error: cannot read /nonexistent/policy.json", p.stderr)

    def test_non_json_file(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "p.json")
            with open(path, "w") as fh:
                fh.write("{not json")
            p = run_cli("audit", "--snapshot", SNAPSHOT, "--policy", path)
        self.assertEqual(p.returncode, 2)
        self.assertIn(f"policy error: cannot read {path}", p.stderr)

    def test_bad_version(self):
        P = example()
        P["version"] = 2
        self.assert_policy_error(P, "version must be 1")

    def test_unknown_id_in_checks(self):
        P = example()
        P["checks"]["X-99"] = {"severity": "low", "title": "x", "enabled": True}
        self.assert_policy_error(P, "unknown check id: X-99")

    def test_unknown_id_in_suppress(self):
        P = example()
        P["suppress"].append({"check": "X-98", "target": "*", "reason": "x"})
        self.assert_policy_error(P, "unknown check id: X-98")

    def test_missing_id(self):
        P = example()
        del P["checks"]["O-03"]
        self.assert_policy_error(P, "checks is missing O-03")

    def test_bad_severity(self):
        P = example()
        P["checks"]["O-03"]["severity"] = "critical"
        self.assert_policy_error(P, "bad severity for O-03: critical")

    def test_missing_read_key(self):
        P = example()
        del P["actions"]["allowlist"]
        self.assert_policy_error(P, "missing key: actions.allowlist")

    def findings(self, policy):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "out.json")
            p = self.audit(policy, "--json", out)
            self.assertIn(p.returncode, (0, 1), p.stderr)
            with open(out) as fh:
                return {f["id"]: f for f in json.load(fh)["findings"]}

    def test_disabled_check_not_reported(self):
        self.assertIn("R-FILE-01", self.findings(example()))
        P = example()
        P["checks"]["R-FILE-01"]["enabled"] = False
        self.assertNotIn("R-FILE-01", self.findings(P))

    def test_severity_from_policy(self):
        P = example()
        P["checks"]["R-FILE-01"]["severity"] = "info"
        self.assertEqual(self.findings(P)["R-FILE-01"]["severity"], "info")

    def test_audit_fixture_runs(self):
        p = self.audit(example())
        self.assertIn(p.returncode, (0, 1), p.stderr)


if __name__ == "__main__":
    unittest.main()
