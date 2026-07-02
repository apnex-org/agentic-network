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
  WorkflowRunPollSource,
  type CreateMessageInvoker,
  type RepoEvent,
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
  // idea-255 / M-Workflow-Run-Events-Hub-Integration v1.0 §1.1 F8 fold:
  // sibling EventSource for /actions/runs (workflow_run is webhook-only on
  // the /events API, so it needs a separate REST endpoint).
  private readonly workflowRunPollSource: WorkflowRunPollSource;
  private readonly sink: CreateMessageSink;
  private readonly logger: RepoEventBridgeLogger;
  private state: RepoEventBridgeState = "idle";

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
      sink: this.sink, // bug-190 (A): inline delivery — the poll loop IS the delivery loop
    });
    this.workflowRunPollSource = new WorkflowRunPollSource({
      storage: options.storage,
      token: options.token,
      repos: options.repos,
      cadenceSeconds: options.cadenceSeconds,
      budgetFraction: options.budgetFraction,
      fetch: options.fetch,
      logger: this.logger,
      sink: this.sink,
    });
  }

  /**
   * Start the bridge. PAT scope-validation runs here — failures are
   * caught and logged; the Hub continues to operate with the bridge
   * in `failed` state. Operator can rotate the token + restart.
   *
   * Both sources start under the same try/catch — partial-start failure
   * (one source up + one down) is treated as full-failed for now;
   * operator can restart the Hub after rotating the token.
   */
  async start(): Promise<void> {
    if (this.state !== "idle") return;
    this.state = "starting";
    try {
      await this.pollSource.start();
      await this.workflowRunPollSource.start();
    } catch (err) {
      this.state = "failed";
      this.logger.error(
        `[repo-event-bridge] source start failed: ${(err as Error)?.message ?? String(err)}; bridge halted, Hub continues`,
      );
      return;
    }
    this.state = "running";
    this.logger.info(
      `[repo-event-bridge] Bridge running; events + workflow-runs deliver INLINE into create_message (the poll loop IS the delivery loop — no separate drainer)`,
    );
  }

  /**
   * Stop the bridge. Stops both sources — their poll/deliver loops finish the in-flight cycle
   * before returning. No separate drainer to await (bug-190 (A): the poll loop is the delivery loop).
   */
  async stop(): Promise<void> {
    if (this.state === "idle" || this.state === "stopped" || this.state === "failed") {
      this.state = "stopped";
      return;
    }
    this.state = "stopped";
    await Promise.allSettled([
      this.pollSource.stop(),
      this.workflowRunPollSource.stop(),
    ]);
  }

  /** Diagnostic: current lifecycle state. */
  getState(): RepoEventBridgeState {
    return this.state;
  }

  /**
   * Diagnostic: combined health of both sources — "paused" if EITHER source is paused;
   * lastSuccessfulPoll is the later of the two. bug-190 (d): ALSO rolls up the DELIVERY half —
   * deliveryFailing if EITHER source's sink delivery is persistently failing, lastSuccessfulDelivery
   * as the later of the two. Wired to /health so a poll-healthy-but-delivery-failing bridge is no
   * longer dark (closes the 'bridge.health() has zero prod consumers' surface).
   */
  health() {
    const eventsHealth = this.pollSource.health();
    const workflowRunsHealth = this.workflowRunPollSource.health();
    const laterOf = (a?: string, b?: string): string | undefined =>
      a && b ? (a > b ? a : b) : (a ?? b);
    return {
      paused: eventsHealth.paused || workflowRunsHealth.paused,
      pausedReason:
        eventsHealth.pausedReason ?? workflowRunsHealth.pausedReason,
      lastSuccessfulPoll:
        eventsHealth.lastSuccessfulPoll > workflowRunsHealth.lastSuccessfulPoll
          ? eventsHealth.lastSuccessfulPoll
          : workflowRunsHealth.lastSuccessfulPoll,
      deliveryFailing:
        Boolean(eventsHealth.deliveryFailing) ||
        Boolean(workflowRunsHealth.deliveryFailing),
      lastSuccessfulDelivery: laterOf(
        eventsHealth.lastSuccessfulDelivery,
        workflowRunsHealth.lastSuccessfulDelivery,
      ),
    };
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
