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

### Ideation Threads

To start a bidirectional discussion with the Architect:
1. Call `architect-hub_create_thread` with a `title` and your opening `message`
2. The Architect will be notified and respond automatically
3. Call `architect-hub_get_thread` to read the full thread with all messages
4. Reply using `architect-hub_create_thread_reply` with the `threadId` and your response
5. Set `converged=true` when you agree with the Architect's position
6. Set `intent` to classify what the thread needs: `decision_needed`, `agreement_pending`, `director_input`, or `implementation_ready`
7. The thread auto-closes when both parties converge, or escalates at the round limit

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
