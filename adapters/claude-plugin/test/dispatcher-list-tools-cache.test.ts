/**
 * Dispatcher integration tests for the cache fallback in ListTools.
 *
 * Pins the load-bearing tool-catalog cache contracts at the shared
 * dispatcher layer:
 *   - cached-catalog served when identityReady unresolved + cache valid
 *   - bootstrap-on-cache-miss falls through to live agent.listTools
 *   - cache stale (Hub version mismatch) → re-bootstrap
 *   - identityReady resolved → live path (cache fallback skipped)
 *   - persistCatalog hook called on live fetch
 *   - persistCatalog hook NEVER throws even when caller's persist throws
 *   - all-cache-callbacks-omitted = live-only behavior preserved
 */

import { describe, it, expect, vi } from "vitest";
import {
  createSharedDispatcher,
  isCacheValid,
  CATALOG_SCHEMA_VERSION,
  type CachedCatalog,
  type McpAgentClient,
  type SharedDispatcherOptions,
} from "@ois/network-adapter";

function fakeAgent(): McpAgentClient {
  return {
    call: vi.fn().mockResolvedValue("ok"),
    listTools: vi.fn().mockResolvedValue([]),
    getTransport: vi.fn().mockReturnValue({ listToolsRaw: vi.fn().mockResolvedValue([]) }),
    setCallbacks: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    isConnected: true,
  } as unknown as McpAgentClient;
}

function makeListToolsHandler(opts: SharedDispatcherOptions) {
  const dispatcher = createSharedDispatcher(opts);
  const server = dispatcher.createMcpServer();
  const handlers = (server as unknown as {
    _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
  })._requestHandlers;
  const handler = handlers.get("tools/list");
  if (!handler) throw new Error("tools/list handler not registered");
  return { handler, dispatcher };
}

const LIVE_CATALOG = [{ name: "live_tool", description: "[Any] live" }];
const CACHED_CATALOG = [{ name: "cached_tool", description: "[Any] from cache" }];
const CACHED: CachedCatalog = {
  schemaVersion: CATALOG_SCHEMA_VERSION,
  hubVersion: "1.0.0",
  fetchedAt: "2026-04-22T05:00:00.000Z",
  catalog: CACHED_CATALOG,
};

describe("dispatcher cache fallback — ListTools", () => {
  it("serves from cache when identityReady unresolved AND cache valid", async () => {
    const agent = fakeAgent();
    (agent.listTools as ReturnType<typeof vi.fn>).mockResolvedValue(LIVE_CATALOG);
    const log: string[] = [];

    const { handler } = makeListToolsHandler({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      log: (m) => log.push(m),
      getCachedCatalog: () => CACHED,
      getIsIdentityReady: () => false,    // probe scenario
      getCurrentHubVersion: () => "1.0.0", // matches cache
      isCacheValid,
      persistCatalog: vi.fn(),
    });

    const result = await handler({ method: "tools/list", params: {} });
    expect(result).toEqual({ tools: CACHED_CATALOG });
    // Live fetch NOT called.
    expect(agent.listTools).not.toHaveBeenCalled();
    expect(log.some((l) => l.includes("served from cache"))).toBe(true);
  });

  it("bootstraps from Hub when identityReady unresolved AND no cache (fresh install)", async () => {
    const agent = fakeAgent();
    (agent.listTools as ReturnType<typeof vi.fn>).mockResolvedValue(LIVE_CATALOG);
    const persist = vi.fn();
    const log: string[] = [];
    let identityReadyResolved = false;

    let resolveHandshake!: () => void;
    const listToolsGate = new Promise<void>((res) => { resolveHandshake = res; });
    listToolsGate.then(() => { identityReadyResolved = true; });

    const { handler } = makeListToolsHandler({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      log: (m) => log.push(m),
      listToolsGate,
      getCachedCatalog: () => null,                       // fresh install
      getIsIdentityReady: () => identityReadyResolved,
      getCurrentHubVersion: () => "1.0.0",
      isCacheValid,
      persistCatalog: persist,
    });

    queueMicrotask(() => resolveHandshake());
    const result = await handler({ method: "tools/list", params: {} });

    expect(result).toEqual({ tools: LIVE_CATALOG });
    expect(agent.listTools).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(LIVE_CATALOG);
    expect(log.some((l) => l.includes("no cache"))).toBe(true);
  });

  it("re-bootstraps when cache is stale (Hub version mismatch)", async () => {
    const agent = fakeAgent();
    (agent.listTools as ReturnType<typeof vi.fn>).mockResolvedValue(LIVE_CATALOG);
    const persist = vi.fn();
    const log: string[] = [];

    let resolveHandshake!: () => void;
    const listToolsGate = new Promise<void>((res) => { resolveHandshake = res; });

    const { handler } = makeListToolsHandler({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      log: (m) => log.push(m),
      listToolsGate,
      getCachedCatalog: () => CACHED,             // hubVersion=1.0.0
      getIsIdentityReady: () => false,
      getCurrentHubVersion: () => "2.0.0",        // current is newer → stale
      isCacheValid,
      persistCatalog: persist,
    });

    queueMicrotask(() => resolveHandshake());
    const result = await handler({ method: "tools/list", params: {} });

    expect(result).toEqual({ tools: LIVE_CATALOG });
    expect(agent.listTools).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(LIVE_CATALOG);
    expect(log.some((l) => l.includes("cache stale") && l.includes("1.0.0") && l.includes("2.0.0"))).toBe(true);
  });

  it("cached path skipped when identityReady is resolved (live session — always live fetch)", async () => {
    const agent = fakeAgent();
    (agent.listTools as ReturnType<typeof vi.fn>).mockResolvedValue(LIVE_CATALOG);
    const persist = vi.fn();

    const { handler } = makeListToolsHandler({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      listToolsGate: Promise.resolve(),       // already resolved
      getCachedCatalog: () => CACHED,         // cache exists
      getIsIdentityReady: () => true,         // identity ready → skip cache fallback
      getCurrentHubVersion: () => "1.0.0",
      isCacheValid,
      persistCatalog: persist,
    });

    const result = await handler({ method: "tools/list", params: {} });
    expect(result).toEqual({ tools: LIVE_CATALOG });
    expect(agent.listTools).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(LIVE_CATALOG);
  });

  it("persistCatalog throwing does NOT propagate as a ListTools error (best-effort)", async () => {
    const agent = fakeAgent();
    (agent.listTools as ReturnType<typeof vi.fn>).mockResolvedValue(LIVE_CATALOG);
    const log: string[] = [];

    const { handler } = makeListToolsHandler({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      log: (m) => log.push(m),
      listToolsGate: Promise.resolve(),
      getCachedCatalog: () => null,
      getIsIdentityReady: () => true,
      getCurrentHubVersion: () => "1.0.0",
      isCacheValid,
      persistCatalog: () => { throw new Error("disk full"); },
    });

    const result = await handler({ method: "tools/list", params: {} });
    expect(result).toEqual({ tools: LIVE_CATALOG });
    expect(log.some((l) => l.includes("persistCatalog hook threw"))).toBe(true);
  });

  it("trusts cache (probe-friendly) when currentHubVersion is null — fast probe path preserved", async () => {
    const agent = fakeAgent();
    const log: string[] = [];

    const { handler } = makeListToolsHandler({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      log: (m) => log.push(m),
      getCachedCatalog: () => CACHED,
      getIsIdentityReady: () => false,
      getCurrentHubVersion: () => null,    // /health fetch in flight
      isCacheValid,
      persistCatalog: vi.fn(),
    });

    const result = await handler({ method: "tools/list", params: {} });
    expect(result).toEqual({ tools: CACHED_CATALOG });
    expect(agent.listTools).not.toHaveBeenCalled();
  });

  it("no-cache-callbacks: ListTools falls through to live fetch only", async () => {
    const agent = fakeAgent();
    (agent.listTools as ReturnType<typeof vi.fn>).mockResolvedValue(LIVE_CATALOG);

    const { handler } = makeListToolsHandler({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      listToolsGate: Promise.resolve(),
      // No cache callbacks — back-compat with all existing tests.
    });

    const result = await handler({ method: "tools/list", params: {} });
    expect(result).toEqual({ tools: LIVE_CATALOG });
    expect(agent.listTools).toHaveBeenCalledOnce();
  });
});
