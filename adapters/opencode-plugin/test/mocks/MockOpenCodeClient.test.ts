/**
 * MockOpenCodeClient smoke tests — Mission-41 Wave 1 T4; Mission-101 W5.
 *
 * Proves the mock harness wires up correctly through createOpenCodeRuntime and
 * supports complete architect ↔ Hub notification round-trips without a live
 * OpenCode host, Bun server, or network socket.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMockOpenCodeClient, type MockOpenCodeHarness } from "./MockOpenCodeClient.js";
import { pendingKey } from "@apnex/network-adapter";

const here = dirname(fileURLToPath(import.meta.url));
const mockSourcePath = resolve(here, "MockOpenCodeClient.ts");

describe("MockOpenCodeClient", () => {
  let mock: MockOpenCodeHarness | null = null;

  afterEach(async () => {
    if (mock) {
      await mock.stop();
      mock = null;
    }
  });

  it("factory wires architect + engineer through the OpenCode runtime seam + MCP client", async () => {
    mock = await createMockOpenCodeClient();
    expect(mock.architect.role).toBe("architect");
    // agentId is the Hub-derived `agent-{8-hex-of-sha256(name)}` (idea-251) —
    // not the eng-/arch- prefixed name.
    expect(mock.architect.agentId).toMatch(/^agent-/);
    expect(mock.engineer.role).toBe("engineer");
    expect(mock.engineer.agentId).toMatch(/^agent-/);
    expect(mock.engineer.runtime).toBeDefined();
    expect(mock.engineer.dispatcher).toBe(mock.engineer.runtime.testOnly.dispatcher);
    expect(mock.engineer.runtime.testOnly.getHubAdapter()).toBe(mock.engineer.agent);
    expect(mock.engineer.mcpClient).toBeDefined();
    expect(mock.hub).toBeDefined();
    expect(mock.architect.agentId).not.toBe(mock.engineer.agentId);
  });

  it("does not recreate production dispatcher or MCP-server wiring inside the mock", () => {
    const source = readFileSync(mockSourcePath, "utf-8");

    expect(source).toContain("createOpenCodeRuntime");
    expect(source).toContain("runtime.makeOpenCodeFetchHandler()");

    // W5 guard: the mock may construct offline transports/agents, but must not
    // reintroduce the pre-W5 false-green shape where it owned dispatcher/server
    // creation instead of consuming the runtime seam.
    expect(source).not.toMatch(/\bcreateSharedDispatcher\b/);
    expect(source).not.toMatch(/\bInMemoryTransport\b/);
    expect(source).not.toMatch(/\.createMcpServer\s*\(/);
  });

  it("notification round-trip: architect opens thread → runtime dispatcher captures → opencode replies → Hub acks", async () => {
    mock = await createMockOpenCodeClient();

    const openRaw = await mock.architect.call("create_thread", {
      title: "opencode smoke",
      message: "please review",
      routingMode: "unicast",
      recipientAgentId: mock.engineer.agentId,
    });
    const threadId = parseJsonResult<{ threadId: string }>(openRaw).threadId;
    expect(threadId).toMatch(/^thread-/);

    // Runtime-owned dispatcher callbacks populate the pendingActionMap from the
    // SSE thread_message event (ADR-017 Phase 1.1).
    await mock.waitFor((h) => h.engineer.dispatcher.pendingActionMap.size > 0, 2_000);
    const captured = mock.engineer.dispatcher.pendingActionMap.get(
      pendingKey("thread_message", threadId),
    );
    expect(captured).toMatch(/^pa-/);

    // OpenCode (MCP client) issues the reply through runtime.makeOpenCodeFetchHandler;
    // the runtime-owned dispatcher injects sourceQueueItemId.
    const reply = await mock.opencode.callTool("create_thread_reply", {
      threadId,
      message: "looks good",
    });
    expect((reply as { isError?: boolean }).isError).toBeFalsy();

    // Dispatcher consumed the map entry (completion-ack happened).
    expect(
      mock.engineer.dispatcher.pendingActionMap.has(pendingKey("thread_message", threadId)),
    ).toBe(false);

    // Hub received the reply with dispatcher-injected sourceQueueItemId.
    const replies = mock.hub.getToolCalls("create_thread_reply");
    expect(replies.length).toBeGreaterThan(0);
    expect(replies[replies.length - 1].args.sourceQueueItemId).toBe(captured);
  });

  it("playTape runs a scripted round-trip with capture interpolation", async () => {
    mock = await createMockOpenCodeClient();
    const recipientId = mock.engineer.agentId;

    const { captures } = await mock.playTape([
      {
        kind: "architect",
        tool: "create_thread",
        args: {
          title: "tape smoke",
          message: "tape test",
          routingMode: "unicast",
          recipientAgentId: recipientId,
        },
        capture: "opened",
      },
      {
        kind: "waitFor",
        until: (h) => h.engineer.dispatcher.pendingActionMap.size > 0,
        timeoutMs: 2_000,
        description: "dispatcher captures pending action",
      },
      {
        kind: "opencode",
        tool: "create_thread_reply",
        args: {
          threadId: "${opened.threadId}",
          message: "scripted reply",
        },
        capture: "replied",
      },
      {
        kind: "assert",
        fn: (h, caps) => {
          const opened = caps.opened as { threadId: string };
          const replies = h.hub.getToolCalls("create_thread_reply");
          expect(replies.length).toBeGreaterThan(0);
          expect(replies[replies.length - 1].args.threadId).toBe(opened.threadId);
        },
      },
    ]);

    expect((captures.opened as { threadId: string }).threadId).toMatch(/^thread-/);
    expect(captures.replied).toBeDefined();
  });

  it("stop() is idempotent (multiple calls safe)", async () => {
    const h = await createMockOpenCodeClient();
    await h.stop();
    await expect(h.stop()).resolves.toBeUndefined();
    mock = null;
  });
});

function parseJsonResult<T>(raw: unknown): T {
  if (typeof raw === "string") return JSON.parse(raw) as T;
  if (raw && typeof raw === "object") return raw as T;
  throw new Error(`Unparseable tool result: ${typeof raw}`);
}
