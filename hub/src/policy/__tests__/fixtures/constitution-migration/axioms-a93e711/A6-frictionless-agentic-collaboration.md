---
id: A6
category: axiom
title: Frictionless Agentic Collaboration
added: 2026-06-19
status: active
applies-to: [multi-agent]
related: [A2, A3]
source-tele: tele-6
---

# A6 — Frictionless Agentic Collaboration

## Mandate
Multi-agent collaboration occurs with zero administrative friction. No actor manually transcribes already-approved data, repeats a tool call another actor has already made, or emits context-wasting boilerplate. The coordination substrate seamlessly translates approved intent into executable state.

## Mechanics
- **Zero Transcription** — no cognitive actor re-enters data that was already formally approved in a proposal, decision record, or coordination thread; approved content is referenced and reused, never re-typed.
- **Atomic Transitions** — the move from ideation or ratification to execution is a single tool call or an automatic cascade, never a multi-step manual handoff.
- **Role Purity** — each role acts entirely within its own authority (e.g., one role governs active state, another proposes and executes); neither blocks on the other's administrative limitations.
- **Dependency-Graph Fluidity** — task dependencies and cross-artifact links are declared once during planning and enforced invisibly by the substrate, not re-stitched by hand at execution time.

## Rationale
Administrative friction compounds with agent count. In a network of N actors, a small per-transition friction tax — re-transcription, redundant calls, manual stitching — multiplies across every handoff until coordination overhead dominates real work; a 10-agent network at 10% friction per transition becomes intractable. Friction-zero is the precondition for scale: without it, multi-agent coordination collapses under its own coordination cost long before the actor count is the limiting factor. Mechanizing the translation of approved intent into executable state removes the tax structurally rather than asking each actor to be disciplined about it.

## Faults
- **Transcription Toil** — actors copy-paste approved data from one artifact into another instead of referencing it.
- **Boundary Blocking** — one role's tooling gap blocks another role's sovereign action.
- **Dependency Manual Stitching** — an actor hand-constructs dependency or cross-link relationships the substrate should infer and enforce.
- **Cascade Amnesia** — an approval fails to propagate downstream, forcing a human or agent to re-trigger work that ratification should have launched.

## Success signals
You'll know it holds when:
1. No actor ever copy-pastes approved content into a downstream artifact.
2. Ratification reaches execution through a single tool call or an automatic cascade.
3. No role is ever blocked on another role's administrative or tooling gap.
4. The substrate enforces the dependency graph invisibly; no actor constructs dependency graphs by hand.

## Provenance
Derived from OIS `tele-6` (Frictionless Agentic Collaboration); preserves the pre-reset tele-2 content via a retroactive four-section rewrite, Director-ratified 2026-04-21 (idea-149). Its mechanics presuppose the declarative coordination substrate and role-boundary discipline established by sibling axioms A2 and A3, which it extends specifically to the seams between collaborating agents.
