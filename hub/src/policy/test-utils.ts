import type { IPolicyContext, AllStores, DomainEvent } from "./types.js";
import { MemoryTaskStore, MemoryEngineerRegistry, MemoryProposalStore, MemoryThreadStore, MemoryAuditStore } from "../state.js";
import type { Selector } from "../state.js";
import { MemoryIdeaStore } from "../entities/idea.js";
import { MemoryMissionStore } from "../entities/mission.js";
import { MemoryTurnStore } from "../entities/turn.js";
import { MemoryTeleStore } from "../entities/tele.js";
import { MemoryBugStore } from "../entities/bug.js";

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
  };

  return {
    stores,
    emit: async (event, data, targetRoles) => {
      emittedEvents.push({ event, data, targetRoles });
    },
    dispatch: async (event, data, selector) => {
      dispatchedEvents.push({ event, data, selector });
    },
    sessionId: "test-session-001",
    clientIp: "127.0.0.1",
    role: "architect",
    internalEvents: [],
    config: { storageBackend: "memory", gcsBucket: "" },
    emittedEvents,
    dispatchedEvents,
    ...overrides,
  };
}
