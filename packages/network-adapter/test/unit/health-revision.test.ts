/**
 * health-revision.test.ts — unit tests for makeFetchLiveToolSurfaceRevision
 * (idea-355 SLICE-1T).
 *
 * Pins the hoisted /health toolSurfaceRevision fetcher's contract:
 *   - /health URL derivation from the Hub /mcp URL (with + without a path tail);
 *   - field extraction (non-empty string → returned);
 *   - null on !res.ok, a missing/empty/non-string field, and a fetch throw
 *     (never rejects).
 *
 * The fetch implementation is injected so no live Hub is required.
 */

import { describe, it, expect, vi } from "vitest";
import { makeFetchLiveToolSurfaceRevision } from "../../src/tool-manager/catalog/health-revision.js";

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

describe("makeFetchLiveToolSurfaceRevision — URL derivation", () => {
  it("derives /health from a bare …/mcp URL", async () => {
    const seen: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      seen.push(url);
      return jsonResponse({ toolSurfaceRevision: "rev-1" });
    }) as unknown as typeof globalThis.fetch;

    const fn = makeFetchLiveToolSurfaceRevision({ hubUrl: "https://hub.example/mcp", fetch });
    const rev = await fn();

    expect(rev).toBe("rev-1");
    expect(seen).toEqual(["https://hub.example/health"]);
  });

  it("derives /health from a …/mcp URL with a trailing path", async () => {
    const seen: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      seen.push(url);
      return jsonResponse({ toolSurfaceRevision: "rev-2" });
    }) as unknown as typeof globalThis.fetch;

    const fn = makeFetchLiveToolSurfaceRevision({
      hubUrl: "https://hub.example/mcp/v1/stream",
      fetch,
    });
    const rev = await fn();

    expect(rev).toBe("rev-2");
    expect(seen).toEqual(["https://hub.example/health"]);
  });
});

describe("makeFetchLiveToolSurfaceRevision — field extraction", () => {
  it("returns the toolSurfaceRevision when it is a non-empty string", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ version: "1.2.3", toolSurfaceRevision: "abc123" }),
    ) as unknown as typeof globalThis.fetch;

    const fn = makeFetchLiveToolSurfaceRevision({ hubUrl: "https://hub/mcp", fetch });
    expect(await fn()).toBe("abc123");
  });

  it("returns null when the field is missing", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ version: "1.2.3" }),
    ) as unknown as typeof globalThis.fetch;

    const fn = makeFetchLiveToolSurfaceRevision({ hubUrl: "https://hub/mcp", fetch });
    expect(await fn()).toBeNull();
  });

  it("returns null when the field is an empty string", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ toolSurfaceRevision: "" }),
    ) as unknown as typeof globalThis.fetch;

    const fn = makeFetchLiveToolSurfaceRevision({ hubUrl: "https://hub/mcp", fetch });
    expect(await fn()).toBeNull();
  });

  it("returns null when the field is a non-string", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ toolSurfaceRevision: 42 }),
    ) as unknown as typeof globalThis.fetch;

    const fn = makeFetchLiveToolSurfaceRevision({ hubUrl: "https://hub/mcp", fetch });
    expect(await fn()).toBeNull();
  });
});

describe("makeFetchLiveToolSurfaceRevision — failure modes (never reject)", () => {
  it("returns null on a non-ok response", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ toolSurfaceRevision: "abc" }, { ok: false, status: 503 }),
    ) as unknown as typeof globalThis.fetch;

    const fn = makeFetchLiveToolSurfaceRevision({ hubUrl: "https://hub/mcp", fetch });
    expect(await fn()).toBeNull();
  });

  it("returns null (does not reject) when fetch throws", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof globalThis.fetch;

    const fn = makeFetchLiveToolSurfaceRevision({ hubUrl: "https://hub/mcp", fetch });
    await expect(fn()).resolves.toBeNull();
  });

  it("returns null (does not reject) when res.json throws", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    })) as unknown as typeof globalThis.fetch;

    const fn = makeFetchLiveToolSurfaceRevision({ hubUrl: "https://hub/mcp", fetch });
    await expect(fn()).resolves.toBeNull();
  });
});
