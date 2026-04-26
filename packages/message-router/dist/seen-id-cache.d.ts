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
export interface SeenIdCacheOptions {
    /** Override capacity. If omitted, env-var → default fallback. */
    capacity?: number;
}
export declare class SeenIdCache {
    private readonly capacity;
    private readonly entries;
    constructor(options?: SeenIdCacheOptions);
    /**
     * Record a sighting of `id`. Returns `true` if this is the first time
     * the id has been seen (caller should proceed); returns `false` if
     * the id is already in the cache (caller should short-circuit).
     *
     * Map insertion order acts as the LRU — re-seeing an id refreshes it
     * by re-inserting at the tail. Eviction removes the oldest key when
     * the size exceeds capacity.
     */
    markSeen(id: string): boolean;
    /** Visibility for diagnostics + tests. */
    size(): number;
    /** Visibility for diagnostics + tests. */
    getCapacity(): number;
}
