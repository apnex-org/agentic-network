# C1 — Sovereign Work-Control Plane — Arc Design (REFINED CANDIDATE)

**Status:** REFINED CANDIDATE — supersedes the PR #347 DRAFT (run wf_9e7533bd-632). Integrates the convergences that were UNSETTLED at first authoring and are now DECIDED (D-1 R0 charter approved #348; D-3 telemetry = Option B Director-agreed DR-S2-012; C2 = headless-first + supervisor-owned-lifecycle DR-S2-013; C3-R4 renameMap-governor LIVE af17367). NOT a commitment — a candidate to refine + the genuine Director-Survey questions.
**Author:** lily (architect)  ·  **Date:** 2026-06-22
**Origin:** Autonomous-stint observation cluster C1 (observability & coordination-awareness) + Director directive D-1, council-reframed as the **keystone** of the 4-arc roadmap — a sovereign WORK-CONTROL plane (observe + claim + lease + actuate + evidence-to-close). Wave-1 (sequenced after Wave-0 closes + D-1 R1+ lands).
**Arc (synth):** C1 — Sovereign Work-Control Plane: the claimable WORK-QUEUE substrate, sitting on the D-1 REST spine as RESOURCES + VERBS.

---

## What changed since the PR #347 draft (the integration delta)

The first draft was authored when five things were open. They are now decided, and the refinement is mostly a SUBTRACTION — C1 gets smaller and more load-bearing because D-1 absorbed the plane-and-contract machinery:

1. **D-1 R0 charter APPROVED (#348)** — the dual-binding charter, the projection convention (kind→resource, CRUD→method, action→`POST /<id>/<action>` subresource, WATCH→SSE-over-LISTEN/NOTIFY), the runtime-DERIVED contract (`deriveContract(router, schemaDefs)` generalizing `computeToolSurfaceRevision`), the identity-seam verdict, and the 4-property over-claim ACCEPTANCE CHARTER all now LIVE in D-1's docs (`ois-control-plane-charter.md` + `ois-api-conventions.md`). **C1 no longer authors any of these — it CONSUMES them.** The old C1-R1 "author OIS-API-conventions + author the acceptance charter + EXTEND mod.core, dogfooding the audited /mcp verb path" is RETIRED: D-1 R4 explicitly retired the mod.core/dogfood-/mcp lean for oisctl (oisctl is now a thin REST client at root `cli/`, decoupled from /mcp). C1-R1 shrinks to the work-queue-specific READ contract delta.
2. **WorkItem verbs are RESOURCES + VERBS on the D-1 REST spine** — `claim_work`/`renew_lease`/`release_work`/`complete_work` register as policy tools and project, BY CONSTRUCTION, onto BOTH bindings (MCP today; REST as `POST /apis/core.ois/v1/workitems/<id>/{claim,renew,release,complete}` subresources once D-1 R3 lands). `list_ready_work` projects as `GET /apis/core.ois/v1/workitems?role=&phase=ready` + WATCH-over-LISTEN/NOTIFY. **One authority (PolicyRouter.handle), two bindings — C1 does NOT fork a queue-specific API.** This is the literal realization of the D-1 R5 note ("the PRIMARY agentic-drive use-case is the C1 work-queue, BUILT in C1, CONSUMED in D-1 R5").
3. **C3-R4 renameMap-governor is LIVE (af17367 + R4b)** — call-site scanner + drift-gate + value-round-trip oracle, plus the R4b fail-loud belts (`FilterTranslationGapError` + the cal-84 0-bare decode detector + cascade-collapsed-onto-renameMap). **The biggest tension in the draft — Survey Q1, "hard-gate the WorkItem kind on C3-R4 vs decouple via a per-kind CI fallback" — COLLAPSES.** WorkItem is simply born under the live general governor; no per-kind CI fallback is needed. (The decouple-fallback machinery is deleted from R2.)
4. **D-3 telemetry = Option B (Director-agreed, DR-S2-012)** — OIS-native normalized shape; honest-scope transport = a **latest-value gauge on the existing Agent entity**, NOT a dedicated telemetry-plane; PLUS the append-only history on the Audit createOnly mechanism. The C1-R4 "ONE telemetry spine" rung is now PINNED to that decided shape and CONVERGES with C2-L1 (which latches the context-runway gauge onto `Agent.status` and writes samples to the SAME append spine). C1-R4 no longer proposes a dedicated-plane option.
5. **C2 = headless-first + supervisor-owned-lifecycle (DR-S2-013)** — the SUPERVISOR is a CONTROLLER that drives the org THROUGH this plane: it `claim_work`s a work-item, spawns/feeds a headless (long-lived stream-json) agent, owns lifecycle (context-tracking, compaction-as-session-rollover, restart-as-re-invoke). **This sharpens the C1↔C2 seam:** C1's claim/lease verbs are exactly what the supervisor-controller calls; C1's thrash-quarantine signal is what a supervisor reads to trigger C2 lifecycle-actuation. C1 ships the plane + the verb-registration contract + the quarantine hand-off seam; C2 builds the lifecycle mechanism that consumes them.

The over-claim guard, the reference-only WorkItem shape, the thrash-quarantine, the Hub-enforced backpressure, the verifier-stays-advisory invariant, and the chartered-deferred register all CARRY FORWARD unchanged — they were right.

## Problem

The org has two coupled defects. (1) IDLE-AGENTS: there is no claimable work surface, so role-eligible agents wait on a manual dispatcher (the architect) instead of self-picking ready work — a tele-13/tele-6 leak. The literal verifier-Steve framing: an idle agent needs a claimable work-map — what is open, who owns it, what is blocked, what is safe for MY role, what evidence closes it. (2) SCATTERED CONTROL: org work-state lives as Tasks/Bugs/Reviews/verifier-gates with no unified claimable surface and no lease/backpressure mechanics, so two agents can step on the same work and a wedged agent silently masks no-progress.

D-1 reframes the control surface as a first-class REST API (Hub = kube-apiserver) + agent-drivable CLI. C1 builds the WORK-CONTROL keystone ON that spine: the claimable WORK-QUEUE — typed work-items (priority · role-eligibility · dependencies · evidence-required · leases) — observe + CLAIM + LEASE + ACTUATE + evidence-to-close. This is the literal idle-agents fix AND it removes the architect-as-manual-dispatcher. It is the unifying substrate C2 (lifecycle) builds on.

The deep hazard, surfaced by Steve's verifier critique and binding throughout: OVER-CLAIM. Observability is NOT a control-plane unless it has ACTUATION + LEASES/CLAIMS + BACKPRESSURE + CROSS-ADAPTER PARITY (the pane must show Steve/OpenCode, not just Claude). Do NOT ship a nicer status-page and call it a control-plane.

## Approach

A COORDINATION-PROTOCOL + CONFORMANCE-REGIME arc that BUILDS the work-queue substrate on the (now-approved) D-1 spine and EARNS the control-plane label against D-1's already-authored 4-property acceptance charter — forbidden from asserting it early. C1 does NOT re-author the plane, the contract, the conventions, or the charter; those are D-1's (R0 approved). C1 contributes: (a) the work-queue READ contract delta (R1, the only place C1 touches the contract — and even there it just lands a new verb-registry-backed kind so the DERIVED contract auto-includes it, plus a tele-10 hygiene pre-step); (b) THE KEYSTONE: the reference-only WorkItem kind + claim/lease/ack/close VERBS + FSM + lease/backpressure/thrash mechanics (R2, greg leads construction); (c) cross-adapter emission-parity at the scope the shared W0 spike licenses (R3, discharges the 4th charter property — EARNS the label); (d) the ONE durable org-health telemetry spine, pinned to the D-3 Option-B shape and converged with C2-L1 (R4).

The over-claim guard is operationalized via D-1's acceptance charter (no longer re-authored here): the arc may NOT be called a control plane until R3 discharges all four properties at the scope the W0 spike licenses. A heartbeat/idle proxy may NEVER silently pass the parity dogfood. RACI per the arc constraint: the architect OWNS the WorkItem resource/verb CONTRACT shape (the SchemaDef + renameMap + FSM + verb semantics) + the emission-conformance + telemetry schema; greg LEADS construction-Design from R2. Mission class = structural-inflection → walkthrough retrospective + substrate-self-dogfood gate (coordinate the NEXT arc's missions THROUGH the queue). Self-PICK (pull) only; proactive-push, C2 lifecycle-actuation, verifier-gating, and the governance-fold are all chartered-deferred (named for honesty, built elsewhere).

## Missions (banked / staged rungs)

### R0 — M-Cross-Adapter-Feasibility-Spike (W0 GATE; shared with C2-W0)
_size S · not-banked · SEQUENCING: shares the C2-W0 spike already in flight_

The HONEST-SCOPE gate, front-loaded because cross-adapter actuation-parity is the deepest risk. Determine empirically whether steve/OpenCode (a guest inside the harness LLM loop) can (a) reliably EMIT org-state fields (role, current-work-item, queue-depth, blocked-on, context-runway, can-accept-work-now) and (b) proactively CLAIM a work-item via the sovereign verbs. **REFINED by the C2-W0 result:** the spike has already graduated PASS on complementary harnesses (DR-S2-008), and the execution-model resolved to **headless-first + supervisor-owned-lifecycle** (DR-S2-013, parity-panel wf_a71a655f CONDITIONAL-YES). This REFRAMES the C1 parity question: in the supervisor-owned model, the CLAIM is performed by the SUPERVISOR-CONTROLLER (an out-of-harness process), NOT by the in-harness LLM loop — so cross-adapter ACTUATION-parity becomes "can a supervisor-controller `claim_work` on behalf of EITHER harness type?" which is feasible for BOTH (the supervisor is the same out-of-harness shape regardless of the harness it feeds). The genuinely-hard residual is EMISSION (does the OpenCode harness surface role/current-work/context-runway to its supervisor as faithfully as Claude does — OpenCode reads the session DB, Claude reads statusline stdin; both are per-host wrapper concerns, not MCP-shim capabilities). Output = a feasibility verdict that DISTINGUISHES VISIBILITY-parity (steve SHOWN on the pane) from ACTUATION-parity (steve's work CLAIMED via the verbs), now resolvable mostly-GREEN because the supervisor-controller is the uniform actuation seam. This verdict GATES R3's honest labeling; a heartbeat/idle proxy still may NOT silently pass the parity dogfood. teles 4/6.

### R1 — M-WorkItem-Read-Contract-Delta (governed READ surface; CONSUMES D-1, does NOT re-author it)
_size S (was M) · banked · DEPENDS ON: D-1 R1 (read-binding) landed_

**SHRUNK from the draft.** D-1 R0/R1 already shipped the OIS-API-conventions, the derived contract, the acceptance charter, oisctl-as-thin-REST-client, and the script-scatter fold. C1-R1 no longer re-authors ANY of that. It contributes only the work-queue-specific READ delta:

(1) **tele-10 hygiene pre-step** (the only hand-listed-count hazard C1 still touches): the three/four-way kind-count drift is now WORSE — `all-schemas.ts` has 25 `kind:` declarations, `entity-kinds.json` summary says 21 while its `kinds[]` array has 22, and CLAUDE.md says 20. C1-R1 confirms the WorkItem kind lands in the DERIVED contract (D-1's `deriveContract`) — NOT in any hand-listed snapshot — so the queue resource auto-appears from the verb-registry walk and the drift cannot recur for the new kind. (No new contract-derivation code; it's D-1's, already proven.)

(2) **the work-queue READ projection**: `list_ready_work({role})` registers as a read verb so D-1's binding projects it as `GET /apis/core.ois/v1/workitems?role=&phase=ready` (REST, once D-1 R3) AND as an MCP tool (today), with WATCH-over-LISTEN/NOTIFY on the ready-work projection (`?watch=true` SSE, gated on `SchemaDef watchable:true`). This is served from a substrate-watch projection, NEVER a poll-walk (bug-93 structural elimination honored).

(3) **the org-state read view**: `oisctl get workitems` / `oisctl get org-state` render the claimable work-map (open · owner · blocked · role-safe · evidence-to-close) — Steve's literal idle-agent ask — over D-1's derived contract; un-emittable adapter fields render LOUD as `unknown`, never silent `idle` (tele-4).

HONESTLY a governed READ surface (status-page-grade); control-plane conformance OPEN until R3. ZERO new verbs beyond the read projection. teles 3/10.

### R2 — M-Work-Queue-Substrate (THE KEYSTONE: the WorkItem kind + claim/lease/ack/close; greg leads construction)
_size L · banked · DEPENDS ON: C3-R4 governor (LIVE) + D-1 R2 (identity-seam parity, for REST write-actuation) — see seam note_

**THE LOAD-BEARING RUNG.** One new REFERENCE-ONLY **WorkItem** kind (kind #26 on the live substrate; born under the LIVE C3-R4 governor — the per-kind-CI-fallback from the draft is DELETED, since the general governor is now live).

**KIND SHAPE (K8s envelope, reference-only):**
- `metadata{ id: work-N, name, createdAt, createdBy, updatedAt }`
- `spec{ type: task|bug|review|verifier-gate|freeform, priority, roleEligibility[], dependsOn[] (readiness DAG), evidenceRequirements[], targetRef?{kind,id} | freeform payload }`
- `status{ phase: ready|claimed|in_progress|blocked|review|done|abandoned, lease{holder,claimedAt,expiresAt,heartbeatAt}|null, evidence[] }`
- **Single authority for claim = `WorkItem.lease`** — NO write-cascade into `Task.assignedAgentId` (avoids the two-claim-model divergence + the plannedTasks/bug-31 double-slot; lily memory flags this explicitly). A WorkItem REFERENCES a Task/Bug/Review/verifier-gate via `targetRef`, or carries a free-standing payload (the non-entity-work escape-hatch).

**FSM:** `ready → claimed → in_progress → (blocked ↔ in_progress) → review → done`, with `claimed/in_progress/blocked → abandoned` on release/expiry, and **lease-expiry/re-queue: `claimed|in_progress (heartbeat-GAP) → ready`** (returns to the pool WITHOUT Director escalation).

**FULL per-kind substrate tax (mission-83/90 discipline, now governor-enforced):** SchemaDef + renameMap (THE single authority for write-encode / filter-translate / read-decode — every relocated field needs only its renameMap entry) + decode-to-flat decoder + repository-substrate + STRICT envelope + role-tagged RBAC + reconciler expression-index + the FSM. **Born under the live C3-R4 governor's three teeth** (call-site scanner + drift-gate + value-round-trip oracle) PLUS the R4b fail-loud belts: `FilterTranslationGapError` at the filter-translate path + the cal-84 0-bare decode detector (so a relocated field that decodes bare→null fails LOUD, not silently — calibration #80 FILTER-vs-DECODE dual-surface + #84 silent-degrade are the named pathologies this kind is structurally immune to at birth).

**VERBS (the ACTUATION — registered policy tools, projecting onto BOTH bindings by construction):**
- `list_ready_work({role})` — served from a LISTEN/NOTIFY ready-work projection (never poll-walk, bug-93).
- `claim_work` — OCC self-pick via the proven task-repository-substrate `tryCasUpdate` + already-claimed phase-guard (no double-claim) + Hub-enforced WIP-cap-at-claim-time REJECT.
- `renew_lease` — heartbeat-extend (cognitive-continuity: a multi-hour Design is NOT yanked — crash = heartbeat-GAP, distinguished from slow = heartbeat-present).
- `release_work` — returns to pool.
- `complete_work({evidence[]})` — REQUIRES attached evidence satisfying `evidenceRequirements` (tele-4, no silent close).

**REST projection (post D-1 R3):** these are `POST /apis/core.ois/v1/workitems/<id>/{claim,renew,release,complete}` subresources + `GET /apis/core.ois/v1/workitems` (the kubectl subresource analog per D-1's projection convention). **One authority preserved** — the verbs terminate in `router.handle()`; C1 forks NO queue-specific API. Exact tool/verb STRINGS + envelope shapes DEFER to idea-121.

**LEASE-EXPIRY SWEEPER** (PulseSweeper/Watchdog pattern) returns heartbeat-gap leases to the pool. **THRASH DETECTION** (closes the "recovers work, not the agent" gap): per-agent claim→expire-without-evidence counter; after N consecutive lease-expiries, LOUDLY flag (tele-4) + quarantine the agent from re-claim + **emit the C2 lifecycle-actuation hand-off signal** (in the supervisor-owned model, the SUPERVISOR-controller reads this quarantine signal and triggers a C2 restart/compact of the wedged agent — C1 ships the SEAM, C2 builds the mechanism).

**BACKPRESSURE = Hub-ENFORCED** per-role/per-agent WIP cap checked AT CLAIM-TIME (reject the claim when at cap; NOT a self-reported flag) + first-class queue-depth + ready-but-unclaimed starvation-age.

**HOW EXISTING WORK FEEDS THE QUEUE (reference-only, no migration big-bang):** Tasks/Bugs/Reviews/verifier-gates are NOT replaced. A WorkItem is created REFERENCING them via `targetRef` (a thin projection-on-create or an explicit `create_work` over an existing entity). Verifier-gates ENTER the queue as `roleEligibility=[verifier]` work-items steve's supervisor claims; the verdict is recorded as EVIDENCE / a non-gating `create_audit_entry`. **`complete_work` NEVER requires a passing verifier outcome** — strictly ADVISORY, no veto, no `create_review`, no DAG-gating (verifier-role.md §1/§2.3 untouched, no re-ratification). This is the C3-behavioral-gate + C4 + work-queue convergence verifier-Steve called for: gates become QUEUED work-items, ONE loop.

**SEAM NOTE (cross-arc sequencing, honest):** the verbs ride MCP from day one (the live binding). Their REST projection (`POST .../<action>`) needs D-1 R3 (write/actuate binding). So R2 ships claim/lease/ack on MCP immediately (banks the idle-agents fix), and the REST projection lights up automatically when D-1 R3 lands (no extra C1 work — it's the same registered tool on the second binding). This is the Wave-1 "after D-1 R1+ lands" constraint made precise: R2's READ rides D-1 R1; R2's full REST actuation rides D-1 R3.

BANKED: the surface BECOMES a Claude-side actuation control plane (discharges ACTUATION + LEASES + BACKPRESSURE = 3 of D-1's 4 charter properties); the literal idle-agents fix (self-PICK, no dispatcher). teles 13/6.

### R3 — M-Cross-Adapter-Emission-Parity (discharges the 4th property; EARNS the label, honestly scoped)
_size M · banked · DEPENDS ON: R0 verdict + R2 verbs_

`docs/specs/adapter-emission-conformance.md` — the emission CONTRACT every adapter (Claude Code AND OpenCode/steve) satisfies: role/identity, current-work-item, queue-depth-visible, blocked-on, context-runway (shared VERBATIM with C2-L1), can-accept-work-now. Auto-emitted via the adapter handshake seam (role registration is an adapter concern) + the supervisor-controller (which, in the headless-first model, is the natural per-host emit-point — it already tracks context-runway + drives the harness, so it emits org-state for its agent). Built on the idea-220 Phase 2 operational-field-surfacing hook — NOT calibration-#21, which is intra-Claude (engineer-vs-architect read surface) and closed-structurally by mission-66/PR #135.

EXPLICIT split per the W0 verdict: VISIBILITY-parity (`oisctl get org-state` ACTUALLY shows steve — a dogfood-test ACCEPTANCE CRITERION, not an assumption) ALWAYS ships. ACTUATION-parity is now MORE tractable than the draft assumed: in the supervisor-owned model, the supervisor-controller is the uniform actuation seam for BOTH harnesses, so cross-adapter `claim_work`-on-behalf-of is feasible (the supervisor is the same out-of-harness shape regardless of harness). The residual risk is EMISSION FIDELITY (OpenCode session-DB readout vs Claude statusline readout — both per-host wrapper concerns). If a field is structurally un-emittable for an adapter, it renders LOUD as `unknown`, never silently as `idle` (tele-4). This is the rung where all 4 charter properties hold → the arc may legitimately be NAMED a control plane, at the scope the W0 verdict licenses. teles 6/4/10.

### R4 — M-Durable-Org-Health-Telemetry (ONE spine; PINNED to D-3 Option B; converges with C2-L1)
_size M · banked · CO-SEQUENCE with C2-L1_

**PINNED to the decided D-3 Option-B shape (DR-S2-012).** Promote the per-process in-memory `metrics.ts` (erased on every watchtower roll) to the OIS-native telemetry shape: a **latest-value gauge on the existing Agent entity** (`Agent.status` — queryable via `oisctl get agents --metrics`, the org-health read-surface extending from "alive?/doing-what?" to "healthy?/quota-left?/erroring?") PLUS an **append-only history on the Audit createOnly substrate mechanism** (audit-repository-substrate pattern + substrate-watch). **NO dedicated telemetry-plane** (the draft's dedicated-plane option is DELETED — the panel's honest-scope review + Director-agree corrected the architect's earlier dedicated-plane lean). OTEL stays a Claude INPUT only + a future Hub-edge EGRESS exporter (export-out-never-ingest-in); egress docked to the deferred WebSocket transport-convergence arc.

**ONE ledger, TWO producers** (the literal do-NOT-build-two-ledgers): C1 org-health flow-events AND C2-L1's context-runway samples write the SAME append spine + the SAME `Agent.status` gauge shape. Architect-owned SHARED telemetry-event schema + a CODEOWNERS/review gate forbidding a 2nd competing ledger; co-sequence with C2-L1 (whichever lands first defines the spine, the other consumes it). The C2-L1 fidelity tag `{measured|estimated|heuristic}` is a first-class field on every sample (the load-bearing link C2-L4 reads to refuse auto-acting on low-confidence data; also represents the D-3 asymmetric-error-fidelity).

**KPIs** over the R2 work-binding + lease/FSM history: idle-ratio, WIP-per-role, ready-but-unclaimed STARVATION age, mission cycle-time, blocked-work age, lease-expiry/return rate, thrash-quarantine rate, PLUS the D-3 agent-health axis (LLM-API call volume, 503/429 error-counts, quota/availability — motivated by Steve's zero-visibility quota-death: rising 429s → exhaustion → agent-down would have been VISIBLE). A `get_org_health` verb / `oisctl get org-health` = retrospective-grade ground truth surviving watchtower rolls (tele-10). A threshold/anomaly breach emits an ALARM-ONLY signal on the pulse rail (silent starvation/quota-death becomes LOUD, tele-4) — explicitly NO auto-act (any auto-act belongs to the spun-out coordination-autonomy arc or C2-L4).

EXCLUDED (moved to a SEPARATE methodology idea per the over-claim discipline): the network-coordinator first-class RACI role, calibration-ledger baseline FILINGS, and CLAUDE.md cold-pickup load-order edits — calibration filings stay architect-authored + Director-ratified, never arc-autonomous. teles 10/4/3.

### R5 — CHARTERED-DEFERRED REGISTER (DO-NOT-BUILD-HERE — recorded for honesty)
_size deferred · not-banked_

Not-built rungs — recorded so "deferred" is auditable as "correctly out-of-scope", not "missing":
- **(i) Proactive-PUSH / self-dispatch** (Hub pushes the top-ready item to the longest-idle eligible agent) — routing-correctness (longest-idle ≠ best-fit → semantic mis-routing; OCC prevents claim RACES, not wrong-FIT claims) + split-brain-claim-across-a-watchtower-roll hazards; C1 ships PULL/self-pick ONLY. Goes to the separately-gated coordination-autonomy arc with its own Survey/Design/CHAOS plan. **NOTE: the supervisor-controller (C2) claiming on behalf of its agent is PULL (the supervisor self-picks), NOT push — it does not reopen this register item.**
- **(ii) C2 lifecycle-actuation verbs** (reset/restart/compaction on containerised agents, D-2) — EXPOSE THROUGH this plane as verbs (registered tools → both bindings) but are BUILT in C2 (gated on C2 W0). C1 provides the plane + the verb-registration contract + the thrash-quarantine hand-off SEAM, not the lifecycle mechanism. (Sharpened by DR-S2-013: the supervisor-controller is the consumer of both the claim verbs AND the quarantine signal.)
- **(iii) Network-coordination GOVERNANCE FOLD** (network-coordinator RACI row, idle-wait-anti-pattern + self-pick-default codification, CLAUDE.md cold-pickup load-order) → a separate methodology idea.
- **(iv) mission-lifecycle PHASE + semantic-blocker-reason work-trace→Hub projection** → a clean follow-on idea.
- **(v) AUTONOMY-GRANT enforcement (C4 deny-set)** stays advisory.
- **(vi) REST WATCH-driven controller ergonomics beyond the R2 read projection** — the full agent-as-controller drive-loop over WATCH is D-1 R5, CONSUMING C1's queue, not built here.

ACTIVATION: each rides its own lifecycle + gate; none pre-positioned here.

## Spec (the concrete artifact / contract shape)

**WHAT C1 OWNS (the delta on top of D-1's already-approved contract machinery):**

**WorkItem KIND (R2, reference-only, K8s envelope, kind #26):** `metadata{id:work-N}`; `spec{type, priority, roleEligibility[], dependsOn[] (readiness DAG), evidenceRequirements[], targetRef?{kind,id} | freeform payload}`; `status{phase: ready|claimed|in_progress|blocked|review|done|abandoned, lease{holder,claimedAt,expiresAt,heartbeatAt}|null, evidence[]}`. Single authority for claim = `WorkItem.lease` (no `Task.assignedAgentId` cascade). renameMap entry for every relocated field (e.g. `status: "status.phase"`, lease/evidence under status, priority/roleEligibility/dependsOn under spec). Indexes on `status.phase` + `status.lease.holder` + `spec.roleEligibility`. Born under the LIVE C3-R4 governor (call-site scanner + drift-gate + value-round-trip oracle) + R4b fail-loud belts.

**VERBS (R2):** `list_ready_work({role})` (LISTEN/NOTIFY projection, never poll-walk); `claim_work` (OCC `tryCasUpdate` + already-claimed guard + Hub-enforced WIP-cap-at-claim-time reject); `renew_lease` (heartbeat-extend); `release_work` (return to pool); `complete_work({evidence[]})` (rejects unless `evidenceRequirements` satisfied). Lease-expiry sweeper returns heartbeat-GAP leases to the pool. Thrash guard: per-agent consecutive claim→expire-without-evidence counter → LOUD flag + re-claim quarantine + C2 hand-off signal.

**PROJECTION (CONSUMED from D-1 R0 convention, not re-authored):** verbs register as policy tools → MCP binding today + REST binding (`GET /apis/core.ois/v1/workitems{?role,phase,watch}` + `POST /apis/core.ois/v1/workitems/<id>/{claim,renew,release,complete}`) once D-1 R3. WATCH = SSE-over-LISTEN/NOTIFY, gated `SchemaDef watchable:true`. Exact STRINGS defer to idea-121.

**EMISSION-CONFORMANCE ENVELOPE (R3):** `{role/identity, currentWorkItem, queueDepth, blockedOn, contextRunway, canAcceptWorkNow}`; un-emittable field → LOUD `unknown`, never silent `idle`. Emitted via the adapter handshake seam + the supervisor-controller per-host emit-point.

**TELEMETRY SPINE (R4, PINNED to D-3 Option B):** a latest-value gauge on `Agent.status` (`oisctl get agents --metrics`) + an append-only history on the Audit createOnly mechanism; architect-owned SHARED schema; two producers (C1 org-health + C2-L1 context-runway); fidelity tag `{measured|estimated|heuristic}`; CODEOWNERS gate blocks a 2nd ledger. OTEL = input + future egress-only, never the internal wire.

**CONSUMED from D-1 (NOT re-authored by C1):** the dual-binding charter; the OIS-API-conventions (projection convention); the runtime-DERIVED contract; the 4-property over-claim ACCEPTANCE CHARTER; oisctl-as-thin-REST-client + the script-scatter fold; the identity-seam (token-bound {role,agentId}, fail-CLOSED). `get-entities.sh` direct-psql stays the named un-sovereign BREAK-GLASS (D-1's call; psql bypasses RBAC+audit).

## Success criteria

- **NAMING GATE holds via D-1's charter** (not a re-authored C1 charter): documented as a "governed READ surface" through R1, NAMED a "control plane" only after R3 closes D-1's 4 properties — with cross-adapter scope set HONESTLY by the W0 spike verdict, never by a heartbeat proxy passing the dogfood.
- **KEYSTONE dogfood:** an idle role-eligible agent (or its supervisor-controller) self-PICKS a ready work-item via `claim_work` and runs it to evidence-to-close with NO manual dispatcher — proven by coordinating the NEXT arc's missions THROUGH the queue (substrate-self-dogfood gate).
- **WorkItem is born conformant under the LIVE C3-R4 governor** (Survey Q1 collapsed — no per-kind CI fallback): renameMap-complete, decode-to-flat, fail-loud on bare→null; WorkItem.lease is the sole authoritative claim, no write-cascade into Task.assignedAgentId.
- **Verbs are ONE authority, two bindings:** claim/lease/ack/close register once as policy tools and appear on MCP today + REST (D-1 R3) by construction; C1 forks NO queue-specific API.
- **Leases honor cognitive-continuity:** a multi-hour task is never revoked; only heartbeat-GAP returns work to the pool; a chaos-test of split-brain claims across a watchtower roll PASSES before tele-8/9 is claimed.
- **Wedged-agent thrash does NOT silently mask:** N consecutive claim→expire-without-evidence LOUDLY flags + quarantines the agent + emits the C2 hand-off signal (no silent no-progress loop). [tele-4]
- **Backpressure is Hub-ENFORCED:** a claim at/over the per-role/per-agent WIP cap is REJECTED at claim-time; queue-depth + starvation-age are first-class.
- **Cross-adapter VISIBILITY-parity:** `oisctl get org-state` ACTUALLY shows steve/OpenCode (dogfood acceptance test), un-emittable fields LOUD as `unknown`; cross-adapter ACTUATION via the supervisor-controller ships at the scope the W0 verdict licenses, else honestly chartered-deferred.
- **ONE telemetry spine, D-3 Option B:** the `Agent.status` gauge + append Audit-mechanism ledger; org-health + context-runway share it (CODEOWNERS gate blocks a 2nd-ledger diff); `metrics.ts` retired; KPIs + the agent-health axis (quota/429/availability) survive a watchtower roll.
- **Verifier stays ADVISORY:** `complete_work` never requires a passing verifier outcome; verifier-role.md §1/§2.3 unreopened; verifier-gates enter the queue as claimable `roleEligibility=[verifier]` work-items (the C3-gate + C4 + queue ONE-loop convergence).
- **Sovereign-only actuation:** state-changing verbs route the audited `router.handle()` path under RBAC; `get-entities.sh` direct-psql remains the named un-sovereign break-glass.

## Tele alignment

- **tele-13 Director-attention:** the work-queue removes the manual dispatcher (self-pick); thrash-quarantine + starvation breach-signals + the agent-health axis (quota-death visible) replace manual watchdog→Director escalation; Director engages at gate-points only.
- **tele-6 frictionless-collab:** role-eligible agents (+ supervisor-controllers) self-PICK ready work; no manual hand-off; cross-adapter emission makes peer work-state legible.
- **tele-10 declarative source-of-truth:** verbs project from ONE authority (PolicyRouter.handle) onto two bindings; the queue resource appears in D-1's DERIVED contract (not a hand-listed snapshot); ONE telemetry spine (D-3 Option B); durable KPIs surviving watchtower rolls.
- **tele-3 sovereign-composition:** the queue rides the D-1 spine (no forked queue-API); C2 lifecycle + C4 grants expose THROUGH this plane as registered tools; the supervisor-controller is the uniform actuation seam across heterogeneous harnesses.
- **tele-4 no-silent-failure:** evidence-to-close; thrash LOUD-flag + quarantine; loud-`unknown` emission; alarm-only breach signals; born-fail-loud under the C3-R4 governor (cal-80/84 immunity); durable telemetry surviving rolls; quota-death made visible.
- **tele-8/9 gated+validated-integrity:** OCC-atomic claims, evidence-gated close, chaos-tested leases before claiming, RBAC-scoped + fully-audited actuation via router.handle.
- **tele-12 precision-context:** context-runway emission + cognitive-continuity heartbeat-leases preserve durable agent identity + context across long tasks (the headless supervisor-owned model makes this first-class).

## Risks (synthesis)

- **CROSS-ADAPTER ACTUATION-PARITY** — REFINED-DOWN by DR-S2-013: the supervisor-owned model makes the supervisor-controller the uniform actuation seam, so cross-adapter `claim_work`-on-behalf-of is feasible for both harnesses. Residual risk = EMISSION FIDELITY (OpenCode session-DB vs Claude statusline readout). MITIGATE: W0 spike GATE; honest scoped labeling; loud-`unknown`; a steve heartbeat-proxy may NOT pass the R3 parity dogfood.
- **KEYSTONE-on-external-rung** — REFINED-AWAY: C3-R4 is LIVE (af17367), so the draft's hard-gate-vs-decouple tension (Survey Q1) is gone. WorkItem is simply born under the live governor. (Residual: R2's REST actuation projection needs D-1 R3 — but R2 banks the idle-agents fix on MCP immediately; the seam note makes this explicit.)
- **tele-10 SELF-VIOLATION (hand-listed kinds):** the drift is now WORSE (25 vs 22 vs 21 vs 20 across all-schemas / kinds[] / summary / CLAUDE.md). MITIGATE: the WorkItem resource appears via D-1's DERIVED contract (verb-registry walk), never hand-listed; the R1 hygiene pre-step confirms it.
- **WEDGED-AGENT silent loop:** lease-expiry recovers WORK, not the AGENT. MITIGATE: per-agent claim→expire thrash counter + LOUD flag + quarantine + C2 hand-off (sharpened: the supervisor-controller reads the quarantine signal → C2 restart/compact).
- **BACKPRESSURE named-not-designed:** a self-reported `canAcceptWorkNow` flag is weak. MITIGATE: Hub-ENFORCED per-role/per-agent WIP cap checked AT CLAIM-TIME (reject the claim).
- **LEASE PREMATURE-REVOCATION** yanks a long legitimate task. MITIGATE: heartbeat-extend + crash(gap)-vs-slow(present) distinction + chaos-test split-brain claims across a watchtower roll BEFORE claiming tele-8/9.
- **VERIFIER-GATE DRIFT into a veto.** MITIGATE: `complete_work` never requires a passing verdict; verdict is non-gating evidence/audit; verifier-gates are claimable work-items; any gating-shape requires a SEPARATE Director re-ratification this arc does not request.
- **TWO telemetry ledgers (C1-R4 + C2-L1).** MITIGATE: ONE shared D-3-Option-B spine (Agent.status gauge + Audit-mechanism append), architect-owned schema, CODEOWNERS gate on a 2nd-ledger diff, co-sequenced with C2-L1.
- **WorkItem TWO-CLAIM divergence + plannedTasks/bug-31 double-slot.** MITIGATE: reference-only WorkItem; WorkItem.lease sole authority; NO write-cascade into Task.assignedAgentId.
- **AUTHORITY-FORK across MCP/REST** (the cardinal constraint). MITIGATE: verbs register once as policy tools and terminate in router.handle(); C1 builds NO queue-specific endpoint; the REST projection is D-1's binding machinery, not a C1 fork. The dual-binding invariant is D-1's charter, enforced by D-1's conformance gate.
- **SCOPE-CREEP into autonomy/lifecycle/verifier-gating/governance-fold.** MITIGATE: the chartered-deferred register (R5); R4 governance-fold + calibration filings moved to a separate methodology idea (filings stay architect-authored + Director-ratified); the R4 breach signal is alarm-only with no auto-act.

## Survey questions for the Director (the genuine open calls — REFINED set)

The draft's Survey Q1 (C3-R4 hard-gate vs decouple) is RETIRED — C3-R4 is live; WorkItem is born under the governor. The remaining genuine calls:

1. **CROSS-ADAPTER ACTUATION SCOPE for the control-plane label** (carried forward, now reframed by the supervisor-owned model): With the supervisor-controller as the uniform out-of-harness actuation seam, cross-adapter `claim_work`-on-behalf-of is feasible for both harnesses, so the residual is EMISSION FIDELITY (does OpenCode surface role/current-work/context-runway to its supervisor as faithfully as Claude). Is "full cross-adapter actuation via supervisor-controllers + VISIBILITY-parity, with any structurally un-emittable field rendered LOUD as `unknown`" an acceptable way to EARN the control-plane label at R3 — or must every emission field be present for BOTH adapters before the label (accepting an open-ended OpenCode-readout dependency)? *Proposed default: supervisor-actuation + visibility-parity earns the label; un-emittable fields loud-`unknown`, never proxied.*

2. **WorkItem ADOPTION SCOPE for existing work** (new, surfaced by the reference-only shape): Should R2's keystone dogfood drive ALL of Wave-1's coordination through WorkItems (every Task/Bug/Review/verifier-gate gets a referencing WorkItem from day one — strongest dogfood, but a broad behavior change), OR start NARROW (the arc's own missions + idle-agent self-pick only, with Tasks/Bugs/Reviews feeding the queue opt-in) and widen after the keystone proves out? *Proposed default: NARROW first (the arc's own missions + verifier-gates-as-work-items), widen post-keystone — honest-scope, early-rung-standalone-valuable.*

3. **THE C1↔C2 SEAM OWNERSHIP** (new, surfaced by DR-S2-013 supervisor-owned-lifecycle): C1 ships the thrash-quarantine SIGNAL + the claim/lease verbs; C2 builds the supervisor-controller that reads the signal and actuates lifecycle. Confirm the boundary: C1 owns the work-control-plane (queue + verbs + quarantine signal + telemetry spine) and C2 owns the supervisor + lifecycle mechanism that DRIVES THROUGH it — i.e. the supervisor is a C2 deliverable that CONSUMES C1's verbs, NOT a C1 deliverable? *Proposed default: yes — C1 = plane + verbs + signals; C2 = the controller that drives the plane. (This keeps C1 honest-scoped to the work-control substrate and avoids C1 absorbing the lifecycle mechanism.)*

---

## Provenance / status note

This is a REFINEMENT CANDIDATE, not a ratified design. It integrates the DR-S2 ledger decisions (008/012/013) + the D-1 R0 charter (#348) + the live C3-R4 governor (af17367) into the PR #347 C1 draft. It is for the C1 Survey→Design pass (the formal Phase 3/4 lifecycle); the 3 Survey questions above are the genuine Director-intent calls. The adversarial-verify pass from the original draft (holds:False → 7 weaknesses folded) is preserved in spirit: every weakness it raised is addressed here, and several are now structurally resolved by the convergences (Survey Q1 / C3-R4; the oisctl-substrate fork / D-1 R4; the contract self-violation / D-1 derived contract).
