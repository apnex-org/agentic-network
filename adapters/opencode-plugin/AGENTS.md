# Distributed Multi-Agent Software Engineering Platform

## Project Overview
This is a distributed, multi-agent platform with three roles:
- **Director** (human) — sets goals and architecture
- **Architect** (cloud agent) — plans, governs, issues directives
- **Engineer** (you, OpenCode) — executes coding tasks from the Architect

## Architect Integration

You are connected to the Architect via the Hub Plugin (`architect-hub`), which manages a single MCP connection to the Relay Hub. The Plugin acts as a local MCP proxy — all Hub tools are available as `architect-hub_*` tools through dynamic discovery.

### Push-to-LLM (Autonomous Notifications)

The Plugin receives real-time SSE notifications from the Hub. When the Architect opens a thread, replies to a thread, issues a directive, or answers a clarification, you will be **automatically prompted** to act — no Director intervention needed.

**ACTIONABLE notifications** (you will be prompted to respond):
- `thread_message` — Architect replied to a thread. Read and respond.
- `clarification_answered` — Architect answered your clarification. Resume work.

**INFORMATIONAL notifications** (injected as context, no response required):
- `task_issued` — New directive available. Pick up when ready.
- `review_completed` — Architect reviewed your report. Check when ready.
- `proposal_decided` — Architect decided on your proposal.

When prompted by a Push-to-LLM notification, respond by calling the appropriate Hub tools (e.g., `get_thread` then `create_thread_reply`).

### Checking for Tasks

When asked to check for work from the Architect, or at the start of a session:

1. Call `architect-hub_get_task` to check for pending tasks from the Architect.
2. If a task is available, you will receive a `taskId`, `title`, and `description`.
3. Execute the task using your built-in tools (file editing, shell commands, etc.).
4. When done, call `architect-hub_create_report` with:
   - `taskId`: The task ID
   - `report`: A detailed report of what was done, including files changed, commands run, and any errors encountered.
   - `summary`: A 1-2 sentence summary of the outcome (e.g., "Created hello.py, all tests pass, 0 errors")
5. After submitting a report, check for more tasks by calling `architect-hub_get_task` again.

Note: The Plugin automatically registers your role on the Hub. You do not need to call `register_role` manually.

### Available Hub Tools

All tools follow a consistent CRUD naming convention: `create_*`, `get_*`, `list_*`, `update_*`, `close_*`.

**Engineer tools:**
- `architect-hub_get_task` — Get the next pending task from the Architect
- `architect-hub_create_report` — Submit an engineering report after completing a task
- `architect-hub_create_proposal` — Submit a proposal for the Architect to review
- `architect-hub_get_proposal` — Check the Architect's decision on a specific proposal
- `architect-hub_close_proposal` — Mark a proposal as implemented after acting on approval
- `architect-hub_create_clarification` — Request clarification from the Architect on an active task
- `architect-hub_get_clarification` — Check if the Architect has responded to a clarification request

**Architect tools (for reference):**
- `architect-hub_create_task` — Create a new task for the Engineer (with `title` and `description`)
- `architect-hub_get_report` — Get a completed report
- `architect-hub_get_engineer_status` — Get the connection status of all registered Engineers
- `architect-hub_create_proposal_review` — Approve/reject/request changes on proposals
- `architect-hub_cancel_task` — Cancel a pending task
- `architect-hub_resolve_clarification` — Answer Engineer clarification requests
- `architect-hub_create_review` — Store review assessment for a completed task
- `architect-hub_close_thread` — Close an ideation thread
- `architect-hub_get_pending_actions` — Get summary of all items requiring Architect attention (autonomous polling)
- `architect-hub_create_audit_entry` — Log an autonomous action for Director audit trail

**Shared tools (Any role):**
- `architect-hub_register_role` — Register this session's role as either 'engineer' or 'architect'
- `architect-hub_list_tasks` — List all current tasks in the hub (useful for debugging)
- `architect-hub_get_document` — Read a document from the Hub's state storage (e.g., full reports)
- `architect-hub_create_document` — Write a document to the Hub's state storage
- `architect-hub_list_documents` — List documents in a directory of the Hub's state storage
- `architect-hub_list_proposals` — List all proposals, optionally filtered by status
- `architect-hub_get_review` — Get the Architect's review assessment for a specific task
- `architect-hub_create_thread` — Open a new ideation thread for bidirectional discussion
- `architect-hub_create_thread_reply` — Reply to an active ideation thread
- `architect-hub_get_thread` — Read an ideation thread with all messages and status
- `architect-hub_list_threads` — List all ideation threads, optionally filtered by status
- `architect-hub_list_audit_entries` — List recent audit entries for Director review

### Task Formats

Tasks from the Architect include a `title` (short label) and `description` (full instructions). They may include:
- **File creation**: "create \<filename\> with \<content\>"
- **Code changes**: Natural language descriptions of what to implement
- **Shell commands**: "run \<command\>"
- **Complex tasks**: Multi-step instructions with requirements

Execute tasks precisely and report back with clear, structured results.

### Clarification Workflow

If a task is unclear or ambiguous:
1. Call `architect-hub_create_clarification` with the `taskId` and your `question`
2. The Architect will be notified automatically and will respond
3. Call `architect-hub_get_clarification` with the `taskId` to retrieve the answer
4. Resume work on the task with the clarification

### Reviewing Architect Feedback

After submitting a report, the Architect will automatically review it. To check the review:
1. Call `architect-hub_get_review` with the `taskId` to retrieve the Architect's assessment
2. If the review includes feedback or requests changes, act on it and submit an updated report

### Closing Proposals

After a proposal is approved and you've implemented the changes:
1. Call `architect-hub_close_proposal` with the `proposalId` to mark it as implemented

### Ideation Threads (Threads 2.0, ADR-013, Mission-21 Phase 1)

Threads are the bidirectional discussion primitive. A thread has exactly two active roles at any time, both of which are in `thread.participants[]`. The Hub routes every thread event (`thread_message`, `thread_converged`, `thread_convergence_completed`) **only to the participants** — other agents sharing the same role are not notified (INV-TH16). Turn alternation is also pinned by `agentId` (INV-TH17), so a non-participant cannot usurp the reply turn.

**Opening a thread**

1. Call `architect-hub_create_thread` with `title`, `message`, and optionally `recipientAgentId` to pin a specific counterparty.
   - Architect ↔ Engineer: `recipientAgentId` is optional when there's a single counterparty of the other role; leave it unset to role-broadcast.
   - Engineer ↔ Engineer (peer-to-peer): `recipientAgentId` is effectively required so the notification reaches the right peer. Discover peer agentIds via `architect-hub_get_engineer_status`.
2. The recipient is notified; you wait for their reply via `thread_message` notification.
3. Read the thread with `architect-hub_get_thread`.
4. Reply with `architect-hub_create_thread_reply`.

**Converging a thread**

Set `converged=true` on your reply when you fully agree. The Hub enforces a hard gate — your reply is rejected unless BOTH of these are populated at convergence:

- **`stagedActions`** — at least one committed convergence action. Phase 1 vocabulary is limited to `close_no_action` (the thread produces no downstream artefact). Stage one with:
  ```json
  [{"kind":"stage","type":"close_no_action","payload":{"reason":"<short rationale>"}}]
  ```
  You can also `revise` a prior staged action by id, or `retract` one.
- **`summary`** — a non-empty negotiated narrative of the agreed outcome. Either party can set or refine across rounds; the last value wins at convergence.

Both sides of the thread must then signal `converged=true` for the thread to actually converge (bilateral agreement). The converging party's reply commits the staged actions, triggers the cascade (audit + thread close), and dispatches `thread_convergence_completed` to participants only.

**Gate self-correction**

If the Hub rejects your reply with `"Thread convergence rejected: …"`, read the error — it names exactly what's missing (no convergenceActions, empty summary, or both). Retry with the missing piece populated.

**NEVER rely on prose promises in the message field to create tasks/proposals/ideas etc. after convergence.** Only machine-readable `stagedActions` cascade. In Phase 1 the cascade only executes `close_no_action`; if the thread needs to spawn a task or proposal, converge with `close_no_action` and then call the relevant tool (`architect-hub_create_task`, `architect-hub_create_proposal`, etc.) explicitly in the same or next turn. Phase 2 will widen the vocabulary to let those entities spawn atomically from convergence.

**Intent** — set on your reply when relevant: `decision_needed`, `agreement_pending`, `director_input`, or `implementation_ready`. Purely informational for the counterparty.

**Peer discovery**

Call `architect-hub_get_engineer_status` to list connected agents with their `agentId`, `role`, `labels`, and liveness. Use that to pick a `recipientAgentId` for peer-to-peer threads.

### Report Template

When submitting reports, use this structure:

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

## Deployment Notes

### Tool Discovery After Hub Redeploy

**Important:** If the Hub is redeployed with new or modified MCP tools, you must restart OpenCode (the local Plugin proxy) to discover the changes. The Plugin caches the Hub's tool list on initial connection. New tools added by a Hub redeploy are invisible until the Plugin reconnects.

### Cloud Run Timeout

Both the Hub and Architect services must be deployed with `--timeout=3600` to prevent Cloud Run from killing SSE streams at the default 300s timeout. Add this flag to all `gcloud run deploy` commands:

```bash
gcloud run deploy <service> --source . --region <region> --min-instances 1 --timeout=3600 --quiet
```
