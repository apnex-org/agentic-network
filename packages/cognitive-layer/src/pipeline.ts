/**
 * CognitivePipeline (ADR-018).
 *
 * Composes `CognitiveMiddleware` instances into a chain-of-responsibility
 * pipeline with three phases (tool call, list tools, tool error). The
 * `.standard()` factory returns the canonical ordering ratified in
 * thread-158 / ADR-018; ad-hoc `.use()` composition remains available
 * for tests and custom pipelines.
 */

import type {
  CognitiveMiddleware,
  ToolCallContext,
  ToolCallTerminal,
  ListToolsContext,
  ListToolsTerminal,
  Tool,
  ToolErrorContext,
  ToolErrorTerminal,
} from "./contract.js";
import {
  CognitiveTelemetry,
  type CognitiveTelemetryConfig,
  type TelemetryEvent,
} from "./middlewares/telemetry.js";
import { CircuitBreaker, type CircuitBreakerConfig } from "./middlewares/circuit-breaker.js";
import { WriteCallDedup, type WriteCallDedupConfig } from "./middlewares/write-call-dedup.js";
import { ToolResultCache, type ToolResultCacheConfig } from "./middlewares/tool-result-cache.js";
import {
  ToolDescriptionEnricher,
  type ToolDescriptionEnricherConfig,
} from "./middlewares/tool-description-enricher.js";
import {
  ErrorNormalizer,
  type ErrorNormalizerConfig,
} from "./middlewares/error-normalizer.js";
import {
  ResponseSummarizer,
  type ResponseSummarizerConfig,
} from "./middlewares/response-summarizer.js";

export interface StandardPipelineConfig {
  /** CognitiveTelemetry options. */
  telemetry?: CognitiveTelemetryConfig;
  /** CircuitBreaker options. */
  circuitBreaker?: CircuitBreakerConfig;
  /** WriteCallDedup options. */
  writeCallDedup?: WriteCallDedupConfig;
  /** ToolResultCache options. */
  toolResultCache?: ToolResultCacheConfig;
  /** ToolDescriptionEnricher options. */
  toolDescriptionEnricher?: ToolDescriptionEnricherConfig;
  /** ErrorNormalizer options. */
  errorNormalizer?: ErrorNormalizerConfig;
  /** ResponseSummarizer options (Phase 2a). */
  responseSummarizer?: ResponseSummarizerConfig;
}

export class CognitivePipeline {
  private readonly middlewares: CognitiveMiddleware[] = [];

  /**
   * Append a middleware to the pipeline. Insertion order determines
   * outer-to-inner layering (`INV-COG-1`).
   */
  use(mw: CognitiveMiddleware): this {
    this.middlewares.push(mw);
    return this;
  }

  /**
   * Return the registered middlewares in insertion order. Exposed
   * for diagnostics + test introspection.
   */
  getMiddlewares(): readonly CognitiveMiddleware[] {
    return this.middlewares;
  }

  /**
   * Run the tool-call chain. Each middleware wraps the next;
   * short-circuit by not calling `next()`.
   */
  async runToolCall(ctx: ToolCallContext, terminal: ToolCallTerminal): Promise<unknown> {
    let handler: (c: ToolCallContext) => Promise<unknown> = terminal;
    // Wrap from innermost to outermost so the first-registered middleware ends up outermost.
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      if (!mw.onToolCall) continue;
      const downstream = handler;
      handler = (c) => mw.onToolCall!(c, downstream);
    }
    return handler(ctx);
  }

  async runListTools(ctx: ListToolsContext, terminal: ListToolsTerminal): Promise<Tool[]> {
    let handler: (c: ListToolsContext) => Promise<Tool[]> = terminal;
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      if (!mw.onListTools) continue;
      const downstream = handler;
      handler = (c) => mw.onListTools!(c, downstream);
    }
    return handler(ctx);
  }

  async runToolError(ctx: ToolErrorContext, terminal: ToolErrorTerminal): Promise<unknown> {
    let handler: (c: ToolErrorContext) => Promise<unknown> = terminal;
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i];
      if (!mw.onToolError) continue;
      const downstream = handler;
      handler = (c) => mw.onToolError!(c, downstream);
    }
    return handler(ctx);
  }

  /**
   * Canonical production pipeline. Ordering ratified in thread-158:
   *
   *   1. CognitiveTelemetry      (outermost — sees every call)
   *   2. CircuitBreaker          (Phase 1 checkpoint-2)
   *   3. WriteCallDedup          (Phase 1 checkpoint-3)
   *   4. ToolResultCache         (Phase 1 checkpoint-4)
   *   5. ToolDescriptionEnricher (Phase 1 checkpoint-5)
   *   6. ErrorNormalizer         (Phase 1 checkpoint-6, innermost)
   *
   * Each subsequent checkpoint extends this factory with its middleware
   * at the ratified position. Current scope (task-287): CognitiveTelemetry
   * only.
   */
  static standard(config: StandardPipelineConfig = {}): CognitivePipeline {
    const pipeline = new CognitivePipeline();
    pipeline.use(new CognitiveTelemetry(config.telemetry ?? {}));
    pipeline.use(new CircuitBreaker(config.circuitBreaker ?? {}));
    pipeline.use(new WriteCallDedup(config.writeCallDedup ?? {}));
    pipeline.use(new ToolResultCache(config.toolResultCache ?? {}));
    // ResponseSummarizer (Phase 2a) sits AFTER cache so cached results
    // are already summarized — cache-hits deliver the trimmed payload
    // without re-running the summarization step.
    pipeline.use(new ResponseSummarizer(config.responseSummarizer ?? {}));
    pipeline.use(new ToolDescriptionEnricher(config.toolDescriptionEnricher ?? {}));
    pipeline.use(new ErrorNormalizer(config.errorNormalizer ?? {}));
    return pipeline;
  }
}

// ── truthretr0 — the ONE construction site ────────────────────────────
/**
 * THE single place the standard pipeline is constructed, and THE single
 * place `OIS_COGNITIVE_BYPASS` is honoured.
 *
 * Director ruling (truthretr0): *"delete the duplicated `.standard()`
 * construction from all three shims; the kernel owns the decision and the
 * bypass; adapters supply ONLY the telemetry sink."*
 *
 * BEFORE: three adapters each called `CognitivePipeline.standard({...})`
 * independently, and exactly ONE of them (claude) read the bypass env var.
 * An operator setting `OIS_COGNITIVE_BYPASS=1` fleet-wide got a bypassed
 * claude seat and two silently-unaffected seats — a divergence that reads
 * as a code difference between adapters rather than as an ignored flag.
 *
 * AFTER: all three call this. The bypass is honoured identically because
 * there is only one implementation of it. Adapters cannot diverge on the
 * middleware set or the bypass without deleting this call.
 *
 * Returns `undefined` when bypassed — the McpAgentClient contract for
 * "no cognitive pipeline, legacy passthrough".
 *
 * `env` is injectable so the bypass can be tested without mutating
 * process-global state.
 */
export function createStandardCognitivePipeline(
  telemetrySink?: (event: TelemetryEvent) => void,
  env: Record<string, string | undefined> = process.env,
): CognitivePipeline | undefined {
  if (env.OIS_COGNITIVE_BYPASS === "1") return undefined;
  return CognitivePipeline.standard(
    telemetrySink ? { telemetry: { sink: telemetrySink } } : {},
  );
}
