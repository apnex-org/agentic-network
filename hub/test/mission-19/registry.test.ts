/**
 * Mission-19 — Agent registry label lifecycle.
 *
 * Covers: first-create persists labels, displacement preserves labels
 * (incoming ignored), legacy agents default to empty labels, P2P via
 * engineerId stable across reconnects.
 *
 * Registry invariants: INV-AG1, INV-AG2, INV-AG4, INV-AG5.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryEngineerRegistry,
  type RegisterAgentPayload,
  type AgentClientMetadata,
  type AgentLabels,
  type AgentRole,
} from "../../src/state.js";

const CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@ois/claude-plugin",
  proxyVersion: "1.0.0",
};

function payload(instanceId: string, role: AgentRole, labels?: AgentLabels): RegisterAgentPayload {
  return {
    globalInstanceId: instanceId,
    role,
    clientMetadata: CLIENT,
    labels,
  };
}

describe("Mission-19 Registry — label persistence", () => {
  let reg: MemoryEngineerRegistry;

  beforeEach(() => {
    reg = new MemoryEngineerRegistry();
  });

  it("first registration persists the declared labels (INV-AG5)", async () => {
    const result = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform", env: "prod" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const agent = await reg.getAgent(result.engineerId);
    expect(agent?.labels).toEqual({ team: "platform", env: "prod" });
  });

  it("displacement preserves the originally-persisted labels (INV-AG1)", async () => {
    // First contact with labels X.
    const first = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform", env: "prod" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Displacement: same fingerprint, but the caller sends different labels.
    const second = await reg.registerAgent("sess-2", "engineer",
      payload("inst-1", "engineer", { team: "network", env: "staging" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const agent = await reg.getAgent(first.engineerId);
    // Labels should be the ORIGINAL set — displacement cannot mutate routing.
    expect(agent?.labels).toEqual({ team: "platform", env: "prod" });
  });

  it("displacement with missing labels payload preserves originals", async () => {
    const first = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Displacement omits labels entirely.
    await reg.registerAgent("sess-2", "engineer",
      payload("inst-1", "engineer", undefined));

    const agent = await reg.getAgent(first.engineerId);
    expect(agent?.labels).toEqual({ team: "platform" });
  });

  it("agent without labels in payload defaults to empty map (INV-AG4)", async () => {
    const result = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", undefined));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const agent = await reg.getAgent(result.engineerId);
    expect(agent?.labels).toEqual({});
  });

  it("sessionEpoch increments on displacement but engineerId stays stable (INV-AG2)", async () => {
    const first = await reg.registerAgent("sess-1", "engineer", payload("inst-1", "engineer"));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const engineerId = first.engineerId;
    const firstEpoch = first.sessionEpoch;

    const second = await reg.registerAgent("sess-2", "engineer", payload("inst-1", "engineer"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.engineerId).toBe(engineerId); // stable identity
    expect(second.sessionEpoch).toBe(firstEpoch + 1);
  });
});

describe("Mission-19 Registry — session resolution for P2P routing", () => {
  let reg: MemoryEngineerRegistry;

  beforeEach(() => {
    reg = new MemoryEngineerRegistry();
  });

  it("getAgentForSession returns the Agent bound to the current session", async () => {
    const result = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const agent = await reg.getAgentForSession("sess-1");
    expect(agent?.engineerId).toBe(result.engineerId);
    expect(agent?.labels).toEqual({ team: "platform" });
  });

  it("getAgentForSession returns null for unknown session", async () => {
    const agent = await reg.getAgentForSession("unregistered");
    expect(agent).toBeNull();
  });

  it("after transport-driven offline + displacement, only the new session resolves", async () => {
    await reg.registerAgent("sess-1", "engineer", payload("inst-1", "engineer"));
    // Transport detects the old connection died and calls markAgentOffline for sess-1,
    // which unbinds sess-1 from the agent.
    await reg.markAgentOffline("sess-1");

    await reg.registerAgent("sess-2", "engineer", payload("inst-1", "engineer"));

    const agentOnOld = await reg.getAgentForSession("sess-1");
    expect(agentOnOld).toBeNull();

    const agentOnNew = await reg.getAgentForSession("sess-2");
    expect(agentOnNew).not.toBeNull();
  });

  it("P2P routing via engineerId survives reconnection (INV-AG2)", async () => {
    const first = await reg.registerAgent("sess-1", "engineer",
      payload("inst-1", "engineer", { team: "platform" }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate reconnect.
    await reg.markAgentOffline("sess-1");
    const second = await reg.registerAgent("sess-2", "engineer",
      payload("inst-1", "engineer", { team: "platform" }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // The engineerId is unchanged; a P2P selector pinned to it resolves.
    expect(second.engineerId).toBe(first.engineerId);
    const matched = await reg.selectAgents({ engineerId: first.engineerId });
    expect(matched).toHaveLength(1);
    expect(matched[0].currentSessionId).toBe("sess-2");
  });
});
