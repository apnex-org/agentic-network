# C1 adoption step-0 — create_work + get_work on-ramp (work-trace)

**Engineer:** greg · **Architect:** lily · **Thread:** thread-709 · **Branch:** `agent-greg/c1-create-work-onramp` (off `2fa4723`)
**Sizing:** focused on-ramp PR (not a mission) — the queue's own bootstrap.

## Why
C1 NARROW adoption opens: dogfood subject = D-1 R1 (REST read-binding) coordinated *through* the WorkItem queue; gate = one mission clean end-to-end (claim→evidence-close audit trail + org-state snapshot). Pre-flight (Explore over `2fa4723`) found the keystone isn't agent-operable yet — two on-ramp gaps:

1. **The 10 work verbs aren't in the proxy tool surface** — proxies handshaked 2026-06-18, before the verbs deployed (06-22), so they cached the old catalog. The MCP catalog is Hub-dynamic → a proxy re-handshake surfaces all 10. **Zero code change** (coordination, not build).
2. **No agent-reachable creation path** — `createWorkItem` (`work-item-repository-substrate.ts:273`) is repo-only (test-callers only, zero production callers). The queue is unfillable-by-agents. **This is the build.**

## What shipped
`create_work` + `get_work` policy tools in `hub/src/policy/work-item-policy.ts` (the agent-reachable creation + read seam).

- **`create_work` — `[Architect]`** (lily's call; NARROW adoption: architect authors mission-level work, the `[Any]` lifecycle verbs let any eligible role claim→execute). Wraps `ctx.stores.workItem.createWorkItem(...)`; provenance via `resolveCreatedBy(ctx)` (spoof-proof — session, never args, same as the FSM verbs). Schema mirrors the WorkItem spec: `type` (enum), `roleEligibility[]` (default `[]`=any), `priority?` (enum, default normal), `dependsOn?[]`, `evidenceRequirements?[]`, `targetRef?` ({kind,id}|null), `payload?`.
- **`get_work` — `[Any]`** read-by-id (any phase; the org-state snapshot + an engineer reading their own claimed item want it). Returns the flat item or `not_found`. Read affordance ≠ claim affordance: it does NOT hoist `leaseToken` to the top level (a non-holder can't use the token anyway — every lease-bound verb fences on `holder===caller.agentId`).

## Construction findings (surfaced on thread-709 before build; all confirmed by architect)
- **F1 (load-bearing) — evidenceRequirements shape.** The sketched `{kind, refResolvable?}` omits the author-supplied **`id`** (REQUIRED — it's the `requirementId` `complete_work` binds evidence to) + `allowPreClaim?`. Took the full `EvidenceRequirement` shape. Also **reject duplicate requirement ids** within a create (a dup makes the bind ambiguous + could weaken no-double-count).
- **F2 — ref-resolution is on the policy tool, not the repo.** `createWorkItem` stores `dependsOn`/`targetRef` OPAQUELY (readiness enforced at claim, ref-resolvability at complete). So fail-closed (bug-175) ref-checks live in `create_work`: **dependsOn existence-checked** (a dangling dep = a permanently-unclaimable item = a silent claim-trap; tele-4 → loud reject at authoring).
- **F3 — targetRef → (b) opaque + shape-validated at create.** It's advisory ("this work is ABOUT entity X"), not a claim-gate, so a dangling targetRef is not a trap. Cross-kind create-time resolution belongs in the D-1 / idea-121 uniform resolver — flip (b)→(a) there, not here.
- **F4 — bundled `get_work` `[Any]`** — `getWorkItem` already exists (`repo:312`), so a ~6-line wrapper; cheap.

## Fail-closed surface (errorKinds)
`not_wired` (store absent) · `Authorization denied` (non-architect/unknown at the `[Architect]` gate — bug-175 membership-gate) · `invalid_evidence_requirements` (dup requirement id) · `unresolvable_ref` (dangling dependsOn) · bad `type`/`priority`/evidence-`kind` enum rejected at the MCP-boundary schema validation.

## Tests (`src/policy/__tests__/work-item-policy.test.ts`, +14; 28 total in-file)
architect creates → ready + spoof-proof provenance + field pass-through · engineer denied · unknown denied (no fail-open) · dangling dependsOn → `unresolvable_ref` (never created) · existing dependsOn passes through · dup requirement-id → `invalid_evidence_requirements` · store absent → `not_wired` · schema rejects bad `type` enum / accepts `verifier-gate` · **get_work `[Any]` reachable by engineer + verifier (pins the create=deny / get=allow asymmetry)** · get_work does NOT hoist leaseToken · get_work missing → `not_found`. Tool-count test updated 9→11.

## Verification
- `tsc --noEmit` clean. Full suite green: **2103 passed, 7 skipped, 0 failed** (174 files; real-pg substrate suites included).
- **No schema/governor touch** — wraps the existing WorkItem kind; zero renameMap change. The +2 tool-catalog bump is the same `toolSurfaceRevision` change the proxy restart keys on (expected, not a regression).

## Next (architect/process-driven)
Steve verifies against audit-4189 oracle → lily cross-approves + reversible Hub deploy (`deploy-hub.yml` → watchtower) + coordinates a 3-agent proxy restart (surfaces `create_work` + `get_work` + the 10 verbs in one shot) → D-1 R1 runs through the queue as the first real load.
