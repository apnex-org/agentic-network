/**
 * MockClaudeClient smoke tests — Mission-41 Wave 1 T3.
 *
 * Proves the mock harness wires up correctly and supports one complete
 * architect↔Hub turn via the real dispatcher + real Hub behind loopback.
 * Covers both the direct-actor API and the declarative `playTape` API.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createMockClaudeClient, type MockClaudeHarness } from "./MockClaudeClient.js";
import { pendingKey } from "@ois/network-adapter";

describe("MockClaudeClient", () => {
  let mock: MockClaudeHarness | null = null;

  afterEach(async () => {
    if (mock) {
      await mock.stop();
      mock = null;
    }
  });

  it("factory wires architect + engineer-with-dispatcher + MCP client correctly", async () => {
    mock = await createMockClaudeClient();
    expect(mock.architect.role).toBe("architect");
    expect(mock.architect.agentId).toMatch(/^eng-/);
    expect(mock.engineer.role).toBe("engineer");
    expect(mock.engineer.agentId).toMatch(/^eng-/);
    expect(mock.engineer.dispatcher).toBeDefined();
    expect(mock.engineer.mcpClient).toBeDefined();
    expect(mock.hub).toBeDefined();
    // architect and engineer get different agentIds
    expect(mock.architect.agentId).not.toBe(mock.engineer.agentId);
  });

  it("round-trip: architect opens thread → engineer dispatcher captures → Claude replies → Hub acks", async () => {
    mock = await createMockClaudeClient();

    // Architect opens a unicast thread targeted at the engineer.
    const openRaw = await mock.architect.call("create_thread", {
      title: "smoke round-trip",
      message: "please review",
      routingMode: "unicast",
      recipientAgentId: mock.engineer.agentId,
    });
    const threadId = parseJsonResult<{ threadId: string }>(openRaw).threadId;
    expect(threadId).toMatch(/^thread-/);

    // Engineer dispatcher captures the pending-action from SSE.
    await mock.waitFor((h) => h.engineer.dispatcher.pendingActionMap.size > 0, 2_000);
    const captured = mock.engineer.dispatcher.pendingActionMap.get(
      pendingKey("thread_message", threadId),
    );
    expect(captured).toMatch(/^pa-/);

    // Claude (MCP client) issues the reply — dispatcher injects sourceQueueItemId.
    const reply = await mock.claude.callTool("create_thread_reply", {
      threadId,
      message: "looks good",
    });
    expect((reply as { isError?: boolean }).isError).toBeFalsy();

    // Dispatcher consumed the map entry (completion-ack happened).
    expect(
      mock.engineer.dispatcher.pendingActionMap.has(pendingKey("thread_message", threadId)),
    ).toBe(false);

    // Hub received the reply with the dispatcher-injected sourceQueueItemId.
    const replies = mock.hub.getToolCalls("create_thread_reply");
    expect(replies.length).toBeGreaterThan(0);
    expect(replies[replies.length - 1].args.sourceQueueItemId).toBe(captured);
  });

  it("playTape runs a scripted round-trip with capture interpolation", async () => {
    mock = await createMockClaudeClient();
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
        kind: "claude",
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

    // Captures collected correctly for post-tape inspection.
    expect((captures.opened as { threadId: string }).threadId).toMatch(/^thread-/);
    expect(captures.replied).toBeDefined();
  });

  it("stop() is idempotent (multiple calls safe)", async () => {
    const h = await createMockClaudeClient();
    await h.stop();
    // Second stop should not throw.
    await expect(h.stop()).resolves.toBeUndefined();
    mock = null; // already stopped; prevent afterEach double-stop (though it's safe anyway)
  });
});

function parseJsonResult<T>(raw: unknown): T {
  if (typeof raw === "string") return JSON.parse(raw) as T;
  if (raw && typeof raw === "object") return raw as T;
  throw new Error(`Unparseable tool result: ${typeof raw}`);
}
