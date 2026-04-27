/**
 * PolicyLoopbackHub — full-stack L7 test harness.
 *
 * Plugs the real Hub `PolicyRouter` (all 13 production policies) and
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

import { PolicyRouter, registerTaskPolicy, registerSystemPolicy, registerTelePolicy, registerAuditPolicy, registerDocumentPolicy, registerSessionPolicy, registerIdeaPolicy, registerMissionPolicy, registerTurnPolicy, registerClarificationPolicy, registerReviewPolicy, registerProposalPolicy, registerThreadPolicy } from "../../../../hub/src/policy/index.js";
import type { AllStores, IPolicyContext } from "../../../../hub/src/policy/types.js";
import { MemoryTaskStore, MemoryEngineerRegistry, MemoryProposalStore, MemoryThreadStore, MemoryAuditStore } from "../../../../hub/src/state.js";
import type { Selector } from "../../../../hub/src/state.js";
import { MemoryIdeaStore } from "../../../../hub/src/entities/idea.js";
import { MemoryMissionStore } from "../../../../hub/src/entities/mission.js";
import { MemoryTurnStore } from "../../../../hub/src/entities/turn.js";
import { MemoryTeleStore } from "../../../../hub/src/entities/tele.js";
import { MemoryPendingActionStore } from "../../../../hub/src/entities/pending-action.js";
import { MemoryDirectorNotificationStore } from "../../../../hub/src/entities/director-notification.js";
import { MemoryBugStore } from "../../../../hub/src/entities/bug.js";
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
    return agent?.agentId ?? null;
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
          delivered.push(agent.agentId);
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
      config: { storageBackend: "memory", gcsBucket: "" },
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
    const task = new MemoryTaskStore();
    const idea = new MemoryIdeaStore();
    const mission = new MemoryMissionStore(task, idea);
    return {
      task,
      engineerRegistry: new MemoryEngineerRegistry(),
      proposal: new MemoryProposalStore(),
      thread: new MemoryThreadStore(),
      audit: new MemoryAuditStore(),
      idea,
      mission,
      turn: new MemoryTurnStore(mission, task),
      tele: new MemoryTeleStore(),
      pendingAction: new MemoryPendingActionStore(),
      directorNotification: new MemoryDirectorNotificationStore(),
      bug: new MemoryBugStore(),
    };
  }

  private createRouter(): PolicyRouter {
    const router = new PolicyRouter(() => {});
    registerSessionPolicy(router);
    registerTaskPolicy(router);
    registerSystemPolicy(router);
    registerTelePolicy(router);
    registerAuditPolicy(router);
    registerDocumentPolicy(router);
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
