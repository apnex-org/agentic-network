/**
 * mission-88 W3 cluster-3 — Agent migration module unit tests.
 *
 * Per cluster-3 Design v0.3 §2.1. Asserts:
 *   - 5 distinct status fields per Q3 ratified (phase + livenessState + activityState +
 *     cognitiveState + transportState; K8s Pod.status siblings precedent)
 *   - name → metadata.name + envelope.name (handle-classified)
 *   - role → spec (declared-immutable identity)
 *   - labels → spec.labels (Mission-19 routing-intent; PodSpec scheduling-affinity precedent)
 *   - firstSeenAt → metadata.createdAt rename
 *   - lastSeenAt → metadata.updatedAt rename
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createAgentMigrationModule } from "../../kinds/Agent.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const agentSchema: SchemaDef = { kind: "Agent", version: 2, fields: [], indexes: [], watchable: true };

function legacyAgent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "agent-abc12345",
    fingerprint: "f".repeat(64),
    role: "engineer",
    status: "online",
    archived: false,
    sessionEpoch: 3,
    currentSessionId: "session-1",
    clientMetadata: { sdkVersion: "1.0.0" },
    advisoryTags: { proxyVersion: "2.1.0" },
    labels: { class: "implementation" },
    firstSeenAt: "2026-05-20T00:00:00Z",
    lastSeenAt: "2026-05-24T03:55:00Z",
    livenessState: "online",
    lastHeartbeatAt: "2026-05-24T03:54:30Z",
    receiptSla: 30000,
    wakeEndpoint: null,
    name: "greg",
    activityState: "online_working",
    sessionStartedAt: "2026-05-24T03:00:00Z",
    lastToolCallAt: "2026-05-24T03:54:00Z",
    lastToolCallName: "create_thread_reply",
    idleSince: null,
    workingSince: "2026-05-24T03:50:00Z",
    quotaBlockedUntil: null,
    cognitiveTTL: 300,
    transportTTL: 60,
    cognitiveState: "alive",
    transportState: "alive",
    adapterVersion: "@apnex/network-adapter@2.1.0",
    ipAddress: "10.0.0.1",
    restartCount: 0,
    recentErrors: [],
    restartHistoryMs: [],
    ...overrides,
  };
}

describe("Agent migration module", () => {
  const module = createAgentMigrationModule(agentSchema);

  it("declares kind=Agent", () => {
    expect(module.kind).toBe("Agent");
  });

  it("encodes legacy Agent to envelope shape", () => {
    const env = module.migrateOne(legacyAgent()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Agent");
    expect(env.id).toBe("agent-abc12345");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("name → envelope.name top-level (handle-classified per §1.5)", () => {
    const env = module.migrateOne(legacyAgent()) as EnvelopeShape;
    expect(env.name).toBe("greg");
  });

  it("firstSeenAt → metadata.createdAt (uniformity rename)", () => {
    const env = module.migrateOne(legacyAgent()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-05-20T00:00:00Z");
  });

  it("lastSeenAt → metadata.updatedAt (uniformity rename)", () => {
    const env = module.migrateOne(legacyAgent()) as EnvelopeShape;
    expect(env.metadata.updatedAt).toBe("2026-05-24T03:55:00Z");
  });

  it("metadata carries fingerprint + archived (identity-shape)", () => {
    const env = module.migrateOne(legacyAgent()) as EnvelopeShape;
    expect(env.metadata.fingerprint).toBe("f".repeat(64));
    expect(env.metadata.archived).toBe(false);
  });

  it("spec carries role + labels + handshake config", () => {
    const env = module.migrateOne(legacyAgent()) as EnvelopeShape;
    expect(env.spec.role).toBe("engineer");
    expect(env.spec.labels).toEqual({ class: "implementation" });
    expect(env.spec.receiptSla).toBe(30000);
    expect(env.spec.clientMetadata).toEqual({ sdkVersion: "1.0.0" });
  });

  it("status carries 5 distinct FSM fields per Q3 per-FSM-as-top-level", () => {
    const env = module.migrateOne(legacyAgent()) as EnvelopeShape;
    expect(env.status.phase).toBe("online");
    expect(env.status.livenessState).toBe("online");
    expect(env.status.activityState).toBe("online_working");
    expect(env.status.cognitiveState).toBe("alive");
    expect(env.status.transportState).toBe("alive");
  });

  it("status carries telemetry + counters", () => {
    const env = module.migrateOne(legacyAgent()) as EnvelopeShape;
    expect(env.status.sessionEpoch).toBe(3);
    expect(env.status.currentSessionId).toBe("session-1");
    expect(env.status.lastToolCallAt).toBe("2026-05-24T03:54:00Z");
    expect(env.status.lastToolCallName).toBe("create_thread_reply");
    expect(env.status.cognitiveTTL).toBe(300);
    expect(env.status.transportTTL).toBe(60);
    expect(env.status.adapterVersion).toBe("@apnex/network-adapter@2.1.0");
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyAgent()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });

  it("offline-clamped activityState preserved (Mission-62 auto-clamp invariant)", () => {
    const env = module.migrateOne(legacyAgent({
      status: "offline",
      livenessState: "offline",
      activityState: "offline",
    })) as EnvelopeShape;
    expect(env.status.phase).toBe("offline");
    expect(env.status.activityState).toBe("offline");
  });
});
