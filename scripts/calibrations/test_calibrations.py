#!/usr/bin/env python3
"""Tests + dogfood for the calibrations.py write surface (work-97 / idea-356 part 1).

Run: python3 scripts/calibrations/test_calibrations.py
Exit non-zero on any failure (CI-usable).
"""
from __future__ import annotations

import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import calibrations as cal  # noqa: E402  the module under test

REAL_LEDGER = HERE.parents[1] / "docs" / "calibrations.yaml"

_passed = 0
_failed = 0


def check(cond: bool, msg: str) -> None:
    global _passed, _failed
    if cond:
        _passed += 1
    else:
        _failed += 1
        print(f"  FAIL: {msg}")


def with_ledger(text: str) -> Path:
    fd, path = tempfile.mkstemp(suffix=".yaml")
    os.close(fd)
    Path(path).write_text(text)
    os.environ["CALIBRATIONS_LEDGER"] = path
    return Path(path)


def ns(**kw) -> types.SimpleNamespace:
    base = dict(cls=None, title=None, origin=None, status=None, surfaced_at=None,
                closure_mechanism=None, closure_pr=None, pattern_membership=None,
                cross_ref=None, axiom=None)
    base.update(kw)
    return types.SimpleNamespace(**base)


MINIMAL = """schema_version: 1

# calibrations[] schema comment (must survive an add)
calibrations:
  - id: 1
    class: methodology
    title: "seed"
    origin: mission-0
    status: open

# patterns[] schema comment (must survive an add)
patterns:
  - id: seed-pattern
    title: "seed"
    origin: mission-0
    description: |
      seed
    surfaced_by_calibrations:
      - 1
"""

# 1. DOGFOOD: validate PASSES on the REAL ledger (the validator agrees with the known-good hand-file).
os.environ["CALIBRATIONS_LEDGER"] = str(REAL_LEDGER)
errs = cal._validate_doc(cal._load())
check(errs == [], f"validate must PASS on the real ledger; got {len(errs)}: {errs[:3]}")

# 2. mechanical monotonic id (max+1 over gaps).
check(cal._next_id({"calibrations": [{"id": 1}, {"id": 5}, {"id": 88}]}) == 89, "next id = max+1 over gaps")
check(cal._next_id({"calibrations": []}) == 1, "next id = 1 on an empty ledger")

# 3. DOGFOOD: add files a fresh cal yaml-safely (the '#'-truncation footgun is killed) + validate passes after + comments + patterns[] survive.
p = with_ledger(MINIMAL)
cal.cmd_add(ns(cls="methodology", title="has a # hash and (PR #339)", origin="mission-5",
               status="open", surfaced_at="thread-1 (PR #339)"))
reloaded = cal._load()
new = next(c for c in reloaded["calibrations"] if c["id"] == 2)
check(new["title"] == "has a # hash and (PR #339)", f"'#' NOT truncated in title; got {new['title']!r}")
check(new.get("surfaced_at") == "thread-1 (PR #339)", f"'#' NOT truncated in surfaced_at; got {new.get('surfaced_at')!r}")
check(cal._validate_doc(reloaded) == [], "validate passes after add")
check(reloaded["calibrations"][-1]["id"] == 2, "new entry appended at the END of calibrations[]")
check(any(pp["id"] == "seed-pattern" for pp in reloaded["patterns"]), "patterns[] preserved across add")
check("# calibrations[] schema comment" in p.read_text(), "header/schema COMMENTS preserved across add")
os.unlink(p)

# 4. add rejects a non-open status with no closure_mechanism (schema-validate the new entry).
p = with_ledger(MINIMAL)
try:
    cal.cmd_add(ns(cls="substrate", title="x", origin="m", status="closed-folded"))  # no closure_mechanism
    check(False, "add must reject closed-folded without closure_mechanism")
except SystemExit as e:
    check(e.code == 1, "add exits 1 on the schema violation")
os.unlink(p)

# 5. validate catches the violation classes.
bad_class = {"calibrations": [{"id": 1, "class": "bogus", "title": "t", "origin": "o", "status": "open"}], "patterns": []}
check(any("not in" in e for e in cal._validate_doc(bad_class)), "validate catches a bad class enum")
dup = {"calibrations": [{"id": 1, "class": "methodology", "title": "t", "origin": "o", "status": "open"},
                        {"id": 1, "class": "methodology", "title": "t2", "origin": "o", "status": "open"}], "patterns": []}
check(any("DUPLICATE" in e for e in cal._validate_doc(dup)), "validate catches a duplicate id")
dangling = {"calibrations": [{"id": 1, "class": "methodology", "title": "t", "origin": "o", "status": "open", "pattern_membership": ["ghost"]}], "patterns": []}
check(any("unknown pattern" in e for e in cal._validate_doc(dangling)), "validate catches a dangling pattern_membership")
need_closure = {"calibrations": [{"id": 1, "class": "methodology", "title": "t", "origin": "o", "status": "retired"}], "patterns": []}
check(any("closure_mechanism" in e for e in cal._validate_doc(need_closure)), "validate requires closure_mechanism when status != open")
dangling_pat = {"calibrations": [], "patterns": [{"id": "x", "title": "t", "origin": "o", "description": "d", "surfaced_by_calibrations": [999]}]}
check(any("unknown calibration" in e for e in cal._validate_doc(dangling_pat)), "validate catches a dangling surfaced_by_calibrations")

print(f"\n{_passed} passed, {_failed} failed")
sys.exit(1 if _failed else 0)
