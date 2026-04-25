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
export interface GhEventEnvelope {
    readonly id: string;
    readonly type: string;
    readonly payload: unknown;
    readonly repo?: {
        name: string;
    };
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
/**
 * Thrown when the server signals throttling. `resumeAt` is an epoch
 * milliseconds timestamp computed from `Retry-After` (seconds) or
 * `X-RateLimit-Reset` (epoch seconds), preferring `Retry-After` when
 * both present (it's the explicit "wait this long" signal).
 */
export declare class GhApiRateLimitError extends Error {
    readonly resumeAtMs: number;
    constructor(resumeAtMs: number);
}
/** Auth-failure (401/403 with no scope-context). Treat as terminal. */
export declare class GhApiAuthError extends Error {
    readonly httpStatus: number;
    constructor(httpStatus: number, message: string);
}
/** Generic transient failure (5xx / network). Caller exp-backs-off. */
export declare class GhApiTransientError extends Error {
    readonly httpStatus: number | null;
    constructor(httpStatus: number | null, message: string);
}
/** PAT lacks one or more required scopes (per `x-oauth-scopes`). */
export declare class PatScopeError extends Error {
    readonly missing: string[];
    readonly granted: string[];
    constructor(missing: string[], granted: string[]);
}
export interface GhApiClientOptions {
    readonly token: string;
    /** Override for testing or GH Enterprise. Defaults to api.github.com. */
    readonly baseUrl?: string;
    /** UA per GH API guidelines. Defaults to "@ois/repo-event-bridge/1.0". */
    readonly userAgent?: string;
    /** Injectable fetch (for tests). Defaults to globalThis.fetch. */
    readonly fetch?: typeof fetch;
}
/** Minimum scopes required by mission-52 T2 per directive. */
export declare const REQUIRED_PAT_SCOPES: readonly string[];
export declare class GhApiClient {
    private readonly token;
    private readonly baseUrl;
    private readonly userAgent;
    private readonly fetchImpl;
    constructor(options: GhApiClientOptions);
    /**
     * Verify the PAT has the required scopes. Calls `GET /user`,
     * reads `x-oauth-scopes`, throws `PatScopeError` if any required
     * scope is missing. Throws `PatAuthError` on 401/403.
     *
     * GitHub's scope hierarchy: a token with `repo` implicitly has
     * the `public_repo` capability; we don't widen the required-set
     * for hierarchies — the directive's three scopes are the minimum.
     */
    validateScopes(required?: readonly string[]): Promise<{
        granted: string[];
    }>;
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
    pollRepoEvents(repoId: string, options?: {
        etag?: string;
    }): Promise<PollResult>;
    private headers;
}
export declare function parseRateLimitResume(headers: Headers): number;
