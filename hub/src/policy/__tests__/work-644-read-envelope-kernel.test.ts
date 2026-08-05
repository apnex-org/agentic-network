/**
 * work-644 / work-645 — the read-envelope kernel.
 * Checked against docs/design/read-envelope-honesty-primitive.md.
 *
 * §6 is the test of the whole design: "Can a verb wired by someone who has read
 * none of this still lie?" The answer must be no, by DEFAULT.
 */
import { describe, it, expect } from "vitest";
import { paginated, MAX_LIST_LIMIT, DEFAULT_SMALL_LIST_LIMIT } from "../list-filters.js";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
const SCAN_CAP = 500;
/** exactly how both live handlers call it — one call, zero copied logic */
const capped = (scanned: number, args = {}) =>
  paginated(rows(scanned), args, {
    defaultLimit: DEFAULT_SMALL_LIST_LIMIT,
    scanCapped: scanned >= SCAN_CAP,
    scanCap: SCAN_CAP,
    narrowBy: "status/role/holder",
  });

describe("§3.2 — total must never hold a number that is not the true count", () => {
  it("🔴 a capped scan reports total NULL, never the scan floor (bug-484)", () => {
    const r = capped(500);
    expect(r.total).toBeNull();
    expect(r.total).not.toBe(500);
    expect(r.scanned).toBe(500); // the floor is still reported — under an honest name
  });

  it("an uncapped scan reports the exact count", () => {
    const r = capped(42);
    expect(r.total).toBe(42);
    expect(r.scanned).toBeUndefined(); // no separate figure needed when total is true
  });
});

describe("§3.1 — complete is the primitive, and it is EARNED", () => {
  it("complete:false when the scan was capped, even though the page is full", () => {
    expect(capped(500, { limit: MAX_LIST_LIMIT }).complete).toBe(false);
  });
  it("complete:false when the page excluded scanned rows", () => {
    expect(capped(50).complete).toBe(false);
  });
  it("complete:true ONLY when both boundaries are clear", () => {
    const r = capped(4);
    expect(r.complete).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.pageTruncated).toBe(false);
  });
  it("🔴 §6 THE TEST OF THE DESIGN — a careless caller passing NO options cannot claim completeness", () => {
    // verb 35, wired by someone who read none of the ruling, over more rows than
    // the default page: the lazy path must still be the honest one.
    const naive = paginated(rows(9999), {});
    expect(naive.complete).toBe(false);
    expect(naive.pageTruncated).toBe(true);
  });
});

describe("§3.3 — the boundaries stay separate and never imply each other", () => {
  it("scan clear + page capped", () => {
    const r = capped(50);
    expect(r.truncated).toBe(false);
    expect(r.pageTruncated).toBe(true);
    expect(r.omitted).toBe(40);
  });
  it("scan capped + page capped are BOTH reported, independently", () => {
    const r = capped(500);
    expect(r.truncated).toBe(true);
    expect(r.pageTruncated).toBe(true);
  });
});

describe("§3.4 — continuation advice must be followable, or say it is not", () => {
  it("🔴 the page note must NOT promise 'the rest' when the scan was capped", () => {
    const note = capped(500).pageTruncationNote ?? "";
    expect(note).not.toContain("to retrieve the rest");
    expect(note).toContain("SCANNED SET ONLY");
  });
  it("🔴 the scan note states plainly that offset CANNOT reach the unscanned rows", () => {
    const note = capped(500).truncationNote ?? "";
    expect(note).toContain("CANNOT REACH THEM");
    expect(note).toContain("UNKNOWN (null)");
  });
  it("an uncapped scan MAY promise the rest, because offset genuinely reaches it", () => {
    expect(capped(50).pageTruncationNote).toContain("retrieve the rest");
  });
  it("no continuation advice at all on a complete result", () => {
    const r = capped(4);
    expect(r.pageTruncationNote).toBeUndefined();
    expect(r.truncationNote).toBeUndefined();
    expect(r.nextOffset).toBeUndefined();
  });
});

describe("extensibility bar — adding a verb is ONE call", () => {
  it("a brand-new surface gets the full honest envelope from a single call", () => {
    const e = paginated(rows(1000), { limit: 25 }, { defaultLimit: 10, scanCapped: true, scanCap: 1000 });
    for (const k of ["items","count","total","offset","limit","complete","truncated","pageTruncated"]) {
      expect(e).toHaveProperty(k);
    }
    expect(e.count).toBe(25);
    expect(e.total).toBeNull();
    expect(e.complete).toBe(false);
  });
  it("an explicit higher limit is still honoured, and the ceiling still holds", () => {
    expect(capped(600, { limit: 200 }).count).toBe(200);
    expect(capped(600, { limit: 9999 }).count).toBe(MAX_LIST_LIMIT);
  });
});
