#!/usr/bin/env python3
"""Calibration ledger read-only Skill scaffolding (Phase 1; mission-65 / ADR-030).

Three read-only subcommands surface the architectural shape (Design v1.0 §2.3).
Verb names are PLACEHOLDERS pending idea-121 (API v2.0 tool-surface) ratification.

Usage:
  calibrations.py list [--class CLASS] [--status STATUS] [--mission MISSION] [--axiom AXIOM]
  calibrations.py show <id-or-slug>
  calibrations.py status

The ledger lives at docs/calibrations.yaml (resolved relative to this script's
repo). Phase 1 is read-only; write authority defers to Phase 2+ per ADR-030.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

import yaml


def _resolve_ledger_path() -> Path:
    # CALIBRATIONS_LEDGER overrides the path (tests point at a temp ledger so `add`/`validate`
    # never touch the real docs/calibrations.yaml).
    override = os.environ.get("CALIBRATIONS_LEDGER")
    if override:
        return Path(override)
    here = Path(__file__).resolve()
    repo_root = here.parents[2]
    return repo_root / "docs" / "calibrations.yaml"


def _load() -> dict:
    path = _resolve_ledger_path()
    if not path.exists():
        sys.exit(f"calibrations.yaml not found at {path}")
    with path.open() as f:
        return yaml.safe_load(f) or {}


def cmd_list(args: argparse.Namespace) -> None:
    doc = _load()
    rows = doc.get("calibrations") or []

    if args.cls:
        rows = [c for c in rows if c.get("class") == args.cls]
    if args.status:
        rows = [c for c in rows if c.get("status") == args.status]
    if args.mission:
        rows = [c for c in rows if (c.get("origin") or "").startswith(args.mission)]
    if args.axiom:
        rows = [c for c in rows if args.axiom in (c.get("axiom_alignment") or [])]

    if not rows:
        print("(no calibrations match filter)")
        return

    width_id = max(len(str(c["id"])) for c in rows)
    width_status = max(len(c["status"]) for c in rows)
    for c in rows:
        print(
            f"#{c['id']:<{width_id}}  "
            f"[{c['class']:<11}]  "
            f"{c['status']:<{width_status}}  "
            f"{c['title']}"
        )
    print(f"\n({len(rows)} entries)")


def cmd_show(args: argparse.Namespace) -> None:
    doc = _load()
    target = args.id_or_slug

    try:
        target_int = int(target)
    except ValueError:
        target_int = None

    if target_int is not None:
        match = next(
            (c for c in (doc.get("calibrations") or []) if c["id"] == target_int),
            None,
        )
        if match is None:
            sys.exit(f"calibration #{target_int} not found")
        _render_calibration(match, doc)
        return

    match = next(
        (p for p in (doc.get("patterns") or []) if p["id"] == target),
        None,
    )
    if match is None:
        sys.exit(f"pattern '{target}' not found (also tried as int)")
    _render_pattern(match, doc)


def _render_calibration(c: dict, doc: dict) -> None:
    print(f"calibration #{c['id']} — {c['title']}")
    print(f"  class:        {c['class']}")
    print(f"  origin:       {c['origin']}")
    if c.get("surfaced_at"):
        print(f"  surfaced_at:  {c['surfaced_at']}")
    print(f"  status:       {c['status']}")
    if c.get("closure_pr"):
        print(f"  closure_pr:   #{c['closure_pr']}")
    if c.get("closure_mechanism"):
        print(f"  closure_mechanism:")
        for line in c["closure_mechanism"].rstrip().splitlines():
            print(f"    {line}")
    if c.get("pattern_membership"):
        print(f"  pattern_membership:")
        patterns_by_id = {p["id"]: p for p in (doc.get("patterns") or [])}
        for slug in c["pattern_membership"]:
            p = patterns_by_id.get(slug)
            label = p["title"] if p else "(unknown — cross-link broken)"
            print(f"    - {slug}: {label}")
    if c.get("cross_refs"):
        print(f"  cross_refs:")
        for ref in c["cross_refs"]:
            print(f"    - {ref}")
    if c.get("axiom_alignment"):
        print(f"  axiom_alignment: {', '.join(c['axiom_alignment'])}")


def _render_pattern(p: dict, doc: dict) -> None:
    print(f"pattern {p['id']} — {p['title']}")
    print(f"  origin: {p['origin']}")
    print(f"  description:")
    for line in p["description"].rstrip().splitlines():
        print(f"    {line}")
    print(f"  surfaced_by_calibrations:")
    calibs_by_id = {c["id"]: c for c in (doc.get("calibrations") or [])}
    for cid in p.get("surfaced_by_calibrations") or []:
        c = calibs_by_id.get(cid)
        label = c["title"] if c else "(unknown — cross-link broken)"
        print(f"    - #{cid}: {label}")
    if p.get("methodology_doc_subsection"):
        print(f"  methodology_doc_subsection: {p['methodology_doc_subsection']}")


def cmd_status(args: argparse.Namespace) -> None:
    doc = _load()
    calibs = doc.get("calibrations") or []
    patterns = doc.get("patterns") or []

    print(f"schema_version: {doc.get('schema_version', '?')}")
    print(f"calibrations:   {len(calibs)}")
    print(f"patterns:       {len(patterns)}")
    print()

    print("by status:")
    for status, n in Counter(c["status"] for c in calibs).most_common():
        print(f"  {status:<22} {n}")

    print("\nby class:")
    for cls, n in Counter(c["class"] for c in calibs).most_common():
        print(f"  {cls:<22} {n}")

    print("\nby mission origin:")
    by_mission: Counter[str] = Counter()
    for c in calibs:
        origin = c.get("origin") or ""
        head = origin.split("-W")[0] if "-W" in origin else origin
        by_mission[head] += 1
    for mission, n in sorted(by_mission.items()):
        print(f"  {mission:<22} {n}")

    print("\nby axiom_alignment:")
    by_axiom: Counter[str] = Counter()
    for c in calibs:
        for axiom in c.get("axiom_alignment") or []:
            by_axiom[axiom] += 1
    for axiom, n in by_axiom.most_common():
        print(f"  {axiom:<22} {n}")
    untagged = sum(1 for c in calibs if not c.get("axiom_alignment"))
    print(f"  (untagged)             {untagged}")

    if patterns:
        print("\npatterns:")
        for p in patterns:
            members = p.get("surfaced_by_calibrations") or []
            print(f"  {p['id']:<60} ({len(members)} member{'s' if len(members) != 1 else ''})")


# ── Phase-2 WRITE surface (work-97 / idea-356 part 1) ───────────────────────────
# Schema enums + required fields (Design §2.1). The write-verb mechanizes the manual
# yaml-edit filing path, eliminating the #421 footguns: ID-race, '#'-comment-truncation
# of plain scalars, schema-drift, and broken (dangling) cross-links.
CLASS_ENUM = ("substrate", "methodology")
STATUS_ENUM = ("open", "closed-structurally", "closed-folded", "retired", "superseded")
CAL_REQUIRED = ("id", "class", "title", "origin", "status")
PATTERN_REQUIRED = ("id", "title", "origin", "description", "surfaced_by_calibrations")


def _next_id(doc: dict) -> int:
    """Mechanical monotonic id = max numeric calibration id + 1 (over retired/superseded gaps)."""
    ids = [c.get("id") for c in (doc.get("calibrations") or []) if isinstance(c.get("id"), int)]
    return (max(ids) + 1) if ids else 1


def _validate_calibration(c: dict) -> list[str]:
    """Per-entry schema checks (shared by `validate` + `add`'s pre-write gate)."""
    errs: list[str] = []
    cid = c.get("id")
    tag = f"calibration #{cid}"
    for f in CAL_REQUIRED:
        if c.get(f) in (None, ""):
            errs.append(f"{tag}: missing required field '{f}'")
    if not isinstance(cid, int):
        errs.append(f"{tag}: id must be an integer")
    if c.get("class") not in CLASS_ENUM:
        errs.append(f"{tag}: class={c.get('class')!r} not in {list(CLASS_ENUM)}")
    if c.get("status") not in STATUS_ENUM:
        errs.append(f"{tag}: status={c.get('status')!r} not in {list(STATUS_ENUM)}")
    elif c.get("status") != "open" and not c.get("closure_mechanism"):
        errs.append(f"{tag}: closure_mechanism is REQUIRED when status != open (status={c.get('status')})")
    return errs


def _validate_doc(doc: dict) -> list[str]:
    """Whole-ledger validation: schema per entry + unique ids + BIDIRECTIONAL cross-link
    consistency (calibration.pattern_membership[slug] <-> pattern.surfaced_by_calibrations[id])
    with no dangling refs. Returns the list of violations (empty = valid)."""
    errs: list[str] = []
    calibs = doc.get("calibrations") or []
    patterns = doc.get("patterns") or []

    seen_ids: set = set()
    for c in calibs:
        errs.extend(_validate_calibration(c))
        cid = c.get("id")
        if isinstance(cid, int):
            if cid in seen_ids:
                errs.append(f"DUPLICATE calibration id {cid}")
            seen_ids.add(cid)

    seen_pat: set = set()
    for p in patterns:
        pid = p.get("id")
        tag = f"pattern {pid!r}"
        for f in PATTERN_REQUIRED:
            if p.get(f) in (None, "", []):
                errs.append(f"{tag}: missing/empty required field '{f}'")
        if pid in seen_pat:
            errs.append(f"DUPLICATE pattern id {pid!r}")
        seen_pat.add(pid)

    # Cross-link discipline (Design §2.1): NO DANGLING refs in BOTH directions — every
    # calibration.pattern_membership[slug] resolves to an existing pattern, and every
    # pattern.surfaced_by_calibrations[id] resolves to an existing calibration. (NOT full
    # symmetry: pattern_membership = ALL member cals ⊋ surfaced_by_calibrations = the
    # ORIGINATING cals, so a member-not-originator is a legitimate state — symmetry would
    # false-flag it; the current ledger has 5 such. work-97 / surfaced to architect.)
    pat_ids = {p.get("id") for p in patterns}
    cal_ids = {c.get("id") for c in calibs}
    for c in calibs:
        for slug in c.get("pattern_membership") or []:
            if slug not in pat_ids:
                errs.append(f"calibration #{c.get('id')}: pattern_membership references unknown pattern {slug!r}")
    for p in patterns:
        for cid in p.get("surfaced_by_calibrations") or []:
            if cid not in cal_ids:
                errs.append(f"pattern {p.get('id')!r}: surfaced_by_calibrations references unknown calibration #{cid}")
    return errs


def cmd_validate(args: argparse.Namespace) -> None:
    doc = _load()
    errs = _validate_doc(doc)
    if errs:
        print(f"INVALID — {len(errs)} violation(s):")
        for e in errs:
            print(f"  - {e}")
        sys.exit(1)
    calibs = doc.get("calibrations") or []
    patterns = doc.get("patterns") or []
    print(f"VALID — {len(calibs)} calibrations, {len(patterns)} patterns; next id {_next_id(doc)}; cross-links resolve (no dangling refs).")


def _emit_calibration_block(entry: dict) -> str:
    """Emit ONE calibration entry as a YAML list item via the real emitter (safe_dump) — so
    scalars containing '#' are quoted STRUCTURALLY (no comment-truncation), then indent 2 to
    match calibrations[]. Appended to the file (comments preserved) rather than re-dumping the
    whole doc (PyYAML would strip the header/schema comments)."""
    raw = yaml.safe_dump([entry], default_flow_style=False, sort_keys=False, allow_unicode=True, width=100)
    return "".join(("  " + ln) if ln.strip() else ln for ln in raw.splitlines(keepends=True))


def cmd_add(args: argparse.Namespace) -> None:
    path = _resolve_ledger_path()
    doc = _load()
    # Pre-write gate: never append onto an already-broken ledger.
    pre = _validate_doc(doc)
    if pre:
        print(f"REFUSING to add — the ledger is already INVALID ({len(pre)} violation(s)); fix it first:")
        for e in pre:
            print(f"  - {e}")
        sys.exit(1)

    new_id = _next_id(doc)
    entry: dict = {"id": new_id, "class": args.cls, "title": args.title, "origin": args.origin}
    if args.surfaced_at:
        entry["surfaced_at"] = args.surfaced_at
    entry["status"] = args.status
    if args.closure_mechanism:
        entry["closure_mechanism"] = args.closure_mechanism
    if args.closure_pr:
        entry["closure_pr"] = args.closure_pr
    if args.pattern_membership:
        entry["pattern_membership"] = list(args.pattern_membership)
    if args.cross_ref:
        entry["cross_refs"] = list(args.cross_ref)
    if args.axiom:
        entry["axiom_alignment"] = list(args.axiom)

    ent_errs = _validate_calibration(entry)
    if ent_errs:
        print("INVALID entry — not written:")
        for e in ent_errs:
            print(f"  - {e}")
        sys.exit(1)

    block = _emit_calibration_block(entry)
    lines = path.read_text().splitlines(keepends=True)
    pat_idx = next((i for i, ln in enumerate(lines) if ln.startswith("patterns:")), None)
    if pat_idx is None:
        sys.exit("could not locate the patterns[] boundary in the ledger")
    # insert at the start of the contiguous comment/blank block that precedes `patterns:` —
    # so the new entry lands at the END of calibrations[], before the patterns-section comment.
    insert_at = pat_idx
    while insert_at > 0 and (lines[insert_at - 1].lstrip().startswith("#") or not lines[insert_at - 1].strip()):
        insert_at -= 1
    lines[insert_at:insert_at] = [block if block.endswith("\n") else block + "\n", "\n"]
    path.write_text("".join(lines))

    # Post-write: re-validate the whole ledger (catches a DANGLING cross-link the new entry
    # introduced — e.g. a pattern_membership referencing a pattern that doesn't exist).
    post = _validate_doc(_load())
    if post:
        print(f"calibration #{new_id} WRITTEN, but the ledger now has {len(post)} violation(s) — fix before commit:")
        for e in post:
            print(f"  - {e}")
        sys.exit(2)
    print(f"Filed calibration #{new_id} ({args.cls}, {args.status}). Ledger re-validated VALID.")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="calibrations", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="list calibrations with optional filters")
    p_list.add_argument("--class", dest="cls", help="filter by class (substrate | methodology)")
    p_list.add_argument("--status", help="filter by status")
    p_list.add_argument("--mission", help="filter by mission prefix (e.g. mission-64)")
    p_list.add_argument("--axiom", help="filter by axiom id (e.g. A3)")
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", help="show calibration (int id) or pattern (slug)")
    p_show.add_argument("id_or_slug", help="calibration id (integer) or pattern slug (kebab-case)")
    p_show.set_defaults(func=cmd_show)

    p_status = sub.add_parser("status", help="aggregate cross-mission counts + axiom-aligned slices")
    p_status.set_defaults(func=cmd_status)

    # ── Phase-2 WRITE surface (work-97 / idea-356 part 1) ──
    p_validate = sub.add_parser("validate", help="validate the whole ledger (schema + unique ids + bidirectional cross-links); exit non-zero on violation (CI-usable)")
    p_validate.set_defaults(func=cmd_validate)

    p_add = sub.add_parser("add", help="file a calibration: mechanical monotonic id + yaml-safe emit + schema-validate + re-validate")
    p_add.add_argument("--class", dest="cls", required=True, help="substrate | methodology")
    p_add.add_argument("--title", required=True, help="concise human-readable summary")
    p_add.add_argument("--origin", required=True, help="mission-X-WN (or similar)")
    p_add.add_argument("--status", required=True, help="open | closed-structurally | closed-folded | retired | superseded")
    p_add.add_argument("--surfaced-at", dest="surfaced_at", help="thread-NNN-roundN / audit ref (optional)")
    p_add.add_argument("--closure-mechanism", dest="closure_mechanism", help="closure narrative; REQUIRED if status != open")
    p_add.add_argument("--closure-pr", dest="closure_pr", type=int, help="PR # delivering closure (optional)")
    p_add.add_argument("--pattern-membership", dest="pattern_membership", action="append", metavar="SLUG", help="pattern id (slug); repeatable — the referenced pattern must EXIST (validate enforces no-dangling; the pattern need NOT list this id back — membership is a superset of the surfaced_by originators)")
    p_add.add_argument("--cross-ref", dest="cross_ref", action="append", metavar="REF", help="memory-doc path / entity ref; repeatable")
    p_add.add_argument("--axiom", dest="axiom", action="append", metavar="AXIOM", help="axiom id (e.g. A3); repeatable")
    p_add.set_defaults(func=cmd_add)

    return p


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
