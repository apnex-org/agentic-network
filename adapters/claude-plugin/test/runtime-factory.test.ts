import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  parseHarnessManifest,
  type McpAgentClient,
} from "@apnex/network-adapter";
import { createClaudeRuntime } from "../src/runtime.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = parseHarnessManifest(
  JSON.parse(readFileSync(resolve(root, "agent-adapter.manifest.json"), "utf-8")),
);

describe("claude runtime factory", () => {
  let tmp: string | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    try { await client?.close(); } catch { /* ignore */ }
    client = null;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("exports a driveable production runtime seam over MCP initialize/listTools/callTool", async () => {
    tmp = mkdtempSync(join(tmpdir(), "claude-runtime-factory-"));
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const agent = {
      isConnected: true,
      setCallbacks: vi.fn(),
      listTools: vi.fn(async () => [
        { name: "list_tele", description: "[Any] list tele", inputSchema: { type: "object" } },
      ]),
      call: vi.fn(async (tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args });
        if (tool === "signal_working_started" || tool === "signal_working_completed") return { ok: true };
        return { ok: true, tool, args };
      }),
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as McpAgentClient;

    const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
    const runtime = await createClaudeRuntime({
      agent,
      mcpTransport: serverTx,
      manifest,
      proxyVersion: "runtime-test-1.0.0",
      workDir: tmp,
      role: "engineer",
      log: () => {},
      notificationLogPath: join(tmp, "notifications.log"),
      listToolsGate: Promise.resolve(),
      callToolGate: Promise.resolve(),
      identityReady: new Promise<void>(() => { /* unresolved: no identity reconcile in this unit */ }),
      getIsIdentityReady: () => true,
      getCurrentToolSurfaceRevision: () => "rev-runtime-test",
      fetchLiveToolSurfaceRevision: async () => "rev-runtime-test",
      appendActionableLog: () => {},
    });

    expect(runtime.dispatcher).toBeDefined();
    expect(runtime.mcpServer).toBeDefined();
    expect(runtime.reconciler).toBeDefined();
    expect(agent.setCallbacks).toHaveBeenCalledWith(runtime.dispatcher.callbacks);

    client = new Client(
      { name: "runtime-factory-test-client", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(clientTx);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(["list_tele"]);
    expect(agent.listTools).toHaveBeenCalledOnce();

    const result = await client.callTool({ name: "list_tele", arguments: { limit: 1 } });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    const text = (result as { content: Array<{ text: string }> }).content[0].text;
    expect(JSON.parse(text)).toMatchObject({ ok: true, tool: "list_tele", args: { limit: 1 } });
    expect(calls.map((c) => c.tool)).toContain("signal_working_started");
    expect(calls.map((c) => c.tool)).toContain("list_tele");
    expect(calls.map((c) => c.tool)).toContain("signal_working_completed");
  });

  it("production shim delegates dispatcher/server/reconciler wiring to the runtime factory", () => {
    const shimSource = readFileSync(resolve(root, "src", "shim.ts"), "utf-8");
    expect(shimSource).toContain("from \"./runtime.js\"");
    expect(shimSource).toContain("await createClaudeRuntime({");
    // Guard against regressing back to the false-green shape where shim.ts and
    // tests each inline their own createSharedDispatcher wiring.
    expect(shimSource).not.toContain("const dispatcher = createSharedDispatcher({");
  });
});
