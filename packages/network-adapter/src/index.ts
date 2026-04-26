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

// ── Layer 1b: Session (handshake / session FSM / agent client) ─────

export { McpAgentClient } from "./session/mcp-agent-client.js";
export type { McpAgentClientOptions } from "./session/mcp-agent-client.js";

export type {
  IAgentClient,
  AgentClientConfig,
  AgentClientCallbacks,
  AgentClientMetrics,
  AgentEvent,
  AgentHandshakeConfig,
  SessionState,
  SessionReconnectReason,
} from "./session/agent-client.js";

export type {
  HubEventType,
  HubEvent,
  EventDisposition,
} from "./session/event-router.js";

export {
  classifyEvent,
  parseHubEvent,
  createDedupFilter,
} from "./session/event-router.js";

export { loadOrCreateGlobalInstanceId } from "./session/instance.js";
export type { LoadInstanceOptions } from "./session/instance.js";

export {
  FATAL_CODES,
  parseHandshakeError,
  parseHandshakeResponse,
  buildHandshakePayload,
  performHandshake,
  makeStdioFatalHalt,
} from "./session/handshake.js";
export type {
  HandshakeClientMetadata,
  HandshakeAdvisoryTags,
  HandshakePayload,
  HandshakeResponse,
  HandshakeFatalError,
  HandshakeConfig,
  HandshakeContext,
  HandshakeResult,
} from "./session/handshake.js";

export { performStateSync } from "./session/state-sync.js";
export type { StateSyncContext, DrainedPendingAction } from "./session/state-sync.js";

export {
  isEagerWarmupEnabled,
  parseClaimSessionResponse,
  formatSessionClaimedLogLine,
} from "./session/session-claim.js";
export type { ClaimSessionParsed } from "./session/session-claim.js";

// ── Layer 1c: MCP-boundary (Initialize/ListTools/CallTool factory) ──
//
// The "MCP-boundary dispatcher" per Design v1.2 §4 naming discipline.
// Distinct from the future Message-router (sovereign-package #6,
// `@ois/message-router`, M-Push-Foundation W4). Always qualify
// ("MCP-boundary dispatcher" or "Message-router") in new code; avoid
// bare "dispatcher".

export {
  createSharedDispatcher,
  pendingKey,
  injectQueueItemId,
} from "./mcp-boundary/dispatcher.js";
export type {
  DispatcherClientInfo,
  DispatcherNotificationHooks,
  SharedDispatcherOptions,
  SharedDispatcher,
} from "./mcp-boundary/dispatcher.js";

export {
  CATALOG_SCHEMA_VERSION,
  cachePathFor,
  readCache,
  writeCache,
  isCacheValid,
} from "./mcp-boundary/tool-catalog-cache.js";
export type {
  ToolCatalog,
  CachedCatalog,
} from "./mcp-boundary/tool-catalog-cache.js";

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
