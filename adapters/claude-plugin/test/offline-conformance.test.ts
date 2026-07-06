import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cachePathFor, pendingKey } from "@apnex/network-adapter";
import { SOURCE_ATTRIBUTE_FAMILIES } from "../src/source-attribute.js";
import { createMockClaudeClient, type MockClaudeHarness } from "./mocks/MockClaudeClient.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const OFFLINE_CERTIFICATION_BOUNDARY = {
  mode: "offline-functional",
  liveLlmCalls: 0,
  liveCertification: "deferred-until-quota-returns",
} as const;

describe("mission-100 offline conformance — real Claude runtime via MockClaudeClient v2", () => {
  let mock: MockClaudeHarness | null = null;

  afterEach(async () => {
    if (mock) {
      await mock.stop();
      mock = null;
    }
  });

  it("startup ordering is stdio/MCP-first, then Hub agent start, then Initialize captures Claude clientInfo", async () => {
    mock = await createMockClaudeClient();

    expect(mock.engineer.runtimeControls.trace).toEqual([
      "runtime:create:before",
      "runtime:create:after",
      "agent:start:before",
      "agent:start:after",
      "mcp-client:connect:before",
      "mcp-client:connect:after",
    ]);
    expect(mock.engineer.dispatcher.getClientInfo()).toEqual({
      name: "mock-claude-code",
      version: "1.0.0",
    });
  });

  it("MCP listTools and callTool drive the real shared dispatcher into the Hub", async () => {
    mock = await createMockClaudeClient();

    const tools = await mock.engineer.mcpClient.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("create_thread");
    expect(names).toContain("create_thread_reply");
    expect(names).toContain("claim_work");
    expect(names.length).toBeGreaterThan(20);

    const raw = await mock.claude.callTool("get_agents", { limit: 1 });
    expect((raw as { isError?: boolean }).isError).toBeFalsy();
    expect(parseMcpText(raw)).toMatchObject({ agents: expect.any(Array) });

    const listTeleCalls = mock.hub.getToolCalls("get_agents");
    expect(listTeleCalls).toHaveLength(1);
    expect(listTeleCalls[0].args).toEqual({ limit: 1 });

    // The signal wrapper is part of the shared dispatch authority that the
    // runtime factory wires under the MCP callTool handler.
    await mock.waitFor((h) => h.hub.getToolCalls("signal_working_completed").length > 0, 2_000);
    expect(
      mock.hub.getToolCalls("signal_working_started").some((c) => c.args.toolName === "get_agents"),
    ).toBe(true);
  });

  it("thread wake renders on the Claude channel, then reply injects sourceQueueItemId and completion-acks", async () => {
    mock = await createMockClaudeClient();
    const channelPushes: Array<{ method?: string; params?: any }> = [];
    mock.engineer.mcpClient.fallbackNotificationHandler = async (n: any) => {
      channelPushes.push(n);
    };

    const openRaw = await mock.architect.call("create_thread", {
      title: "offline conformance wake",
      message: "please verify the conformance path",
      routingMode: "unicast",
      recipientAgentId: mock.engineer.agentId,
    });
    const threadId = parseToolResult<{ threadId: string }>(openRaw).threadId;

    await mock.waitFor(
      (h) => h.engineer.dispatcher.pendingActionMap.has(pendingKey("thread_message", threadId)),
      2_000,
    );
    const capturedQueueItem = mock.engineer.dispatcher.pendingActionMap.get(
      pendingKey("thread_message", threadId),
    );
    expect(capturedQueueItem).toMatch(/^pa-/);

    await mock.waitFor(
      () => channelPushes.some((p) => p.method === "notifications/claude/channel"),
      2_000,
    );
    const threadPush = channelPushes.find(
      (p) => p.method === "notifications/claude/channel" && p.params?.meta?.event === "thread_message",
    );
    expect(threadPush).toBeDefined();
    expect(threadPush!.params.meta).toMatchObject({
      event: "thread_message",
      threadId,
      level: "actionable",
      source: SOURCE_ATTRIBUTE_FAMILIES.NOTIFICATION,
    });
    expect(typeof threadPush!.params.content).toBe("string");
    expect(threadPush!.params.content.length).toBeGreaterThan(0);

    expect(
      mock.engineer.runtimeControls.actionableLog.some(
        (entry) => entry.event.event === "thread_message" && entry.action.includes("create_thread_reply"),
      ),
    ).toBe(true);

    const reply = await mock.claude.callTool("create_thread_reply", {
      threadId,
      message: "offline conformance reply",
    });
    expect((reply as { isError?: boolean }).isError).toBeFalsy();

    const replyCalls = mock.hub.getToolCalls("create_thread_reply");
    expect(replyCalls[replyCalls.length - 1].args.sourceQueueItemId).toBe(capturedQueueItem);
    expect(mock.engineer.dispatcher.pendingActionMap.has(pendingKey("thread_message", threadId))).toBe(false);

    const pendingItems = await mock.hub.stores.pendingAction.listForAgent(mock.engineer.agentId);
    const settled = pendingItems.find((i) => i.id === capturedQueueItem);
    expect(settled?.state).toBe("completion_acked");
  });

  it("work-verb callTool is signal-wrapped and locally observed by the lease tracker", async () => {
    mock = await createMockClaudeClient();

    const createdRaw = await mock.architect.call("create_work", {
      type: "freeform",
      roleEligibility: ["engineer"],
      payload: { title: "offline conformance lease probe" },
    });
    const workId = parseToolResult<{ workItem: { id: string } }>(createdRaw).workItem.id;

    const claimedRaw = await mock.claude.callTool("claim_work", { workId });
    expect((claimedRaw as { isError?: boolean }).isError).toBeFalsy();
    const claimed = parseMcpText<{ workItem: { id: string; lease: { holder: string; expiresAt: string } } }>(claimedRaw);
    expect(claimed.workItem.id).toBe(workId);
    expect(claimed.workItem.lease.holder).toBe(mock.engineer.agentId);

    await mock.waitFor(
      (h) =>
        h.hub.getToolCalls("signal_working_started").some((c) => c.args.toolName === "claim_work") &&
        h.hub.getToolCalls("signal_working_completed").length > 0,
      2_000,
    );
    expect(mock.hub.getToolCalls("claim_work").slice(-1)[0].args.workId).toBe(workId);

    const held = mock.engineer.dispatcher.workLeases.snapshot();
    expect(held.some((lease) => lease.workId === workId)).toBe(true);
    expect(mock.engineer.dispatcher.workLeases.size()).toBe(1);
  });

  it("tool catalog cache persists a live listTools result and reconciler emits tools/list_changed on drift", async () => {
    mock = await createMockClaudeClient({ initialToolSurfaceRevision: "rev-offline-a" });
    const notifications: Array<{ method?: string; params?: any }> = [];
    mock.engineer.mcpClient.fallbackNotificationHandler = async (n: any) => {
      notifications.push(n);
    };

    await mock.engineer.mcpClient.listTools();
    const cached = JSON.parse(readFileSync(cachePathFor(mock.engineer.workDir), "utf-8"));
    expect(cached.toolSurfaceRevision).toBe("rev-offline-a");
    expect(cached.catalog.length).toBeGreaterThan(20);

    // The runtime's identityReady pass may already have established the baseline;
    // an unchanged reconcile must not emit a host refresh.
    const stable = await mock.engineer.reconciler.reconcile("offline-conformance-stable");
    expect(stable).toEqual({ emitted: false, live: "rev-offline-a" });

    mock.engineer.runtimeControls.setLiveToolSurfaceRevision("rev-offline-b");
    const drift = await mock.engineer.reconciler.reconcile("offline-conformance-drift");
    expect(drift).toEqual({ emitted: true, live: "rev-offline-b" });

    await mock.waitFor(
      () => notifications.some((n) => n.method === "notifications/tools/list_changed"),
      2_000,
    );
    expect(mock.engineer.reconciler.getAppliedRevision()).toBe("rev-offline-b");
  });

  it("suite is explicitly offline-only and does not claim live Claude LLM certification", () => {
    expect(OFFLINE_CERTIFICATION_BOUNDARY).toEqual({
      mode: "offline-functional",
      liveLlmCalls: 0,
      liveCertification: "deferred-until-quota-returns",
    });

    const mockSource = readFileSync(resolve(root, "test", "mocks", "MockClaudeClient.ts"), "utf-8");
    expect(mockSource).toContain("InMemoryTransport");
    expect(mockSource).toContain("LoopbackTransport");
    expect(mockSource).toContain("PolicyLoopbackHub");
    expect(mockSource).toContain("createClaudeRuntime");
    expect(mockSource).not.toMatch(/StdioClientTransport|SSEClientTransport|spawn\(|execFile\(|@anthropic-ai|ANTHROPIC_API_KEY|CLAUDE_API_KEY|fetch\(/);
  });
});

function parseToolResult<T>(raw: unknown): T {
  if (typeof raw === "string") return JSON.parse(raw) as T;
  if (raw && typeof raw === "object") return raw as T;
  throw new Error(`Unparseable tool result: ${typeof raw}`);
}

function parseMcpText<T = any>(raw: unknown): T {
  const content = (raw as { content?: Array<{ text?: string }> }).content;
  const text = content?.[0]?.text;
  if (typeof text !== "string") throw new Error("MCP result did not include text content");
  return JSON.parse(text) as T;
}
