import { randomUUID } from "node:crypto";
import type { IPolicyContext, AllStores, DomainEvent } from "./types.js";
import { AgentRepositorySubstrate } from "../entities/agent-repository-substrate.js";
import type { Selector } from "../state.js";
import { ProposalRepositorySubstrate } from "../entities/proposal-repository-substrate.js";
import { ThreadRepositorySubstrate } from "../entities/thread-repository-substrate.js";
import { IdeaRepositorySubstrate } from "../entities/idea-repository-substrate.js";
import { MissionRepositorySubstrate } from "../entities/mission-repository-substrate.js";
import { AuditRepositorySubstrate } from "../entities/audit-repository-substrate.js";
import { SubstrateCounter } from "../entities/substrate-counter.js";
import { createMemoryStorageSubstrate, buildEnvelopeWriteEncoder } from "../storage-substrate/index.js";
import type { HubStorageSubstrate } from "../storage-substrate/index.js";
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
  /**
   * The backing memory substrate, exposed so tests can seed entity state that
   * the public store API cannot construct — e.g. a `completed` task with no
   * `reviewAssessment` (the FSM-bypassed shape; see bug-112). Wired to the
   * default `stores`; ignore it when overriding `stores`.
   */
  substrate: HubStorageSubstrate;
}

export function createTestContext(overrides?: Partial<TestPolicyContext>, opts?: { skipRoleRegister?: boolean }): TestPolicyContext {
  const emittedEvents: EmittedEvent[] = [];
  const dispatchedEvents: DispatchedEvent[] = [];

  // mission-84 W2: substrate-version repositories over fresh MemoryHubStorageSubstrate +
  // SubstrateCounter per test context — no state leakage between test cases. Migrated from
  // FS-version-repo + MemoryStorageProvider pattern (mission-47/mission-56 era) per Design
  // v1.0 §2.1. SchemaDef pre-registration not required for memory-substrate (substrate-internal
  // enforcement is postgres-only via reconciler indexes; memory put/get/list work kind-agnostic).
  const substrate = createMemoryStorageSubstrate();
  // mission-90 W8: store ENVELOPE shape (match prod — all writes envelope via the
  // W4 encoder) so the memory test substrate validates the real envelope-only path,
  // not a legacy-flat fixture artifact. Pairs with the built-in memoryTranslateKey
  // (bare filter keys → envelope JSONB paths).
  substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  const counter = new SubstrateCounter(substrate);
  const idea = new IdeaRepositorySubstrate(substrate, counter);
  const mission = new MissionRepositorySubstrate(substrate, counter, idea);
  const stores: AllStores = {
    engineerRegistry: new AgentRepositorySubstrate(substrate),
    proposal: new ProposalRepositorySubstrate(substrate, counter),
    thread: new ThreadRepositorySubstrate(substrate, counter),
    audit: new AuditRepositorySubstrate(substrate, counter),
    idea,
    mission,
    bug: new BugRepositorySubstrate(substrate, counter),
    pendingAction: new PendingActionRepositorySubstrate(substrate, counter),
    message: new MessageRepositorySubstrate(substrate),
  };

  // ADR-016: distinct per-call sessionId so M18 handshakes derive unique globalInstanceIds
  // and each actor ends up with its own Agent record. Previously every context shared
  // "test-session-001" which caused fingerprint collisions on multi-actor test setups.
  const sessionId = overrides?.sessionId ?? `test-session-${randomUUID().slice(0, 8)}`;
  const role = overrides?.role ?? "architect";
  // bug-175: register the session's role so the RBAC membership-gate (router.ts) admits
  // role-gated tools — mimics the adapter handshake's register_role (pre-bug-175 the
  // unknown-bypass made this implicit; closing the fail-open requires the realistic setup).
  // Engineer-tool tests pass role:"engineer". Tests supplying their own `stores` register
  // their own roles. Idempotent across the per-test contexts sharing one registry.
  const effectiveStores = overrides?.stores ?? stores;
  // opts.skipRoleRegister: leave the session UNREGISTERED (getRole→"unknown") — for tests
  // that exercise the resolveCreatedBy ctx.role-fallback or the genuinely-unknown-caller path.
  if (!opts?.skipRoleRegister) {
    effectiveStores.engineerRegistry.setSessionRole(sessionId, role as Parameters<typeof effectiveStores.engineerRegistry.setSessionRole>[1]);
  }

  return {
    stores: effectiveStores,
    substrate,
    emit: async (event, data, targetRoles) => {
      emittedEvents.push({ event, data, targetRoles });
    },
    dispatch: async (event, data, selector) => {
      dispatchedEvents.push({ event, data, selector });
    },
    sessionId,
    clientIp: "127.0.0.1",
    role,
    internalEvents: [],
    metrics: createMetricsCounter(),
    emittedEvents,
    dispatchedEvents,
    ...overrides,
  };
}
