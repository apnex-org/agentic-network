import { describe, expect, it } from "vitest";
import type { HubStorageSubstrate, ListOptions } from "../types.js";
import { listCompleteStable } from "../complete-list.js";

function pagingSubstrate(total: number, revisionForPage: (offset: number) => string): HubStorageSubstrate {
  const all = Array.from({ length: total }, (_, i) => ({ id: `row-${String(i).padStart(5, "0")}` }));
  return {
    list: async <T>(_kind: string, opts: ListOptions = {}) => {
      const offset = opts.offset ?? 0;
      const limit = Math.min(opts.limit ?? 100, 500);
      return {
        items: all.slice(offset, offset + limit) as T[],
        snapshotRevision: revisionForPage(offset),
      };
    },
  } as unknown as HubStorageSubstrate;
}

describe("bug-343 successor stable complete paging", () => {
  it("reconstructs 675 rows beyond the substrate cap with an exact count", async () => {
    const result = await listCompleteStable<{ id: string }>(pagingSubstrate(675, () => "rv-1"), "Proposal");

    expect(result.items).toHaveLength(675);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(675);
    expect(result.pageInfo).toEqual({
      complete: true,
      truncated: false,
      returnedCount: 675,
      exactCount: 675,
      pagesRead: 2,
      pageSize: 500,
      snapshotRevision: "rv-1",
      expectedRevision: null,
      observedRevision: "rv-1",
      nextOffset: null,
      reason: null,
    });
  });

  it("fails loud before mixing pages when the substrate high-water changes", async () => {
    const result = await listCompleteStable<{ id: string }>(
      pagingSubstrate(675, (offset) => offset === 0 ? "rv-1" : "rv-2"),
      "Thread",
    );

    expect(result.items).toHaveLength(500);
    expect(result.pageInfo).toMatchObject({
      complete: false,
      truncated: true,
      exactCount: null,
      returnedCount: 500,
      pagesRead: 2,
      snapshotRevision: "rv-1",
      expectedRevision: null,
      observedRevision: "rv-2",
      nextOffset: 500,
      reason: "snapshot_changed",
    });
  });

  it("rejects the first page before accepting rows when an aggregate revision differs", async () => {
    const result = await listCompleteStable<{ id: string }>(
      pagingSubstrate(675, () => "rv-212213"),
      "Proposal",
      {},
      { expectedRevision: "rv-212212" },
    );

    expect(result.items).toEqual([]);
    expect(result.pageInfo).toMatchObject({
      complete: false,
      truncated: true,
      exactCount: null,
      returnedCount: 0,
      pagesRead: 1,
      snapshotRevision: "rv-212212",
      expectedRevision: "rv-212212",
      observedRevision: "rv-212213",
      nextOffset: 0,
      reason: "snapshot_changed",
    });
  });

  it("makes the safety ceiling explicit and resumable", async () => {
    const result = await listCompleteStable<{ id: string }>(
      pagingSubstrate(600, () => "rv-1"),
      "PendingAction",
      {},
      { maxItems: 500 },
    );

    expect(result.items).toHaveLength(500);
    expect(result.pageInfo).toMatchObject({
      complete: false,
      truncated: true,
      exactCount: null,
      nextOffset: 500,
      reason: "safety_limit",
    });
  });
});
