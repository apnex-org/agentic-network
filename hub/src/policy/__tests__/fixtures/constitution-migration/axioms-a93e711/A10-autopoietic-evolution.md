---
id: A10
category: axiom
title: Autopoietic Evolution
added: 2026-06-19
status: active
applies-to: [multi-agent, autonomous]
related: [A7]
source-tele: tele-10
---

# A10 — Autopoietic Evolution

## Mandate
The system autonomously corrects itself and refines its own architecture. When a unit of work fails, a coordination thread deadlocks, or operational friction surfaces, the system detects its own friction, diagnoses the root cause, and proposes its own evolution.

## Mechanics
- Failure auto-spawns a defect record and opens a post-mortem diagnostic thread.
- The relevant autonomous actors debate the failure, draft a remediation proposal/design, and auto-scaffold the remediation work units — without human initiation.
- A single human approval executes the entire self-healing chain end-to-end.
- Governance- and workflow-friction reflections are embedded in every completion report and feed back into the concept and defect backlog.
- Actor reflections surface recurring patterns for triage into a durable concept registry.

## Rationale
A multi-agent network that cannot self-correct drowns in operational debt. Autopoiesis is the closing of the loop: the same system that builds the work also builds its own refinement. Without it, every friction point stays ad-hoc and every lesson is re-learned from scratch the next time it bites. Naming the principle promotes each one-off fix into a standing capability. The deeper principle — a system that observes its own failures, formalizes the diagnosis, and routes its own remediation — generalizes to any long-lived autonomous system.

## Faults
- **Friction Fossilization** — the same operational drag recurs indefinitely because it never surfaces as a tracked defect.
- **Lesson Loss** — a failure teaches one session or run; the insight dies when that context ends.
- **Manual Remediation** — humans must recognize, diagnose, and propose every fix by hand.
- **Post-Mortem Debt** — failures accumulate without a formal diagnosis backlog.

## Success signals
You'll know it holds when:
1. Every failed unit of work auto-spawns a defect record.
2. Every completion report includes governance- and workflow-friction reflection sections (required; "no friction observed" is an acceptable value).
3. Self-healing chains (defect → post-mortem → proposal/design → remediation work) execute on a single human approval.
4. The concept registry accretes patterns from actor reflections without manual triage.

## Provenance
Derived from OIS `tele-10` (Autopoietic Evolution); preserves pre-reset tele-8 content with a retroactive four-section rewrite applied 2026-04-21, Director-ratified via idea-149. No prior external AX lineage. Composes with sibling A7 — the friction reflections this loop emits feed the same backlog from which the system later draws its remediation work.
