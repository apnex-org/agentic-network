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
} from "./kernel/event-router.js";

export {
  classifyEvent,
  parseHubEvent,
  createDedupFilter,
} from "./kernel/event-router.js";

export { loadOrCreateGlobalInstanceId } from "./kernel/instance.js";
export type { LoadInstanceOptions } from "./kernel/instance.js";

export {
  FATAL_CODES,
  parseHandshakeError,
  parseHandshakeResponse,
  buildHandshakePayload,
  performHandshake,
  makeStdioFatalHalt,
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
// `@ois/message-router`, M-Push-Foundation W4). Always qualify
// ("tool-manager" or "Message-router") in new code; avoid bare
// "dispatcher".

export {
  createSharedDispatcher,
  pendingKey,
  injectQueueItemId,
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

// ── Cross-cutting primitives (root) ─────────────────────────────────

export { HubReturnedError, isErrorEnvelope } from "./hub-error.js";

export type { ILogger, LegacyStringLogger, LogField, LogFields } from "./logger.js";

export {
  getActionText,
  buildPromptText,
  buildToastMessage,
} from "./prompt-format.js";
export type { PromptFormatConfig } from "./prompt-format.js";

export { appendNotification } from "./notification-log.js";
export type {
  NotificationLogEntry,
  NotificationLogOptions,
} from "./notification-log.js";

// ── Cognitive layer re-exports (ADR-018) ────────────────────────────
// The `cognitive` option on `McpAgentClient` accepts any
// `@ois/cognitive-layer` `CognitivePipeline`. Re-exporting the
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
} from "@ois/cognitive-layer";
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
} from "@ois/cognitive-layer";
