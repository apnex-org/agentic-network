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
  HUB_PAGING_PARAMS,
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

// ── work-638 — declared paging params are schema-verified, not guessed ──

describe("HUB_PAGING_PARAMS — work-638", () => {
  it("declares ONLY the six schema-verified offset tools", () => {
    expect(Object.keys(HUB_PAGING_PARAMS).sort()).toEqual([
      "get_agents",
      "list_bugs",
      "list_ideas",
      "list_missions",
      "list_threads",
      "list_work",
    ]);
    expect(Object.values(HUB_PAGING_PARAMS).every((v) => v === "offset")).toBe(true);
  });

  it("🔴 WITHHOLDS tools that would produce a wrong or inexpressible hint", () => {
    // list_documents: no paging parameter at all (verifier-measured, work-637)
    expect(HUB_PAGING_PARAMS).not.toHaveProperty("list_documents");
    // get_thread: HAS offset, but it pages `messages` while the summariser
    // truncates whichever array is longest — param and field can disagree.
    expect(HUB_PAGING_PARAMS).not.toHaveProperty("get_thread");
    // list_messages: `since` is a ULID cursor; next_offset is numeric.
    expect(HUB_PAGING_PARAMS).not.toHaveProperty("list_messages");
    // limit-only tools cap, they do not page.
    expect(HUB_PAGING_PARAMS).not.toHaveProperty("list_ready_work");
    expect(HUB_PAGING_PARAMS).not.toHaveProperty("get_metrics");
  });

  it("a declared tool gets a usable hint; a withheld one gets an honest denial", async () => {
    const p = createStandardCognitivePipeline(undefined, {})!;
    const call = async (tool: string, result: unknown) =>
      (await p.runToolCall(
        { tool, args: {}, sessionId: "s", startedAt: 0, tags: {} },
        async () => result,
      )) as { _ois_pagination: { next_offset: number | null; hint: string } };

    const declared = await call("list_bugs", {
      bugs: Array.from({ length: 40 }, (_, i) => ({ id: i })),
    });
    expect(declared._ois_pagination.next_offset).toBe(10);
    expect(declared._ois_pagination.hint).toContain("offset=10");

    const withheld = await call("list_documents", {
      documents: Array.from({ length: 40 }, (_, i) => ({ path: `d${i}` })),
    });
    expect(withheld._ois_pagination.next_offset).toBeNull();
    expect(withheld._ois_pagination.hint).not.toMatch(/offset=\d/);
  });
});
