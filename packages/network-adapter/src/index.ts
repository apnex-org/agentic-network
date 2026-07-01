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
  AgentHandshakeConfig,
} from "./kernel/agent-client.js";

// bug-160 — the Message-union payload contract (AgentEvent / SessionState /
// SessionReconnectReason / DrainedPendingAction) was relocated DOWN to
// @apnex/message-router to break the L2↔L4 source cycle; re-exported here so
// consumers importing them from @apnex/network-adapter are unaffected.
export type {
  AgentEvent,
  SessionState,
  SessionReconnectReason,
  DrainedPendingAction,
} from "@apnex/message-router";

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

export { parseLabels, loadConfig } from "./kernel/adapter-config.js";
export type { HubConfig, LoadConfigOptions } from "./kernel/adapter-config.js";

export {
  readPackageVersion,
  readBuildInfo,
  UNKNOWN_BUILD_INFO,
} from "./kernel/build-identity.js";
export type { BuildInfo } from "./kernel/build-identity.js";

export {
  REDACT_KEYS,
  redactFields,
  LOG_LEVELS,
  parseLogLevel,
  shouldEmitLevel,
} from "./observability.js";
export type { LogLevel } from "./observability.js";

export { createFileLogger } from "./file-logger.js";
export type { FileLogger, FileLoggerOptions } from "./file-logger.js";

export { performStateSync } from "./kernel/state-sync.js";
export type { StateSyncContext } from "./kernel/state-sync.js";

export {
  PollBackstop,
  defaultCursorFile,
  resolveRole,
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

// ── L1.5 liveness watchdog + the kernel->supervisor exit-propagation seam
//    (M-Adapter-Modernization P1c, Design §4). The watchdog detects the
//    keepalives-flowing-but-session-dead wedge via a proactive session probe;
//    on a bounded failure budget it emits the wedged-restart sentinel (the
//    signal P1e's PID-1 supervisor consumes) and the shim self-exits.
export { LivenessWatchdog } from "./kernel/liveness-watchdog.js";
export type { LivenessWatchdogOptions } from "./kernel/liveness-watchdog.js";
export {
  emitLivenessLostSignal,
  resolveSentinelPath,
  WEDGED_RESTART_EXIT_CODE,
  DEFAULT_LIVENESS_SENTINEL,
} from "./kernel/liveness-signal.js";
export type { LivenessLostSignalPayload } from "./kernel/liveness-signal.js";

// ── Harness manifest (M-Adapter-Modernization P1b) — the per-harness STANDARD
//    config as a schema-validated, VERSIONED artifact. The claude shim is the
//    first conformant instance; opencode/Phase-2 slot in as a second manifest
//    against this SAME schema (not a parallel hand-rolled shape). Per-agent
//    INSTANCE values stay in ENV — the manifest carries only env var NAMES.
export {
  parseHarnessManifest,
  loadHarnessManifest,
  serverCapabilitiesFromManifest,
} from "./kernel/harness-manifest.js";
export type { HarnessManifest, HarnessCapability } from "./kernel/harness-manifest.js";

// ── Layer 1c: tool-manager (Initialize/ListTools/CallTool factory) ──
//
// The MCP protocol tool-manager per Design v1.2 §4 naming discipline
// (Director-ratified rename from "MCP-boundary dispatcher" 2026-04-26).
// Distinct from the future Message-router (sovereign-package #6,
// `@apnex/message-router`, M-Push-Foundation W4). Always qualify
// ("tool-manager" or "Message-router") in new code; avoid bare
// "dispatcher".

// M-Tool-Manager-Internal-Sovereign-Module Slice A: the agnostic tool-manager
// contract surface. Additive — the dispatch authority (Slice B) + bindings
// depend on these interfaces, never on the concrete kernel classes.
export type {
  ToolDescriptor,
  ToolDispatchCallOptions,
  ToolDispatchResult,
  IToolDispatchAgent,
  IToolManager,
} from "./tool-manager/contracts.js";

// Slice C: dispatcher is the orchestrator (binding assembly); dispatch authority
// + OIS policy live under dispatch/; cache/reconcile/health under catalog/.
export {
  createSharedDispatcher,
  pendingKey,
  injectQueueItemId,
  assertHostWiringComplete,
} from "./tool-manager/orchestrator/dispatcher.js";
export type {
  DispatcherClientInfo,
  DispatcherNotificationHooks,
  SharedDispatcherOptions,
  SharedDispatcher,
} from "./tool-manager/orchestrator/dispatcher.js";

export {
  CATALOG_SCHEMA_VERSION,
  cachePathFor,
  readCache,
  writeCache,
  isCacheValid,
} from "./tool-manager/catalog/tool-catalog-cache.js";
export type {
  ToolCatalog,
  CachedCatalog,
} from "./tool-manager/catalog/tool-catalog-cache.js";

export { ToolSurfaceReconciler } from "./tool-manager/catalog/tool-surface-reconciler.js";
export type {
  ToolSurfaceReconcilerDeps,
  ReconcileOutcome,
} from "./tool-manager/catalog/tool-surface-reconciler.js";

// idea-355 SLICE-1T — the Hub /health toolSurfaceRevision fetcher, hoisted from
// the shims so both share ONE network mechanism (pure; the cache side-effect
// stays shim-side).
export { makeFetchLiveToolSurfaceRevision } from "./tool-manager/catalog/health-revision.js";
export type { FetchLiveToolSurfaceRevisionOptions } from "./tool-manager/catalog/health-revision.js";

// idea-353 — queue wake/stall reconciliation primitives.
export { ClaimableDigestTracker } from "./tool-manager/work-protocol/claimable-digest-tracker.js";
export type {
  ClaimableDigestInput,
  ClaimableDigestDecision,
} from "./tool-manager/work-protocol/claimable-digest-tracker.js";
export { WorkLeaseTracker } from "./tool-manager/work-protocol/work-lease-tracker.js";
export type { StallPrompt } from "./tool-manager/work-protocol/work-lease-tracker.js";

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
