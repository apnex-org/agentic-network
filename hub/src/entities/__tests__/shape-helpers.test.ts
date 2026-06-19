/**
 * mission-88 W9 — tagsFromEntity unit tests (bug-125 fix).
 *
 * Locks the dual-shape contract: legacy-flat (tags at top-level) AND
 * envelope (metadata.labels-as-K8s-map) both coerce to a string[] of
 * tag names. Defensive: never throws on any input.
 */

import { describe, it, expect } from "vitest";
import { tagsFromEntity, arrayFieldFromEntity, fieldFromEntity } from "../shape-helpers.js";

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

// W9.1 hot-fix (bug-134) — arrayFieldFromEntity generalized helper tests.

describe("arrayFieldFromEntity — legacy-flat shape", () => {
  it("returns copy of top-level array field", () => {
    const bug = { id: "bug-1", linkedTaskIds: ["task-1", "task-2"] };
    const result = arrayFieldFromEntity(bug, "linkedTaskIds");
    expect(result).toEqual(["task-1", "task-2"]);
    // Mutation of result must not affect input
    (result as string[]).push("mutated");
    expect(bug.linkedTaskIds).toEqual(["task-1", "task-2"]);
  });

  it("returns empty when top-level field is empty array", () => {
    expect(arrayFieldFromEntity({ fixCommits: [] }, "fixCommits")).toEqual([]);
  });
});

describe("arrayFieldFromEntity — envelope status section (Bug.linkedTaskIds + fixCommits per cluster-1)", () => {
  it("probes status section per cluster-1 Bug.ts partition", () => {
    const envelopeBug = {
      id: "bug-2",
      apiVersion: "core.ois/v1",
      kind: "Bug",
      metadata: { name: "bug-2" },
      spec: { title: "..." },
      status: {
        phase: "resolved",
        linkedTaskIds: ["task-9", "task-10"],
        fixCommits: ["abc123", "def456"],
      },
    };
    expect(arrayFieldFromEntity(envelopeBug, "linkedTaskIds")).toEqual(["task-9", "task-10"]);
    expect(arrayFieldFromEntity(envelopeBug, "fixCommits")).toEqual(["abc123", "def456"]);
  });

  it("returns empty when envelope row has status section but field absent", () => {
    const envelopeBug = { metadata: {}, spec: {}, status: { phase: "open" } };
    expect(arrayFieldFromEntity(envelopeBug, "linkedTaskIds")).toEqual([]);
  });
});

describe("arrayFieldFromEntity — envelope spec section (Turn.tele per cluster-2)", () => {
  it("probes spec section per cluster-2 Turn.ts partition", () => {
    const envelopeTurn = {
      id: "turn-1",
      apiVersion: "core.ois/v1",
      kind: "Turn",
      metadata: { name: "..." },
      spec: { scope: "...", tele: ["T1", "T7"] },
      status: { phase: "active" },
    };
    expect(arrayFieldFromEntity(envelopeTurn, "tele")).toEqual(["T1", "T7"]);
  });
});

describe("arrayFieldFromEntity — envelope metadata section (hypothetical future cluster)", () => {
  it("probes metadata section if field ends up there", () => {
    const entity = { metadata: { tags: ["a", "b"], labels: {} }, spec: {}, status: {} };
    expect(arrayFieldFromEntity(entity, "tags")).toEqual(["a", "b"]);
  });
});

describe("arrayFieldFromEntity — probe order (envelope section wins; mission-90 W8)", () => {
  it("returns the envelope section when both present (envelope-first precedence)", () => {
    // mission-90 W8: the helper probes the envelope partition FIRST (top-level is a
    // graceful fallback for reserved/non-relocated fields), inverting the pre-W8
    // legacy-first precedence — the substrate is envelope-only.
    const mixed = {
      linkedTaskIds: ["legacy-1"],
      status: { linkedTaskIds: ["envelope-1"] },
    };
    expect(arrayFieldFromEntity(mixed, "linkedTaskIds")).toEqual(["envelope-1"]);
  });

  it("returns metadata when top-level absent, before spec/status", () => {
    const entity = {
      metadata: { tele: ["m1"] },
      spec: { tele: ["s1"] },
      status: { tele: ["st1"] },
    };
    expect(arrayFieldFromEntity(entity, "tele")).toEqual(["m1"]);
  });

  it("returns spec when top-level + metadata absent", () => {
    const entity = { spec: { tele: ["s1"] }, status: { tele: ["st1"] } };
    expect(arrayFieldFromEntity(entity, "tele")).toEqual(["s1"]);
  });
});

describe("arrayFieldFromEntity — missing/null defensive (mirror tagsFromEntity coverage)", () => {
  it("returns [] when entity is null", () => {
    expect(arrayFieldFromEntity(null, "tags")).toEqual([]);
  });

  it("returns [] when entity is undefined", () => {
    expect(arrayFieldFromEntity(undefined, "tags")).toEqual([]);
  });

  it("returns [] when entity is a primitive", () => {
    expect(arrayFieldFromEntity(42, "tags")).toEqual([]);
    expect(arrayFieldFromEntity("not-an-entity", "tags")).toEqual([]);
  });

  it("returns [] when neither top-level nor envelope sections have field", () => {
    expect(arrayFieldFromEntity({ id: "x" }, "linkedTaskIds")).toEqual([]);
  });

  it("returns [] when section value is non-object (defensive)", () => {
    expect(arrayFieldFromEntity({ status: "broken" }, "linkedTaskIds")).toEqual([]);
  });

  it("returns [] when field value is non-array (e.g., string)", () => {
    expect(arrayFieldFromEntity({ status: { linkedTaskIds: "not-an-array" } }, "linkedTaskIds")).toEqual([]);
  });
});

// ── mission-90 W3: fieldFromEntity (scalar/object envelope-tolerant read) ─────
describe("fieldFromEntity — Layer-B accessor scalar reader", () => {
  it("legacy-flat: returns the top-level value", () => {
    expect(fieldFromEntity({ missionId: "m-1" }, "missionId")).toBe("m-1");
  });

  it("envelope status section: returns status.<field> (e.g. missionId→status.missionId)", () => {
    expect(fieldFromEntity({ status: { phase: "open", missionId: "m-9" } }, "missionId")).toBe("m-9");
  });

  it("envelope metadata section: returns metadata.<field> (e.g. createdAt, actor)", () => {
    expect(fieldFromEntity({ metadata: { createdAt: "2026-01-01", actor: "hub" } }, "actor")).toBe("hub");
  });

  it("envelope spec section: returns spec.<field> (e.g. severity)", () => {
    expect(fieldFromEntity({ spec: { severity: "critical" } }, "severity")).toBe("critical");
  });

  it("object field: returns the whole object (e.g. createdBy→metadata.createdBy)", () => {
    expect(fieldFromEntity({ metadata: { createdBy: { role: "architect", agentId: "a-1" } } }, "createdBy")).toEqual({ role: "architect", agentId: "a-1" });
  });

  it("NULL-shadow tolerance: a null top-level (repo-normalizer lift) does NOT shadow the section value", () => {
    // thread-repo's normalizeThreadShape nulls top-level currentTurnAgentId on
    // envelope rows; the real value lives at status.currentTurnAgentId.
    expect(fieldFromEntity({ currentTurnAgentId: null, status: { currentTurnAgentId: "eng-9" } }, "currentTurnAgentId")).toBe("eng-9");
  });

  it("envelope section wins over a top-level value (mission-90 W8 envelope-first precedence)", () => {
    // mission-90 W8: partition-first probe — the substrate is envelope-only, so the
    // metadata/spec/status section is authoritative over any stray top-level value.
    expect(fieldFromEntity({ name: "legacy", metadata: { name: "envelope" } }, "name")).toBe("envelope");
  });

  it("absent field: returns undefined; non-object entity: returns undefined", () => {
    expect(fieldFromEntity({ metadata: {}, spec: {}, status: {} }, "nope")).toBeUndefined();
    expect(fieldFromEntity(null, "x")).toBeUndefined();
    expect(fieldFromEntity("str", "x")).toBeUndefined();
  });
});
