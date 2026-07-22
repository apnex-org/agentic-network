/**
 * @apnex/repo-event-bridge — sovereign repo-event bridge package.
 *
 * Mission-52 T1. EventSource pluggable contract + GH-event translator
 * + create_message sink stub for the OIS agentic network. See
 * README.md for the contract overview and thread-312 design provenance.
 */

export type {
  EventSource,
  EventSourceCapabilities,
  EventSourceHealth,
  RepoEvent,
} from "./event-source.js";

export {
  REPO_EVENT_SUBKINDS,
  translateGhEvent,
  dispatchSubkind,
  normalizeGhEvent,
} from "./translator.js";

export type { RepoEventSubkind } from "./translator.js";

export type {
  MessageSink,
  CreateMessageArgs,
  CreateMessageInvoker,
  CreateMessageSinkOptions,
} from "./sink.js";

export { CreateMessageSink } from "./sink.js";

// ── PollSource (T2) ──────────────────────────────────────────────────

export { CursorStore, CursorStoreConflictError, mergeLru } from "./cursor-store.js";
export type { CursorStoreOptions, RepoCursor } from "./cursor-store.js";

export {
  GhApiClient,
  GhApiAuthError,
  GhApiRateLimitError,
  GhApiTransientError,
  PatScopeError,
  REQUIRED_PAT_SCOPES,
  parseRateLimitResume,
} from "./gh-api-client.js";
export type {
  GhApiClientOptions,
  GhEventEnvelope,
  PollResult,
  WorkflowRun,
  WorkflowRunsResponse,
  IssueEventEnvelope,
  IssueEventsPollResult,
  PullRequestSnapshot,
} from "./gh-api-client.js";

export {
  PollSource,
  GH_PAT_RATE_LIMIT_PER_HOUR,
  DEFAULT_CADENCE_SECONDS,
  DEFAULT_BUDGET_FRACTION,
} from "./poll-source.js";
export type {
  Logger,
  PollSourceOptions,
  PollOutcome,
} from "./poll-source.js";

// idea-255 / M-Workflow-Run-Events-Hub-Integration v1.0 — sibling EventSource
// for /actions/runs. Hub-side composition wires both PollSource + WorkflowRun-
// PollSource into RepoEventBridge per Design §1.1 F8 fold.
export {
  translateWorkflowRun,
  dispatchWorkflowRunSubkind,
  normalizeWorkflowRun,
} from "./workflow-run-translator.js";

export { WorkflowRunPollSource } from "./workflow-run-poll-source.js";
export type { WorkflowRunPollSourceOptions } from "./workflow-run-poll-source.js";

// bug-334: review-request assignment events are absent from /repos/events.
// This persisted sibling source observes /issues/events, enriches exact PR
// head/base, and feeds the existing PullRequestEvent translation/Hub path.
export {
  ReviewRequestPollSource,
  REVIEW_REQUEST_CURSOR_PREFIX,
} from "./review-request-poll-source.js";
export type { ReviewRequestPollSourceOptions } from "./review-request-poll-source.js";
