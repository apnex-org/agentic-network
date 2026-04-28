/**
 * RepoEventBridge — mission-52 T3 Hub-side composition.
 *
 * Wires the @apnex/repo-event-bridge sovereign package into the Hub:
 *   - Constructs a `PollSource` against the Hub's StorageProvider
 *   - Constructs a `CreateMessageSink` whose `invoke` callable
 *     dispatches in-process to the Hub's `create_message` MCP verb
 *     via PolicyRouter (no transport hop)
 *   - Spawns a drainer coroutine that pulls from the source's async
 *     iterator and emits via the sink
 *   - Lifecycle: `start()` validates PAT scopes (fail-soft — bridge
 *     halts but Hub continues per directive); `stop()` halts polling
 *     and drains buffered events
 *
 * Failure isolation per directive: PAT auth/scope failures or any
 * other PollSource startup error MUST NOT crash the Hub. The bridge
 * logs the failure, sets state to `failed`, and the Hub continues
 * serving everything else.
 *
 * In-process invoker: builds a system-identity `IPolicyContext` per
 * call (matches the cascade-replay sweeper / scheduled-message
 * sweeper pattern in `hub/src/index.ts`). The Hub's `create_message`
 * handler treats the system caller as `architect` (the fallback role
 * for unknown sessions per `message-policy.ts`); KIND_AXES for
 * `external-injection` (the `CreateMessageSink` default kind) allow
 * any author. AgentId resolves to `anonymous-architect` since the
 * sessionId doesn't map to a registered agent.
 */

import {
  CreateMessageSink,
  PollSource,
  type CreateMessageInvoker,
} from "@apnex/repo-event-bridge";
import type { StorageProvider } from "@apnex/storage-provider";

import type { PolicyRouter } from "./router.js";
import type { IPolicyContext } from "./types.js";

// ── Logger ────────────────────────────────────────────────────────────

export interface RepoEventBridgeLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

function defaultLogger(): RepoEventBridgeLogger {
  return {
    info: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
  };
}

// ── State machine ────────────────────────────────────────────────────

export type RepoEventBridgeState =
  | "idle"
  | "starting"
  | "running"
  | "failed"
  | "stopped";

// ── Options ──────────────────────────────────────────────────────────

export interface RepoEventBridgeOptions {
  /** Storage backend — same provider the Hub uses for its other entities. */
  readonly storage: StorageProvider;
  /**
   * `create_message` invoker. Production = `createPolicyRouterInvoker`;
   * tests can pass a capturing mock to assert on emitted call shape.
   */
  readonly createMessageInvoke: CreateMessageInvoker;
  /** GitHub PAT — must have `repo`, `read:org`, `read:user` scopes. */
  readonly token: string;
  /** Repos to poll, `owner/name` form. */
  readonly repos: readonly string[];
  /** Cadence per repo (seconds). Default 30. */
  readonly cadenceSeconds?: number;
  /** Budget fraction of GH PAT rate limit. Default 0.8. */
  readonly budgetFraction?: number;
  /** Override fetch (tests). */
  readonly fetch?: typeof fetch;
  /** Logger. Defaults to console. */
  readonly logger?: RepoEventBridgeLogger;
}

// ── Bridge ────────────────────────────────────────────────────────────

export class RepoEventBridge {
  private readonly pollSource: PollSource;
  private readonly sink: CreateMessageSink;
  private readonly logger: RepoEventBridgeLogger;
  private state: RepoEventBridgeState = "idle";
  private drainTask?: Promise<void>;

  constructor(options: RepoEventBridgeOptions) {
    this.logger = options.logger ?? defaultLogger();
    this.sink = new CreateMessageSink({
      invoke: options.createMessageInvoke,
    });
    this.pollSource = new PollSource({
      storage: options.storage,
      token: options.token,
      repos: options.repos,
      cadenceSeconds: options.cadenceSeconds,
      budgetFraction: options.budgetFraction,
      fetch: options.fetch,
      logger: this.logger,
    });
  }

  /**
   * Start the bridge. PAT scope-validation runs here — failures are
   * caught and logged; the Hub continues to operate with the bridge
   * in `failed` state. Operator can rotate the token + restart.
   */
  async start(): Promise<void> {
    if (this.state !== "idle") return;
    this.state = "starting";
    try {
      await this.pollSource.start();
    } catch (err) {
      this.state = "failed";
      this.logger.error(
        `[repo-event-bridge] PollSource start failed: ${(err as Error)?.message ?? String(err)}; bridge halted, Hub continues`,
      );
      return;
    }
    this.state = "running";
    this.drainTask = this.drain();
    this.logger.info(
      `[repo-event-bridge] Bridge running; draining events into create_message`,
    );
  }

  /**
   * Stop the bridge. Awaits the drainer so any in-flight `emit` lands
   * before returning — keeps the SIGINT handler symmetric with the
   * other Hub sweepers.
   */
  async stop(): Promise<void> {
    if (this.state === "idle" || this.state === "stopped" || this.state === "failed") {
      this.state = "stopped";
      return;
    }
    this.state = "stopped";
    await this.pollSource.stop();
    if (this.drainTask) {
      await this.drainTask;
    }
  }

  /** Diagnostic: current lifecycle state. */
  getState(): RepoEventBridgeState {
    return this.state;
  }

  /** Diagnostic: pass-through to PollSource health. */
  health() {
    return this.pollSource.health();
  }

  private async drain(): Promise<void> {
    try {
      for await (const event of this.pollSource) {
        try {
          await this.sink.emit(event);
        } catch (err) {
          this.logger.error(
            `[repo-event-bridge] sink.emit failed for subkind=${event.subkind}: ${(err as Error)?.message ?? String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `[repo-event-bridge] drainer error: ${(err as Error)?.message ?? String(err)}`,
      );
    }
  }
}

// ── PolicyRouter-backed in-process invoker ───────────────────────────

/**
 * Build a `CreateMessageInvoker` that calls the Hub's `create_message`
 * MCP verb in-process via PolicyRouter (no transport hop). Each call
 * constructs a fresh system-identity `IPolicyContext` via
 * `contextFactory` — matches the cascade-replay / scheduled-message
 * sweeper pattern in `hub/src/index.ts`.
 *
 * Failures from the verb (auth, validation, store errors) are
 * surfaced as thrown `Error`s so the drainer's try/catch logs +
 * continues — single-event delivery failure should not halt the
 * bridge.
 */
export function createPolicyRouterInvoker(
  policyRouter: PolicyRouter,
  contextFactory: () => IPolicyContext,
): CreateMessageInvoker {
  return async (args) => {
    const ctx = contextFactory();
    const result = await policyRouter.handle(
      "create_message",
      args as unknown as Record<string, unknown>,
      ctx,
    );
    const text = result.content?.[0]?.text;
    if (result.isError) {
      throw new Error(
        `create_message failed: ${text ?? "unknown error"}`,
      );
    }
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  };
}

// ── Env-var parsing helper ───────────────────────────────────────────

/**
 * Parse the comma-separated `OIS_REPO_EVENT_BRIDGE_REPOS` env-var
 * into a normalized list. Trims whitespace; filters empty entries.
 * Returns `[]` for absent/empty — caller decides whether to no-op.
 */
export function parseReposEnvVar(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
