/**
 * Structured notification logger.
 *
 * Writes a multi-line human-readable block per event to a caller-supplied
 * log file. Extracts known fields (taskId, threadId, proposalId, assessment,
 * decision, intent, revisionCount, previousReportRef, feedback) so downstream
 * tools can grep them deterministically.
 *
 * OpenCode's pre-refactor logger wrote only `${iso} ${msg}\n`, which is why
 * tonight's investigation could not correlate task IDs between engineers.
 * This module closes that telemetry gap.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface NotificationLogEntry {
  event: string;
  data: Record<string, unknown>;
  action: string;
}

export interface NotificationLogOptions {
  /** Absolute path to the log file. Parent directory will be created. */
  logPath: string;
  /** Optional mirror sink (e.g. process.stderr.write) called with the block. */
  mirror?: (block: string) => void;
}

/**
 * Append a structured notification block to the log file.
 * Best-effort: write failures are silently swallowed (the log must never
 * break the runtime).
 */
export function appendNotification(
  entry: NotificationLogEntry,
  opts: NotificationLogOptions
): void {
  const { event, data, action } = entry;
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const lines: string[] = [`[${ts}] ${event.toUpperCase()}`];

  if (data.taskId) {
    lines.push(`  Task: ${data.taskId}${data.title ? ` "${data.title}"` : ""}`);
  }
  if (data.threadId) {
    lines.push(`  Thread: ${data.threadId}${data.title ? ` "${data.title}"` : ""}`);
  }
  if (data.proposalId) lines.push(`  Proposal: ${data.proposalId}`);
  if (data.feedback) lines.push(`  Feedback: ${data.feedback}`);
  if (data.assessment) lines.push(`  Assessment: ${data.assessment}`);
  if (data.decision) lines.push(`  Decision: ${data.decision}`);
  if (data.intent) lines.push(`  Intent: ${data.intent}`);
  if (data.previousReportRef) lines.push(`  Previous report: ${data.previousReportRef}`);
  if (data.revisionCount) lines.push(`  Revision: ${data.revisionCount}`);

  lines.push(`  Action: ${action}`);
  lines.push("");

  const block = lines.join("\n");

  try {
    const dir = dirname(opts.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(opts.logPath, block);
  } catch {
    /* best effort */
  }

  if (opts.mirror) {
    try {
      opts.mirror(block);
    } catch {
      /* best effort */
    }
  }
}

/**
 * idea-355 SLICE-1 dedup: the both-shim-identical pending-task notification
 * payload (was duplicated verbatim in the claude + opencode onPendingTask
 * callbacks). Each shim feeds the returned entry to its own
 * appendNotification(..., { logPath, mirror? }) — the host-specific log sink
 * stays in the shim (the last mile).
 */
export function buildPendingTaskNotification(
  task: Record<string, unknown>,
): NotificationLogEntry {
  return { event: "task_issued", data: task, action: "Pick up with get_task" };
}
