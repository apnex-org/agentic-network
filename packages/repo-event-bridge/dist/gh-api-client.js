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
/**
 * Thrown when the server signals throttling. `resumeAt` is an epoch
 * milliseconds timestamp computed from `Retry-After` (seconds) or
 * `X-RateLimit-Reset` (epoch seconds), preferring `Retry-After` when
 * both present (it's the explicit "wait this long" signal).
 */
export class GhApiRateLimitError extends Error {
    resumeAtMs;
    constructor(resumeAtMs) {
        super(`GitHub rate-limited; resume at ${new Date(resumeAtMs).toISOString()}`);
        this.resumeAtMs = resumeAtMs;
        this.name = "GhApiRateLimitError";
    }
}
/** Auth-failure (401/403 with no scope-context). Treat as terminal. */
export class GhApiAuthError extends Error {
    httpStatus;
    constructor(httpStatus, message) {
        super(`GitHub auth failed (${httpStatus}): ${message}`);
        this.httpStatus = httpStatus;
        this.name = "GhApiAuthError";
    }
}
/** Generic transient failure (5xx / network). Caller exp-backs-off. */
export class GhApiTransientError extends Error {
    httpStatus;
    constructor(httpStatus, message) {
        super(`GitHub transient error${httpStatus ? ` (${httpStatus})` : ""}: ${message}`);
        this.httpStatus = httpStatus;
        this.name = "GhApiTransientError";
    }
}
/** PAT lacks one or more required scopes (per `x-oauth-scopes`). */
export class PatScopeError extends Error {
    missing;
    granted;
    constructor(missing, granted) {
        super(`PAT under-scoped: missing ${missing.join(", ")} ` +
            `(granted: ${granted.length > 0 ? granted.join(", ") : "<none>"})`);
        this.missing = missing;
        this.granted = granted;
        this.name = "PatScopeError";
    }
}
/** Minimum scopes required by mission-52 T2 per directive. */
export const REQUIRED_PAT_SCOPES = [
    "repo",
    "read:org",
    "read:user",
];
export class GhApiClient {
    token;
    baseUrl;
    userAgent;
    fetchImpl;
    constructor(options) {
        if (!options.token) {
            throw new GhApiAuthError(0, "no PAT token provided");
        }
        this.token = options.token;
        this.baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
        this.userAgent = options.userAgent ?? "@ois/repo-event-bridge/1.0";
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
    async validateScopes(required = REQUIRED_PAT_SCOPES) {
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
    async pollRepoEvents(repoId, options = {}) {
        const url = `${this.baseUrl}/repos/${repoId}/events`;
        const headers = this.headers();
        if (options.etag)
            headers["if-none-match"] = options.etag;
        let response;
        try {
            response = await this.fetchImpl(url, { headers });
        }
        catch (err) {
            throw new GhApiTransientError(null, err?.message ?? String(err));
        }
        if (response.status === 304) {
            return {
                notModified: true,
                events: [],
                etag: response.headers.get("etag") ?? options.etag,
                rateLimitReset: parseEpochSec(response.headers.get("x-ratelimit-reset")),
                rateLimitRemaining: parseInt(response.headers.get("x-ratelimit-remaining") ?? "", 10),
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
        const events = (await response.json());
        return {
            notModified: false,
            events: Array.isArray(events) ? events : [],
            etag: response.headers.get("etag") ?? undefined,
            rateLimitReset: parseEpochSec(response.headers.get("x-ratelimit-reset")),
            rateLimitRemaining: parseInt(response.headers.get("x-ratelimit-remaining") ?? "", 10),
        };
    }
    headers() {
        return {
            authorization: `token ${this.token}`,
            "user-agent": this.userAgent,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
        };
    }
}
// ── Header parsing helpers (exported for tests) ──────────────────────
export function parseRateLimitResume(headers) {
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
function parseEpochSec(value) {
    if (value === null)
        return undefined;
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
}
async function safeText(response) {
    try {
        return await response.text();
    }
    catch {
        return "<unreadable response body>";
    }
}
//# sourceMappingURL=gh-api-client.js.map