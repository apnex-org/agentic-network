# update_work — WorkItem mutation contract (idea-419 API track, slice 1)

**Status:** v1.0 — pending Director ratification through the decision rail (work-135)
**Family:** idea-121 (queue API surface); origin idea-419 (Director-flagged missing verb, mission-102)
**Evidence base:** three live costs of the missing verb in one day (2026-07-05): work-133 shipped with empty `dependsOn` and could not be retrofitted (Director-caught A12 violation; repaired via claim+block workaround); C-floor items sequenced by prose promise; the Director's original observation that no edit verb exists.
**Authority model (Director-ratified 2026-07-05, live session):** **author + architect** — the item's creator may fix their own authoring mistakes; the architect may curate any item as mission-planner. No other writers; no lease-holder mutation in v1.

## 1. Design principles

1. **The evidence contract is sacred.** Anything `complete_work` enforces is immutable forever — a mutable evidence contract guts anti-gameability (the arc's B-slice lesson).
2. **Append, don't rewrite, the graph.** Structural edges only grow; removing an edge silently weakens a gate. Edge removal stays a human-visible recreate in v1.
3. **A claimant's contract is stable.** Once someone claims an item, the work definition they claimed against (runbook, references, payload, eligibility) freezes; only coordination metadata stays mutable.
4. **Every mutation is loud.** Audited with actor + field + before→after, and emitted as a `work-updated` event on the role-targeted path.

## 2. Field-mutability table

| Field | Mutability | Constraint |
|---|---|---|
| `dependsOn` | **append-only, while `ready`** | each appended id must exist (dangling → reject, mirrors create_work); cycle-check against the full graph; appending an incomplete dep to a ready item re-gates it (ready → dep-gated is the intended effect — the work-133 case) |
| `completionDependsOn` | **append-only, until `done`** | arc nodes accrete children mid-flight by design (work-88); existence-checked; cycle-checked |
| `priority` | mutable until terminal | — |
| `targetRef` | mutable until terminal | advisory pointer; `{kind,id}` shape validated |
| `runbook` | mutable **pre-claim only** | claimant's contract freezes at claim |
| `references` | append-only, **pre-claim only** | same seed-time validation as create_work (required:true must resolve) |
| `payload` | mutable **pre-claim only** | — |
| `roleEligibility` | mutable **pre-claim only** | resulting set must be non-empty-claimable (never orphan an item) |
| `type`, `evidenceRequirements` | **immutable forever** | principle 1 |
| `id`, `createdBy`, `createdAt`, `evidence`, `lease`, `status`, state timestamps | **immutable via this verb** | status moves only through lifecycle verbs; evidence only through complete_work |

Terminal items (`done` / `abandoned`): all mutation rejected.

## 3. Verb schema

```
update_work {
  workId: string,
  set?: { priority?, targetRef?, runbook?, payload?, roleEligibility? },   // replace semantics, per-field rules above
  appendDependsOn?: string[],            // structural appends are explicit params,
  appendCompletionDependsOn?: string[],  // never reachable through `set` —
  appendReferences?: Reference[]         // append-only is enforced by shape, not by diffing
}
```

- Caller must be the item's author or hold the architect role (Hub-derived from session, not caller-asserted).
- Rejects: unknown field in `set`, empty mutation, terminal item, phase-rule violation (e.g. `runbook` on a claimed item), dangling/cyclic edge, orphaning eligibility.
- Every accepted call: one audit entry (actor, fields, before→after per field) + one `work-updated` event targeted per work-124 scoping.
- Concurrency: CAS on the item's resourceVersion; stale write → reject with current version (caller re-reads).

## 4. Out of scope (v1)

Edge removal (recreate instead); lease-holder mutation authority (revisit with evidence); evidence-requirement amendment under any authority (would need its own ratified design); bulk/batch mutation.

## 5. Slice 2

Engineer implements verb + contract tests (one per rejection row above + the work-133 replay as the canonical positive case), cut as a work item with `dependsOn` on work-135 after ratification.
