/**
 * mission-88 W1 cluster-1 — Idea migration module unit tests.
 *
 * Per Q3 disposition: encode legacy → re-invoke migrateOne(envelope) → assert
 * reference-equality for idempotency contract. Plus partition shape assertions
 * per cluster-1 Design v0.3 §3.1.
 */

import { describe, it, expect } from "vitest";
import { createIdeaMigrationModule } from "../../kinds/Idea.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const ideaSchema: SchemaDef = {
  kind: "Idea",
  version: 2,
  fields: [],
  indexes: [],
  watchable: true,
};

function legacyIdea(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "idea-1",
    text: "Refactor X to Y",
    status: "open",
    missionId: null,
    createdBy: { role: "engineer", agentId: "agent-greg" },
    sourceThreadId: "thread-100",
    sourceActionId: "action-1",
    sourceThreadSummary: "Discussion about refactoring",
    tags: ["refactor", "architecture"],
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-02T00:00:00Z",
    ...overrides,
  };
}

describe("Idea migration module", () => {
  const module = createIdeaMigrationModule(ideaSchema);

  it("declares kind=Idea", () => {
    expect(module.kind).toBe("Idea");
  });

  it("encodes legacy Idea to envelope shape", () => {
    const legacy = legacyIdea();
    const env = module.migrateOne(legacy) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Idea");
    expect(env.id).toBe("idea-1");
    expect(env.name).toBe("idea-1");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("tags[] → metadata.labels{} (K8s map; empty-string values)", () => {
    const env = module.migrateOne(legacyIdea()) as EnvelopeShape;
    expect(env.metadata.labels).toEqual({ refactor: "", architecture: "" });
  });

  it("sourceThreadSummary → metadata.annotations[ois.io/sourceThreadSummary]", () => {
    const env = module.migrateOne(legacyIdea()) as EnvelopeShape;
    expect(env.metadata.annotations).toEqual({
      "ois.io/sourceThreadSummary": "Discussion about refactoring",
    });
  });

  it("omits annotations when sourceThreadSummary is null/empty", () => {
    const env = module.migrateOne(legacyIdea({ sourceThreadSummary: null })) as EnvelopeShape;
    expect(env.metadata.annotations).toBeUndefined();
  });

  it("metadata carries identity + provenance", () => {
    const env = module.migrateOne(legacyIdea()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-01T00:00:00Z");
    expect(env.metadata.updatedAt).toBe("2026-05-02T00:00:00Z");
    expect(env.metadata.sourceThreadId).toBe("thread-100");
    expect(env.metadata.sourceActionId).toBe("action-1");
    expect(env.metadata.createdBy).toEqual({ role: "engineer", agentId: "agent-greg" });
  });

  it("spec carries declared content (text)", () => {
    const env = module.migrateOne(legacyIdea()) as EnvelopeShape;
    expect(env.spec.text).toBe("Refactor X to Y");
  });

  it("status carries FSM phase + missionId via rename", () => {
    const env = module.migrateOne(legacyIdea({ status: "triaged", missionId: "mission-88" })) as EnvelopeShape;
    expect(env.status.phase).toBe("triaged");
    expect(env.status.missionId).toBe("mission-88");
  });

  it("does not migrate revisionCount (Design v0.2 speculative; not in substrate)", () => {
    const env = module.migrateOne(legacyIdea({ revisionCount: 5 })) as EnvelopeShape;
    // revisionCount isn't in any partition list → falls through to spec via default
    // (it's a leftover from speculative Design v0.2; substrate-current has no such field).
    // We don't actively gate against it; assert it doesn't land in metadata where Design v0.2 said.
    expect(env.metadata.revisionCount).toBeUndefined();
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyIdea()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });

  it("throws on non-object input", () => {
    expect(() => module.migrateOne(null)).toThrow(/must be object/);
    expect(() => module.migrateOne("string")).toThrow(/must be object/);
    expect(() => module.migrateOne(42)).toThrow(/must be object/);
  });
});
