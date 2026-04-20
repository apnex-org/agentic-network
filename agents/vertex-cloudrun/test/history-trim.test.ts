/**
 * Phase 2b ckpt-B — trimStaleToolResults tests.
 *
 * Pins behaviour of the round-to-round history-elision helper so
 * accumulated tool-result payloads can't silently drift back in.
 */

import { describe, it, expect } from "vitest";
import type { Content } from "@google/genai";
import { trimStaleToolResults } from "../src/llm.js";

function userPrompt(text: string): Content {
  return { role: "user", parts: [{ text }] };
}

function modelCall(name: string, args: Record<string, unknown>): Content {
  return {
    role: "model",
    parts: [{ functionCall: { name, args } }],
  };
}

function toolResult(
  name: string,
  payload: Record<string, unknown>,
  id = "",
): Content {
  return {
    role: "user",
    parts: [
      {
        functionResponse: { id, name, response: payload },
      },
    ],
  };
}

function largePayload(approxTokens: number): Record<string, unknown> {
  // Each repeated char is ~1 byte; approxTokens × 4 bytes per token.
  return { blob: "x".repeat(approxTokens * 4) };
}

describe("trimStaleToolResults", () => {
  it("keeps the N most-recent tool-result turns within the window", () => {
    const contents: Content[] = [
      userPrompt("initial question"),
      modelCall("list_ideas", {}),
      toolResult("list_ideas", largePayload(5000), "id-1"),
      modelCall("list_tasks", {}),
      toolResult("list_tasks", largePayload(5000), "id-2"),
      modelCall("get_thread", { threadId: "t1" }),
      toolResult("get_thread", largePayload(5000), "id-3"),
    ];
    const reclaimed = trimStaleToolResults(contents, 3, 500);
    expect(reclaimed).toBe(0); // all three tool-results fall inside the window
    // Every tool-result still has its original payload
    const tr1 = (contents[2].parts![0].functionResponse!.response as any).blob;
    expect(tr1.length).toBe(20000);
  });

  it("elides tool-result turns older than the window", () => {
    const contents: Content[] = [
      userPrompt("initial question"),
      modelCall("list_ideas", {}),
      toolResult("list_ideas", largePayload(5000), "id-1"), // oldest — should be elided
      modelCall("list_tasks", {}),
      toolResult("list_tasks", largePayload(5000), "id-2"), // oldest-2 — should be elided
      modelCall("get_thread", { threadId: "t1" }),
      toolResult("get_thread", largePayload(5000), "id-3"), // kept
      modelCall("get_document", {}),
      toolResult("get_document", largePayload(5000), "id-4"), // kept
      modelCall("list_threads", {}),
      toolResult("list_threads", largePayload(5000), "id-5"), // kept
    ];
    const reclaimed = trimStaleToolResults(contents, 3, 500);
    expect(reclaimed).toBeGreaterThan(0);

    // Oldest two are elided
    const r1 = contents[2].parts![0].functionResponse!.response as Record<string, unknown>;
    expect(r1._ois_elided).toBe(true);
    expect(r1.original_tokens_approx).toBeGreaterThanOrEqual(5000);
    expect(r1.note).toMatch(/Re-call list_ideas/);

    const r2 = contents[4].parts![0].functionResponse!.response as Record<string, unknown>;
    expect(r2._ois_elided).toBe(true);

    // Three most-recent remain untouched
    const r3 = contents[6].parts![0].functionResponse!.response as any;
    expect(r3.blob.length).toBe(20000);
    const r4 = contents[8].parts![0].functionResponse!.response as any;
    expect(r4.blob.length).toBe(20000);
    const r5 = contents[10].parts![0].functionResponse!.response as any;
    expect(r5.blob.length).toBe(20000);
  });

  it("keeps small payloads even when outside the window", () => {
    const contents: Content[] = [
      userPrompt("q"),
      modelCall("get_thread", {}),
      toolResult("get_thread", { status: "ok" }, "id-1"), // tiny
      modelCall("get_task", {}),
      toolResult("get_task", largePayload(5000), "id-2"), // big
      modelCall("get_document", {}),
      toolResult("get_document", largePayload(5000), "id-3"),
      modelCall("list_tasks", {}),
      toolResult("list_tasks", largePayload(5000), "id-4"),
      modelCall("list_threads", {}),
      toolResult("list_threads", largePayload(5000), "id-5"),
    ];
    trimStaleToolResults(contents, 3, 500);
    // index 2 is oldest and small — should NOT be elided
    const r1 = contents[2].parts![0].functionResponse!.response as any;
    expect(r1.status).toBe("ok");
    expect(r1._ois_elided).toBeUndefined();
    // index 4 is next-oldest and big — SHOULD be elided
    const r2 = contents[4].parts![0].functionResponse!.response as Record<string, unknown>;
    expect(r2._ois_elided).toBe(true);
  });

  it("preserves functionResponse id and name on elision", () => {
    const contents: Content[] = [
      userPrompt("q"),
      modelCall("list_ideas", {}),
      toolResult("list_ideas", largePayload(5000), "tool-call-1"),
      modelCall("list_tasks", {}),
      toolResult("list_tasks", largePayload(5000), "tool-call-2"),
      modelCall("get_thread", {}),
      toolResult("get_thread", largePayload(5000), "tool-call-3"),
      modelCall("get_document", {}),
      toolResult("get_document", largePayload(5000), "tool-call-4"),
    ];
    trimStaleToolResults(contents, 3, 500);
    const oldest = contents[2].parts![0].functionResponse!;
    expect(oldest.id).toBe("tool-call-1");
    expect(oldest.name).toBe("list_ideas");
  });

  it("is idempotent — a second pass doesn't touch already-elided payloads", () => {
    const contents: Content[] = [
      userPrompt("q"),
      modelCall("a", {}),
      toolResult("a", largePayload(5000), "id-1"),
      modelCall("b", {}),
      toolResult("b", largePayload(5000), "id-2"),
      modelCall("c", {}),
      toolResult("c", largePayload(5000), "id-3"),
      modelCall("d", {}),
      toolResult("d", largePayload(5000), "id-4"),
    ];
    const reclaimed1 = trimStaleToolResults(contents, 3, 500);
    const snapshot = JSON.stringify(contents);
    const reclaimed2 = trimStaleToolResults(contents, 3, 500);
    expect(reclaimed2).toBe(0);
    expect(JSON.stringify(contents)).toBe(snapshot);
    expect(reclaimed1).toBeGreaterThan(0);
  });

  it("does not mistake the initial user prompt for a tool-result turn", () => {
    const contents: Content[] = [
      userPrompt("initial prompt"),
      modelCall("a", {}),
      toolResult("a", largePayload(5000), "id-1"),
      modelCall("b", {}),
      toolResult("b", largePayload(5000), "id-2"),
      modelCall("c", {}),
      toolResult("c", largePayload(5000), "id-3"),
      modelCall("d", {}),
      toolResult("d", largePayload(5000), "id-4"),
    ];
    trimStaleToolResults(contents, 3, 500);
    // Original user prompt must be intact
    expect(contents[0].parts![0].text).toBe("initial prompt");
    expect((contents[0].parts![0] as any).functionResponse).toBeUndefined();
  });
});
