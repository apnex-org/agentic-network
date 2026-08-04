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
    // truthretr0/work-639: ResponseSummarizer REMOVED. Director ruling —
    // oversize is a QUERY-LAYER problem (filters, defaults, real pagination,
    // Hub-side); a middleware that silently chops arrays is a DEFECT, not a
    // mitigation. Nothing downstream depended on its position or output shape.
    pipeline.use(new ToolDescriptionEnricher(config.toolDescriptionEnricher ?? {}));
    pipeline.use(new ErrorNormalizer(config.errorNormalizer ?? {}));
    return pipeline;
  }
}

// ── truthretr0 — the ONE construction site ────────────────────────────
/**
 * THE single place the standard pipeline is constructed.
 *
 * Director ruling (truthretr0): the kernel owns the decision; adapters supply
 * ONLY the telemetry sink. Three adapters previously each called
 * `CognitivePipeline.standard()` independently.
 *
 * work-639: OIS_COGNITIVE_BYPASS IS NO LONGER READ HERE, AND THAT IS THE POINT.
 * Its sole documented reason (config/harnesses/claude.json `_envWhy`) was the
 * ResponseSummarizer silently truncating read results. That middleware is now
 * REMOVED, so the stopgap is discharged rather than made fleet-uniform.
 *
 * This matters concretely: the var is `1` in the live environ of all three pi
 * seats, and pi historically did NOT read it. Honouring it fleet-wide would
 * have disabled all seven middlewares — taking WriteCallDedup (the double-write
 * guard) and the cache down as collateral, which that same config comment calls
 * "temporary". Removing the summariser instead means the guard and the cache
 * simply keep running.
 *
 * The env var should now be deleted from the harness config; that is a fleet-
 * config act, not an adapter change, and is deliberately not done here.
 */
export function createStandardCognitivePipeline(
  telemetrySink?: (event: TelemetryEvent) => void,
): CognitivePipeline {
  return CognitivePipeline.standard(
    telemetrySink ? { telemetry: { sink: telemetrySink } } : {},
  );
}
