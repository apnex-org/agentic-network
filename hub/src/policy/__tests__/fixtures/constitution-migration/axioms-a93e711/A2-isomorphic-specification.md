---
id: A2
category: axiom
title: Isomorphic Specification
added: 2026-06-19
status: active
applies-to: [declarative]
related: [A1, A6]
source-tele: tele-2
---

# A2 — Isomorphic Specification

## Mandate
The specification IS the system. Human-readable intent and machine-executable reality are mathematically identical. The manifest is the master — no state changes through imperative drift; declared intent auto-reconciles the running system.

## Mechanics
- The spec document is the configuration a routing/enforcement layer parses at runtime to generate the state machines that govern each entity — not compiled-in.
- A change to the declared spec instantly changes system physics; editing the documentation edits behavior.
- Every state transition for every entity is enforced against the sovereign spec.
- Active state that diverges from the manifest is auto-reverted, or flagged as corrupted.
- Zero delta between the documented source of truth and executing behavior.

## Rationale
Manual configuration is a security and fidelity fault: every hand-applied tweak is an unaudited divergence from declared intent. Isomorphism lets an operator act at the speed of thought on high-level intent while automated substrates absorb the imperative toil. Reconciliation against a single declared truth means 10,000 nodes manage as easily as one. Most importantly, documentation cannot rot relative to execution — there is no second artifact to fall out of sync, because the spec and the system are one object.

## Faults
- **Doc-Code Drift** — documentation describes an older reality than what actually runs.
- **Snowflake Entropy** — nodes accumulate unique manual tweaks; clean replication becomes impossible.
- **Instructional Bloat** — the operator is forced to supply low-level how-to because declaration alone doesn't drive the system.
- **Phantom State** — an actor operates against a transition the spec does not know about.

## Success signals
You'll know it holds when:
1. The enforcement layer parses the sovereign spec at runtime to generate the governing state machines — they are not compiled in.
2. Zero unhandled-event / unhandled-transition occurrences arise during normal multi-agent operation.
3. An automated conformance harness covers 100% of documented workflows, including negative and adversarial/chaos paths.
4. Active state that mismatches declared intent is detected and reverted automatically.

## Provenance
Derived from OIS `tele-2` (Isomorphic Specification) — Director-ratified 2026-04-21 (idea-149); preserves the prior declarative tele, absorbs the external axiom AX-050 (Declarative Primacy), and folds in the state-machine-enforcement aspect of a prior transition tele. Composes with A1 Sovereign State Transparency: A1 makes state a perceivable, sovereign object, while A2 makes the declared spec the sole generator of that state's legal transitions — together they close the loop between what is true and what is allowed to change.
