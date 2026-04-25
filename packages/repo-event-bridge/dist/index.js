/**
 * @ois/repo-event-bridge — sovereign repo-event bridge package.
 *
 * Mission-52 T1. EventSource pluggable contract + GH-event translator
 * + create_message sink stub for the OIS agentic network. See
 * README.md for the contract overview and thread-312 design provenance.
 */
export { REPO_EVENT_SUBKINDS, translateGhEvent, dispatchSubkind, normalizeGhEvent, } from "./translator.js";
export { CreateMessageSink } from "./sink.js";
// ── PollSource (T2) ──────────────────────────────────────────────────
export { CursorStore, CursorStoreConflictError, mergeLru } from "./cursor-store.js";
export { GhApiClient, GhApiAuthError, GhApiRateLimitError, GhApiTransientError, PatScopeError, REQUIRED_PAT_SCOPES, parseRateLimitResume, } from "./gh-api-client.js";
export { PollSource, GH_PAT_RATE_LIMIT_PER_HOUR, DEFAULT_CADENCE_SECONDS, DEFAULT_BUDGET_FRACTION, } from "./poll-source.js";
//# sourceMappingURL=index.js.map