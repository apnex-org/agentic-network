/**
 * WriteCallDedup middleware (ADR-018).
 *
 * Promise-based idempotency for write tools. Protects the Hub from
 * duplicate writes caused by cognitive retries — an LLM re-emitting
 * the same tool call after a transient error no longer hits the Hub
 * twice.
 *
 * State machine per `{tool, args-hash, sessionId}` key (INV-COG-5,
 * INV-COG-8):
 *
 *   IN-FLIGHT  ← first call; Promise stored; TTL timer NOT yet started
 *                 - duplicate awaits the SAME Promise (Promise.race
 *                   against optional `maxInflightMs` timeout)
 *                 - both callers resolve identically at settlement
 *
 *   SETTLED    ← original settled; TTL window starts (5s default)
 *                 - duplicate within window replays cached result /
 *                   rejection (same outcome as original)
 *
 *   EXPIRED    ← TTL elapsed; entry evicted; next call executes fresh
 *
 * Read tools (`get_*`, `list_*`) are not intercepted — caching is
 * `ToolResultCache`'s concern. Write-verb detection uses a
 * configurable predicate; default covers the MCP verbs seen on the
 * Hub surface (create_*, update_*, close_*, resolve_*, delete_*,
 * register_*, acknowledge_*, migrate_*).
 */

import type {
  CognitiveMiddleware,
  ToolCallContext,
} from "../contract.js";

export interface WriteCallDedupConfig {
  /**
   * Post-settlement dedup window in ms. Default: 5000.
   * Duplicate within this window after the original settles replays
   * the cached result. INV-COG-8: TTL starts at settlement, not at
   * first-call initiation.
   */
  windowMs?: number;
  /**
   * Fail-fast threshold for duplicate callers awaiting an in-flight
   * original. If the original hasn't settled within `maxInflightMs`
   * from when the duplicate started waiting, the DUPLICATE receives
   * `DedupTimeout`. The original call is unaffected. Default: 30000.
   */
  maxInflightMs?: number;
  /**
   * Predicate classifying whether a tool is a write. Non-write tools
   * pass through without dedup. Default: matches MCP write-verb
   * prefixes on the Hub surface.
   */
  isWriteTool?: (tool: string) => boolean;
  /**
   * Key derivation. Default: `{sessionId}:{tool}:{argsHash}`. Override
   * if the natural idempotency key differs (e.g., include an explicit
   * idempotency key from args).
   */
  keyFor?: (ctx: ToolCallContext) => string;
  /** Clock override for tests. */
  now?: () => number;
  /**
   * Timer factory for tests. Defaults to `setTimeout`/`clearTimeout`.
   * Return a handle callers can pass to `clearTimer`.
   */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Thrown to a DUPLICATE caller when the in-flight original exceeds
 * `maxInflightMs`. The original call remains in flight; the duplicate
 * is not auto-retried. Callers (usually the shim) decide whether to
 * surface this to the LLM or drop.
 */
export class DedupTimeoutError extends Error {
  readonly name = "DedupTimeoutError";
  readonly tool: string;
  readonly waitMs: number;

  constructor(tool: string, waitMs: number) {
    super(
      `DedupTimeout: original ${tool} call still pending after ${waitMs}ms — duplicate aborted`,
    );
    this.tool = tool;
    this.waitMs = waitMs;
  }
}

type EntryStatus = "in-flight" | "settled";

interface DedupEntry {
  status: EntryStatus;
  /** The original call's promise; all duplicates await this. */
  promise: Promise<unknown>;
  /** Settled value (success). Populated when status === "settled". */
  resolvedValue?: unknown;
  /** Settled rejection. Populated when status === "settled" AND failed. */
  rejected?: boolean;
  rejectedReason?: unknown;
  /** Timer handle for TTL-based eviction. */
  expiryHandle?: unknown;
}

const DEFAULT_WINDOW_MS = 5_000;
const DEFAULT_MAX_INFLIGHT_MS = 30_000;

/**
 * Canonicalize args into a deterministic hash. Sorts object keys
 * recursively so `{a:1,b:2}` and `{b:2,a:1}` produce the same hash.
 * Uses FNV-1a for compactness — collision-resistant enough for dedup
 * within a short time window where the worst case is an accidentally-
 * shared dedup slot (extra duplicate slips through).
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

function defaultKey(ctx: ToolCallContext): string {
  const argsHash = hashArgs(ctx.args);
  return `${ctx.sessionId}\u0000${ctx.tool}\u0000${argsHash}`;
}

export class WriteCallDedup implements CognitiveMiddleware {
  readonly name = "WriteCallDedup";

  private readonly entries = new Map<string, DedupEntry>();
  private readonly windowMs: number;
  private readonly maxInflightMs: number;
  private readonly isWriteTool: (tool: string) => boolean;
  private readonly keyFor: (ctx: ToolCallContext) => string;
  private readonly now: () => number;
  private readonly setTimerFn: (cb: () => void, ms: number) => unknown;
  private readonly clearTimerFn: (h: unknown) => void;

  constructor(config: WriteCallDedupConfig = {}) {
    this.windowMs = config.windowMs ?? DEFAULT_WINDOW_MS;
    this.maxInflightMs = config.maxInflightMs ?? DEFAULT_MAX_INFLIGHT_MS;
    this.isWriteTool = config.isWriteTool ?? defaultIsWriteTool;
    this.keyFor = config.keyFor ?? defaultKey;
    this.now = config.now ?? Date.now;
    this.setTimerFn = config.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimerFn = config.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  async onToolCall(
    ctx: ToolCallContext,
    next: (ctx: ToolCallContext) => Promise<unknown>,
  ): Promise<unknown> {
    // Read tools pass through — cache is ToolResultCache's job.
    if (!this.isWriteTool(ctx.tool)) {
      return next(ctx);
    }

    const key = this.keyFor(ctx);
    const existing = this.entries.get(key);

    if (existing) {
      if (existing.status === "in-flight") {
        ctx.tags.dedup = "in_flight";
        return this.awaitWithTimeout(ctx.tool, existing);
      }
      // Settled: replay cached result.
      ctx.tags.dedup = "replay";
      if (existing.rejected) throw existing.rejectedReason;
      return existing.resolvedValue;
    }

    // First call: register entry, execute next, capture settlement.
    ctx.tags.dedup = "first";
    return this.execute(key, ctx, next);
  }

  /**
   * Diagnostic: current size of the dedup map (for tests + observability).
   */
  getEntryCount(): number {
    return this.entries.size;
  }

  private async execute(
    key: string,
    ctx: ToolCallContext,
    next: (ctx: ToolCallContext) => Promise<unknown>,
  ): Promise<unknown> {
    const entry: DedupEntry = {
      status: "in-flight",
      promise: null as unknown as Promise<unknown>,
    };
    this.entries.set(key, entry);

    entry.promise = (async () => {
      try {
        const result = await next(ctx);
        entry.status = "settled";
        entry.resolvedValue = result;
        entry.rejected = false;
        this.scheduleEviction(key, entry);
        return result;
      } catch (err) {
        entry.status = "settled";
        entry.rejected = true;
        entry.rejectedReason = err;
        this.scheduleEviction(key, entry);
        throw err;
      }
    })();

    return entry.promise;
  }

  private awaitWithTimeout(tool: string, entry: DedupEntry): Promise<unknown> {
    if (this.maxInflightMs <= 0) return entry.promise;

    // Race entry.promise against a timeout that rejects ONLY this
    // duplicate's await. The original call continues independently.
    return new Promise<unknown>((resolve, reject) => {
      let timedOut = false;
      const timer = this.setTimerFn(() => {
        timedOut = true;
        reject(new DedupTimeoutError(tool, this.maxInflightMs));
      }, this.maxInflightMs);

      entry.promise.then(
        (v) => {
          if (timedOut) return;
          this.clearTimerFn(timer);
          resolve(v);
        },
        (err) => {
          if (timedOut) return;
          this.clearTimerFn(timer);
          reject(err);
        },
      );
    });
  }

  private scheduleEviction(key: string, entry: DedupEntry): void {
    if (entry.expiryHandle) this.clearTimerFn(entry.expiryHandle);
    entry.expiryHandle = this.setTimerFn(() => {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
      }
    }, this.windowMs);
  }
}
