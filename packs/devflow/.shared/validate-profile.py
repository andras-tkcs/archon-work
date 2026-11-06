#!/usr/bin/env python3
"""Validate the devflow profile (.devflow/devflow.yaml) against profile.schema.json.

    validate-profile.py [PROFILE] [--root DIR] [--resolved] [--no-file-checks]

Exit 0 when valid (warnings go to stderr), 1 with one error per line otherwise. --resolved prints
the profile as JSON with the schema's documented defaults filled in and the ignored keys removed.
The schema is read from this script's directory. Python 3, PyYAML.
See the section "Profile" in packs/devflow/README.md.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

import yaml

SCHEMA = Path(__file__).resolve().parent / "profile.schema.json"
DEFAULT_PROFILE = ".devflow/devflow.yaml"
HELP = 'see the section "Profile" in packs/devflow/README.md'
PREFIX = "devflow.yaml"

# Keys of the retired plugin profile: accepted with a warning and dropped before validation.
RETIRED = {
    ("toolkit",): "ignored: the toolkit is retired",
    ("models",): "ignored: model aliases replace it",
    ("docs", "plan_dir"): "ignored: plans live on the plans branch (see 'plans')",
}
# Every top-level key the profile may have; the schema's top-level properties must be exactly these.
TOP_LEVEL_KEYS = ("version", "project", "docs", "git", "verify", "ci", "stacks", "plans", "project_steward")

_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "integer": int,
}


def _is(value, name: str) -> bool:
    if name in ("integer", "boolean") and isinstance(value, bool):
        return name == "boolean"
    return isinstance(value, _TYPES[name])


def _ref(schema: dict, root: dict) -> dict:
    ref = schema.get("$ref")
    if not ref:
        return schema
    node = root
    for part in ref.removeprefix("#/").split("/"):
        node = node[part]
    return {**node, **{k: v for k, v in schema.items() if k != "$ref"}}


def check(value, schema: dict, root: dict, path: str, errors: list[str]) -> None:
    """Validate the JSON Schema subset the profile schema uses."""
    schema = _ref(schema, root)
    if "oneOf" in schema:
        options = [_ref(s, root) for s in schema["oneOf"]]
        if any(_errs(value, s, root, path) == [] for s in options):
            return
        typed = [s for s in options if "type" in s and _is(value, s["type"])]
        if typed:  # right kind of value, wrong content: report that option's own errors
            check(value, typed[0], root, path, errors)
        else:
            errors.append(f"'{path}': {_describe(options)}")
        return
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"'{path}': must be one of {', '.join(map(str, schema['enum']))} (got {value!r})")
        return
    t = schema.get("type")
    if t and not _is(value, t):
        errors.append(f"'{path}': must be {_article(t)} (got {type(value).__name__})")
        return
    if "const" in schema and value != schema["const"]:
        errors.append(f"'{path}': must be {schema['const']!r} (got {value!r})")
        return
    if t == "integer" and "minimum" in schema and value < schema["minimum"]:
        errors.append(f"'{path}': must be at least {schema['minimum']} (got {value!r})")
    if t == "string" and len(value) < schema.get("minLength", 0):
        errors.append(f"'{path}': must not be empty")
    if t == "array":
        if len(value) < schema.get("minItems", 0):
            errors.append(f"'{path}': needs at least {schema['minItems']} item(s)")
        for i, item in enumerate(value):
            check(item, schema.get("items", {}), root, f"{path}[{i}]", errors)
    if t == "object":
        props = schema.get("properties", {})
        extra = schema.get("additionalProperties")
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"missing required key '{_join(path, key)}'")
        for key, sub in value.items():
            if key in props:
                check(sub, props[key], root, _join(path, str(key)), errors)
            elif extra is False:
                errors.append(f"unknown key '{_join(path, str(key))}' (typo? {HELP})")
            elif isinstance(extra, dict):
                if not isinstance(key, str):
                    errors.append(f"'{_join(path, str(key))}': keys must be strings")
                check(sub, extra, root, _join(path, str(key)), errors)


def _errs(value, schema, root, path) -> list[str]:
    out: list[str] = []
    check(value, schema, root, path, out)
    return out


def _join(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key


def _article(t: str) -> str:
    return {"object": "a mapping", "array": "a list", "string": "a string", "boolean": "true/false",
            "integer": "an integer"}.get(t, t)


def _describe(options: list[dict]) -> str:
    names = [_article(o["type"]) for o in options if "type" in o]
    return "must be " + " or ".join(names)


def apply_defaults(value: dict, schema: dict, root: dict) -> dict:
    """Fill the schema's `default`s for keys that are absent."""
    out = json.loads(json.dumps(value))
    for key, sub in schema.get("properties", {}).items():
        sub = _ref(sub, root)
        if sub.get("type") == "object" and sub.get("properties"):
            if key in out or any("default" in _ref(p, root) for p in sub["properties"].values()):
                out[key] = apply_defaults(out.get(key) or {}, sub, root)
        elif key not in out and "default" in sub:
            out[key] = sub["default"]
    return out


def drop_retired(profile: dict) -> tuple[dict, list[str]]:
    """The profile without the retired keys, and one warning for each that was present."""
    kept = copy.deepcopy(profile)
    warnings: list[str] = []
    for path, why in RETIRED.items():
        parent = kept
        for key in path[:-1]:
            parent = parent.get(key) if isinstance(parent, dict) else None
        if isinstance(parent, dict) and path[-1] in parent:
            del parent[path[-1]]
            warnings.append(f"{'.'.join(path)}: {why}")
    return kept, warnings


def workflow_job_ids(root_dir: Path) -> set[str]:
    jobs: set[str] = set()
    wf = root_dir / ".github" / "workflows"
    if not wf.is_dir():
        return jobs
    for f in sorted([*wf.glob("*.yml"), *wf.glob("*.yaml")]):
        try:
            data = yaml.safe_load(f.read_text())
        except yaml.YAMLError:
            continue
        if isinstance(data, dict) and isinstance(data.get("jobs"), dict):
            jobs.update(str(k) for k in data["jobs"])
    return jobs


def semantic_checks(profile: dict, root_dir: Path | None) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    docs = profile.get("docs", {})
    if ("adr_index" in docs or "adr_bar" in docs) and "adr_dir" not in docs:
        errors.append("'docs.adr_index' / 'docs.adr_bar' need 'docs.adr_dir' (ADRs are used iff adr_dir is set)")
    stacks = profile.get("stacks", [])
    apple = [s for s in ("swift", "ipados") if s in stacks]
    if apple and not profile.get("ci", {}).get("dispatchable"):
        warnings.append(
            f"stack '{apple[0]}' is selected but 'ci.dispatchable' is empty: iOS/iPadOS/macOS builds "
            "and tests cannot run in the container, list a macOS workflow there"
        )
    if "ipados" in stacks and "swift" not in stacks:
        warnings.append("stack 'ipados' builds on 'swift': list both (stacks: [swift, ipados])")
    if root_dir is not None:
        paths = list(docs.get("must_read", []))
        if profile.get("project_steward"):
            paths.append(profile["project_steward"])
        for p in paths:
            if not (root_dir / p.split("#")[0]).exists():
                errors.append(f"file not found: '{p}' (listed in the profile; checked from {root_dir})")
        jobs = profile.get("verify", {}).get("ci_local", {}).get("jobs")
        if isinstance(jobs, list):
            known = workflow_job_ids(root_dir)
            for name in jobs:
                if name not in known:
                    errors.append(
                        f"'verify.ci_local.jobs': no job '{name}' in .github/workflows/*.yml|*.yaml "
                        f"(checked from {root_dir})"
                    )
    return errors, warnings


def validate(profile, root_dir: Path | None = None) -> tuple[list[str], list[str], dict]:
    schema = json.loads(SCHEMA.read_text())
    if set(schema.get("properties", {})) != set(TOP_LEVEL_KEYS):
        raise RuntimeError(f"{SCHEMA}: top-level properties do not match the validator's TOP_LEVEL_KEYS")
    errors: list[str] = []
    if not isinstance(profile, dict):
        return ["the profile must be a YAML mapping"], [], {}
    profile, warnings = drop_retired(profile)
    check(profile, schema, schema, "", errors)
    if errors:
        return errors, [], {}
    resolved = apply_defaults(profile, schema, schema)
    sem_errors, sem_warnings = semantic_checks(resolved, root_dir)
    return sem_errors, warnings + sem_warnings, resolved


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("profile", nargs="?", default=DEFAULT_PROFILE)
    ap.add_argument("--root", help="repo root for file-existence checks (default: the profile's repo root)")
    ap.add_argument("--resolved", action="store_true", help="print the resolved profile as JSON")
    ap.add_argument("--no-file-checks", action="store_true",
                    help="skip checking that listed files and verify.ci_local.jobs exist")
    args = ap.parse_args(argv)

    path = Path(args.profile)
    if not path.is_file():
        print(f"{PREFIX}: no profile at '{path}' ({HELP}).", file=sys.stderr)
        return 1
    try:
        profile = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        print(f"{PREFIX}: not valid YAML: {exc}", file=sys.stderr)
        return 1

    root_dir = None if args.no_file_checks else Path(args.root) if args.root else path.resolve().parent.parent
    errors, warnings, resolved = validate(profile, root_dir)
    for w in warnings:
        print(f"{PREFIX}: warning: {w}", file=sys.stderr)
    if errors:
        for e in errors:
            print(f"{PREFIX}: {e}", file=sys.stderr)
        return 1
    if args.resolved:
        json.dump(resolved, sys.stdout, indent=2)
        print()
    else:
        print(f"{PREFIX}: OK ({path})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
