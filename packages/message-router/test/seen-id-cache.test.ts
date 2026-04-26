import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SeenIdCache } from "../src/seen-id-cache.js";

const ENV_VAR = "OIS_ADAPTER_SEEN_ID_CACHE_N";

describe("SeenIdCache", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = originalEnv;
    }
  });

  it("records first sighting and dedups subsequent sightings of the same id", () => {
    const cache = new SeenIdCache({ capacity: 4 });
    expect(cache.markSeen("m-1")).toBe(true);
    expect(cache.markSeen("m-1")).toBe(false);
    expect(cache.markSeen("m-1")).toBe(false);
  });

  it("evicts the oldest entry when capacity is exceeded", () => {
    const cache = new SeenIdCache({ capacity: 3 });
    cache.markSeen("a");
    cache.markSeen("b");
    cache.markSeen("c");
    cache.markSeen("d"); // evicts "a"; cache = [b, c, d]
    expect(cache.size()).toBe(3);
    expect(cache.markSeen("b")).toBe(false);
    expect(cache.markSeen("c")).toBe(false);
    expect(cache.markSeen("d")).toBe(false);
  });

  it("re-seeing an evicted id reports as fresh", () => {
    const cache = new SeenIdCache({ capacity: 3 });
    cache.markSeen("a");
    cache.markSeen("b");
    cache.markSeen("c");
    cache.markSeen("d"); // evicts "a"; cache = [b, c, d]
    expect(cache.markSeen("a")).toBe(true);
  });

  it("refreshes LRU position when an existing entry is re-marked", () => {
    const cache = new SeenIdCache({ capacity: 3 });
    cache.markSeen("a"); // [a]
    cache.markSeen("b"); // [a, b]
    cache.markSeen("c"); // [a, b, c]
    cache.markSeen("a"); // refresh "a" → [b, c, a]
    cache.markSeen("d"); // evicts "b" → [c, a, d]
    expect(cache.markSeen("b")).toBe(true); // "b" came back fresh; evicts "c" → [a, d, b]
    expect(cache.markSeen("a")).toBe(false);
    expect(cache.markSeen("d")).toBe(false);
  });

  it("defaults to capacity 1000 with no env override and no explicit option", () => {
    const cache = new SeenIdCache();
    expect(cache.getCapacity()).toBe(1000);
  });

  it("honours OIS_ADAPTER_SEEN_ID_CACHE_N env override", () => {
    process.env[ENV_VAR] = "16";
    const cache = new SeenIdCache();
    expect(cache.getCapacity()).toBe(16);
  });

  it("falls back to default when env override is non-numeric", () => {
    process.env[ENV_VAR] = "not-a-number";
    const cache = new SeenIdCache();
    expect(cache.getCapacity()).toBe(1000);
  });

  it("falls back to default when env override is non-positive", () => {
    process.env[ENV_VAR] = "0";
    const cache = new SeenIdCache();
    expect(cache.getCapacity()).toBe(1000);
  });

  it("explicit capacity option wins over env override", () => {
    process.env[ENV_VAR] = "16";
    const cache = new SeenIdCache({ capacity: 8 });
    expect(cache.getCapacity()).toBe(8);
  });

  it("falls back to default when explicit capacity is non-positive", () => {
    const cache = new SeenIdCache({ capacity: 0 });
    expect(cache.getCapacity()).toBe(1000);
  });
});
