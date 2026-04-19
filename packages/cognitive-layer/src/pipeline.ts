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
import { CognitiveTelemetry, type CognitiveTelemetryConfig } from "./middlewares/telemetry.js";
import { CircuitBreaker, type CircuitBreakerConfig } from "./middlewares/circuit-breaker.js";
import { WriteCallDedup, type WriteCallDedupConfig } from "./middlewares/write-call-dedup.js";

export interface StandardPipelineConfig {
  /** CognitiveTelemetry options. */
  telemetry?: CognitiveTelemetryConfig;
  /** CircuitBreaker options. */
  circuitBreaker?: CircuitBreakerConfig;
  /** WriteCallDedup options. */
  writeCallDedup?: WriteCallDedupConfig;
  /**
   * Future middlewares will register config fields here as they land:
   * cache, enricher, normalizer.
   */
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
    return pipeline;
  }
}
