import { randomUUID } from "node:crypto";
import type { IPolicyContext, AllStores, DomainEvent } from "./types.js";
import { MemoryTaskStore, MemoryEngineerRegistry, MemoryProposalStore, MemoryThreadStore, MemoryAuditStore } from "../state.js";
import type { Selector } from "../state.js";
import { MemoryIdeaStore } from "../entities/idea.js";
import { MemoryMissionStore } from "../entities/mission.js";
import { MemoryTurnStore } from "../entities/turn.js";
import { MemoryTeleStore } from "../entities/tele.js";
import { MemoryBugStore } from "../entities/bug.js";
import { MemoryPendingActionStore } from "../entities/pending-action.js";
import { MemoryDirectorNotificationStore } from "../entities/director-notification.js";

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
  const idea = new MemoryIdeaStore();
  const mission = new MemoryMissionStore(task, idea);
  const stores: AllStores = {
    task,
    engineerRegistry: new MemoryEngineerRegistry(),
    proposal: new MemoryProposalStore(),
    thread: new MemoryThreadStore(),
    audit: new MemoryAuditStore(),
    idea,
    mission,
    turn: new MemoryTurnStore(mission, task),
    tele: new MemoryTeleStore(),
    bug: new MemoryBugStore(),
    pendingAction: new MemoryPendingActionStore(),
    directorNotification: new MemoryDirectorNotificationStore(),
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
    emittedEvents,
    dispatchedEvents,
    ...overrides,
  };
}
