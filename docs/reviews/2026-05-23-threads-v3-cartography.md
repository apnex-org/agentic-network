# Threads v3 — Initial Cartography (2026-05-23)

**Umbrella anchor:** idea-312 (M-Threads-v3 — sovereign agentic-comms substrate, tele-anchored).
**Method:** strategic-review.md Phase 1 Cartography, thematic-scoped to threads + agentic-comms.
**Source:** full open-bug ledger (45 `open` + 1 `investigating` post-2026-05-22 reconciliation) +
full 213-open-idea backlog (post-Batch-A + post-Batch-B reconciliation).
**Status:** **INITIAL** pass — architect-driven from the ledger; engineer-side cross-ref + sourceThreadId
enrichment deferred to the strategic-review Phase 2 input prep.

**Disposition vocabulary:**
- **FOLD** — squarely inside v3 scope; subsumed when v3 ships
- **COMPOSES** — distinct surface that interacts with v3 but is its own thing (Smart NIC, API v2.0, presence)
- **DEFER** — thread-adjacent but not v3 scope (task/DAG, missioncraft, substrate-concurrency)
- **EXCLUDE** — not thread/agentic-comms

---

## §1 · Bugs — 47 open total; thread/agentic-comms-relevant subset

### 1.1 Core thread substrate (FOLD — 6)

| Bug | Sev | Title | Dimension |
|---|---|---|---|
| **bug-23** | investigating / minor (major potential) | Thread bilateral-seal race — engineer reply rejected after architect unilateral-converge triggers cascade-driven closure | thread FSM / seal-vs-cascade race |
| **bug-25** | open / major | Thread message delivery truncation — reproducible at ~10-15KB | wire/transport per-message size |
| **bug-48** | open / major | Thread round_limit-vs-converged accounting — convergence-reached-at-final-round still classified as round_limit | thread terminal-state precedence |
| **bug-57** | open / major | Broadcast/unicast thread-message dispatch doesn't enqueue to engineer pending-actions | dispatch / cognitive-wake |
| **bug-60** | open / minor | Multicast routing skips pending-action enqueue at thread-open + receipt_acked items invisible to fresh-session drain | multicast routing + receipt-acked projection |
| **bug-96** | open / major | create_thread_reply silent-degradation when stagedActions XML tag missing antml-prefix — bilateral-blind convergence failure | thread-reply gate permissiveness; 7+ instances cross-session |

### 1.2 Cascade / convergence (FOLD — 1)

| Bug | Sev | Title | Dimension |
|---|---|---|---|
| **bug-27** | open / minor | propose_mission cascade handler drops payload.documentRef on entity creation | cascade payload→entity mapping; tele-2 Doc-Code Drift |

### 1.3 Comms substrate vs LLM-facing layer (FOLD — 1)

| Bug | Sev | Title | Dimension |
|---|---|---|---|
| **bug-106** | open / major | Cognitive ResponseSummarizer summarizes internal-machinery agent.call responses — machinery receives LLM-truncated data | substrate-vs-cognitive-layer conflation; sibling to bug-25 |

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

**Bug totals — v3 surface: 10 FOLD + 3 COMPOSES = 13 of 47 open** (28%).

---

## §2 · Ideas — 213 open total; thread/agentic-comms-relevant subset

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

### 2.3 Dispatch / cognitive-wake / notification (FOLD — 7)

| Idea | Title | Note |
|---|---|---|
| **idea-97** | ADR-017 follow-up — GCS persistence for PendingActionItem + DirectorNotification | PARTIALLY OBSOLETED by mission-83 substrate (now postgres); still has FS-mode remnant |
| **idea-98** | ADR-017 follow-up — broadcast/multicast enqueueing | composes with bug-57 / bug-60 |
| **idea-99** | ADR-017 follow-up — extend enqueue path beyond thread_message | enqueue-path generalization |
| **idea-113** | Cascade-action schema documentation + Zod alignment with direct-tool schemas | schema-drift / wire-contract |
| **idea-124** | Label routing semantics — reserved keys, sender-default inheritance, cross-scope | routing semantics |
| **idea-214** | Note-kind primitive surface gap — message_arrived envelope without payload | message envelope shape |
| **idea-262** | Cognitive-wake-on-arriving-message — dispatcher-level cognitive-bump | dispatcher / wake policy |

### 2.4 Wire / payload / envelope (COMPOSES — 5)

These are cross-cutting — they have to land before v3 can offer a stable wire contract, but they're independently scoped.

| Idea | Title | Composes-with |
|---|---|---|
| **idea-121** | API v2.0 — tool-surface modernization (verb discipline + resource consolidation) | pagination class; v3 contracts ride this |
| **idea-126** | Adopt Kubernetes-style envelope for all Hub entities {id, name, kind, apiVersion} | wire-contract substrate |
| **idea-145** | task-313 Chunked Reply v2 — semantic-boundary splitting + Hub-persisted buffer | per-message-size structural fix |
| **idea-146** | task-314 continuationState snapshot depth v2 — capture tool-call history | session/state continuity |
| **idea-152** | Smart NIC Adapter — MCP as last-mile presentation; Cognitive Implant transport | **target-state substrate fix for bug-25 / bug-106 class** |

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

### 2.8 mission-41 W3 invariant-coverage tail (NEEDS PARTITION — 23)

The idea-159→181 cluster (mission-41 W3 follow-ups) needs an engineer-pass to partition which invariants touch threads (INV-TH8, WF-005a/b, WF-006/008, XD-006a/b) vs which touch other entities. **Initial estimate: ~5–8 fold into v3** (the INV-TH + thread-touching WF + XD); the remainder defer or COMPOSE with mission-41's own coverage program.

Candidates worth thread-side investigation:
- **idea-159** Coverage follow-up: INV-TH8 — thread-invariant gap
- **idea-170** Coverage follow-up: WF-005b workflow path (Hub cascade deterministic convergence)
- **idea-171** Coverage follow-up: WF-006 workflow
- **idea-172** Coverage follow-up: WF-008 workflow
- **idea-173** Coverage follow-up: XD-006a cross-domain invariant
- **idea-174** Coverage follow-up: XD-006b cross-domain invariant

**Idea totals — v3 surface (high confidence, post-partition):**
**24 FOLD + 11 COMPOSES = 35 ideas + 5–8 from mission-41 W3 partition.**

---

## §3 · Already-shipped v3 building blocks

Recognising the work that's already done — v3 is not greenfield.

| Closure | Mechanism | What it bought |
|---|---|---|
| **bug-115** (resolved 2026-05-22) | `get_thread` honors offset/limit; default newest-5 | roundCount-driven context growth is bounded; first concrete v3 building block |
| **mission-83 (HubStorageSubstrate)** | postgres + LISTEN/NOTIFY + JSONB; FS-mode retired | the state-backplane v3 needs; thread storage is now substrate-backed |
| **idea-66** (incorporated 2026-05-22) | `directive_issued` → `task_issued` rename | event-schema currency for the dispatch surface |

---

## §4 · Tele primary mapping (initial — Phase 4 design will refine)

| Tele | Bugs | Ideas | Note |
|---|---|---|---|
| **tele-2** Frictionless Agentic Collaboration | bug-23, bug-25, bug-57, bug-94, bug-96 | idea-90/91/92, idea-125/127, idea-200, idea-222, idea-254 | **load-bearing primary** — substrate's reason for existing |
| **tele-3** Sovereign Composition | bug-27 (Doc-Code Drift) | idea-95, idea-113, idea-152 (composes) | substrate-class promotion — the v3 architectural play |
| **tele-4** Zero-Loss Knowledge | bug-25, bug-106 | idea-145, idea-152 (composes) | structural elimination of truncation class |
| **tele-6** Deterministic Invincibility | bug-48, bug-61, bug-96 | idea-110, idea-111 | wire-contract validation; bilateral-blind closure |
| **tele-7** Resilient Operations | bug-25 (impact), bug-60 | idea-93/94/96, idea-97/98/99, idea-262, idea-114 | long-thread context-discipline; metadata projection |

---

## §5 · What this initial pass leaves to the engineer or to a second pass

1. **Engineer cross-ref via psql** — populate sourceThreadId + sourceMissionId per entity to surface clusters this title-grep missed.
2. **mission-41 W3 invariant-coverage partition** (§2.8) — identify the ~5–8 thread-relevant of the 23-idea cluster.
3. **bug-25 + bug-106 root-cause confluence** — both are "LLM-facing layer corrupts substrate payload"; possible single architectural play closes both. Design-phase analysis.
4. **idea-292 update** — pending (separate ledger-currency edit) per the prior session's audit; reflect bug-115 closure + tag-field repair.
5. **idea-152 (Smart NIC) status** — strategic surface; do we treat it as the v3 target-state-fix-anchor (folds in) or as a peer sovereign-substrate (composes)? Design choice for the strategic review.

---

## §6 · Pre-SR shape recommendation

Based on this initial pass, the scoped strategic review should produce a **3-to-5-wave program**:

- **W1 — Wire contract + envelope** (idea-126, idea-113, bug-27, bug-96, idea-214). Schema-validated message envelope; closes the "gate-permissiveness" class structurally.
- **W2 — Substrate carve-out** (idea-200, idea-201, idea-207, idea-292 carryover, package boundary). Messages → Message-store; thread metadata → projection primitives.
- **W3 — Routing modes** (idea-90/91/92, bug-57, bug-60, bug-61, idea-98/99, idea-124). Multicast / anycast / broadcast hardening; dispatch contract.
- **W4 — Cascade FSM** (idea-93/94/95/96, bug-23, bug-48, idea-110, idea-111). Deferred-cascade queue; bilateral-seal race; reply idempotency; terminal-state precedence.
- **W5 — Size / response-shape structural fix** (idea-152 if folded; idea-145; bug-25; bug-106). The Smart NIC / Cognitive Implant play — depends on §5.5 disposition.

**Survey-per-mission at Phase 3** for each wave.

---

## Provenance

Director vision-framing 2026-05-22 AEST (idea-312 umbrella). Initial cartography pass authored
2026-05-23 (architect lily). Engineer enrichment + mission-41-W3 partition + strategic-review
scheduling pending.
