/**
 * PollSource — poll-based EventSource for the GitHub /events API.
 *
 * Mission-52 T2. Polls a configured set of GitHub repos on a constant cadence;
 * translates raw GH events into RepoEvents; persists per-repo cursor + bounded
 * recent-event-id dedupe set via @apnex/storage-provider.
 *
 * Strategy: ETag-conditional polling — `If-None-Match`; a 304 is "not-modified".
 * Per-event dedupe via the CursorStore LRU on `event.id`.
 *
 * work-44/bug-190 PR-1: the lifecycle (scope-validated start, per-repo poll loops,
 * auth/rate/transient backoff, the async-iterator queue, health, budget logging) +
 * the pollOnce skeleton (fetch → classify → dedupe → emit → commit) now live in
 * BasePollSource; this class supplies only the ETag-strategy hooks. The constants +
 * Logger/PollOutcome types are re-exported here for back-compat.
 */

import { type GhEventEnvelope } from "./gh-api-client.js";
import { translateGhEvent } from "./translator.js";
import type { RepoCursor } from "./cursor-store.js";
import type { CursorStoreOptions } from "./cursor-store.js";
import {
  BasePollSource,
  type BaseRepoState,
  type FetchResult,
  type Logger,
} from "./base-poll-source.js";

// Re-export the shared constants + types from their new home (back-compat: WorkflowRunPollSource
// + the test-suites import these from "./poll-source.js").
export {
  GH_PAT_RATE_LIMIT_PER_HOUR,
  DEFAULT_CADENCE_SECONDS,
  DEFAULT_BUDGET_FRACTION,
} from "./base-poll-source.js";
export type { Logger, PollOutcome } from "./base-poll-source.js";

export interface PollSourceOptions {
  /** Repo identifiers in `owner/name` form. */
  readonly repos: readonly string[];
  /** GitHub PAT. */
  readonly token: string;
  /** Cadence per repo (seconds). Default 30s. */
  readonly cadenceSeconds?: number;
  /** Budget fraction of GH PAT rate limit. Default 0.8. */
  readonly budgetFraction?: number;
  /** GitHub API base URL (override for testing / GH Enterprise). */
  readonly baseUrl?: string;
  /** Storage backend for cursor + dedupe state. */
  readonly storage: CursorStoreOptions["storage"];
  /** Bounded LRU capacity for the dedupe set. Default 1000. */
  readonly dedupeCapacity?: number;
  /** Required PAT scopes. Defaults to `["repo", "read:org", "read:user"]`. */
  readonly requiredScopes?: readonly string[];
  /** Override fetch (for tests). */
  readonly fetch?: typeof fetch;
  /** Override sleep (for tests). Default `setTimeout`. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Override clock (for tests). Default `Date.now`. */
  readonly now?: () => number;
  /** Logger. Defaults to console. */
  readonly logger?: Logger;
}

interface PollRepoState extends BaseRepoState {
  cursorEtag?: string;
}

export class PollSource extends BasePollSource<GhEventEnvelope, PollRepoState> {
  constructor(options: PollSourceOptions) {
    super(options); // /events uses the default CursorStore namespace (no pathPrefix override)
  }

  protected get sourceName(): string {
    return "PollSource";
  }
  protected get logPrefix(): string {
    return "[repo-event-bridge]";
  }
  protected createState(): PollRepoState {
    return { cursorToken: null, dedupeToken: null, transientBackoffIndex: 0 };
  }
  protected hydrateCursor(state: PollRepoState, value: RepoCursor | null): void {
    state.cursorEtag = value?.etag;
  }
  protected idOf(e: GhEventEnvelope): string {
    return e.id;
  }
  protected translate(e: GhEventEnvelope, _repoId: string) {
    return translateGhEvent(e);
  }

  protected async fetchEvents(
    repoId: string,
    state: PollRepoState,
  ): Promise<FetchResult<GhEventEnvelope>> {
    const result = await this.client.pollRepoEvents(repoId, {
      etag: state.cursorEtag,
    });
    if (result.notModified) {
      return { kind: "no-events", outcome: "not-modified" };
    }
    return {
      kind: "events",
      candidates: result.events,
      commit: async (fresh) => {
        await this.markFreshSeen(repoId, state, fresh.map((e) => e.id));
        if (result.etag && result.etag !== state.cursorEtag) {
          const nextCursor = {
            etag: result.etag,
            lastEventId:
              fresh[fresh.length - 1]?.id ??
              result.events[result.events.length - 1]?.id,
            updatedAt: new Date(this.now()).toISOString(),
          };
          try {
            state.cursorToken = await this.cursorStore.writeCursor(
              repoId,
              nextCursor,
              state.cursorToken,
            );
            state.cursorEtag = result.etag;
          } catch {
            state.cursorToken = null;
          }
        }
      },
    };
  }
}
