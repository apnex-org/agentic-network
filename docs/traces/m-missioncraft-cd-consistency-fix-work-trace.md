# M-Missioncraft-cd-consistency-fix — Work Trace (live state)

Mission-82 — v1.2.4 single-bug hotfix. bug-92 (Director-reported from v1.2.3 hands-on): a bug-88 followon — bare `msn <id> cd`/`workspace` resolves to mission-root for MULTI-repo but drops into the sole repo for SINGLE-repo (inconsistency). Director ratified Option A: bare cd/workspace ALWAYS → mission-root. Class: pre-substrate-cleanup. apnex/missioncraft package; Pattern A direct-commit-to-main.

Trace conventions: see `docs/methodology/trace-management.md`.

## Resumption pointer (cold-session brief)

1. **Mission:** mission-82 (M-Missioncraft-cd-consistency-fix), Director-ratified 2026-05-15; Survey waived; single-bug hotfix. Kickoff thread: **thread-560**.
2. **Current in-flight:** slice (i) bug-92 — just claimed; diagnosis starting.
3. **Repo state:** apnex/missioncraft `main` at `fef74e9` (post-mission-81; v1.2.3 npm-live).
4. **Next-up:** slice (ii) architect-dogfood wire-flow gate (architect-side; NOT WAIVABLE), slice (iii) ship (1.2.3 → 1.2.4 + release).
5. **Open engineer-judgment calls:** none yet — Option A is Director-ratified; scope is clear.

## In-flight

- ▶ **slice (i) bug-92** — bare `msn <id> cd`/`workspace` single/multi-repo inconsistency. `core/missioncraft.ts workspace()` single-repo bare-form branch resolves to the sole repo subdir; change to mission-root (matching the multi-repo bare-form bug-88 introduced). Per calibration #79+#80: enumerate the full input-case-set (bare-single / bare-multi / named-repo / coord-form) — make bare-single + bare-multi consistent WITHOUT regressing named or coord.

## Queued / filed

- ○ **slice (ii)** — architect-dogfood wire-flow gate — architect-side; NOT WAIVABLE.
- ○ **slice (iii)** — version-bump 1.2.3 → 1.2.4 + release.yml + Director Release-gate.

## Done this session

_(nothing shipped yet — mission just kicked off)_

## Edges (dependency chains)

```
slice (i) bug-92 ──> slice (ii) architect-dogfood ──> slice (iii) ship (v1.2.4)
                          (NOT WAIVABLE)              (Director Release-gate)
```

## Session log (append-only)

- **2026-05-15 mid** — mission-82 kicked off via thread-560 (architect; Director-ratified 2026-05-15, Survey waived). Single-bug v1.2.4 hotfix: bug-92 — bug-88 followon, bare cd/workspace single/multi-repo inconsistency. Director ratified Option A (consistency): bare → mission-root always. 3 slices: bug-92 fix + architect-dogfood + ship. Work-trace created at mission-start per per-mission trace discipline. Slice (i) bug-92 claimed; diagnosis starting.

## Canonical references

- **Kickoff thread:** thread-560 (Hub coordination thread, correlationId mission-82)
- **Hub mission entity:** mission-82 — status active; 3 plannedTasks
- **Trace how-to:** `docs/methodology/trace-management.md`
- **Repo:** apnex/missioncraft — package root `/home/apnex/taceng/missioncraft`; `main` at `fef74e9`
- **Prior mission ship:** mission-81 v1.2.3 (npm-live; cleared bug-85/86/87/88/89/90/91 + 3 macos flakes)
- **Source bug context:** bug-92 is a bug-88 (mission-81 slice ii) followon — bug-88 fixed the multi-repo bare-form error but left single-repo unchanged, creating the split
- **Operating disciplines:** calibration #76 (ship-verify 3-layer), #77 (CI-status incl. macos), #79 (grep-whole-flow), #80 (enumerate the full input-case-set — the #79 inverse, from mission-81 bug-85)
