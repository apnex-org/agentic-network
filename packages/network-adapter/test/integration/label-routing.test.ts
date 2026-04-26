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
import { McpAgentClient } from "../../src/session/mcp-agent-client.js";
import type { AgentEvent } from "../../src/session/agent-client.js";

interface ActorHandle {
  client: McpAgentClient;
  transport: LoopbackTransport;
  engineerId: string;
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
        globalInstanceId: `loopback-${role}-${randomUUID()}`,
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
  const engineerId = await hub.engineerIdForSession(loopbackSid);
  if (!engineerId) throw new Error(`Agent entity was not created for session ${loopbackSid}`);
  return { client, transport, engineerId, actionable };
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
        const agent = await hub.stores.engineerRegistry.getAgent(eng.engineerId);
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
        const agent = await hub.stores.engineerRegistry.getAgent(eng.engineerId);
        expect(agent!.labels).toEqual({});
      } finally {
        await stopAll([eng]);
      }
    });
  });

  describe("Dispatch — selector matches only labeled Agents", () => {
    it("labeled task from {env:prod} architect reaches only {env:prod} engineer", async () => {
      const arch = await createActor(hub, "architect", { env: "prod" });
      const engProd = await createActor(hub, "engineer", { env: "prod" });
      const engSmoke = await createActor(hub, "engineer", { env: "smoke" });

      try {
        // task.labels inherits from creator (architect) = {env:"prod"}
        // dispatch selector → {roles:["engineer"], matchLabels:{env:"prod"}}
        const result = await arch.client.call("create_task", {
          title: "Prod-only directive",
          description: "Should only reach env:prod engineer",
        }) as Record<string, unknown>;
        expect(result.taskId).toBeTruthy();

        await waitFor(() =>
          engProd.actionable.some((e) => e.event === "task_issued"),
          2_000,
        );

        const prodHits = engProd.actionable.filter((e) => e.event === "task_issued");
        const smokeHits = engSmoke.actionable.filter((e) => e.event === "task_issued");
        expect(prodHits.length).toBe(1);
        expect(smokeHits.length).toBe(0);

        // Verify the dispatch record agrees with delivery.
        const dispatches = hub.dispatched.filter((d) => d.event === "task_issued");
        expect(dispatches.length).toBe(1);
        expect(dispatches[0].selector.matchLabels).toEqual({ env: "prod" });
        expect(dispatches[0].deliveredTo).toEqual([engProd.engineerId]);
      } finally {
        await stopAll([arch, engProd, engSmoke]);
      }
    });

    it("empty matchLabels broadcasts to all role-matching Agents (INV-SYS-L09)", async () => {
      // Architect created with no labels → labels={} → task.labels={} →
      // selector.matchLabels={} → matches every engineer regardless of labels.
      const arch = await createActor(hub, "architect");
      const engProd = await createActor(hub, "engineer", { env: "prod" });
      const engSmoke = await createActor(hub, "engineer", { env: "smoke" });
      const engBare = await createActor(hub, "engineer");

      try {
        await arch.client.call("create_task", {
          title: "Unlabeled broadcast",
          description: "Every engineer should see this",
        });

        await waitFor(
          () =>
            engProd.actionable.some((e) => e.event === "task_issued") &&
            engSmoke.actionable.some((e) => e.event === "task_issued") &&
            engBare.actionable.some((e) => e.event === "task_issued"),
          2_000,
        );

        const dispatches = hub.dispatched.filter((d) => d.event === "task_issued");
        expect(dispatches.length).toBe(1);
        expect(dispatches[0].selector.matchLabels).toEqual({});
        expect(dispatches[0].deliveredTo.sort()).toEqual(
          [engProd.engineerId, engSmoke.engineerId, engBare.engineerId].sort(),
        );
      } finally {
        await stopAll([arch, engProd, engSmoke, engBare]);
      }
    });
  });

  describe("Immutability — INV-AG1", () => {
    it("re-registering with different labels does not rewrite Agent.labels", async () => {
      // First handshake: prod
      const first = await createActor(hub, "engineer", { env: "prod" });
      const engineerId = first.engineerId;
      await first.client.stop();

      // Same globalInstanceId → same fingerprint → same Agent.
      // Simulating the second handshake by driving register_role through a
      // fresh transport with a hand-crafted payload that claims smoke.
      const transport2 = new LoopbackTransport(hub);
      await transport2.connect();
      const sid = transport2.getSessionId()!;
      // Reuse the first client's globalInstanceId so the fingerprint matches.
      const firstGii = (hub.getToolCalls("register_role")[0].args.globalInstanceId as string);
      await hub.dispatch(sid, "register_role", {
        role: "engineer",
        globalInstanceId: firstGii,
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

      const agent = await hub.stores.engineerRegistry.getAgent(engineerId);
      expect(agent!.labels).toEqual({ env: "prod" });

      await transport2.close();
    });
  });
});
