import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pendingKey, type AgentEvent } from "@apnex/network-adapter";
import type { OpenCodeRuntime } from "../src/runtime.js";
import { createMockOpenCodeClient, type MockOpenCodeHarness } from "./mocks/MockOpenCodeClient.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..", "..");

const OFFLINE_CERTIFICATION_BOUNDARY = {
  mode: "offline-functional",
  liveOpenCodeSessions: 0,
  liveLlmCalls: 0,
  liveGpt55Certification: "separate-work-110-after-distribution-offline-package-gates",
} as const;

type SessionEvent = Parameters<OpenCodeRuntime["testOnly"]["handleSessionEvent"]>[0];

const sessionCreated = (id: string): SessionEvent =>
  ({ type: "session.created", properties: { info: { id } } }) as unknown as SessionEvent;

const sessionStatus = (statusType: string): SessionEvent =>
  ({
    type: "session.status",
    properties: { sessionID: "offline-session", status: { type: statusType } },
  }) as unknown as SessionEvent;

describe("mission-101 offline conformance — real OpenCode runtime via MockOpenCodeClient v2", () => {
  let mock: MockOpenCodeHarness | null = null;

  afterEach(async () => {
    if (mock) {
      await mock.stop();
      mock = null;
    }
  });

  it("startup/config path is offline and MCP listTools/callTool drive runtime fetch → shared dispatch → Hub", async () => {
    mock = await createMockOpenCodeClient();

    expect(mock.engineer.runtime.plugin).toBeTypeOf("function");
    expect(mock.engineer.runtime.makeOpenCodeFetchHandler).toBeTypeOf("function");
    expect(mock.engineer.dispatcher).toBe(mock.engineer.runtime.testOnly.dispatcher);
    expect(mock.engineer.runtime.testOnly.getHubAdapter()).toBe(mock.engineer.agent);

    // W5 mock initialization calls HubPlugin only to seed config/sdk/log paths;
    // its scheduler is a no-op, so live OpenCode startup side effects do not run.
    expect(mock.engineer.sdkClient.sessionListCalls).toBe(0);
    expect(mock.engineer.sdkClient.mcpAdds).toHaveLength(0);

    const tools = await mock.engineer.mcpClient.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain("create_thread");
    expect(names).toContain("create_thread_reply");
    expect(names).toContain("claim_work");
    expect(names.length).toBeGreaterThan(20);

    const raw = await mock.opencode.callTool("list_tele", { limit: 1 });
    expect((raw as { isError?: boolean }).isError).toBeFalsy();
    expect(parseMcpText(raw)).toMatchObject({ tele: expect.any(Array) });

    expect(mock.hub.getToolCalls("list_tele").slice(-1)[0].args).toEqual({ limit: 1 });
    await mock.waitFor(
      (h) => h.hub.getToolCalls("signal_working_completed").length > 0,
      2_000,
    );
    expect(
      mock.hub.getToolCalls("signal_working_started").some((c) => c.args.toolName === "list_tele"),
    ).toBe(true);
  });

  it("runtime notification router dedups duplicate actionable event IDs before the OpenCode prompt surface", async () => {
    mock = await createMockOpenCodeClient();
    await mock.engineer.runtime.testOnly.handleSessionEvent(sessionCreated("offline-dedup-session"));

    const duplicateEvent: AgentEvent = {
      id: "offline-dedup-event-1",
      event: "thread_message",
      data: {
        threadId: "thread-offline-dedup",
        title: "dedup conformance",
        message: "dedup body should surface once",
        author: "architect",
      },
    };

    mock.engineer.dispatcher.callbacks.onActionableEvent?.(duplicateEvent);
    mock.engineer.dispatcher.callbacks.onActionableEvent?.(duplicateEvent);

    await mock.waitFor((h) => h.engineer.sdkClient.prompts.length === 1, 2_000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mock.engineer.sdkClient.prompts).toHaveLength(1);
    expect(mock.engineer.sdkClient.toasts).toHaveLength(1);
    expect(extractPromptText(mock.engineer.sdkClient.prompts[0])).toContain(
      "dedup body should surface once",
    );
  });

  it("session-active notification queue flushes on idle, then sourceQueueItemId is injected and completion-acked", async () => {
    mock = await createMockOpenCodeClient();

    await mock.engineer.runtime.testOnly.handleSessionEvent(sessionCreated("offline-session-1"));
    await mock.engineer.runtime.testOnly.handleSessionEvent(sessionStatus("busy"));
    expect(mock.engineer.runtime.testOnly.getSessionActive()).toBe(true);

    const openRaw = await mock.architect.call("create_thread", {
      title: "offline conformance wake",
      message: "please verify the OpenCode conformance path",
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

    // Busy session: the coalescer queues the prompt instead of surfacing mid-turn.
    expect(mock.engineer.sdkClient.prompts).toHaveLength(0);
    expect(mock.engineer.sdkClient.toasts).toHaveLength(0);

    await mock.engineer.runtime.testOnly.handleSessionEvent(sessionStatus("idle"));
    expect(mock.engineer.runtime.testOnly.getSessionActive()).toBe(false);
    await mock.waitFor((h) => h.engineer.sdkClient.prompts.length > 0, 2_000);

    const promptText = extractPromptText(mock.engineer.sdkClient.prompts[0]);
    expect(promptText).toContain("please verify the OpenCode conformance path");
    expect(promptText).toContain("architect-hub_create_thread_reply");
    expect(JSON.stringify(mock.engineer.sdkClient.toasts)).toContain("offline conformance wake");

    const reply = await mock.opencode.callTool("create_thread_reply", {
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

  it("work-verb callTool is signal-wrapped and observed by the local lease tracker", async () => {
    mock = await createMockOpenCodeClient();

    const createdRaw = await mock.architect.call("create_work", {
      type: "freeform",
      roleEligibility: ["engineer"],
      payload: { title: "opencode offline conformance lease probe" },
    });
    const workId = parseToolResult<{ workItem: { id: string } }>(createdRaw).workItem.id;

    const claimedRaw = await mock.opencode.callTool("claim_work", { workId });
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

  it("ToolSurfaceReconciler baselines then emits list_changed over the OpenCode runtime bridge on drift", async () => {
    mock = await createMockOpenCodeClient();
    const fakeServer = { sendToolListChanged: vi.fn(async () => {}) };
    mock.engineer.runtime.testOnly.pushProxyServer(fakeServer as any);

    const fetchLiveRevision = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("rev-open-a")
      .mockResolvedValueOnce("rev-open-b");
    const reconciler = mock.engineer.runtime.testOnly.buildToolSurfaceReconciler(
      "https://hub.example/mcp",
      fetchLiveRevision,
    );

    expect(await reconciler.reconcile("offline-seed")).toEqual({
      emitted: false,
      live: "rev-open-a",
    });
    expect(fakeServer.sendToolListChanged).not.toHaveBeenCalled();

    expect(await reconciler.reconcile("offline-drift")).toEqual({
      emitted: true,
      live: "rev-open-b",
    });
    expect(fakeServer.sendToolListChanged).toHaveBeenCalledOnce();
    expect(reconciler.getAppliedRevision()).toBe("rev-open-b");
    await mock.waitFor(
      (h) => JSON.stringify(h.engineer.sdkClient.toasts).includes("Hub tools updated"),
      2_000,
    );
  });

  it("suite is explicitly offline-only and guards against mock-local dispatch bypass recurrence", () => {
    expect(OFFLINE_CERTIFICATION_BOUNDARY).toEqual({
      mode: "offline-functional",
      liveOpenCodeSessions: 0,
      liveLlmCalls: 0,
      liveGpt55Certification: "separate-work-110-after-distribution-offline-package-gates",
    });

    const mockSource = readFileSync(resolve(root, "test", "mocks", "MockOpenCodeClient.ts"), "utf-8");
    expect(mockSource).toContain("createOpenCodeRuntime");
    expect(mockSource).toContain("runtime.makeOpenCodeFetchHandler()");
    expect(mockSource).toContain("StreamableHTTPClientTransport");
    expect(mockSource).toContain("LoopbackTransport");
    expect(mockSource).toContain("PolicyLoopbackHub");
    expect(mockSource).not.toMatch(/\bcreateSharedDispatcher\b|\bInMemoryTransport\b|\.createMcpServer\s*\(/);
    expect(mockSource).not.toMatch(/StdioClientTransport|SSEClientTransport|spawn\(|execFile\(|OPENAI_API_KEY|ANTHROPIC_API_KEY|fetch\(["']https?:/);

    const runtimeSource = readFileSync(resolve(root, "src", "runtime.ts"), "utf-8");
    expect(runtimeSource).not.toMatch(/from ["']@apnex\/(?:cognitive-layer|message-router)["']/);

    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
    expect(pkg.dependencies["@apnex/network-adapter"]).toBeDefined();
    expect(pkg.dependencies["@apnex/cognitive-layer"]).toBeUndefined();
    expect(pkg.dependencies["@apnex/message-router"]).toBeUndefined();

    const lock = JSON.parse(readFileSync(resolve(repoRoot, "package-lock.json"), "utf-8"));
    const lockDeps = lock.packages?.["adapters/opencode-plugin"]?.dependencies ?? {};
    expect(lockDeps["@apnex/network-adapter"]).toBeDefined();
    expect(lockDeps["@apnex/cognitive-layer"]).toBeUndefined();
    expect(lockDeps["@apnex/message-router"]).toBeUndefined();
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

function extractPromptText(request: unknown): string {
  const body = (request as { body?: { parts?: Array<{ text?: string }> } }).body;
  const text = body?.parts?.map((part) => part.text ?? "").join("\n");
  if (!text) throw new Error("promptAsync request did not include text parts");
  return text;
}
