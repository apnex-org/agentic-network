/**
 * poll-backstop.ts — adapter-side hybrid poll backstop (mission-56 W3.3).
 *
 * Periodic `list_messages({target.role, status: "new", since: <last-seen>})`
 * poll at LONG cadence — the SAFETY NET behind the W1a SSE push pipeline.
 * Per Design v1.2 commitment #5: push is the primary path; polling fills
 * the gaps caused by adapter restart, transient SSE drop between
 * reconnect-replay (W1b) windows, and any push-edge dropped events the
 * adapter didn't see.
 *
 * Anti-pattern guard (per architect-issued W3 directive): poll cadence
 * MUST be measurably longer than push latency. Default 5min
 * (`OIS_ADAPTER_POLL_BACKSTOP_S=300`); 60s minimum (1min) for tests.
 *
 * Cursor persistence: last-seen Message ID is persisted across adapter
 * restarts so the poll fetches only the delta on each tick. Default
 * cursor file: `~/.ois/poll-cursor-<role>-<agentId>.json`. The
 * `since` cursor is REQUIRED on every poll — initial-state (no cursor
 * file) sends `since` undefined and treats the first poll's results as
 * the cold-start baseline (which the seen-id LRU dedup in the
 * MessageRouter de-collides against any concurrent push delivery of
 * the same Message IDs).
 *
 * Each surfaced Message is routed through the host-supplied callback
 * (the same `onActionableEvent` shape used by the SSE inline path).
 * The W2.1 `@apnex/message-router` seen-id LRU catches the push+poll
 * race overlap so a Message that arrived via SSE in the last 5min
 * window is not double-rendered when the next poll-tick sees it too.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { IAgentClient, AgentEvent } from "./agent-client.js";

const DEFAULT_CADENCE_SECONDS = 300; // 5 minutes
const MIN_CADENCE_SECONDS = 60; // 1 minute floor — anti-pattern guard

/**
 * mission-75 (M-TTL-Liveliness-Design) v1.0 §3.3 — second 30s heartbeat
 * timer alongside the existing 300s message-poll timer. Calls the new
 * `transport_heartbeat` MCP tool periodically so the Hub's
 * `lastHeartbeatAt` doesn't age monotonically for idle agents (no
 * pending actions queued; drain is queue-driven NOT periodic per
 * round-2 N1 fold).
 *
 * Defaults match Hub-side env-ified constants:
 *   TRANSPORT_HEARTBEAT_INTERVAL_MS = 30_000 (min 10_000)
 *   TRANSPORT_HEARTBEAT_ENABLED     = true
 *
 * Hub remains source-of-truth for these defaults; adapter reads its
 * own env vars at construction time. Per-agent override (livenessConfig
 * sub-object) is Hub-side only — adapter uses env defaults.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const MIN_HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_RETRY_BACKOFF_MS = 5_000;

export interface PollBackstopOptions {
  /**
   * Role this adapter polls for (e.g. "engineer", "architect"). Becomes
   * the `target.role` filter on each `list_messages` call.
   */
  role: string;

  /**
   * Poll cadence in seconds. Defaults to `OIS_ADAPTER_POLL_BACKSTOP_S`
   * env var (parsed as integer), falling back to 300 (5 minutes).
   * Floored at `MIN_CADENCE_SECONDS` (60) to enforce the
   * "measurably longer than push latency" anti-pattern guard.
   */
  cadenceSeconds?: number;

  /**
   * Override cursor-file location. Defaults to
   * `~/.ois/poll-cursor-<role>-<agentId>.json`. Tests inject a
   * temp path here; production callers can override to land cursors
   * in workspace-local state (e.g. `.ois/poll-cursor.json`).
   */
  cursorFile?: string;

  /**
   * Diagnostic logger. No-op default. Mirrors the dispatcher's `log`
   * convention.
   */
  log?: (msg: string) => void;

  /**
   * Hook fired for each Message surfaced by the poll. Same shape as
   * `DispatcherNotificationHooks.onActionableEvent` so the dispatcher
   * can wire poll output through the same MessageRouter as the SSE
   * inline path (preserving seen-id LRU dedup across both paths).
   *
   * bug-53: optional when `firstTimerEnabled === false` — heartbeat-only
   * hosts (claude-plugin/opencode-plugin per current SSE-driven message
   * delivery) don't need the poll-side callback. Default is no-op so
   * existing required-callback callers continue to work.
   */
  onPolledMessage?: (event: AgentEvent) => void;

  /**
   * bug-53: enable/disable the FIRST timer (periodic `list_messages`
   * polling). Defaults to true for backwards-compat with mission-56 W3.3
   * Pull-mode wiring. Set to `false` for heartbeat-only hosts (current
   * shim/opencode adapters use SSE for inline message delivery; the
   * first-timer's list_messages poll would introduce a second polling
   * source competing with SSE — out of scope until a separate first-timer
   * wiring audit per round-2 design decision).
   */
  firstTimerEnabled?: boolean;

  /**
   * mission-75 v1.0 §3.3 — heartbeat timer interval in milliseconds.
   * Defaults to `TRANSPORT_HEARTBEAT_INTERVAL_MS` env var (parsed as
   * integer), falling back to 30_000 (30s). Floored at 10_000 (10s)
   * per Design v1.0 §3.3 minimum. Tests inject a small value (e.g.
   * 100ms) to exercise cadence behaviour.
   */
  heartbeatIntervalMs?: number;

  /**
   * mission-75 v1.0 §3.3 — heartbeat timer enable flag. Defaults to
   * `TRANSPORT_HEARTBEAT_ENABLED` env var (`"false"` disables; any
   * other value including absence enables). Setting to `false`
   * cleanly disables the timer (start() skips heartbeat scheduling).
   */
  heartbeatEnabled?: boolean;
}

interface CursorFile {
  /** ULID of the last-seen Message (or undefined for cold-start). */
  lastSeenId?: string;
  /** ISO-8601 timestamp of the most recent successful poll. */
  updatedAt: string;
  /** Schema version for forward-compat. */
  version: 1;
}

/**
 * Resolve the cursor file path. Defaults to
 * `~/.ois/poll-cursor-<role>-<agentId>.json`. The agentId is
 * stable across restarts (mission-19 Agent identity) so a single
 * adapter instance always writes/reads the same cursor file.
 */
export function defaultCursorFile(role: string, agentId: string): string {
  return join(homedir(), ".ois", `poll-cursor-${role}-${agentId}.json`);
}

/**
 * Read the persisted cursor (or undefined if no cursor file exists).
 * Corruption-tolerant: returns undefined on parse failure (cold-start
 * recovery — the seen-id LRU absorbs any double-delivery from the
 * resulting full replay).
 */
export function readCursor(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as CursorFile;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.lastSeenId === undefined || typeof parsed.lastSeenId === "string")
    ) {
      return parsed.lastSeenId;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write the cursor atomically (writeFileSync; same pattern as the
 * tool-catalog cache). Best-effort on failure (poll continues on the
 * in-process cursor; restart will re-read whatever last persisted).
 */
export function writeCursor(
  path: string,
  lastSeenId: string | undefined,
  log: (msg: string) => void = () => {},
): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      log(`[poll-backstop] mkdirSync(${dir}) failed: ${err}`);
      return;
    }
  }
  const body: CursorFile = {
    lastSeenId,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
  try {
    writeFileSync(path, JSON.stringify(body, null, 2), { mode: 0o600 });
  } catch (err) {
    log(`[poll-backstop] writeFileSync(${path}) failed: ${err}`);
  }
}

interface ListMessagesBody {
  messages: Array<{ id: string; [k: string]: unknown }>;
  count: number;
}

/**
 * Coerce an `agent.call("list_messages")` return into a ListMessagesBody.
 *
 * bug-103: `IAgentClient.call` → `McpTransport.request` ALREADY unwraps the
 * MCP tool-result envelope — it reads `result.content[0].text` and
 * `JSON.parse`s it (see `mcp-transport.ts` request()). So `raw` here is the
 * `list_messages` body — `{ messages, count }` — directly, NOT the
 * `{ content: [{ text }] }` envelope. The prior implementation re-expected
 * the envelope; since the first-timer was disabled from bug-53 until the
 * bug-103 slice, this path never ran against the real transport, so the
 * contract drift went uncaught (the harness-verify is the dispositive
 * real-transport guard). Returns null on any other shape — defensive
 * against a non-JSON error string, null, or a cognitive-layer summarized
 * result that drops the `messages[]` array.
 */
function parseListMessagesResult(raw: unknown): ListMessagesBody | null {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray((raw as { messages?: unknown }).messages)) return null;
  return raw as ListMessagesBody;
}

/**
 * The PollBackstop runs the periodic `list_messages` tick loop and
 * surfaces each delta Message via the `onPolledMessage` hook.
 *
 * Lifecycle: `start(getAgent)` begins the timer; `stop()` cancels it
 * cleanly. Idempotent — start while already-started is a no-op; stop
 * while not-started is a no-op.
 */
export class PollBackstop {
  private readonly opts: Required<
    Omit<PollBackstopOptions, "cursorFile" | "heartbeatIntervalMs" | "heartbeatEnabled" | "firstTimerEnabled" | "onPolledMessage">
  > & {
    cursorFile?: string;
    heartbeatIntervalMs: number;
    heartbeatEnabled: boolean;
    firstTimerEnabled: boolean;
    onPolledMessage: (event: AgentEvent) => void;
  };
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private resolvedCursorFile: string | null = null;
  private inFlight = false;
  private heartbeatInFlight = false;

  constructor(opts: PollBackstopOptions) {
    const fromEnv = parseInt(
      process.env.OIS_ADAPTER_POLL_BACKSTOP_S ?? "",
      10,
    );
    const cadence = Math.max(
      MIN_CADENCE_SECONDS,
      opts.cadenceSeconds ??
        (Number.isFinite(fromEnv) ? fromEnv : DEFAULT_CADENCE_SECONDS),
    );
    // mission-75 v1.0 §3.3 — heartbeat timer config (separate from
    // message-poll cadence). Reads TRANSPORT_HEARTBEAT_INTERVAL_MS +
    // TRANSPORT_HEARTBEAT_ENABLED env vars; explicit options override.
    const hbFromEnv = Number(process.env.TRANSPORT_HEARTBEAT_INTERVAL_MS);
    const heartbeatIntervalMs = Math.max(
      MIN_HEARTBEAT_INTERVAL_MS,
      opts.heartbeatIntervalMs ??
        (Number.isFinite(hbFromEnv) ? hbFromEnv : DEFAULT_HEARTBEAT_INTERVAL_MS),
    );
    const heartbeatEnabled = opts.heartbeatEnabled ??
      (process.env.TRANSPORT_HEARTBEAT_ENABLED === "false" ? false : true);
    // bug-53: firstTimerEnabled defaults true for backwards-compat with
    // existing mission-56 W3.3 Pull-mode callers; heartbeat-only hosts pass
    // false to skip the first-timer scheduling.
    const firstTimerEnabled = opts.firstTimerEnabled ?? true;
    this.opts = {
      role: opts.role,
      cadenceSeconds: cadence,
      cursorFile: opts.cursorFile,
      log: opts.log ?? (() => {}),
      onPolledMessage: opts.onPolledMessage ?? (() => {}),
      heartbeatIntervalMs,
      heartbeatEnabled,
      firstTimerEnabled,
    };
  }

  /** Start the periodic poll + heartbeat (if enabled). Idempotent. */
  start(getAgent: () => IAgentClient | null): void {
    // Idempotency guard: if EITHER timer is already set, treat as started.
    // bug-53: previously checked only `this.timer`; under heartbeat-only
    // mode (firstTimerEnabled=false) timer is null but heartbeatTimer may
    // be set — guard against duplicate-start re-scheduling the heartbeat.
    if (this.timer || this.heartbeatTimer) return;
    const cadenceMs = this.opts.cadenceSeconds * 1000;
    this.opts.log(
      `[poll-backstop] starting (role=${this.opts.role}, cadenceS=${this.opts.firstTimerEnabled ? this.opts.cadenceSeconds : "disabled"}, heartbeatMs=${this.opts.heartbeatEnabled ? this.opts.heartbeatIntervalMs : "disabled"})`,
    );
    // bug-53: skip first-timer scheduling when firstTimerEnabled === false
    // (heartbeat-only hosts; current shim/opencode adapters use SSE for
    // inline message delivery; first-timer Pull-mode wiring deferred).
    if (this.opts.firstTimerEnabled) {
      this.timer = setInterval(() => {
        // Fire-and-forget; tick() handles its own errors.
        void this.tick(getAgent);
      }, cadenceMs);
      if (this.timer.unref) this.timer.unref();
    }
    // mission-75 v1.0 §3.3 — second timer for transport_heartbeat. Only
    // started when heartbeatEnabled === true (TRANSPORT_HEARTBEAT_ENABLED
    // env-disable path; tests opt-out).
    if (this.opts.heartbeatEnabled) {
      this.heartbeatTimer = setInterval(() => {
        void this.tickHeartbeat(getAgent);
      }, this.opts.heartbeatIntervalMs);
      if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
    }
  }

  /** Stop the periodic poll + heartbeat. Idempotent. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.opts.log("[poll-backstop] stopped");
  }

  /**
   * Single poll iteration. Exposed for tests + diagnostic operators
   * (e.g. force-tick on demand). Reentrant-safe via in-flight guard
   * — concurrent ticks coalesce on the in-flight one.
   */
  async tick(getAgent: () => IAgentClient | null): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const agent = getAgent();
      if (!agent || agent.state !== "streaming") return;

      // Cursor file resolution: lazy on first tick (agentId only
      // becomes known post-handshake).
      if (!this.resolvedCursorFile) {
        if (this.opts.cursorFile) {
          this.resolvedCursorFile = this.opts.cursorFile;
        } else {
          const agentId = agent.getSessionId() ?? "unknown";
          // Prefer `getMetrics().agentId` when available — it's the
          // post-handshake stable Agent identity, distinct from the
          // session id which cycles on reconnect.
          const metrics = agent.getMetrics?.();
          const id = metrics?.agentId ?? agentId;
          this.resolvedCursorFile = defaultCursorFile(this.opts.role, id);
        }
      }
      const cursorFile = this.resolvedCursorFile;

      const since = readCursor(cursorFile);
      const args: Record<string, unknown> = {
        targetRole: this.opts.role,
        status: "new",
      };
      if (since !== undefined) args.since = since;

      let raw: unknown;
      try {
        // bug-106: `internal` — this catch-up poll is machinery, not an LLM
        // tool-call; the result must NOT be cognitive-layer-summarized
        // (a summarized/truncated messages[] silently drops recovery).
        raw = await agent.call("list_messages", args, { internal: true });
      } catch (err) {
        this.opts.log(
          `[poll-backstop] list_messages failed (non-fatal): ${(err as Error)?.message ?? String(err)}`,
        );
        return;
      }

      const body = parseListMessagesResult(raw);
      if (!body || !Array.isArray(body.messages)) {
        this.opts.log(
          `[poll-backstop] unexpected list_messages result shape; skipping tick`,
        );
        return;
      }

      if (body.messages.length === 0) {
        // No delta — keep the existing cursor (no need to rewrite the
        // file with an unchanged value).
        return;
      }

      // Surface each delta Message through the host hook. Mirrors the
      // SSE `message_arrived` envelope shape so the MessageRouter +
      // host hooks don't need a separate code path.
      let maxId = since ?? "";
      for (const message of body.messages) {
        if (!message || typeof message.id !== "string") continue;
        if (message.id > maxId) maxId = message.id;
        const event: AgentEvent = {
          event: "message_arrived",
          data: { message },
          // The SSE envelope id is the W1b Last-Event-ID surface; for
          // poll-sourced events we use the Message ID itself so the
          // MessageRouter's seen-id LRU dedup catches push+poll race.
          id: message.id,
        };
        try {
          this.opts.onPolledMessage(event);
        } catch (err) {
          this.opts.log(
            `[poll-backstop] onPolledMessage handler threw (non-fatal): ${(err as Error)?.message ?? String(err)}`,
          );
        }
      }

      // Persist the cursor advance only if we observed strictly newer IDs
      // (defensive: if some weirdness made every returned id <= since,
      // don't regress the cursor).
      if (since === undefined || maxId > since) {
        writeCursor(cursorFile, maxId, this.opts.log);
      }
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * mission-75 v1.0 §3.3 — single transport_heartbeat tick. Lightweight
   * no-payload; the call itself is the heartbeat. Failure handling per
   * Design §3.3:
   *   - retry once with 5s backoff;
   *   - skip cycle on second failure (next cycle attempts);
   *   - poll-backstop existing retry semantics for transient blips.
   *
   * Reentrant-safe via heartbeatInFlight guard. Exposed for tests
   * (force-tick on demand).
   */
  async tickHeartbeat(getAgent: () => IAgentClient | null): Promise<void> {
    if (this.heartbeatInFlight) return;
    this.heartbeatInFlight = true;
    try {
      const agent = getAgent();
      if (!agent || agent.state !== "streaming") return;
      try {
        await agent.call("transport_heartbeat", {}, { internal: true });
        return;
      } catch (firstErr) {
        this.opts.log(
          `[poll-backstop] transport_heartbeat failed (1st; retrying in ${HEARTBEAT_RETRY_BACKOFF_MS}ms): ${(firstErr as Error)?.message ?? String(firstErr)}`,
        );
      }
      // Single retry with backoff. If this fails too, skip the cycle —
      // next cycle (heartbeatIntervalMs from now) will try again.
      await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_RETRY_BACKOFF_MS));
      try {
        // Re-check agent state after the backoff (could have torn down).
        const agent2 = getAgent();
        if (!agent2 || agent2.state !== "streaming") return;
        await agent2.call("transport_heartbeat", {}, { internal: true });
      } catch (secondErr) {
        this.opts.log(
          `[poll-backstop] transport_heartbeat failed (2nd; skipping cycle): ${(secondErr as Error)?.message ?? String(secondErr)}`,
        );
      }
    } finally {
      this.heartbeatInFlight = false;
    }
  }
}
