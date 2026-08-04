/**
 * work-640 — "Cap at 10 and disclose" (Director ruling).
 *
 * These exercise the PRODUCTION pagination + disclosure helpers that
 * list_messages and list_work now both route through. The point of the suite is
 * NOT that a cap exists — it is that a capped result is DISTINGUISHABLE from a
 * complete one by the caller. A silent cap of 10 is the defect this arc deleted
 * from the middleware, one layer down.
 */

import { describe, it, expect } from "vitest";
import {
  paginate,
  pageDisclosure,
  listPaginationSchema,
  DEFAULT_SMALL_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from "../list-filters.js";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

/** The exact call shape both policies use: default-10 unless the caller asks. */
const asPolicyDoes = (items: unknown[], args: Record<string, unknown> = {}) => {
  const page = paginate(items, {
    ...args,
    limit: (args.limit as number | undefined) ?? DEFAULT_SMALL_LIST_LIMIT,
  });
  return { ...page, ...pageDisclosure(page) };
};

describe("work-640 — cap", () => {
  it("defaults to 10, not 100 and not unbounded", () => {
    const r = asPolicyDoes(rows(10108)); // the measured list_messages population
    expect(r.count).toBe(10);
    expect(r.limit).toBe(10);
  });

  it("🔴 A CALLER WHO ASKS FOR MORE GETS MORE — a cap that cannot be raised is a new defect", () => {
    expect(asPolicyDoes(rows(600), { limit: 50 }).count).toBe(50);
    expect(asPolicyDoes(rows(600), { limit: 500 }).count).toBe(500);
    // and the hard ceiling still holds
    expect(asPolicyDoes(rows(600), { limit: 9999 }).count).toBe(MAX_LIST_LIMIT);
  });

  it("offset pages forward through the full set", () => {
    const a = asPolicyDoes(rows(25));
    const b = asPolicyDoes(rows(25), { offset: a.nextOffset as number });
    expect(a.count).toBe(10);
    expect(b.offset).toBe(10);
    expect((b.items as { id: number }[])[0].id).toBe(10);
  });
});

describe("work-640 — disclosure", () => {
  it("a CAPPED result says so, names the omitted count, and gives a usable next step", () => {
    const r = asPolicyDoes(rows(10108));
    expect(r.pageTruncated).toBe(true);
    expect(r.total).toBe(10108);
    expect(r.omitted).toBe(10098);
    expect(r.nextOffset).toBe(10);
    expect(r.pageTruncationNote).toContain("showing 10 of 10108");
    expect(r.pageTruncationNote).toContain("offset=10");
    // the note must not call a caller-supplied limit a "default"
    expect(r.pageTruncationNote).not.toContain("default limit");
  });

  it("🔴 NEGATIVE CONTROL: a result UNDER the cap is explicitly NOT flagged", () => {
    const r = asPolicyDoes(rows(4));
    expect(r.pageTruncated).toBe(false);
    expect(r.count).toBe(4);
    expect(r.total).toBe(4);
    // the fields that only make sense when incomplete must be ABSENT, not zero
    expect(r.omitted).toBeUndefined();
    expect(r.nextOffset).toBeUndefined();
    expect(r.pageTruncationNote).toBeUndefined();
  });

  it("🔴 at MAX limit the note does NOT advise raising it further (useless advice is dishonest advice)", () => {
    const r = asPolicyDoes(rows(10108), { limit: MAX_LIST_LIMIT });
    expect(r.count).toBe(MAX_LIST_LIMIT);
    expect(r.pageTruncated).toBe(true);
    expect(r.pageTruncationNote).not.toContain("raise limit");
    expect(r.pageTruncationNote).toContain("offset=500");
  });

  it("🔴 BOUNDARY: exactly at the cap is COMPLETE, not truncated (off-by-one guard)", () => {
    const r = asPolicyDoes(rows(10));
    expect(r.count).toBe(10);
    expect(r.pageTruncated).toBe(false);
  });

  it("the LAST page is complete even though earlier pages were not", () => {
    const last = asPolicyDoes(rows(25), { offset: 20 });
    expect(last.count).toBe(5);
    expect(last.pageTruncated).toBe(false);
  });

  it("page-truncation is DISTINCT from a capped scan — both can be true independently", () => {
    // 500 rows survived a capped scan; the caller sees 10 of those 500.
    const r = asPolicyDoes(rows(500));
    expect(r.pageTruncated).toBe(true);
    expect(r.omitted).toBe(490);
    // `truncated` (scan-level) is supplied by the policy, NOT by pageDisclosure —
    // proving they are separate signals rather than one renamed.
    expect(r).not.toHaveProperty("truncated");
  });
});

describe("work-640 — schema honesty", () => {
  it("the limit DESCRIBE states the tool's real default, not the shared 100 (bug-391 class)", () => {
    const d = listPaginationSchema(DEFAULT_SMALL_LIST_LIMIT).limit.description ?? "";
    expect(d).toContain("default 10");
    expect(d).not.toContain("default 100");
    expect(d).toContain("honoured");
  });
});

/**
 * work-642 — found by OBSERVING the live cap, not by testing it.
 * The store caps its scan at 500 and reports no flag, so `total` is a FLOOR.
 * Saying "10 of 500" against ~10,108 real rows is this arc's target defect.
 */
describe("work-642 — scan-cap honesty is SEPARATE from page-cap honesty", () => {
  const MESSAGE_SCAN_CAP = 500;
  const surface = (scanned: number) => {
    const page = paginate(rows(scanned), { limit: DEFAULT_SMALL_LIST_LIMIT });
    const saturated = scanned >= MESSAGE_SCAN_CAP;
    return { ...page, ...pageDisclosure(page), truncated: saturated };
  };

  it("🔴 a SATURATED scan is flagged — total is a floor, not a count", () => {
    const r = surface(500);
    expect(r.truncated).toBe(true);
    expect(r.pageTruncated).toBe(true); // both true at once, independently
  });

  it("🔴 NEGATIVE CONTROL: an unsaturated scan is NOT flagged, even when the PAGE is capped", () => {
    const r = surface(50);
    expect(r.truncated).toBe(false); // scan saw everything
    expect(r.pageTruncated).toBe(true); // page still withheld 40
    expect(r.omitted).toBe(40);
  });

  it("the two flags are genuinely independent, not one renamed", () => {
    const small = surface(4);
    expect(small.truncated).toBe(false);
    expect(small.pageTruncated).toBe(false);
  });
});
