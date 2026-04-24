/**
 * StorageProvider contract-conformance suite — mission-47 T1.
 *
 * CSI-style: a single suite of assertions exercised against every
 * provider implementation. Gates the "sovereign property" — if two
 * providers disagree on observable behavior, one of them is wrong.
 *
 * Usage:
 *   import { runConformanceSuite } from "./conformance.js";
 *   describe("MemoryStorageProvider", () => {
 *     runConformanceSuite(() => new MemoryStorageProvider());
 *   });
 *
 * The factory returns a fresh provider per test — no state leakage
 * between cases.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { StorageProvider } from "../src/contract.js";
import { StoragePathNotFoundError, hasGetWithToken } from "../src/contract.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (u: Uint8Array): string => new TextDecoder().decode(u);

export interface ConformanceOptions {
  /**
   * Skip test cases that require concurrent-writer semantics. Useful
   * for single-writer providers (memory, local-fs) where contention
   * tests don't meaningfully validate anything.
   */
  readonly skipConcurrencyCases?: boolean;
}

export function runConformanceSuite(
  factory: () => StorageProvider,
  options: ConformanceOptions = {},
): void {
  let provider: StorageProvider;

  beforeEach(() => {
    provider = factory();
  });

  // ── Capabilities ─────────────────────────────────────────────

  describe("capabilities", () => {
    it("declares the three capability flags", () => {
      expect(typeof provider.capabilities.cas).toBe("boolean");
      expect(typeof provider.capabilities.durable).toBe("boolean");
      expect(typeof provider.capabilities.concurrent).toBe("boolean");
    });
  });

  // ── get / put ─────────────────────────────────────────────────

  describe("get + put", () => {
    it("get returns null for absent path", async () => {
      expect(await provider.get("missing/x.json")).toBeNull();
    });

    it("put then get returns byte-identical data", async () => {
      await provider.put("a/b.json", enc('{"hello":"world"}'));
      const got = await provider.get("a/b.json");
      expect(got).not.toBeNull();
      expect(dec(got!)).toBe('{"hello":"world"}');
    });

    it("put clobbers existing blob (unconditional write)", async () => {
      await provider.put("clobber/x.json", enc("first"));
      await provider.put("clobber/x.json", enc("second"));
      const got = await provider.get("clobber/x.json");
      expect(dec(got!)).toBe("second");
    });

    it("get returns defensive copy (caller mutation does not affect store)", async () => {
      await provider.put("copy/x.json", enc("original"));
      const got = await provider.get("copy/x.json");
      got![0] = 0xFF;
      const reread = await provider.get("copy/x.json");
      expect(dec(reread!)).toBe("original");
    });
  });

  // ── list ─────────────────────────────────────────────────────

  describe("list", () => {
    it("returns empty array for prefix with no matches", async () => {
      const result = await provider.list("empty/");
      expect(result).toEqual([]);
    });

    it("returns only paths matching the prefix", async () => {
      await provider.put("bugs/bug-1.json", enc("{}"));
      await provider.put("bugs/bug-2.json", enc("{}"));
      await provider.put("ideas/idea-1.json", enc("{}"));
      const bugs = await provider.list("bugs/");
      expect(bugs.sort()).toEqual(["bugs/bug-1.json", "bugs/bug-2.json"]);
      const ideas = await provider.list("ideas/");
      expect(ideas).toEqual(["ideas/idea-1.json"]);
    });

    it("empty prefix lists the entire keyspace", async () => {
      await provider.put("x/1.json", enc("{}"));
      await provider.put("y/2.json", enc("{}"));
      const all = await provider.list("");
      expect(all.sort()).toEqual(["x/1.json", "y/2.json"]);
    });

    it("deleted paths do not appear in list", async () => {
      await provider.put("ephemeral/a.json", enc("{}"));
      await provider.delete("ephemeral/a.json");
      expect(await provider.list("ephemeral/")).toEqual([]);
    });
  });

  // ── delete ───────────────────────────────────────────────────

  describe("delete", () => {
    it("removes the blob", async () => {
      await provider.put("del/x.json", enc("{}"));
      await provider.delete("del/x.json");
      expect(await provider.get("del/x.json")).toBeNull();
    });

    it("is idempotent on absent path", async () => {
      await expect(provider.delete("nonexistent/x.json")).resolves.toBeUndefined();
    });
  });

  // ── createOnly (CAS family; requires cas:true) ───────────────

  describe("createOnly", () => {
    it("succeeds on first write", async () => {
      const result = await provider.createOnly("co/x.json", enc("first"));
      expect(result.ok).toBe(true);
      const got = await provider.get("co/x.json");
      expect(dec(got!)).toBe("first");
    });

    it("returns {ok:false} when path exists", async () => {
      await provider.createOnly("co/y.json", enc("original"));
      const result = await provider.createOnly("co/y.json", enc("overwrite"));
      expect(result.ok).toBe(false);
      const got = await provider.get("co/y.json");
      expect(dec(got!)).toBe("original"); // unchanged
    });

    it("unconditional put can clobber createOnly blob", async () => {
      await provider.createOnly("co/z.json", enc("first"));
      await provider.put("co/z.json", enc("second"));
      const got = await provider.get("co/z.json");
      expect(dec(got!)).toBe("second");
    });
  });

  // ── putIfMatch (CAS family; requires cas:true) ───────────────

  describe("putIfMatch", () => {
    it("throws StoragePathNotFoundError for absent path", async () => {
      await expect(
        provider.putIfMatch("missing/x.json", enc("data"), "any-token"),
      ).rejects.toBeInstanceOf(StoragePathNotFoundError);
    });

    it("succeeds when token matches; returns new token", async () => {
      if (!hasGetWithToken(provider)) {
        // Providers without getWithToken can't participate in this
        // test — they need a token to pass to putIfMatch.
        return;
      }
      await provider.put("pim/x.json", enc("v1"));
      const read = await provider.getWithToken("pim/x.json");
      expect(read).not.toBeNull();
      const result = await provider.putIfMatch(
        "pim/x.json",
        enc("v2"),
        read!.token,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.newToken).toBeDefined();
        expect(result.newToken).not.toBe(read!.token);
      }
      const got = await provider.get("pim/x.json");
      expect(dec(got!)).toBe("v2");
    });

    it("fails with current token when ifMatchToken stale", async () => {
      if (!hasGetWithToken(provider)) return;
      await provider.put("pim/y.json", enc("v1"));
      const read = await provider.getWithToken("pim/y.json");
      // Another writer intervenes.
      await provider.put("pim/y.json", enc("intervening"));
      const result = await provider.putIfMatch(
        "pim/y.json",
        enc("v3"),
        read!.token,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.currentToken).toBeDefined();
        expect(result.currentToken).not.toBe(read!.token);
      }
      const got = await provider.get("pim/y.json");
      expect(dec(got!)).toBe("intervening"); // unchanged
    });

    it("successful putIfMatch returns token usable for chained update", async () => {
      if (!hasGetWithToken(provider)) return;
      await provider.put("pim/z.json", enc("v1"));
      const t1 = (await provider.getWithToken("pim/z.json"))!.token;
      const r2 = await provider.putIfMatch("pim/z.json", enc("v2"), t1);
      expect(r2.ok).toBe(true);
      const t2 = (r2 as { ok: true; newToken: string }).newToken;
      const r3 = await provider.putIfMatch("pim/z.json", enc("v3"), t2);
      expect(r3.ok).toBe(true);
      const got = await provider.get("pim/z.json");
      expect(dec(got!)).toBe("v3");
    });
  });

  // ── Path normalization ───────────────────────────────────────

  describe("path handling", () => {
    it("nested paths work identically to flat paths", async () => {
      await provider.put("a/b/c/d.json", enc("deep"));
      const got = await provider.get("a/b/c/d.json");
      expect(dec(got!)).toBe("deep");
    });

    it("list traverses nested directories", async () => {
      await provider.put("t/a/1.json", enc("{}"));
      await provider.put("t/b/2.json", enc("{}"));
      await provider.put("t/a/c/3.json", enc("{}"));
      const all = await provider.list("t/");
      expect(all.sort()).toEqual([
        "t/a/1.json",
        "t/a/c/3.json",
        "t/b/2.json",
      ]);
    });
  });

  // ── Concurrency cases (skippable) ────────────────────────────

  if (!options.skipConcurrencyCases && provider !== undefined) {
    describe("sequential consistency (single writer)", () => {
      it("successive writes + reads reflect last write", async () => {
        for (let i = 0; i < 20; i++) {
          await provider.put("seq/x.json", enc(`v${i}`));
          const got = await provider.get("seq/x.json");
          expect(dec(got!)).toBe(`v${i}`);
        }
      });
    });
  }
}
