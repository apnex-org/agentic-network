/**
 * @ois/cognitive-layer — sovereign cognitive-middleware layer for the
 * OIS agentic network. Chain-of-responsibility augments that intercept
 * the tool-call boundary of every agent, providing transparent
 * caching, dedup, telemetry, description enrichment, and error
 * normalization.
 *
 * Design and ratification: see ADR-018 + thread-158.
 *
 * Consumer integration: opt-in `cognitive` config on
 * `@ois/network-adapter`'s `McpAgentClient`. Factory-composed pipeline
 * recommended via `CognitivePipeline.standard({ ... })`.
 */

export type {
  CognitiveMiddleware,
  ToolCallContext,
  ListToolsContext,
  ToolErrorContext,
  Tool,
  ToolCallTerminal,
  ListToolsTerminal,
  ToolErrorTerminal,
} from "./contract.js";

export { CognitivePipeline } from "./pipeline.js";
export type { StandardPipelineConfig } from "./pipeline.js";

export { CognitiveTelemetry } from "./middlewares/telemetry.js";
export type {
  CognitiveTelemetryConfig,
  TelemetryEvent,
  TelemetryEventKind,
} from "./middlewares/telemetry.js";

export { CircuitBreaker, HubUnavailableError } from "./middlewares/circuit-breaker.js";
export type {
  CircuitBreakerConfig,
  CircuitState,
  CircuitStateChange,
} from "./middlewares/circuit-breaker.js";

export { WriteCallDedup, DedupTimeoutError } from "./middlewares/write-call-dedup.js";
export type { WriteCallDedupConfig } from "./middlewares/write-call-dedup.js";
