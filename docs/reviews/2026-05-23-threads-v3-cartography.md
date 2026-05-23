# Threads v3 — Cartography v1.1 (2026-05-23)

**Umbrella anchor:** idea-312 (M-Threads-v3 — sovereign agentic-comms substrate, tele-anchored).
**Method:** strategic-review.md Phase 1 Cartography, thematic-scoped to threads + agentic-comms.
**Source:** full open-bug ledger (46 `open` + 1 `investigating` = 47 effective post-2026-05-23 refresh) +
214-open-idea backlog (post-Batch-A + post-Batch-B reconciliation; +bug-117/118 + idea-312/313 filed during v1.0→v1.1).
**Status:** **v1.1** — in-place fold of v1.0 absorbing the engineer enrichment companion's
substantive findings (PR #257 + PR #259) + the substrate-DX A.2 capability (PR #258).
**Companion:** `docs/reviews/2026-05-23-threads-v3-cartography-engineer-enrichment.md` —
engineer-authored, v1.1-current, durable input alongside this in-place edit.

**Disposition vocabulary:**
- **FOLD** — squarely inside v3 scope; subsumed when v3 ships
- **COMPOSES** — distinct surface that interacts with v3 but is its own thing (Smart NIC, API v2.0, presence)
- **DEFER** — thread-adjacent but not v3 scope (task/DAG, missioncraft, substrate-concurrency)
- **EXCLUDE** — not thread/agentic-comms

**v1.0 → v1.1 changelog** (mechanical fold per companion §7):
1. bug-106 promoted to §3 already-shipped (resolved 2026-05-23 / commit `f35b08a`)
2. bug-117 (W5 substrate-anchor) added to §1.3
3. bug-118 added to §1.2 — **re-scoped substrate-wide bug-lineage gap** (not cascade-handler-specific)
4. §2.8 mission-41 W3 partition substantiated via code-trace — idea-171 (WF-006 Mission Lifecycle) → DEFER; idea-169 (WF-005a Architect LLM convergence) → FOLD
5. 4 cluster-surfaced COMPOSES added — idea-69 / idea-240 / idea-241 (§2.4 transport); idea-304 (§2.3 routing-consumer)
6. idea-313 filed for INV-SYS-018 (thread-convergence dedup; W4); added §2.8
7. §4 tele mapping — tele-6 elevated; DSV-1..6 footprint reflected; bug-117/118 placed
8. §6 W5 wave shape — refined per ResponseSummarizer factor-split + list_* cap (bug-117); idea-152 stays longer-horizon
9. Ledger-currency refreshed throughout

---

## §1 · Bugs — 47 effective bugs (46 open + 1 investigating); thread/agentic-comms-relevant subset

### 1.1 Core thread substrate (FOLD — 6)

| Bug | Sev | Title | Dimension |
|---|---|---|---|
| **bug-23** | investigating / minor (major potential) | Thread bilateral-seal race — engineer reply rejected after architect unilateral-converge triggers cascade-driven closure | thread FSM / seal-vs-cascade race |
| **bug-25** | open / major | Thread message delivery truncation — reproducible at ~10-15KB | wire/transport per-message size |
| **bug-48** | open / major | Thread round_limit-vs-converged accounting — convergence-reached-at-final-round still classified as round_limit | thread terminal-state precedence |
| **bug-57** | open / major | Broadcast/unicast thread-message dispatch doesn't enqueue to engineer pending-actions | dispatch / cognitive-wake |
| **bug-60** | open / minor | Multicast routing skips pending-action enqueue at thread-open + receipt_acked items invisible to fresh-session drain | multicast routing + receipt-acked projection |
| **bug-96** | open / major | create_thread_reply silent-degradation when stagedActions XML tag missing antml-prefix — bilateral-blind convergence failure | thread-reply gate permissiveness; 7+ instances cross-session |

### 1.2 Cascade / convergence (FOLD — 2)

| Bug | Sev | Title | Dimension |
|---|---|---|---|
| **bug-27** | open / minor | propose_mission cascade handler drops payload.documentRef on entity creation | cascade payload→entity mapping; tele-2 Doc-Code Drift |
| **bug-118** | open / major | Bug entity lineage unset substrate-wide — 0 of 118 bugs have sourceThreadId (vs 63/312 ideas, 20%); cascade-handler code is correct, gap is empirical | substrate-wide lineage capture; supersedes bug-27 narrow framing |

### 1.3 Comms substrate vs LLM-facing layer (FOLD — 1)

| Bug | Sev | Title | Dimension |
|---|---|---|---|
| **bug-117** | open / major | ResponseSummarizer caps list_* tool results at maxItems=10 regardless of caller-`limit` upward asks — bug-115 predicted second victim realized | cognitive-pipeline conflation; list_* batch-pull blocked; **W5 substrate anchor** |

### 1.4 Dispatch / routing (FOLD — 2)

| Bug | Sev | Title | Dimension |
|---|---|---|---|
| **bug-61** | open / minor | Pinpoint dispatches with matchLabels redundancy — bug-18 pattern; cross-tenant silent-drop surface | dispatch envelope schema |
| **bug-94** | open / major | Task-issuance dispatch gap — create_task lands assignedEngineerId=null + no notification + no pool-claim surface | task↔thread dispatch boundary; 3-component methodology-bypass-amplification pattern |

### 1.5 Agent identity / presence (COMPOSES — 3)

These ride agent-state plumbing that v3 will interact with but does not subsume. Worth naming as composing surface, not folding.

| Bug | Sev | Title | Dimension |
|---|---|---|---|
| **bug-40** | open / minor | Hub get_engineer_status reports connected:0 + status:offline despite active sessions | presence-projection drift |
| **bug-41** | open / minor | claude --resume preserves cached tool-catalog; adapter doesn't trigger fresh handshake on relaunch | adapter handshake / tool-catalog refresh |
| **bug-42** | open / minor | Agent.name field shows agentId fallback instead of OIS_INSTANCE_ID-derived friendly name | identity projection |

### 1.6 Deferred / excluded

- **DEFER (substrate-concurrency, missioncraft, cloud-deploy):** bug-97 (Counter-collision under createOnly), bug-100 (SchemaDef reconciler watch-loop), bug-105 (start-hub.sh missing --network), bug-107 (Watchtower DOCKER_CONFIG path mismatch). All are mission-83/86 substrate / tooling — not thread-v3.
- **DEFER (missioncraft):** bug-74 / 76 / 77 / 78 / 79 / 80 / 81 / 82 / 83 / 84 / 85 / 86 / 87 / 88 / 89 / 90 / 91 / 92 — missioncraft sub-project; cross-project per the established Director-flagged parking.
- **DEFER (task / DAG / FSM):** bug-2 (DAG retroactive unblocking), bug-13 (list_tasks sort lexicographic), bug-22 (task-314 continuation retry).
- **EXCLUDE:** bug-4 (OpenCode plugin syncTools hash — adapter side), bug-6 (get_task historical), bug-62/63 (mission-77 spec-bugs).

**Bug totals — v3 surface: 11 FOLD + 3 COMPOSES = 14 of 47** (30%). [v1.0 was 10+3=13; +bug-117 +bug-118 −bug-106-shipped = net +1.]

---

## §2 · Ideas — 214 open total; thread/agentic-comms-relevant subset

### 2.1 Threads-2 cascade & routing hardening (FOLD — 9)

The idea-90→99 cluster is the canonical Threads-2 follow-on tail. All FOLD into v3 by construction — v3 replaces v2 substrate, so these become design inputs rather than discrete missions.

| Idea | Title | Tele primary |
|---|---|---|
| **idea-90** | Add anycast routingMode — split broadcast's coerce-on-first-reply from fan-out | tele-2 |
| **idea-91** | Implement multicast dynamic membership (ADR-014 §189 deferred) | tele-2 |
| **idea-92** | Tighten multicast open-time dispatch semantics | tele-2 |
| **idea-93** | Deferred-cascade queue — complete INV-TH25 | tele-7 |
| **idea-94** | Audit-replay queue — complete INV-TH26 | tele-7 |
| **idea-95** | Cross-action dependencies in cascade (ADR-015 Class I) | tele-3 |
| **idea-96** | Cascade_failed recovery path — currently manual-only | tele-7 |
| **idea-110** | Structural enforcement of audit-thread allowed-actions invariant | tele-6 |
| **idea-111** | Reply idempotency at Hub layer — dedup key on {threadId, authorAgentId, roundCount} | tele-6 |

### 2.2 Thread-design / substrate carve-out (FOLD — 8)

| Idea | Title | Note |
|---|---|---|
| **idea-292** | Hub thread-design review — large/long threads exceed MCP tool response size | broad scope; 4 of 5 dimensions live post-bug-115 |
| **idea-125** | Collapse `clarification` into Thread as a semanticIntent (DELETE standalone) | entity-sprawl reduction; clean v3 simplification |
| **idea-127** | Map semanticIntent → mechanism defaults for thread convergence | mechanism-design |
| **idea-200** | Follow-on cleanup #1: Thread.messages[] inline storage removal | **substrate-carve-out core** — messages should be Message-store-backed, not inline |
| **idea-201** | Follow-on cleanup #2: Notification/PendingActionItem/DirectorNotification projection | projection / metadata accumulation |
| **idea-207** | M-PAI-Saga-On-Messages — PendingActionItem saga rewrite onto Message-store | substrate consolidation |
| **idea-222** | Relax thread turn-taking from strict to advisory | turn-FSM policy |
| **idea-254** | Progressive-disclosure thread engagement surface — richer thread{} entity | projection / get-thread shape |

### 2.3 Dispatch / cognitive-wake / notification (FOLD — 7 + COMPOSES — 1)

| Idea | Disp | Title | Note |
|---|---|---|---|
| **idea-97** | FOLD | ADR-017 follow-up — GCS persistence for PendingActionItem + DirectorNotification | PARTIALLY OBSOLETED by mission-83 substrate (now postgres); still has FS-mode remnant |
| **idea-98** | FOLD | ADR-017 follow-up — broadcast/multicast enqueueing | composes with bug-57 / bug-60 |
| **idea-99** | FOLD | ADR-017 follow-up — extend enqueue path beyond thread_message | enqueue-path generalization |
| **idea-113** | FOLD | Cascade-action schema documentation + Zod alignment with direct-tool schemas | schema-drift / wire-contract |
| **idea-124** | FOLD | Label routing semantics — reserved keys, sender-default inheritance, cross-scope | routing semantics |
| **idea-214** | FOLD | Note-kind primitive surface gap — message_arrived envelope without payload | message envelope shape |
| **idea-262** | FOLD | Cognitive-wake-on-arriving-message — dispatcher-level cognitive-bump | dispatcher / wake policy |
| **idea-304** | COMPOSES | M-Commit-Push-Mission-Broadcast — broadcast commit-push visibility at mission-context | cluster-surfaced via PR #259 (thread-587 lineage); concrete consumer of broadcast routing; **W3 routing-modes consumer** |

### 2.4 Wire / payload / envelope + transport (COMPOSES — 8)

These are cross-cutting — they have to land before v3 can offer a stable wire contract, but they're independently scoped. v1.1 adds idea-69 / idea-240 / idea-241 surfaced via PR #259 lineage cross-ref.

| Idea | Title | Composes-with |
|---|---|---|
| **idea-69** | MCP proxy list/get-surface standardisation — consistent by-ID, by-label, by-filter | cluster-surfaced (thread-112); composes with idea-121; **W1 wire-contract** |
| **idea-121** | API v2.0 — tool-surface modernization (verb discipline + resource consolidation) | pagination class; v3 contracts ride this |
| **idea-126** | Adopt Kubernetes-style envelope for all Hub entities {id, name, kind, apiVersion} | wire-contract substrate |
| **idea-145** | task-313 Chunked Reply v2 — semantic-boundary splitting + Hub-persisted buffer | per-message-size structural fix |
| **idea-146** | task-314 continuationState snapshot depth v2 — capture tool-call history | session/state continuity |
| **idea-152** | Smart NIC Adapter — MCP as last-mile presentation; Cognitive Implant transport | **target-state substrate fix for bug-25 / bug-117 class** (bug-106 instance already shipped per §3) |
| **idea-240** | M-Agnostic-Transport-Adapter-Hub — confine MCP to a single Shim↔Hub leg (umbrella) | cluster-surfaced (thread-472); transport-substrate carve-out; vision-peer of idea-152; **W1 transport** |
| **idea-241** | M-Transport-WebSocket-Adapter-Hub — replace MCP wire format on Adapter↔Hub | cluster-surfaced (thread-472); concrete-impl candidate for idea-240; **W1 transport** |

### 2.5 Multi-role / multi-agent comms (COMPOSES — 3)

Director-and-multi-role plumbing — distinct surfaces that v3 must serve, not subsume.

| Idea | Title | Note |
|---|---|---|
| **idea-73** | Generalised Task Routing — Origin + Target as First-Class Fields | task-routing; relates to bug-94 |
| **idea-84** | Director as first-class networked role — SSE channel + event stream + handshake | Director SSE pipe |
| **idea-86** | Director Integration: Handshake & Notification Path (deferred) | follow-on to 84 |

### 2.6 Reliability / observability adjacencies (COMPOSES — 3)

| Idea | Title | Note |
|---|---|---|
| **idea-20** | Extend Cognitive Architecture auto-linkage system to support Threads | auto-linkage on get_mission |
| **idea-56** | Hub-injected thread guidance | system-prompt-at-thread-level |
| **idea-114** | Architect local-state vs Hub-state reconciliation — thread_sync_check pattern | state-sync drift |

### 2.7 Methodology / cadence (DEFER from v3 substrate scope)

These are methodology-side fixes that ride alongside but don't fold into a substrate program.

| Idea | Title | Disposition |
|---|---|---|
| **idea-216** | bug-35 selectAgents semantic shift — lastSeenAt-window vs livenessState | needs-survey; routing-semantic |
| **idea-248** | M-Bilateral-Audit-Thread-Cadence-Discipline — architect-side round-budget discipline | methodology-fold (already partially landed) |
| **idea-282** | Automated post-merge cascade — mission lifecycle advances completed→merged | event-bridge → mission lifecycle (lifecycle composition; not v3 core) |

### 2.8 mission-41 W3 invariant-coverage partition (FOLD — 6 + 1 new; DEFER — 17)

**PARTITIONED 2026-05-23 via PR #259 code-trace** against `docs/specs/workflow-registry.md` + `hub/test/e2e/workflows/WF-005.test.ts` + invariant fixtures in `hub/test/e2e/invariants/`. v1.0's "~5–8 thread-touching" estimate substantively confirmed at 6 entities, with one swap from the architect's named set:

**FOLD (6, code-trace substantiated):**
- **idea-159** Coverage follow-up: INV-TH8 — thread-invariant gap
- **idea-169** Coverage follow-up: **WF-005a — Thread Convergence to Auto-Directive (Architect LLM Path)** (NEW — v1.0 missed the LLM half of WF-005's a/b decomposition)
- **idea-170** Coverage follow-up: WF-005b — Hub cascade deterministic convergence path (idea-170's pair with idea-169)
- **idea-172** Coverage follow-up: WF-008 — Event Loop Catch-Up (polling backup for `thread_converged` SSE events)
- **idea-173** Coverage follow-up: XD-006a — Thread Convergence → Auto-Action (Hub Cascade)
- **idea-174** Coverage follow-up: XD-006b — Thread Convergence → Auto-Directive (Architect LLM)

**Adjacent new filing:**
- **idea-313** INV-SYS-018 — Thread convergence dedup between WF-005a + WF-005b paths (filed 2026-05-23; surfaced via PR #259 §2.2; W4 cascade-FSM scope; composes with bug-23)

**Reclassified DEFER:**
- **idea-171** Coverage follow-up: WF-006 — **Mission Lifecycle** (per workflow-registry.md classification; not thread substrate; defers to mission-41's own coverage program)

**Other DEFER (mission-41 W3 coverage program, non-thread-touching):**
- idea-160 INV-TN1, idea-161 INV-TE1, idea-162 INV-TE2, idea-163 INV-A1, idea-164 INV-A2, idea-165 INV-D1, idea-166 INV-D2, idea-167 INV-SYS-003, idea-168 INV-SYS-010-017, idea-175 INV-T9, idea-176 INV-T10, idea-177 INV-T11, idea-178 INV-T12, idea-179 INV-T4-spec-clarification, idea-180 read_completed/reported_completed enum FSM-gap, idea-181 INV-I2-wording-refinement (16 entities). Total residual DEFER from cluster: 16; the cluster traces uniformly to thread-266 per PR #259 §1.3 — semantically cohesive but largely non-thread-substrate.

**Idea totals — v3 surface (v1.1 final, post-partition + cluster-surfacing + INV-SYS-018):**
**31 FOLD + 15 COMPOSES = 46 ideas.** [v1.0: 24 FOLD + 11 COMPOSES = 35 + 5–8 partition pending. v1.1 delta: +6 FOLD (§2.8 partition) +1 FOLD (idea-313) +4 COMPOSES (cluster-surfaced) = +11.]

---

## §3 · Already-shipped v3 building blocks

Recognising the work that's already done — v3 is not greenfield.

| Closure | Mechanism | What it bought |
|---|---|---|
| **bug-115** (resolved 2026-05-22) | `get_thread` honors offset/limit; default newest-5 | roundCount-driven context growth is bounded; first concrete v3 building block |
| **bug-106** (resolved 2026-05-20; entity flipped 2026-05-23) | `ResponseSummarizer` `isInternalCall(ctx.tags)` bypass at `response-summarizer.ts:201-204` (commit `f35b08a`) | internal-machinery `agent.call`s receive raw substrate payload; the machinery-vs-LLM split that bug-117 still needs for `list_*` tools |
| **mission-83 (HubStorageSubstrate)** | postgres + LISTEN/NOTIFY + JSONB; FS-mode retired | the state-backplane v3 needs; thread storage is now substrate-backed |
| **idea-66** (incorporated 2026-05-22) | `directive_issued` → `task_issued` rename | event-schema currency for the dispatch surface |

---

## §4 · Tele primary mapping (v1.1 — Phase 4 design will refine)

| Tele | Bugs | Ideas | Note |
|---|---|---|---|
| **tele-2** Frictionless Agentic Collaboration | bug-23, bug-25, bug-57, bug-94, bug-96, bug-117 | idea-90/91/92, idea-125/127, idea-200, idea-222, idea-254, idea-69 | **load-bearing primary** — substrate's reason for existing |
| **tele-3** Sovereign Composition | bug-27, bug-118 | idea-95, idea-113, idea-152 (composes), idea-240/241 (composes; transport substrate) | substrate-class promotion — the v3 architectural play |
| **tele-4** Zero-Loss Knowledge | bug-25, bug-117 | idea-145, idea-152 (composes) | structural elimination of truncation class; bug-106 shipped — the machinery-vs-LLM split now exists at one site, owed to list_* per bug-117 |
| **tele-6** Deterministic Invincibility | bug-48, bug-61, bug-96, bug-117, bug-118 | idea-110, idea-111, idea-313 | **elevated v1.1 → load-bearing** — DSV-1..6 footprint per companion §6.2 is the structural reality: bug-96 (antml-prefix), bug-117 (list_* cap), bug-118 (lineage), bug-48 (round_limit-vs-converged), thread-vs-GitHub approval (DSV-4), schema-rename-without-migration (DSV-5), adapter-restart-doesn't-rebuild-Hub-container (DSV-6) — substrate silently accepts failure modes that discipline catches; v3 W1 (wire-contract) retires DSV instances structurally |
| **tele-7** Resilient Operations | bug-25 (impact), bug-60 | idea-93/94/96, idea-97/98/99, idea-262, idea-114 | long-thread context-discipline; metadata projection |

---

## §5 · Open for the SR's Design phase (post-v1.1 enrichment)

The engineer enrichment pass (PR #257 + PR #259) closed the original v1.0 §5 leaves:

- ~~Engineer cross-ref via psql~~ → **DONE** (PR #259 §1; substrate-DX A.2 standing capability via PR #258).
- ~~mission-41 W3 invariant-coverage partition~~ → **DONE** (PR #259 §2; 6 FOLD substantiated via workflow-registry.md code-trace).
- ~~bug-25 + bug-106 root-cause confluence~~ → **PARTIALLY DONE** — bug-106 SHIPPED via `isInternalCall` bypass (§3 above); bug-25 stays distinct (stdio/buffer transport, not cognitive pipeline); bug-117 is the new substrate-anchor for the broader list_* class.
- ~~idea-292 update~~ → **DONE** (Hub entity edit 2026-05-23; bug-115 closure note on dimension #3; metadata-accumulation observation under dimension #4; idea-312 back-link).

**Remaining for Design phase:**

1. **idea-152 (Smart NIC) status** — strategic surface for SR Phase 4 design: treat as the v3 target-state-fix-anchor (folds in) or as a peer sovereign-substrate (composes)? Both framings are defensible. v1.1 keeps it COMPOSES per v1.0; the SR can promote if the wave-decomposition warrants.
2. **bug-117 W5 substrate work shape** — three options per §3.2 of the companion: extend bug-115 pattern (`list_*` honor caller-`limit` upward) / per-call `unsummarized: true` opt-out / Hub-side substrate primitive that materializes pages without summarizer involvement. Design-phase pick.
3. **bug-118 substrate-wide bug-lineage gap** — fix-shape per re-scoped bug-118: MCP tool surface extension (compose with idea-121) + Hub-system-emit audit + defensive contract test. Decompose to W4 cascade FSM wave or W1 wire-contract — pick at Design.
4. **idea-292 dimensions #1, #2, #4, #5** — the 4 residual scope dimensions post-bug-115; W2 substrate carve-out and W5 size/response-shape both compose.

---

## §6 · Pre-SR shape recommendation (v1.1 refined)

The scoped strategic review should produce a **3-to-5-wave program**:

- **W1 — Wire contract + envelope + transport** (idea-126, idea-113, idea-69, idea-240, idea-241, bug-27, bug-96, bug-118, idea-214). Schema-validated message envelope; closes the "gate-permissiveness" and "lineage-capture" DSV classes structurally; transport substrate ratified (Shim↔Hub leg confined per idea-240). DSV-retirement-by-construction is the load-bearing tele-6 play.
- **W2 — Substrate carve-out** (idea-200, idea-201, idea-207, idea-292 dimensions #1/#2/#4/#5 carryover, package boundary). Messages → Message-store; thread metadata → projection primitives.
- **W3 — Routing modes** (idea-90/91/92, bug-57, bug-60, bug-61, idea-98/99, idea-124, idea-304). Multicast / anycast / broadcast hardening; dispatch contract; broadcast consumers like commit-push-mission-broadcast (idea-304).
- **W4 — Cascade FSM** (idea-93/94/95/96, idea-110, idea-111, idea-159, idea-169, idea-170, idea-172, idea-173, idea-174, idea-313, bug-23, bug-48). Deferred-cascade queue; bilateral-seal race; reply idempotency; terminal-state precedence; **WF-005a/b convergence dedup (idea-313 INV-SYS-018)**; full §2.8 invariant-coverage absorption.
- **W5 — Size / response-shape structural fix** (bug-117, idea-145, bug-25, idea-152). bug-117 (`list_*` caller-`limit` honesty) is the new W5 substrate-anchor — bug-106 already shipped the machinery-vs-LLM split at one site, this generalizes it. idea-152 (Smart NIC) is the longer-horizon target-state that absorbs whichever residue remains.

**Survey-per-mission at Phase 3** for each wave.

---

## Provenance

- **v1.0 / 2026-05-23** — Initial cartography pass; architect (lily); PR #256 merged as `0d22d84`. Director vision-framing 2026-05-22 AEST.
- **Engineer enrichment v1.0 companion / 2026-05-23** — apnex-greg; PR #257 merged as `c644838`. Friction inventory + DSV pattern surface + lineage cross-ref (PARTIAL).
- **Substrate-DX A.2 / 2026-05-23** — engineer-side standing read-only psql via `gcloud-ssh + docker exec` proxy; PR #258 merged as `2858d0f` (resolves enrichment §6.1 F-3). hub_reader role created on production substrate; greg.env populated architect-direct.
- **Engineer enrichment v1.1 companion / 2026-05-23** — apnex-greg; PR #259 merged as `ae44ba3`. Substrate-wide lineage cross-ref FULL; §2.8 partition code-trace-substantiated; 4 cluster-surfaced COMPOSES; bug-118 scope-revision surfaced.
- **bug-106 entity flipped resolved / 2026-05-23** — fixed-not-flipped reconciliation.
- **bug-118 re-scoped / 2026-05-23** — substrate-wide bug-lineage gap (not cascade-handler-specific).
- **idea-313 filed / 2026-05-23** — INV-SYS-018 thread-convergence dedup (W4 cascade FSM).
- **This v1.1 in-place fold / 2026-05-23** — architect (lily); follows engineer enrichment companion §7 recommendations.
- **Anchor:** idea-312 (M-Threads-v3 umbrella).
- **Next gate-point:** Director schedules the scoped strategic review with v1.1 + engineer enrichment companion v1.1 as inputs.
