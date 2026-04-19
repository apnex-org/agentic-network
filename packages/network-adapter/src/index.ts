// ── Session surface (L7) ────────────────────────────────────────────

export { McpAgentClient } from "./mcp-agent-client.js";
export type { McpAgentClientOptions } from "./mcp-agent-client.js";

export type {
  IAgentClient,
  AgentClientConfig,
  AgentClientCallbacks,
  AgentClientMetrics,
  AgentEvent,
  AgentHandshakeConfig,
  SessionState,
  SessionReconnectReason,
} from "./agent-client.js";

// ── Transport surface (L4) ───────────────────────────────────────────

export type {
  ITransport,
  TransportConfig,
  TransportMetrics,
  WireState,
  WireReconnectCause,
  WireEvent,
  WireEventHandler,
} from "./transport.js";

export { McpTransport } from "./mcp-transport.js";

// ── Shared primitives ───────────────────────────────────────────────

export type {
  HubEventType,
  HubEvent,
  EventDisposition,
} from "./event-router.js";

export {
  classifyEvent,
  parseHubEvent,
  createDedupFilter,
} from "./event-router.js";

export type { ILogger, LegacyStringLogger, LogField, LogFields } from "./logger.js";

// ── Handshake + instance identity ───────────────────────────────────

export { loadOrCreateGlobalInstanceId } from "./instance.js";
export type { LoadInstanceOptions } from "./instance.js";

export {
  FATAL_CODES,
  parseHandshakeError,
  parseHandshakeResponse,
  buildHandshakePayload,
  performHandshake,
  makeStdioFatalHalt,
} from "./handshake.js";
export type {
  HandshakeClientMetadata,
  HandshakeAdvisoryTags,
  HandshakePayload,
  HandshakeResponse,
  HandshakeFatalError,
  HandshakeConfig,
  HandshakeContext,
  HandshakeResult,
} from "./handshake.js";

export { performStateSync } from "./state-sync.js";
export type { StateSyncContext, DrainedPendingAction } from "./state-sync.js";

// ── Engineer-side helpers ───────────────────────────────────────────

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
} from "@ois/cognitive-layer";
export type {
  CognitiveMiddleware,
  ToolCallContext,
  ListToolsContext,
  ToolErrorContext,
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
} from "@ois/cognitive-layer";
