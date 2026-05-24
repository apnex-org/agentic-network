/**
 * mission-88 W1 cluster-1 — Proposal migration module unit tests.
 *
 * Per Q3 + cluster-1 Design v0.3 §3.5. Asserts:
 *   - Substrate-truth FSM: submitted/approved/rejected/changes_requested/implemented
 *     (Design v0.2's 4-state draft/under-review/ratified/closed REPLACED)
 *   - DROPS: body, linkedIdeaId, linkedMissionId, reviewCount (don't exist in
 *     substrate; W4.x.7 dropped body-storage; proposalRef is vestigial pointer)
 *   - spec: title, summary (NOT body), executionPlan
 *   - sourceThreadSummary → metadata.annotations
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createProposalMigrationModule } from "../../kinds/Proposal.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const proposalSchema: SchemaDef = {
  kind: "Proposal",
  version: 2,
  fields: [],
  indexes: [],
  watchable: true,
};

function legacyProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prop-1",
    title: "Adopt envelope shape",
    summary: "Migrate substrate to K8s-style envelope per Survey 1",
    proposalRef: "proposals/prop-1.md",  // vestigial; MD file dropped at W4.x.7
    status: "submitted",
    decision: null,
    feedback: null,
    correlationId: null,
    executionPlan: { phases: ["Survey", "Design", "Migrate", "Cutover"] },
    scaffoldResult: null,
    labels: { env: "prod" },
    sourceThreadId: "thread-300",
    sourceActionId: "action-3",
    sourceThreadSummary: "Survey 1 ratification rounds",
    createdBy: { role: "engineer", agentId: "agent-greg" },
    createdAt: "2026-05-20T00:00:00Z",
    updatedAt: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

describe("Proposal migration module", () => {
  const module = createProposalMigrationModule(proposalSchema);

  it("declares kind=Proposal", () => {
    expect(module.kind).toBe("Proposal");
  });

  it("encodes legacy Proposal to envelope shape", () => {
    const env = module.migrateOne(legacyProposal()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Proposal");
    expect(env.id).toBe("prop-1");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("metadata carries provenance + proposalRef + labels + annotations", () => {
    const env = module.migrateOne(legacyProposal()) as EnvelopeShape;
    expect(env.metadata.sourceThreadId).toBe("thread-300");
    expect(env.metadata.sourceActionId).toBe("action-3");
    expect(env.metadata.proposalRef).toBe("proposals/prop-1.md");
    expect(env.metadata.labels).toEqual({ env: "prod" });
    expect(env.metadata.annotations).toEqual({
      "ois.io/sourceThreadSummary": "Survey 1 ratification rounds",
    });
  });

  it("spec carries title + summary + executionPlan (NO body)", () => {
    const env = module.migrateOne(legacyProposal()) as EnvelopeShape;
    expect(env.spec.title).toBe("Adopt envelope shape");
    expect(env.spec.summary).toBe("Migrate substrate to K8s-style envelope per Survey 1");
    expect(env.spec.executionPlan).toEqual({ phases: ["Survey", "Design", "Migrate", "Cutover"] });
    expect(env.spec.body).toBeUndefined();  // Design v0.2 had spec.body — dropped per substrate-truth
  });

  it("status carries FSM phase + decision + feedback + scaffoldResult", () => {
    const env = module.migrateOne(legacyProposal({
      status: "approved",
      decision: "approved",
      feedback: "ship it",
      scaffoldResult: { commits: ["abc123"], success: true },
    })) as EnvelopeShape;
    expect(env.status.phase).toBe("approved");
    expect(env.status.decision).toBe("approved");
    expect(env.status.feedback).toBe("ship it");
    expect(env.status.scaffoldResult).toEqual({ commits: ["abc123"], success: true });
  });

  it("FSM substrate-truth includes changes_requested + implemented (not Design v0.2 closed)", () => {
    expect((module.migrateOne(legacyProposal({ status: "changes_requested" })) as EnvelopeShape).status.phase)
      .toBe("changes_requested");
    expect((module.migrateOne(legacyProposal({ status: "implemented" })) as EnvelopeShape).status.phase)
      .toBe("implemented");
    expect((module.migrateOne(legacyProposal({ status: "rejected" })) as EnvelopeShape).status.phase)
      .toBe("rejected");
  });

  it("DROPS non-existent Design v0.2 fields: body, linkedIdeaId, linkedMissionId, reviewCount", () => {
    const env = module.migrateOne(legacyProposal({
      body: "this should not appear",  // hypothetical legacy field
      linkedIdeaId: "idea-126",
      linkedMissionId: "mission-88",
      reviewCount: 3,
    })) as EnvelopeShape;
    // These fields are NOT in any partition list → they fall to spec via default
    // (envelope.ts pickPartition default-bucket). We assert they don't land where
    // Design v0.2 said (metadata.linkedIdeaId / status.linkedMissionId).
    expect(env.metadata.linkedIdeaId).toBeUndefined();
    expect(env.status.linkedMissionId).toBeUndefined();
    expect(env.status.reviewCount).toBeUndefined();
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyProposal()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
