/**
 * ToolDescriptionEnricher unit tests.
 *
 * Pins: closed hint vocabulary (INV-COG-9); onListTools-only
 * interception; inferHints defaults for read/write verbs;
 * hintMap-over-inferred precedence; `enabled: false` kill switch;
 * custom formatter / infer overrides.
 */

import { describe, it, expect, vi } from "vitest";
import {
  ToolDescriptionEnricher,
  type ToolHints,
} from "../src/middlewares/tool-description-enricher.js";
import type { ListToolsContext, Tool } from "../src/contract.js";

function listCtx(): ListToolsContext {
  return { sessionId: "sess-A", startedAt: 0, tags: {} };
}

// ── Default inference (read/write verbs) ─────────────────────────────

describe("ToolDescriptionEnricher — default inference", () => {
  it("get_* tools get [C30s][ID][PAR]", async () => {
    const enricher = new ToolDescriptionEnricher();
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "get_thread", description: "Read a thread" },
    ]);
    expect(result[0].description).toBe("Read a thread [C30s][ID][PAR]");
  });

  it("list_* tools get [C30s][ID][PAR]", async () => {
    const enricher = new ToolDescriptionEnricher();
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "list_ideas", description: "List ideas" },
    ]);
    expect(result[0].description).toBe("List ideas [C30s][ID][PAR]");
  });

  it("write-verb prefixes get [W]", async () => {
    const enricher = new ToolDescriptionEnricher();
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "create_thread", description: "Open a thread" },
      { name: "update_idea", description: "Edit idea" },
      { name: "close_thread", description: "Close" },
      { name: "register_role", description: "Register" },
    ]);
    expect(result[0].description).toBe("Open a thread [W]");
    expect(result[1].description).toBe("Edit idea [W]");
    expect(result[2].description).toBe("Close [W]");
    expect(result[3].description).toBe("Register [W]");
  });

  it("unrecognized tools pass through unchanged", async () => {
    const enricher = new ToolDescriptionEnricher();
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "quantum_entangle", description: "Unknown verb" },
    ]);
    expect(result[0].description).toBe("Unknown verb");
  });

  it("tools without description get hints appended to empty description", async () => {
    const enricher = new ToolDescriptionEnricher();
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "get_thread" }, // no description
    ]);
    expect(result[0].description).toBe(" [C30s][ID][PAR]");
  });
});

// ── hintMap overrides inferred ─────────────────────────────────────

describe("ToolDescriptionEnricher — explicit hintMap", () => {
  it("hintMap entry overrides default inference", async () => {
    const enricher = new ToolDescriptionEnricher({
      hintMap: {
        get_thread: { cachedMs: 10_000, idempotent: true }, // custom: no PAR
      },
    });
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "get_thread", description: "Read" },
    ]);
    expect(result[0].description).toBe("Read [C10s][ID]");
  });

  it("hintMap can add CircuitBreaker tag on any tool", async () => {
    const enricher = new ToolDescriptionEnricher({
      hintMap: {
        create_thread: { write: true, circuitBreaker: true },
      },
    });
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "create_thread", description: "Open" },
    ]);
    expect(result[0].description).toBe("Open [W][CB]");
  });

  it("empty hints (all falsy) produce no suffix", async () => {
    const enricher = new ToolDescriptionEnricher({
      hintMap: {
        get_thread: {}, // all fields falsy/undefined
      },
    });
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "get_thread", description: "Read" },
    ]);
    // Empty hints → no suffix appended
    expect(result[0].description).toBe("Read");
  });
});

// ── Full hint vocabulary — all 5 tokens ─────────────────────────────

describe("ToolDescriptionEnricher — hint vocabulary (INV-COG-9)", () => {
  it("emits all 5 tokens in canonical order", async () => {
    const enricher = new ToolDescriptionEnricher({
      hintMap: {
        frankentool: {
          cachedMs: 60_000,
          idempotent: true,
          parallel: true,
          write: true,
          circuitBreaker: true,
        },
      },
    });
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "frankentool", description: "Every hint" },
    ]);
    expect(result[0].description).toBe("Every hint [C60s][ID][PAR][W][CB]");
  });

  it("cachedMs rounds to nearest second, minimum 1s", async () => {
    const enricher = new ToolDescriptionEnricher({
      hintMap: {
        fast: { cachedMs: 500 }, // 0.5s → 1s
        mid: { cachedMs: 1499 }, // 1.499s → 1s
        big: { cachedMs: 45_000 },
      },
    });
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "fast", description: "" },
      { name: "mid", description: "" },
      { name: "big", description: "" },
    ]);
    expect(result[0].description).toBe(" [C1s]");
    expect(result[1].description).toBe(" [C1s]");
    expect(result[2].description).toBe(" [C45s]");
  });

  it("cachedMs=0 is not emitted", async () => {
    const enricher = new ToolDescriptionEnricher({
      hintMap: { zero: { cachedMs: 0, idempotent: true } },
    });
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "zero", description: "Zero" },
    ]);
    expect(result[0].description).toBe("Zero [ID]");
  });
});

// ── enabled: false kill switch ──────────────────────────────────────

describe("ToolDescriptionEnricher — enabled flag", () => {
  it("enabled=false passes through unchanged", async () => {
    const enricher = new ToolDescriptionEnricher({ enabled: false });
    const tools: Tool[] = [{ name: "get_thread", description: "Read" }];
    const result = await enricher.onListTools(listCtx(), async () => tools);
    expect(result).toBe(tools); // reference-equal
    expect(result[0].description).toBe("Read");
  });
});

// ── Custom formatter + inferHints ───────────────────────────────────

describe("ToolDescriptionEnricher — customization", () => {
  it("custom inferHints predicate overrides default", async () => {
    const enricher = new ToolDescriptionEnricher({
      inferHints: (name) =>
        name === "special" ? { idempotent: true } : null,
    });
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "get_thread", description: "A" }, // default NO longer applies
      { name: "special", description: "B" },
    ]);
    expect(result[0].description).toBe("A");
    expect(result[1].description).toBe("B [ID]");
  });

  it("custom formatHints controls suffix format", async () => {
    const enricher = new ToolDescriptionEnricher({
      formatHints: (h: ToolHints) => {
        const parts: string[] = [];
        if (h.idempotent) parts.push("idem");
        return parts.length > 0 ? ` <${parts.join(",")}>` : "";
      },
    });
    const result = await enricher.onListTools(listCtx(), async () => [
      { name: "get_thread", description: "A" },
    ]);
    expect(result[0].description).toBe("A <idem>");
  });
});

// ── Passive on onToolCall (not defined) ─────────────────────────────

describe("ToolDescriptionEnricher — onToolCall is absent", () => {
  it("does not implement onToolCall — pipeline skips it for tool calls", () => {
    const enricher = new ToolDescriptionEnricher();
    expect(enricher.onToolCall).toBeUndefined();
  });

  it("does not implement onToolError", () => {
    const enricher = new ToolDescriptionEnricher();
    expect(enricher.onToolError).toBeUndefined();
  });
});

// ── Preserves tool fields other than description ────────────────────

describe("ToolDescriptionEnricher — preserves tool shape", () => {
  it("keeps name, inputSchema, and extra fields", async () => {
    const enricher = new ToolDescriptionEnricher();
    const result = await enricher.onListTools(listCtx(), async () => [
      {
        name: "get_thread",
        description: "Read",
        inputSchema: { type: "object", required: ["threadId"] },
        customField: "keep-me",
      },
    ]);
    expect(result[0].name).toBe("get_thread");
    expect(result[0].inputSchema).toEqual({ type: "object", required: ["threadId"] });
    expect(result[0].customField).toBe("keep-me");
    expect(result[0].description).toBe("Read [C30s][ID][PAR]");
  });
});

// ── .standard() integration ─────────────────────────────────────────

describe("ToolDescriptionEnricher — .standard() integration", () => {
  it(".standard() composes ToolDescriptionEnricher at position 4", async () => {
    const { CognitivePipeline } = await import("../src/pipeline.js");
    const p = CognitivePipeline.standard();
    const names = p.getMiddlewares().map((m) => m.name);
    expect(names.indexOf("ToolDescriptionEnricher")).toBe(4);
  });

  it(".standard() pipeline list-tools flow actually enriches", async () => {
    const { CognitivePipeline } = await import("../src/pipeline.js");
    const p = CognitivePipeline.standard();
    const result = await p.runListTools(listCtx(), async () => [
      { name: "get_thread", description: "Read" },
    ]);
    expect(result[0].description).toContain("[C30s]");
  });
});
