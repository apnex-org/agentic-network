/**
 * mission-88 W4 cluster-4 — Message migration module unit tests.
 *
 * Per cluster-4 Design v0.3 §2.1. Asserts:
 *   - kind (legacy discriminator) → metadata.messageKind CANONICAL field-name-
 *     collision rename (envelope.kind="Message" preserved; no collision)
 *   - status (FSM 3-state) → status.phase
 *   - multi-FSM per §1.6: primary phase + secondary scheduledState as siblings
 *   - target/delivery/payload/escalation/precondition/fireAt/maxRetries/intent/
 *     semanticIntent → spec (declared dispatch+scheduling config)
 *   - claimedBy/scheduledState/retryCount/converged → status (observed FSM-mutated)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createMessageMigrationModule } from "../../kinds/Message.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const messageSchema: SchemaDef = { kind: "Message", version: 2, fields: [], indexes: [], watchable: true };

function legacyMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "01HABCDEFGHIJKLMNOPQRSTUVW",  // ULID-ish
    kind: "reply",                       // legacy discriminator (collision target)
    authorRole: "engineer",
    authorAgentId: "agent-greg",
    target: { role: "architect" },
    threadId: "thread-646",
    sequenceInThread: 3,
    delivery: "push-immediate",
    status: "new",
    payload: { body: "test reply" },
    intent: "decision_needed",
    semanticIntent: "seek_consensus",
    converged: false,
    migrationSourceId: null,
    createdAt: "2026-05-24T04:25:00Z",
    updatedAt: "2026-05-24T04:25:00Z",
    ...overrides,
  };
}

describe("Message migration module", () => {
  const module = createMessageMigrationModule(messageSchema);

  it("declares kind=Message", () => {
    expect(module.kind).toBe("Message");
  });

  it("encodes legacy Message to envelope shape", () => {
    const env = module.migrateOne(legacyMessage()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.id).toBe("01HABCDEFGHIJKLMNOPQRSTUVW");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("CANONICAL field-name-collision rename: legacy.kind → metadata.messageKind; envelope.kind stays 'Message'", () => {
    const env = module.migrateOne(legacyMessage()) as EnvelopeShape;
    expect(env.kind).toBe("Message");  // envelope kind (entity-kind discriminator)
    expect(env.metadata.messageKind).toBe("reply");  // legacy Message.kind preserved as messageKind
    // CRITICAL: no collision — envelope.kind isn't clobbered by legacy.kind
    expect(env.metadata.kind).toBeUndefined();
  });

  it("metadata carries identity + provenance (authorRole/Id + threadId + sequenceInThread + migrationSourceId)", () => {
    const env = module.migrateOne(legacyMessage()) as EnvelopeShape;
    expect(env.metadata.authorRole).toBe("engineer");
    expect(env.metadata.authorAgentId).toBe("agent-greg");
    expect(env.metadata.threadId).toBe("thread-646");
    expect(env.metadata.sequenceInThread).toBe(3);
    expect(env.metadata.migrationSourceId).toBeNull();
    expect(env.metadata.createdAt).toBe("2026-05-24T04:25:00Z");
    expect(env.metadata.updatedAt).toBe("2026-05-24T04:25:00Z");
  });

  it("spec carries declared dispatch + scheduling config", () => {
    const env = module.migrateOne(legacyMessage()) as EnvelopeShape;
    expect(env.spec.target).toEqual({ role: "architect" });
    expect(env.spec.delivery).toBe("push-immediate");
    expect(env.spec.payload).toEqual({ body: "test reply" });
    expect(env.spec.intent).toBe("decision_needed");
    expect(env.spec.semanticIntent).toBe("seek_consensus");
  });

  it("status carries FSM phase + observed claim/scheduling fields (multi-FSM §1.6)", () => {
    const env = module.migrateOne(legacyMessage({
      status: "received",
      claimedBy: "agent-arch",
      scheduledState: "pending",
      retryCount: 1,
      converged: true,
    })) as EnvelopeShape;
    expect(env.status.phase).toBe("received");          // primary FSM
    expect(env.status.claimedBy).toBe("agent-arch");
    expect(env.status.scheduledState).toBe("pending"); // secondary FSM (multi-FSM §1.6)
    expect(env.status.retryCount).toBe(1);
    expect(env.status.converged).toBe(true);
  });

  it("FSM substrate-truth: all 3 phases map to status.phase", () => {
    for (const s of ["new", "received", "acked"]) {
      const env = module.migrateOne(legacyMessage({ status: s })) as EnvelopeShape;
      expect(env.status.phase).toBe(s);
    }
  });

  it("name OMITTED — content-classified §1.5; envelope.name defaults to id", () => {
    const env = module.migrateOne(legacyMessage()) as EnvelopeShape;
    expect(env.name).toBe("01HABCDEFGHIJKLMNOPQRSTUVW");  // id default
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyMessage()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });

  it("all 5 messageKind discriminators preserved through rename", () => {
    for (const k of ["reply", "note", "external-injection", "amendment", "urgency-flag"]) {
      const env = module.migrateOne(legacyMessage({ kind: k })) as EnvelopeShape;
      expect(env.metadata.messageKind).toBe(k);
      expect(env.kind).toBe("Message");
    }
  });
});
