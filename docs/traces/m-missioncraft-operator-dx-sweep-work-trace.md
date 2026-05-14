# M-Missioncraft-Operator-DX-Sweep — Work Trace (live state)

Mission-81 — v1.2.3 hotfix bundle. 5 Director-reported operator-DX bugs (bug-85/86/87/88/89) from hands-on v1.2.2 testing + 3-test macos-matrix vitest flake clearance carried forward from mission-79/80. Class: pre-substrate-cleanup. apnex/missioncraft package; Pattern A direct-commit-to-main.

Trace conventions: see `docs/methodology/trace-management.md`.

## Resumption pointer (cold-session brief)

1. **Mission:** mission-81 (M-Missioncraft-Operator-DX-Sweep), Director-ratified 2026-05-14; Survey waived; engineer-judgment cluster-batching. Kickoff thread: **thread-558**.
2. **Current in-flight:** slice (i) bug-85 — abandon-from-`created`-state FSM-gap. Just claimed; diagnosis starting.
3. **Repo state:** apnex/missioncraft `main` at `ca6bde7` (post-mission-80; v1.2.2 npm-live + CHANGELOG.md shipped).
4. **Next-up after slice (i):** slice (ii) cd/workspace-nav cluster (bug-89 + bug-88), slice (iii) output-rendering cluster (bug-86 + bug-87), slice (iv) macos-flake clearance (standalone), slice (v) architect-dogfood wire-flow gate (NOT WAIVABLE), slice (vi) ship (1.2.2 → 1.2.3 + release).
5. **Open engineer-judgment calls:** (a) does abandon-from-`created` converge with the roadmapped `msn delete` verb? — surface disposition at slice (i); (b) bug-87 scoped-help scope-narrow vs generic verb-tree refactor.

## In-flight

- ▶ **slice (i) bug-85** — abandon rejects `created`-state missions; FSM-gap. Diagnosis starting. Per calibration #79: grep the WHOLE abandon flow for lifecycle-prechecks (bug-83 4-gate precedent).

## Queued / filed

- ○ **slice (ii)** — bug-89 (shell-init wrapper id-first) + bug-88 (cd mission-root) — cd/workspace-nav cluster. Surface-trigger: bug-89 wrapper is shell-script-generated, NOT TS-test-covered — expect discovery-arc.
- ○ **slice (iii)** — bug-86 (scope list table) + bug-87 (scoped help) — output-rendering cluster. Surface-trigger: bug-87 may generalize into verb-tree-wide help refactor.
- ○ **slice (iv)** — 3-test macos-matrix vitest flake clearance — test-infra; standalone discovery-arc. Surface rather than dig indefinitely if structural.
- ○ **slice (v)** — architect-dogfood wire-flow gate — architect-side; NOT WAIVABLE.
- ○ **slice (vi)** — version-bump 1.2.2 → 1.2.3 + release.yml + Director Release-gate.
- ⏸ **BRANCH-TRACKER terminal-state semantic asymmetry** — Director-ratified OUT of mission-81 scope; design-refinement, standalone design-question later.

## Done this session

_(nothing shipped yet — mission just kicked off)_

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

## Canonical references

- **Kickoff thread:** thread-558 (Hub coordination thread, correlationId mission-81)
- **Hub mission entity:** mission-81 — status active; 6 plannedTasks
- **Trace how-to:** `docs/methodology/trace-management.md`
- **Repo:** apnex/missioncraft — package root `/home/apnex/taceng/missioncraft`; `main` at `ca6bde7`
- **Prior mission ship:** mission-80 v1.2.2 (npm-live; CHANGELOG.md at `ca6bde7`)
- **Operating disciplines:** calibration #76 (ship-verify 3-layer), #77 (CI-status in Release-gate), #79 (grep-whole-flow for cross-cutting gate fixes)
