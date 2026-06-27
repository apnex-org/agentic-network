/**
 * health-revision.ts — the Hub /health `toolSurfaceRevision` fetcher,
 * hoisted to the kernel (idea-355 SLICE-1T).
 *
 * This is the network mechanism the bug-180 `ToolSurfaceReconciler` injects as
 * its `fetchLiveRevision` dependency: resolve the Hub's live tool-surface
 * revision (an opaque ETag served on /health since bug-114) over plain HTTP,
 * independent of the MCP transport.
 *
 * Previously this lived inline in each shim (the claude shim's
 * `fetchLiveToolSurfaceRevision`). Hoisting it single-homes the network
 * mechanism so both shims share ONE implementation. The factory is PURE — it
 * holds no module state and carries NO cache side-effect: callers that want a
 * cached-revision marker (the claude shim's `cachedToolSurfaceRevision`) wrap
 * the returned function and apply the side-effect on a non-null result.
 *
 * Contract:
 *   - derive `healthUrl` by replacing a trailing `/mcp` (optionally with a
 *     further path) on `hubUrl` with `/health`;
 *   - fetch it (global `fetch` only — opencode bundles via esbuild with no
 *     node_modules, so no node-fetch/undici);
 *   - return `json.toolSurfaceRevision` when it is a non-empty string;
 *   - return null on `!res.ok`, a missing/empty/non-string field, or any throw
 *     (never reject — the reconciler treats null as "unknown, trust the cache"
 *     and never emits a spurious list_changed).
 */

export interface FetchLiveToolSurfaceRevisionOptions {
  /** The Hub MCP URL (…/mcp). The /health URL is derived from it. */
  hubUrl: string;
  /**
   * Fetch implementation. Defaults to the global `fetch`. Injectable so the
   * factory is unit-testable without a live Hub.
   */
  fetch?: typeof globalThis.fetch;
  /** Diagnostic logger. No-op default. */
  log?: (msg: string) => void;
}

/**
 * Build a pure `fetchLiveRevision` function for the bug-180
 * `ToolSurfaceReconciler`. Resolves the Hub's live /health
 * `toolSurfaceRevision`, or null on any failure (never rejects).
 */
export function makeFetchLiveToolSurfaceRevision(
  opts: FetchLiveToolSurfaceRevisionOptions,
): () => Promise<string | null> {
  const log = opts.log ?? (() => {});
  const doFetch = opts.fetch ?? globalThis.fetch;
  const healthUrl = opts.hubUrl.replace(/\/mcp(\/.*)?$/, "/health");

  return async (): Promise<string | null> => {
    try {
      const res = await doFetch(healthUrl);
      if (!res.ok) {
        log(
          `[Cache] /health fetch returned status ${res.status} — cache invalidation will trust existing cache`,
        );
        return null;
      }
      const json = (await res.json()) as {
        version?: unknown;
        toolSurfaceRevision?: unknown;
      };
      if (typeof json.version === "string") {
        log(`[Cache] Hub version: ${json.version}`);
      }
      if (
        typeof json.toolSurfaceRevision === "string" &&
        json.toolSurfaceRevision !== ""
      ) {
        log(`[Cache] Tool-surface revision resolved: ${json.toolSurfaceRevision}`);
        return json.toolSurfaceRevision;
      }
      log(
        `[Cache] /health returned no toolSurfaceRevision field — cache invalidation will trust existing cache`,
      );
      return null;
    } catch (err) {
      log(`[Cache] /health fetch failed (non-fatal): ${(err as Error)?.message ?? String(err)}`);
      return null;
    }
  };
}
