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
    case "thread_converged":
      return "Check thread for follow-up action";
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

export function buildPromptText(
  event: string,
  data: Record<string, unknown>,
  cfg: PromptFormatConfig
): string {
  const p = cfg.toolPrefix;
  switch (event) {
    case "thread_message":
      return (
        `[Architect] Replied to thread "${data.title || data.threadId}". ` +
        `It is your turn. Please call ${p}get_thread with threadId="${data.threadId}" ` +
        `to read the full thread, then reply using ${p}create_thread_reply.`
      );
    case "clarification_answered":
      return (
        `[Architect] Answered your clarification request for ${data.taskId}. ` +
        `Call ${p}get_clarification with taskId="${data.taskId}" ` +
        `to read the answer and resume your work.`
      );
    case "task_issued":
      return (
        `[Architect] Issued a new directive (${data.taskId || "pending"}). ` +
        `Call ${p}get_task to pick it up and execute it.`
      );
    case "review_completed":
      return (
        `[Architect] Reviewed ${data.taskId || "your report"}. ` +
        `Read it with ${p}get_review with taskId="${data.taskId}".`
      );
    case "revision_required":
      return (
        `[Architect] Your report for ${data.taskId || "task"} was REJECTED. ` +
        `Feedback: ${data.feedback || data.assessment || "No details provided"}. ` +
        `Previous report: ${data.previousReportRef || "unknown"}. ` +
        `Revision ${data.revisionCount || "?"}. Please revise and resubmit using ${p}create_report.`
      );
    case "proposal_decided":
      return `[Architect] Proposal ${data.proposalId || ""}: ${data.decision || "decided"}.`;
    case "thread_converged":
      return (
        `[Architect] Thread "${data.title || data.threadId}" converged with intent: ${data.intent || "none"}. ` +
        `Check if follow-up action is needed.`
      );
    default:
      return `[Architect] Hub notification: ${event}.`;
  }
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
    case "thread_converged":
      return `Thread converged: "${data.title || data.threadId}" (${data.intent || "no intent"})`;
    default:
      return `Hub: ${event}`;
  }
}
