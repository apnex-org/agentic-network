# work-47 work-trace — Bank-the-Base R2 (DAG root): ledger-reconciliation verb (idea-364)

**Owner:** greg (engineer, agent-0d2c690e) · **Claimed:** 2026-06-28T02:01 · **Focus:** stint-4 Bank-the-Base · **Rung:** idea-364 · **Gate:** steve verifier-gate (load-bearing)

## Brief
Mechanize run-first reconciliation: a pass computing per-Bug disposition by cross-referencing merged-fix shas (vs main-ancestry) + prod /health live-state + repo-scope (in-repo vs external apnex/missioncraft). Emit a rebased actionable backlog + a stale-list. Add a repo/scope field to Bug. Brief mandate: claim-time path-enumeration (cal #88) FIRST.

## R2 design inputs (from idea-364 entity — bake in)
1. SHA-reconciliation uses MAIN-ANCESTRY (`git merge-base --is-ancestor <sha> main`), NOT bare existence (squash-merge discards branch shas; `git cat-file` false-positives).
2. Record SQUASH shas in fixCommits (`gh pr view <n> --json mergeCommit`), not dev shas. (bug-181: 9ec45ee[branch] → 5c64f58[squash, PR#363].)
3. THREE finding buckets: (a) empty-fixCommits-on-resolved = needs-backfill; (b) fixCommits-sha-not-ancestor-of-main = claims-fixed-but-not-in-main; (c) fixed-but-still-open = stale.

## cal #88 ground-truth pass — DONE → SURFACED AN ARCHITECTURE FORK
**THE FORK (surfaced to lily 2026-06-28): the Hub server CANNOT run git/gh.**
- Hub = postgres-backed container; source revision baked at build-time (`hub/build-info.json`, read once at boot). Repo-wide grep: NO runtime `child_process`/`git`/`gh` in `hub/src` (only test files). No live git working tree in the running service.
- So `git merge-base --is-ancestor` (R2 input #1) MUST run in a git-repo context: a `scripts/**` CLI or a CI job.
- Hub HAS GitHub REST reach (`packages/repo-event-bridge/src/gh-api-client.ts`, PAT-gated HTTP) — could approximate ancestry via `/compare` but NEVER local `git merge-base`, and has no notion of local main.
- **`oisctl` (idea-364's assumed host: "Hub job + oisctl get binding") DOES NOT EXIST** — charter/planned concept only (docs/specs, docs/designs), no source/package/bin.
- Precedent for git/gh subprocess = ONLY scripts + CI (`scripts/version-rewrite.js`, `scripts/local/build-hub.sh:163` git rev-parse, `.github/workflows/release-plugin.yml`). The python-tool scaffold = `scripts/calibrations/calibrations.py` (argparse CLI over a YAML ledger, repo-root from `__file__`).

**Decision needed (architect's call):**
- **(A) git-aware CLI script** (scripts/reconciliation/, calibrations.py-style) computes ancestry+scope locally + writes dispositions back via Hub MCP (update_bug). RECOMMENDED — honest git-truth; matches precedent; the "reconciliation-FIRST gate, zero-cost at stint-open" = an operator/CI runs it.
- **(B) Hub MCP verb** using GitHub REST `/compare` for approximate ancestry — Hub-native (idea-364's framing) but degraded (no local-main; rate-limited; can't do merge-base).
- **(C) CI job** (.github/workflows) computes + writes back.

## Ground-truth map (file:line)
- **Bug entity:** `hub/src/entities/bug.ts:25-63` (interface Bug; fixCommits :52, fixRevision :53, status :22). `IBugStore` :75-136, `updateBug` whitelist :113-126 (new field must be added here to be writable).
- **Bug substrate schema:** `hub/src/storage-substrate/schemas/all-schemas.ts:91-112` (renameMap :111 = the field-path authority; add e.g. `scope: "spec.scope"`).
- **Bug repo:** `hub/src/entities/bug-repository-substrate.ts` (cloneBug :41, createBug :86-106, updateBug :162-196; listBugs :131-160 = read-all).
- **Bug policy tools:** `hub/src/policy/bug-policy.ts` (create_bug zod+handler :196/:34, update_bug :229/:121; **BUG_FSM guard :136-157 — resolved/wontfix TERMINAL, no re-open**; backfilling fixCommits w/o status-change fires no event :178-182).
- **/health:** `hub/src/hub-networking.ts:884-903` — returns `gitSha` (deployed-revision = prod live-state) + version/toolSurfaceRevision/builtAt.
- **Field-addition precedent:** bug-118 (commit 806917a — sourceThreadId/sourceMissionId on create_bug: tool zod + bug-policy.createBug + BugRepositorySubstrate.createBug + IBugStore). Tightest mirror.
- **Hub job pattern (if server-side bits):** sweepers in `hub/src/index.ts` (WorkItemLeaseSweeper :812, model = `work-item-lease-sweeper.ts:37-67`; env-var interval + setInterval).

## Constraints / dependencies
- **update_bug FSM terminal:** resolved/wontfix can't re-open → the "claims-fixed-but-not-in-main" bucket can FLAG (report) but can't auto-re-open a wrongly-resolved bug. Backfill-only (fixCommits w/o status change) is allowed + event-silent.
- **Bug repo/scope field is Hub-side + needed in ALL options** (bounded; bug-118 precedent).
- **DEPENDENCY — steve's work-50:** parallel bug-ledger fixCommits-hygiene audit hands the EXACT empirical stale-list + bucket counts; the reconciliation stale-detector should VALIDATE against his ground-truth when it lands (lily's coordination note).

## ARCHITECTURE RATIFIED (lily, 2026-06-28): Option A
git-aware repo-context CLI (scripts/reconciliation/, calibrations.py-style). B rejected (degraded REST-API ancestry trades away the one thing reconciliation provides — git-truth). C (CI cron of the same script) = a later complement. **oisctl DROPPED from the design** (my catch corrected idea-364's framing; lily updating the idea). The tool = sibling of calibrations.py: READS git-truth + the Hub bug-list, WRITES dispositions back.

**Write-back contract (respect the terminal-FSM constraint I flagged):**
- AUTO-write ONLY the safe additive bucket: empty-fixCommits → backfill the merge-base-verified squash sha (gh pr view <n> --json mergeCommit). Event-silent (the bug-181 backfill, mechanized).
- REPORT-ONLY (NO auto-mutate): claims-fixed-but-not-in-main + fixed-but-still-open → a clean actionable list for lily's disposition (a sha in main ≠ proof of fix; never auto-resolve/reopen on a heuristic).
- RE-OPEN (resolved→open walk-back) is OUT of R2 (lily files a follow-on); R2 just REPORTS the claims-fixed bucket (its size motivates the FSM change).
- COORDINATE with steve's work-50 empirical stale-list; build against my own enumeration + cross-check his when it lands (steve cognitively unresponsive now — do NOT block).

## SPLIT: pt 1 = Bug repo field (this PR) · pt 2 = reconciliation CLI (next)

### pt 1 — Bug repo-scope field — BUILT (2026-06-28)
Field: `repo: string | null` (slug, e.g. "apnex/missioncraft"; null = home repo/unclassified). Hub-side, additive, needed in all options. bug-118 precedent.
Files (7): bug.ts (interface + IBugStore create-opt + updateBug whitelist) · all-schemas.ts (renameMap repo→spec.repo) · bug-repository-substrate.ts (createBug default + updateBug applier + cloneBug default-null) · bug-policy.ts (create_bug+update_bug zod+handler+desc) · bug-repository-substrate.test.ts (+real-pg round-trip) · wave3b-policies.test.ts (+policy pass-through) · renamemap-contract-w1.test.ts (inventory + encoder-placement probe).
Verify: hub tsc clean; FULL suite green (2134 passed) on the fresh work-47-bug-repo-field branch off origin/main. MUTATIONS: createBug applier→null fails the round-trip (non-vacuous, restored); the renameMap-contract test CAUGHT the renameMap change (good guard) → inventory updated + the W1.1b probe now asserts the encoder places repo at spec.repo (envelope-correctness proof). Note: the renameMap entry is NOT load-bearing for the round-trip (unmapped fields partition to spec.* anyway — verified by mutation) but IS kept for filter-translate authority (CLAUDE.md) + the explicit severity/class precedent.
GATE: Hub backplane substrate change → steve verifier-gate; hub/** → deploy batch.

### pt 2 — reconciliation CLI — NEXT
scripts/reconciliation/ (calibrations.py-style). Reads Hub bug-list (list_bugs / psql) + git-truth (merge-base --is-ancestor, gh pr view mergeCommit) + /health gitSha; computes the 3 buckets; auto-backfills empty-fixCommits; reports the other two. Validate buckets vs steve's work-50.

Both leases (work-46 in_progress pending #401 merge; work-47 in_progress) held + renewed.
