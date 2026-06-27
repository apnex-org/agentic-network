// ── Layer 1a: Wire (transport / wire FSM) ──────────────────────────

export type {
  ITransport,
  TransportConfig,
  TransportMetrics,
  WireState,
  WireReconnectCause,
  WireEvent,
  WireEventHandler,
} from "./wire/transport.js";

export { McpTransport } from "./wire/mcp-transport.js";

// ── Layer 1b: Kernel (handshake / session FSM / agent client) ──────

export { McpAgentClient } from "./kernel/mcp-agent-client.js";
export type { McpAgentClientOptions } from "./kernel/mcp-agent-client.js";

export type {
  IAgentClient,
  AgentClientConfig,
  AgentClientCallbacks,
  AgentClientMetrics,
  AgentEvent,
  AgentHandshakeConfig,
  SessionState,
  SessionReconnectReason,
} from "./kernel/agent-client.js";

export type {
  HubEventType,
  HubEvent,
  EventDisposition,
  DrainedActionReconstruction,
} from "./kernel/event-router.js";

export {
  classifyEvent,
  parseHubEvent,
  createDedupFilter,
  isPulseEvent,
  PULSE_KINDS,
  reconstructDrainedAction,
} from "./kernel/event-router.js";

// idea-251 D-prime Phase 2: instance.ts deleted. Identity now flows from
// OIS_AGENT_NAME env → handshake.name → Hub-side fingerprint(name).
// Operators set OIS_AGENT_NAME in ~/.config/apnex-agents/{name}.env.

export {
  FATAL_CODES,
  parseHandshakeError,
  parseHandshakeResponse,
  buildHandshakePayload,
  performHandshake,
  makeStdioFatalHalt,
  readRequiredAgentName,
} from "./kernel/handshake.js";
export type {
  HandshakeClientMetadata,
  HandshakeAdvisoryTags,
  HandshakePayload,
  HandshakeResponse,
  HandshakeFatalError,
  HandshakeConfig,
  HandshakeContext,
  HandshakeResult,
} from "./kernel/handshake.js";

export { performStateSync } from "./kernel/state-sync.js";
export type { StateSyncContext, DrainedPendingAction } from "./kernel/state-sync.js";

export {
  PollBackstop,
  defaultCursorFile,
  readCursor,
  writeCursor,
} from "./kernel/poll-backstop.js";
export type { PollBackstopOptions } from "./kernel/poll-backstop.js";

export {
  isEagerWarmupEnabled,
  parseClaimSessionResponse,
  formatSessionClaimedLogLine,
} from "./kernel/session-claim.js";
export type { ClaimSessionParsed } from "./kernel/session-claim.js";

// ── Layer 1c: tool-manager (Initialize/ListTools/CallTool factory) ──
//
// The MCP protocol tool-manager per Design v1.2 §4 naming discipline
// (Director-ratified rename from "MCP-boundary dispatcher" 2026-04-26).
// Distinct from the future Message-router (sovereign-package #6,
// `@apnex/message-router`, M-Push-Foundation W4). Always qualify
// ("tool-manager" or "Message-router") in new code; avoid bare
// "dispatcher".

export {
  createSharedDispatcher,
  pendingKey,
  injectQueueItemId,
  assertHostWiringComplete,
} from "./tool-manager/dispatcher.js";
export type {
  DispatcherClientInfo,
  DispatcherNotificationHooks,
  SharedDispatcherOptions,
  SharedDispatcher,
} from "./tool-manager/dispatcher.js";

export {
  CATALOG_SCHEMA_VERSION,
  cachePathFor,
  readCache,
  writeCache,
  isCacheValid,
} from "./tool-manager/tool-catalog-cache.js";
export type {
  ToolCatalog,
  CachedCatalog,
} from "./tool-manager/tool-catalog-cache.js";

export { ToolSurfaceReconciler } from "./tool-manager/tool-surface-reconciler.js";
export type {
  ToolSurfaceReconcilerDeps,
  ReconcileOutcome,
} from "./tool-manager/tool-surface-reconciler.js";

// idea-353 — queue wake/stall reconciliation primitives.
export { ClaimableDigestTracker } from "./tool-manager/claimable-digest-tracker.js";
export type {
  ClaimableDigestInput,
  ClaimableDigestDecision,
} from "./tool-manager/claimable-digest-tracker.js";
export { WorkLeaseTracker } from "./tool-manager/work-lease-tracker.js";
export type { StallPrompt } from "./tool-manager/work-lease-tracker.js";

// ── Cross-cutting primitives (root) ─────────────────────────────────

export { HubReturnedError, isErrorEnvelope } from "./hub-error.js";

export type { ILogger, LegacyStringLogger, LogField, LogFields } from "./logger.js";

export {
  getActionText,
  buildPromptText,
  buildToastMessage,
} from "./prompt-format.js";
export type { PromptFormatConfig } from "./prompt-format.js";

export { appendNotification, buildPendingTaskNotification } from "./notification-log.js";
export type {
  NotificationLogEntry,
  NotificationLogOptions,
} from "./notification-log.js";

// ── Cognitive layer re-exports (ADR-018) ────────────────────────────
// The `cognitive` option on `McpAgentClient` accepts any
// `@apnex/cognitive-layer` `CognitivePipeline`. Re-exporting the
// essentials keeps downstream consumers from needing a separate
// dependency declaration for the standard-pipeline pattern.

export {
  CognitivePipeline,
  CognitiveTelemetry,
  CircuitBreaker,
  HubUnavailableError,
  WriteCallDedup,
  DedupTimeoutError,
  ToolResultCache,
  FlushAllOnWriteStrategy,
  ToolDescriptionEnricher,
  ErrorNormalizer,
  NormalizedError,
  ResponseSummarizer,
  summarizeResult,
  buildPaginationHint,
} from "@apnex/cognitive-layer";
export type {
  CognitiveMiddleware,
  ToolCallContext,
  ListToolsContext,
  ToolErrorContext,
  Tool as CognitiveTool,
  StandardPipelineConfig,
  CognitiveTelemetryConfig,
  TelemetryEvent,
  TelemetryEventKind,
  CircuitBreakerConfig,
  CircuitState,
  CircuitStateChange,
  WriteCallDedupConfig,
  ToolResultCacheConfig,
  InvalidationStrategy,
  InvalidationDirective,
  CacheKey,
  ToolDescriptionEnricherConfig,
  ToolHints,
  ErrorNormalizerConfig,
  ErrorRule,
  CascadeDriftRule,
  ResponseSummarizerConfig,
} from "@apnex/cognitive-layer";
