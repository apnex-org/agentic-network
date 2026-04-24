import { randomUUID } from "node:crypto";
import type { IPolicyContext, AllStores, DomainEvent } from "./types.js";
import { MemoryTaskStore, MemoryEngineerRegistry, MemoryProposalStore, MemoryThreadStore, MemoryAuditStore } from "../state.js";
import type { Selector } from "../state.js";
import { IdeaRepository } from "../entities/idea-repository.js";
import { MissionRepository } from "../entities/mission-repository.js";
import { MemoryTurnStore } from "../entities/turn.js";
import { TeleRepository } from "../entities/tele-repository.js";
import { StorageBackedCounter } from "../entities/counter.js";
import { MemoryStorageProvider } from "@ois/storage-provider";
import { BugRepository } from "../entities/bug-repository.js";
import { MemoryPendingActionStore } from "../entities/pending-action.js";
import { DirectorNotificationRepository } from "../entities/director-notification-repository.js";
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

  const task = new MemoryTaskStore();
  // Mission-47 W1/W2: tele/idea/bug stores are *Repository classes over
  // a fresh MemoryStorageProvider + StorageBackedCounter per test
  // context — no state leakage between test cases.
  const storageProvider = new MemoryStorageProvider();
  const storageCounter = new StorageBackedCounter(storageProvider);
  const idea = new IdeaRepository(storageProvider, storageCounter);
  const mission = new MissionRepository(storageProvider, storageCounter, task, idea);
  const stores: AllStores = {
    task,
    engineerRegistry: new MemoryEngineerRegistry(),
    proposal: new MemoryProposalStore(),
    thread: new MemoryThreadStore(),
    audit: new MemoryAuditStore(),
    idea,
    mission,
    turn: new MemoryTurnStore(mission, task),
    tele: new TeleRepository(storageProvider, storageCounter),
    bug: new BugRepository(storageProvider, storageCounter),
    pendingAction: new MemoryPendingActionStore(),
    directorNotification: new DirectorNotificationRepository(storageProvider, storageCounter),
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
    config: { storageBackend: "memory", gcsBucket: "" },
    metrics: createMetricsCounter(),
    emittedEvents,
    dispatchedEvents,
    ...overrides,
  };
}
