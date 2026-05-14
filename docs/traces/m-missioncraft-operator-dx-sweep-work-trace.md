# M-Missioncraft-Operator-DX-Sweep — Work Trace (live state)

Mission-81 — v1.2.3 hotfix bundle. 5 Director-reported operator-DX bugs (bug-85/86/87/88/89) from hands-on v1.2.2 testing + 3-test macos-matrix vitest flake clearance carried forward from mission-79/80. Class: pre-substrate-cleanup. apnex/missioncraft package; Pattern A direct-commit-to-main.

Trace conventions: see `docs/methodology/trace-management.md`.

## Resumption pointer (cold-session brief)

1. **Mission:** mission-81 (M-Missioncraft-Operator-DX-Sweep), Director-ratified 2026-05-14; Survey waived; engineer-judgment cluster-batching. Kickoff thread: **thread-558**.
2. **Current in-flight:** nothing claimed. slices (i) + (ii) SHIPPED; surfaced on thread-558; standby for architect ACK or autonomous cascade to slice (iii).
3. **Repo state:** apnex/missioncraft `main` at `423d194` (slices (i)+(ii) shipped; v1.2.3-prep).
4. **Next-up:** slice (iii) output-rendering cluster (bug-86 + bug-87), slice (iv) macos-flake clearance (standalone), slice (v) architect-dogfood wire-flow gate (NOT WAIVABLE), slice (vi) ship (1.2.2 → 1.2.3 + release).
5. **Open engineer-judgment calls:** (a) does abandon-from-`created` converge with the roadmapped `msn delete` verb? — surface disposition at slice (i); (b) bug-87 scoped-help scope-narrow vs generic verb-tree refactor.

## In-flight

_(nothing claimed — slice (i) shipped; awaiting architect ACK or autonomous cascade)_

## Queued / filed

- ○ **slice (iii)** — bug-86 (scope list table) + bug-87 (scoped help) — output-rendering cluster. Surface-trigger: bug-87 may generalize into verb-tree-wide help refactor.
- ○ **slice (iv)** — 3-test macos-matrix vitest flake clearance — test-infra; standalone discovery-arc. Surface rather than dig indefinitely if structural.
- ○ **slice (v)** — architect-dogfood wire-flow gate — architect-side; NOT WAIVABLE.
- ○ **slice (vi)** — version-bump 1.2.2 → 1.2.3 + release.yml + Director Release-gate.
- ⏸ **BRANCH-TRACKER terminal-state semantic asymmetry** — Director-ratified OUT of mission-81 scope; design-refinement, standalone design-question later.

## Done this session

- ✅ **slice (i) bug-85** — abandon-from-`created` FSM-gap fix. apnex/missioncraft commit `200c3b9`. Entry lifecycle-precheck extended to accept `created`; new minimal-teardown branch (created mission has only config + maybe .names symlink — no workspace/daemon/lock/branches; the full teardown flow's inspectLocks gate would reject "mission-lock absent"). Branch-early design means downstream gates never reached for `created` — only the entry-precheck needed the state (contrast bug-83's 4-gate fan-out). Engineer-judgment disposition (architect §3.4): abandon-from-created kept SEPARATE from `msn delete` — uniform with abandon-from-started (produces 'abandoned' tombstone; --purge-config is universal opt-in for full removal). 5 test-fixtures migrated to new 4-element precheck message; 2 new bug-85 regression tests. 576/576 + tsc-strict clean. Live CLI smoke verified. Surfaced thread-558.
- ✅ **slice (ii) bug-89 + bug-88** — cd/workspace-nav cluster. apnex/missioncraft commit `423d194`. **bug-89** (major): emitShellInit wrapper (bash/zsh/fish) now intercepts the W6-new id-first `msn <id> cd [<repo>]` form (`$2 == "cd"` + `$1` matches `msn-<8hex>` guard) in addition to the legacy `$1 == "cd"` verb-first/coord-form; routes to `command msn "$1" workspace ...`. **bug-88** (minor): `mc.workspace()` bare multi-repo case returns the mission-root dir instead of throwing "repoName arg required"; throws MissionStateError only if mission-root absent on-disk. workspace-resolution test migrated (rejects→resolves-to-root + absent-root throw path); NEW v1.2.3-bug89-shell-init-id-first.test.ts (7 tests — evals the real wrapper in a bash subprocess with stub `msn` on PATH; the coverage gap that let bug-89 ship). No kickoff-§6 shell-grammar discovery-arc surfaced — bounded 2-branch wrapper addition. 584/584 + tsc-strict clean. Live: eval'd wrapper, id-first cd changed cwd to mission-root. Surfaced thread-558.

## Edges (dependency chains)

```
slice (i) bug-85 ──┐
slice (ii) cluster ─┤
slice (iii) cluster ┼──> slice (v) architect-dogfood ──> slice (vi) ship (v1.2.3)
slice (iv) macos ───┘         (NOT WAIVABLE)              (Director Release-gate)
```

Slices (i)-(iv) are independent — engineer-judgment cluster-batching, any order. Slice (v) gates on all four landing. Slice (vi) gates on slice (v) PASS.

## Session log (append-only)

- **2026-05-14 mid** — mission-81 kicked off via thread-558 (architect; Director-ratified 2026-05-14, Survey waived). 6-slice operator-DX sweep: bug-85 (abandon-from-created FSM-gap) + bug-89/88 (cd-nav cluster) + bug-86/87 (output-rendering cluster) + macos-flake clearance + architect-dogfood + ship. Work-trace created at mission-start per per-mission trace discipline (`feedback_per_mission_work_trace_obligation.md` — corrective after mission-79/80 ran trace-less). Slice (i) bug-85 claimed; diagnosis starting.
- **2026-05-14 mid (continuation)** — slice (i) bug-85 shipped at `200c3b9`. abandon's entry lifecycle-precheck extended to accept `created`; new minimal-teardown branch handles the no-workspace/no-daemon/no-lock/no-branches case (the full flow's inspectLocks inheritance gate would otherwise reject "mission-lock absent"). Calibration #79 applied — branch-early means only the single entry-precheck needed the state, not the 5-gate fan-out bug-83 hit. Engineer-judgment §3.4 disposition: abandon-from-created kept SEPARATE from `msn delete` (uniform-with-abandon-from-started tombstone semantics). 5 fixtures migrated + 2 new regression tests; 576/576 + tsc-strict clean; live CLI smoke verified. Surfaced thread-558. Cosmetic observation surfaced (not fixed): CLI abandon success line says "workspace removed; daemon stopped" even for created missions that had neither — flagged for architect disposition.
- **2026-05-14 mid (continuation)** — slice (ii) cd/workspace-nav cluster shipped at `423d194` (bug-89 + bug-88 batched). bug-89: W6-new id-first migration left the shell-init wrapper matching only the old verb-first `$1 == "cd"`; emitShellInit now also intercepts id-first `msn <id> cd` via a `$2 == "cd"` + mission-id-pattern-on-`$1` branch (bash/zsh/fish). bug-88: `mc.workspace()` bare multi-repo case returns mission-root instead of throwing. New bash-subprocess test evals the real wrapper with a stub `msn` on PATH (the missing coverage that let bug-89 ship); workspace-resolution test migrated. 584/584 + tsc-strict clean; live wrapper-eval verified id-first cd cwd-change. No kickoff-§6 shell-grammar discovery-arc — bounded fix. Surfaced thread-558.

## Canonical references

- **Kickoff thread:** thread-558 (Hub coordination thread, correlationId mission-81)
- **Hub mission entity:** mission-81 — status active; 6 plannedTasks
- **Trace how-to:** `docs/methodology/trace-management.md`
- **Repo:** apnex/missioncraft — package root `/home/apnex/taceng/missioncraft`; `main` at `ca6bde7`
- **Prior mission ship:** mission-80 v1.2.2 (npm-live; CHANGELOG.md at `ca6bde7`)
- **Operating disciplines:** calibration #76 (ship-verify 3-layer), #77 (CI-status in Release-gate), #79 (grep-whole-flow for cross-cutting gate fixes)
