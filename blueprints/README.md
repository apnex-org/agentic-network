# Blueprints — reusable `seed_blueprint` templates

This directory holds **reusable `seed_blueprint` templates**: declarative WorkItem-graph manifests the architect instantiates onto the Hub work-queue via the `seed_blueprint` verb (idea-380 S2). The point is to **engineer them once and reuse them** — version-controlled, reviewable, refined across runs.

## What a blueprint is (and what it is NOT)
- A **blueprint** = a finite DAG of WorkItem nodes (each `localId`-keyed, with `dependsOn` / `completionDependsOn` edges, a `runbook`, `references`, `evidenceRequirements`, and `roleEligibility`). Expanded onto the **real** work-queue and executed by the **real agents** (lily / greg / steve). This is the org's coordination substrate.
- **NOT** `.claude/workflows/` — those are the Workflow-tool's *architect-local sub-agent* scripts (private tooling for analysis/synthesis; not real-agent orchestration).
- **NOT** `.github/workflows/` — those are CI.

> Naming note: the Director referred to a "workflows directory"; this is named `blueprints/` to avoid colliding with the two existing `workflows/` dirs above, and because "blueprint" is our established term for a `seed_blueprint` template. Rename on request.

## Convention
- One template per file: `<name>.blueprint.json` (the `{runId, nodes:[...]}` graph) + optional `<name>.md` (design/rationale).
- Templates are **parameterized**: the `runId` and run-specific references (evidence paths, target refs, the candidate slate) are supplied at seed-time, not baked in. Document each template's parameters at the top of its file.
- **Validate before seeding**: `seed_blueprint({ runId, nodes, dryRun: true })` validates the whole graph fail-closed (dup/dangling localId, cycles, per-node runbook+required-refs, node-cap) before creating anything.
- **Engineer them**: refine the node-graph + runbooks across runs; fold each run's friction back into the template (the autopoietic loop).

## The library (dark-run Phase-1 distillation)
| Template | Purpose | Status |
|---|---|---|
| `strategic-review` | autonomous agent-self-determined next-stint priority ranking (idea-389) | **first resident** — landing here once the idea-389 run is seeded + proven |
| `council` | POSITION × role-lens → CLASH → ADJUDICATE (the stint-5 design-council shape) | planned |
| `survey` | Director-intent / autonomous survey → Design | planned |
| `design-session` | diverse positions → integrate → adversarial critique | planned |
| `review-ship` | review dimensions → adversarial-verify → merge | planned |
| `arc-program` | nested arc-of-missions (recursive `seed_blueprint`) | planned |

Each template lands here as it is distilled and proven on a real run.
