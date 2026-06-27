/**
 * Dispatcher integration tests for the cache fallback in ListTools.
 *
 * Pins the load-bearing tool-catalog cache contracts at the shared
 * dispatcher layer:
 *   - cached-catalog served when identityReady unresolved + cache valid
 *   - bootstrap-on-cache-miss falls through to live agent.listTools
 *   - cache stale (tool-surface-revision mismatch) → re-bootstrap
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
  ToolSurfaceReconciler,
  type CachedCatalog,
  type McpAgentClient,
  type SharedDispatcherOptions,
} from "@apnex/network-adapter";

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
// bug-114 — the cache is keyed off the Hub's tool-surface revision (an
// opaque ETag), not `hubVersion`.
const REV_CACHED = "aaaa1111bbbb2222";
const REV_CURRENT = "cccc3333dddd4444";
const CACHED: CachedCatalog = {
  schemaVersion: CATALOG_SCHEMA_VERSION,
  toolSurfaceRevision: REV_CACHED,
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
      getCurrentToolSurfaceRevision: () => REV_CACHED, // matches cache
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
      getCurrentToolSurfaceRevision: () => REV_CACHED,
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

  it("re-bootstraps when cache is stale (tool-surface-revision mismatch)", async () => {
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
      getCachedCatalog: () => CACHED,                       // toolSurfaceRevision=REV_CACHED
      getIsIdentityReady: () => false,
      getCurrentToolSurfaceRevision: () => REV_CURRENT,     // surface changed → stale
      isCacheValid,
      persistCatalog: persist,
    });

    queueMicrotask(() => resolveHandshake());
    const result = await handler({ method: "tools/list", params: {} });

    expect(result).toEqual({ tools: LIVE_CATALOG });
    expect(agent.listTools).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(LIVE_CATALOG);
    expect(log.some((l) => l.includes("cache stale") && l.includes(REV_CACHED) && l.includes(REV_CURRENT))).toBe(true);
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
      getCurrentToolSurfaceRevision: () => REV_CACHED,
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
      getCurrentToolSurfaceRevision: () => REV_CACHED,
      isCacheValid,
      persistCatalog: () => { throw new Error("disk full"); },
    });

    const result = await handler({ method: "tools/list", params: {} });
    expect(result).toEqual({ tools: LIVE_CATALOG });
    expect(log.some((l) => l.includes("persistCatalog hook threw"))).toBe(true);
  });

  it("trusts cache (probe-friendly) when current revision is null — fast probe path preserved", async () => {
    const agent = fakeAgent();
    const log: string[] = [];

    const { handler } = makeListToolsHandler({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      log: (m) => log.push(m),
      getCachedCatalog: () => CACHED,
      getIsIdentityReady: () => false,
      getCurrentToolSurfaceRevision: () => null,    // /health fetch in flight
      isCacheValid,
      persistCatalog: vi.fn(),
    });

    const result = await handler({ method: "tools/list", params: {} });
    expect(result).toEqual({ tools: CACHED_CATALOG });
    expect(agent.listTools).not.toHaveBeenCalled();
  });

  // bug-180 AC4 — the live-refresh fix must NOT regress probe-path latency:
  // a pre-identity probe still serves from the on-disk cache with zero Hub
  // round-trips. A regression that fell through to the live path would both
  // call agent.listTools AND blow the timing budget (the live fetch is
  // deliberately made slow here so the assertion is dispositive).
  it("AC4: pre-identity probe serves from cache with no blocking Hub fetch (latency preserved)", async () => {
    const agent = fakeAgent();
    (agent.listTools as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => setTimeout(() => r(LIVE_CATALOG), 200)),
    );

    const { handler } = makeListToolsHandler({
      getAgent: () => agent,
      proxyVersion: "test-1.0.0",
      getCachedCatalog: () => CACHED,
      getIsIdentityReady: () => false,            // probe scenario
      getCurrentToolSurfaceRevision: () => null,  // /health in flight
      isCacheValid,
      persistCatalog: vi.fn(),
    });

    const start = performance.now();
    const result = await handler({ method: "tools/list", params: {} });
    const elapsed = performance.now() - start;

    expect(result).toEqual({ tools: CACHED_CATALOG });
    expect(agent.listTools).not.toHaveBeenCalled(); // zero Hub round-trips
    expect(elapsed).toBeLessThan(50);               // probe returns fast (< slow live fetch)
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

// bug-180 — tool-surface live-refresh reconciler (L1 identityReady + L2
// PollBackstop-heartbeat triggers share one reconcile()). The shim injects the
// /health fetch, the on-disk-cache read, and the list_changed emit; this suite
// pins the reconcile DECISION + applied-state baseline machinery.
const REV_STALE = "db48a16707617c0f"; // the cached (stale) revision in bug-180
const REV_LIVE = "f96c6bd56a1a0f32"; // the live Hub revision after #361
const REV_NEXT = "aaaa0000bbbb1111"; // a subsequent in-life redeploy

describe("ToolSurfaceReconciler — bug-180 L1/L2 revision reconcile", () => {
  it("AC3: emits list_changed on cached-vs-live drift (db48→f96) and advances the baseline", async () => {
    const emit = vi.fn();
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision: vi.fn().mockResolvedValue(REV_LIVE),
      readServedRevision: () => REV_STALE, // pre-identity probe served the stale cache
      emitListChanged: emit,
    });

    const out = await reconciler.reconcile("identityReady");

    expect(out).toEqual({ emitted: true, live: REV_LIVE });
    expect(emit).toHaveBeenCalledOnce();
    expect(reconciler.getAppliedRevision()).toBe(REV_LIVE);
  });

  it("does NOT emit when the served revision already matches live (no drift)", async () => {
    const emit = vi.fn();
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision: vi.fn().mockResolvedValue(REV_LIVE),
      readServedRevision: () => REV_LIVE,
      emitListChanged: emit,
    });

    const out = await reconciler.reconcile();

    expect(out.emitted).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    expect(reconciler.getAppliedRevision()).toBe(REV_LIVE);
  });

  it("does NOT emit when the live revision is unknown (fetch failed) — cache trusted, no baseline set", async () => {
    const emit = vi.fn();
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision: vi.fn().mockResolvedValue(null),
      readServedRevision: () => REV_STALE,
      emitListChanged: emit,
    });

    const out = await reconciler.reconcile();

    expect(out).toEqual({ emitted: false, live: null });
    expect(emit).not.toHaveBeenCalled();
    // Unknown-live pass establishes no baseline — the next successful pass seeds it.
    expect(reconciler.getAppliedRevision()).toBeNull();
  });

  it("L2: catches an in-life redeploy after a clean baseline (no emit, then emit on change)", async () => {
    const emit = vi.fn();
    const fetchLiveRevision = vi
      .fn()
      .mockResolvedValueOnce(REV_LIVE) // first heartbeat: matches the served baseline
      .mockResolvedValueOnce(REV_NEXT); // redeploy → surface changed
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision,
      readServedRevision: () => REV_LIVE, // host already on live (post-L1 / fresh start)
      emitListChanged: emit,
    });

    const first = await reconciler.reconcile("heartbeat");
    expect(first.emitted).toBe(false);
    expect(emit).not.toHaveBeenCalled();

    const second = await reconciler.reconcile("heartbeat");
    expect(second).toEqual({ emitted: true, live: REV_NEXT });
    expect(emit).toHaveBeenCalledOnce();
    expect(reconciler.getAppliedRevision()).toBe(REV_NEXT);
  });

  it("baseline seeds from the on-disk cache even when L2 (heartbeat) races ahead of L1 — order-independent", async () => {
    const emit = vi.fn();
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision: vi.fn().mockResolvedValue(REV_LIVE),
      readServedRevision: () => REV_STALE,
      emitListChanged: emit,
    });

    // The heartbeat fires before identityReady — still detects db48→f96.
    const out = await reconciler.reconcile("heartbeat");

    expect(out.emitted).toBe(true);
    expect(emit).toHaveBeenCalledOnce();
    expect(reconciler.getAppliedRevision()).toBe(REV_LIVE);
  });

  it("fresh install (no on-disk cache): baselines off live, no emit; later drift emits exactly once", async () => {
    const emit = vi.fn();
    const fetchLiveRevision = vi
      .fn()
      .mockResolvedValueOnce(REV_LIVE)
      .mockResolvedValueOnce(REV_LIVE)
      .mockResolvedValueOnce(REV_NEXT);
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision,
      readServedRevision: () => null, // fresh install bootstrapped live directly
      emitListChanged: emit,
    });

    expect((await reconciler.reconcile()).emitted).toBe(false); // baseline = live
    expect(reconciler.getAppliedRevision()).toBe(REV_LIVE);
    expect((await reconciler.reconcile()).emitted).toBe(false); // unchanged
    expect((await reconciler.reconcile()).emitted).toBe(true); // redeploy
    expect(emit).toHaveBeenCalledOnce();
  });

  it("emitListChanged throwing is swallowed (best-effort) and the baseline still advances", async () => {
    const reconciler = new ToolSurfaceReconciler({
      fetchLiveRevision: vi.fn().mockResolvedValue(REV_LIVE),
      readServedRevision: () => REV_STALE,
      emitListChanged: () => {
        throw new Error("host transport closed");
      },
    });

    const out = await reconciler.reconcile();

    expect(out.emitted).toBe(true);
    // Baseline advances despite the emit throwing — a transient emit failure
    // must not wedge the reconciler into re-emitting every tick.
    expect(reconciler.getAppliedRevision()).toBe(REV_LIVE);
  });
});
