/**
 * n4-work-hub — the M-Real-CLI-Harness n4 "test-Hub-WITH-WORK" construction.
 *
 * Real HubNetworking over a MEMORY substrate, with the FULL production PolicyRouter
 * (the hub/src/index.ts registration set) bound via the production `bindRouterToMcp`.
 * A shim pointed at this Hub therefore proxies the REAL Hub tool catalogue —
 * register_role / get_agents / list_ready_work / claim_work / start_work /
 * complete_work / renew_lease / ... — NOT the hardcoded stub surface of TestHub.
 * Plus ONE seeded ready engineer-claimable WorkItem (the trivial self-test task).
 *
 * Why a fresh construction (not TestHub / PolicyLoopbackHub / createTestContext): all
 * three OMIT the WorkItem repository (AllStores.workItem is optional) and TestHub
 * HARDCODES its MCP tool surface instead of binding the router — so none expose the
 * work-queue verbs. This adds the WorkItem repo + binds the full router.
 *
 * VACUITY-GUARD (architect, the load-bearing n4 faithfulness bar): this Hub provides
 * ONLY the queryable work-surface + the seed. The `work_claimable_digest` is
 * constructed by the REAL shim/kernel (heartbeat -> list_ready_work -> digest ->
 * notifications/claude/channel), reused VERBATIM — it is NOT faked/injected here. A
 * real claude-code CLI must autonomously ACT on that digest; a Hub that faked the
 * digest would make the behavioral finding vacuous.
 *
 * Memory-mode (no `pg`) + leaf imports only, so the standalone entrypoint that wraps
 * this bundles via esbuild to a self-contained .mjs (same model as the P1e-2 hub).
 * ZERO prod surface — TEST code only.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HubNetworking } from "../../../../hub/src/hub-networking.js";
import type { CreateMcpServerFn, HubNetworkingConfig } from "../../../../hub/src/hub-networking.js";
import { createMemoryStorageSubstrate } from "../../../../hub/src/storage-substrate/memory-substrate.js";
import { SubstrateCounter } from "../../../../hub/src/entities/substrate-counter.js";
import { AgentRepositorySubstrate } from "../../../../hub/src/entities/agent-repository-substrate.js";
import { ProposalRepositorySubstrate } from "../../../../hub/src/entities/proposal-repository-substrate.js";
import { ThreadRepositorySubstrate } from "../../../../hub/src/entities/thread-repository-substrate.js";
import { IdeaRepositorySubstrate } from "../../../../hub/src/entities/idea-repository-substrate.js";
import { MissionRepositorySubstrate } from "../../../../hub/src/entities/mission-repository-substrate.js";
import { AuditRepositorySubstrate } from "../../../../hub/src/entities/audit-repository-substrate.js";
import { BugRepositorySubstrate } from "../../../../hub/src/entities/bug-repository-substrate.js";
import { MessageRepositorySubstrate } from "../../../../hub/src/entities/message-repository-substrate.js";
import { PendingActionRepositorySubstrate } from "../../../../hub/src/entities/pending-action-repository-substrate.js";
import { WorkItemRepositorySubstrate } from "../../../../hub/src/entities/work-item-repository-substrate.js";
import { PolicyRouter } from "../../../../hub/src/policy/router.js";
import { bindRouterToMcp } from "../../../../hub/src/policy/mcp-binding.js";
import type { AllStores, IPolicyContext } from "../../../../hub/src/policy/types.js";
import type { IWorkItemStore } from "../../../../hub/src/entities/work-item.js";
import { createMetricsCounter } from "../../../../hub/src/observability/metrics.js";
// Production policies — imported from leaves (mirrors hub/src/index.ts), pg-free.
import { registerSystemPolicy } from "../../../../hub/src/policy/system-policy.js";
import { registerAuditPolicy } from "../../../../hub/src/policy/audit-policy.js";
import { registerSessionPolicy } from "../../../../hub/src/policy/session-policy.js";
import { registerIdeaPolicy } from "../../../../hub/src/policy/idea-policy.js";
import { registerMissionPolicy } from "../../../../hub/src/policy/mission-policy.js";
import { registerProposalPolicy } from "../../../../hub/src/policy/proposal-policy.js";
import { registerThreadPolicy } from "../../../../hub/src/policy/thread-policy.js";
import { registerBugPolicy } from "../../../../hub/src/policy/bug-policy.js";
import { registerWorkItemPolicy } from "../../../../hub/src/policy/work-item-policy.js";
import { registerPendingActionPolicy } from "../../../../hub/src/policy/pending-action-policy.js";
import { registerMessagePolicy } from "../../../../hub/src/policy/message-policy.js";
import { registerTransportHeartbeatPolicy } from "../../../../hub/src/handlers/transport-heartbeat-handler.js";

/** The full set of repositories, INCLUDING the WorkItem store (the n4 net-new vs the
 *  other memory builders). engineerRegistry/audit/message/workItem are returned
 *  by-name because the HubNetworking constructor + the seed need them directly. */
export interface N4Stores {
  stores: AllStores;
  engineerRegistry: AgentRepositorySubstrate;
  audit: AuditRepositorySubstrate;
  message: MessageRepositorySubstrate;
  workItem: IWorkItemStore;
}

/** Build the memory-backed store set (envelope-encoded by default —
 *  createMemoryStorageSubstrate wires the v2 write-encoder), INCLUDING workItem. */
export function buildN4Stores(): N4Stores {
  const substrate = createMemoryStorageSubstrate();
  const counter = new SubstrateCounter(substrate);
  const idea = new IdeaRepositorySubstrate(substrate, counter);
  const mission = new MissionRepositorySubstrate(substrate, counter, idea);
  const engineerRegistry = new AgentRepositorySubstrate(substrate);
  const audit = new AuditRepositorySubstrate(substrate, counter);
  const message = new MessageRepositorySubstrate(substrate);
  const workItem = new WorkItemRepositorySubstrate(substrate, counter);
  const stores: AllStores = {
    engineerRegistry,
    proposal: new ProposalRepositorySubstrate(substrate, counter),
    thread: new ThreadRepositorySubstrate(substrate, counter),
    audit,
    idea,
    mission,
    bug: new BugRepositorySubstrate(substrate, counter),
    pendingAction: new PendingActionRepositorySubstrate(substrate, counter),
    message,
    workItem,
  };
  return { stores, engineerRegistry, audit, message, workItem };
}

/** Build the full production PolicyRouter (mirrors hub/src/index.ts:256-284, minus
 *  registerDocumentPolicy — no document tools are exercised in the n4 flow and the
 *  DocumentRepository leaf is skipped to keep the esbuild bundle pg-free). Every
 *  registered policy's backing store is present in buildN4Stores(). */
export function buildN4Router(): PolicyRouter {
  const router = new PolicyRouter(() => {});
  registerSystemPolicy(router);
  registerAuditPolicy(router);
  registerSessionPolicy(router);
  registerIdeaPolicy(router);
  registerMissionPolicy(router);
  registerProposalPolicy(router);
  registerThreadPolicy(router);
  registerBugPolicy(router);
  registerWorkItemPolicy(router);
  registerPendingActionPolicy(router);
  registerMessagePolicy(router);
  registerTransportHeartbeatPolicy(router);
  return router;
}

/** The seeded self-test runbook — self-contained (write a sentinel file, then
 *  complete_work with one freeform evidence item). Deliberately NOT engineer-role
 *  priming: the n4 BOOTSTRAP finding is whether the raw CLI acts on the digest with
 *  the work-item's own runbook ALONE. `proofPath` is the container's write surface. */
export function selfTestRunbook(proofPath: string): string {
  return [
    "You are an autonomous engineer. This is a connectivity self-test work item.",
    "Do exactly these steps, then stop:",
    `1. Write a file at ${proofPath} whose entire contents are the single line: N4-ENGINEER-PROOF-OK`,
    "2. Mark this work item complete: call complete_work with this item's workId, the leaseToken from your claim, and",
    `   evidence: [{ requirementId: "self-test", kind: "freeform", producedAt: <current ISO-8601 timestamp>, note: "wrote ${proofPath}" }]`,
    "That completes the self-test. Do not modify anything else.",
  ].join("\n");
}

/** Seed ONE ready engineer-claimable WorkItem (type=task, roleEligibility=[engineer],
 *  no dependsOn, empty evidenceRequirements). Even with no requirements, complete_work
 *  enforces the >=1-freeform-evidence floor, so the LLM must supply one freeform item. */
export async function seedSelfTestWorkItem(
  workItem: IWorkItemStore,
  proofPath: string,
): Promise<string> {
  const item = await workItem.createWorkItem({
    type: "task",
    roleEligibility: ["engineer"],
    dependsOn: [],
    evidenceRequirements: [],
    runbook: selfTestRunbook(proofPath),
  });
  return item.id;
}

export interface N4TestHub {
  hub: HubNetworking;
  stores: AllStores;
  workItem: IWorkItemStore;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  readonly url: string;
  /** n5 SILENT-wedge (P1e-2 parity): evict ALL sessions from HubNetworking's in-memory
   *  `transports` map WITHOUT closing the SSE — the next session-requiring POST (the L1.5 probe)
   *  400s while keepalives keep flowing, the keepalives-flowing-but-session-dead wedge that
   *  escalates via L1.5 -> sentinel -> supervisor exit-75. Returns the count evicted. */
  evictAllTransports: () => number;
  /** n5 chaos (b) — model an L1-UNRECOVERABLE session: while wedged, the policy ctxFactory THROWS
   *  on EVERY tool call, so the shim's L1 reconnect handshake (register_role/claim_session) FAILS
   *  AND every get_task liveness-probe FAILS — no intervening recovery to reset the watchdog
   *  counter -> 2 consecutive failures -> sentinel -> exit-75 -> L2. Keepalives (SSE) stay untouched:
   *  the exact keepalives-flowing-but-session-DEAD edge L1.5 exists for (vs (a) tuning eviction
   *  density to beat the probe timing, which games the detector — unfaithful, cal #79/#82). */
  setWedged: (on: boolean) => void;
}

export interface N4TestHubOptions {
  port?: number;
  bindAddress?: string;
  sessionTtl?: number;
  quiet?: boolean;
  /** SSE keepalive cadence (ms). Default 10_000 — short enough to outrun the shim's
   *  sse_watchdog so the long-lived engineer session survives to the self-wake heartbeat. */
  keepaliveInterval?: number;
}

/** Assemble the full network-servable n4 test-Hub: HubNetworking with a createServer
 *  that binds the full production router via bindRouterToMcp (NOT hardcoded stubs). */
export function createN4TestHub(options: N4TestHubOptions = {}): N4TestHub {
  const { stores, engineerRegistry, audit, message, workItem } = buildN4Stores();
  const router = buildN4Router();
  // n5 chaos (b): while true, the ctxFactory throws on every tool call → the shim's reconnect
  // handshake + every liveness-probe fail → L1 cannot recover → the watchdog reaches its budget → L2.
  let wedged = false;

  const createServer: CreateMcpServerFn = (getSessionId, getClientIp, notifyEvent, dispatchEvent) => {
    const server = new McpServer(
      { name: "real-cli-n4-test-hub", version: "1.0.0" },
      { capabilities: { logging: {} } },
    );
    const ctxFactory = (): IPolicyContext => {
      if (wedged) {
        throw new Error("session wedged — n5 L1-unrecoverable chaos (b): tool calls + reconnect handshake rejected; keepalives untouched");
      }
      const sessionId = getSessionId();
      return {
        stores,
        emit: async (event, data, targetRoles) => { await notifyEvent(event, data, targetRoles); },
        dispatch: async (event, data, selector) => { await dispatchEvent(event, data, selector); },
        sessionId,
        clientIp: getClientIp(),
        role: stores.engineerRegistry.getRole(sessionId),
        internalEvents: [],
        metrics: createMetricsCounter(),
      };
    };
    bindRouterToMcp(server, router, ctxFactory);
    return server;
  };

  const config: HubNetworkingConfig = {
    port: options.port ?? 0,
    apiToken: "",
    // Prod-faithful 30s (matches hub/src/index.ts:443 + the agent's 60s firstKeepaliveDeadline
    // / 90s sseKeepaliveTimeout). The n4 render-receipt SSE-drop is a delivery gap (the standalone
    // must actually push the keepalive over the live SSE stream), NOT a cadence problem — fix the
    // delivery, do NOT shorten below prod (that would test a non-prod config; architect directive).
    keepaliveInterval: options.keepaliveInterval ?? 30_000,
    sessionTtl: options.sessionTtl ?? 3_600_000, // 1h — never reap the long-lived engineer session
    reaperInterval: 60_000,
    orphanTtl: 3_600_000,
    autoStartTimers: true, // keepalive + reaper flow (faithful to the prod session lifecycle)
    quiet: options.quiet ?? false,
    bindAddress: options.bindAddress ?? "127.0.0.1",
  };

  const hub = new HubNetworking(engineerRegistry, createServer, config, audit, message);
  return {
    hub,
    stores,
    workItem,
    start: () => hub.start(),
    stop: () => hub.stop(),
    get url() { return hub.url; },
    evictAllTransports: () => {
      const transports = (hub as unknown as { transports: Map<string, unknown> }).transports;
      const n = transports.size;
      transports.clear();
      return n;
    },
    setWedged: (on: boolean) => { wedged = on; },
  };
}
