/**
 * tool-surface-propagation-conformance.test.ts — mission-106 CONFORMANCE
 * (work-bp-m106_reconcile-conformance / steve's D4 in-process gate).
 *
 * The WARM-CACHE + SURFACE-CHANGE regression, END-TO-END + IN-PROCESS: a REAL
 * on-disk cache file (temp .ois) + the REAL ToolSurfaceReconciler + the REAL
 * dispatcher ListTools serve path. Proves a stale cached surface CONVERGES to
 * the live surface and a newly-registered verb becomes REACHABLE — the
 * next-enumeration guarantee (clauses 1+2), host-behavior-INDEPENDENT. A
 * cold-start-only test would miss exactly this bug (an empty .ois bootstraps
 * live trivially; the frozen-catalog defect only bites a WARM stale cache).
 *
 * NOT covered here (by design — D4 split): whether a LIVE host re-enumerates on
 * notifications/tools/list_changed WITHOUT a restart. That is T2, a separate
 * throwaway-ois host-characterization run against the DEPLOYED fix, and it
 * decides only the F2 live-host ASPIRATION — never this guaranteed floor.
 */
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSharedDispatcher, type McpAgentClient } from "../src/index.js";
import {
  readCache,
  writeCache,
  isCacheValid,
} from "../src/tool-manager/catalog/tool-catalog-cache.js";
import { ToolSurfaceReconciler } from "../src/tool-manager/catalog/tool-surface-reconciler.js";

const STALE_REV = "rev-stale-0000";
const LIVE_REV = "rev-live-1111";
const tool = (name: string, desc: string) => ({
  name,
  description: desc,
  inputSchema: { type: "object", properties: {} },
});
// The STALE surface is MISSING the newly-registered verb (the update_work analog).
const STALE_CATALOG = [tool("old_verb", "[Any] pre-change")];
const LIVE_CATALOG = [
  tool("old_verb", "[Any] pre-change"),
  tool("update_work", "[Any] the newly-registered verb"),
];
const hasVerb = (tools: unknown[], name: string) =>
  tools.some((t) => (t as { name?: string }).name === name);

function liveAgent(tools: unknown[]): McpAgentClient {
  return {
    call: async () => "ok",
    listTools: async () => tools,
    setCallbacks: () => {},
    start: () => {},
    stop: () => {},
    isConnected: true,
  } as unknown as McpAgentClient;
}

async function connectClient(
  server: ReturnType<ReturnType<typeof createSharedDispatcher>["createMcpServer"]>,
): Promise<Client> {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "conformance-client", version: "0.0.0" }, { capabilities: {} });
  await client.connect(ct);
  return client;
}

describe("mission-106 conformance — warm-cache + surface-change propagation (in-process e2e)", () => {
  it("a stale warm cache CONVERGES to the live surface via reconcile; the new verb becomes reachable (no restart)", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "m106-conformance-"));
    try {
      // 1. Seed a STALE cache file — the frozen surface, missing update_work.
      expect(writeCache(workDir, STALE_CATALOG, STALE_REV)).toBe(true);
      expect(readCache(workDir)?.toolSurfaceRevision).toBe(STALE_REV);
      expect(hasVerb(readCache(workDir)!.catalog, "update_work")).toBe(false); // regression baseline: ABSENT

      // 2. The hub surface CHANGED (new verb registered) → live rev + catalog advance.
      const agent = liveAgent(LIVE_CATALOG);

      // 3. A stale warm cache is NEVER "valid" — not vs the live rev (mismatch),
      // not vs a null rev (F4 fail-closed). The serve path is a labeled-stale
      // fallback, never a silent valid serve.
      expect(isCacheValid(readCache(workDir)!, LIVE_REV)).toBe(false);
      expect(isCacheValid(readCache(workDir)!, null)).toBe(false);

      // 4. REPAIR: one reconcile pass rewrites the on-disk cache to the live
      // surface (revision resolved first → catalog+revision written coherently).
      const reconciler = new ToolSurfaceReconciler({
        fetchLiveRevision: async () => LIVE_REV,
        readServedRevision: () => readCache(workDir)?.toolSurfaceRevision ?? null,
        fetchLiveCatalog: () => agent.listTools(),
        writeServedCatalog: (catalog, rev) => writeCache(workDir, catalog as unknown[], rev),
        emitListChanged: () => {},
      });
      const out = await reconciler.reconcile("conformance");
      expect(out.repaired).toBe(true);
      expect(out.converged).toBe(true);

      // 5. The on-disk cache now serves the LIVE surface — registered ⇒ reachable.
      const repaired = readCache(workDir)!;
      expect(repaired.toolSurfaceRevision).toBe(LIVE_REV);
      expect(hasVerb(repaired.catalog, "update_work")).toBe(true);

      // 6. A subsequent dispatcher ListTools serves the FRESH surface on BOTH the
      // pre-identity (repaired cache now valid) and identity-ready (live bootstrap)
      // paths — the new verb is reachable either way.
      const dispPre = createSharedDispatcher({
        getAgent: () => agent,
        proxyVersion: "test-1.0.0",
        getCachedCatalog: () => readCache(workDir),
        getIsIdentityReady: () => false,
        getCurrentToolSurfaceRevision: () => LIVE_REV,
        isCacheValid,
      });
      const pre = await (await connectClient(dispPre.createMcpServer())).listTools();
      expect(hasVerb(pre.tools, "update_work")).toBe(true);

      const dispReady = createSharedDispatcher({
        getAgent: () => agent,
        proxyVersion: "test-1.0.0",
        getCachedCatalog: () => readCache(workDir),
        getIsIdentityReady: () => true,
        getCurrentToolSurfaceRevision: () => LIVE_REV,
        isCacheValid,
      });
      const ready = await (await connectClient(dispReady.createMcpServer())).listTools();
      expect(hasVerb(ready.tools, "update_work")).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("regression witness: a stale warm cache served pre-identity WITHOUT repair still hides the new verb (why disk-repair is mandatory — a restart re-reads the same frozen disk)", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "m106-conformance-neg-"));
    try {
      writeCache(workDir, STALE_CATALOG, STALE_REV);
      const dispatcher = createSharedDispatcher({
        getAgent: () => liveAgent(LIVE_CATALOG),
        proxyVersion: "test-1.0.0",
        getCachedCatalog: () => readCache(workDir),
        getIsIdentityReady: () => false, // pre-identity probe
        getCurrentToolSurfaceRevision: () => null, // /health unresolved — the startup race
        isCacheValid,
        // no scheduleRepair / no reconcile → the serve path alone cannot fix it
      });
      const listed = await (await connectClient(dispatcher.createMcpServer())).listTools();
      // Labeled-stale serve (F4): the stale cache is served THIS probe — update_work absent.
      expect(hasVerb(listed.tools, "update_work")).toBe(false);
      // And the disk is STILL stale — a restart would re-serve exactly this. Only the
      // out-of-band reconciler repair (test above) converges it.
      expect(readCache(workDir)?.toolSurfaceRevision).toBe(STALE_REV);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
