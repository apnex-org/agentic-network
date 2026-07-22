/**
 * Persisted review-request lifecycle source (bug-334).
 *
 * GitHub's repository `/events` feed does not expose review_requested / review_request_removed.
 * Repository issue-events does, but omits exact PR head/base. This source polls issue-events with
 * its own persisted ETag+LRU namespace, filters assignment transitions, enriches each row from the
 * PR endpoint, then feeds the existing PullRequestEvent translator. Output projection idempotency
 * remains Hub-owned; source dedupe is strictly on the upstream issue-event id.
 */

import type { GhEventEnvelope, IssueEventEnvelope, PullRequestSnapshot } from "./gh-api-client.js";
import type { RepoCursor, CursorStoreOptions } from "./cursor-store.js";
import {
  BasePollSource,
  type BaseRepoState,
  type FetchResult,
  type Logger,
} from "./base-poll-source.js";
import type { MessageSink } from "./sink.js";
import { translateGhEvent } from "./translator.js";

const REVIEW_REQUEST_ACTIONS = new Set(["review_requested", "review_request_removed"]);
export const REVIEW_REQUEST_CURSOR_PREFIX = "repo-event-bridge-review-requests";

export interface ReviewRequestPollSourceOptions {
  readonly repos: readonly string[];
  readonly token: string;
  readonly cadenceSeconds?: number;
  readonly budgetFraction?: number;
  readonly baseUrl?: string;
  readonly storage: CursorStoreOptions["storage"];
  readonly dedupeCapacity?: number;
  readonly requiredScopes?: readonly string[];
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly now?: () => number;
  readonly logger?: Logger;
  readonly sink: MessageSink;
  readonly emitRetries?: number;
  readonly perPage?: number;
}

interface ReviewRequestRepoState extends BaseRepoState {
  cursorEtag?: string;
}

export class ReviewRequestPollSource extends BasePollSource<GhEventEnvelope, ReviewRequestRepoState> {
  private readonly perPage: number;

  constructor(options: ReviewRequestPollSourceOptions) {
    super({ ...options, cursorPathPrefix: REVIEW_REQUEST_CURSOR_PREFIX });
    this.perPage = options.perPage ?? 100;
  }

  protected get sourceName(): string {
    return "ReviewRequestPollSource";
  }

  protected get logPrefix(): string {
    return "[repo-event-bridge/review-requests]";
  }

  protected createState(): ReviewRequestRepoState {
    return { cursorToken: null, dedupeToken: null, transientBackoffIndex: 0 };
  }

  protected hydrateCursor(state: ReviewRequestRepoState, value: RepoCursor | null): void {
    state.cursorEtag = value?.etag;
  }

  protected idOf(event: GhEventEnvelope): string {
    return event.id;
  }

  protected translate(event: GhEventEnvelope, _repoId: string) {
    return translateGhEvent(event);
  }

  protected async fetchEvents(
    repoId: string,
    state: ReviewRequestRepoState,
  ): Promise<FetchResult<GhEventEnvelope>> {
    const result = await this.client.pollIssueEvents(repoId, {
      etag: state.cursorEtag,
      perPage: this.perPage,
    });
    if (result.notModified) return { kind: "no-events", outcome: "not-modified" };

    const reviewEvents = result.events.filter(isReviewRequestIssueEvent);
    const candidates = await Promise.all(
      reviewEvents.map(async (event) => {
        const pullRequest = await this.client.getPullRequest(repoId, event.issue.number);
        return issueEventAsPullRequestEvent(repoId, event, pullRequest);
      }),
    );

    return {
      kind: "events",
      candidates,
      advanceCursor: async () => {
        if (!result.etag || result.etag === state.cursorEtag) return;
        const nextCursor = {
          etag: result.etag,
          lastEventId: String(result.events[result.events.length - 1]?.id ?? ""),
          updatedAt: new Date(this.now()).toISOString(),
        };
        try {
          state.cursorToken = await this.cursorStore.writeCursor(repoId, nextCursor, state.cursorToken);
          state.cursorEtag = result.etag;
        } catch {
          state.cursorToken = null;
        }
      },
    };
  }
}

function isReviewRequestIssueEvent(event: IssueEventEnvelope): boolean {
  return REVIEW_REQUEST_ACTIONS.has(event.event) &&
    typeof event.issue?.number === "number" &&
    event.issue.pull_request !== undefined;
}

function issueEventAsPullRequestEvent(
  repoId: string,
  event: IssueEventEnvelope,
  pullRequest: PullRequestSnapshot,
): GhEventEnvelope {
  return {
    id: String(event.id),
    type: "PullRequestEvent",
    repo: { name: repoId },
    created_at: event.created_at,
    payload: {
      action: event.event,
      pull_request: pullRequest,
      requested_reviewer: event.requested_reviewer,
      requested_team: event.requested_team,
      review_requester: event.review_requester,
    },
  };
}
