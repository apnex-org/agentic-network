import type { HubStorageSubstrate, ListOptions } from "./types.js";

/** Substrate's hard per-call list cap. */
export const COMPLETE_LIST_PAGE_SIZE = 500;
/**
 * Safety ceiling for a single aggregate dimension. Reaching it is never silent:
 * callers receive complete=false + nextOffset and must surface truncation.
 */
export const COMPLETE_LIST_MAX_ITEMS = 10_000;

export type CompleteListStopReason = "snapshot_changed" | "safety_limit" | "caller_agent_unavailable";

export interface CompleteListPageInfo {
  /** True only when the terminal short page was read at one stable high-water. */
  complete: boolean;
  /** Loud inverse of complete, convenient for outward projections. */
  truncated: boolean;
  /** Items actually reconstructed from stable pages. */
  returnedCount: number;
  /** Exact count when complete; null when only a partial reconstruction is safe. */
  exactCount: number | null;
  /** Number of substrate.list calls admitted for this dimension. */
  pagesRead: number;
  pageSize: number;
  /** High-water shared by every accepted page. */
  snapshotRevision: string;
  /** Caller-supplied aggregate high-water, when this dimension joins one. */
  expectedRevision: string | null;
  /** Revision returned by the last inspected page (diagnoses a mismatch loudly). */
  observedRevision: string;
  /** First unread offset when incomplete. */
  nextOffset: number | null;
  reason: CompleteListStopReason | null;
}

export interface CompleteListResult<T> {
  items: T[];
  pageInfo: CompleteListPageInfo;
}

export interface CompleteListConfig {
  pageSize?: number;
  maxItems?: number;
  /**
   * Aggregate snapshot contract: the FIRST and every later page must equal this
   * high-water. A mismatch accepts zero rows from the mismatching page and is
   * returned as loud snapshot_changed, so a caller can retry the WHOLE aggregate.
   */
  expectedRevision?: string;
}

/**
 * Reconstruct a filtered kind beyond substrate.list's 500-row cap without
 * pretending offset paging is snapshot-safe.
 *
 * Every page is ordered by the immutable entity id and must report the SAME
 * substrate-wide high-water. A concurrent write changes that high-water; the
 * helper then stops before mixing snapshots and returns an explicit resumable
 * truncation receipt. When expectedRevision is supplied, the first page is also
 * fenced to the aggregate caller's high-water: this closes the cross-dimension
 * gap where five individually stable reads could describe no single snapshot.
 * A safety ceiling is likewise loud. Read-only callers can therefore return an
 * exact count/result or an honest partial projection — never a silently capped
 * 500-row array or a locally-exact dimension from the wrong aggregate revision.
 */
export async function listCompleteStable<T>(
  substrate: HubStorageSubstrate,
  kind: string,
  opts: Omit<ListOptions, "limit" | "offset" | "sort"> = {},
  config: CompleteListConfig = {},
): Promise<CompleteListResult<T>> {
  const pageSize = normalizePageSize(config.pageSize);
  const maxItems = normalizeMaxItems(config.maxItems, pageSize);
  const items: T[] = [];
  let snapshotRevision: string | null = null;
  let pagesRead = 0;
  let offset = 0;

  while (true) {
    const page = await substrate.list<T>(kind, {
      ...opts,
      // id is immutable and unique within kind. Postgres maps this reserved
      // envelope field to the canonical id column for an indexed stable order.
      sort: [{ field: "id", order: "asc" }],
      limit: pageSize,
      offset,
    });
    pagesRead++;

    const requiredRevision = config.expectedRevision ?? snapshotRevision;
    if (requiredRevision !== null && page.snapshotRevision !== requiredRevision) {
      return incomplete(
        items,
        pagesRead,
        pageSize,
        requiredRevision,
        page.snapshotRevision,
        offset,
        "snapshot_changed",
        config.expectedRevision ?? null,
      );
    }
    if (snapshotRevision === null) snapshotRevision = page.snapshotRevision;

    items.push(...page.items);
    offset += page.items.length;

    // A short page, including the empty page after an exact multiple of 500,
    // proves the filtered result was fully reconstructed.
    if (page.items.length < pageSize) {
      return {
        items,
        pageInfo: {
          complete: true,
          truncated: false,
          returnedCount: items.length,
          exactCount: items.length,
          pagesRead,
          pageSize,
          snapshotRevision: snapshotRevision ?? page.snapshotRevision,
          expectedRevision: config.expectedRevision ?? null,
          observedRevision: page.snapshotRevision,
          nextOffset: null,
          reason: null,
        },
      };
    }

    if (items.length >= maxItems) {
      return incomplete(
        items,
        pagesRead,
        pageSize,
        snapshotRevision ?? page.snapshotRevision,
        page.snapshotRevision,
        offset,
        "safety_limit",
        config.expectedRevision ?? null,
      );
    }
  }
}

function incomplete<T>(
  items: T[],
  pagesRead: number,
  pageSize: number,
  snapshotRevision: string,
  observedRevision: string,
  nextOffset: number,
  reason: CompleteListStopReason,
  expectedRevision: string | null,
): CompleteListResult<T> {
  return {
    items,
    pageInfo: {
      complete: false,
      truncated: true,
      returnedCount: items.length,
      exactCount: null,
      pagesRead,
      pageSize,
      snapshotRevision,
      expectedRevision,
      observedRevision,
      nextOffset,
      reason,
    },
  };
}

function normalizePageSize(value: number | undefined): number {
  if (value === undefined) return COMPLETE_LIST_PAGE_SIZE;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`complete-list pageSize must be a positive integer (got ${value})`);
  }
  return Math.min(value, COMPLETE_LIST_PAGE_SIZE);
}

function normalizeMaxItems(value: number | undefined, pageSize: number): number {
  const candidate = value ?? COMPLETE_LIST_MAX_ITEMS;
  if (!Number.isInteger(candidate) || candidate < pageSize) {
    throw new Error(`complete-list maxItems must be an integer >= pageSize (got ${candidate})`);
  }
  // Stop only at a page boundary so nextOffset is unambiguous.
  return Math.floor(candidate / pageSize) * pageSize;
}
