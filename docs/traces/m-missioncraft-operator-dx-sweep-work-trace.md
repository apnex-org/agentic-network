# M-Missioncraft-Operator-DX-Sweep — Work Trace (live state)

Mission-81 — v1.2.3 hotfix bundle. 5 Director-reported operator-DX bugs (bug-85/86/87/88/89) from hands-on v1.2.2 testing + 3-test macos-matrix vitest flake clearance carried forward from mission-79/80. Class: pre-substrate-cleanup. apnex/missioncraft package; Pattern A direct-commit-to-main.

Trace conventions: see `docs/methodology/trace-management.md`.

## Resumption pointer (cold-session brief)

1. **Mission:** mission-81 (M-Missioncraft-Operator-DX-Sweep), Director-ratified 2026-05-14; Survey waived; engineer-judgment cluster-batching. Kickoff thread: **thread-558**.
2. **Current in-flight:** nothing claimed. slices (i)+(ii)+(iii) SHIPPED; surfaced on thread-558; standby for architect ACK or autonomous cascade to slice (iv).
3. **Repo state:** apnex/missioncraft `main` at `698252d` (slices (i)+(ii)+(iii) shipped; v1.2.3-prep).
4. **Next-up:** slice (iv) macos-flake clearance (standalone — test-infra discovery-arc), slice (v) architect-dogfood wire-flow gate (NOT WAIVABLE), slice (vi) ship (1.2.2 → 1.2.3 + release).
5. **Open engineer-judgment calls:** (a) does abandon-from-`created` converge with the roadmapped `msn delete` verb? — surface disposition at slice (i); (b) bug-87 scoped-help scope-narrow vs generic verb-tree refactor.

## In-flight

_(nothing claimed — slice (i) shipped; awaiting architect ACK or autonomous cascade)_

## Queued / filed

- ○ **slice (iv)** — 3-test macos-matrix vitest flake clearance — test-infra; standalone discovery-arc. Surface rather than dig indefinitely if structural.
- ○ **slice (v)** — architect-dogfood wire-flow gate — architect-side; NOT WAIVABLE.
- ○ **slice (vi)** — version-bump 1.2.2 → 1.2.3 + release.yml + Director Release-gate.
- ○ **DISCOVERED (slice iii)** — `mc.list('scope')` silently drops scopes whose YAML fails getScope parse (`listScopes` `catch { skip }`); root cause = repo-name-regex create/read asymmetry (1-char names) + silent-swallow. Surfaced thread-558; awaiting architect disposition (likely a mission-81 add-on or mission-82 candidate).
- ○ **DISCOVERED (slice iii)** — help-form verb-path extraction absorbs trailing global-flag VALUES. Surfaced thread-558; awaiting disposition.
- ⏸ **BRANCH-TRACKER terminal-state semantic asymmetry** — Director-ratified OUT of mission-81 scope; design-refinement, standalone design-question later.
- ⏸ **Generic verb-tree-wide level-scoped help** — bug-87 scope-narrowed to `msn <id> help`; the generic refactor (`msn scope help`, `msn <id> update help`) is a FEATURE/idea-candidate, surfaced thread-558.

## Done this session

- ✅ **slice (i) bug-85** — abandon-from-`created` FSM-gap fix. apnex/missioncraft commit `200c3b9`. Entry lifecycle-precheck extended to accept `created`; new minimal-teardown branch (created mission has only config + maybe .names symlink — no workspace/daemon/lock/branches; the full teardown flow's inspectLocks gate would reject "mission-lock absent"). Branch-early design means downstream gates never reached for `created` — only the entry-precheck needed the state (contrast bug-83's 4-gate fan-out). Engineer-judgment disposition (architect §3.4): abandon-from-created kept SEPARATE from `msn delete` — uniform with abandon-from-started (produces 'abandoned' tombstone; --purge-config is universal opt-in for full removal). 5 test-fixtures migrated to new 4-element precheck message; 2 new bug-85 regression tests. 576/576 + tsc-strict clean. Live CLI smoke verified. Surfaced thread-558.
- ✅ **slice (ii) bug-89 + bug-88** — cd/workspace-nav cluster. apnex/missioncraft commit `423d194`. **bug-89** (major): emitShellInit wrapper (bash/zsh/fish) now intercepts the W6-new id-first `msn <id> cd [<repo>]` form (`$2 == "cd"` + `$1` matches `msn-<8hex>` guard) in addition to the legacy `$1 == "cd"` verb-first/coord-form; routes to `command msn "$1" workspace ...`. **bug-88** (minor): `mc.workspace()` bare multi-repo case returns the mission-root dir instead of throwing "repoName arg required"; throws MissionStateError only if mission-root absent on-disk. workspace-resolution test migrated (rejects→resolves-to-root + absent-root throw path); NEW v1.2.3-bug89-shell-init-id-first.test.ts (7 tests — evals the real wrapper in a bash subprocess with stub `msn` on PATH; the coverage gap that let bug-89 ship). No kickoff-§6 shell-grammar discovery-arc surfaced — bounded 2-branch wrapper addition. 584/584 + tsc-strict clean. Live: eval'd wrapper, id-first cd changed cwd to mission-root. Surfaced thread-558.
- ✅ **slice (iii) bug-86 + bug-87** — output-rendering cluster. apnex/missioncraft commit `698252d`. **bug-86** (minor): `msn scope list` now defaults to a column-aligned table (`id/name/lifecycle/repos-count`, `+referenced-by` with `--include-references`) — operator-DX parity with `msn list`; `--output json|yaml` is the opt-in. **bug-87** (minor): `msn <id> help` / `msn <id> --help` now emit mission-targeted-verb scoped help instead of the global dump — parser carries `missionRef` through both help short-circuits; new `renderMissionTargetedHelp()` in help-renderer.ts; bin.ts dispatches on `parsed.missionRef`. Engineer-judgment (architect §6): scope-narrowed to `msn <id> help` (the reported bug); generic verb-tree-wide level-scoped help deferred as idea-candidate. NEW v1.2.3-slice-iii-output-rendering.test.ts (8 tests). 592/592 + tsc-strict clean. **2 defects DISCOVERED during verification + surfaced thread-558** (not fixed — separate scope): mc.list('scope') silent-drop via `catch{skip}` (repo-name-regex create/read asymmetry); help-form verb-path absorbs trailing global-flag values.

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
- **2026-05-14 mid (continuation)** — slice (iii) output-rendering cluster shipped at `698252d` (bug-86 + bug-87 batched). bug-86: `msn scope list` defaults to table (formatTable, operator-DX parity with `msn list`); json opt-in. bug-87: `msn <id> help` parser-discarded the mission-id → global-help dump; fixed by carrying `missionRef` through both parser help short-circuits + new `renderMissionTargetedHelp()`; scope-narrowed per architect §6 (generic level-scoped help deferred as idea-candidate). 8 new tests; 592/592 + tsc-strict clean. **Verification surfaced 2 separate defects** (per `feedback_verification_defect_surface_dont_dig.md` — probed root-cause to make surface actionable, did NOT fix inline): (1) `mc.list('scope')` silently drops parse-failing scopes — `listScopes` `catch{skip}` + repo-name-regex create/read asymmetry (1-char derived names); (2) help-form verb-path extraction absorbs trailing global-flag values. Both surfaced thread-558 for architect disposition.

## Canonical references

- **Kickoff thread:** thread-558 (Hub coordination thread, correlationId mission-81)
- **Hub mission entity:** mission-81 — status active; 6 plannedTasks
- **Trace how-to:** `docs/methodology/trace-management.md`
- **Repo:** apnex/missioncraft — package root `/home/apnex/taceng/missioncraft`; `main` at `ca6bde7`
- **Prior mission ship:** mission-80 v1.2.2 (npm-live; CHANGELOG.md at `ca6bde7`)
- **Operating disciplines:** calibration #76 (ship-verify 3-layer), #77 (CI-status in Release-gate), #79 (grep-whole-flow for cross-cutting gate fixes)
