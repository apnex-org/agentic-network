# Architect-Engineer Collaboration Model

## 1. Overview

This document defines the collaboration model between the **Director** (human), **Architect** (cloud AI agent), and **Engineer** (local AI coding agent) in the OIS Agentic Network.

The system enables collaborative software engineering at scale through asynchronous, structured communication over the Model Context Protocol (MCP), with a central Hub brokering all interactions.

For formal workflow specifications (state machines, FSM transitions, cross-domain interactions, SSE events, invariants), see **[Workflow Registry v2.0](specs/workflow-registry.md)** — the authoritative source of truth.

---

## 2. Roles and Responsibilities

### 2.1 Director (Human)

| Responsibility | Description |
|---|---|
| **Strategic direction** | Sets project goals, telos, vision, and axioms |
| **Approval authority** | Approves proposals, phases, and architectural decisions |
| **Communication** | Interacts with the Architect via `architect-chat.sh` (terminal CLI) |
| **Oversight** | Reviews Architect assessments, monitors engineer status |
| **Does NOT** | Write code, call Hub tools directly, or interact with the Engineer directly |

### 2.2 Architect (Cloud Agent — Gemini on Vertex AI)

| Responsibility | Description |
|---|---|
| **Planning** | Translates Director intent into concrete engineering directives |
| **Governance** | Reviews engineering reports and proposals against project standards |
| **Tool discovery** | Dynamically discovers Hub tools via MCP — no hardcoded wrappers |
| **Communication modes** | **Discuss** (analyze without acting) vs **Execute** (issue directives) |
| **Auto-review** | Automatically reviews reports and proposals via SSE-triggered sandwich handlers |
| **Clarification** | Automatically answers Engineer clarification requests via sandwich handler |
| **Does NOT** | Execute code, access the filesystem, or call Engineer-tagged tools |

### 2.3 Engineer (Local Agent — OpenCode/Claude Code)

| Responsibility | Description |
|---|---|
| **Execution** | Writes code, edits files, runs commands based on directives |
| **Reporting** | Submits structured reports with summaries and verification data |
| **Proposals** | Submits proposals for design decisions needing Architect review |
| **Clarification** | Requests clarification on ambiguous directives before executing |
| **Threads** | Opens ideation threads for bidirectional discussion with Architect |
| **Does NOT** | Set project direction, approve proposals, or issue directives |

---

## 3. Key Workflows

| Workflow | Description |
|---|---|
| **WF-001** Task Execution | Director instructs Architect, directive issued, Engineer executes, report submitted, Architect auto-reviews |
| **WF-002** Proposal & Review | Engineer submits proposal, Architect auto-reviews, approves/rejects with feedback |
| **WF-003** Clarification | Engineer requests clarification, task pauses (`input_required`), Architect auto-responds, task resumes |
| **WF-004** Task Cancellation | Director instructs, Architect cancels, dependent tasks cascade-cancelled |
| **WF-005** Ideation Threads | Either party opens thread, strict turn-taking, convergence detection |
| **WF-005a/b** Convergence | On convergence: Hub cascade (deterministic, via `convergenceAction`) or Architect LLM (autonomous) — mutually exclusive |
| **WF-006** Mission Lifecycle | Architect creates missions, links tasks and ideas, tracks to completion |
| **WF-008** Event Loop | Architect polls `get_pending_actions` every 300s as SSE backup |

See [Workflow Registry](specs/workflow-registry.md) for full step-by-step specifications, state machine diagrams, and cross-domain interaction maps.

### 3.1 Task Execution (WF-001)

```
Director                    Architect                   Hub                         Engineer
   |                           |                         |                            |
   |  "Build feature X"        |                         |                            |
   |-------------------------->|                         |                            |
   |                           |  create_task()          |                            |
   |                           |------------------------>|                            |
   |                           |                         |  [task queued: pending]     |
   |                           |                         |                            |
   |                           |                         |  directive_issued (SSE) --->|
   |                           |                         |                            |
   |                           |                         |<---------------------------|
   |                           |                         |  get_task()                 |
   |                           |                         |--------------------------->|
   |                           |                         |                            |
   |                           |  directive_acknowledged  |                            |
   |                           |<------------------------|                            |
   |                           |                         |                            | [executes]
   |                           |                         |                            |
   |                           |                         |<---------------------------|
   |                           |                         |  create_report(summary,     |
   |                           |                         |   report, verification)     |
   |                           |                         |                            |
   |                           |  report_submitted (SSE) |                            |
   |                           |<------------------------|                            |
   |                           |                         |                            |
   |                           |  [AUTO-REVIEW via LLM]  |                            |
   |                           |  get_document(ref)      |                            |
   |                           |------------------------>|                            |
   |                           |<------------------------|                            |
   |                           |  create_review()        |                            |
   |                           |------------------------>|                            |
   |                           |                         |                            |
   |  "What's the status?"     |                         |                            |
   |-------------------------->|                         |                            |
   |<--------------------------|                         |                            |
   |  "Engineer completed X,   |                         |                            |
   |   all tests pass"         |                         |                            |
```

### 3.2 Proposal and Review (WF-002)

```
Engineer                    Hub                         Architect
   |                         |                            |
   |  create_proposal(       |                            |
   |    title, summary,      |                            |
   |    body)                |                            |
   |------------------------>|                            |
   |                         |  proposal_submitted (SSE)  |
   |                         |--------------------------->|
   |                         |                            |
   |                         |                            | [AUTO-REVIEW via LLM]
   |                         |                            | get_document(ref)
   |                         |<---------------------------|
   |                         |--------------------------->|
   |                         |                            | create_proposal_review(
   |                         |<---------------------------|   decision, feedback)
   |                         |                            |
   |  proposal_decided (SSE) |                            |
   |<------------------------|                            |
   |  get_proposal()         |                            |
   |------------------------>|                            |
   |<------------------------|                            |
   |  {decision: "approved", |                            |
   |   feedback: "..."}      |                            |
```

### 3.3 Clarification (WF-003)

```
Engineer                    Hub                         Architect
   |                         |                            |
   |  create_clarification(  |                            |
   |    taskId, question)    |                            |
   |------------------------>|                            |
   |                         |  [task -> input_required]  |
   |                         |  clarification_requested   |
   |                         |  (SSE)                     |
   |                         |--------------------------->|
   |                         |                            |
   |                         |                            | [AUTO-RESPOND via LLM]
   |                         |                            | resolve_clarification(
   |                         |<---------------------------|   taskId, answer)
   |                         |  [task -> working]         |
   |                         |                            |
   |  clarification_answered |                            |
   |  (SSE)                  |                            |
   |<------------------------|                            |
   |  get_clarification()    |                            |
   |------------------------>|                            |
   |<------------------------|                            |
   |  {answer: "..."}        |                            |
   |                         |                            |
   |  [resumes execution]    |                            |
```

### 3.4 Task Cancellation (WF-004)

```
Director                    Architect                   Hub
   |                           |                         |
   |  "Cancel that task"       |                         |
   |-------------------------->|                         |
   |                           |  cancel_task(taskId)    |
   |                           |------------------------>|
   |                           |                         |  [task -> cancelled]
   |                           |                         |  [dependents cascade]
   |                           |<------------------------|
   |<--------------------------|                         |
   |  "Task cancelled"         |                         |
```

### 3.5 Ideation Thread (WF-005)

```
Engineer                    Hub                         Architect
   |                         |                            |
   |  create_thread(         |                            |
   |    title, message)      |                            |
   |------------------------>|                            |
   |                         |  [thread -> active]        |
   |                         |  thread_message (SSE)      |
   |                         |--------------------------->|
   |                         |                            |
   |                         |                            | [AUTO-REPLY via LLM]
   |                         |                            | get_thread(threadId)
   |                         |<---------------------------|
   |                         |--------------------------->|
   |                         |                            | create_thread_reply(
   |                         |<---------------------------|   threadId, message)
   |                         |  [currentTurn -> engineer] |
   |                         |                            |
   |  thread_message (SSE)   |                            |
   |<------------------------|                            |
   |  get_thread(threadId)   |                            |
   |------------------------>|                            |
   |<------------------------|                            |
   |                         |                            |
   |  create_thread_reply(   |                            |
   |    converged=true)      |                            |
   |------------------------>|                            |
   |                         |  thread_message (SSE) ---->|
   |                         |                            | create_thread_reply(
   |                         |<---------------------------|   converged=true)
   |                         |  [thread -> converged]     |
   |                         |                            |
   |                         |  Path A: Hub cascade       |
   |                         |  (if convergenceAction)    |
   |                         |  -> auto-spawns task/      |
   |                         |     proposal, closes thread|
   |                         |                            |
   |                         |  Path B: Architect LLM     |
   |                         |  (if no convergenceAction) |
   |                         |  thread_converged (SSE) -->|
   |                         |                            | [LLM decides action]
   |                         |                            | create_task() if ready
```

---

## 4. Communication Infrastructure

| Component | Technology | Location |
|---|---|---|
| **Hub** | TypeScript/Express + MCP SDK | Cloud Run, `australia-southeast1` |
| **Architect** | Node.js/TypeScript + Vertex AI (Gemini) | Cloud Run, `australia-southeast1` |
| **Engineer** | Claude Code / OpenCode + MCP plugin | Local developer machine |
| **State** | GCS Bucket (`gs://ois-relay-hub-state`) | `australia-southeast1` |
| **Auth** | Bearer token (`HUB_API_TOKEN`) | All MCP endpoints |
| **Director CLI** | `architect-chat.sh` | Local terminal |

**Notification delivery:** MCP SSE push to connected agents (primary). Architect event loop polls every 300s (backup). Engineer receives via `claude/channel` experimental MCP notification.

**Entire stack is Node.js/TypeScript.** Single connection per agent. Full-duplex autonomous. Shared `@ois/network-adapter` package.

---

## 5. Open Friction Points

### 5.1 Stale Task Accumulation
**Status:** Open
**Issue:** Tasks from earlier sessions can remain in `working` status indefinitely. No timeout or cleanup mechanism exists.
**Proposed fix:** Heartbeat-based stuck task recovery — Engineer heartbeats, Hub detects stale tasks, reverts to pending after timeout.

### 5.2 Auto-Review Quality
**Status:** Open
**Issue:** The Architect's auto-review has limited context. It reads the report but doesn't evaluate against project axioms or previous decisions.
**Proposed fix:** Axiom registry in GCS. Architect loads axioms at boot and evaluates reports against them.

### 5.3 Single-Threaded Task Execution
**Status:** Open
**Issue:** The Engineer processes one directive at a time sequentially. No parallel execution or task batching.
**Impact:** Throughput limited by serial execution. Multiple directives queue up.

### Resolved (historical)

| Issue | Resolution |
|---|---|
| Engineer polling (6.6) | **Resolved** — SSE push notifications via `claude/channel` deliver directives in real-time (Phase 13e + plugin) |
| Session fragility (6.1) | **Mitigated** — `@ois/network-adapter` with state-based reconnect, session reaper, zero orphan sessions |
| Architect session isolation (6.2) | **Mitigated** — GCS-backed context store persists Architect context across restarts (Phase 14 Node.js rewrite) |
| Report-report gap (6.5) | **Resolved** — `get_pending_actions` surfaces all unreviewed tasks; `get_document` reads any report by ref |

---

## 6. Recommendations

### High Priority

| # | Recommendation | Impact |
|---|---|---|
| R1 | **Axiom Registry** — Store project axioms in GCS. Auto-review evaluates against axioms. | Governance-aware reviews |
| R2 | **Heartbeat-based stuck task recovery** — Hub detects stale tasks, reverts to pending. | Prevents task accumulation |

### Medium Priority

| # | Recommendation | Impact |
|---|---|---|
| R3 | **Task priority ordering** — `create_task` accepts priority. `get_task` returns highest-priority. | Better batching |
| R4 | **Multi-Engineer routing** — Route directives by capability or project. | Parallel teams |
| R5 | **Chat Web UI** — Replace `architect-chat.sh` with a web interface. | Better UX |

---

## 7. Platform Evolution Timeline

| Phase | Focus | Key Deliverable |
|---|---|---|
| 1-4 | MVP | Basic bidirectional comms (Hub + CLI + Agent Engine) |
| 5 | Cloud Run | Architect on Cloud Run with Gemini |
| 6a | Real coding agent | OpenCode as Engineer via remote MCP |
| 7 | Resilience | GCS persistence, Bearer auth, task state machine |
| 8 | Workflows | Summary+reference reports, webhooks, auto-review |
| 9 | Dynamic tools | McpToolset, role tags, persistent reports |
| 10 | Efficiency | Clarification, safe cancel, IP dedup, verification |
| 11 | Closed loops | Review workflow, close_proposal, ideation threads |
| 12 | Autonomy | get_pending_actions, audit trail, counter reconciliation |
| 13 | Transport | Hub client, sandwich pattern, SSE notifications, universal adapter |
| 14 | Node.js rewrite | Architect rewritten from Python/ADK to Node.js/TypeScript |
| 15 | Notifications | GCS-backed queue, Last-Event-ID replay, 24h TTL |
| 16 | Wisdom | ARCHITECTURE.md, ADRs, correlation IDs, context enrichment |
| Stability | Connection mgr | @ois/network-adapter, IConnectionManager, session reaper |
| IaC | Terraform | Idempotent GCP deployment, GitHub hosting, plugin marketplace |
