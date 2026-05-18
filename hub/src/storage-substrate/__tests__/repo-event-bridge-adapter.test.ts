/**
 * mission-84 W0.4 — Variant (ii) cursor-store.ts adapter spike test.
 *
 * Validates RepoEventBridgeSubstrateAdapter primitive-mapping 1:1 + Uint8Array↔JSONB
 * adapter mechanics + StoragePathNotFoundError error-mapping. Exercises adapter
 * directly via cursor-store.ts's actual access pattern (createOnly → getWithToken →
 * putIfMatch → get + path-shape `<prefix>/cursor/<repoId>` namespacing).
 *
 * Spike-finding: primitive-mapping IS 1:1 + zero-blocker for W3 commitment.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStorageSubstrate } from "../memory-substrate.js";
import { RepoEventBridgeSubstrateAdapter } from "../repo-event-bridge-adapter.js";
import { StoragePathNotFoundError } from "@apnex/storage-provider";
import type { HubStorageSubstrate } from "../types.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("RepoEventBridgeSubstrateAdapter — W0.4 spike", () => {
  let substrate: HubStorageSubstrate;
  let adapter: RepoEventBridgeSubstrateAdapter;

  beforeEach(() => {
    substrate = createMemoryStorageSubstrate();
    adapter = new RepoEventBridgeSubstrateAdapter({ substrate });
  });

  // ── Capabilities ──────────────────────────────────────────────────────────

  it("declares CAS-capable capabilities (matches GCS / substrate-mode)", () => {
    expect(adapter.capabilities).toEqual({ cas: true, durable: true, concurrent: true });
  });

  // ── Path-parsing ──────────────────────────────────────────────────────────

  describe("path → (kind, id) mapping", () => {
    it("maps cursor path to RepoEventBridgeCursor kind", async () => {
      const data = enc.encode(JSON.stringify({ cursor: "abc" }));
      const r = await adapter.createOnly("repo-event-bridge/cursor/anthropic__claude-code", data);
      expect(r.ok).toBe(true);
      // Verify underlying substrate received correct kind+id
      const stored = await substrate.get<{ id: string; body: unknown }>("RepoEventBridgeCursor", "anthropic__claude-code");
      expect(stored).toEqual({ id: "anthropic__claude-code", body: { cursor: "abc" } });
    });

    it("maps dedupe path to RepoEventBridgeDedupe kind", async () => {
      const data = enc.encode(JSON.stringify({ seen: ["x", "y"] }));
      await adapter.createOnly("repo-event-bridge/dedupe/owner__repo", data);
      const stored = await substrate.get<{ id: string; body: unknown }>("RepoEventBridgeDedupe", "owner__repo");
      expect(stored).toEqual({ id: "owner__repo", body: { seen: ["x", "y"] } });
    });

    it("rejects path outside pathPrefix", async () => {
      await expect(adapter.get("other-prefix/cursor/x")).rejects.toThrow(/outside pathPrefix/);
    });

    it("rejects unknown namespace", async () => {
      await expect(adapter.get("repo-event-bridge/unknown/x")).rejects.toThrow(/unknown namespace/);
    });

    it("accepts repoId with slash segments (treats as id)", async () => {
      const data = enc.encode(JSON.stringify({ cursor: "z" }));
      // Note: cursor-store uses repoId like "owner__repo" but path-parse logic
      // takes everything after the namespace slash as id — even nested slashes
      await adapter.createOnly("repo-event-bridge/cursor/some/nested/id", data);
      const stored = await substrate.get("RepoEventBridgeCursor", "some/nested/id");
      expect(stored).toBeDefined();
    });
  });

  // ── createOnly → getWithToken → putIfMatch happy path (cursor-store cycle) ─

  describe("cursor-store.ts integration cycle", () => {
    it("createOnly → getWithToken → putIfMatch chain (first-write + update)", async () => {
      const path = "repo-event-bridge/cursor/owner__repo";

      // First write — cursor-store does createOnly when no token
      const v1 = { cursor: "rev-1", advanced: 0 };
      const create = await adapter.createOnly(path, enc.encode(JSON.stringify(v1)));
      expect(create.ok).toBe(true);

      // cursor-store immediately re-reads to recover token (per cursor-store.ts:121)
      const read1 = await adapter.getWithToken(path);
      expect(read1).not.toBeNull();
      expect(JSON.parse(dec.decode(read1!.data))).toEqual(v1);

      // Subsequent write — putIfMatch with current token
      const v2 = { cursor: "rev-2", advanced: 1 };
      const update = await adapter.putIfMatch(path, enc.encode(JSON.stringify(v2)), read1!.token);
      expect(update.ok).toBe(true);
      if (!update.ok) throw new Error("unreachable");

      // Verify update + new token
      const read2 = await adapter.getWithToken(path);
      expect(read2!.token).toBe(update.newToken);
      expect(read2!.token).not.toBe(read1!.token);
      expect(JSON.parse(dec.decode(read2!.data))).toEqual(v2);
    });

    it("createOnly returns {ok:false} on contention (matches cursor-store conflict semantic)", async () => {
      const path = "repo-event-bridge/cursor/owner__repo";
      await adapter.createOnly(path, enc.encode("{}"));
      const r2 = await adapter.createOnly(path, enc.encode("{}"));
      expect(r2.ok).toBe(false);
    });

    it("putIfMatch with stale token returns {ok:false, currentToken}", async () => {
      const path = "repo-event-bridge/cursor/owner__repo";
      await adapter.createOnly(path, enc.encode(JSON.stringify({ v: 1 })));
      const read1 = await adapter.getWithToken(path);
      // Concurrent writer advances
      const intervening = await adapter.putIfMatch(path, enc.encode(JSON.stringify({ v: 2 })), read1!.token);
      expect(intervening.ok).toBe(true);
      if (!intervening.ok) throw new Error("unreachable");
      // Now try to write with stale token
      const stale = await adapter.putIfMatch(path, enc.encode(JSON.stringify({ v: 3 })), read1!.token);
      expect(stale.ok).toBe(false);
      if (stale.ok) throw new Error("unreachable");
      expect(stale.currentToken).toBe(intervening.newToken);
    });

    it("putIfMatch on absent path throws StoragePathNotFoundError (cursor-store relies on this for first-write detection)", async () => {
      await expect(
        adapter.putIfMatch("repo-event-bridge/cursor/absent", enc.encode("{}"), "any-token"),
      ).rejects.toBeInstanceOf(StoragePathNotFoundError);
    });
  });

  // ── get + getWithToken on absent ──────────────────────────────────────────

  describe("get / getWithToken absent semantics", () => {
    it("get returns null for absent path", async () => {
      expect(await adapter.get("repo-event-bridge/cursor/absent")).toBeNull();
    });

    it("getWithToken returns null for absent path", async () => {
      expect(await adapter.getWithToken("repo-event-bridge/cursor/absent")).toBeNull();
    });
  });

  // ── Uint8Array↔JSONB body conversion ──────────────────────────────────────

  describe("Uint8Array↔JSONB conversion", () => {
    it("preserves complex nested JSON shape through round-trip", async () => {
      const path = "repo-event-bridge/cursor/owner__repo";
      const complex = {
        cursor: "rev-x",
        seenIds: ["a", "b", "c"],
        metadata: { foo: { bar: 1, baz: [true, false] } },
        epoch: 1234567890,
      };
      await adapter.createOnly(path, enc.encode(JSON.stringify(complex)));
      const read = await adapter.get(path);
      expect(JSON.parse(dec.decode(read!))).toEqual(complex);
    });

    it("invalid JSON in createOnly data surfaces as parse error", async () => {
      await expect(
        adapter.createOnly("repo-event-bridge/cursor/x", enc.encode("not-json{{")),
      ).rejects.toThrow(/JSON/);
    });
  });

  // ── Variant ii scope-boundary (unused primitives stub-throw) ──────────────

  describe("Variant ii scope-boundary (stub-throw)", () => {
    it("put throws (unused; createOnly + putIfMatch suffice)", async () => {
      await expect(adapter.put("repo-event-bridge/cursor/x", enc.encode("{}"))).rejects.toThrow(/not implemented/);
    });

    it("delete throws (cursor-store does not delete)", async () => {
      await expect(adapter.delete("repo-event-bridge/cursor/x")).rejects.toThrow(/not implemented/);
    });

    it("list throws (cursor-store does not list)", async () => {
      await expect(adapter.list("repo-event-bridge/cursor/")).rejects.toThrow(/not implemented/);
    });
  });
});
