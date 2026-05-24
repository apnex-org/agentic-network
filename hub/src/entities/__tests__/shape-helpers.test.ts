/**
 * mission-88 W9 — tagsFromEntity unit tests (bug-125 fix).
 *
 * Locks the dual-shape contract: legacy-flat (tags at top-level) AND
 * envelope (metadata.labels-as-K8s-map) both coerce to a string[] of
 * tag names. Defensive: never throws on any input.
 */

import { describe, it, expect } from "vitest";
import { tagsFromEntity } from "../shape-helpers.js";

describe("tagsFromEntity — legacy-flat shape", () => {
  it("returns a copy of top-level tags array (decoupled from input)", () => {
    const entity = { id: "idea-1", tags: ["mission-88", "engineer-greg"] };
    const result = tagsFromEntity(entity);
    expect(result).toEqual(["mission-88", "engineer-greg"]);
    // Mutation of result must not affect input
    result.push("mutated");
    expect(entity.tags).toEqual(["mission-88", "engineer-greg"]);
  });

  it("returns empty array when tags is present-but-empty", () => {
    const entity = { id: "idea-2", tags: [] };
    expect(tagsFromEntity(entity)).toEqual([]);
  });
});

describe("tagsFromEntity — envelope shape (post-W6.1 cluster-1 migration)", () => {
  it("returns Object.keys(metadata.labels) per K8s-map-from-tags convention", () => {
    const entity = {
      id: "idea-3",
      apiVersion: "core.ois/v1",
      kind: "Idea",
      metadata: { labels: { "mission-88": "", "engineer-greg": "" } },
      spec: { text: "..." },
      status: { phase: "open" },
    };
    expect(tagsFromEntity(entity).sort()).toEqual(["engineer-greg", "mission-88"]);
  });

  it("returns empty array when metadata.labels is empty object", () => {
    const entity = {
      id: "idea-4",
      apiVersion: "core.ois/v1",
      metadata: { labels: {} },
    };
    expect(tagsFromEntity(entity)).toEqual([]);
  });

  it("returns keys regardless of label values (lossy-by-design per W9 Q2)", () => {
    // Cluster-1 migration writes empty-string values; this test locks the
    // constraint that future non-empty values are LOST in the round-trip.
    // If values become semantically meaningful, this helper must be retired
    // in favor of idea-318 repository envelope-native rewrite or idea-320
    // substrate-read normalization.
    const entity = {
      metadata: { labels: { foo: "v1", bar: "v2" } },
    };
    expect(tagsFromEntity(entity).sort()).toEqual(["bar", "foo"]);
  });
});

describe("tagsFromEntity — missing/null defensive", () => {
  it("returns [] when entity has neither tags nor metadata.labels", () => {
    expect(tagsFromEntity({ id: "x" })).toEqual([]);
  });

  it("returns [] when metadata is present but labels is missing", () => {
    expect(tagsFromEntity({ metadata: { createdAt: "2026-05-24" } })).toEqual([]);
  });

  it("returns [] when metadata.labels is null (defensive)", () => {
    expect(tagsFromEntity({ metadata: { labels: null } })).toEqual([]);
  });

  it("returns [] when input is null", () => {
    expect(tagsFromEntity(null)).toEqual([]);
  });

  it("returns [] when input is undefined", () => {
    expect(tagsFromEntity(undefined)).toEqual([]);
  });

  it("returns [] when input is a primitive (string)", () => {
    expect(tagsFromEntity("not-an-entity")).toEqual([]);
  });

  it("returns [] when input is a primitive (number)", () => {
    expect(tagsFromEntity(42)).toEqual([]);
  });
});

describe("tagsFromEntity — W8 Notification composition (per W9 R1 audit A7)", () => {
  it("returns [] for envelope-shape Notification (no tags field; metadata has no labels)", () => {
    // Per W8 Design, Notification has no `tags` semantic in production shape.
    // tagsFromEntity must return [] without crashing.
    const notification = {
      id: "01KP2JD2Q408F58QKY32HQEEYS",
      apiVersion: "core.ois/v1",
      kind: "Notification",
      metadata: { name: "01KP2JD2Q408F58QKY32HQEEYS", createdAt: "2026-04-13T04:43:08.901Z" },
      spec: { eventType: "report_submitted", targetRoles: ["architect"], payload: {} },
      status: { phase: "logged" },
    };
    expect(tagsFromEntity(notification)).toEqual([]);
  });
});

describe("tagsFromEntity — legacy-shape branch defense-in-depth (per W9 Q4 refinement)", () => {
  // W9 Q4: KEEP the legacy-flat branch indefinitely (don't strip post-W11
  // strict-flip). Future substrate operations may transiently produce
  // legacy-shape rows (incident hot-fixes via direct substrate.put;
  // partial-migration windows; etc.). The helper continues to work.
  it("steady-state post-W11 expectation: all production rows are envelope-shape, but legacy still coerces correctly", () => {
    const legacyRow = { id: "x", tags: ["tag-a", "tag-b"] };
    expect(tagsFromEntity(legacyRow)).toEqual(["tag-a", "tag-b"]);
  });
});
