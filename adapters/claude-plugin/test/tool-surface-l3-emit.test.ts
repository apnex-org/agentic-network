/**
 * tool-surface-l3-emit.test.ts — Arc-1 S2b (idea-456), L3 host boundary for the
 * INCIDENT host (Claude Code).
 *
 * The S2b oracle (network-adapter/test/tool-surface-oracle-s2b) proves the
 * reconciler→emit contract against a real hub-ETag delta; the opencode-plugin
 * reconciler test proves opencode's shim fan-out. This closes the remaining
 * link: that the claude-plugin PRODUCTION runtime wiring
 * (`emitListChanged` closure → `mcpServer.sendToolListChanged()`, runtime.ts)
 * actually delivers `notifications/tools/list_changed` to a CONNECTED MCP
 * client — end-to-end, over a real transport. Claude Code was the incident
 * host, so its L3 is the one that most matters.
 *
 * Driven via the in-repo force-emit entrypoint (the deterministic trigger) so
 * no staged /health revision flip is needed.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { parseHarnessManifest, type McpAgentClient } from "@apnex/network-adapter";
import { createClaudeRuntime } from "../src/runtime.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = parseHarnessManifest(
  JSON.parse(readFileSync(resolve(root, "agent-adapter.manifest.json"), "utf-8")),
);

function fakeAgent(): McpAgentClient {
  return {
    isConnected: true,
    setCallbacks: vi.fn(),
    listTools: vi.fn(async () => [
      { name: "get_agents", description: "[Any] x", inputSchema: { type: "object" } },
    ]),
    call: vi.fn(async () => ({ ok: true })),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as McpAgentClient;
}

describe("S2b L3 — claude-plugin runtime emit reaches a connected MCP client", () => {
  let tmp: string | null = null;
  let client: Client | null = null;

  afterEach(async () => {
    try { await client?.close(); } catch { /* ignore */ }
    client = null;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  async function buildRuntime() {
    tmp = mkdtempSync(join(tmpdir(), "claude-l3-emit-"));
    const logs: string[] = [];
    const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
    const runtime = await createClaudeRuntime({
      agent: fakeAgent(),
      mcpTransport: serverTx,
      manifest,
      proxyVersion: "l3-emit-test-1.0.0",
      workDir: tmp,
      role: "engineer",
      log: (m: string) => { logs.push(m); },
      notificationLogPath: join(tmp, "notifications.log"),
      listToolsGate: Promise.resolve(),
      callToolGate: Promise.resolve(),
      identityReady: new Promise<void>(() => { /* no identity reconcile in this unit */ }),
      getIsIdentityReady: () => true,
      getCurrentToolSurfaceRevision: () => "rev-l3",
      fetchLiveToolSurfaceRevision: async () => "rev-l3",
      appendActionableLog: () => {},
    });
    return { runtime, logs, clientTx };
  }

  it("forceEmit → the host receives notifications/tools/list_changed (no restart)", async () => {
    const { runtime, clientTx } = await buildRuntime();

    client = new Client({ name: "l3-emit-test-client", version: "1.0.0" }, { capabilities: {} });
    const received: string[] = [];
    client.setNotificationHandler(ToolListChangedNotificationSchema, (n) => {
      received.push(n.method);
    });
    await client.connect(clientTx);

    // Precondition: the host has NOT been told to re-enumerate yet.
    expect(received).toHaveLength(0);

    // The operator escape-hatch / deterministic trigger: force a re-enumeration
    // signal without staging a redeploy. This is the exact move that unsticks a
    // stale-vintage session.
    await runtime.reconciler.forceEmit("l3-test");

    // The notification crosses the transport asynchronously — poll briefly.
    for (let i = 0; i < 20 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(received).toContain("notifications/tools/list_changed");
  });

  it("a rejected host send (stale/dying transport) is swallowed non-fatally — never an unhandled rejection", async () => {
    // The S2b failure branch: an already-stale/vintage host whose transport is
    // mid-close rejects sendToolListChanged() ASYNCHRONOUSLY. The reconciler's
    // sync emit-guard cannot catch that — the runtime closure must. Without the
    // .catch, this leaks an unhandled promise rejection even though forceEmit()
    // resolves.
    const { runtime, logs } = await buildRuntime();
    const boom = new Error("host transport closed");
    // Replace the live server method the emit closure calls (same object ref).
    runtime.mcpServer.sendToolListChanged = vi.fn(() => Promise.reject(boom));

    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => { unhandled.push(e); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const forced = await runtime.reconciler.forceEmit("l3-reject-test");
      expect(forced.emitted).toBe(true); // entrypoint still reports success
      // let the rejected microtask settle so a missing .catch would surface.
      await new Promise((r) => setTimeout(r, 15));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(runtime.mcpServer.sendToolListChanged).toHaveBeenCalledTimes(1);
    expect(unhandled).toHaveLength(0); // the .catch swallowed it — nothing escaped
    expect(logs.some((l) => l.includes("sendToolListChanged rejected"))).toBe(true);
  });
});
