import { describe, expect, it } from "vitest";
import {
  isValidPrEvidenceRepo,
  parsePrEvidenceLocator,
} from "../../src/policy/pr-evidence-admission-contract.js";

describe("PR evidence admission contract/parser", () => {
  it("accepts explicit GitHub pull request URLs", () => {
    const parsed = parsePrEvidenceLocator("https://github.com/apnex-org/agentic-network/pull/625");

    expect(parsed).toEqual({
      ok: true,
      locator: {
        repo: "apnex-org/agentic-network",
        prNumber: 625,
        source: "github_pr_url",
        raw: "https://github.com/apnex-org/agentic-network/pull/625",
        url: "https://github.com/apnex-org/agentic-network/pull/625",
      },
    });
  });

  it("accepts GitHub PR URLs with trailing path/query while preserving the raw locator", () => {
    const raw = "https://github.com/apnex-org/agentic-network/pull/625/files?diff=split";
    const parsed = parsePrEvidenceLocator(raw);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.locator).toMatchObject({
      repo: "apnex-org/agentic-network",
      prNumber: 625,
      source: "github_pr_url",
      url: raw,
    });
  });

  it("accepts explicit owner/repo#number locators", () => {
    expect(parsePrEvidenceLocator("apnex-org/agentic-network#621")).toEqual({
      ok: true,
      locator: {
        repo: "apnex-org/agentic-network",
        prNumber: 621,
        source: "repo_pr_number",
        raw: "apnex-org/agentic-network#621",
      },
    });
  });

  it("accepts typed repo plus PR number objects", () => {
    expect(parsePrEvidenceLocator({ repo: "apnex-org/agentic-network", prNumber: "621" })).toEqual({
      ok: true,
      locator: {
        repo: "apnex-org/agentic-network",
        prNumber: 621,
        source: "repo_pr_number",
        raw: { repo: "apnex-org/agentic-network", prNumber: "621" },
      },
    });
    expect(parsePrEvidenceLocator({ repo: "apnex-org/agentic-network", number: 622 })).toMatchObject({
      ok: true,
      locator: { prNumber: 622 },
    });
  });

  it("rejects raw prose/body markers as non-authoritative hints", () => {
    for (const raw of [
      "work-123",
      "PR #621",
      "pull request 621",
      "apnex-org/agentic-network PR 621",
      "https://github.com/apnex-org/agentic-network/issues/621",
    ]) {
      const parsed = parsePrEvidenceLocator(raw);
      expect(parsed).toMatchObject({
        ok: false,
        code: "not_explicit_pr_locator",
      });
    }
  });

  it("rejects malformed repos, non-positive PR numbers, empty refs, and unsupported shapes", () => {
    expect(parsePrEvidenceLocator("")).toMatchObject({ ok: false, code: "empty_input" });
    expect(parsePrEvidenceLocator("agentic-network#1")).toMatchObject({ ok: false, code: "not_explicit_pr_locator" });
    expect(parsePrEvidenceLocator("apnex-org/agentic-network#0")).toMatchObject({ ok: false, code: "not_explicit_pr_locator" });
    expect(parsePrEvidenceLocator({ repo: "agentic-network", prNumber: 1 })).toMatchObject({ ok: false, code: "invalid_repo" });
    expect(parsePrEvidenceLocator({ repo: "apnex-org/agentic-network", prNumber: 0 })).toMatchObject({ ok: false, code: "invalid_pr_number" });
    expect(parsePrEvidenceLocator(["apnex-org/agentic-network#1"])).toMatchObject({ ok: false, code: "unsupported_input" });
  });

  it("pins repository slug validation to owner/repo only", () => {
    expect(isValidPrEvidenceRepo("apnex-org/agentic-network")).toBe(true);
    expect(isValidPrEvidenceRepo("apnex-org/agentic/network")).toBe(false);
    expect(isValidPrEvidenceRepo("agentic-network")).toBe(false);
    expect(isValidPrEvidenceRepo("apnex org/agentic-network")).toBe(false);
  });
});
