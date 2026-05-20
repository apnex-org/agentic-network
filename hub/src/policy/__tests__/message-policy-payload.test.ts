/**
 * bug-102 regression — `create_message` payload-encoding tolerance.
 *
 * The `create_message` `payload` MCP-tool param is typeless (`z.unknown()`);
 * some MCP-client / proxy forward paths JSON-stringify a typeless param, so
 * the payload arrives at the Hub as a string. `coerceToolPayload` normalizes
 * a JSON-string-encoded object back to an object at the MCP entry-point so
 * the per-kind validators see the structured payload the caller intended.
 *
 * AG-W3.11: a `kind=note` object payload round-trips clean even when it
 * arrives JSON-string-encoded.
 */
import { describe, it, expect } from "vitest";
import { coerceToolPayload } from "../message-policy.js";
import { validateNotePayload } from "../note-schema.js";

describe("coerceToolPayload — bug-102 payload normalization", () => {
  it("parses a JSON-string-encoded object back to an object", () => {
    expect(coerceToolPayload('{"body":"hello"}')).toEqual({ body: "hello" });
  });

  it("passes a real object through unchanged", () => {
    const obj = { body: "hello", severity: "info" };
    expect(coerceToolPayload(obj)).toBe(obj);
  });

  it("passes a non-JSON string through unchanged (per-kind validator rejects it)", () => {
    expect(coerceToolPayload("not json")).toBe("not json");
  });

  it("passes non-string scalars through unchanged", () => {
    expect(coerceToolPayload(123)).toBe(123);
    expect(coerceToolPayload(null)).toBe(null);
    expect(coerceToolPayload(undefined)).toBe(undefined);
  });
});

describe("bug-102 end-to-end — stringified kind=note payload round-trips clean", () => {
  it("a JSON-string-encoded note payload passes validateNotePayload after coercion", () => {
    // The exact bug-102 repro shape: caller passes {body:"…"}, proxy stringifies it.
    const wireValue = JSON.stringify({ body: "W3 status note" });
    expect(typeof wireValue).toBe("string");

    const coerced = coerceToolPayload(wireValue);
    const result = validateNotePayload(coerced);

    expect(result.valid).toBe(true); // AG-W3.11 — round-trips clean
  });

  it("a direct object note payload still validates (no regression)", () => {
    expect(validateNotePayload(coerceToolPayload({ body: "direct" })).valid).toBe(true);
  });

  it("a non-JSON string note payload is still rejected with the plain-object diagnostic", () => {
    const result = validateNotePayload(coerceToolPayload("plain text"));
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain("plain object for kind=note");
  });
});
