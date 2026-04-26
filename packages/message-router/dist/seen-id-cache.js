/**
 * Seen-id LRU cache — Layer 2 dedup invariant for push+poll race.
 *
 * Design v1.2 §"Architectural commitments #4". The Hub may deliver the
 * same Message ID twice (push via SSE + hybrid poll backstop in W3+);
 * the router short-circuits on duplicate sightings via this bounded LRU.
 *
 * Default capacity: 1000. Override via `OIS_ADAPTER_SEEN_ID_CACHE_N`
 * (read at construction time; non-positive / non-numeric values fall
 * back to the default).
 */
const DEFAULT_CAPACITY = 1000;
const ENV_OVERRIDE_VAR = "OIS_ADAPTER_SEEN_ID_CACHE_N";
export class SeenIdCache {
    capacity;
    entries = new Map();
    constructor(options = {}) {
        this.capacity = resolveCapacity(options.capacity);
    }
    /**
     * Record a sighting of `id`. Returns `true` if this is the first time
     * the id has been seen (caller should proceed); returns `false` if
     * the id is already in the cache (caller should short-circuit).
     *
     * Map insertion order acts as the LRU — re-seeing an id refreshes it
     * by re-inserting at the tail. Eviction removes the oldest key when
     * the size exceeds capacity.
     */
    markSeen(id) {
        if (this.entries.has(id)) {
            this.entries.delete(id);
            this.entries.set(id, true);
            return false;
        }
        this.entries.set(id, true);
        if (this.entries.size > this.capacity) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) {
                this.entries.delete(oldest);
            }
        }
        return true;
    }
    /** Visibility for diagnostics + tests. */
    size() {
        return this.entries.size;
    }
    /** Visibility for diagnostics + tests. */
    getCapacity() {
        return this.capacity;
    }
}
function resolveCapacity(explicit) {
    if (explicit !== undefined) {
        return explicit > 0 ? explicit : DEFAULT_CAPACITY;
    }
    const raw = process.env[ENV_OVERRIDE_VAR];
    if (raw === undefined || raw === "")
        return DEFAULT_CAPACITY;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return DEFAULT_CAPACITY;
    return Math.floor(parsed);
}
//# sourceMappingURL=seen-id-cache.js.map