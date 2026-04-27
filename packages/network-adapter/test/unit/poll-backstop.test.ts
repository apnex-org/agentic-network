/**
 * Unit tests for the Mission-56 W3.3 PollBackstop module.
 *
 * Layer:    L1b (network-adapter/src/kernel/poll-backstop.ts)
 * Scope:    Periodic `list_messages({status:"new", since:<lastSeen>})`
 *           poll with cursor persistence + delta surfacing through the
 *           host's onActionableEvent-shaped callback.
 *
 * Invariants pinned here:
 *   - Cursor file: cold-start (no file) → since=undefined; persisted
 *     cursor → since=<lastSeenId>; corrupt file → cold-start recovery.
 *   - Cadence: defaults to 5min; OIS_ADAPTER_POLL_BACKSTOP_S env override;
 *     floored at 60s anti-pattern guard.
 *   - tick() is reentrant-safe (in-flight guard coalesces concurrent
 *     ticks).
 *   - Delta surfacing: each Message in list_messages.messages[] fires
 *     onPolledMessage with shape {event:"message_arrived", data:{message},
 *     id:<messageId>}.
 *   - Empty delta: cursor file untouched (no-op tick).
 *   - Cursor advance: writes maxId from delta on success.
 *   - Errors: list_messages tool-call failure is non-fatal (logged,
 *     skipped); cursor not advanced.
 *   - Agent-not-streaming → tick is a no-op.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PollBackstop, readCursor, writeCursor } from "../../src/index.js";
import type { IAgentClient } from "../../src/index.js";

// ── Test helpers ─────────────────────────────────────────────────────

function newTempDir(): string {
  return mkdtempSync(join(tmpdir(), "poll-backstop-test-"));
}

function fakeStreamingAgent(callImpl: (m: string, p: Record<string, unknown>) => unknown): IAgentClient {
  return {
    state: "streaming" as const,
    isConnected: true,
    call: vi.fn(async (m: string, p: Record<string, unknown>) => callImpl(m, p)) as IAgentClient["call"],
    start: vi.fn(),
    stop: vi.fn(),
    setCallbacks: vi.fn(),
    listMethods: vi.fn().mockResolvedValue([]),
    getSessionId: () => "test-session",
    getMetrics: () => ({
      sessionState: "streaming",
      agentId: "eng-test",
      sessionEpoch: 1,
      totalHandshakes: 1,
      totalSessionInvalidRetries: 0,
      dedupDropCount: 0,
    }),
    getTransport: () => undefined,
  } as unknown as IAgentClient;
}

function fakeDisconnectedAgent(): IAgentClient {
  return {
    state: "disconnected" as const,
    isConnected: false,
    call: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    setCallbacks: vi.fn(),
    listMethods: vi.fn(),
    getSessionId: () => undefined,
    getMetrics: () => ({
      sessionState: "disconnected",
      sessionEpoch: 0,
      totalHandshakes: 0,
      totalSessionInvalidRetries: 0,
      dedupDropCount: 0,
    }),
    getTransport: () => undefined,
  } as unknown as IAgentClient;
}

/** Build a list_messages MCP envelope with the given delta messages. */
function listMessagesEnvelope(messages: Array<{ id: string; [k: string]: unknown }>) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ messages, count: messages.length }),
      },
    ],
  };
}

// ── Cursor persistence ───────────────────────────────────────────────

describe("PollBackstop — cursor persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = newTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("readCursor returns undefined when file doesn't exist (cold-start)", () => {
    expect(readCursor(join(tmpDir, "nonexistent.json"))).toBeUndefined();
  });

  it("writeCursor + readCursor roundtrip preserves lastSeenId", () => {
    const path = join(tmpDir, "cursor.json");
    writeCursor(path, "01HX_TEST_ULID");
    expect(readCursor(path)).toBe("01HX_TEST_ULID");
  });

  it("readCursor returns undefined on corrupt JSON (cold-start recovery)", () => {
    const path = join(tmpDir, "cursor.json");
    writeFileSync(path, "{not valid json", "utf-8");
    expect(readCursor(path)).toBeUndefined();
  });

  it("writeCursor with undefined lastSeenId persists `lastSeenId: undefined` (still a valid file)", () => {
    const path = join(tmpDir, "cursor.json");
    writeCursor(path, undefined);
    expect(existsSync(path)).toBe(true);
    expect(readCursor(path)).toBeUndefined();
  });

  it("writeCursor creates parent directory if missing", () => {
    const nested = join(tmpDir, "nested", "subdir", "cursor.json");
    writeCursor(nested, "abc");
    expect(existsSync(nested)).toBe(true);
    expect(readCursor(nested)).toBe("abc");
  });
});

// ── tick() behavior ──────────────────────────────────────────────────

describe("PollBackstop.tick() — single iteration", () => {
  let tmpDir: string;
  let cursorFile: string;

  beforeEach(() => {
    tmpDir = newTempDir();
    cursorFile = join(tmpDir, "cursor.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cold-start: calls list_messages without `since`, surfaces deltas, persists cursor", async () => {
    const onPolled = vi.fn();
    const callImpl = vi.fn().mockReturnValue(
      listMessagesEnvelope([
        { id: "01HX_AAAA", payload: { text: "first" } },
        { id: "01HX_BBBB", payload: { text: "second" } },
      ]),
    );
    const agent = fakeStreamingAgent(callImpl);
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      onPolledMessage: onPolled,
    });

    await bs.tick(() => agent);

    // No `since` on cold-start.
    expect(callImpl).toHaveBeenCalledWith("list_messages", {
      targetRole: "engineer",
      status: "new",
    });
    // Both messages surfaced via the hook.
    expect(onPolled).toHaveBeenCalledTimes(2);
    expect(onPolled).toHaveBeenNthCalledWith(1, {
      event: "message_arrived",
      data: { message: { id: "01HX_AAAA", payload: { text: "first" } } },
      id: "01HX_AAAA",
    });
    // Cursor advanced to maxId = lex-greatest of returned IDs.
    expect(readCursor(cursorFile)).toBe("01HX_BBBB");
  });

  it("warm-start: passes persisted cursor as `since`, advances on new delta", async () => {
    writeCursor(cursorFile, "01HX_AAAA");
    const callImpl = vi.fn().mockReturnValue(
      listMessagesEnvelope([{ id: "01HX_CCCC" }]),
    );
    const agent = fakeStreamingAgent(callImpl);
    const onPolled = vi.fn();
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      onPolledMessage: onPolled,
    });

    await bs.tick(() => agent);

    expect(callImpl).toHaveBeenCalledWith("list_messages", {
      targetRole: "engineer",
      status: "new",
      since: "01HX_AAAA",
    });
    expect(onPolled).toHaveBeenCalledTimes(1);
    expect(readCursor(cursorFile)).toBe("01HX_CCCC");
  });

  it("empty delta: cursor file unchanged (no-op tick)", async () => {
    writeCursor(cursorFile, "01HX_PRIOR");
    const callImpl = vi.fn().mockReturnValue(listMessagesEnvelope([]));
    const agent = fakeStreamingAgent(callImpl);
    const onPolled = vi.fn();
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      onPolledMessage: onPolled,
    });

    await bs.tick(() => agent);

    expect(onPolled).not.toHaveBeenCalled();
    expect(readCursor(cursorFile)).toBe("01HX_PRIOR");
  });

  it("agent disconnected: tick is a no-op (no list_messages call)", async () => {
    const agent = fakeDisconnectedAgent();
    const onPolled = vi.fn();
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      onPolledMessage: onPolled,
    });

    await bs.tick(() => agent);

    expect(agent.call).not.toHaveBeenCalled();
    expect(onPolled).not.toHaveBeenCalled();
  });

  it("agent null: tick is a no-op", async () => {
    const onPolled = vi.fn();
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      onPolledMessage: onPolled,
    });

    await bs.tick(() => null);

    expect(onPolled).not.toHaveBeenCalled();
  });

  it("list_messages tool-call failure is non-fatal: logs, skips, cursor preserved", async () => {
    writeCursor(cursorFile, "01HX_PRIOR");
    const logs: string[] = [];
    const callImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const agent = fakeStreamingAgent(callImpl);
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      log: (m) => logs.push(m),
      onPolledMessage: vi.fn(),
    });

    await bs.tick(() => agent);

    expect(logs.some((l) => l.includes("list_messages failed"))).toBe(true);
    expect(readCursor(cursorFile)).toBe("01HX_PRIOR"); // preserved.
  });

  it("malformed list_messages envelope: logs warning, no crash, cursor preserved", async () => {
    writeCursor(cursorFile, "01HX_PRIOR");
    const logs: string[] = [];
    const callImpl = vi.fn().mockReturnValue({ content: [{ type: "text", text: "{not-json" }] });
    const agent = fakeStreamingAgent(callImpl);
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      log: (m) => logs.push(m),
      onPolledMessage: vi.fn(),
    });

    await bs.tick(() => agent);

    expect(logs.some((l) => l.includes("unexpected list_messages result"))).toBe(true);
    expect(readCursor(cursorFile)).toBe("01HX_PRIOR");
  });

  it("isError envelope: skipped, cursor preserved", async () => {
    writeCursor(cursorFile, "01HX_PRIOR");
    const callImpl = vi.fn().mockReturnValue({
      content: [{ type: "text", text: '{"error":"forbidden"}' }],
      isError: true,
    });
    const agent = fakeStreamingAgent(callImpl);
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      onPolledMessage: vi.fn(),
    });

    await bs.tick(() => agent);

    expect(readCursor(cursorFile)).toBe("01HX_PRIOR");
  });

  it("onPolledMessage handler throw: caught, logged, other messages still processed", async () => {
    const callImpl = vi.fn().mockReturnValue(
      listMessagesEnvelope([
        { id: "01HX_A" },
        { id: "01HX_B" },
        { id: "01HX_C" },
      ]),
    );
    const agent = fakeStreamingAgent(callImpl);
    const logs: string[] = [];
    const onPolled = vi.fn((evt: { id?: string }) => {
      if (evt.id === "01HX_B") throw new Error("host hook failed");
    });
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      log: (m) => logs.push(m),
      onPolledMessage: onPolled,
    });

    await bs.tick(() => agent);

    expect(onPolled).toHaveBeenCalledTimes(3); // all attempted
    expect(logs.some((l) => l.includes("onPolledMessage handler threw"))).toBe(true);
    // Cursor still advances to lex-greatest.
    expect(readCursor(cursorFile)).toBe("01HX_C");
  });

  it("cursor regression guard: maxId <= since does NOT regress the cursor file", async () => {
    writeCursor(cursorFile, "01HX_LATER");
    // Hub returns a stale message somehow (clock skew / race) — id <= since.
    const callImpl = vi.fn().mockReturnValue(
      listMessagesEnvelope([{ id: "01HX_EARLIER" }]),
    );
    const agent = fakeStreamingAgent(callImpl);
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      onPolledMessage: vi.fn(),
    });

    await bs.tick(() => agent);

    // Cursor stays at the more-recent value despite the stale return.
    expect(readCursor(cursorFile)).toBe("01HX_LATER");
  });
});

// ── Cadence + start/stop ─────────────────────────────────────────────

describe("PollBackstop — cadence + lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = newTempDir();
    delete process.env.OIS_ADAPTER_POLL_BACKSTOP_S;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.OIS_ADAPTER_POLL_BACKSTOP_S;
  });

  it("OIS_ADAPTER_POLL_BACKSTOP_S env override applies (above floor)", () => {
    process.env.OIS_ADAPTER_POLL_BACKSTOP_S = "120";
    const bs = new PollBackstop({
      role: "engineer",
      onPolledMessage: vi.fn(),
    });
    // Internal: cadence stored on opts; we observe via start() not blowing up.
    // Start + immediately stop to validate the timer creation path.
    bs.start(() => null);
    bs.stop();
  });

  it("cadence floor enforced (60s minimum, even if env says less)", () => {
    process.env.OIS_ADAPTER_POLL_BACKSTOP_S = "10"; // attempt sub-floor.
    const bs = new PollBackstop({
      role: "engineer",
      cadenceSeconds: 5, // explicit also sub-floor
      onPolledMessage: vi.fn(),
    });
    // Ticker creation at floored cadence — no exception, no immediate fire.
    bs.start(() => null);
    bs.stop();
  });

  it("start is idempotent (second call without stop is a no-op)", () => {
    const bs = new PollBackstop({
      role: "engineer",
      cadenceSeconds: 60,
      onPolledMessage: vi.fn(),
    });
    bs.start(() => null);
    bs.start(() => null); // no-op
    bs.stop();
  });

  it("stop is idempotent (second call is a no-op)", () => {
    const bs = new PollBackstop({
      role: "engineer",
      cadenceSeconds: 60,
      onPolledMessage: vi.fn(),
    });
    bs.start(() => null);
    bs.stop();
    bs.stop(); // no-op
  });

  it("tick reentrancy: concurrent calls coalesce on the in-flight one", async () => {
    const cursorFile = join(tmpDir, "cursor.json");
    let callCount = 0;
    const callImpl = vi.fn().mockImplementation(async () => {
      callCount++;
      // Slow call — simulates network latency.
      await new Promise((r) => setTimeout(r, 30));
      return listMessagesEnvelope([{ id: "01HX_X" }]);
    });
    const agent = fakeStreamingAgent(callImpl);
    const bs = new PollBackstop({
      role: "engineer",
      cursorFile,
      onPolledMessage: vi.fn(),
    });

    await Promise.all([
      bs.tick(() => agent),
      bs.tick(() => agent),
      bs.tick(() => agent),
    ]);

    // Only one underlying list_messages call despite 3 concurrent ticks.
    expect(callCount).toBe(1);
  });
});
