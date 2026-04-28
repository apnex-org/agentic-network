/**
 * MockOpenCodeClient smoke tests — Mission-41 Wave 1 T4.
 *
 * Proves the mock harness wires up correctly and supports one complete
 * architect ↔ Hub notification round-trip via the real dispatcher +
 * real Hub behind loopback. Mirrors T3's smoke-test shape for the
 * opencode backend (no Bun, no OpenCode runtime).
 */

import { describe, it, expect, afterEach } from "vitest";
import { createMockOpenCodeClient, type MockOpenCodeHarness } from "./MockOpenCodeClient.js";
import { pendingKey } from "@apnex/network-adapter";

describe("MockOpenCodeClient", () => {
  let mock: MockOpenCodeHarness | null = null;

  afterEach(async () => {
    if (mock) {
      await mock.stop();
      mock = null;
    }
  });

  it("factory wires architect + engineer-with-dispatcher + MCP client correctly", async () => {
    mock = await createMockOpenCodeClient();
    expect(mock.architect.role).toBe("architect");
    expect(mock.architect.agentId).toMatch(/^eng-/);
    expect(mock.engineer.role).toBe("engineer");
    expect(mock.engineer.agentId).toMatch(/^eng-/);
    expect(mock.engineer.dispatcher).toBeDefined();
    expect(mock.engineer.mcpClient).toBeDefined();
    expect(mock.hub).toBeDefined();
    expect(mock.architect.agentId).not.toBe(mock.engineer.agentId);
  });

  it("notification round-trip: architect opens thread → engineer dispatcher captures → opencode replies → Hub acks", async () => {
    mock = await createMockOpenCodeClient();

    const openRaw = await mock.architect.call("create_thread", {
      title: "opencode smoke",
      message: "please review",
      routingMode: "unicast",
      recipientAgentId: mock.engineer.agentId,
    });
    const threadId = parseJsonResult<{ threadId: string }>(openRaw).threadId;
    expect(threadId).toMatch(/^thread-/);

    // Engineer dispatcher's queueMap callbacks populate the pendingActionMap
    // from the SSE thread_message event (ADR-017 Phase 1.1).
    await mock.waitFor((h) => h.engineer.dispatcher.pendingActionMap.size > 0, 2_000);
    const captured = mock.engineer.dispatcher.pendingActionMap.get(
      pendingKey("thread_message", threadId),
    );
    expect(captured).toMatch(/^pa-/);

    // OpenCode (MCP client) issues the reply — dispatcher injects sourceQueueItemId.
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
