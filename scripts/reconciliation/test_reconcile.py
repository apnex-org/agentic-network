#!/usr/bin/env python3
"""Faithful reconciliation tests (idea-364 R2).

cal #79/#82 — the harness is FAITHFUL: a REAL git repo with REAL squash-merge
topology + the REAL `git merge-base --is-ancestor` oracle, NOT a merge-base mock. A
linear-history or cat-file-existence fixture would PASS a naive impl and miss the
squash trap (the whole reason R2 exists). The fixture reproduces:
  - a branch commit that is SQUASHED AWAY (exists via cat-file, NOT an ancestor of main)
  - squash commits that ARE on main
and exercises all four reconciliation buckets, plus the mutation that proves the
detector needs ancestry (merge-base), not existence (cat-file).

Run: python3 scripts/reconciliation/test_reconcile.py   (stdlib unittest; needs git)
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import reconcile  # same-dir import (run from scripts/reconciliation/ or with it on sys.path)


def _git(repo: Path, *args: str) -> str:
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {r.stderr}")
    return r.stdout.strip()


def _commit(repo: Path, fname: str, content: str, msg: str) -> str:
    (repo / fname).write_text(content)
    _git(repo, "add", fname)
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", msg)
    return _git(repo, "rev-parse", "HEAD")


class FaithfulSquashFixture:
    """A real git repo with squash topology. Yields the load-bearing shas."""

    def __init__(self, root: Path):
        self.repo = root
        _git(self.repo, "init", "-q")
        # base commit, then force the branch name to `main` (default-branch-agnostic).
        _commit(self.repo, "base.txt", "base", "base commit")
        _git(self.repo, "branch", "-M", "main")
        # a feature branch commit that we will SQUASH away (discarded from main history).
        _git(self.repo, "checkout", "-q", "-b", "feature")
        self.branch_sha = _commit(self.repo, "feat.txt", "feature work", "feature work (pre-squash)")
        # squash-merge into main → a NEW commit on main; branch_sha is NOT its ancestor.
        _git(self.repo, "checkout", "-q", "main")
        _git(self.repo, "merge", "--squash", "feature")
        _git(self.repo, "add", "-A")
        _git(self.repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "squash: feature (PR#1)")
        self.squash_sha = _git(self.repo, "rev-parse", "HEAD")
        # a later main commit whose message references bug-needsbackfill (for the backfill grep).
        self.main_sha2 = _commit(self.repo, "fix.txt", "the fix", "fix for bug-needsbackfill (PR#2)")


class ReconcileFaithfulTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.fx = FaithfulSquashFixture(Path(self._tmp.name))
        self.is_ancestor = reconcile.git_is_ancestor(self.fx.repo, "main")
        self.find_fix = reconcile.git_find_fix_shas(self.fx.repo, "main")

    def tearDown(self):
        self._tmp.cleanup()

    def _bucket(self, bug: dict) -> dict:
        return reconcile.classify(bug, self.is_ancestor, self.find_fix, reconcile.HOME_REPO_DEFAULT)

    def test_fixture_topology_is_faithful(self):
        # The trap precondition: the branch sha EXISTS (cat-file) but is NOT an ancestor
        # of main. If this isn't true, the whole test is vacuous (a linear fixture).
        exists = subprocess.run(["git", "-C", str(self.fx.repo), "cat-file", "-e", self.fx.branch_sha]).returncode == 0
        self.assertTrue(exists, "branch sha must still exist as an object")
        self.assertFalse(self.is_ancestor(self.fx.branch_sha), "squashed-away branch sha must NOT be an ancestor of main")
        self.assertTrue(self.is_ancestor(self.fx.squash_sha), "squash sha must be on main")

    def test_a_confirmed_resolved(self):
        d = self._bucket({"id": "bug-clean", "status": "resolved", "fixCommits": [self.fx.squash_sha]})
        self.assertEqual(d["bucket"], "confirmed-resolved")

    def test_b_claims_fixed_but_not_in_main_THE_SQUASH_TRAP(self):
        d = self._bucket({"id": "bug-trap", "status": "resolved", "fixCommits": [self.fx.branch_sha]})
        self.assertEqual(d["bucket"], "claims-fixed-but-not-in-main")
        self.assertEqual(d["orphanShas"], [self.fx.branch_sha])

    def test_c_needs_backfill_derives_the_squash_sha(self):
        d = self._bucket({"id": "bug-needsbackfill", "status": "resolved", "fixCommits": []})
        self.assertEqual(d["bucket"], "needs-backfill")
        self.assertEqual(d["candidates"], [self.fx.main_sha2])  # grep on main found the squash

    def test_d_fixed_but_still_open(self):
        d = self._bucket({"id": "bug-staleopen", "status": "open", "fixCommits": [self.fx.main_sha2]})
        self.assertEqual(d["bucket"], "fixed-but-still-open")
        self.assertEqual(d["shasInMain"], [self.fx.main_sha2])

    def test_e_actionable_open_and_external(self):
        self.assertEqual(self._bucket({"id": "bug-open", "status": "open", "fixCommits": []})["bucket"], "actionable-open")
        ext = self._bucket({"id": "bug-ext", "status": "open", "repo": "apnex/missioncraft"})
        self.assertEqual(ext["bucket"], "external")

    def test_apply_artifact_is_single_candidate_only(self):
        bugs = [
            {"id": "bug-needsbackfill", "status": "resolved", "fixCommits": []},  # 1 candidate → apply-ready
            {"id": "bug-trap", "status": "resolved", "fixCommits": [self.fx.branch_sha]},  # report-only
        ]
        result = reconcile.reconcile(bugs, self.is_ancestor, self.find_fix)
        self.assertEqual(result["applyArtifact"], [{"bugId": "bug-needsbackfill", "fixCommits": [self.fx.main_sha2]}])

    def _envelope_bug(self, bug_id, phase, fix_commits=None, repo=None):
        """A real substrate-shaped Bug row (mission-90 envelope), matching get-entities.sh
        --format=json: status.{phase,fixCommits,...}, spec.{...,repo} — ground-truthed
        against migrations/v2-envelope/__tests__/kinds/Bug.test.ts."""
        spec = {"title": "t", "description": "d", "severity": "minor", "class": None}
        if repo is not None:
            spec["repo"] = repo
        return {
            "apiVersion": "ois.io/v1", "kind": "Bug", "id": bug_id,
            "metadata": {"labels": {}, "surfacedBy": "prod-audit", "sourceIdeaId": None},
            "spec": spec,
            "status": {"phase": phase, "fixCommits": fix_commits or [],
                       "fixRevision": None, "linkedTaskIds": [], "linkedMissionId": None},
        }

    def test_ENVELOPE_shape_classifies_correctly_steve_catch(self):
        # steve's catch: real substrate rows are ENVELOPE-shaped (status.phase,
        # status.fixCommits, spec.repo). Reading flat top-level off them mis-classified
        # EVERY real resolved bug as actionable-open — the classifier must decode the envelope.
        env_clean = self._envelope_bug("bug-env-clean", "resolved", [self.fx.squash_sha])
        self.assertEqual(self._bucket(env_clean)["bucket"], "confirmed-resolved")  # NOT actionable-open
        self.assertEqual(self._bucket(self._envelope_bug("bug-needsbackfill", "resolved", []))["bucket"], "needs-backfill")
        self.assertEqual(self._bucket(self._envelope_bug("bug-env-trap", "resolved", [self.fx.branch_sha]))["bucket"], "claims-fixed-but-not-in-main")
        self.assertEqual(self._bucket(self._envelope_bug("bug-env-open", "open", []))["bucket"], "actionable-open")
        self.assertEqual(self._bucket(self._envelope_bug("bug-env-ext", "open", [], repo="apnex/missioncraft"))["bucket"], "external")
        # PARITY: the SAME data in FLAT shape classifies the SAME way (shape-agnostic decode).
        flat_clean = {"id": "bug-flat-clean", "status": "resolved", "fixCommits": [self.fx.squash_sha]}
        self.assertEqual(self._bucket(flat_clean)["bucket"], self._bucket(env_clean)["bucket"])

    def test_EXACT_bug_id_match_not_substring_steve_catch(self):
        # steve's catch: `--grep <bug_id>` is a SUBSTRING match → 'bug-18' matches 'bug-180'.
        # Since single-candidate needs-backfill is APPLY-READY, a substring match emits a
        # WRONG backfill sha. The exact-token grep must return ONLY the matching bug.
        sha_18 = _commit(self.fx.repo, "f18.txt", "x", "fix for bug-18 (PR#A)")
        sha_180 = _commit(self.fx.repo, "f180.txt", "y", "fix for bug-180 (PR#B)")
        self.assertEqual(self.find_fix("bug-18"), [sha_18])    # NOT [sha_180, sha_18] (substring would include bug-180)
        self.assertEqual(self.find_fix("bug-180"), [sha_180])  # bug-180 exact
        # end-to-end: needs-backfill for bug-18 derives ONLY sha_18 (the apply-ready sha is correct)
        d = self._bucket({"id": "bug-18", "status": "resolved", "fixCommits": []})
        self.assertEqual(d["candidates"], [sha_18])

    def test_MUTATION_cat_file_existence_oracle_MISCLASSIFIES_the_trap(self):
        # THE proof that the detector needs ancestry, not existence. Swap the real
        # merge-base oracle for a bare `cat-file -e` existence check: the squashed-away
        # branch sha EXISTS → the naive oracle says "in main" → bucket (b) WRONGLY
        # becomes confirmed-resolved. The real merge-base oracle (above) gets it right.
        def cat_file_exists(sha: str) -> bool:
            return subprocess.run(["git", "-C", str(self.fx.repo), "cat-file", "-e", sha]).returncode == 0

        trap_bug = {"id": "bug-trap", "status": "resolved", "fixCommits": [self.fx.branch_sha]}
        naive = reconcile.classify(trap_bug, cat_file_exists, self.find_fix, reconcile.HOME_REPO_DEFAULT)
        self.assertEqual(naive["bucket"], "confirmed-resolved",
                         "the cat-file oracle is EXPECTED to mis-pass the trap (this is what merge-base prevents)")
        # ...and the real (merge-base) oracle catches it — the two diverge ONLY because of squash topology.
        real = self._bucket(trap_bug)
        self.assertEqual(real["bucket"], "claims-fixed-but-not-in-main")
        self.assertNotEqual(naive["bucket"], real["bucket"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
