/**
 * mission-89 (A3) — agent-envelope-shape unit tests.
 *
 * Covers the W11-partition-locked rename + partition contract for Agent.
 * Verifies roundtrip + filter-key translation + idempotency on already-
 * envelope / already-legacy inputs.
 */

import { describe, it, expect } from "vitest";
import {
  agentToEnvelope,
  envelopeToAgent,
  agentFilterKeyToEnvelopePath,
  agentFilterToEnvelope,
} from "../agent-envelope-shape.js";
import { isEnvelopeShape } from "../../storage-substrate/migrations/v2-envelope/shared/envelope.js";
import type { Agent } from "../../state.js";

const legacyAgent: Agent = {
  id: "agent-fp123",
  name: "test-agent",
  fingerprint: "fp123abc",
  role: "engineer",
  status: "online",
  archived: false,
  sessionEpoch: 3,
  currentSessionId: "session-xyz",
  clientMetadata: {
    clientName: "claude",
    clientVersion: "1.0",
    proxyName: "test",
    proxyVersion: "1.0",
    hostname: "my-host",
  },
  advisoryTags: ["tag-a"],
  labels: { team: "platform", role: "ic" },
  firstSeenAt: "2026-05-25T00:00:00Z",
  lastSeenAt: "2026-05-25T01:00:00Z",
  livenessState: "online",
  lastHeartbeatAt: "2026-05-25T01:00:00Z",
  receiptSla: 3600000,
  wakeEndpoint: "https://example.com/wake",
  activityState: "online_idle",
  sessionStartedAt: "2026-05-25T00:30:00Z",
  lastToolCallAt: "2026-05-25T00:45:00Z",
  lastToolCallName: "get_agents",
  idleSince: null,
  workingSince: null,
  quotaBlockedUntil: null,
  adapterVersion: "1.0.6",
  ipAddress: "192.168.1.1",
  restartCount: 2,
  recentErrors: [],
  restartHistoryMs: [1000, 2000],
  cognitiveTTL: 3600,
  transportTTL: 7200,
  cognitiveState: "active",
  transportState: "online",
} as unknown as Agent;

describe("agentToEnvelope — W11 partition encoding", () => {
  it("encodes legacy-flat Agent → envelope shape with W11 partition", () => {
    const env = agentToEnvelope(legacyAgent);
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Agent");
    expect(env.apiVersion).toBe("core.ois/v1");
    expect(env.id).toBe("agent-fp123");
    expect(env.name).toBe("test-agent");

    // metadata partition: fingerprint, archived + renamed createdAt/updatedAt
    expect(env.metadata.fingerprint).toBe("fp123abc");
    expect(env.metadata.archived).toBe(false);
    expect(env.metadata.createdAt).toBe("2026-05-25T00:00:00Z");
    expect(env.metadata.updatedAt).toBe("2026-05-25T01:00:00Z");

    // spec partition
    expect(env.spec.role).toBe("engineer");
    expect(env.spec.labels).toEqual({ team: "platform", role: "ic" });
    expect(env.spec.receiptSla).toBe(3600000);
    expect(env.spec.wakeEndpoint).toBe("https://example.com/wake");
    expect((env.spec.clientMetadata as { hostname: string }).hostname).toBe("my-host");

    // status partition: phase (renamed from status), plus all live/component fields
    expect(env.status.phase).toBe("online");
    expect(env.status.sessionEpoch).toBe(3);
    expect(env.status.currentSessionId).toBe("session-xyz");
    expect(env.status.livenessState).toBe("online");
    expect(env.status.activityState).toBe("online_idle");
    expect(env.status.cognitiveState).toBe("active");
    expect(env.status.advisoryTags).toEqual(["tag-a"]);
  });

  it("is idempotent — already-envelope input returns unchanged", () => {
    const env1 = agentToEnvelope(legacyAgent);
    const env2 = agentToEnvelope(env1 as unknown as Agent);
    expect(env2).toBe(env1);  // reference-equality (encodeEnvelope idempotency)
  });
});

describe("envelopeToAgent — W11 partition decoding (read-side coerce)", () => {
  it("decodes envelope shape → legacy-flat Agent with W11 fields hoisted", () => {
    const env = agentToEnvelope(legacyAgent);
    const decoded = envelopeToAgent(env);

    expect(decoded.id).toBe("agent-fp123");
    expect(decoded.name).toBe("test-agent");
    expect(decoded.fingerprint).toBe("fp123abc");
    expect(decoded.role).toBe("engineer");
    expect(decoded.status).toBe("online");  // hoisted from envelope.status.phase
    expect(decoded.archived).toBe(false);
    expect(decoded.sessionEpoch).toBe(3);
    expect(decoded.currentSessionId).toBe("session-xyz");
    expect(decoded.labels).toEqual({ team: "platform", role: "ic" });
    expect(decoded.firstSeenAt).toBe("2026-05-25T00:00:00Z");  // hoisted from metadata.createdAt
    expect(decoded.lastSeenAt).toBe("2026-05-25T01:00:00Z");   // hoisted from metadata.updatedAt
    expect(decoded.livenessState).toBe("online");
    expect(decoded.activityState).toBe("online_idle");
    expect(decoded.cognitiveState).toBe("active");
    expect(decoded.transportState).toBe("online");
    expect(decoded.advisoryTags).toEqual(["tag-a"]);
    expect(decoded.recentErrors).toEqual([]);
    expect(decoded.restartHistoryMs).toEqual([1000, 2000]);
    expect(decoded.clientMetadata?.hostname).toBe("my-host");
  });

  it("is tolerant — legacy-flat input returns as-is", () => {
    const decoded = envelopeToAgent(legacyAgent);
    // No envelope-shape: returned untouched (defensive against mixed-shape data window)
    expect(decoded).toBe(legacyAgent);
  });
});

describe("roundtrip: agentToEnvelope → envelopeToAgent (read-then-write preservation)", () => {
  it("preserves all W11-partitioned fields end-to-end", () => {
    const env = agentToEnvelope(legacyAgent);
    const back = envelopeToAgent(env);

    // Spot-check key fields (role-mismatch + name_collision + refresh-path-critical)
    expect(back.role).toBe(legacyAgent.role);
    expect(back.fingerprint).toBe(legacyAgent.fingerprint);
    expect(back.archived).toBe(legacyAgent.archived);
    expect(back.status).toBe(legacyAgent.status);
    expect(back.clientMetadata?.hostname).toBe(legacyAgent.clientMetadata?.hostname);
    expect(back.labels).toEqual(legacyAgent.labels);
    expect(back.receiptSla).toBe(legacyAgent.receiptSla);
    expect(back.wakeEndpoint).toBe(legacyAgent.wakeEndpoint);
    expect(back.sessionEpoch).toBe(legacyAgent.sessionEpoch);
    expect(back.livenessState).toBe(legacyAgent.livenessState);
    expect(back.lastHeartbeatAt).toBe(legacyAgent.lastHeartbeatAt);
    expect(back.firstSeenAt).toBe(legacyAgent.firstSeenAt);
    expect(back.lastSeenAt).toBe(legacyAgent.lastSeenAt);
    expect(back.advisoryTags).toEqual(legacyAgent.advisoryTags);
  });
});

describe("agentFilterKeyToEnvelopePath — legacy-flat → envelope JSONB path", () => {
  it("translates fingerprint → metadata.fingerprint", () => {
    expect(agentFilterKeyToEnvelopePath("fingerprint")).toBe("metadata.fingerprint");
  });

  it("translates archived → metadata.archived", () => {
    expect(agentFilterKeyToEnvelopePath("archived")).toBe("metadata.archived");
  });

  it("translates role → spec.role", () => {
    expect(agentFilterKeyToEnvelopePath("role")).toBe("spec.role");
  });

  it("translates status → status.phase (renameMap reverse)", () => {
    expect(agentFilterKeyToEnvelopePath("status")).toBe("status.phase");
  });

  it("passes through unknown keys unchanged (id stays at envelope top-level)", () => {
    expect(agentFilterKeyToEnvelopePath("id")).toBe("id");
    expect(agentFilterKeyToEnvelopePath("unknown-key")).toBe("unknown-key");
  });
});

describe("agentFilterToEnvelope — full filter object translation", () => {
  it("translates all known legacy keys; preserves values", () => {
    const legacy = { fingerprint: "fp-xyz", role: "engineer" };
    const env = agentFilterToEnvelope(legacy);
    expect(env).toEqual({
      "metadata.fingerprint": "fp-xyz",
      "spec.role": "engineer",
    });
  });

  it("returns undefined for undefined input", () => {
    expect(agentFilterToEnvelope(undefined)).toBeUndefined();
  });
});
