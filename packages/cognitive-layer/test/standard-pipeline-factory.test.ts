/**
 * truthretr0 / work-639 — createStandardCognitivePipeline.
 *
 * The ONE construction site. The ResponseSummarizer has been REMOVED
 * (Director ruling: oversize is a query-layer problem; silently chopping
 * arrays is a defect, not a mitigation).
 *
 * The load-bearing assertions here prove ABSENCE OF THE SUMMARISER without
 * proving absence of the PIPELINE — "removed one middleware" and "disabled
 * everything" are otherwise indistinguishable from the outside.
 */

import { describe, it, expect } from "vitest";
import {
  createStandardCognitivePipeline,
  CognitivePipeline,
} from "../src/pipeline.js";
import { WriteCallDedup } from "../src/middlewares/write-call-dedup.js";
import { CognitiveTelemetry } from "../src/middlewares/telemetry.js";
import { CircuitBreaker } from "../src/middlewares/circuit-breaker.js";
import { ToolResultCache } from "../src/middlewares/tool-result-cache.js";
import { ToolDescriptionEnricher } from "../src/middlewares/tool-description-enricher.js";
import { ErrorNormalizer } from "../src/middlewares/error-normalizer.js";

const call = async (p: CognitivePipeline, tool: string, result: unknown) =>
  p.runToolCall(
    { tool, args: {}, sessionId: "s", startedAt: 0, tags: {} },
    async () => result,
  );

describe("createStandardCognitivePipeline — work-639", () => {
  it("always builds a pipeline — OIS_COGNITIVE_BYPASS is no longer read", () => {
    expect(createStandardCognitivePipeline()).toBeInstanceOf(CognitivePipeline);
  });

  it("🔴 THE SUMMARISER IS GONE: a 500-item array passes through INTACT", async () => {
    const p = createStandardCognitivePipeline();
    const big = { items: Array.from({ length: 500 }, (_, i) => i) };
    const out = (await call(p, "list_work", big)) as Record<string, unknown>;
    // Pre-removal this returned 10 items wrapped in an _ois_pagination envelope.
    expect((out.items as unknown[]).length).toBe(500);
    expect(out._ois_pagination).toBeUndefined();
  });

  it("🔴 THE REST OF THE PIPELINE SURVIVED — six middlewares, summariser absent", () => {
    const mws = createStandardCognitivePipeline().getMiddlewares();
    expect(mws).toHaveLength(6);
    // Named, so a silent drop of any survivor reddens here rather than passing
    // as "the summariser is gone".
    for (const C of [
      CognitiveTelemetry,
      CircuitBreaker,
      WriteCallDedup,
      ToolResultCache,
      ToolDescriptionEnricher,
      ErrorNormalizer,
    ]) {
      expect(mws.some((m) => m instanceof C), C.name).toBe(true);
    }
    expect(
      mws.some((m) => m.constructor.name === "ResponseSummarizer"),
    ).toBe(false);
  });

  it("🔴 WriteCallDedup DEMONSTRABLY EXECUTES — absence of the summariser is not absence of the pipeline", async () => {
    const p = createStandardCognitivePipeline();
    let hits = 0;
    const ctx = () => ({
      tool: "create_bug",
      args: { title: "x" },
      sessionId: "s",
      startedAt: 0,
      tags: {} as Record<string, string>,
    });
    await p.runToolCall(ctx(), async () => { hits++; return { id: "bug-1" }; });
    await p.runToolCall(ctx(), async () => { hits++; return { id: "bug-2" }; });
    // The double-write guard collapses the identical second write.
    expect(hits).toBe(1);
  });

  it("wires the supplied telemetry sink (adapters supply ONLY this)", async () => {
    const seen: string[] = [];
    const p = createStandardCognitivePipeline((e) => seen.push(e.kind));
    await call(p, "get_bug", { ok: true });
    expect(seen.length).toBeGreaterThan(0);
  });
});
