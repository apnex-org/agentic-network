/**
 * Mission-19 label routing — full-stack L7 E2E.
 *
 * Layer:     L7 (McpAgentClient) ↔ LoopbackTransport ↔ PolicyLoopbackHub
 *            (real PolicyRouter + in-memory stores, all 13 policies)
 *
 * Scope:     Verify that routing labels set on McpAgentClient flow through
 *            the enriched register_role handshake, land on the Hub Agent
 *            entity (INV-AG1 immutable), and cause `ctx.dispatch` to
 *            deliver events only to label-matching Agents.
 *
 * Hub-side label/selector unit coverage lives under hub/test/mission-19/.
 * These tests specifically pin the L7 round-trip: plugin-side labels →
 * handshake → Agent.labels → selector match → push delivery.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { LoopbackTransport } from "../helpers/loopback-transport.js";
import { PolicyLoopbackHub } from "../helpers/policy-loopback.js";
import { waitFor, LogCapture } from "../helpers/test-utils.js";
import { McpAgentClient } from "../../src/kernel/mcp-agent-client.js";
import type { AgentEvent } from "../../src/kernel/agent-client.js";

interface ActorHandle {
  client: McpAgentClient;
  transport: LoopbackTransport;
  agentId: string;
  actionable: AgentEvent[];
}

async function createActor(
  hub: PolicyLoopbackHub,
  role: "architect" | "engineer",
  labels?: Record<string, string>,
): Promise<ActorHandle> {
  const transport = new LoopbackTransport(hub);
  const log = new LogCapture();
  const actionable: AgentEvent[] = [];
  const client = new McpAgentClient(
    {
      role,
      labels,
      handshake: {
        // idea-251 name-length limit [1,32]: slice the UUID so the
        // generated name stays in range (full UUID → 54 chars → invalid_name).
        name: `loopback-${role}-${randomUUID().slice(0, 8)}`,
        proxyName: "policy-loopback",
        proxyVersion: "0.0.0",
        transport: "loopback",
        sdkVersion: "0.0.0",
        getClientInfo: () => ({ name: "policy-loopback", version: "0.0.0" }),
      },
      logger: log.logger,
    },
    { transport },
  );
  client.setCallbacks({
    onActionableEvent: (ev) => actionable.push(ev),
  });
  await client.start();
  await waitFor(() => client.isConnected, 5_000);
  const loopbackSid = transport.getSessionId();
  if (!loopbackSid) throw new Error("LoopbackTransport did not bind a session id");
  const agentId = await hub.agentIdForSession(loopbackSid);
  if (!agentId) throw new Error(`Agent entity was not created for session ${loopbackSid}`);
  return { client, transport, agentId, actionable };
}

async function stopAll(actors: ActorHandle[]): Promise<void> {
  for (const a of actors) {
    try { await a.client.stop(); } catch { /* already torn down */ }
  }
}

describe("Mission-19 — label routing (loopback E2E)", () => {
  let hub: PolicyLoopbackHub;

  beforeEach(() => {
    hub = new PolicyLoopbackHub();
  });

  describe("Handshake — labels flow through register_role", () => {
    it("stamps labels on Agent entity when provided", async () => {
      const eng = await createActor(hub, "engineer", { env: "prod", team: "billing" });
      try {
        const agent = await hub.stores.engineerRegistry.getAgent(eng.agentId);
        expect(agent).not.toBeNull();
        expect(agent!.labels).toEqual({ env: "prod", team: "billing" });

        // M18 handshake: bare register_role first, then enriched with labels.
        const calls = hub.getToolCalls("register_role");
        expect(calls.length).toBeGreaterThanOrEqual(1);
        const enriched = calls[calls.length - 1];
        expect(enriched.args.labels).toEqual({ env: "prod", team: "billing" });
      } finally {
        await stopAll([eng]);
      }
    });

    it("persists empty labels when none are provided (legacy broadcast)", async () => {
      const eng = await createActor(hub, "engineer");
      try {
        const agent = await hub.stores.engineerRegistry.getAgent(eng.agentId);
        expect(agent!.labels).toEqual({});
      } finally {
        await stopAll([eng]);
      }
    });
  });

  describe("Dispatch — selector matches only labeled Agents", () => {
    // work-162 (A1): re-pointed off create_task → create_proposal (the surviving
    // label-scoped dispatch: proposal_submitted → architects with matchLabels).
    // Role-inverted — engineer authors, matching-label architect receives.
    it("labeled proposal from {env:prod} engineer reaches only {env:prod} architect", async () => {
      const eng = await createActor(hub, "engineer", { env: "prod" });
      const archProd = await createActor(hub, "architect", { env: "prod" });
      const archSmoke = await createActor(hub, "architect", { env: "smoke" });

      try {
        // proposal.labels inherits from creator (engineer) = {env:"prod"}
        // dispatch selector → {roles:["architect"], matchLabels:{env:"prod"}}
        const result = await eng.client.call("create_proposal", {
          title: "Prod-only proposal",
          summary: "s",
          body: "Should only reach env:prod architect",
        }) as Record<string, unknown>;
        expect(result.proposalId).toBeTruthy();

        await waitFor(() =>
          archProd.actionable.some((e) => e.event === "proposal_submitted"),
          2_000,
        );

        const prodHits = archProd.actionable.filter((e) => e.event === "proposal_submitted");
        const smokeHits = archSmoke.actionable.filter((e) => e.event === "proposal_submitted");
        expect(prodHits.length).toBe(1);
        expect(smokeHits.length).toBe(0);

        // Verify the dispatch record agrees with delivery.
        const dispatches = hub.dispatched.filter((d) => d.event === "proposal_submitted");
        expect(dispatches.length).toBe(1);
        expect(dispatches[0].selector.matchLabels).toEqual({ env: "prod" });
        expect(dispatches[0].deliveredTo).toEqual([archProd.agentId]);
      } finally {
        await stopAll([eng, archProd, archSmoke]);
      }
    });

    it("empty matchLabels broadcasts to all role-matching Agents (INV-SYS-L09)", async () => {
      // work-162: re-pointed off create_task → create_proposal (role-inverted).
      // Engineer created with no labels → labels={} → proposal.labels={} →
      // selector.matchLabels={} → matches every architect regardless of labels.
      const eng = await createActor(hub, "engineer");
      const archProd = await createActor(hub, "architect", { env: "prod" });
      const archSmoke = await createActor(hub, "architect", { env: "smoke" });
      const archBare = await createActor(hub, "architect");

      try {
        await eng.client.call("create_proposal", {
          title: "Unlabeled broadcast",
          summary: "s",
          body: "Every architect should see this",
        });

        await waitFor(
          () =>
            archProd.actionable.some((e) => e.event === "proposal_submitted") &&
            archSmoke.actionable.some((e) => e.event === "proposal_submitted") &&
            archBare.actionable.some((e) => e.event === "proposal_submitted"),
          2_000,
        );

        const dispatches = hub.dispatched.filter((d) => d.event === "proposal_submitted");
        expect(dispatches.length).toBe(1);
        expect(dispatches[0].selector.matchLabels).toEqual({});
        expect(dispatches[0].deliveredTo.sort()).toEqual(
          [archProd.agentId, archSmoke.agentId, archBare.agentId].sort(),
        );
      } finally {
        await stopAll([eng, archProd, archSmoke, archBare]);
      }
    });
  });

  describe("Immutability — INV-AG1", () => {
    it("re-registering with different labels does not rewrite Agent.labels", async () => {
      // First handshake: prod
      const first = await createActor(hub, "engineer", { env: "prod" });
      const agentId = first.agentId;
      await first.client.stop();

      // Same name → same derived agentId → same Agent.
      // Simulating the second handshake by driving register_role through a
      // fresh transport with a hand-crafted payload that claims smoke.
      const transport2 = new LoopbackTransport(hub);
      await transport2.connect();
      const sid = transport2.getSessionId()!;
      // Reuse the first client's name so the derived agentId matches.
      const firstName = (hub.getToolCalls("register_role")[0].args.name as string);
      await hub.dispatch(sid, "register_role", {
        role: "engineer",
        name: firstName,
        clientMetadata: {
          clientName: "relabel-attempt",
          clientVersion: "0.0.0",
          proxyName: "policy-loopback",
          proxyVersion: "0.0.0",
          transport: "loopback",
          sdkVersion: "0.0.0",
        },
        advisoryTags: {},
        labels: { env: "smoke" },
      });

      const agent = await hub.stores.engineerRegistry.getAgent(agentId);
      expect(agent!.labels).toEqual({ env: "prod" });

      await transport2.close();
    });
  });
});
