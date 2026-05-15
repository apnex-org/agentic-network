# M-Missioncraft-cd-consistency-fix — Work Trace (live state)

Mission-82 — v1.2.4 single-bug hotfix. bug-92 (Director-reported from v1.2.3 hands-on): a bug-88 followon — bare `msn <id> cd`/`workspace` resolves to mission-root for MULTI-repo but drops into the sole repo for SINGLE-repo (inconsistency). Director ratified Option A: bare cd/workspace ALWAYS → mission-root. Class: pre-substrate-cleanup. apnex/missioncraft package; Pattern A direct-commit-to-main.

Trace conventions: see `docs/methodology/trace-management.md`.

## Resumption pointer (cold-session brief)

1. **Mission:** mission-82 (M-Missioncraft-cd-consistency-fix), Director-ratified 2026-05-15; Survey waived; single-bug hotfix. Kickoff thread: **thread-560**.
2. **Current in-flight:** nothing claimed. slices (i)+(iii) SHIPPED; slice (ii) dogfood 5/5 PASS; standby for Director Release-gate verdict.
3. **Repo state:** apnex/missioncraft `main` at `ee5d4c5` (slice (i)+(iii) shipped; v1.2.4-prep — version bumped, CHANGELOG written, NOT tagged; CI monitoring `ee5d4c5`).
4. **Next-up:** Director Release-gate verdict → on PROCEED: tag-push `v1.2.4` cascade (release.yml + npm publish + registry verify).
5. **Open engineer-judgment calls:** none.

## In-flight

_(nothing claimed — slice (iii) ship-prep shipped; awaiting Director Release-gate)_

## Queued / filed

_(nothing — all engineer-side slices shipped; awaiting Director Release-gate verdict for tag-push cascade)_

## Done this session

- ✅ **slice (i) bug-92** — bare cd/workspace always → mission-root. apnex/missioncraft commit `33afe95`. Removed the single-repo auto-pick from `workspace()`'s `targetRepoName` ternary — bare-single AND bare-multi now both fall through to the existing mission-root branch (added in bug-88); named-repo + coord-form unchanged. Per calibration #79+#80 enumerated all 4 cases (bare-single / bare-multi / named / coord) + live-verified each. Test changes: rewrote `workspace-resolution.test.ts:67` (auto-pick → mission-root); NEW named-single regression-net test; idea-268 safety-net assertion updated to match new mission-root-absent message; name-resolution comment updated. 607/607 + tsc-strict clean. No 5th case-shape; fix did NOT touch the shell-init wrapper. Surfaced thread-560.
- ✅ **slice (iii) ship-prep** — apnex/missioncraft commit `ee5d4c5`. Architect slice (ii) wire-flow gate dogfood 5/5 PASS (bare cd single + multi → mission-root; named cd both repo-counts → repo subdir; workspace mirrors cd; coord-form unchanged). Version bump 1.2.3→1.2.4 (4 sites: package.json + SDK VERSION + version.test.ts + CLI renderVersion docblock; HELP_TEXT auto-via interpolation) + operator-facing CHANGELOG 1.2.4 single-bug entry (bug-92 cd-consistency). NO tag — HOLD for Director Release-gate per architect §4 + calibration #77. 607/607 + tsc-strict clean; `msn --version` → 1.2.4. CI monitoring `ee5d4c5`. Surfaced thread-560.

## Edges (dependency chains)

```
slice (i) bug-92 ──> slice (ii) architect-dogfood ──> slice (iii) ship (v1.2.4)
                          (NOT WAIVABLE)              (Director Release-gate)
```

## Session log (append-only)

- **2026-05-15 mid** — mission-82 kicked off via thread-560 (architect; Director-ratified 2026-05-15, Survey waived). Single-bug v1.2.4 hotfix: bug-92 — bug-88 followon, bare cd/workspace single/multi-repo inconsistency. Director ratified Option A (consistency): bare → mission-root always. 3 slices: bug-92 fix + architect-dogfood + ship. Work-trace created at mission-start per per-mission trace discipline. Slice (i) bug-92 claimed; diagnosis starting.
- **2026-05-15 mid (continuation)** — slice (i) bug-92 shipped at `33afe95`. Removed the single-repo auto-pick from `workspace()`'s `targetRepoName` ternary; bare-single + bare-multi now both fall through to the bug-88-added mission-root branch. Per calibration #79+#80 enumerated all 4 input cases (bare-single / bare-multi / named-repo / coord-form) + live-verified each — the inverse-shape lesson from mission-81 slice v.a applied prospectively. 607/607 + tsc-strict clean; rewrote 1 test, added 1 regression-net for the named-path, updated 1 safety-net assertion + 1 stale comment. No 5th case-shape; fix contained to `workspace()` (didn't touch the shell-init wrapper as kickoff §5 predicted). Surfaced thread-560.
- **2026-05-15 mid (continuation)** — architect slice (ii) wire-flow gate dogfood COMPLETE: **5/5 PASS** against `33afe95` (synced/rebuilt/clean-reinstalled) — bare cd single + multi → mission-root, named cd both repo-counts → repo subdir, workspace mirrors cd, coord-form unchanged + live wrapper-eval intercepted both bare and named id-first cd correctly. slice (iii) ship-prep AUTHORIZED. slice (iii) ship-prep shipped at `ee5d4c5`: version bump 1.2.3→1.2.4 (4 sites) + operator-facing CHANGELOG 1.2.4 single-bug entry. NO tag — HOLD for Director Release-gate per architect §4. 607/607 + tsc-strict clean; `msn --version` → 1.2.4. CI monitoring `ee5d4c5`. Surfaced thread-560. ALL engineer-side mission-82 slices COMPLETE; standby for Director Release-gate.

## Canonical references

- **Kickoff thread:** thread-560 (Hub coordination thread, correlationId mission-82)
- **Hub mission entity:** mission-82 — status active; 3 plannedTasks
- **Trace how-to:** `docs/methodology/trace-management.md`
- **Repo:** apnex/missioncraft — package root `/home/apnex/taceng/missioncraft`; `main` at `fef74e9`
- **Prior mission ship:** mission-81 v1.2.3 (npm-live; cleared bug-85/86/87/88/89/90/91 + 3 macos flakes)
- **Source bug context:** bug-92 is a bug-88 (mission-81 slice ii) followon — bug-88 fixed the multi-repo bare-form error but left single-repo unchanged, creating the split
- **Operating disciplines:** calibration #76 (ship-verify 3-layer), #77 (CI-status incl. macos), #79 (grep-whole-flow), #80 (enumerate the full input-case-set — the #79 inverse, from mission-81 bug-85)
