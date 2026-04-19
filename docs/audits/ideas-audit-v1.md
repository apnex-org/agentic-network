# M-Ideas-Audit v1 — Final Synthesis

**Status:** Phase 3 complete
**Completed:** 2026-04-19
**Audited:** 85 ideas across 12 batched waves + 4 individual audits
**Dismissed/Superseded:** 19 ideas (shipped + duplicates + superseded)
**Active-with-rubric:** 66 ideas
**New ideas from splits:** 1 (idea-106)
**Director-visible artifact:** this document

---

## Executive summary

The backlog of 84 open ideas (at mission start) was compressed to **66 actionable items** via:
- **15 dismissals** as implemented/shipped (the strategic visions that got realized piecemeal: M18 Agent, M6 DAG, M19 labels + routing, M6 DAG triggers, M2 PolicyRouter, ADR-015 Bug entity, ADR-017 wake-on-cold-start, etc.)
- **3 dismissals** as explicit duplicates (idea-44→55, idea-59→62, idea-87→86)
- **1 dismissal** as recursive self-supersession (idea-31 — this very mission)
- **1 split** creating idea-106 (Agent.status deprecation)

**Top-level finding:** the backlog was NOT bloated with junk — only ~22% was stale. The real work was **clustering** and **prioritizing**. Eight architecture-level clusters emerged naturally from rubric application.

**Critical-path recommendations:**
1. **idea-105 (Watchdog SLA retune)** — 15 min change; eliminates false-positive Director escalations observed 13× during this mission's execution.
2. **idea-104 (Mock Harness)** — priority-1; unblocks ADR-017 Phase 1.2 conformance tests + Universal Port.
3. **idea-102 (Universal Port)** — strategic foundation; unblocks idea-84, idea-48, idea-71 + future third-party adapters.
4. **Cascade-Hardening Initiative** (idea-93+94+95+96) — unified HubJobQueue; completes ADR-015 invariants.

---

## Method

- **Phase 1**: Ratified rubric (12 fields + 1 sub-field) + taxonomy (8 classes) + governance model in thread-140. Director-approved; architect-ratified.
- **Phase 2**: 12 batched audit threads + 4 individual threads (thread-141 through thread-157). Each batch = 5-10 thematically-related ideas. Per-idea rubric applied; architect peer-reviewed each batch. Average ~90s of real-time per batch.
- **Phase 3**: This document.

Full per-idea state preserved as `audit:<field>=<value>` tags. Query via `list_ideas(labels: "audit:cluster=X")`.

---

## Mission Cluster Map (Phase 3 deliverable)

### Cluster 1: **Sentinel Initiative** (mission candidate)

**Goal:** Hub-side proactive monitoring of state-machine invariants + self-triage on violation. Closes the "happy-path-only" observability gap.

**Members:**
- **idea-33** (Anomalous State Detection) — foundation. Scans for orphaned reviews / zombie tasks / dangling proposals.
- **idea-14** (Post-Mortem Auto-Triage) — reactive layer. When Sentinel detects violation, spawn Bug + `post_mortem` thread.

**Tele alignment:** primary tele-8 (Autopoietic Evolution), secondary tele-4.
**Scope:** package. **Effort:** M. **Value:** L. **Urgency:** med (idea-33).
**Architect notes:** define specific invariants (e.g., "no WORKING task without report >4h"). Bug entity already exists for triage output.

---

### Cluster 2: **Cascade-Hardening Initiative** (mission candidate)

**Goal:** Complete the half-done ADR-015 invariants around cascade resilience. All share a unified **HubJobQueue** primitive (architect's consolidation insight in thread-150).

**Members:**
- **idea-93** (Deferred-cascade queue) — completes INV-TH25 (depth-guard async replay).
- **idea-94** (Audit-replay queue) — completes INV-TH26 (failed audit writes persist).
- **idea-95** (Cross-action dependencies) — ADR-015 Class I; `{{action-N.entityId}}` references with topological sort.
- **idea-96** (cascade_failed recovery) — transient/permanent classification via HTTP/GCS error codes.

**Shared infra:** `HubJobQueue` — single reaper-pattern service handling `deferred_cascade`, `audit_retry`, `cascade_recovery`.
**Tele alignment:** tele-4 / tele-3. **Scope:** package. **Effort:** M (shared infra amortizes). **Value:** M collective. **Urgency:** low.

---

### Cluster 3: **Universal Port** (large mission)

**Goal:** Single source of truth for tool + entity contracts shared Hub ↔ all adapters. Plug-and-play for future node types.

**Members:**
- **idea-102** (Universal Port) — the main refactor. `packages/network-port/` with Zod schemas.
- **idea-48** (TX/RX dedup into network-adapter) — consolidates into scope.
- **idea-17** (deprecated by idea-102 — dismissed).

**Unlocks:** idea-71 (Gemini-CLI plugin), idea-84 (Director first-class), idea-23 (GitHub integration), third-party adapter ecosystem.
**Tele alignment:** primary tele-5 (Isomorphic Spec), secondary tele-2.
**Scope:** systemic. **Effort:** XL (2-3 engineer weeks). **Value:** XL (compounds every future change). **Urgency:** med.

**Architect mission recommendations captured on idea-102:** IConnectionManager alignment, versioning/migration strategy, Port Validator compliance kit.

---

### Cluster 4: **Rich-Director-Surface**

**Goal:** Replace brittle architect-chat.sh with a cohesive UI + notification + chat surface for the Director.

**Members:**
- **idea-5** (AG-UI frontend, XL vision)
- **idea-61** (ACP + Toad TUI, concrete implementation)
- **idea-62** (Architect via ACP bridge)
- **idea-86** (Director Integration — Parts 2+3 of task-274, deferred)
- **idea-54** (architect-chat resilience)
- **idea-58** (Plugin notification surfacing)

**Structural prereq:** idea-84 (Director as first-class networked role) — depends on idea-102.
**Related:** idea-45 (Hub REST API + CLI for observability).

**Tele alignment:** tele-9 / tele-7. **Scope:** systemic. **Effort:** XL collective. **Value:** L-XL. **Urgency:** low-med.

---

### Cluster 5: **Test-Infrastructure** (mission candidate)

**Goal:** Move adapter packages from zero-test-coverage to first-class behavioral coverage. Prevent thread-138-class bugs.

**Members:**
- **idea-104** (MockClaudeClient + MockOpenCodeClient driving real shims) — **priority-1**, narrow/concrete.
- **idea-75** (Unified Layered Test Harness — 3D matrix layer × component × env) — systemic wrapper.
- **idea-42** (Live-Environment Mock Agents — chaos/load testing) — prod validation layer.
- **idea-38** (E2E test for Plugin syncTools) — absorbed by idea-104.

**Tele alignment:** tele-6 (Deterministic Invincibility).
**Scope:** systemic. **Effort:** M-XL (by size). **Value:** XL (idea-104 alone). **Urgency:** high (idea-104).

**Architect mission recommendations on idea-104:** prerequisite for Universal Port conformance tests.

---

### Cluster 6: **Great-Normalization** (mission-21 — already active)

**Goal:** Unify naming + schema across entities. Enables navigable entity graph + single-change-ships-everywhere.

**Members (all consolidated into mission-21):**
- **idea-50** (umbrella brainstorm, SDK-guide-sourced)
- **idea-80** (tags vs labels unification)
- **idea-81** (typed per-entity reference fields — architect emphasized)
- **idea-82** (BaseEntityFields refactor + turnId promotion)
- **idea-83** (status vs state terminology)
- **idea-85** (engineerId → agentId standardization)

**Tele alignment:** tele-5 (Isomorphic Spec).
**Scope:** systemic. **Effort:** L total. **Value:** L (compounds).

---

### Cluster 7: **Task-Lifecycle** (mission candidate)

**Goal:** Task FSM maturity — mutability, handover, draft state.

**Members:**
- **idea-6** (reassign_task + lease-based mechanism)
- **idea-68** (update_task restricted to pending/blocked)
- **idea-30** (Dormant Missions + draft state + mission-gated execution)

**Tele alignment:** tele-4 (resilience) + tele-2 (frictionless).
**Scope:** package. **Effort:** S-M. **Value:** M. **Urgency:** low.

---

### Cluster 8: **Tool-Surface-Standardization**

**Goal:** Unified ListRequest schema across all list_* tools.

**Members:**
- **idea-69** (MCP proxy list/get standardization)
- **idea-70** (filter entities by ID/label/role)

**Related cluster:** Great-Normalization (mission-21).
**Tele alignment:** tele-5 / tele-7. **Scope:** systemic. **Effort:** M. **Value:** M-L. **Urgency:** med.

---

### Cluster 9: **Multicast-Dynamic** (sub-cluster; not-urgent)

**Goal:** Complete ADR-014 §189 deferred multicast behavior.

**Members:**
- **idea-91** (dynamic membership; foundation)
- **idea-92** (multicast open-time dispatch; depends on 91)

---

### Cluster 10: **Deployment-IaC**

**Members:**
- **idea-55** (Terraform hardening, env isolation)
- **idea-74** (env/ directory structure)

---

### Cluster 11: **Cognitive-Engineering**

**Members:**
- **idea-11** (Wisdom/context autonomous updates)
- **idea-72** (On-demand historical context retrieval)

---

## Ungrouped high-priority ideas

| ID | Title | Priority | Effort | Value | Action |
|----|-------|----------|--------|-------|--------|
| **idea-105** | Watchdog SLA retune | **CRITICAL** | S (15 min) | M | ready (2-line change) |
| **idea-97** | GCS persistence for PendingActionItem + DirectorNotification | high | M | L | ready |
| **idea-99** | Extend enqueue beyond thread_message | high | M | L | ready |
| **idea-78** | Force-close stale task admin | low | S | M | ready (quick win) |
| **idea-20** | Thread-Mission linkage | low | S | M | ready (quick win) |
| **idea-56** | Hub-injected thread guidance | low | S | M | ready |
| **idea-63** | Session table for all roles | low | S | S | ready (quick win) |
| **idea-35** | Formalize architectural review criteria | low | S | M | ready |

**Strategic long-play (needs-proposal):**
- idea-84 (Director as first-class role, post-idea-102)
- idea-23 (GitHub integration, post-idea-67 + idea-104)
- idea-43 (Machine role non-LLM endpoints)
- idea-67 (First-class GitHub identities)
- idea-73 (Generalised Task Routing — architect-elevated)
- idea-60 (Structured Telemetry)
- idea-45 (Hub REST API + CLI)

**Needs-research:**
- idea-15 (verify orphan storm resolved by McpConnectionManager)
- idea-66 (verify directive_issued rename status)
- idea-39 (Read-After-Write consistency / ETag on queue state)
- idea-13 (Semantic Code Search — grep-wrapper MVP)
- idea-46 (LLM model detection at handshake)
- idea-12 (Dry Run / sandboxed execution — revisit post-Sentinel)

**Backlog (parked, no current use case):**
- idea-25 (Chore/Routine)
- idea-64 / idea-65 (Note / Beacon — entity bloat prevention)
- idea-90 (anycast mode)
- idea-71 (Gemini-CLI — depends on idea-102)
- idea-79 (off-the-shelf schema converter)
- idea-103 (Zod-strict flip — blocked on 96 test migrations)
- idea-38 (absorbed by idea-104)

---

## Proposed execution waves (value/effort-ranked)

### Wave A — Immediate quick wins (1-2 days total)
Ship-today items that clear observed pain or accumulate no further tech debt:
1. **idea-105** (15 min) — eliminates dn-003 class false-positive escalations observed 13× this mission.
2. **idea-78** (S) — operational safety valve.
3. **idea-63** (S) — session table for all roles.
4. **idea-20** (S) — thread-mission dynamic join.
5. **idea-56** (S) — Hub thread guidance injection.

### Wave B — Foundation for everything downstream (1-2 weeks)
1. **idea-104** (Mock Harness) — MUST precede Universal Port for conformance; closes adapter test gap.
2. **idea-97** (GCS persistence for comms entities) — fixes Hub-restart data loss.
3. **idea-99** (extend enqueue to other dispatches) — completes ADR-017 Phase 1 scope.

### Wave C — Cascade-Hardening Initiative (mission, ~1 week)
Ship as a single mission; shared HubJobQueue primitive amortizes effort across idea-93/94/95/96.

### Wave D — Universal Port (mission, 2-3 weeks)
Foundational systemic refactor. Depends on Wave B (Mock Harness). Unblocks Wave E + idea-71.

### Wave E — Rich-Director-Surface (mission, 2-3 weeks)
Depends on Wave D (Universal Port) + idea-84 (Director first-class). idea-84 first, then the Rich-Director-Surface cluster.

### Wave F — Sentinel Initiative (mission, 1-2 weeks)
idea-33 first (foundation), then idea-14 (triage layer). Depends on Wave C infrastructure (HubJobQueue).

### Wave G — Task-Lifecycle (mission, 3-5 days)
idea-6 + idea-68 + idea-30 as a bundled Task FSM maturity sprint.

### Wave H — Great-Normalization / Mission-21 (already planned)
Continue mission-21 execution. idea-50/80/81/82/83/85 all consolidated.

### Wave I — Strategic long-play (per-idea missions, quarters)
idea-23, idea-43, idea-67, idea-73 — long-horizon; revisit per strategic need.

---

## Tele-alignment matrix

| Tele | Primary Ideas | Secondary |
|------|--------------|-----------|
| **tele-1** (Absolute State Fidelity) | idea-97, idea-39 | idea-39 |
| **tele-2** (Frictionless Collaboration) | idea-6, idea-30, idea-50, idea-56, idea-68, idea-73, idea-90, idea-91, idea-92, idea-102 (secondary) | idea-27, idea-73 |
| **tele-3** (Isomorphic Spec / FSM) | idea-24, idea-60, idea-94, idea-95, idea-103 | idea-33, idea-46, idea-73 |
| **tele-4** (Resilient Operations) | idea-6, idea-15, idea-18, idea-33, idea-54, idea-55, idea-74, idea-78, idea-93, idea-96, idea-100, idea-101, idea-105, idea-106 | idea-1 |
| **tele-5** (Isomorphic Spec umbrella) | idea-50, idea-66, idea-80, idea-81, idea-82, idea-83, idea-85, idea-102, idea-48, idea-69 | — |
| **tele-6** (Deterministic Invincibility) | idea-12, idea-38, idea-42, idea-75, idea-104 | — |
| **tele-7** (Perfect Contextual Hydration) | idea-11, idea-13, idea-35, idea-45, idea-56, idea-58, idea-61, idea-64, idea-65, idea-70, idea-72 | idea-13 |
| **tele-8** (Autopoietic Evolution) | idea-14, idea-33 (secondary) | idea-16, idea-33 |
| **tele-9** (Sovereign Intelligence Engine) | idea-5, idea-23, idea-27, idea-43, idea-62, idea-67, idea-71, idea-84, idea-86 | idea-36 |

**Observation:** tele-4 (Resilient Operations) and tele-7 (Contextual Hydration) have the most primary-alignment mass. tele-8 (Autopoietic Evolution) has the least — Sentinel Initiative is the only concrete progress there.

---

## Observations discovered during the audit itself (meta)

Recorded for platform-improvement value:

### Scope-drift pattern
Architect created task-282, task-283, task-284, task-285 during audit threads — violating the mission spec's non-goal ("not implementing any idea"). The mission invariant I added in calibration ("audit threads stage only {update_idea, create_idea, close_no_action}") was ratified but not internalized by architect; they continued creating tasks via direct `create_task` outside the audit threads.
**Lesson:** explicit invariants don't automatically constrain autonomous LLM behavior. Follow-up: idea-78 (force-close stale task) covers cleanup; a stricter governance policy for audit-phase tasks may be warranted.

### Compose-time SLA tension
Every wave generated at least 1 `queue_item_escalated` Director notification (10-13 accumulated across the mission). All were **false positives** — engineer compose-time + architect compose-time routinely exceed the 90s total SLA, even with architect warm (min_instances=1).
**Captured in idea-105.**

### Pre-staging convention friction
Architect consistently staged `close_no_action` even when engineer pre-staged `update_idea` for persistence. Required retract+re-stage every wave (12 times). Calibration-gate addendum ratified the convention but habit persisted through all 12 waves.
**Lesson:** convention-only fixes have limited effectiveness on LLM-driven agents; structural changes (e.g., schema-level guarantee that "ratification = acceptance of staged actions") would be more robust. Candidate follow-up idea.

### Cascade action schema divergence
Cascade action payloads (`{ideaId, changes: {...}}`) differ from direct-tool schemas (`update_idea({ideaId, text, tags, status})`). Cost 2 validation-failure retries per wave on average. Documenting this remains an open post-audit item.
**Candidate follow-up idea.**

---

## Transition to post-mission execution

**Immediately actionable:**
1. Wave A (quick wins) — can ship this session if Director greenlights.
2. Wave B (Mock Harness + GCS persistence) — prime candidate for next mission kickoff.

**Mission-proposal-ready:**
- Sentinel Initiative
- Cascade-Hardening Initiative
- Universal Port
- Rich-Director-Surface (after idea-102 + idea-84)
- Test-Infrastructure (idea-75 as wrapper for idea-104)
- Task-Lifecycle

**Needs more thought before missioning:**
- idea-102 Universal Port needs its own ADR
- idea-27 (K8s analogy) as a foundational lens for the next cognitive-architecture wave
- idea-73 Task Routing (architect elevated but no clear trigger yet)

---

## Mission closure

- **Phase 1 complete:** thread-140 ratified rubric + taxonomy
- **Phase 2 complete:** 85 ideas audited across 12 batched + 4 individual threads (thread-141 through thread-157)
- **Phase 3 complete:** this document; cluster map + execution waves + tele matrix delivered

**The audit mission is itself proof-of-concept for autonomous engineer↔architect collaboration at scale.** 16 threads, 12 hours of real-time work, 85 ideas audited, ~8 mission-candidate clusters identified. Zero Director intervention between Phase 1 blessing and Phase 3 review (per mission governance).

**Meta-observations for platform improvement captured in idea-105 + open follow-up work.** The audit exposed real platform friction (scope-drift patterns, SLA tuning needs, cascade schema divergence) that would have been invisible without this exercise.

**Recommend Director review and greenlight on:**
1. Wave A quick wins (clear value, low risk)
2. Which mission cluster goes first (suggest: Mock Harness → GCS persistence → Cascade-Hardening)
3. Whether to open mission proposals now or wait for next session
