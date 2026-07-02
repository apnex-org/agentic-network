/**
 * WorkflowRunPollSource — sibling EventSource for /repos/:owner/:repo/actions/runs.
 *
 * idea-255 / M-Workflow-Run-Events-Hub-Integration. Distinct from PollSource (which polls
 * /events) because workflow_run is webhook-only on /events; the REST equivalent is
 * /actions/runs with a different response shape and no ETag-conditional flow.
 *
 * Strategy (the hooks this class supplies; the lifecycle lives in BasePollSource):
 *   - NO ETag conditional. Cursor is TIMESTAMP-based: track `cursorIsoTime` per repo; each
 *     poll queries `?created=>=<cursorIsoTime>&per_page=<perPage>`.
 *   - LRU dedupe on `String(run.id)` for the small overlap window around a bridge restart.
 *   - Distinct CursorStore `pathPrefix` so the cursor namespace doesn't collide with /events.
 *   - Empty result → advance nothing (a no-events "ok"); the cursor only moves on real runs.
 *
 * work-44/bug-190 PR-1: de-duped onto BasePollSource (the shared lifecycle + pollOnce
 * skeleton); behavior-preserving (the existing test-suite is the gate).
 */

import { type WorkflowRun } from "./gh-api-client.js";
import { translateWorkflowRun } from "./workflow-run-translator.js";
import type { CursorStoreOptions, RepoCursor } from "./cursor-store.js";
import {
  BasePollSource,
  DEFAULT_CADENCE_SECONDS,
  type BaseRepoState,
  type FetchResult,
  type Logger,
} from "./base-poll-source.js";
import type { MessageSink } from "./sink.js";

void DEFAULT_CADENCE_SECONDS; // (kept importable; cadence default applied in the base)

// ── Constants ─────────────────────────────────────────────────────────

/** Default per-page page size for /actions/runs (max 100; lean 50 per F5 fold). */
const DEFAULT_PER_PAGE = 50;
/** Cursor-store path prefix; distinct from the /events PollSource namespace. */
const WORKFLOW_RUN_PATH_PREFIX = "repo-event-bridge-workflow-runs";
/**
 * Initial cursor lookback when no cursor exists. Bounds the first-poll historical-backlog
 * flood (F4 fold). 10 minutes catches recent activity around a Hub restart without pulling
 * weeks of runs.
 */
const INITIAL_LOOKBACK_MS = 10 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────

export interface WorkflowRunPollSourceOptions {
  readonly repos: readonly string[];
  readonly token: string;
  readonly cadenceSeconds?: number;
  readonly budgetFraction?: number;
  readonly baseUrl?: string;
  readonly storage: CursorStoreOptions["storage"];
  readonly dedupeCapacity?: number;
  readonly requiredScopes?: readonly string[];
  /** Per-page size for /actions/runs. Default 50. */
  readonly perPage?: number;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly logger?: Logger;
  /** work-44/bug-190 (A): the delivery sink (the poll loop emits inline). */
  readonly sink: MessageSink;
  /** Bounded emit retries before declaring persistent delivery failure. Default 3. */
  readonly emitRetries?: number;
}

interface WorkflowRunRepoState extends BaseRepoState {
  /** ISO-8601 upper bound of the last successful poll window. */
  cursorIsoTime: string;
}

// ── WorkflowRunPollSource ─────────────────────────────────────────────

export class WorkflowRunPollSource extends BasePollSource<
  WorkflowRun,
  WorkflowRunRepoState
> {
  private readonly perPage: number;

  constructor(options: WorkflowRunPollSourceOptions) {
    super({ ...options, cursorPathPrefix: WORKFLOW_RUN_PATH_PREFIX });
    this.perPage = options.perPage ?? DEFAULT_PER_PAGE;
  }

  protected get sourceName(): string {
    return "WorkflowRunPollSource";
  }
  protected get logPrefix(): string {
    return "[workflow-run-poll-source]";
  }
  protected createState(): WorkflowRunRepoState {
    // No committed cursor yet → start from the bounded lookback window (F4).
    return {
      cursorIsoTime: new Date(this.now() - INITIAL_LOOKBACK_MS).toISOString(),
      cursorToken: null,
      dedupeToken: null,
      transientBackoffIndex: 0,
    };
  }
  protected hydrateCursor(state: WorkflowRunRepoState, value: RepoCursor | null): void {
    // The iso-time is stashed in the cursor's `lastEventId` slot (opaque to CursorStore).
    if (value?.lastEventId) state.cursorIsoTime = value.lastEventId;
  }
  protected idOf(run: WorkflowRun): string {
    return String(run.id);
  }
  protected translate(run: WorkflowRun, repoId: string) {
    return translateWorkflowRun(run, repoId);
  }

  protected async fetchEvents(
    repoId: string,
    state: WorkflowRunRepoState,
  ): Promise<FetchResult<WorkflowRun>> {
    const result = await this.client.pollWorkflowRuns(repoId, {
      createdSince: state.cursorIsoTime,
      perPage: this.perPage,
    });
    if (result.workflow_runs.length === 0) {
      // No new runs since the cursor; nothing to advance (cursor moves only on real runs).
      return { kind: "no-events", outcome: "ok" };
    }
    return {
      kind: "events",
      candidates: result.workflow_runs,
      // bug-190 (A): cursor-write ONLY (markSeen of the delivered events is in the base, gated on
      // delivery). The base calls this ONLY when every fresh event delivered.
      advanceCursor: async () => {
        // Advance to the latest updated_at in the batch (server returns newest-first; max-reduce
        // defensively over ALL runs, not just fresh).
        const maxUpdatedAt = result.workflow_runs.reduce<string>(
          (acc, r) => (r.updated_at && r.updated_at > acc ? r.updated_at : acc),
          state.cursorIsoTime,
        );
        await this.advanceCursorTo(repoId, state, maxUpdatedAt);
      },
    };
  }

  /** Timestamp cursor-write: stash the iso-time in `lastEventId` (CursorStore doesn't interpret
   *  it). No-op when the time didn't advance. */
  private async advanceCursorTo(
    repoId: string,
    state: WorkflowRunRepoState,
    nextIsoTime: string | null,
  ): Promise<void> {
    if (nextIsoTime === null || nextIsoTime <= state.cursorIsoTime) return;
    state.cursorIsoTime = nextIsoTime;
    try {
      state.cursorToken = await this.cursorStore.writeCursor(
        repoId,
        {
          lastEventId: nextIsoTime,
          updatedAt: new Date(this.now()).toISOString(),
        },
        state.cursorToken,
      );
    } catch {
      state.cursorToken = null;
    }
  }
}
