---
id: A1
category: axiom
title: Sovereign State Transparency
added: 2026-06-19
status: active
applies-to: [stateful]
related: [A2, A5, A7]
source-tele: tele-1
---

# A1 — Sovereign State Transparency

## Mandate
All system truth lives in a single sovereign, structured, decoupled state backplane. No functional unit possesses private, opaque, or transient truth; all state is perceivable by any authorized entity and durable across any infrastructure restart.

## Mechanics
- State is a physical object in the backplane, not a variable living inside a process.
- The components that act on state — agents, services, adapters, tools — are stateless: they read, transform, and write back.
- Any authorized entity perceives any other entity's state in real time.
- Topology (entity shape) is version-locked: values change freely; structure changes only through a formal, declared refactor.
- Entities survive restart with identical field values.

## Rationale
Eliminates the Hidden State Problem. In any multi-actor system, hidden state is the primary source of Silent Drift — different actors reasoning against different "truths." A sovereign backplane gives every actor, and every human audit, the same ground truth. Persistence makes transient truth physically impossible. The principle is load-bearing wherever shared state outlives a single process; it sharpens as the number of concurrent actors grows.

## Faults
- **Hidden State Problem** — state lives inside a process; other actors reason about a different reality.
- **Silent Drift** — actors acting on divergent ground truth, with no detection.
- **Ephemeral Truth Loss** — state evaporates on restart, taking accumulated context with it.
- **Logic Poisoning** — components depend on hidden side-effects; refactor becomes impossible.

## Success signals
You'll know it holds when:
1. Every persistent entity survives a process or infrastructure restart with identical field values.
2. No actor or tool holds state that another authorized actor cannot query.
3. Topology changes go through a formal declared refactor; value changes do not.

## Provenance
Derived from OIS `tele-1` (Sovereign State Transparency) — Director-ratified 2026-04-21 (idea-149); evolves the pre-reset persistence tele and absorbs the prior external axiom AX-010 (State Sovereignty). Foundational substrate axiom: A2, A5, and A7 presuppose a single perceivable backplane as their ground.
