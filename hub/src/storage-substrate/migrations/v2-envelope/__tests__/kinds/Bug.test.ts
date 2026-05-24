/**
 * mission-88 W1 cluster-1 — Bug migration module unit tests.
 *
 * Per Q3 disposition: idempotency reference-equality + cluster-1 Design v0.3 §3.2
 * partition shape assertions.
 */

import { describe, it, expect } from "vitest";
import { createBugMigrationModule } from "../../kinds/Bug.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const bugSchema: SchemaDef = {
  kind: "Bug",
  version: 2,
  fields: [],
  indexes: [],
  watchable: true,
};

function legacyBug(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "bug-1",
    title: "Counter races",
    description: "SubstrateCounter has CAS race under concurrent callers",
    status: "open",
    severity: "major",
    class: "concurrency",
    tags: ["substrate", "counter"],
    sourceIdeaId: null,
    sourceThreadId: "thread-200",
    sourceActionId: "action-2",
    sourceThreadSummary: "Discovered during W5.4 rollout",
    linkedTaskIds: [],
    linkedMissionId: "mission-83",
    fixCommits: [],
    fixRevision: null,
    surfacedBy: "prod-audit",
    createdBy: { role: "engineer", agentId: "agent-greg" },
    createdAt: "2026-05-17T00:00:00Z",
    updatedAt: "2026-05-17T01:00:00Z",
    ...overrides,
  };
}

describe("Bug migration module", () => {
  const module = createBugMigrationModule(bugSchema);

  it("declares kind=Bug", () => {
    expect(module.kind).toBe("Bug");
  });

  it("encodes legacy Bug to envelope shape", () => {
    const env = module.migrateOne(legacyBug()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Bug");
    expect(env.id).toBe("bug-1");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("tags[] → metadata.labels{}", () => {
    const env = module.migrateOne(legacyBug()) as EnvelopeShape;
    expect(env.metadata.labels).toEqual({ substrate: "", counter: "" });
  });

  it("sourceThreadSummary → metadata.annotations", () => {
    const env = module.migrateOne(legacyBug()) as EnvelopeShape;
    expect(env.metadata.annotations).toEqual({
      "ois.io/sourceThreadSummary": "Discovered during W5.4 rollout",
    });
  });

  it("metadata carries provenance + surfacedBy", () => {
    const env = module.migrateOne(legacyBug()) as EnvelopeShape;
    expect(env.metadata.surfacedBy).toBe("prod-audit");
    expect(env.metadata.sourceIdeaId).toBe(null);
    expect(env.metadata.sourceThreadId).toBe("thread-200");
    expect(env.metadata.sourceActionId).toBe("action-2");
  });

  it("spec carries title + description + severity + class", () => {
    const env = module.migrateOne(legacyBug()) as EnvelopeShape;
    expect(env.spec.title).toBe("Counter races");
    expect(env.spec.description).toBe("SubstrateCounter has CAS race under concurrent callers");
    expect(env.spec.severity).toBe("major");
    expect(env.spec.class).toBe("concurrency");
  });

  it("status carries FSM phase + observed linkage + fix details", () => {
    const env = module.migrateOne(legacyBug({
      status: "resolved",
      fixCommits: ["e109000"],
      fixRevision: "mission-83 W5.5",
      linkedTaskIds: ["task-401"],
    })) as EnvelopeShape;
    expect(env.status.phase).toBe("resolved");
    expect(env.status.fixCommits).toEqual(["e109000"]);
    expect(env.status.fixRevision).toBe("mission-83 W5.5");
    expect(env.status.linkedTaskIds).toEqual(["task-401"]);
    expect(env.status.linkedMissionId).toBe("mission-83");
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyBug()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });

  it("FSM enum substrate-truth includes wontfix (Design v0.2 enum was correct here)", () => {
    const env = module.migrateOne(legacyBug({ status: "wontfix" })) as EnvelopeShape;
    expect(env.status.phase).toBe("wontfix");
  });
});
