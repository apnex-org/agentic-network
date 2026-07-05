---
id: A11
category: axiom
title: Cognitive Minimalism
added: 2026-06-19
status: active
applies-to: [llm-in-the-loop]
related: [A2, A3, A5, A6, A12]
source-tele: tele-11
---

# A11 — Cognitive Minimalism

## Mandate
LLM tokens are the scarce economic resource. Every deterministic function is mechanized; the LLM is invoked only for genuinely cognitive work — judgment, creativity, ambiguity resolution. Maximum logic-per-token is the engineering objective.

## Mechanics
- **Substrate-First** — if deterministic code can do it, code does it. The LLM handles only irreducibly cognitive work; everything else belongs to the deterministic layer.
- **Token Accounting** — token consumption is first-class telemetry; every invocation can disclose its budget, and work that fits in deterministic code consumes none.
- **Cognitive-Boundary Discipline** — the seam between the deterministic layer and the cognitive agent is explicit, documented, and auditable per subsystem. Work drifts toward the cheaper side; drift the wrong way surfaces as a fault.
- **Hydration-as-Offload** — pre-compute state, surfaces, and scoped tool-catalogs before invoking the LLM, so it reads (cheap) rather than derives (expensive). Pairs with A5 Perceptual Parity.
- **Deterministic Primitives** — recurring patterns (retries, dedup, caching, routing, dependency-graph stitching, state reconciliation, idempotency) live as reusable primitives, never re-derived inside agent prompts; an LLM-side workaround observed for such a pattern is, by that fact, a primitive candidate.
- **Economic Telemetry** — per-operation token cost is observable; outlier paths surface for refactor; model-tier migrations (cross-model, cross-quota, cross-vendor) require a config change, not a workload redesign.

## Rationale
LLM token consumption is the dominant variable cost of an agentic system and its primary scarce resource. Without a first principle that drives deterministic work out of the prompt, agents silently absorb toil that could be mechanized — paying in tokens what one function call would do for free, and burning context-window on ceremony that displaces judgment. Naming the principle promotes each local efficiency fix from an ad-hoc workaround to a governing rule.

## Faults
- **LLM as Calculator** — the agent doing deterministic work (counting, sorting, pattern-matching, schema-validation, repetitive transformation) a function would do in microseconds at zero token cost.
- **Substrate Leakage** — deterministic logic drifts into prompts because no primitive exists for it; the workaround becomes permanent because no one refactors back.
- **Token Fragility** — the workload becomes brittle to model-change, quota limits, or tier-cost changes because it does too much per invocation.
- **Context Displacement** — genuinely cognitive work can't fit because administrative overhead consumed the window; judgment quality degrades invisibly.
- **Economic Blindness** — architecture ignores marginal-token-cost as a design constraint; inefficient patterns proliferate unobserved.
- **Prompt as Configuration** — operator parameters, routing rules, or schemas embedded in prompts where they belong in explicit config; changing behavior needs an LLM round instead of a config update.

## Success signals
You'll know it holds when:
1. Every recurring deterministic operation has a primitive; an LLM doing that operation is prevented by design or flagged as a fault.
2. Per-operation token consumption is observable; outlier paths surface for refactor as routine.
3. No prompt contains work a deterministic primitive could perform.
4. The cognitive boundary is explicitly documented per subsystem.
5. Model-tier migrations need only configuration change, not workload redesign.
6. Prompt context is dominated by genuinely cognitive content; transcription and pattern-matching overhead is negligible by construction.
7. When an LLM-side workaround for a deterministic pattern is observed, a reusable-primitive candidate is filed within one review cycle.

## Provenance
Derived from OIS `tele-11` (Cognitive Minimalism), architect-proposed 2026-04-22. Governs the extensive margin (whether to invoke the LLM at all); its companion A12 Precision Context Engineering governs the intensive margin (context efficiency when you do). It composes with its siblings: A6 governs anti-transcription between actors while this axiom governs offload-to-substrate within a single actor's own cognitive loop; A5 Perceptual Parity supplies the pre-hydrated state this axiom offloads the LLM onto; A2 and A3 give clean module boundaries while this axiom decides which side of each boundary a concern belongs on. The deeper principle — reserve the scarce expensive oracle for only what the oracle can do — generalizes to any costly-oracle system.
