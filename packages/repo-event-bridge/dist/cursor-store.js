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
import { hasGetWithToken, } from "@ois/storage-provider";
// ── Errors ────────────────────────────────────────────────────────────
export class CursorStoreConflictError extends Error {
    path;
    constructor(path) {
        super(`Cursor-store conflict on ${path}; caller should reload + retry`);
        this.path = path;
        this.name = "CursorStoreConflictError";
    }
}
export class CursorStore {
    storage;
    dedupeCapacity;
    pathPrefix;
    enc = new TextEncoder();
    dec = new TextDecoder();
    constructor(options) {
        this.storage = options.storage;
        this.dedupeCapacity = options.dedupeCapacity ?? 1000;
        this.pathPrefix = options.pathPrefix ?? "repo-event-bridge";
    }
    // ── Cursor ──────────────────────────────────────────────────────
    /**
     * Read the current cursor for a repo. Returns `{value: null,
     * token: null}` on first observation. Caller should pass the
     * token back into `writeCursor` for atomic update.
     */
    async readCursor(repoId) {
        return this.readJson(this.cursorPath(repoId));
    }
    /**
     * Write the cursor atomically. `ifMatchToken === null` means
     * first-write — uses `createOnly`. Returns the new token on
     * success, or throws `CursorStoreConflictError` on contention
     * so callers can reload + retry.
     */
    async writeCursor(repoId, cursor, ifMatchToken) {
        const path = this.cursorPath(repoId);
        const data = this.enc.encode(JSON.stringify(cursor));
        if (ifMatchToken === null) {
            const result = await this.storage.createOnly(path, data);
            if (!result.ok)
                throw new CursorStoreConflictError(path);
            // Follow-up read to recover the new token so callers can
            // chain into putIfMatch on subsequent writes without an
            // extra round-trip on the hot path.
            const reread = await this.readJson(path);
            return reread.token;
        }
        const result = await this.storage.putIfMatch(path, data, ifMatchToken);
        if (!result.ok)
            throw new CursorStoreConflictError(path);
        return result.newToken;
    }
    // ── Dedupe LRU ─────────────────────────────────────────────────
    /**
     * Filter event IDs against the per-repo dedupe set. Returns the
     * unseen subset (in input order) and a token suitable for
     * passing back into `markSeen`. Empty result means every input
     * id has already been emitted — caller should skip further work.
     */
    async filterUnseen(repoId, candidateIds) {
        const { value, token } = await this.readDedupe(repoId);
        const seen = new Set(value?.ids ?? []);
        const unseen = candidateIds.filter((id) => !seen.has(id));
        return { unseen, token };
    }
    /**
     * Mark IDs as seen. Bounded LRU: when capacity is exceeded, the
     * oldest entries are dropped. Atomic via `putIfMatch`; throws
     * `CursorStoreConflictError` on contention so callers can retry.
     * `ifMatchToken === null` means first-write (createOnly path).
     */
    async markSeen(repoId, ids, ifMatchToken) {
        if (ids.length === 0)
            return ifMatchToken;
        const path = this.dedupePath(repoId);
        // Read existing for merge — we want LRU "most-recent-last" order
        // so the oldest entries fall off when capacity is hit.
        const { value } = await this.readDedupe(repoId);
        const merged = mergeLru(value?.ids ?? [], ids, this.dedupeCapacity);
        const record = {
            ids: merged,
            updatedAt: new Date().toISOString(),
        };
        const data = this.enc.encode(JSON.stringify(record));
        if (ifMatchToken === null) {
            const result = await this.storage.createOnly(path, data);
            if (!result.ok)
                throw new CursorStoreConflictError(path);
            const reread = await this.readJson(path);
            return reread.token;
        }
        const result = await this.storage.putIfMatch(path, data, ifMatchToken);
        if (!result.ok)
            throw new CursorStoreConflictError(path);
        return result.newToken;
    }
    // ── Internals ──────────────────────────────────────────────────
    async readJson(path) {
        if (hasGetWithToken(this.storage)) {
            const raw = await this.storage.getWithToken(path);
            if (!raw)
                return { value: null, token: null };
            return {
                value: JSON.parse(this.dec.decode(raw.data)),
                token: raw.token,
            };
        }
        const data = await this.storage.get(path);
        if (!data)
            return { value: null, token: null };
        return {
            value: JSON.parse(this.dec.decode(data)),
            token: null,
        };
    }
    async readDedupe(repoId) {
        return this.readJson(this.dedupePath(repoId));
    }
    cursorPath(repoId) {
        return `${this.pathPrefix}/cursor/${repoId}.json`;
    }
    dedupePath(repoId) {
        return `${this.pathPrefix}/dedupe/${repoId}.json`;
    }
}
// ── LRU merge helper (exported for tests) ────────────────────────────
/**
 * Append new ids to existing list with LRU bounded retention. New
 * ids land at the tail (most-recent-last); when total length exceeds
 * `capacity`, the oldest entries (at the head) are dropped. Existing
 * ids that re-appear in `incoming` are deduped — the appearance moves
 * them to the tail (their LRU position refreshes).
 */
export function mergeLru(existing, incoming, capacity) {
    if (capacity <= 0)
        return [];
    const incomingSet = new Set(incoming);
    // Drop existing entries that re-appear in incoming so we can
    // re-append them at the tail (touch-on-access semantics).
    const filtered = existing.filter((id) => !incomingSet.has(id));
    const merged = [...filtered, ...incoming];
    return merged.length <= capacity ? merged : merged.slice(merged.length - capacity);
}
//# sourceMappingURL=cursor-store.js.map