/**
 * NotificationCoalescer — Layer-2 delivery-pacing behavior.
 *
 * idea-355 SLICE-1: this is the single home for the opencode shim's former
 * rate-limit / prompt-queue / deferred-backlog machinery (bug-161 + R1). The
 * shim is now a thin caller; these tests lock the pacing semantics here.
 *
 * The render bindings (promptLLM / injectContext / showToast) are recorded via
 * a fake `CoalescerIO`; the rate-limit clock is injected (`now`) for
 * determinism.
 */
import { describe, expect, it } from "vitest";

import {
  NotificationCoalescer,
  type CoalescedNotification,
  type CoalescerIO,
} from "../src/notification-coalescer.js";

type Call = { kind: "prompt" | "inject" | "toast"; text: string; variant?: string };

function makeIO(opts?: { autoPrompt?: boolean }): {
  io: CoalescerIO;
  calls: Call[];
} {
  const calls: Call[] = [];
  const autoPrompt = opts?.autoPrompt ?? true;
  const io: CoalescerIO = {
    async promptLLM(text) {
      calls.push({ kind: "prompt", text });
    },
    async injectContext(text) {
      calls.push({ kind: "inject", text });
    },
    async showToast(message, variant) {
      calls.push({ kind: "toast", text: message, variant });
    },
    autoPrompt: () => autoPrompt,
  };
  return { io, calls };
}

function actionable(promptText: string, message = "msg"): CoalescedNotification {
  return { level: "actionable", message, promptText };
}
function informational(promptText: string, message = "msg"): CoalescedNotification {
  return { level: "informational", message, promptText };
}

describe("NotificationCoalescer — inactive-session immediate surface", () => {
  it("actionable, not rate-limited → prompts immediately (no backlog suffix)", async () => {
    const { io, calls } = makeIO();
    const c = new NotificationCoalescer({ io, now: () => 1_000_000 });
    await c.enqueue(actionable("do the thing"));
    expect(calls).toEqual([
      { kind: "toast", text: "msg", variant: undefined },
      { kind: "prompt", text: "do the thing" },
    ]);
  });

  it("informational → injectContext, never prompts", async () => {
    const { io, calls } = makeIO();
    const c = new NotificationCoalescer({ io, now: () => 1_000_000 });
    await c.enqueue(informational("fyi"));
    expect(calls).toEqual([
      { kind: "toast", text: "msg", variant: undefined },
      { kind: "inject", text: "fyi" },
    ]);
  });

  it("autoPrompt=false → toast only, no prompt/inject", async () => {
    const { io, calls } = makeIO({ autoPrompt: false });
    const c = new NotificationCoalescer({ io, now: () => 1_000_000 });
    await c.enqueue(actionable("blocked"));
    expect(calls).toEqual([{ kind: "toast", text: "msg", variant: undefined }]);
  });
});

describe("NotificationCoalescer — rate-limit + deferred backlog", () => {
  it("second actionable inside the window → deferred to backlog, surfaced on next prompt", async () => {
    // Realistic clock: lastPromptTime starts at 0, so a large base means the
    // FIRST prompt is never spuriously rate-limited (matches Date.now()).
    let t = 1_000_000;
    const { io, calls } = makeIO();
    const c = new NotificationCoalescer({ io, rateLimitMs: 30_000, now: () => t });

    // First prompt stamps the clock at t=1_000_000.
    await c.enqueue(actionable("first"));
    // 10s later — still inside the 30s window → deferred.
    t = 1_010_000;
    await c.enqueue(actionable("second"));
    expect(calls.filter((x) => x.kind === "prompt").map((x) => x.text)).toEqual(["first"]);
    expect(calls.some((x) => x.variant === "warning")).toBe(true);

    // 40s after the first prompt — window cleared → next actionable prompts AND
    // drains the deferred backlog as a suffix.
    t = 1_040_000;
    await c.enqueue(actionable("third"));
    const lastPrompt = calls.filter((x) => x.kind === "prompt").at(-1)!;
    expect(lastPrompt.text).toContain("third");
    expect(lastPrompt.text).toContain("Deferred Backlog");
    expect(lastPrompt.text).toContain("second");
  });
});

describe("NotificationCoalescer — active-session buffering + flush", () => {
  it("buffers while active, coalesces multiple into one prompt on idle", async () => {
    const { io, calls } = makeIO();
    const c = new NotificationCoalescer({ io, now: () => 1_000_000 });
    await c.setSessionActive(true);
    await c.enqueue(actionable("a"));
    await c.enqueue(actionable("b"));
    // Nothing surfaced as a prompt while active.
    expect(calls.some((x) => x.kind === "prompt")).toBe(false);

    await c.setSessionActive(false); // idle → flush
    const prompt = calls.find((x) => x.kind === "prompt")!;
    expect(prompt.text).toContain("While you were working");
    expect(prompt.text).toContain("a");
    expect(prompt.text).toContain("b");
  });

  it("single buffered item flushes via the single-item path (no coalesce header)", async () => {
    const { io, calls } = makeIO();
    const c = new NotificationCoalescer({ io, now: () => 1_000_000 });
    await c.setSessionActive(true);
    await c.enqueue(actionable("solo"));
    await c.setSessionActive(false);
    const prompt = calls.find((x) => x.kind === "prompt")!;
    expect(prompt.text).toBe("solo");
  });

  it("R1 bounded fallback: cap reached while active → flush without idle", async () => {
    const { io, calls } = makeIO();
    const c = new NotificationCoalescer({ io, flushCap: 2, now: () => 1_000_000 });
    await c.setSessionActive(true);
    await c.enqueue(actionable("x")); // 1 buffered, under cap
    expect(calls.some((x) => x.kind === "prompt")).toBe(false);
    await c.enqueue(actionable("y")); // hits cap → flush
    expect(calls.some((x) => x.kind === "prompt")).toBe(true);
  });

  it("capFlush:false (drained-path) does NOT bounded-flush past the cap", async () => {
    const { io, calls } = makeIO();
    const c = new NotificationCoalescer({ io, flushCap: 2, now: () => 1_000_000 });
    await c.setSessionActive(true);
    await c.enqueue(actionable("x"), { capFlush: false });
    await c.enqueue(actionable("y"), { capFlush: false });
    await c.enqueue(actionable("z"), { capFlush: false });
    expect(calls.some((x) => x.kind === "prompt")).toBe(false); // stays buffered
    await c.setSessionActive(false); // only an explicit idle flushes
    expect(calls.some((x) => x.kind === "prompt")).toBe(true);
  });
});

describe("NotificationCoalescer — session-active field semantics", () => {
  it("getSessionActive reflects the field synchronously on set", () => {
    const { io } = makeIO();
    const c = new NotificationCoalescer({ io, now: () => 0 });
    expect(c.getSessionActive()).toBe(false);
    void c.setSessionActive(true);
    expect(c.getSessionActive()).toBe(true); // sync field set before any await
    void c.setSessionActive(false);
    expect(c.getSessionActive()).toBe(false);
  });
});
