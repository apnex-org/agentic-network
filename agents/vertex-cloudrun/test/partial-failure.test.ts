/**
 * Partial-failure envelope tests (M-Cognitive-Hypervisor Phase 2a).
 *
 * Pins architect-ratified positional-preservation shape (thread-160
 * round 2): each element of a parallel tool_outputs array is
 * `{ status, data|error }` so Gemini's 1:1 attribution survives
 * partial-failure batches.
 */

import { describe, it, expect } from "vitest";
import { buildPartialFailureElement } from "../src/llm.js";

describe("buildPartialFailureElement — architect-ratified contract (thread-160)", () => {
  it("success → { status: 'success', data: <raw result> }", () => {
    const result = { ideas: [1, 2, 3], total: 3 };
    const element = buildPartialFailureElement({ ok: true, result });
    expect(element).toEqual({ status: "success", data: result });
  });

  it("preserves exact raw result shape in data — no wrapping", () => {
    const result = { arbitrary: "shape", nested: { deep: [1, 2] } };
    const element = buildPartialFailureElement({ ok: true, result });
    expect((element.data as typeof result)).toBe(result);
  });

  it("error (Error instance) → { status: 'error', error: { message } }", () => {
    const err = new Error("Hub unavailable");
    const element = buildPartialFailureElement({ ok: false, error: err });
    expect(element).toEqual({
      status: "error",
      error: { message: "Hub unavailable" },
    });
  });

  it("error (string) → { status: 'error', error: { message } }", () => {
    const element = buildPartialFailureElement({ ok: false, error: "string-err" });
    expect(element).toEqual({
      status: "error",
      error: { message: "string-err" },
    });
  });

  it("error (null/undefined) → falls back to generic message", () => {
    const e1 = buildPartialFailureElement({ ok: false, error: undefined });
    expect(e1).toEqual({ status: "error", error: { message: "unknown error" } });

    const e2 = buildPartialFailureElement({ ok: false, error: null });
    expect(e2).toEqual({ status: "error", error: { message: "unknown error" } });
  });

  it("error (custom object) → serializes via String()", () => {
    const element = buildPartialFailureElement({ ok: false, error: { code: 500 } });
    expect(element).toEqual({
      status: "error",
      error: { message: "[object Object]" },
    });
  });
});

describe("Positional preservation invariant (thread-160)", () => {
  it("mixed batch of success + error maintains position + per-call status", () => {
    // Simulate what the llm.ts parallel branch produces — 3 calls,
    // #2 fails, #1 and #3 succeed. Architect's concern: Gemini's
    // 1:1 mapping must survive.
    const results = [
      { ok: true as const, result: { id: "a" } },
      { ok: false as const, error: new Error("call B failed") },
      { ok: true as const, result: { id: "c" } },
    ];
    const elements = results.map(buildPartialFailureElement);

    expect(elements).toHaveLength(3);
    expect(elements[0]).toEqual({ status: "success", data: { id: "a" } });
    expect(elements[1]).toEqual({
      status: "error",
      error: { message: "call B failed" },
    });
    expect(elements[2]).toEqual({ status: "success", data: { id: "c" } });

    // The LLM can process positions 0 and 2 independently of the
    // position-1 failure — the Option 3 semantics architect specified.
  });
});
