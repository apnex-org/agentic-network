# teles.md — TOMBSTONE (mission-103 constitutional transition)

**Status: RETIRED.** The teleological-goal ("tele") layer that this file specified has been retired. The constitutional layer is now the **mission-kit axioms** (`../mission-kit/axioms/`, ids `A0`–`A14`), served live by the Hub and bound into the Hub-native **OrgCharter**.

## Where the constitution lives now

- **Axioms** — the universal, project-agnostic law: read via the Hub's constitutional surface (`get_constitution`, `list_axioms`, `get_axiom`). Source of record: `apnex/mission-kit` `axioms/A0..A14`.
- **Charter** — this org's specific mandates + its axiom bindings with provenance: read via `get_charter`.

## Lineage

Each axiom's **Provenance** section records the teleological goal it crystallized, so the "why" is preserved. The historical tele set survives only as immutable git history plus that per-axiom lineage line — never again as a live surface. The former umbrella + orthogonal goals map onto axioms `A0`–`A14`, ratified as one batch (`decision-18`) against a 15-pair fidelity proof (`audit-10840`).

## What was removed (mission-103 S4)

The tele entity/kind/store, the tele read/write MCP verbs, and the tele field on `Turn` were deleted from the Hub; every live doc/config citation was migrated to the axiom ids. This file is retained only as a tombstone so inbound links resolve — it carries **no live tele semantics and exposes no verbs**.
