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
 * The W2.1 `@ois/message-router` seen-id LRU catches the push+poll
 * race overlap so a Message that arrived via SSE in the last 5min
 * window is not double-rendered when the next poll-tick sees it too.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { IAgentClient, AgentEvent } from "./agent-client.js";

const DEFAULT_CADENCE_SECONDS = 300; // 5 minutes
const MIN_CADENCE_SECONDS = 60; // 1 minute floor — anti-pattern guard

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
   */
  onPolledMessage: (event: AgentEvent) => void;
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

/**
 * The shape of a `list_messages` MCP tool result envelope, as seen
 * by the adapter via `IAgentClient.call`. Only the fields the
 * backstop reads are typed; the rest is passed through opaquely.
 */
interface ListMessagesEnvelope {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

interface ListMessagesBody {
  messages: Array<{ id: string; [k: string]: unknown }>;
  count: number;
}

function parseListMessagesResult(raw: unknown): ListMessagesBody | null {
  const env = raw as ListMessagesEnvelope | null;
  if (!env || !env.content || !env.content[0] || env.isError) return null;
  try {
    return JSON.parse(env.content[0].text) as ListMessagesBody;
  } catch {
    return null;
  }
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
  private readonly opts: Required<Omit<PollBackstopOptions, "cursorFile">> & {
    cursorFile?: string;
  };
  private timer: NodeJS.Timeout | null = null;
  private resolvedCursorFile: string | null = null;
  private inFlight = false;

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
    this.opts = {
      role: opts.role,
      cadenceSeconds: cadence,
      cursorFile: opts.cursorFile,
      log: opts.log ?? (() => {}),
      onPolledMessage: opts.onPolledMessage,
    };
  }

  /** Start the periodic poll. Idempotent. */
  start(getAgent: () => IAgentClient | null): void {
    if (this.timer) return;
    const cadenceMs = this.opts.cadenceSeconds * 1000;
    this.opts.log(
      `[poll-backstop] starting (role=${this.opts.role}, cadenceS=${this.opts.cadenceSeconds})`,
    );
    this.timer = setInterval(() => {
      // Fire-and-forget; tick() handles its own errors.
      void this.tick(getAgent);
    }, cadenceMs);
    if (this.timer.unref) this.timer.unref();
  }

  /** Stop the periodic poll. Idempotent. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
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
        raw = await agent.call("list_messages", args);
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
}
