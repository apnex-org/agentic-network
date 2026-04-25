/**
 * GH-event → message-shape translator.
 *
 * Mission-52 T1. Pure, transport-agnostic. Inputs are GitHub event
 * envelopes (the shape returned by GitHub's Events API: `{type, payload}`,
 * also produced by the Webhooks delivery shape with the `X-GitHub-Event`
 * header value as `type`); outputs are sink-ready `RepoEvent` envelopes
 * with `kind: "repo-event"`, a normalized `subkind`, and a v1 payload.
 *
 * Subkind taxonomy (v1; see README for evolution policy):
 *   - `pr-opened` / `pr-closed` / `pr-merged`
 *       Pull-request lifecycle. `pr-merged` distinguishes merge vs.
 *       plain close (closed-without-merge → `pr-closed`).
 *   - `pr-review-submitted` / `pr-review-approved` / `pr-review-comment`
 *       Review lifecycle. `pr-review-approved` is split out so
 *       merge-gate consumers can dispatch cheaply; `pr-review-comment`
 *       covers in-line review comments; `pr-review-submitted` covers
 *       the residual "changes_requested" / generic-comment review
 *       state.
 *   - `commit-pushed`
 *       Push event (one or more commits to a ref).
 *   - `unknown`
 *       Graceful-degrade fallback for unrecognized event types or
 *       malformed shapes. The original payload is preserved verbatim
 *       in `payload.raw` so the Hub can log + alert on rising
 *       unknown-rate without losing forensics.
 *
 * Architectural rationale (per thread-312 round-2): keeping `kind`
 * fixed at `"repo-event"` and pushing per-type semantics into `subkind`
 * keeps the sink-side routing surface clean — sinks dispatch on `kind`
 * (one router entry per envelope shape), while per-type business
 * logic dispatches on `subkind` (extensible without touching the
 * router). The `unknown` subkind is the load-bearing fallback that
 * makes the surface forward-compatible: a new GH event type doesn't
 * break ingestion, it just lands as `unknown` until the translator is
 * extended.
 *
 * v1 payload normalization is deliberately minimal — enough to drive
 * the initial Hub-side dispatch (T3) without locking schemas
 * downstream. Translator-schema-evolution is a tracked future-mission
 * seed (per mission-52 T5 closing audit).
 */
import type { RepoEvent } from "./event-source.js";
export declare const REPO_EVENT_SUBKINDS: readonly ["pr-opened", "pr-closed", "pr-merged", "pr-review-submitted", "pr-review-approved", "pr-review-comment", "commit-pushed", "unknown"];
export type RepoEventSubkind = (typeof REPO_EVENT_SUBKINDS)[number];
/**
 * Translate a raw GH event envelope into the sink-ready `RepoEvent`
 * shape. Total function — never throws; unrecognized inputs become
 * `subkind: "unknown"` with the raw payload preserved.
 */
export declare function translateGhEvent(ghEvent: unknown): RepoEvent;
/**
 * Inspect a GH event envelope and return the canonical subkind. Pure;
 * does not normalize payload. Exported so consumers (PollSource, sink
 * dispatchers, tests) can dispatch without re-running the full
 * translator.
 */
export declare function dispatchSubkind(ghEvent: unknown): RepoEventSubkind;
/**
 * Extract a stable, sink-friendly v1 payload from a GH event. The
 * shape is per-subkind; consumers should switch on the parent
 * `RepoEvent.subkind` before reading fields. For `unknown`, the
 * original input is preserved under `raw` so downstream consumers
 * can still introspect / log / alert.
 */
export declare function normalizeGhEvent(ghEvent: unknown, subkind: RepoEventSubkind): Record<string, unknown>;
