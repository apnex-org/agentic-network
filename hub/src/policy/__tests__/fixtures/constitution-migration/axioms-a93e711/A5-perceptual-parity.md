---
id: A5
category: axiom
title: Perceptual Parity
added: 2026-06-19
status: active
applies-to: [multi-agent, llm-in-the-loop]
related: [A1, A11, A12]
source-tele: tele-5
---

# A5 — Perceptual Parity

## Mandate
Human operators and autonomous agents share symmetric perception of system reality. The delta between a human supervisor's view of the system and any agent's view is negligible — held within an explicitly-defined bound on shared entities. Every actor's prompt is hydrated with verified ground truth before it generates a single token.

## Mechanics
- **Pre-Attentive Rendering** — real-time state is rendered through pre-attentive channels, parsable by a human and ingestible by an agent in under ~300ms; perception is felt, not computed.
- **Synthetic Sensory Organs** — agents possess instruments (framebuffers, terminal/UI mirrors, kinetic/event streams) to perceive their own output in context, rather than emitting it blind.
- **Auto-Hydration** — prompts are auto-hydrated with current state (pending-action queries, semantic query over the state backplane, observability surfaces) before any cognitive loop begins; the agent reads ground truth instead of asking for it.
- **Measured Parity** — the human↔agent perception delta is itself measured and held within an explicitly-defined bound on shared entities; symmetry is a verified property, not an aspiration.

## Rationale
Without perceptual symmetry, agents are blind to the consequences of their own logic — they produce output that passes unit tests but fails the reality-test. Human supervisors are then forced to act as the agent's eyes, relaying state by hand and destroying workflow density. Symmetric, pre-hydrated perception enables Self-Correcting Synthesis: an agent observes friction in its own rendered output and refactors before a human ever notices. The deeper principle — perception precedes cognition; an actor must see verified reality before it reasons — generalizes to any system where autonomous and human actors must hold a shared model of the world.

## Faults
- **Cognitive Friction** — a human is forced to act as eyes for the agent, relaying state the system should have surfaced.
- **Black-Box Failure** — output satisfies unit tests but fails the reality-test; correctness-on-paper masks failure-in-context.
- **Architect Amnesia** — agents hallucinate state instead of perceiving it; reasoning runs against an invented reality.
- **Operational Lag** — the organization reacts to logs after the fact instead of feeling system pulse in real time.

## Success signals
You'll know it holds when:
1. Agents never ask "what is the status of X?" — the system hydrates the answer before the question can arise.
2. The human↔agent perception delta is measurably within an explicitly-defined bound on shared entities.
3. Agent output is perceived in context (rendered, mirrored, or streamed) before any cognitive decision acts on it.
4. Hallucinated state is treated as a bug, not as expected behavior.

## Provenance
Derived from OIS `tele-5` (Perceptual Parity) — Director-ratified 2026-04-21 (idea-149); evolves the pre-reset tele-7 (Perfect Contextual Hydration) and absorbs the prior external axiom AX-040 (Observability Symmetry). Pairs with A11 Cognitive Minimalism, whose Hydration-as-Offload mechanic pre-computes the surfaces this axiom requires, and with A1 Sovereign State Transparency, which supplies the single ground truth that parity is measured against.
