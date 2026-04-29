/**
 * Shared formatting helpers for engineer notification delivery.
 *
 * - `getActionText`: short hint used in structured notification logs.
 * - `buildPromptText`: detailed prompt injected into the LLM when an
 *   actionable event arrives. Parameterised by `toolPrefix` because
 *   Claude Code namespaces MCP tools as `mcp__<server>__<tool>` while
 *   OpenCode uses `architect-hub_<tool>`.
 * - `buildToastMessage`: short TUI toast, used by OpenCode only but
 *   kept here because the switch-on-event shape duplicates otherwise.
 *
 * mission-63 W3 (M-Wire-Entity-Convergence): converted from per-event-type
 * if-ladder to canonical render-template registry per Design v1.0 §4.2 +
 * ADR-028. Adding a new event-type = registering a template; no if-ladder
 * branch addition cost.
 *
 * Mandatory templates per Design §6.4 substrate-self-dogfood verification:
 *   - message_arrived (pulse + note inline rendering)
 *   - thread_message (body inlining; calibration #20 retire)
 *   - thread_convergence_finalized (truncation removal; calibration #20 sub-finding retire)
 *   - agent_state_changed (NEW — diff rendering using `previous` shape)
 *
 * Existing per-event templates (clarification_answered, task_issued,
 * review_completed, revision_required, proposal_decided) are mechanical
 * ports of the prior inline strings — registered as templates with no
 * behavior change.
 */

export function getActionText(
  event: string,
  data: Record<string, unknown>
): string {
  switch (event) {
    case "task_issued":
      return "Pick up with get_task";
    case "revision_required":
      return "Revise and resubmit with create_report";
    case "thread_message":
      return `Read with get_thread(threadId="${data.threadId}"), then reply with create_thread_reply`;
    case "thread_convergence_finalized":
      return "Review convergence report and act on follow-up if needed";
    case "clarification_answered":
      return `Read with get_clarification(taskId="${data.taskId}"), then resume work`;
    case "review_completed":
      return `Read with get_review(taskId="${data.taskId}")`;
    case "proposal_decided":
      return "Review decision and act if needed";
    default:
      return "Review and act as needed";
  }
}

export interface PromptFormatConfig {
  /**
   * Tool-name prefix for the host. Examples:
   *   - Claude Code: `"mcp__plugin_agent-adapter_proxy__"`
   *   - OpenCode:    `"architect-hub_"`
   */
  toolPrefix: string;
}

/**
 * A render template takes the event data + format config and returns the
 * LLM-prompt text. Registry pattern per Design §4.2 — each event-type
 * has exactly one template; adding a new event-type is template
 * registration, not switch-case addition.
 */
type RenderTemplate = (data: Record<string, unknown>, cfg: PromptFormatConfig) => string;

// ── Render templates (per-event) ───────────────────────────────────────

function renderThreadMessage(data: Record<string, unknown>, cfg: PromptFormatConfig): string {
  // calibration #20 retire (mission-63 W3): surface the body inline so the
  // LLM has the actual message content, not just the envelope-shell. The
  // Hub-side dispatch payload pre-truncates to 200 chars (thread-policy.ts);
  // adapter renders that preview verbatim. Full body still requires get_thread.
  const p = cfg.toolPrefix;
  const authorLabel = data.author === "architect" ? "Architect"
    : data.author === "engineer" ? "Engineer peer"
    : "Peer";
  const title = (data.title as string) || (data.threadId as string) || "(unknown)";
  const body = (data.message as string) || "";
  const bodyLine = body ? `\n\nMessage preview: ${body}` : "";
  return (
    `[${authorLabel}] Replied to thread "${title}".${bodyLine} ` +
    `\n\nIt is your turn. Call ${p}get_thread with threadId="${data.threadId}" ` +
    `to read the full thread, then reply using ${p}create_thread_reply. ` +
    `Threads 2.0 discipline: when you signal converged=true you MUST also populate ` +
    `\`stagedActions\` (for a purely-ideation thread: ` +
    `[{kind:"stage",type:"close_no_action",payload:{reason:"<short rationale>"}}]) ` +
    `AND a non-empty \`summary\` narrating the agreed outcome. ` +
    `The Hub gate rejects converged=true without both — read the error message and retry with the missing piece populated.`
  );
}

function renderThreadConvergenceFinalized(data: Record<string, unknown>, _cfg: PromptFormatConfig): string {
  // calibration #20 sub-finding retire (mission-63 W3): full summary surfaced
  // inline; mid-string truncation (.slice(0, 200)) removed. ConvergenceReport
  // detail still requires the SSE event payload's full report; this template
  // gives the LLM the negotiated narrative summary verbatim.
  const title = (data.title as string) || (data.threadId as string) || "(unknown)";
  const intent = (data.intent as string) || "none";
  const summary = (data.summary as string) || "(none)";
  const committed = (data.committedActionCount as number) ?? 0;
  const executed = (data.executedCount as number) ?? 0;
  const failed = (data.failedCount as number) ?? 0;
  const warning = data.warning ? ", WARNING" : "";
  return (
    `[Hub] Thread "${title}" converged with intent: ${intent}. ` +
    `Summary: ${summary}. ` +
    `Committed actions: ${committed} (executed=${executed}, failed=${failed}${warning}). ` +
    `Review the full ConvergenceReport in the event payload for any follow-up action.`
  );
}

function renderAgentStateChanged(data: Record<string, unknown>, _cfg: PromptFormatConfig): string {
  // mission-63 W3 NEW template per Design §3.4 + §6.4 verification point 3.
  // Canonical payload: {agent: AgentProjection, previous: {livenessState?,
  // activityState?}, changed[], cause, at}. Diff-renders the FSM transition
  // using `previous` (only fields that changed appear) for a tight
  // signal-to-noise readout.
  const agent = data.agent as Record<string, unknown> | undefined;
  const previous = (data.previous as Record<string, unknown> | undefined) ?? {};
  const cause = (data.cause as string) || "unknown";
  const id = (agent?.id as string) || "unknown";
  const name = (agent?.name as string) || id;
  const role = (agent?.role as string) || "agent";
  const newLiveness = (agent?.livenessState as string) || "unknown";
  const newActivity = (agent?.activityState as string) || "unknown";
  const livenessTransition =
    "livenessState" in previous
      ? `livenessState ${previous.livenessState as string} → ${newLiveness}`
      : null;
  const activityTransition =
    "activityState" in previous
      ? `activityState ${previous.activityState as string} → ${newActivity}`
      : null;
  const transitions = [livenessTransition, activityTransition].filter((t): t is string => t !== null);
  const transitionLine = transitions.length > 0 ? transitions.join("; ") : "no FSM-state delta";
  return (
    `[Hub] Agent ${role}/${name} (${id}) state-changed: ${transitionLine} (cause=${cause}).`
  );
}

function renderClarificationAnswered(data: Record<string, unknown>, cfg: PromptFormatConfig): string {
  const p = cfg.toolPrefix;
  return (
    `[Architect] Answered your clarification request for ${data.taskId}. ` +
    `Call ${p}get_clarification with taskId="${data.taskId}" ` +
    `to read the answer and resume your work.`
  );
}

function renderTaskIssued(data: Record<string, unknown>, cfg: PromptFormatConfig): string {
  const p = cfg.toolPrefix;
  return (
    `[Architect] Issued a new directive (${data.taskId || "pending"}). ` +
    `Call ${p}get_task to pick it up and execute it.`
  );
}

function renderReviewCompleted(data: Record<string, unknown>, cfg: PromptFormatConfig): string {
  const p = cfg.toolPrefix;
  return (
    `[Architect] Reviewed ${data.taskId || "your report"}. ` +
    `Read it with ${p}get_review with taskId="${data.taskId}".`
  );
}

function renderRevisionRequired(data: Record<string, unknown>, cfg: PromptFormatConfig): string {
  const p = cfg.toolPrefix;
  return (
    `[Architect] Your report for ${data.taskId || "task"} was REJECTED. ` +
    `Feedback: ${data.feedback || data.assessment || "No details provided"}. ` +
    `Previous report: ${data.previousReportRef || "unknown"}. ` +
    `Revision ${data.revisionCount || "?"}. Please revise and resubmit using ${p}create_report.`
  );
}

function renderProposalDecided(data: Record<string, unknown>, _cfg: PromptFormatConfig): string {
  return `[Architect] Proposal ${data.proposalId || ""}: ${data.decision || "decided"}.`;
}

function renderMessageArrived(data: Record<string, unknown>, cfg: PromptFormatConfig): string {
  // mission-62 W1+W2 Pass 7 — note-kind + pulse-content rendering fix.
  // Branches on payload discriminators to surface actual Message body
  // inline (pulse / note / wrapped legacy SSE event / generic).
  const p = cfg.toolPrefix;
  const msg = (data.message as Record<string, unknown>) ?? {};
  const payload = (msg.payload as Record<string, unknown>) ?? {};
  const msgId = (msg.id as string) || "?";
  const kind = (msg.kind as string) || "unknown";

  if (payload.pulseKind && typeof payload.pulseKind === "string") {
    const pMissionId = (payload.missionId as string) || "?";
    const pMessage = (payload.message as string) || "(empty pulse message)";
    const pResponseShape = (payload.responseShape as string) || "short_status";
    // mission-66 W1+W2 commit 5b-final (architect-portion; canonical shape per
    // hub/src/policy/note-schema.ts ratified at thread-428 round 3; landed in
    // commit 5 at 8193061). Canonical kind=note payload shape: { body: string
    // (REQUIRED, non-empty), ...optional metadata }. Hub-side reject-mode at
    // canonical repository write-path (messageRepository.createMessage) throws
    // NoteSchemaValidationError on invalid payload; LLM-callers see error nack
    // via MCP entry-point — caller-side feedback restores bilateral-blind class
    // closure (#41 STRUCTURAL ANCHOR). Per anti-goal #8 coordinated-upgrade
    // discipline + Calibration #48 (Director ratification 2026-04-29).
    return (
      `[Hub] Pulse fired (${payload.pulseKind}) for mission ${pMissionId}. ${pMessage} ` +
      `Respond with shape "${pResponseShape}" via the appropriate channel ` +
      `(typically ${p}create_message kind=note with payload {body: "<your status text>"}, ` +
      `OR a short status reply on the active coord-thread). ` +
      `Message ID: ${msgId}.`
    );
  }

  if (payload.event && typeof payload.event === "string") {
    return (
      `[Hub] Hub event injected: ${payload.event}. ` +
      `${getActionText(payload.event, (payload.data as Record<string, unknown>) ?? {})}. ` +
      `Message ID: ${msgId}.`
    );
  }

  if (kind === "note") {
    const body =
      (payload.body as string) ||
      (payload.text as string) ||
      (payload.message as string) ||
      "(empty note body)";
    const sender = (msg.authorAgentId as string) || "unknown";
    const senderRole = (msg.authorRole as string) || "agent";
    // mission-66 W1+W2 commit 5b-final (architect-portion; canonical shape per
    // hub/src/policy/note-schema.ts; see pulse-template comment above for context).
    return (
      `[${senderRole}/${sender}] Note: ${body} ` +
      `(Message ID: ${msgId}; respond via ${p}create_message kind=note ` +
      `with payload {body: "<your reply text>"} targeting the sender.)`
    );
  }

  return (
    `[Hub] Message ${msgId} (kind=${kind}) arrived. ` +
    `Use ${p}list_messages or ${p}claim_message to fetch full content + ack.`
  );
}

// ── Registry ────────────────────────────────────────────────────────────

const RENDER_REGISTRY: Map<string, RenderTemplate> = new Map([
  ["thread_message", renderThreadMessage],
  ["thread_convergence_finalized", renderThreadConvergenceFinalized],
  ["agent_state_changed", renderAgentStateChanged],
  ["message_arrived", renderMessageArrived],
  ["clarification_answered", renderClarificationAnswered],
  ["task_issued", renderTaskIssued],
  ["review_completed", renderReviewCompleted],
  ["revision_required", renderRevisionRequired],
  ["proposal_decided", renderProposalDecided],
]);

function defaultTemplate(event: string, _data: Record<string, unknown>, _cfg: PromptFormatConfig): string {
  return `[Hub] Notification: ${event}.`;
}

export function buildPromptText(
  event: string,
  data: Record<string, unknown>,
  cfg: PromptFormatConfig
): string {
  const template = RENDER_REGISTRY.get(event);
  if (template) return template(data, cfg);
  return defaultTemplate(event, data, cfg);
}

export function buildToastMessage(
  event: string,
  data: Record<string, unknown>
): string {
  switch (event) {
    case "task_issued":
      return `New directive: ${data.taskId || "unknown"}`;
    case "review_completed":
      return `Review complete: ${data.taskId || "task"}`;
    case "revision_required":
      return `Revision required: ${data.taskId || "task"} — report rejected`;
    case "proposal_decided":
      return `Proposal ${data.proposalId || ""}: ${data.decision || "decided"}`;
    case "clarification_answered":
      return `Clarification answered: ${data.taskId || "task"}`;
    case "thread_message":
      return `Thread reply: "${data.title || data.threadId || "thread"}"`;
    case "thread_convergence_finalized":
      return `Thread converged: "${data.title || data.threadId}" (${data.intent || "no intent"}, ${data.executedCount ?? 0}/${data.committedActionCount ?? 0} executed)`;
    case "agent_state_changed": {
      const agent = data.agent as Record<string, unknown> | undefined;
      const id = (agent?.id as string) || "unknown";
      const cause = (data.cause as string) || "unknown";
      return `Agent ${id} state-changed (${cause})`;
    }
    default:
      return `Hub: ${event}`;
  }
}
