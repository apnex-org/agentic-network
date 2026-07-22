/**
 * Minimal GitHub API client for PollSource.
 *
 * Mission-52 T2. Three responsibilities:
 *   1. PAT auth + startup scope-validation (fail loud on under-scope)
 *   2. Repo-events polling with ETag conditional requests
 *   3. 429 / rate-limit header surfacing (Retry-After + X-RateLimit-
 *      Reset; the client doesn't sleep — caller honors)
 *
 * Design rationale: keep the client a thin wrapper. PollSource owns
 * cadence, backoff, and lifecycle; the client just translates HTTP
 * outcomes into typed values. `fetch` is injectable so tests stay
 * fast (no real HTTP server) and so the surface composes with
 * future webhook-source code that may share auth.
 *
 * Per thread-312 round-2 audit: 429 path is header-driven (Retry-
 * After / X-RateLimit-Reset). Generic transient failures are
 * surfaced as thrown `GhApiTransientError` for caller-side
 * exp-backoff. The two paths do not share a code path — keeping
 * them separate prevents the "exp-backoff after 429 → 429 storm OR
 * cursor lag" failure mode the audit called out.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface GhEventEnvelope {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly repo?: { name: string };
  readonly created_at: string;
}

export interface PollResult {
  readonly notModified: boolean;
  readonly events: GhEventEnvelope[];
  readonly etag?: string;
  /** Epoch seconds (from `X-RateLimit-Reset`); set on every successful poll. */
  readonly rateLimitReset?: number;
  /** Authenticated requests remaining in the current rate-limit window. */
  readonly rateLimitRemaining?: number;
}

/** Review-request lifecycle rows are exposed by the repository issue-events
 * endpoint, not by `/repos/:repo/events`.  The subset below is sufficient to
 * identify a PR and preserve reviewer/team assignment facts. */
export interface IssueEventEnvelope {
  readonly id: number | string;
  readonly event: string;
  readonly created_at: string;
  readonly actor?: { login?: string };
  readonly issue: {
    readonly number: number;
    readonly title?: string;
    readonly html_url?: string;
    readonly user?: { login?: string };
    readonly pull_request?: { url?: string; html_url?: string };
  };
  readonly requested_reviewer?: { login?: string };
  readonly requested_team?: { slug?: string; name?: string };
  readonly review_requester?: { login?: string };
}

export interface IssueEventsPollResult {
  readonly notModified: boolean;
  readonly events: IssueEventEnvelope[];
  readonly etag?: string;
  readonly rateLimitReset?: number;
  readonly rateLimitRemaining?: number;
}

/** Exact PR snapshot used to enrich issue-event rows before the existing
 * PullRequestEvent translator/Hub handler sees them. */
export interface PullRequestSnapshot {
  readonly number: number;
  readonly title?: string;
  readonly html_url?: string;
  readonly user?: { login?: string };
  readonly base?: { ref?: string; sha?: string };
  readonly head?: { ref?: string; sha?: string };
}

/**
 * One workflow run record as returned by `/repos/:owner/:repo/actions/runs`.
 * The Actions REST API shape — distinct from the WorkflowRunEvent webhook
 * envelope; idea-255 / M-Workflow-Run-Events-Hub-Integration §1.2 + F1
 * fold reframed to use this REST endpoint shape (workflow_run is webhook-
 * only on the /events API surface).
 *
 * Field subset preserves what the Hub-side translator + handler need —
 * full GH response is wider; ignored fields are not enumerated here.
 */
export interface WorkflowRun {
  readonly id: number;
  readonly name: string;
  readonly status: "queued" | "in_progress" | "completed" | string;
  readonly conclusion:
    | "success"
    | "failure"
    | "cancelled"
    | "skipped"
    | "neutral"
    | "timed_out"
    | "action_required"
    | "stale"
    | null;
  readonly event: string;
  readonly head_sha: string;
  readonly head_branch: string | null;
  readonly html_url: string;
  readonly run_started_at?: string;
  readonly updated_at: string;
  readonly created_at: string;
  readonly actor?: { login?: string };
  readonly triggering_actor?: { login?: string };
  readonly run_number?: number;
  readonly run_attempt?: number;
}

export interface WorkflowRunsResponse {
  readonly workflow_runs: WorkflowRun[];
  readonly total_count: number;
  /** Epoch seconds (from `X-RateLimit-Reset`); set on every successful poll. */
  readonly rateLimitReset?: number;
  /** Authenticated requests remaining in the current rate-limit window. */
  readonly rateLimitRemaining?: number;
}

/**
 * Thrown when the server signals throttling. `resumeAt` is an epoch
 * milliseconds timestamp computed from `Retry-After` (seconds) or
 * `X-RateLimit-Reset` (epoch seconds), preferring `Retry-After` when
 * both present (it's the explicit "wait this long" signal).
 */
export class GhApiRateLimitError extends Error {
  constructor(public readonly resumeAtMs: number) {
    super(`GitHub rate-limited; resume at ${new Date(resumeAtMs).toISOString()}`);
    this.name = "GhApiRateLimitError";
  }
}

/** Auth-failure (401/403 with no scope-context). Treat as terminal. */
export class GhApiAuthError extends Error {
  constructor(public readonly httpStatus: number, message: string) {
    super(`GitHub auth failed (${httpStatus}): ${message}`);
    this.name = "GhApiAuthError";
  }
}

/** Generic transient failure (5xx / network). Caller exp-backs-off. */
export class GhApiTransientError extends Error {
  constructor(public readonly httpStatus: number | null, message: string) {
    super(`GitHub transient error${httpStatus ? ` (${httpStatus})` : ""}: ${message}`);
    this.name = "GhApiTransientError";
  }
}

/** PAT lacks one or more required scopes (per `x-oauth-scopes`). */
export class PatScopeError extends Error {
  constructor(public readonly missing: string[], public readonly granted: string[]) {
    super(
      `PAT under-scoped: missing ${missing.join(", ")} ` +
        `(granted: ${granted.length > 0 ? granted.join(", ") : "<none>"})`,
    );
    this.name = "PatScopeError";
  }
}

// ── Client ────────────────────────────────────────────────────────────

export interface GhApiClientOptions {
  readonly token: string;
  /** Override for testing or GH Enterprise. Defaults to api.github.com. */
  readonly baseUrl?: string;
  /** UA per GH API guidelines. Defaults to "@apnex/repo-event-bridge/1.0". */
  readonly userAgent?: string;
  /** Injectable fetch (for tests). Defaults to globalThis.fetch. */
  readonly fetch?: typeof fetch;
}

/** Minimum scopes required by mission-52 T2 per directive. */
export const REQUIRED_PAT_SCOPES: readonly string[] = [
  "repo",
  "read:org",
  "read:user",
];

export class GhApiClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GhApiClientOptions) {
    if (!options.token) {
      throw new GhApiAuthError(0, "no PAT token provided");
    }
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
    this.userAgent = options.userAgent ?? "@apnex/repo-event-bridge/1.0";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("GhApiClient: fetch is not available; pass options.fetch");
    }
  }

  /**
   * Verify the PAT has the required scopes. Calls `GET /user`,
   * reads `x-oauth-scopes`, throws `PatScopeError` if any required
   * scope is missing. Throws `PatAuthError` on 401/403.
   *
   * GitHub's scope hierarchy: a token with `repo` implicitly has
   * the `public_repo` capability; we don't widen the required-set
   * for hierarchies — the directive's three scopes are the minimum.
   */
  async validateScopes(
    required: readonly string[] = REQUIRED_PAT_SCOPES,
  ): Promise<{ granted: string[] }> {
    const response = await this.fetchImpl(`${this.baseUrl}/user`, {
      headers: this.headers(),
    });
    if (response.status === 401 || response.status === 403) {
      throw new GhApiAuthError(response.status, await safeText(response));
    }
    if (!response.ok) {
      throw new GhApiTransientError(response.status, await safeText(response));
    }
    const scopesHeader = response.headers.get("x-oauth-scopes") ?? "";
    const granted = scopesHeader
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const missing = required.filter((s) => !granted.includes(s));
    if (missing.length > 0) {
      throw new PatScopeError(missing, granted);
    }
    return { granted };
  }

  /**
   * Poll one page of `/repos/:repoId/events`. `repoId` is the
   * `owner/name` form. ETag-conditional via `If-None-Match` — pass
   * the previous response's etag to get a 304 (no events) when the
   * timeline is unchanged.
   *
   * Outcomes:
   *   - 200 → events array + etag + rate-limit headers
   *   - 304 → notModified=true; no events
   *   - 401/403 → GhApiAuthError (terminal)
   *   - 429 → GhApiRateLimitError with resumeAtMs (header-driven)
   *   - 5xx / network → GhApiTransientError (caller exp-backs-off)
   */
  async pollRepoEvents(
    repoId: string,
    options: { etag?: string } = {},
  ): Promise<PollResult> {
    const url = `${this.baseUrl}/repos/${repoId}/events`;
    const headers = this.headers();
    if (options.etag) headers["if-none-match"] = options.etag;

    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers });
    } catch (err) {
      throw new GhApiTransientError(null, (err as Error)?.message ?? String(err));
    }

    if (response.status === 304) {
      return {
        notModified: true,
        events: [],
        etag: response.headers.get("etag") ?? options.etag,
        rateLimitReset: parseEpochSec(response.headers.get("x-ratelimit-reset")),
        rateLimitRemaining: parseInt(
          response.headers.get("x-ratelimit-remaining") ?? "",
          10,
        ),
      };
    }

    if (response.status === 429) {
      throw new GhApiRateLimitError(parseRateLimitResume(response.headers));
    }

    if (response.status === 401 || response.status === 403) {
      // 403 with x-ratelimit-remaining=0 is GH's "secondary rate limit"
      // — treat as 429-equivalent so the caller honors headers.
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (response.status === 403 && remaining === "0") {
        throw new GhApiRateLimitError(parseRateLimitResume(response.headers));
      }
      throw new GhApiAuthError(response.status, await safeText(response));
    }

    if (!response.ok) {
      throw new GhApiTransientError(response.status, await safeText(response));
    }

    const events = (await response.json()) as GhEventEnvelope[];
    return {
      notModified: false,
      events: Array.isArray(events) ? events : [],
      etag: response.headers.get("etag") ?? undefined,
      rateLimitReset: parseEpochSec(response.headers.get("x-ratelimit-reset")),
      rateLimitRemaining: parseInt(
        response.headers.get("x-ratelimit-remaining") ?? "",
        10,
      ),
    };
  }

  /** Poll review-request lifecycle from `/repos/:repoId/issues/events`.
   * GitHub's repository `/events` feed does not expose these assignment
   * transitions. ETag + persisted source dedupe make this endpoint restart-safe.
   */
  async pollIssueEvents(
    repoId: string,
    options: { etag?: string; perPage?: number } = {},
  ): Promise<IssueEventsPollResult> {
    const url = `${this.baseUrl}/repos/${repoId}/issues/events?per_page=${options.perPage ?? 100}`;
    const headers = this.headers();
    if (options.etag) headers["if-none-match"] = options.etag;
    const response = await this.fetchResponse(url, headers);
    if (response.status === 304) {
      return {
        notModified: true,
        events: [],
        etag: response.headers.get("etag") ?? options.etag,
        rateLimitReset: parseEpochSec(response.headers.get("x-ratelimit-reset")),
        rateLimitRemaining: parseInt(response.headers.get("x-ratelimit-remaining") ?? "", 10),
      };
    }
    await this.assertPollResponse(response);
    const body = (await response.json()) as unknown;
    return {
      notModified: false,
      events: Array.isArray(body) ? body as IssueEventEnvelope[] : [],
      etag: response.headers.get("etag") ?? undefined,
      rateLimitReset: parseEpochSec(response.headers.get("x-ratelimit-reset")),
      rateLimitRemaining: parseInt(response.headers.get("x-ratelimit-remaining") ?? "", 10),
    };
  }

  /** Fetch the exact head/base/author snapshot missing from issue-event rows. */
  async getPullRequest(repoId: string, prNumber: number): Promise<PullRequestSnapshot> {
    const response = await this.fetchResponse(
      `${this.baseUrl}/repos/${repoId}/pulls/${prNumber}`,
      this.headers(),
    );
    await this.assertPollResponse(response);
    return (await response.json()) as PullRequestSnapshot;
  }

  /**
   * Poll `/repos/:repoId/actions/runs` for workflow runs.
   * idea-255 / M-Workflow-Run-Events-Hub-Integration F1 fold: workflow_run is
   * NOT in the /events API; this is the REST equivalent. No ETag conditional-
   * GET flow — caller filters server-side via `created` query param + LRU
   * dedupes on run.id.
   *
   * Outcomes:
   *   - 200 → workflow_runs array + rate-limit headers
   *   - 401/403 → GhApiAuthError (terminal)
   *   - 429 → GhApiRateLimitError with resumeAtMs (header-driven)
   *   - 5xx / network → GhApiTransientError (caller exp-backs-off)
   */
  async pollWorkflowRuns(
    repoId: string,
    options: { createdSince?: string; perPage?: number } = {},
  ): Promise<WorkflowRunsResponse> {
    const params = new URLSearchParams();
    params.set("per_page", String(options.perPage ?? 50));
    if (options.createdSince) {
      params.set("created", `>=${options.createdSince}`);
    }
    const url = `${this.baseUrl}/repos/${repoId}/actions/runs?${params.toString()}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: this.headers() });
    } catch (err) {
      throw new GhApiTransientError(null, (err as Error)?.message ?? String(err));
    }

    if (response.status === 429) {
      throw new GhApiRateLimitError(parseRateLimitResume(response.headers));
    }

    if (response.status === 401 || response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (response.status === 403 && remaining === "0") {
        throw new GhApiRateLimitError(parseRateLimitResume(response.headers));
      }
      throw new GhApiAuthError(response.status, await safeText(response));
    }

    if (!response.ok) {
      throw new GhApiTransientError(response.status, await safeText(response));
    }

    const body = (await response.json()) as {
      workflow_runs?: WorkflowRun[];
      total_count?: number;
    };
    return {
      workflow_runs: Array.isArray(body.workflow_runs) ? body.workflow_runs : [],
      total_count: typeof body.total_count === "number" ? body.total_count : 0,
      rateLimitReset: parseEpochSec(response.headers.get("x-ratelimit-reset")),
      rateLimitRemaining: parseInt(
        response.headers.get("x-ratelimit-remaining") ?? "",
        10,
      ),
    };
  }

  private async fetchResponse(url: string, headers: Record<string, string>): Promise<Response> {
    try {
      return await this.fetchImpl(url, { headers });
    } catch (err) {
      throw new GhApiTransientError(null, (err as Error)?.message ?? String(err));
    }
  }

  private async assertPollResponse(response: Response): Promise<void> {
    if (response.status === 429) {
      throw new GhApiRateLimitError(parseRateLimitResume(response.headers));
    }
    if (response.status === 401 || response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      if (response.status === 403 && remaining === "0") {
        throw new GhApiRateLimitError(parseRateLimitResume(response.headers));
      }
      throw new GhApiAuthError(response.status, await safeText(response));
    }
    if (!response.ok) {
      throw new GhApiTransientError(response.status, await safeText(response));
    }
  }

  private headers(): Record<string, string> {
    return {
      authorization: `token ${this.token}`,
      "user-agent": this.userAgent,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    };
  }
}

// ── Header parsing helpers (exported for tests) ──────────────────────

export function parseRateLimitResume(headers: Headers): number {
  // Prefer Retry-After (explicit "wait this many seconds"); fall back
  // to X-RateLimit-Reset (epoch seconds). Both honored per directive.
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = parseInt(retryAfter, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Date.now() + seconds * 1000;
    }
  }
  const reset = headers.get("x-ratelimit-reset");
  if (reset !== null) {
    const epochSec = parseInt(reset, 10);
    if (Number.isFinite(epochSec) && epochSec > 0) {
      return epochSec * 1000;
    }
  }
  // Fallback: 60s — neither header parsed cleanly. Conservative;
  // PollSource health-flags the source so operator can investigate.
  return Date.now() + 60_000;
}

function parseEpochSec(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable response body>";
  }
}
