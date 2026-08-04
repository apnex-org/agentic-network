/**
 * truthretr0 — createStandardCognitivePipeline.
 *
 * The ONE construction site and the ONE bypass check. Before this, three
 * adapters each called CognitivePipeline.standard() and exactly one of them
 * (claude) read OIS_COGNITIVE_BYPASS — so a fleet-wide bypass silently
 * applied to one seat of three.
 */

import { describe, it, expect } from "vitest";
import {
  createStandardCognitivePipeline,
  CognitivePipeline,
} from "../src/pipeline.js";

describe("createStandardCognitivePipeline — truthretr0", () => {
  it("builds the standard pipeline when the bypass is unset", () => {
    expect(createStandardCognitivePipeline(undefined, {})).toBeInstanceOf(
      CognitivePipeline,
    );
  });

  it("returns undefined when OIS_COGNITIVE_BYPASS=1 (McpAgentClient passthrough contract)", () => {
    expect(
      createStandardCognitivePipeline(undefined, { OIS_COGNITIVE_BYPASS: "1" }),
    ).toBeUndefined();
  });

  it("honours ONLY the exact value '1' — no truthy-coercion surprises", () => {
    for (const v of ["0", "true", "yes", "", undefined]) {
      expect(
        createStandardCognitivePipeline(undefined, { OIS_COGNITIVE_BYPASS: v }),
      ).toBeInstanceOf(CognitivePipeline);
    }
  });

  it("🔴 BYPASS PARITY: the decision is env-only — identical for every caller", () => {
    // The three adapters differ ONLY in their telemetry sink. Feeding three
    // distinct sinks through the same env must yield the same verdict, which
    // is what makes "identical across all three adapters" true by
    // construction rather than by three separate correct implementations.
    const sinks = [
      () => {/* pi */},
      () => {/* opencode */},
      () => {/* claude */},
    ];
    const off = sinks.map((s) => createStandardCognitivePipeline(s, {}));
    const on = sinks.map((s) =>
      createStandardCognitivePipeline(s, { OIS_COGNITIVE_BYPASS: "1" }),
    );
    expect(off.every((p) => p instanceof CognitivePipeline)).toBe(true);
    expect(on.every((p) => p === undefined)).toBe(true);
  });

  it("wires the supplied telemetry sink (adapters supply ONLY this)", async () => {
    const seen: string[] = [];
    const p = createStandardCognitivePipeline((e) => seen.push(e.kind), {});
    await p!.runToolCall(
      { tool: "get_bug", args: {}, sessionId: "s", startedAt: 0, tags: {} },
      async () => ({ ok: true }),
    );
    expect(seen.length).toBeGreaterThan(0);
  });
});
