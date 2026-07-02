/**
 * bug-114-fallback-gap regression tests.
 *
 * Pins the ListTools handler's response contract when the bootstrap
 * path fires with an unusable agent (transport not yet connected /
 * identity not asserted). Pre-fix the handler silently returned
 * `{ tools: [] }`, which Claude Code caches as the authoritative
 * tool surface for the session — invisible comms-loss across the
 * agent population on every cold-start after a CATALOG_SCHEMA_VERSION
 * bump.
 *
 * The post-fix contract:
 *   1. The handler MUST NOT silently return an empty tool-list when
 *      the agent is not yet usable. It either retries briefly (race
 *      window narrow) and surfaces an error to the host.
 *   2. Every bootstrap-path exit emits a structured telemetry log:
 *      `[ListTools] bootstrap completed: N tools surfaced` so silent
 *      zero-returns become architecturally impossible.
 *   3. `persistCatalog` is NEVER called with an empty tool array —
 *      prevents poisoning the on-disk cache.
 */

import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSharedDispatcher,
  type McpAgentClient,
} from "../../src/index.js";
import {
  readCache,
  cachePathFor,
} from "../../src/tool-manager/catalog/tool-catalog-cache.js";

function notConnectedAgent(): McpAgentClient {
  return {
    call: vi.fn().mockResolvedValue("ok"),
    listTools: vi.fn().mockResolvedValue([]),
    setCallbacks: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: false,
  } as unknown as McpAgentClient;
}

function connectedAgentWith(tools: unknown[]): McpAgentClient {
  return {
    call: vi.fn().mockResolvedValue("ok"),
    listTools: vi.fn().mockResolvedValue(tools),
    setCallbacks: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: true,
  } as unknown as McpAgentClient;
}

const sampleTool = {
  name: "tool_a",
  description: "Sample tool",
  inputSchema: { type: "object", properties: {} },
};

async function makeClient(server: ReturnType<ReturnType<typeof createSharedDispatcher>["createMcpServer"]>): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(clientTransport);
  return client;
}

describe("ListTools — bug-114 fallback-gap (bootstrap path with unusable agent)", () => {
  it("does NOT silently return tools=[] when agent is not yet usable", async () => {
    let agentRef: McpAgentClient | null = notConnectedAgent();
    const dispatcher = createSharedDispatcher({
      getAgent: () => agentRef,
      proxyVersion: "test-1.0.0",
    });
    const server = dispatcher.createMcpServer();
    const client = await makeClient(server);

    // Pre-fix this resolved silently with { tools: [] }. Post-fix it
    // must surface an error to the host (either thrown McpError or a
    // documented retry-then-error pattern).
    await expect(client.listTools()).rejects.toThrow(/not ready|not connected|adapter/i);
  });

  it("succeeds when the agent becomes usable during the retry window", async () => {
    let agent: McpAgentClient = notConnectedAgent();
    const dispatcher = createSharedDispatcher({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
    });
    const server = dispatcher.createMcpServer();
    const client = await makeClient(server);

    // Flip to usable after a short delay (within the retry window).
    setTimeout(() => {
      agent = connectedAgentWith([sampleTool]);
    }, 100);

    const result = await client.listTools();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("tool_a");
  });

  it("emits bootstrap-completed telemetry with tool count on success", async () => {
    const logged: string[] = [];
    const dispatcher = createSharedDispatcher({
      getAgent: () => connectedAgentWith([sampleTool, sampleTool]),
      proxyVersion: "test-1.0.0",
      log: (m) => logged.push(m),
    });
    const server = dispatcher.createMcpServer();
    const client = await makeClient(server);

    await client.listTools();

    const exitLog = logged.find((m) => /\[ListTools\] bootstrap completed/.test(m));
    expect(exitLog).toBeDefined();
    expect(exitLog).toMatch(/2 tools/);
  });

  it("does NOT call persistCatalog when bootstrap returns zero tools", async () => {
    const persistCatalog = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => connectedAgentWith([]),
      proxyVersion: "test-1.0.0",
      persistCatalog,
    });
    const server = dispatcher.createMcpServer();
    const client = await makeClient(server);

    await client.listTools();

    expect(persistCatalog).not.toHaveBeenCalled();
  });

  it("calls persistCatalog when bootstrap returns >0 tools", async () => {
    const persistCatalog = vi.fn();
    const dispatcher = createSharedDispatcher({
      getAgent: () => connectedAgentWith([sampleTool]),
      proxyVersion: "test-1.0.0",
      persistCatalog,
    });
    const server = dispatcher.createMcpServer();
    const client = await makeClient(server);

    await client.listTools();

    expect(persistCatalog).toHaveBeenCalledOnce();
    expect(persistCatalog).toHaveBeenCalledWith([sampleTool]);
  });
});

describe("tool-catalog-cache.readCache — bug-114 stale-file self-heal", () => {
  it("unlinks the cache file on schema-version mismatch", () => {
    const workDir = mkdtempSync(join(tmpdir(), "tool-catalog-cache-test-"));
    try {
      const cachePath = cachePathFor(workDir);
      mkdirSync(join(workDir, ".ois"), { recursive: true });
      // Write a v1-shape cache file (simulating pre-bump state).
      writeFileSync(
        cachePath,
        JSON.stringify({
          schemaVersion: 1,
          hubVersion: "1.0.0",
          fetchedAt: "2026-05-20T00:00:00.000Z",
          catalog: [],
        }),
        { encoding: "utf8" },
      );
      expect(existsSync(cachePath)).toBe(true);

      const result = readCache(workDir);

      expect(result).toBeNull();
      expect(existsSync(cachePath)).toBe(false);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("returns null without unlinking when file is missing", () => {
    const workDir = mkdtempSync(join(tmpdir(), "tool-catalog-cache-test-"));
    try {
      const result = readCache(workDir);
      expect(result).toBeNull();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
