/**
 * workflow-run handlers — idea-255 / M-Workflow-Run-Events-Hub-Integration
 * Design v1.0 §1.3 + F2 fold.
 *
 * Three handlers register against the new workflow-run-* subkinds the
 * sibling translator emits:
 *   - workflow-run-completed   (status=completed; conclusion split via data)
 *   - workflow-run-dispatched  (event=workflow_dispatch; manual trigger)
 *   - workflow-run-in-progress (status=queued|in_progress; default-filtered)
 *
 * Per F2 fold: handler builds MessageDispatch directly (NOT pr-*-handler
 * shape) — workflow_run is a SYSTEM notification (sourceClass="System-
 * Workflow"); `actor.login` is typically the GitHub Actions service
 * account, not bilateral-routable to engineer/architect role.
 *
 * Per F3 fold: per-conclusion event-name split lets the filter-list predicate
 * key cleanly on (event-name, data.workflow_name, data.conclusion).
 *
 * Per F6 fold: head_sha (commitSha of the workflow run) is propagated into
 * the dispatched payload — composes-with idea-256 build-info for "what code
 * is currently deployed" diagnostics.
 *
 * Notification target is `null` (broadcast) per external-injection convention;
 * adapter-layer routing decides which agents see this; no per-handler
 * role-targeting.
 */

import type { Message } from "../entities/index.js";
import type { IPolicyContext } from "./types.js";
import type { MessageDispatch, RepoEventHandler } from "./repo-event-handlers.js";

interface WorkflowRunInner {
  repo?: unknown;
  runId?: unknown;
  workflowName?: unknown;
  status?: unknown;
  conclusion?: unknown;
  event?: unknown;
  headSha?: unknown;
  headBranch?: unknown;
  htmlUrl?: unknown;
  runStartedAt?: unknown;
  updatedAt?: unknown;
  actor?: unknown;
  runNumber?: unknown;
  runAttempt?: unknown;
}

interface ExtractedFields {
  repo: string | null;
  runId: number | null;
  workflowName: string;
  status: string;
  conclusion: string | null;
  event: string;
  headSha: string;
  headBranch: string | null;
  htmlUrl: string;
  runStartedAt: string | null;
  updatedAt: string | null;
  actor: string | null;
  runNumber: number | null;
  runAttempt: number | null;
}

function extractFields(inner: WorkflowRunInner): ExtractedFields {
  const str = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v : fallback;
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" ? v : null;
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" ? v : null;
  return {
    repo: strOrNull(inner.repo),
    runId: numOrNull(inner.runId),
    workflowName: str(inner.workflowName),
    status: str(inner.status),
    conclusion: strOrNull(inner.conclusion),
    event: str(inner.event),
    headSha: str(inner.headSha),
    headBranch: strOrNull(inner.headBranch),
    htmlUrl: str(inner.htmlUrl),
    runStartedAt: strOrNull(inner.runStartedAt),
    updatedAt: strOrNull(inner.updatedAt),
    actor: strOrNull(inner.actor),
    runNumber: numOrNull(inner.runNumber),
    runAttempt: numOrNull(inner.runAttempt),
  };
}

function readInner(inbound: Message): WorkflowRunInner | null {
  const repoEvent = inbound.payload as { payload?: unknown } | undefined;
  const inner = repoEvent?.payload;
  if (!inner || typeof inner !== "object") return null;
  return inner as WorkflowRunInner;
}

function shortSha(headSha: string): string {
  return headSha.length >= 7 ? headSha.slice(0, 7) : headSha;
}

/**
 * Body template per Design v1.0 §1.3:
 *   "<event> <verb>: \"<workflow-name>\" — head_sha=<short> [+ url on failure]"
 *
 * verb derived from {status, conclusion, event}; sse-peek-line-render layer
 * applies the [System-Workflow] prefix + actionability marker.
 */
function buildBody(f: ExtractedFields): string {
  const sha = shortSha(f.headSha);
  const branch = f.headBranch ? `@${f.headBranch}` : "";

  // workflow_dispatch is dispatched as its own subkind regardless of status —
  // operator triggered it and wants to see ack. Check first so completed-state
  // manual dispatches don't fall through to the success/failure body.
  if (f.event === "workflow_dispatch") {
    const triggeredBy = f.actor ? ` by ${f.actor}` : "";
    return `manual_dispatch fired: "${f.workflowName}"${triggeredBy}`;
  }

  if (f.status === "completed") {
    if (f.conclusion === "success") {
      return `${f.event} succeeded: "${f.workflowName}" — head_sha=${sha}${branch}`;
    }
    if (f.conclusion === "failure") {
      const urlSuffix = f.htmlUrl ? ` — see ${f.htmlUrl}` : "";
      return `${f.event} failed: "${f.workflowName}" — head_sha=${sha}${branch}${urlSuffix}`;
    }
    if (f.conclusion === "cancelled") {
      return `${f.event} cancelled: "${f.workflowName}" — head_sha=${sha}${branch}`;
    }
    if (f.conclusion === "skipped") {
      return `${f.event} skipped: "${f.workflowName}"`;
    }
    return `${f.event} completed (${f.conclusion ?? "unknown"}): "${f.workflowName}" — head_sha=${sha}${branch}`;
  }

  // status=queued|in_progress (in-progress handler path)
  return `${f.status}: "${f.workflowName}" — head_sha=${sha}${branch}`;
}

/**
 * Build the structured payload that sse-peek-line-render's
 * deriveRenderContext consumes (workflow_name + conclusion + event drive
 * the filter-list predicate; head_sha + html_url + run-id surface in the
 * peek-line body / entityRef).
 */
function buildPayload(f: ExtractedFields, inbound: Message, eventName: string): Record<string, unknown> {
  return {
    body: buildBody(f),
    repo: f.repo,
    run_id: f.runId,
    workflow_name: f.workflowName,
    status: f.status,
    conclusion: f.conclusion,
    event: f.event,
    head_sha: f.headSha,
    head_branch: f.headBranch,
    html_url: f.htmlUrl,
    run_started_at: f.runStartedAt,
    updated_at: f.updatedAt,
    actor: f.actor,
    run_number: f.runNumber,
    run_attempt: f.runAttempt,
    sourceMessageId: inbound.id,
    notificationEvent: eventName,
  };
}

async function handle(
  inbound: Message,
  _ctx: IPolicyContext,
  intentValue: string,
  notificationEvent: string,
): Promise<MessageDispatch[]> {
  const inner = readInner(inbound);
  if (!inner) {
    console.warn(
      `[repo-event-workflow-run-handler] inbound message ${inbound.id} missing payload.payload; skipping`,
    );
    return [];
  }
  const fields = extractFields(inner);
  if (!fields.runId) {
    console.warn(
      `[repo-event-workflow-run-handler] inbound message ${inbound.id} missing run_id; skipping`,
    );
    return [];
  }

  return [
    {
      kind: "external-injection",
      target: null,
      delivery: "push-immediate",
      payload: buildPayload(fields, inbound, notificationEvent),
      intent: intentValue,
    },
  ];
}

// work-54 (idea-357 pt-2): a Hub deploy IS a workflow run (deploy-hub.yml), so
// deploy OUTCOMES already flow through the generic completed event above. This
// recognizer additionally emits a first-class deploy event — the clean
// subscription key a gating agent watches without knowing workflow names.
// Roll-CONFIRM (the new revision actually serving) is bug-195's separate rung.
const DEPLOY_WORKFLOW_PATTERN = /deploy/i;

function buildDeployBody(f: ExtractedFields): string {
  const sha = shortSha(f.headSha);
  const branch = f.headBranch ? `@${f.headBranch}` : "";
  const urlSuffix = f.conclusion === "failure" && f.htmlUrl ? ` — see ${f.htmlUrl}` : "";
  return `deploy ${f.conclusion ?? "completed"}: "${f.workflowName}" — head_sha=${sha}${branch}${urlSuffix}`;
}

async function handleCompleted(
  inbound: Message,
  ctx: IPolicyContext,
): Promise<MessageDispatch[]> {
  const dispatches = await handle(
    inbound,
    ctx,
    "workflow-run-completed",
    "workflow-run-completed-notification",
  );
  if (dispatches.length === 0) return dispatches;
  const inner = readInner(inbound);
  const fields = inner ? extractFields(inner) : null;
  if (fields && DEPLOY_WORKFLOW_PATTERN.test(fields.workflowName)) {
    dispatches.push({
      kind: "external-injection",
      target: null,
      delivery: "push-immediate",
      payload: {
        ...buildPayload(fields, inbound, "deploy-completed-notification"),
        body: buildDeployBody(fields),
      },
      intent: "deploy-completed",
    });
  }
  return dispatches;
}

async function handleDispatched(
  inbound: Message,
  ctx: IPolicyContext,
): Promise<MessageDispatch[]> {
  return handle(
    inbound,
    ctx,
    "workflow-run-dispatched",
    "workflow-run-dispatched-notification",
  );
}

async function handleInProgress(
  inbound: Message,
  ctx: IPolicyContext,
): Promise<MessageDispatch[]> {
  return handle(
    inbound,
    ctx,
    "workflow-run-in-progress",
    "workflow-run-in-progress-notification",
  );
}

export const WORKFLOW_RUN_COMPLETED_HANDLER: RepoEventHandler = {
  subkind: "workflow-run-completed",
  name: "workflow_run_completed_system_notification",
  handle: handleCompleted,
};

export const WORKFLOW_RUN_DISPATCHED_HANDLER: RepoEventHandler = {
  subkind: "workflow-run-dispatched",
  name: "workflow_run_dispatched_system_notification",
  handle: handleDispatched,
};

export const WORKFLOW_RUN_IN_PROGRESS_HANDLER: RepoEventHandler = {
  subkind: "workflow-run-in-progress",
  name: "workflow_run_in_progress_system_notification",
  handle: handleInProgress,
};
