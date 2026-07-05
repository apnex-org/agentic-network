---
id: A12
category: axiom
title: Precision Context Engineering
added: 2026-06-19
status: active
applies-to: [llm-in-the-loop]
related: [A4, A5, A11]
source-tele: tele-12
---

# A12 — Precision Context Engineering

## Mandate
Every LLM invocation's context is precision-engineered for maximum information density per token. Prompts are bounded, structured, and ordered so each context-window cell carries productive judgment-load, not administrative ballast. Where Cognitive Minimalism asks whether to invoke the LLM at all (the extensive margin), this axiom governs invocation quality: given an invocation, its context is as efficient as it can be (the intensive margin).

## Mechanics
- **Bounded Accumulation** — conversation and prompt context have explicit size caps; growth beyond the cap triggers compaction or offload, not silent expansion.
- **Capped Per-Response Size** — LLM outputs have architecturally-enforced size bounds; overflow triggers chunking or continuation primitives, never truncation.
- **Structured-over-Prose** — context is rendered as structured data (YAML / JSON / table) wherever the data has shape; prose wraps structured data, not the reverse. Pattern-matching structured data costs near-zero tokens; decoding unstructured prose burns budget on every round.
- **Context-Ordering Discipline** — high-signal content is positioned where the model's attention is strongest (prompt start/end, per model); ceremony and boilerplate go where attention is cheapest.
- **Virtual Tokens Saved** — an observable per-prompt and per-subsystem metric: the context could have been N tokens, is N−K after engineering. K is the precision-engineering work; its trend over time is the telemetry signal.
- **Shape-Aware Serialization** — tool-result envelopes, state projections, and audit-data shapes are optimized for LLM ingestion cost at their emission source, not patched by downstream adapter post-processing.
- **Projection, Not Dump** — LLM-facing context is the precision-engineered projection of the system's full state and documentation, never a raw dump of it; this is how expansionist knowledge (A4 Zero-Loss Knowledge) reaches the cognitive layer.
- **Hydration Formatting** — the accurate state surfaced for an invocation (A5 Perceptual Parity) is formatted for minimum ingestion cost; parity supplies the truth, this axiom engineers its shape.

## Rationale
Cognitive Minimalism minimizes LLM invocation count but does not by itself govern invocation quality. Even with full extensive-margin discipline, a workload can burn context budget on administrative ballast — unstructured prose, unbounded accumulation, attention-blind ordering — that displaces the very judgment capacity the invocation was meant to provide. Precision Context Engineering is the companion mandate: given an invocation is justified, maximize the judgment work per token spent. Without it, "minimize LLM calls" degrades to minimization on the margin only, rather than systemic token efficiency. Together the two axioms compose the extensive and intensive margins of the cognitive economy.

## Faults
- **Context Bloat** — prompts grow without explicit bounds; useful content is displaced by administrative padding as conversation accumulates.
- **Prompt Sprawl** — structured data rendered as prose; the model pays a decoding cost every round for content that should have been a table.
- **Unbounded Accumulation** — conversation history, tool results, or state hydration grows monotonically; the window fills regardless of information content.
- **Unstructured Hydration** — state dumped as prose narrative where a structured projection would convey the same content in fewer tokens and enable faster comprehension.
- **Attention-Blind Positioning** — high-signal content placed where the model's attention is weak; ceremonial content placed where attention is strong.
- **Waste-Blind Prompting** — prompt efficiency is never measured or optimized; token spend is unobserved and grows without bound.
- **Cosmetic Precision** — context compressed visually but not semantically (e.g. stripping whitespace without removing information-free tokens); the savings metric goes untracked.

## Success signals
You'll know it holds when:
1. Every LLM-facing prompt has an explicit size budget; overflow triggers compaction or offload, never silent truncation.
2. Context is structured wherever the data has shape; prose appears only as wrapping around structured content.
3. A precision metric (Virtual Tokens Saved or equivalent) is observable per prompt and per subsystem, and its trend is treated as telemetry.
4. Context ordering follows model-specific attention-strength patterns; review catches attention-blind positioning as a fault.
5. Tool-result envelopes, state projections, and audit payloads are LLM-ingestion-cost-optimized at their emission source, not via downstream post-processing workarounds.
6. Per-subsystem context-engineering budget is documented and auditable.
7. Shape-changes to major context types (tool results, state hydration, audit payloads) go through explicit review for token-cost impact.
8. Prompt precision is measured, not assumed; silent degradation surfaces as a drift bug, not invisible waste.

## Provenance
Derived from OIS `tele-12` (Precision Context Engineering), architect-proposed 2026-04-22. Composition note: this axiom governs the intensive margin (context efficiency within an invocation), while its companion A11 Cognitive Minimalism governs the extensive margin (whether to invoke at all); the distinction surfaced when the two were first conflated and then separated under review. It draws accurate state from A5 Perceptual Parity (which it formats) and enforces that A4 Zero-Loss Knowledge's expansionist documentation reaches the model as a precision-engineered projection rather than a raw dump. The deeper principle — engineer the payload to a costly oracle for maximum judgment-per-unit-cost — generalizes to any costly-oracle system.
