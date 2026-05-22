/**
 * PolicyLoopbackHub — full-stack L7 test harness.
 *
 * Plugs the real Hub `PolicyRouter` (the production policies) and
 * in-memory stores behind the `ILoopbackHub` contract, so
 * `McpAgentClient` can run against it through `LoopbackTransport`
 * without spinning up HTTP/SSE.
 *
 * Intent: exercise Mission-19 label/selector routing end-to-end through
 * the real session FSM, real register_role handshake, real Agent store,
 * and real `ctx.dispatch` selector evaluation — everything except the
 * network. Faster and more deterministic than `TestHub` (which runs
 * real HubNetworking over localhost) while keeping full policy fidelity.
 *
 * Not a drop-in `LoopbackHub`: this harness does NOT register the
 * built-in stub handlers. Every tool call is dispatched through the
 * `PolicyRouter`.
 */

import { PolicyRouter, registerTaskPolicy, registerSystemPolicy, registerTelePolicy, registerAuditPolicy, registerSessionPolicy, registerIdeaPolicy, registerMissionPolicy, registerTurnPolicy, registerClarificationPolicy, registerReviewPolicy, registerProposalPolicy, registerThreadPolicy } from "../../../../hub/src/policy/index.js";
import type { AllStores, IPolicyContext } from "../../../../hub/src/policy/types.js";
import type { Selector } from "../../../../hub/src/state.js";
// bug-109 PR-4b — PolicyLoopbackHub repaired against the post-mission-83
// substrate. The Memory*Store classes this harness used were removed by the
// substrate migration; it is rebuilt on createMemoryStorageSubstrate + the
// *RepositorySubstrate repositories — the same AllStores construction
// hub/src/policy/test-utils.ts uses.
import { createMemoryStorageSubstrate } from "../../../../hub/src/storage-substrate/index.js";
import { SubstrateCounter } from "../../../../hub/src/entities/substrate-counter.js";
import { AgentRepositorySubstrate } from "../../../../hub/src/entities/agent-repository-substrate.js";
import { TaskRepositorySubstrate } from "../../../../hub/src/entities/task-repository-substrate.js";
import { ProposalRepositorySubstrate } from "../../../../hub/src/entities/proposal-repository-substrate.js";
import { ThreadRepositorySubstrate } from "../../../../hub/src/entities/thread-repository-substrate.js";
import { IdeaRepositorySubstrate } from "../../../../hub/src/entities/idea-repository-substrate.js";
import { MissionRepositorySubstrate } from "../../../../hub/src/entities/mission-repository-substrate.js";
import { TurnRepositorySubstrate } from "../../../../hub/src/entities/turn-repository-substrate.js";
import { TeleRepositorySubstrate } from "../../../../hub/src/entities/tele-repository-substrate.js";
import { AuditRepositorySubstrate } from "../../../../hub/src/entities/audit-repository-substrate.js";
import { BugRepositorySubstrate } from "../../../../hub/src/entities/bug-repository-substrate.js";
import { MessageRepositorySubstrate } from "../../../../hub/src/entities/message-repository-substrate.js";
import { PendingActionRepositorySubstrate } from "../../../../hub/src/entities/pending-action-repository-substrate.js";
import { createMetricsCounter, type MetricsCounter } from "../../../../hub/src/observability/metrics.js";
import type { ILoopbackHub, LoopbackTransport, ToolCall } from "./loopback-transport.js";

export interface DispatchedEvent {
  event: string;
  data: Record<string, unknown>;
  selector: Selector;
  deliveredTo: string[]; // agentIds notified via _deliverPush
  timestamp: number;
}

export interface EmittedEvent {
  event: string;
  data: Record<string, unknown>;
  targetRoles: string[];
  timestamp: number;
}

export class PolicyLoopbackHub implements ILoopbackHub {
  readonly router: PolicyRouter;
  readonly stores: AllStores;
  readonly dispatched: DispatchedEvent[] = [];
  readonly emitted: EmittedEvent[] = [];

  private sessions = new Map<string, LoopbackTransport>();
  private toolCallLog: ToolCall[] = [];
  private nextSessionId = 1;
  private nextEventId = 1;
  private metrics: MetricsCounter;

  constructor() {
    this.stores = this.createStores();
    this.router = this.createRouter();
    this.metrics = createMetricsCounter();
  }

  // ── ILoopbackHub contract ───────────────────────────────────────────

  attach(transport: LoopbackTransport): string {
    const sid = `policy-loopback-${this.nextSessionId++}`;
    this.sessions.set(sid, transport);
    return sid;
  }

  detach(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  listMethods(): string[] {
    return this.router.getAllToolNames();
  }

  async dispatch(
    sessionId: string,
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    this.toolCallLog.push({ tool: method, args, sessionId, at: Date.now() });

    const ctx = this.buildCtx(sessionId);
    const result = await this.router.handle(method, args, ctx);

    const text = result.content[0]?.text ?? "{}";
    // LoopbackTransport mirrors McpTransport: parse content[0].text as JSON.
    // On isError, we return the envelope so `parseHandshakeError` can detect
    // FATAL_CODES (identity_replaced, role_mismatch, etc).
    if (result.isError) {
      return { isError: true, content: result.content };
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ── Test helpers ────────────────────────────────────────────────────

  getToolCalls(tool: string): ToolCall[] {
    return this.toolCallLog.filter((c) => c.tool === tool);
  }

  getToolCallLog(): ToolCall[] {
    return [...this.toolCallLog];
  }

  clearToolCallLog(): void {
    this.toolCallLog.length = 0;
  }

  /** Engineer ID currently bound to a loopback session, if any. */
  async agentIdForSession(sessionId: string): Promise<string | null> {
    const agent = await this.stores.engineerRegistry.getAgentForSession(sessionId);
    return agent?.id ?? null;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private buildCtx(sessionId: string): IPolicyContext {
    return {
      stores: this.stores,
      emit: async (event, data, targetRoles) => {
        const roles = targetRoles ?? ["architect", "engineer", "director"];
        this.emitted.push({ event, data, targetRoles: [...roles], timestamp: Date.now() });
        // Role-based broadcast — deliver to every session whose Agent has a
        // role in `roles`. Mirrors legacy SSE behavior.
        for (const [sid] of this.sessions) {
          const role = this.stores.engineerRegistry.getRole(sid);
          if (roles.includes(role)) this.pushToSession(sid, event, data);
        }
      },
      dispatch: async (event, data, selector) => {
        const matched = await this.stores.engineerRegistry.selectAgents(selector);
        const delivered: string[] = [];
        for (const agent of matched) {
          const targetSid = agent.currentSessionId;
          if (!targetSid) continue;
          if (!this.sessions.has(targetSid)) continue;
          this.pushToSession(targetSid, event, data);
          delivered.push(agent.id);
        }
        this.dispatched.push({
          event,
          data,
          selector: { ...selector },
          deliveredTo: delivered,
          timestamp: Date.now(),
        });
      },
      sessionId,
      clientIp: "127.0.0.1",
      role: this.stores.engineerRegistry.getRole(sessionId),
      internalEvents: [],
      metrics: this.metrics,
    };
  }

  private pushToSession(sid: string, event: string, data: Record<string, unknown>): void {
    const transport = this.sessions.get(sid);
    if (!transport) return;
    transport._deliverPush("hub-event", {
      id: this.nextEventId++,
      event,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  private createStores(): AllStores {
    // Substrate-version repositories over a fresh MemoryHubStorageSubstrate +
    // SubstrateCounter — mirrors hub/src/policy/test-utils.ts createTestContext.
    const substrate = createMemoryStorageSubstrate();
    const counter = new SubstrateCounter(substrate);
    const task = new TaskRepositorySubstrate(substrate, counter);
    const idea = new IdeaRepositorySubstrate(substrate, counter);
    const mission = new MissionRepositorySubstrate(substrate, counter, task, idea);
    return {
      task,
      engineerRegistry: new AgentRepositorySubstrate(substrate),
      proposal: new ProposalRepositorySubstrate(substrate, counter),
      thread: new ThreadRepositorySubstrate(substrate, counter),
      audit: new AuditRepositorySubstrate(substrate, counter),
      idea,
      mission,
      turn: new TurnRepositorySubstrate(substrate, counter, mission, task),
      tele: new TeleRepositorySubstrate(substrate, counter),
      bug: new BugRepositorySubstrate(substrate, counter),
      pendingAction: new PendingActionRepositorySubstrate(substrate, counter),
      message: new MessageRepositorySubstrate(substrate),
    };
  }

  private createRouter(): PolicyRouter {
    const router = new PolicyRouter(() => {});
    registerSessionPolicy(router);
    registerTaskPolicy(router);
    registerSystemPolicy(router);
    registerTelePolicy(router);
    registerAuditPolicy(router);
    registerIdeaPolicy(router);
    registerMissionPolicy(router);
    registerTurnPolicy(router);
    registerClarificationPolicy(router);
    registerReviewPolicy(router);
    registerProposalPolicy(router);
    registerThreadPolicy(router);
    return router;
  }
}
