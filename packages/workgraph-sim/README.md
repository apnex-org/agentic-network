# @apnex/workgraph-sim

A sovereign, greenfield, headless simulator + contract-oracle platform for the **WorkGraph**
system (idea-449). It drives the **real** engine — `PolicyRouter.handle` over a real
`WorkItemRepositorySubstrate` FSM, in-memory + in-process — so a mega-arc can be
dress-rehearsed in seconds before it seeds. No FSM re-implementation; an independent
hand-authored spec-table is the ground truth.

## What it proves

| layer | artifact |
|---|---|
| single-item FSM conformance | the 105-property adversarial oracle catalog (`oracles.ts`, Phase A) |
| deterministic time | the VirtualClock re-seal (`determinism.ts` + `get_now`, 449-clock) |
| whole-arc | `WholeArcSim` driver (`arc.ts`) + the P1-P9 property battery (`properties.ts`) + the mp0bn dress-rehearsal (`mp0bn-rehearsal.ts`), Phase B |

Every property ships with a seeded-fault **mutant** that must red-light it (non-vacuity).

## Scope boundary — the decorator seam (idea-449 A9-partial)

The A9-partial seal covers the **WorkGraph FSM / actor-graph domain**. Two layers are
deliberately **out of scope** (design-of-record §3) — and are documented here as a **seam**,
NOT silently dropped:

- **client-side cache** (the cognitive `ToolResultCache` / adapter catalog cache);
- **network transport** (the MCP stdio/websocket channel between adapter and Hub).

They are excluded because the sim drives `PolicyRouter.handle` **in-process** — it has no
adapter and no network (design-of-record §1). Their correctness is a separate concern, covered
by the adapter / cognitive-layer suites (e.g. bug-206's probe cache-exempt work).

### Why "seam" and not "dropped"

The sim's load-bearing boundary is a single call:

```
SimHarness.handle(sessionId, verb, args)  →  PolicyRouter.handle(verb, args, ctx)
```

Because that is a plain function boundary, the out-of-scope layers can be closed later as
**decorators around this seam**, additively, without touching the engine or the properties:

- a **cache decorator** wraps `handle` to serve/store by `(verb, args)` — the seam to exercise
  `ToolResultCache` staleness + invalidation in-sim;
- a **transport decorator** wraps `handle` to serialize the call over a channel (MCP envelope
  in/out) — the seam to exercise transport framing, reconnect, and partial-failure in-sim.

Neither exists today (YAGNI + A9-partial). Closing the A9-**full** gap is therefore additive:
wrap `handle`, drive the same scenarios, assert the same invariants. That is what makes the
exclusion a **documented seam** rather than a dropped concern — the criterion-1 requirement of
the 449_B_gate.
