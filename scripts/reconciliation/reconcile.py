#!/usr/bin/env python3
"""Ledger-reconciliation pass (idea-364, Bank-the-Base R2) — READ-ONLY compute.

The sibling of scripts/calibrations/calibrations.py: a git-aware, repo-context CLI
that READS the Hub bug-list + git-truth and COMPUTES per-Bug disposition. It never
writes to the Hub (Option A, architect-ratified 2026-06-28). The only mutation it
proposes — the safe empty-fixCommits backfill — is emitted as an APPLY-READY JSON
artifact ([{bugId, fixCommits:[merge-base-verified squash sha]}]) that the architect
applies via the update_bug tool (FSM/CAS respected). The two status-changing buckets
are REPORT-ONLY (a sha in main is NOT proof a bug is fixed — partial fixes, related
commits; never auto-resolve/reopen on a heuristic; the re-open FSM is idea-375).

WHY git-context (not a Hub verb): the Hub server is a git-less postgres container —
it structurally cannot run `git merge-base`. git-ancestry truth lives where git lives
(repo / dev / CI). This is that tool.

THE SQUASH TRAP (the reason R2 exists): this repo squash-merges, so a Bug's recorded
dev/branch sha is DISCARDED from main's history — `git cat-file` still finds it
(false 'fixed' positive). Ancestry MUST be `git merge-base --is-ancestor <sha> main`,
never bare existence. (Live example: bug-181 recorded 9ec45ee[branch, squashed away]
→ the real fix is 5c64f58[squash, PR#363, ancestor-of-main].)

Usage:
  reconcile.py --bugs-file bugs.json [--main main] [--home-repo apnex/agentic-network]
               [--apply-out backfill.json] [--apply] [--json]

Read the bug-list with the existing psql tool, then reconcile:
  scripts/local/get-entities.sh --kind Bug > bugs.json   # (operator: psql read)
  scripts/reconciliation/reconcile.py --bugs-file bugs.json --apply-out backfill.json

`--apply` (idea-379) EMITS the SAFE additive apply-SET — single-candidate fixCommits
backfills ONLY — as JSON for an MCP agent to execute via update_bug. reconcile.py still
NEVER writes to the Hub (Option A, tele-3); the status-change buckets stay report-only and
can never enter the set (build_apply_set guard, mutation-tested). The MCP agent is the
proper Hub-write executor (the Director-gated prod write goes through an agent + update_bug,
never a CLI growing write powers).

Disposition buckets (per bug):
  external                     repo != home-repo (out of this repo's reconciliation; idea-361)
  closed-wontfix               status=wontfix (terminal, no action)
  confirmed-resolved           resolved + every fixCommit IS an ancestor of main (healthy)
  needs-backfill               resolved + NO fixCommits → derive candidate squash shas (auto-backfill artifact)
  claims-fixed-but-not-in-main resolved + a fixCommit sha is NOT an ancestor of main (the squash trap; REPORT-ONLY)
  fixed-but-still-open         open/investigating + a fixCommit sha IS an ancestor of main (stale-open; REPORT-ONLY)
  actionable-open              open/investigating + no in-main fix (the rebased real backlog)
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Callable

HOME_REPO_DEFAULT = "apnex/agentic-network"

# Buckets that need the architect's disposition (the actionable reconciliation output).
REPORT_BUCKETS = ("needs-backfill", "claims-fixed-but-not-in-main", "fixed-but-still-open")


def _resolve_repo_root() -> Path:
    # scripts/reconciliation/reconcile.py → parents[2] = repo root (calibrations.py pattern).
    return Path(__file__).resolve().parents[2]


# ── The engine (pure — the oracles are injected so it is faithfully testable) ──────

def _flatten(bug: dict) -> dict:
    """Normalize a Bug row to the flat fields the classifier needs, REGARDLESS of shape.
    Real substrate rows (get-entities.sh / psql --format=json emit the raw `data`
    envelope) are ENVELOPE-shaped per mission-90: `status` is a {phase, fixCommits,
    fixRevision, ...} bucket and `repo` lives at `spec.repo` (the Bug renameMap). Flat
    fixtures / bare arrays carry top-level `status` (a string) + `fixCommits` + `repo`.
    The discriminator is whether `status` is a dict (envelope) vs a string (flat) —
    mirrors the Hub's own decode boundary (shape-helpers `phaseFromEntity`). `id` is
    top-level in both. (Reading flat top-level off an envelope row was steve's catch:
    every real resolved bug mis-classified as actionable-open.)"""
    status = bug.get("status")
    if isinstance(status, dict):  # ENVELOPE shape — status.{phase,fixCommits,...} + spec.repo
        spec = bug.get("spec") if isinstance(bug.get("spec"), dict) else {}
        return {
            "id": bug.get("id"),
            "status": status.get("phase"),
            "fixCommits": status.get("fixCommits") or [],
            "repo": spec.get("repo"),
        }
    # FLAT shape — status is the phase string directly; repo/fixCommits top-level.
    return {
        "id": bug.get("id"),
        "status": status,
        "fixCommits": bug.get("fixCommits") or [],
        "repo": bug.get("repo"),
    }


def classify(
    bug: dict,
    is_ancestor: Callable[[str], bool],
    find_fix_shas: Callable[[str], list[str]],
    home_repo: str,
) -> dict:
    """Classify ONE bug into a disposition bucket. PURE: all git-truth enters via the
    two injected oracles, so a faithful real-git fixture (not a merge-base mock) drives
    the test (cal #79/#82). `is_ancestor(sha)` = sha is an ancestor of main (the squash-
    safe check). `find_fix_shas(bug_id)` = main commits referencing the bug (backfill).
    Shape-agnostic: decodes envelope→flat FIRST (real substrate rows are envelope-shaped)."""
    flat = _flatten(bug)
    bug_id = flat["id"]
    repo = flat["repo"]
    if repo and repo != home_repo:
        return {"bug": bug_id, "bucket": "external", "repo": repo}

    status = flat["status"]
    fix = flat["fixCommits"]

    if status == "wontfix":
        return {"bug": bug_id, "bucket": "closed-wontfix"}

    if status == "resolved":
        if not fix:
            candidates = find_fix_shas(bug_id)
            return {"bug": bug_id, "bucket": "needs-backfill", "candidates": candidates}
        orphans = [s for s in fix if not is_ancestor(s)]
        if orphans:
            # The squash trap: the recorded sha isn't in main. A bare existence check
            # (cat-file) would WRONGLY pass these as resolved — this is the whole point.
            return {"bug": bug_id, "bucket": "claims-fixed-but-not-in-main", "orphanShas": orphans}
        return {"bug": bug_id, "bucket": "confirmed-resolved"}

    # open | investigating (or any non-terminal)
    in_main = [s for s in fix if is_ancestor(s)]
    if in_main:
        return {"bug": bug_id, "bucket": "fixed-but-still-open", "shasInMain": in_main}
    return {"bug": bug_id, "bucket": "actionable-open"}


def reconcile(
    bugs: list[dict],
    is_ancestor: Callable[[str], bool],
    find_fix_shas: Callable[[str], list[str]],
    home_repo: str = HOME_REPO_DEFAULT,
) -> dict:
    """Classify every bug; return {dispositions, byBucket, applyArtifact}. PURE."""
    dispositions = [classify(b, is_ancestor, find_fix_shas, home_repo) for b in bugs]
    by_bucket: dict[str, list[dict]] = defaultdict(list)
    for d in dispositions:
        by_bucket[d["bucket"]].append(d)
    # The safe auto-backfill artifact: empty-fixCommits resolved bugs WITH a derived
    # (merge-base-verified, on-main-by-construction) candidate sha. Only the unambiguous
    # single-candidate case is apply-ready; multi/zero candidates stay report-only.
    apply_artifact = [
        {"bugId": d["bug"], "fixCommits": d["candidates"]}
        for d in by_bucket.get("needs-backfill", [])
        if len(d.get("candidates") or []) == 1
    ]
    return {"dispositions": dispositions, "byBucket": dict(by_bucket), "applyArtifact": apply_artifact}


# ── Safe additive apply-set (idea-379 / work-84) ───────────────────────────────────
# The ONE safe auto-applicable mutation is the ADDITIVE fixCommits backfill on a resolved
# bug with a single merge-base-verified squash candidate (the applyArtifact). build_apply_set
# emits the VALIDATED, additive-ONLY apply-set for an MCP agent (work-77) to execute via
# update_bug. reconcile.py stays a PURE read-only git-forensic CLI (Option A, tele-3): it
# EMITS the plan, it does NOT write to the Hub — the Director-gated prod write goes through
# an agent + update_bug, never a CLI growing write powers.
#
# THE LOAD-BEARING GUARD: the set is built ONLY from single-candidate needs-backfill bugs.
# The status-change buckets (claims-fixed-but-not-in-main, fixed-but-still-open) can NEVER
# enter it — a sha in main is not proof a bug is fixed, and the re-open/resolve FSM is
# idea-375's, never a reconcile heuristic. The applier receives (bugId, fixCommits) ONLY —
# additive, structurally unable to touch status. dry_run (default) builds the set without
# dispatching to the applier.

# The status-change buckets — surfaced as report-only; NEVER auto-applied.
STATUS_CHANGE_BUCKETS = ("claims-fixed-but-not-in-main", "fixed-but-still-open")

# An applier performs the additive backfill for one bug. Injected so the executor (an MCP
# agent in work-77) or a test mock is pluggable + the safety logic is testable without a Hub.
Applier = Callable[[str, list], None]


def build_apply_set(result: dict, applier: "Applier | None" = None, dry_run: bool = True) -> dict:
    """Build (and, if not dry_run, dispatch to `applier`) the SAFE additive apply-set.

    Only single-candidate needs-backfill bugs are ever included; the status-change buckets
    are surfaced as report-only counts and NEVER dispatched. Returns a summary; the apply-set
    is the executable plan for an MCP agent (work-77) to run update_bug(bugId, fixCommits) on.
    """
    by_bucket = result["byBucket"]
    # Defense-in-depth ELIGIBILITY MAP (steve GATE-415): {bug -> its ONE derived candidate}
    # for needs-backfill rows with EXACTLY ONE candidate. A MULTI-candidate needs-backfill
    # bug is AMBIGUOUS (report-only) and must NEVER be auto-applied — even if a malformed
    # applyArtifact picks one of its shas (the chosen sha could be the wrong fix). And a
    # status-change-bucket bug isn't in this map at all. The earlier "(in needs-backfill) +
    # (len==1)" check was too loose: it admitted a multi-candidate bug whose forged artifact
    # entry happened to carry one sha.
    eligible = {
        d["bug"]: d["candidates"]
        for d in by_bucket.get("needs-backfill", [])
        if len(d.get("candidates") or []) == 1
    }
    apply_set: list = []
    for entry in result.get("applyArtifact", []):
        bug_id = entry["bugId"]
        fix = entry.get("fixCommits") or []
        # GUARD: the bug must be a SINGLE-candidate needs-backfill bug AND the artifact's
        # fixCommits must EXACTLY match its one derived candidate. Excludes multi-candidate
        # bugs (ambiguous), forged/mismatched shas, and every non-needs-backfill bucket.
        if bug_id not in eligible or fix != eligible[bug_id]:
            continue
        apply_set.append({"bugId": bug_id, "fixCommits": fix})
        if not dry_run and applier is not None:
            applier(bug_id, fix)  # fixCommits-ONLY — structurally cannot change status
    return {
        "dryRun": dry_run,
        "applySet": apply_set,        # the validated, executable safe-additive backfill set
        "applyCount": len(apply_set),
        "reportOnly": {b: len(by_bucket.get(b, [])) for b in STATUS_CHANGE_BUCKETS},
    }


# ── Real git oracles (the I/O shell around the pure engine) ────────────────────────

def git_is_ancestor(repo_root: Path, main: str) -> Callable[[str], bool]:
    def _is_ancestor(sha: str) -> bool:
        # exit 0 = ancestor; non-zero (incl. unknown-sha) = NOT an ancestor (fail-closed).
        # This is the squash-safe check: a squashed-away branch sha EXISTS but is not an
        # ancestor → correctly NOT-in-main (a bare `cat-file -e` would wrongly say yes).
        r = subprocess.run(
            ["git", "-C", str(repo_root), "merge-base", "--is-ancestor", sha, main],
            capture_output=True,
        )
        return r.returncode == 0
    return _is_ancestor


def git_find_fix_shas(repo_root: Path, main: str) -> Callable[[str], list[str]]:
    def _find(bug_id: str) -> list[str]:
        # Commits ON MAIN whose message references the bug id (e.g. a squash like
        # "... bug-181 (DF2 WI-2)"). Restricted to `main` → results are ancestors of
        # main by construction (merge-base-verified for free).
        # EXACT-TOKEN match, NOT substring (steve's catch): a bare `--grep bug-18`
        # also matches `bug-180` → a WRONG, apply-ready backfill sha. The extended
        # regex pins a leading boundary (start-of-line / non-alphanumeric) + a trailing
        # boundary (non-digit / end-of-line) so `bug-18` does NOT match `bug-180`/`bug-181`.
        pattern = r"(^|[^0-9A-Za-z])" + bug_id + r"([^0-9]|$)"
        r = subprocess.run(
            ["git", "-C", str(repo_root), "log", main, "-E", "--grep", pattern, "--format=%H"],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            return []
        return [ln.strip() for ln in r.stdout.splitlines() if ln.strip()]
    return _find


def load_bugs(path: Path) -> list[dict]:
    if not path.exists():
        sys.exit(f"bugs file not found: {path}")
    data = json.loads(path.read_text())
    # Accept either a bare array or {entities|bugs|items: [...]} (get-entities.sh shapes).
    if isinstance(data, dict):
        for key in ("entities", "bugs", "items"):
            if isinstance(data.get(key), list):
                return data[key]
        sys.exit(f"bugs file {path}: expected an array or an {{entities|bugs|items}} object")
    if not isinstance(data, list):
        sys.exit(f"bugs file {path}: expected a JSON array of bugs")
    return data


def format_report(result: dict) -> str:
    lines: list[str] = ["# Ledger reconciliation report", ""]
    by_bucket = result["byBucket"]
    order = [
        "actionable-open", "needs-backfill", "claims-fixed-but-not-in-main",
        "fixed-but-still-open", "confirmed-resolved", "closed-wontfix", "external",
    ]
    for bucket in order:
        items = by_bucket.get(bucket, [])
        if not items:
            continue
        tag = " (NEEDS DISPOSITION)" if bucket in REPORT_BUCKETS else ""
        lines.append(f"## {bucket}: {len(items)}{tag}")
        for d in items:
            extra = ""
            if d.get("orphanShas"):
                extra = f"  orphan-shas={d['orphanShas']}"
            elif d.get("shasInMain"):
                extra = f"  in-main={d['shasInMain']}"
            elif "candidates" in d:
                extra = f"  candidates={d['candidates']}"
            elif d.get("repo"):
                extra = f"  repo={d['repo']}"
            lines.append(f"  - {d['bug']}{extra}")
        lines.append("")
    n_apply = len(result["applyArtifact"])
    lines.append(f"APPLY-READY backfills (single-candidate, merge-base-verified): {n_apply}")
    return "\n".join(lines)


def main() -> None:
    p = argparse.ArgumentParser(prog="reconcile", description=__doc__.split("\n\n")[0])
    p.add_argument("--bugs-file", required=True, type=Path,
                   help="JSON bug-list (a bare array OR a get-entities.sh {entities:[...]} export)")
    p.add_argument("--main", default="main", help="The main ref to check ancestry against (default: main)")
    p.add_argument("--home-repo", default=HOME_REPO_DEFAULT,
                   help=f"Home repo slug; bugs with repo != this are 'external' (default: {HOME_REPO_DEFAULT})")
    p.add_argument("--apply-out", type=Path,
                   help="Write the apply-ready empty-fixCommits backfill artifact (JSON) here for `update_bug`")
    p.add_argument("--apply", action="store_true",
                   help="Emit the SAFE additive apply-SET — single-candidate fixCommits backfills ONLY — for an "
                        "MCP agent (work-77) to execute via update_bug. reconcile.py never writes to the Hub "
                        "itself (Option A, tele-3); the status-change buckets are report-only and can never enter "
                        "the set. Default (omitted) = the read-only report preview.")
    p.add_argument("--json", action="store_true", help="Emit the full result as JSON instead of the text report")
    args = p.parse_args()

    repo_root = _resolve_repo_root()
    bugs = load_bugs(args.bugs_file)
    result = reconcile(
        bugs,
        is_ancestor=git_is_ancestor(repo_root, args.main),
        find_fix_shas=git_find_fix_shas(repo_root, args.main),
        home_repo=args.home_repo,
    )

    if args.apply_out:
        args.apply_out.write_text(json.dumps(result["applyArtifact"], indent=2))

    if args.apply:
        # Option B (architect-ratified): reconcile.py EMITS the validated safe apply-set;
        # it does NOT write to the Hub. An MCP agent (work-77) executes update_bug on it.
        print(json.dumps(build_apply_set(result), indent=2))
        return

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(format_report(result))


if __name__ == "__main__":
    main()
