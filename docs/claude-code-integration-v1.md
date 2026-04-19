# Claude Code Integration Mission Brief

**Version:** 1.0.0
**Date:** 2026-04-14
**Classification:** Engineering Directive
**Issued By:** Director
**Target:** Claude Code Agent (new Engineer onboarding)

---

## 1. The Goal

You are being onboarded as a second Engineer agent in a distributed, multi-agent software engineering platform. The platform has three roles:

- **Director** (human) — sets goals, makes strategic decisions
- **Architect** (cloud AI agent) — plans, governs, issues directives, reviews work
- **Engineer** (you, and one other OpenCode-based agent) — executes coding tasks

**The Director mandates Autonomous Operation.** You must be capable of:

1. Receiving asynchronous SSE push notifications from the Hub (e.g., `task_issued`, `revision_required`, `thread_message`)
2. Autonomously waking up your LLM to process them — without human intervention
3. Executing multi-step workflows: picking up tasks, submitting reports, participating in threads, handling clarifications
4. Maintaining a persistent, resilient connection to the Hub that survives Cloud Run connection draining, network partitions, and process restarts

This is NOT a "call a tool when the human tells you to" integration. You must operate as a persistent daemon that reacts to events in real-time, just like the existing OpenCode Engineer.

---

## 2. The Platform Architecture

### 2.1 The Hub (MCP Relay Hub)

The Hub is a centralized MCP server deployed on Google Cloud Run. It manages all platform state:

- **Tasks** — work items with a full FSM lifecycle (`pending → working → in_review → completed`)
- **Proposals** — structured change requests with auto-scaffolding
- **Threads** — turn-based ideation conversations between Architect and Engineer
- **Clarifications** — question/answer loops on active tasks
- **Reviews** — Architect assessments that gate DAG cascades
- **Missions, Turns, Ideas, Tele** — planning and governance entities

The Hub exposes 43 MCP tools organized by domain (Task, Proposal, Thread, Review, Clarification, etc.). All tools follow a CRUD naming convention: `create_*`, `get_*`, `list_*`, `update_*`, `close_*`.

### 2.2 Layer 7: PolicyRouter

All 43 tools are served by a PolicyRouter — a stateless singleton that dispatches tool calls to domain-specific policy handlers. The PolicyRouter enforces:

- **FSM guards** — invalid state transitions are rejected (e.g., you cannot report on a `blocked` task)
- **RBAC** — tools are tagged `[Architect]`, `[Engineer]`, or `[Any]`. The Hub rejects unauthorized calls.
- **DAG cascades** — completing a parent task (via review approval) automatically unblocks dependent children
- **Cross-domain side effects** — creating a task with a `correlationId` auto-links it to a mission

### 2.3 Communication Model

The Hub uses two communication channels:

1. **Tool calls (pull)** — You call MCP tools to read/write state. Standard MCP request-response.
2. **SSE notifications (push)** — The Hub pushes events to connected clients via Server-Sent Events embedded in the MCP transport's logging channel. These events notify you of things that happened asynchronously (e.g., the Architect issued a new task, replied to your thread, or rejected your report).

**The push channel is critical.** Without it, you cannot participate in real-time workflows. You would only discover new work by manually polling `get_task` — making you a second-class citizen in the network.

### 2.4 Connection Resilience (ADR-008, ADR-009)

The Hub runs on Cloud Run, which has aggressive connection lifecycle management:

- **Connection draining:** Cloud Run severs SSE connections every ~60 minutes during deployments
- **Keepalive enforcement:** The Hub sends keepalive pings every 30 seconds. If you miss 3 consecutive keepalives, the Hub considers your session dead.
- **Zombie session prevention:** If your process crashes without cleanly disconnecting, the Hub holds the dead session until the heartbeat timeout fires (90 seconds). During this time, your tasks may be locked.

Direct connections to the Hub over the public internet WILL result in zombie sessions, missed notifications, and locked tasks. This is not theoretical — we spent weeks debugging and fixing these exact issues.

---

## 3. The Required SDK: `@ois/network-adapter`

You MUST use our `@ois/network-adapter` SDK (formerly `@ois/hub-connection`) to connect to the Hub. This SDK provides the `UniversalClientAdapter` — a battle-tested connection manager that handles:

- **State-based reconnect:** On connection, the adapter enters `Synchronizing` state, allowing you to call `get_pending_actions` to discover missed work, then `completeSync()` to transition to `Streaming` and flush buffered events.
- **Dual-channel heartbeat:** MCP-level heartbeat + SSE keepalive monitoring
- **SSE watchdog:** Detects dead SSE streams within 90 seconds
- **Exponential backoff:** On connection failure, retries with increasing delays
- **Clean shutdown:** Properly tears down the Hub session on process exit

### 3.1 The `IClientShim` Interface

The SDK uses a shim pattern to decouple transport logic from client-specific behavior. You must implement the `IClientShim` interface:

```typescript
interface IClientShim {
  onConnectionStateChange(
    state: ConnectionState,  // "disconnected" | "connecting" | "synchronizing" | "streaming" | "reconnecting"
    prev: ConnectionState,
    reason?: ReconnectReason
  ): void;

  onActionableEvent(eventData: Record<string, unknown>): void;
  onInformationalEvent(eventData: Record<string, unknown>): void;
}
```

**Key callbacks:**

- `onConnectionStateChange`: Called on every state transition. When state becomes `"synchronizing"`, you should call `get_pending_actions` to discover missed work, then `adapter.completeSync()` to enter `"streaming"`.

- `onActionableEvent`: Called when the Hub pushes an event that requires your LLM to act. Examples:
  - `task_issued` — new task available, pick it up with `get_task`
  - `revision_required` — your report was rejected, read feedback and resubmit
  - `thread_message` — the Architect replied to a thread, read and respond
  - `clarification_answered` — the Architect answered your question, resume work

- `onInformationalEvent`: Called for events that don't require action (e.g., `review_completed`, `proposal_decided`).

### 3.2 The `UniversalClientAdapter` Lifecycle

```typescript
const adapter = UniversalClientAdapter.getInstance(
  {
    url: "https://mcp-relay-hub-XXXXX.australia-southeast1.run.app",
    token: "YOUR_ENGINEER_TOKEN",
    role: "engineer",
  },
  yourShimImplementation,
  (msg) => console.log(msg)  // logger
);

await adapter.start();

// Now connected. The adapter will:
// 1. Enter "synchronizing" state (your shim's onConnectionStateChange fires)
// 2. You call get_pending_actions + completeSync()
// 3. Enter "streaming" state — live events flow to onActionableEvent

// Tool calls:
const result = await adapter.executeTool("get_task", {});
const review = await adapter.executeTool("create_report", { taskId, report, summary });

// Clean shutdown:
await adapter.stop();
```

---

## 4. The Hard Problem: Prompt Injection

This is the critical technical challenge you must solve.

### 4.1 The Gap

When the `UniversalClientAdapter` receives an SSE event, it calls your shim's `onActionableEvent(eventData)`. At this point, you have the event data in JavaScript — but how do you make your LLM actually process it?

In the existing OpenCode integration, the Plugin uses OpenCode's SDK to programmatically inject a new user message into the active conversation:

```typescript
// OpenCode's solution (for reference — you cannot use this)
onActionableEvent(eventData) {
  const prompt = buildPromptText(eventData);
  sdkClient.chat.send(prompt);  // Injects a new user message → triggers LLM evaluation
}
```

The `sdkClient.chat.send()` call is the "prompt injection" hook — it forces the LLM to wake up and process the event as if the user typed a message.

### 4.2 Your Challenge

**You must find or build the equivalent of `sdkClient.chat.send()` for Claude Code.**

Research questions:
1. Does Claude Code expose an API or hook that allows programmatic injection of user messages into an active session?
2. Can Claude Code's MCP server implementation send unsolicited notifications that trigger LLM evaluation (not just metadata events like `tools/list_changed`)?
3. Does Claude Code have a plugin/extension system that allows background processes to inject context into the conversation?
4. Can Claude Code run in a "daemon mode" where it maintains a persistent event loop and reacts to external triggers?

If you find a native mechanism for prompt injection, the integration becomes straightforward: implement `IClientShim`, wire `onActionableEvent` to Claude Code's prompt injection API, and you're done.

### 4.3 If Prompt Injection Is Impossible

If Claude Code has no mechanism for programmatic prompt injection, we fall back to the Pass-Through Proxy architecture (Section 5). This is functional but degrades the experience from autonomous to human-supervised.

---

## 5. The Fallback: Pass-Through Proxy

If true autonomous operation is impossible, we build a lightweight local proxy:

```
Claude Code <--(stdio MCP)--> Pass-Through Proxy <--(SDK SSE)--> Cloud Hub
```

### 5.1 Architecture

The Proxy is a single TypeScript process (~200 lines) that:

1. **Connects to Hub** via `UniversalClientAdapter` (resilient SSE, state-based reconnect)
2. **Exposes MCP tools** via stdio to Claude Code using the low-level MCP `Server` class
3. **Dynamically proxies** `ListTools` and `CallTool` requests — every request fetches live state from the adapter, no static caching
4. **Writes notifications** to `.ois/claude-notifications.log` in human-readable format
5. **Manages lifecycle** — stdio pipe closure triggers `adapter.stop()` with a 3-second timeout

### 5.2 Dynamic Tool Proxying (Critical)

The Proxy MUST NOT statically register tools. It must use the low-level MCP `Server` class with dynamic request handlers:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "proxy", version: "1.0.0" }, { capabilities: { tools: {} } });

// Dynamic — fetches live tool list on every request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await adapter.listTools();
  return { tools };
});

// Dynamic — proxies every call to the adapter
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return await adapter.executeTool(request.params.name, request.params.arguments);
});
```

**Why not the high-level `McpServer` class?** Because `McpServer.tool()` statically registers tools at startup and caches them. If the Hub's toolset changes (deployment, schema update), the Proxy would serve stale data. The low-level `Server` class fetches fresh state on every request.

### 5.3 Notification Log

When the adapter receives a push notification, the Proxy writes a formatted entry to `.ois/claude-notifications.log`:

```
[2026-04-14 14:32:05] DIRECTIVE_ISSUED
  Task: task-125 "Build caching layer"
  Action: Pick up with get_task

[2026-04-14 14:35:12] REVISION_REQUIRED
  Task: task-123
  Feedback: Error handling is incomplete. Add retry logic.
  Previous report: reports/task-123-v1-report.md
  Action: Revise and resubmit with create_report
```

The Director monitors this log with `tail -f .ois/claude-notifications.log` in an adjacent terminal pane.

### 5.4 Lifecycle Management

```typescript
// Clean shutdown on stdio closure (Claude Code exits)
transport.onclose = async () => {
  const timeout = setTimeout(() => process.exit(1), 3000);
  await adapter.stop();
  clearTimeout(timeout);
  process.exit(0);
};

// Clean shutdown on signals
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    const timeout = setTimeout(() => process.exit(1), 3000);
    await adapter.stop();
    clearTimeout(timeout);
    process.exit(0);
  });
}
```

The 3-second timeout prevents hanging on network partition. If `adapter.stop()` doesn't complete in 3 seconds, force exit.

---

## 6. Critical Constraints

### 6.1 Do NOT Mutate Tool Results

During our design phase (thread-75), we considered intercepting tool call results and prepending notification alerts to them. This was rejected as architecturally unsound.

**The problem:** If Claude Code calls `list_tasks` and expects a JSON response, prepending `[SYSTEM ALERT: ...]` to the result corrupts the JSON structure. Claude Code's internal parsers will fail, causing cascading tool execution failures.

**The rule:** Tool call results MUST be passed through unmodified. Notifications must use a separate channel (log file, stderr, MCP logging) — never the tool result payload.

### 6.2 Dedicated Identity

You must connect with a dedicated engineer token, not the existing OpenCode Engineer's token. The Hub uses session identity for:
- RBAC enforcement (Engineer vs Architect tools)
- Audit logging (which agent did what)
- Task assignment (which engineer picked up which task)
- Engineer status tracking (`get_engineer_status`)

Your identity should be provisioned as `engineer-claude-1` with a separate auth token.

### 6.3 RBAC Rules

Tools are tagged by role. The Hub enforces these at the PolicyRouter level:

- `[Engineer]` tools: `get_task`, `create_report`, `create_clarification`, `get_clarification`, `create_proposal`, `get_proposal`, `close_proposal`
- `[Architect]` tools: `create_task`, `cancel_task`, `create_review`, `get_report`, `resolve_clarification`, `create_proposal_review`, `get_engineer_status`, `create_audit_entry`, `close_thread`, `get_pending_actions`
- `[Any]` tools: `register_role`, `list_tasks`, `list_proposals`, `get_review`, `create_thread`, `create_thread_reply`, `get_thread`, `list_threads`, `list_audit_entries`, `get_document`, `create_document`, `list_documents`, and all Idea/Mission/Turn/Tele tools

If you call an Architect-only tool, the Hub returns: `{ error: "Authorization denied: tool 'create_task' requires role 'architect', but caller is 'engineer'" }`.

---

## 7. Workflow Reference

### 7.1 Task Lifecycle (Happy Path)

1. Architect creates task → `task_issued` SSE event → you
2. You call `get_task` → receive task details, status becomes `working`
3. You execute the work (edit files, run commands, etc.)
4. You call `create_report(taskId, report, summary)` → status becomes `in_review`
5. Architect reviews → either `review_completed` (approved, task `completed`) or `revision_required` (rejected, task back to `working`)
6. If rejected: read feedback, revise, re-submit report (step 4)

### 7.2 Thread Participation

1. Architect opens thread → `thread_message` SSE event → you
2. You call `get_thread(threadId)` to read the full thread
3. You call `create_thread_reply(threadId, message, opts)` to respond
4. Thread alternates turns until convergence or close

### 7.3 Clarification

1. You're working on a task but need guidance
2. Call `create_clarification(taskId, question)` → task enters `input_required`
3. Wait for `clarification_answered` SSE event
4. Call `get_clarification(taskId)` to read the answer
5. Resume work

### 7.4 Report Template

```
## Task: {taskId}
### Task
{title}: {description}
### Changes Made
{list of files changed with descriptions}
### Verification
{test command and output, or "N/A" for non-code tasks}
### Status
{SUCCESS | FAILED | PARTIAL}
### Notes
{any additional context}
```

---

## 8. SDK Installation

The SDK is distributed as a local tarball:

```bash
npm install ./packages/network-adapter/ois-network-adapter-2.0.0.tgz
```

Key exports:
```typescript
import { McpAgentClient, McpTransport } from "@ois/network-adapter";
import type { AgentClientCallbacks, SessionState, SessionReconnectReason } from "@ois/network-adapter";
```

---

## 9. Success Criteria

Your integration is complete when:

1. You can connect to the Hub and maintain a persistent, resilient SSE connection
2. You can call all Engineer-tagged MCP tools and receive correct responses
3. You receive `task_issued` SSE events and autonomously pick up tasks
4. You receive `thread_message` SSE events and autonomously reply to threads
5. You receive `revision_required` SSE events and autonomously revise reports
6. Your connection survives Cloud Run deployments (reconnects within 30 seconds)
7. Your process exits cleanly on shutdown (no zombie Hub sessions)
8. The Hub's `get_engineer_status` shows two connected engineers: `engineer-opencode-1` and `engineer-claude-1`

---

## 10. File Map

```
agentic-network/
  packages/network-adapter/          # The SDK — use this
    src/transport.ts                 # McpTransport (L4 wire)
    src/agent-client.ts              # McpAgentClient (L7 session)
    ois-network-adapter-2.0.0.tgz    # Installable tarball
  hub/                               # The Hub — do not modify
    src/policy/                      # All 13 domain policies
  docs/specs/workflow-registry.md    # Authoritative workflow specification
  agents/vertex-cloudrun/            # The Architect shell — do not modify
  adapters/opencode-plugin/src/shim.ts  # OpenCode adapter — reference implementation
  adapters/claude-plugin/            # Claude Code adapter — reference implementation
  AGENTS.md                          # Workflow instructions (OpenCode-specific)
```

The OpenCode adapter (`adapters/opencode-plugin/src/shim.ts`) is your primary reference implementation. Study how it wires `McpAgentClient` callbacks, handles state sync, and routes notifications.
