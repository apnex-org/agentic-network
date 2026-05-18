import { randomUUID } from "node:crypto";
import type { IPolicyContext, AllStores, DomainEvent } from "./types.js";
import { AgentRepositorySubstrate } from "../entities/agent-repository-substrate.js";
import type { Selector } from "../state.js";
import { TaskRepositorySubstrate } from "../entities/task-repository-substrate.js";
import { ProposalRepositorySubstrate } from "../entities/proposal-repository-substrate.js";
import { ThreadRepositorySubstrate } from "../entities/thread-repository-substrate.js";
import { IdeaRepositorySubstrate } from "../entities/idea-repository-substrate.js";
import { MissionRepositorySubstrate } from "../entities/mission-repository-substrate.js";
import { TurnRepositorySubstrate } from "../entities/turn-repository-substrate.js";
import { TeleRepositorySubstrate } from "../entities/tele-repository-substrate.js";
import { AuditRepositorySubstrate } from "../entities/audit-repository-substrate.js";
import { SubstrateCounter } from "../entities/substrate-counter.js";
import { createMemoryStorageSubstrate } from "../storage-substrate/index.js";
import { BugRepositorySubstrate } from "../entities/bug-repository-substrate.js";
import { MessageRepositorySubstrate } from "../entities/message-repository-substrate.js";
import { PendingActionRepositorySubstrate } from "../entities/pending-action-repository-substrate.js";
import { createMetricsCounter } from "../observability/metrics.js";

interface EmittedEvent {
  event: string;
  data: Record<string, unknown>;
  targetRoles?: string[];
}

interface DispatchedEvent {
  event: string;
  data: Record<string, unknown>;
  selector: Selector;
}

export interface TestPolicyContext extends IPolicyContext {
  emittedEvents: EmittedEvent[];
  dispatchedEvents: DispatchedEvent[];
}

export function createTestContext(overrides?: Partial<TestPolicyContext>): TestPolicyContext {
  const emittedEvents: EmittedEvent[] = [];
  const dispatchedEvents: DispatchedEvent[] = [];

  // mission-84 W2: substrate-version repositories over fresh MemoryHubStorageSubstrate +
  // SubstrateCounter per test context — no state leakage between test cases. Migrated from
  // FS-version-repo + MemoryStorageProvider pattern (mission-47/mission-56 era) per Design
  // v1.0 §2.1. SchemaDef pre-registration not required for memory-substrate (substrate-internal
  // enforcement is postgres-only via reconciler indexes; memory put/get/list work kind-agnostic).
  const substrate = createMemoryStorageSubstrate();
  const counter = new SubstrateCounter(substrate);
  const task = new TaskRepositorySubstrate(substrate, counter);
  const idea = new IdeaRepositorySubstrate(substrate, counter);
  const mission = new MissionRepositorySubstrate(substrate, counter, task, idea);
  const stores: AllStores = {
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

  return {
    stores,
    emit: async (event, data, targetRoles) => {
      emittedEvents.push({ event, data, targetRoles });
    },
    dispatch: async (event, data, selector) => {
      dispatchedEvents.push({ event, data, selector });
    },
    // ADR-016: distinct per-call sessionId so M18 handshakes derive
    // unique globalInstanceIds and each actor ends up with its own
    // Agent record. Previously every context shared "test-session-001"
    // which caused fingerprint collisions on multi-actor test setups.
    sessionId: `test-session-${randomUUID().slice(0, 8)}`,
    clientIp: "127.0.0.1",
    role: "architect",
    internalEvents: [],
    metrics: createMetricsCounter(),
    emittedEvents,
    dispatchedEvents,
    ...overrides,
  };
}
