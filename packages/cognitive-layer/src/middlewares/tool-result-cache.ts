/**
 * ToolResultCache middleware (ADR-018).
 *
 * Per-session LRU+TTL cache for idempotent read tools. When the LLM
 * re-fetches the same state within a turn (e.g., `get_thread`, `list_tele`),
 * subsequent calls short-circuit without a Hub round-trip.
 *
 * Key invariants:
 *   - INV-COG-5: distinct from WriteCallDedup (different TTL, read
 *     tools only, cross-call cache vs. in-flight idempotency).
 *   - INV-COG-7: scope strictly per-session. One agent's writes never
 *     invalidate another agent's cache. Cross-session invalidation
 *     signals are out of scope in Phase 1.
 *   - INV-COG-4: InvalidationStrategy interface is the Phase 2
 *     extension seam. Phase 1 ships `FlushAllOnWriteStrategy`
 *     (safe conservative default); `StaleWhileRevalidateStrategy`
 *     and Hub-declared granular matrices land later without
 *     touching the cache primitive.
 */

import type {
  CognitiveMiddleware,
  ToolCallContext,
} from "../contract.js";

// ── Strategy contract ───────────────────────────────────────────────

export interface CacheKey {
  readonly tool: string;
  readonly argsHash: string;
  readonly sessionId: string;
}

export type InvalidationDirective =
  | { kind: "none" }
  | { kind: "flush-session" }
  | { kind: "flush-keys"; keys: readonly CacheKey[] };

export interface InvalidationStrategy {
  /**
   * Invoked on every tool call BEFORE the cache lookup and BEFORE
   * next(). Return the directive to apply to the session's cache
   * view prior to serving cached reads.
   */
  onWrite(
    tool: string,
    args: Record<string, unknown>,
    sessionId: string,
  ): InvalidationDirective;

  /**
   * Phase 2 extension hook: called on a cache hit whose entry is
   * older than `ttlMs` but still live (stale-while-revalidate).
   * Returning a Promise opts into background revalidation while
   * serving the stale value. Phase 1 implementations may omit; the
   * cache treats omission as "expire on TTL boundary".
   */
  onStaleRead?(
    key: CacheKey,
    staleValue: unknown,
  ): Promise<unknown> | null;
}

/**
 * Phase 1 default strategy. Any write-verb tool flushes the entire
 * session's cache. Safe + simple. Ignores args.
 */
export class FlushAllOnWriteStrategy implements InvalidationStrategy {
  private readonly isWriteTool: (tool: string) => boolean;

  constructor(opts: { isWriteTool?: (tool: string) => boolean } = {}) {
    this.isWriteTool = opts.isWriteTool ?? defaultIsWriteTool;
  }

  onWrite(tool: string): InvalidationDirective {
    return this.isWriteTool(tool) ? { kind: "flush-session" } : { kind: "none" };
  }
}

// ── Config + middleware ─────────────────────────────────────────────

export interface ToolResultCacheConfig {
  /** TTL per entry in ms. Default: 30_000. */
  ttlMs?: number;
  /** Max entries per session (LRU cap). Default: 500. */
  maxEntries?: number;
  /** Cacheable-tool predicate. Default: read-verb prefixes. */
  cacheable?: (tool: string) => boolean;
  /** Invalidation strategy. Default: FlushAllOnWriteStrategy. */
  invalidationStrategy?: InvalidationStrategy;
  /** Custom key derivation. Default: canonicalized args hash. */
  argsHasher?: (args: Record<string, unknown>) => string;
  /** Clock override for tests. */
  now?: () => number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 500;

function defaultIsWriteTool(tool: string): boolean {
  return (
    tool.startsWith("create_") ||
    tool.startsWith("update_") ||
    tool.startsWith("close_") ||
    tool.startsWith("resolve_") ||
    tool.startsWith("delete_") ||
    tool.startsWith("register_") ||
    tool.startsWith("acknowledge_") ||
    tool.startsWith("migrate_") ||
    tool.startsWith("propose_") ||
    tool.startsWith("drain_") ||
    tool.startsWith("leave_") ||
    tool.startsWith("cancel_")
  );
}

function defaultIsCacheable(tool: string): boolean {
  return tool.startsWith("get_") || tool.startsWith("list_");
}

/**
 * Canonicalize-and-hash args for stable cache keys. FNV-1a over
 * recursively-sorted JSON, matching the WriteCallDedup hasher.
 */
function hashArgs(args: Record<string, unknown>): string {
  const canonical = canonicalize(args);
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(36);
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    "{" +
    entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",") +
    "}"
  );
}

interface CacheEntry {
  value: unknown;
  storedAt: number;
}

export class ToolResultCache implements CognitiveMiddleware {
  readonly name = "ToolResultCache";

  // Per-session LRU. JS Map preserves insertion order; we touch on
  // hit via delete+re-insert to maintain LRU semantics.
  private readonly sessionCaches = new Map<string, Map<string, CacheEntry>>();

  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly cacheable: (tool: string) => boolean;
  private readonly strategy: InvalidationStrategy;
  private readonly argsHasher: (args: Record<string, unknown>) => string;
  private readonly now: () => number;

  constructor(config: ToolResultCacheConfig = {}) {
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.cacheable = config.cacheable ?? defaultIsCacheable;
    this.strategy = config.invalidationStrategy ?? new FlushAllOnWriteStrategy();
    this.argsHasher = config.argsHasher ?? hashArgs;
    this.now = config.now ?? Date.now;
  }

  async onToolCall(
    ctx: ToolCallContext,
    next: (ctx: ToolCallContext) => Promise<unknown>,
  ): Promise<unknown> {
    // Invalidation pass — applies regardless of cacheable-ness. Runs
    // BEFORE cache lookup so a write tool's flush takes effect before
    // its own execution. Pessimistic (flush even on failed writes) —
    // trade-off documented in ADR-018 §Invariants.
    const directive = this.strategy.onWrite(ctx.tool, ctx.args, ctx.sessionId);
    this.applyInvalidation(ctx.sessionId, directive);

    // Non-cacheable tools pass through (writes + unclassified).
    if (!this.cacheable(ctx.tool)) {
      return next(ctx);
    }

    const argsHash = this.argsHasher(ctx.args);
    const key = `${ctx.tool}\u0000${argsHash}`;
    const cache = this.getOrCreateSessionCache(ctx.sessionId);
    const entry = cache.get(key);
    const nowMs = this.now();

    if (entry && nowMs - entry.storedAt < this.ttlMs) {
      // Cache hit — LRU touch (move to end) + short-circuit.
      cache.delete(key);
      cache.set(key, entry);
      ctx.tags.cacheHit = "true";
      return entry.value;
    }

    ctx.tags.cacheHit = "false";
    const result = await next(ctx);
    this.store(cache, key, result, nowMs);
    return result;
  }

  // ── Diagnostic getters (tests + observability) ────────────────────

  /** Number of cached entries for a given session. */
  getSessionSize(sessionId: string): number {
    return this.sessionCaches.get(sessionId)?.size ?? 0;
  }

  /** Total sessions with cache entries. */
  getActiveSessionCount(): number {
    return this.sessionCaches.size;
  }

  /** Clear all session caches (useful for test teardown). */
  clearAll(): void {
    this.sessionCaches.clear();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private getOrCreateSessionCache(sessionId: string): Map<string, CacheEntry> {
    let cache = this.sessionCaches.get(sessionId);
    if (!cache) {
      cache = new Map();
      this.sessionCaches.set(sessionId, cache);
    }
    return cache;
  }

  private store(
    cache: Map<string, CacheEntry>,
    key: string,
    value: unknown,
    storedAt: number,
  ): void {
    if (!cache.has(key) && cache.size >= this.maxEntries) {
      // Evict LRU (oldest insertion — first key in the map).
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(key, { value, storedAt });
  }

  private applyInvalidation(sessionId: string, directive: InvalidationDirective): void {
    if (directive.kind === "none") return;
    const cache = this.sessionCaches.get(sessionId);
    if (!cache) return;
    if (directive.kind === "flush-session") {
      cache.clear();
      return;
    }
    if (directive.kind === "flush-keys") {
      for (const k of directive.keys) {
        if (k.sessionId !== sessionId) continue; // respect INV-COG-7
        cache.delete(`${k.tool}\u0000${k.argsHash}`);
      }
    }
  }
}
