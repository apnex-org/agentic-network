/**
 * Cursor + dedupe persistence for PollSource.
 *
 * Mission-52 T2. Wraps `@ois/storage-provider` to hold per-repo
 * pagination cursor + bounded recent-event-id LRU dedupe set.
 * Survives Hub restart — cursor + dedupe state are storage-backed
 * (eats own dogfood per audit-emerged commitment).
 *
 * Storage layout:
 *   repo-event-bridge/cursor/<owner>/<repo>.json
 *     { etag, lastEventId, updatedAt }
 *   repo-event-bridge/dedupe/<owner>/<repo>.json
 *     { ids: string[], updatedAt }   // LRU; bounded by capacity
 *
 * Dedupe semantics: GH's `/repos/:owner/:repo/events` endpoint
 * returns up to 30 events per page; ETag-conditional requests get
 * a 304 when the timeline is unchanged. On overlapping polling
 * windows (or when the consumer races a scheduled poll), the same
 * event id may appear twice. The bounded LRU rejects the duplicate
 * before it reaches the sink. Capacity defaults to 1000 ids/repo;
 * GH's repo-events backlog fits comfortably (90 events × 30 retention
 * worst-case under heavy traffic).
 *
 * Atomicity: cursor writes use `putIfMatch` so overlapping pollers
 * (or replay paths) can't clobber each other. A `createOnly` falls
 * back from `putIfMatch` for first-write per repo. Tokens are opaque
 * per StorageProvider contract.
 */
import { type StorageProvider } from "@ois/storage-provider";
/**
 * Per-repo pagination cursor. Source-defined opaque shape — the
 * cursor-store doesn't interpret these fields. PollSource writes
 * `etag` (from `If-None-Match` flow) + `lastEventId` (most recent
 * upstream id observed); both are advisory for the polling loop
 * and can be reconstructed from the dedupe set if lost.
 */
export interface RepoCursor {
    etag?: string;
    lastEventId?: string;
    updatedAt: string;
}
interface ReadResult<T> {
    value: T | null;
    token: string | null;
}
export declare class CursorStoreConflictError extends Error {
    readonly path: string;
    constructor(path: string);
}
export interface CursorStoreOptions {
    readonly storage: StorageProvider;
    readonly dedupeCapacity?: number;
    readonly pathPrefix?: string;
}
export declare class CursorStore {
    private readonly storage;
    private readonly dedupeCapacity;
    private readonly pathPrefix;
    private readonly enc;
    private readonly dec;
    constructor(options: CursorStoreOptions);
    /**
     * Read the current cursor for a repo. Returns `{value: null,
     * token: null}` on first observation. Caller should pass the
     * token back into `writeCursor` for atomic update.
     */
    readCursor(repoId: string): Promise<ReadResult<RepoCursor>>;
    /**
     * Write the cursor atomically. `ifMatchToken === null` means
     * first-write — uses `createOnly`. Returns the new token on
     * success, or throws `CursorStoreConflictError` on contention
     * so callers can reload + retry.
     */
    writeCursor(repoId: string, cursor: RepoCursor, ifMatchToken: string | null): Promise<string | null>;
    /**
     * Filter event IDs against the per-repo dedupe set. Returns the
     * unseen subset (in input order) and a token suitable for
     * passing back into `markSeen`. Empty result means every input
     * id has already been emitted — caller should skip further work.
     */
    filterUnseen(repoId: string, candidateIds: readonly string[]): Promise<{
        unseen: string[];
        token: string | null;
    }>;
    /**
     * Mark IDs as seen. Bounded LRU: when capacity is exceeded, the
     * oldest entries are dropped. Atomic via `putIfMatch`; throws
     * `CursorStoreConflictError` on contention so callers can retry.
     * `ifMatchToken === null` means first-write (createOnly path).
     */
    markSeen(repoId: string, ids: readonly string[], ifMatchToken: string | null): Promise<string | null>;
    private readJson;
    private readDedupe;
    private cursorPath;
    private dedupePath;
}
/**
 * Append new ids to existing list with LRU bounded retention. New
 * ids land at the tail (most-recent-last); when total length exceeds
 * `capacity`, the oldest entries (at the head) are dropped. Existing
 * ids that re-appear in `incoming` are deduped — the appearance moves
 * them to the tail (their LRU position refreshes).
 */
export declare function mergeLru(existing: readonly string[], incoming: readonly string[], capacity: number): string[];
export {};
