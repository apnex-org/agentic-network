/**
 * TestOrchestrator — E2E Test Harness for the PolicyRouter.
 *
 * Provides a fully in-memory, transport-free test environment for
 * multi-agent workflow simulation. All 13 policies are registered
 * on a shared PolicyRouter with in-memory stores.
 *
 * Architecture:
 *   TestOrchestrator (singleton per test)
 *     ├── PolicyRouter (shared, stateless)
 *     ├── AllStores (shared, in-memory)
 *     ├── EventCapture (shared, records all emit() calls)
 *     ├── ActorFacade("architect") — pre-bound context
 *     └── ActorFacade("engineer-N") — pre-bound context per engineer
 */

import {
  PolicyRouter,
  registerTaskPolicy,
  registerSystemPolicy,
  registerTelePolicy,
  registerAuditPolicy,
  registerDocumentPolicy,
  registerSessionPolicy,
  registerIdeaPolicy,
  registerMissionPolicy,
  registerTurnPolicy,
  registerClarificationPolicy,
  registerReviewPolicy,
  registerProposalPolicy,
  registerThreadPolicy,
  registerMessagePolicy,
} from "../../src/policy/index.js";
import type { AllStores, IPolicyContext, PolicyResult } from "../../src/policy/types.js";
import { AgentRepository } from "../../src/entities/agent-repository.js";
import { TaskRepository } from "../../src/entities/task-repository.js";
import { ProposalRepository } from "../../src/entities/proposal-repository.js";
import { ThreadRepository } from "../../src/entities/thread-repository.js";
import { IdeaRepository } from "../../src/entities/idea-repository.js";
import { MissionRepository } from "../../src/entities/mission-repository.js";
import { TurnRepository } from "../../src/entities/turn-repository.js";
import { TeleRepository } from "../../src/entities/tele-repository.js";
import { AuditRepository } from "../../src/entities/audit-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";
import { MemoryStorageProvider } from "@ois/storage-provider";
import { BugRepository } from "../../src/entities/bug-repository.js";
import { PendingActionRepository } from "../../src/entities/pending-action-repository.js";
import { MessageRepository } from "../../src/entities/message-repository.js";
import { createMetricsCounter, type MetricsCounter } from "../../src/observability/metrics.js";

// ── Captured Event ──────────────────────────────────────────────────

export interface CapturedEvent {
  event: string;
  data: Record<string, unknown>;
  targetRoles: string[];
  timestamp: number;
}

// ── Event Capture ───────────────────────────────────────────────────

export class EventCapture {
  readonly events: CapturedEvent[] = [];

  capture(event: string, data: Record<string, unknown>, targetRoles?: string[]): void {
    this.events.push({
      event,
      data,
      targetRoles: targetRoles || [],
      timestamp: Date.now(),
    });
  }

  /** Assert that an event was emitted. Returns the first match. */
  expectEvent(event: string): CapturedEvent {
    const found = this.events.find((e) => e.event === event);
    if (!found) {
      throw new Error(
        `Expected event "${event}" but it was never emitted. ` +
        `Emitted events: [${this.events.map((e) => e.event).join(", ")}]`
      );
    }
    return found;
  }

  /** Assert that an event was emitted targeting a specific role. */
  expectEventFor(event: string, role: string): CapturedEvent {
    const found = this.events.find(
      (e) => e.event === event && e.targetRoles.includes(role)
    );
    if (!found) {
      const matches = this.events.filter((e) => e.event === event);
      if (matches.length === 0) {
        throw new Error(`Expected event "${event}" for role "${role}" but "${event}" was never emitted.`);
      }
      throw new Error(
        `Event "${event}" was emitted but not targeting role "${role}". ` +
        `Target roles: [${matches.map((m) => m.targetRoles.join(",")).join("; ")}]`
      );
    }
    return found;
  }

  /** Assert that an event was NOT emitted. */
  expectNoEvent(event: string): void {
    const found = this.events.find((e) => e.event === event);
    if (found) {
      throw new Error(`Expected no "${event}" event but one was emitted.`);
    }
  }

  /** Assert events were emitted in a specific order. */
  expectEventSequence(eventNames: string[]): void {
    let searchFrom = 0;
    for (const name of eventNames) {
      const idx = this.events.findIndex((e, i) => i >= searchFrom && e.event === name);
      if (idx === -1) {
        throw new Error(
          `Expected event sequence [${eventNames.join(", ")}] but "${name}" not found ` +
          `after position ${searchFrom}. Actual: [${this.events.map((e) => e.event).join(", ")}]`
        );
      }
      searchFrom = idx + 1;
    }
  }

  /** Count events, optionally filtered by name. */
  count(event?: string): number {
    if (!event) return this.events.length;
    return this.events.filter((e) => e.event === event).length;
  }

  /** Get all events targeting a specific role. */
  forRole(role: string): CapturedEvent[] {
    return this.events.filter((e) => e.targetRoles.includes(role));
  }

  /** Get all events of a specific type. */
  forEvent(event: string): CapturedEvent[] {
    return this.events.filter((e) => e.event === event);
  }

  /** Clear all captured events. */
  clear(): void {
    this.events.length = 0;
  }
}

// ── E2E Error ───────────────────────────────────────────────────────

export class E2EError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly rawResult: PolicyResult,
  ) {
    super(message);
    this.name = "E2EError";
  }
}

// ── Actor Facade ────────────────────────────────────────────────────

export class ActorFacade {
  private registered = false;

  constructor(
    private readonly router: PolicyRouter,
    private readonly stores: AllStores,
    private readonly eventCapture: EventCapture,
    private readonly role: "architect" | "engineer",
    private readonly sessionId: string,
    private readonly config: { storageBackend: string; gcsBucket: string },
    private readonly metrics: MetricsCounter,
  ) {}

  /** Build a fresh IPolicyContext for this actor. */
  private ctx(): IPolicyContext {
    return {
      stores: this.stores,
      emit: async (event, data, targetRoles) => {
        this.eventCapture.capture(event, data, targetRoles);
      },
      dispatch: async (event, data, selector) => {
        // ADR-014 §115 soft-cutover: dispatches now prefer agentIds
        // or agentId (singular — used by review-policy etc.). For
        // role-targeted assertions (expectEventFor(event, role)), resolve
        // any engineer-id form → role via the registry so role-fallback
        // and agentId-targeted paths both populate targetRoles.
        let targetRoles: string[] | undefined = selector.roles ? [...selector.roles] : undefined;
        const idsToResolve: string[] = [];
        if (selector.agentIds && selector.agentIds.length > 0) idsToResolve.push(...selector.agentIds);
        if (selector.agentId) idsToResolve.push(selector.agentId);
        if (idsToResolve.length > 0) {
          const resolved = new Set<string>(targetRoles ?? []);
          const registry = this.stores.engineerRegistry as any;
          for (const eid of idsToResolve) {
            const agent = await registry.getAgent?.(eid).catch(() => null);
            if (agent?.role) resolved.add(agent.role);
          }
          targetRoles = Array.from(resolved);
        }
        this.eventCapture.capture(event, data, targetRoles);
      },
      sessionId: this.sessionId,
      clientIp: "127.0.0.1",
      role: this.role,
      internalEvents: [],
      config: this.config,
      metrics: this.metrics,
    };
  }

  /** Ensure this actor's role is registered (auto-called on first use).
   *  ADR-014 §115 removed the role+label dispatch fallback, so every
   *  test actor must use the enriched M18 handshake to get a resolved
   *  agentId on its Agent record. globalInstanceId is derived from the
   *  stable sessionId — running the same test twice in the same process
   *  re-binds the same Agent (epoch bumps), which mirrors the prod
   *  reconnect semantics. */
  private async ensureRegistered(): Promise<void> {
    if (this.registered) return;
    await this.router.handle("register_role", {
      role: this.role,
      globalInstanceId: `test-gid-${this.sessionId}`,
      clientMetadata: {
        clientName: "e2e-orchestrator",
        clientVersion: "0.0.0",
        proxyName: "@ois/hub-e2e",
        proxyVersion: "0.0.0",
      },
    }, this.ctx());
    this.registered = true;
  }

  /** Parse result, throw E2EError if isError. */
  private parse(toolName: string, result: PolicyResult): Record<string, unknown> {
    const text = result.content[0]?.text;
    const parsed = text ? JSON.parse(text) : {};
    if (result.isError) {
      const msg = parsed.error || parsed.message || text || "Unknown error";
      throw new E2EError(msg, toolName, result);
    }
    return parsed;
  }

  /** Raw tool call — returns PolicyResult without parsing/throwing. */
  async call(toolName: string, args: Record<string, unknown>): Promise<PolicyResult> {
    await this.ensureRegistered();
    return this.router.handle(toolName, args, this.ctx());
  }

  // ── Task lifecycle ──────────────────────────────────────────────

  async createTask(title: string, description: string, opts?: {
    correlationId?: string; sourceThreadId?: string;
    idempotencyKey?: string; dependsOn?: string[];
  }): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("create_task", {
      title, description, ...opts,
    }, this.ctx());
    return this.parse("create_task", result);
  }

  async getTask(): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("get_task", {}, this.ctx());
    return this.parse("get_task", result);
  }

  async createReport(taskId: string, report: string, summary: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("create_report", {
      taskId, report, summary,
    }, this.ctx());
    return this.parse("create_report", result);
  }

  async listTasks(): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("list_tasks", {}, this.ctx());
    return this.parse("list_tasks", result);
  }

  async cancelTask(taskId: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("cancel_task", { taskId }, this.ctx());
    return this.parse("cancel_task", result);
  }

  // ── Clarification ───────────────────────────────────────────────

  async requestClarification(taskId: string, question: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("create_clarification", {
      taskId, question,
    }, this.ctx());
    return this.parse("create_clarification", result);
  }

  async resolveClarification(taskId: string, answer: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("resolve_clarification", {
      taskId, answer,
    }, this.ctx());
    return this.parse("resolve_clarification", result);
  }

  async getClarification(taskId: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("get_clarification", { taskId }, this.ctx());
    return this.parse("get_clarification", result);
  }

  // ── Review ──────────────────────────────────────────────────────

  async createReview(taskId: string, assessment: string, decision?: "approved" | "rejected"): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const args: Record<string, unknown> = { taskId, assessment };
    if (decision) args.decision = decision;
    const result = await this.router.handle("create_review", args, this.ctx());
    return this.parse("create_review", result);
  }

  async getReview(taskId: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("get_review", { taskId }, this.ctx());
    return this.parse("get_review", result);
  }

  // ── Proposal lifecycle ──────────────────────────────────────────

  async createProposal(title: string, summary: string, body: string, opts?: {
    correlationId?: string;
    proposedExecutionPlan?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("create_proposal", {
      title, summary, body, ...opts,
    }, this.ctx());
    return this.parse("create_proposal", result);
  }

  async reviewProposal(proposalId: string, decision: string, feedback: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("create_proposal_review", {
      proposalId, decision, feedback,
    }, this.ctx());
    return this.parse("create_proposal_review", result);
  }

  async getProposal(proposalId: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("get_proposal", { proposalId }, this.ctx());
    return this.parse("get_proposal", result);
  }

  async closeProposal(proposalId: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("close_proposal", { proposalId }, this.ctx());
    return this.parse("close_proposal", result);
  }

  // ── Thread lifecycle ────────────────────────────────────────────

  async createThread(title: string, message: string, opts?: {
    maxRounds?: number; correlationId?: string; semanticIntent?: string;
    routingMode?: "unicast" | "broadcast" | "multicast";
    recipientAgentId?: string;
    context?: { entityType: string; entityId: string };
  }): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    // ADR-016 INV-TH28: unicast requires recipientAgentId. e2e tests
    // that open "to any counterparty" implicitly used the old
    // targeted-without-pin semantics — now explicit broadcast.
    const mergedOpts: Record<string, unknown> = { ...opts };
    if (mergedOpts.routingMode === undefined && mergedOpts.recipientAgentId === undefined) {
      mergedOpts.routingMode = "broadcast";
    }
    const result = await this.router.handle("create_thread", {
      title, message, ...mergedOpts,
    }, this.ctx());
    return this.parse("create_thread", result);
  }

  async replyToThread(threadId: string, message: string, opts?: {
    converged?: boolean; intent?: string; semanticIntent?: string;
    // Mission-24 Phase 2 (M24-T11): widened stage vocabulary to the
    // 8 autonomous action types. The payload shape on `stage` is
    // intentionally permissive at the TypeScript level — per-type
    // validation happens at the tool Zod schema (and again at the
    // cascade gate), so tests can construct any valid Phase 2 stage op.
    summary?: string;
    stagedActions?: Array<
      | { kind: "stage"; type: string; payload: Record<string, unknown> }
      | { kind: "revise"; id: string; payload: Record<string, unknown> }
      | { kind: "retract"; id: string }
    >;
  }): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("create_thread_reply", {
      threadId, message, ...opts,
    }, this.ctx());
    return this.parse("create_thread_reply", result);
  }

  async getThread(threadId: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("get_thread", { threadId }, this.ctx());
    return this.parse("get_thread", result);
  }

  async closeThread(threadId: string): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("close_thread", { threadId }, this.ctx());
    return this.parse("close_thread", result);
  }

  // ── System ──────────────────────────────────────────────────────

  async getPendingActions(): Promise<Record<string, unknown>> {
    await this.ensureRegistered();
    const result = await this.router.handle("get_pending_actions", {}, this.ctx());
    return this.parse("get_pending_actions", result);
  }
}

// ── Test Orchestrator ───────────────────────────────────────────────

export class TestOrchestrator {
  readonly router: PolicyRouter;
  readonly stores: AllStores;
  readonly events: EventCapture;
  readonly metrics: MetricsCounter;

  private readonly config = { storageBackend: "memory", gcsBucket: "" };
  private actorCache = new Map<string, ActorFacade>();

  private constructor() {
    this.events = new EventCapture();
    this.metrics = createMetricsCounter();
    this.stores = this.createStores();
    this.router = this.createRouter();
  }

  /** Create a fresh TestOrchestrator with all 13 policies registered. */
  static create(): TestOrchestrator {
    return new TestOrchestrator();
  }

  /** Get the Architect actor facade. */
  asArchitect(): ActorFacade {
    const key = "architect";
    if (!this.actorCache.has(key)) {
      this.actorCache.set(key, new ActorFacade(
        this.router, this.stores, this.events,
        "architect", "session-architect",
        this.config, this.metrics,
      ));
    }
    return this.actorCache.get(key)!;
  }

  /** Get an Engineer actor facade. Supports multiple engineers. */
  asEngineer(agentId: string = "default"): ActorFacade {
    const key = `engineer-${agentId}`;
    if (!this.actorCache.has(key)) {
      this.actorCache.set(key, new ActorFacade(
        this.router, this.stores, this.events,
        "engineer", `session-engineer-${agentId}`,
        this.config, this.metrics,
      ));
    }
    return this.actorCache.get(key)!;
  }

  /** Reset all state for a clean scenario. */
  reset(): void {
    this.events.clear();
    this.actorCache.clear();
    // Replace stores with fresh instances
    Object.assign(this.stores, this.createStores());
  }

  // ── Private ─────────────────────────────────────────────────────

  private createStores(): AllStores {
    // Mission-47 W1-W5 + mission-51 W1 + mission-56 W5: task / proposal /
    // idea / mission / tele / bug / message via *Repository classes over
    // a fresh MemoryStorageProvider. (DirectorNotification + Notification
    // stores removed in mission-56 W5 cleanup; alerts now flow through
    // the Message store.)
    const storageProvider = new MemoryStorageProvider();
    const storageCounter = new StorageBackedCounter(storageProvider);
    const task = new TaskRepository(storageProvider, storageCounter);
    const idea = new IdeaRepository(storageProvider, storageCounter);
    const mission = new MissionRepository(storageProvider, storageCounter, task, idea);
    return {
      task,
      engineerRegistry: new AgentRepository(storageProvider),
      proposal: new ProposalRepository(storageProvider, storageCounter),
      thread: new ThreadRepository(storageProvider, storageCounter),
      audit: new AuditRepository(storageProvider, storageCounter),
      idea,
      mission,
      turn: new TurnRepository(storageProvider, storageCounter, mission, task),
      tele: new TeleRepository(storageProvider, storageCounter),
      bug: new BugRepository(storageProvider, storageCounter),
      pendingAction: new PendingActionRepository(storageProvider, storageCounter),
      message: new MessageRepository(storageProvider),
    };
  }

  private createRouter(): PolicyRouter {
    const router = new PolicyRouter(() => {});
    registerTaskPolicy(router);
    registerSystemPolicy(router);
    registerTelePolicy(router);
    registerAuditPolicy(router);
    registerDocumentPolicy(router);
    registerSessionPolicy(router);
    registerIdeaPolicy(router);
    registerMissionPolicy(router);
    registerTurnPolicy(router);
    registerClarificationPolicy(router);
    registerReviewPolicy(router);
    registerProposalPolicy(router);
    registerThreadPolicy(router);
    registerMessagePolicy(router);
    return router;
  }
}
