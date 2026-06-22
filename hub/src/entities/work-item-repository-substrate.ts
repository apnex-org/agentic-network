/**
 * C1-R2 (mission-94) — WorkItemRepositorySubstrate (storage CRUD).
 *
 * The substrate-backed store for the reference-only WorkItem work-queue kind. This
 * is the sub-PR-2 STORAGE surface (create/get/list/CAS); the claim/lease/FSM VERBS
 * (claim_work / list_ready_work / start / block / resume / renew / release /
 * abandon / complete) land in sub-PR-3 on top of this. The claim authority is
 * `lease` (set atomically under a per-agent advisory lock at claim-time, sub-PR-3).
 *
 * Decode-to-flat at the read + CAS boundary (cloneWorkItem) per the envelope
 * substrate contract; the kind is born under the live C3-R4 governor (renameMap is
 * the single read-side field-path authority; write-encode via kinds/WorkItem.ts).
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type { Filter } from "../storage-substrate/types.js";
import type { EntityProvenance } from "../state.js";
import { randomUUID } from "node:crypto";
import type {
  WorkItem,
  WorkItemPhase,
  WorkItemType,
  WorkItemPriority,
  WorkItemLease,
  WorkItemBlockedOn,
  EvidenceRequirement,
  IWorkItemStore,
} from "./work-item.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { withAdvisoryLock, LOCK_CLASS } from "../storage-substrate/advisory-lock.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";

const KIND = "WorkItem";
const LIST_CAP = 500;
const MAX_CAS_RETRIES = 50;

/** The lease TTL (claim sets expiresAt = claimedAt + this; renewLease re-extends).
 *  A tunable knob — the sub-PR-4 lease-expiry sweeper re-queues past expiresAt.
 *  15 min default; flagged to architect for confirmation against the sweeper design. */
const LEASE_TTL_MS = 15 * 60 * 1000;

/** Max wall-time waiting for the per-agent WIP advisory lock. On timeout the claim
 *  is REJECTED (fail-CLOSED, LockAcquisitionTimeoutError) — never proceeds unlocked. */
const CLAIM_LOCK_TIMEOUT_MS = 5000;

/** Phases that count toward an agent's WIP cap (the in-flight count at claim-time).
 *  audit-4082 #2: ALL non-terminal phases that still HOLD a lease — claimed +
 *  in_progress + blocked + review. blocked/review do NOT release the lease (the agent
 *  still owns the work), so excluding them would let an agent hoard blocked/review
 *  items and claim past the cap. (Supersedes the construction-design §3.2 narrower
 *  claimed+in_progress draft — Steve's threat-model resolved the question.) */
const WIP_PHASES: readonly WorkItemPhase[] = ["claimed", "in_progress", "blocked", "review"];

/** Phases in which the agent holds an active lease (lease object non-null; renew /
 *  heartbeat legal). Mirrors WIP_PHASES — the lease is held until a terminal/ready edge. */
const LEASE_HELD_PHASES: readonly WorkItemPhase[] = ["claimed", "in_progress", "blocked", "review"];

/** Phases from which release_work / abandon_work are legal (FSM §3.1). review is
 *  excluded — a review item advances only via complete_work or the lease-expiry
 *  sweeper (sub-PR-4); review-edge finalization lands with complete_work (3a-ii). */
const RELEASABLE_PHASES: readonly WorkItemPhase[] = ["claimed", "in_progress", "blocked"];

/** Default per-agent WIP cap. Per-role override map is construction-design open-Q #3
 *  (pending architect); until then every role gets the default. */
const DEFAULT_WIP_CAP = 3;
const WIP_CAP_BY_ROLE: Readonly<Record<string, number>> = {};
function wipCap(role?: string): number {
  return (role && WIP_CAP_BY_ROLE[role]) || DEFAULT_WIP_CAP;
}

/** FSM-gate rejection (per-repo-local sentinel; the established repo pattern). Thrown
 *  inside a tryCasUpdate transform on an illegal source phase or a non-holder actor;
 *  propagates out so the policy layer maps it to a 409-style rejection. */
export class TransitionRejected extends Error {
  constructor(reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = "TransitionRejected";
  }
}

/** Thrown by claimWorkItem when the agent is already at its WIP cap. */
export class WipCapExceeded extends Error {
  constructor(
    public readonly agentId: string,
    public readonly inFlight: number,
    public readonly cap: number,
  ) {
    super(`WIP cap exceeded: agent ${agentId} holds ${inFlight} in-flight item(s) (cap ${cap})`);
    this.name = "WipCapExceeded";
  }
}

/** Decode envelope→flat + normalize the array/object fields to their empty
 *  defaults (a freshly-decoded row may omit absent collections). Used at the read
 *  boundary AND the CAS path (so the flat shape round-trips through the encoder). */
function cloneWorkItem(w: WorkItem): WorkItem {
  const flat = decodeEnvelopeToFlat(w as unknown as Record<string, unknown>, "WorkItem") as Record<string, unknown>;
  flat.roleEligibility = (flat.roleEligibility as string[] | undefined) ?? [];
  flat.dependsOn = (flat.dependsOn as string[] | undefined) ?? [];
  flat.evidenceRequirements = (flat.evidenceRequirements as EvidenceRequirement[] | undefined) ?? [];
  flat.evidence = (flat.evidence as unknown[] | undefined) ?? [];
  flat.lease = flat.lease ?? null;
  flat.targetRef = flat.targetRef ?? null;
  flat.blockedOn = flat.blockedOn ?? null;
  flat.leaseExpiryCount = (flat.leaseExpiryCount as number | undefined) ?? 0;
  return flat as unknown as WorkItem;
}

export class WorkItemRepositorySubstrate implements IWorkItemStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async createWorkItem(input: {
    type: WorkItemType;
    priority?: WorkItemPriority;
    roleEligibility: string[];
    dependsOn?: string[];
    evidenceRequirements?: EvidenceRequirement[];
    targetRef?: { kind: string; id: string } | null;
    payload?: unknown;
    createdBy?: EntityProvenance;
  }): Promise<WorkItem> {
    const num = await this.counter.next("workItemCounter");
    const id = `work-${num}`;
    const now = new Date().toISOString();
    const w: WorkItem = {
      id,
      type: input.type,
      priority: input.priority ?? "normal",
      roleEligibility: input.roleEligibility,
      dependsOn: input.dependsOn ?? [],
      evidenceRequirements: input.evidenceRequirements ?? [],
      targetRef: input.targetRef ?? null,
      payload: input.payload,
      status: "ready",
      lease: null,
      evidence: [],
      blockedOn: null,
      leaseExpiryCount: 0,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.substrate.createOnly(KIND, w);
    if (!result.ok) {
      throw new Error(`[WorkItemRepositorySubstrate] createWorkItem: counter issued existing ID ${id}; refusing to clobber`);
    }
    console.log(`[WorkItemRepositorySubstrate] WorkItem created: ${id} (type=${input.type}, roles=[${input.roleEligibility.join(",")}])`);
    return cloneWorkItem(w);
  }

  async getWorkItem(workId: string): Promise<WorkItem | null> {
    const w = await this.substrate.get<WorkItem>(KIND, workId);
    return w ? cloneWorkItem(w) : null;
  }

  /**
   * List work-items, optionally filtered by phase and/or role-eligibility. The
   * role filter is `$contains` array-membership over spec.roleEligibility (the
   * C1-R2 operator + GIN index). Filter built inline (local var) so the C3-R4
   * call-site scanner resolves the keys (status / roleEligibility) directly — no
   * helper/spread → no dynamic-site annotation.
   */
  async listWorkItems(filter?: { status?: WorkItemPhase; role?: string }): Promise<WorkItem[]> {
    const substrateFilter: Filter = {};
    if (filter?.status) substrateFilter.status = filter.status;
    if (filter?.role) substrateFilter.roleEligibility = { $contains: filter.role };
    const { items } = await this.substrate.list<WorkItem>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
      limit: LIST_CAP,
    });
    return items.map(cloneWorkItem);
  }

  // ── Claim / lease / FSM verbs (C1-R2 sub-PR-3a) ───────────────────────────

  /**
   * ready → claimed. The WIP cap is a HARD integrity invariant, not a TOCTOU
   * soft-cap: the in-flight count AND the ready→claimed CAS both run INSIDE a
   * per-agent advisory lock (keyed on agentId), so an agent cannot race ITSELF
   * past the cap. Two DIFFERENT agents racing the same item are arbitrated by the
   * per-row CAS (putIfMatch) — the loser re-reads status=claimed → TransitionRejected.
   * Lock-acquire timeout REJECTS the claim (fail-CLOSED), never proceeds unlocked.
   */
  async claimWorkItem(workId: string, agentId: string, role?: string): Promise<WorkItem | null> {
    return withAdvisoryLock(
      this.substrate,
      LOCK_CLASS.workItemWip,
      agentId,
      async () => {
        const cap = wipCap(role);
        // Count this agent's in-flight items under the lock. status→status.phase via
        // renameMap; status.lease.holder is the bucket-prefixed dotted path (option c).
        // limit=cap suffices to detect >=cap (we only need the boundary, not the total).
        const inFlightFilter: Filter = {
          status: { $in: [...WIP_PHASES] },
          "status.lease.holder": agentId,
        };
        const { items: inFlight } = await this.substrate.list<WorkItem>(KIND, { filter: inFlightFilter, limit: cap });
        if (inFlight.length >= cap) throw new WipCapExceeded(agentId, inFlight.length, cap);

        return this.tryCasUpdate(workId, (w) => {
          if (w.status !== "ready") throw new TransitionRejected(`claim requires ready, was ${w.status}`);
          const now = new Date();
          const nowISO = now.toISOString();
          const lease: WorkItemLease = {
            holder: agentId,
            token: randomUUID(), // audit-4082 #1: fences a stale zombie-process re-read
            claimedAt: nowISO,
            expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
            heartbeatAt: nowISO,
          };
          return { ...w, status: "claimed", lease, updatedAt: nowISO };
        });
      },
      { timeoutMs: CLAIM_LOCK_TIMEOUT_MS },
    );
  }

  async startWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "start");
      if (w.status !== "claimed") throw new TransitionRejected(`start requires claimed, was ${w.status}`);
      return { ...w, status: "in_progress", updatedAt: new Date().toISOString() };
    });
  }

  async blockWork(workId: string, agentId: string, leaseToken: string, blockedOn: WorkItemBlockedOn): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "block");
      if (w.status !== "in_progress") throw new TransitionRejected(`block requires in_progress, was ${w.status}`);
      return { ...w, status: "blocked", blockedOn, updatedAt: new Date().toISOString() };
    });
  }

  async resumeWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "resume");
      if (w.status !== "blocked") throw new TransitionRejected(`resume requires blocked, was ${w.status}`);
      return { ...w, status: "in_progress", blockedOn: null, updatedAt: new Date().toISOString() };
    });
  }

  /** Heartbeat-extend the lease without changing phase (crash-gap vs slow-progress
   *  stays orthogonal to state). Legal in any lease-held phase. */
  async renewLease(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "renew");
      if (!LEASE_HELD_PHASES.includes(w.status)) throw new TransitionRejected(`renew requires a held lease, was ${w.status}`);
      const now = new Date();
      const nowISO = now.toISOString();
      const lease: WorkItemLease = {
        ...(w.lease as WorkItemLease),
        heartbeatAt: nowISO,
        expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
      };
      return { ...w, lease, updatedAt: nowISO };
    });
  }

  /** Voluntary un-claim back to ready (holder + matching token). Preserves
   *  leaseExpiryCount (a voluntary release is not a poison-expiry; only the sweeper
   *  increments it). */
  async releaseWork(workId: string, agentId: string, leaseToken: string): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      this.assertLease(w, agentId, leaseToken, "release");
      if (!RELEASABLE_PHASES.includes(w.status)) throw new TransitionRejected(`release requires an active claim, was ${w.status}`);
      return { ...w, status: "ready", lease: null, blockedOn: null, updatedAt: new Date().toISOString() };
    });
  }

  /**
   * Terminal abandon. The lease-holder (presenting a matching token) OR the creator
   * (override authority — no token; lets a creator reclaim a stuck item from its
   * holder) may abandon. The reason is recorded by the policy/audit layer (sub-PR-3b).
   */
  async abandonWork(workId: string, agentId: string, opts?: { reason?: string; leaseToken?: string }): Promise<WorkItem | null> {
    return this.tryCasUpdate(workId, (w) => {
      const isHolderWithToken = w.lease?.holder === agentId && w.lease?.token === opts?.leaseToken;
      const isCreator = w.createdBy?.agentId === agentId;
      if (!isHolderWithToken && !isCreator) {
        throw new TransitionRejected(`abandon requires the lease-holder (with matching token) or the creator, not ${agentId}`);
      }
      if (!RELEASABLE_PHASES.includes(w.status)) throw new TransitionRejected(`abandon requires an active claim, was ${w.status}`);
      return { ...w, status: "abandoned", lease: null, blockedOn: null, updatedAt: new Date().toISOString() };
    });
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  /** Holder + token guard for lease-bound verbs (audit-4082 #1/#4). A non-holder OR a
   *  stale token (after a lease-expiry-requeue or a fresh re-claim) REJECTS — even for
   *  the SAME agentId — fencing a zombie old-process. Fail-CLOSED, row unchanged. */
  private assertLease(w: WorkItem, agentId: string, leaseToken: string, verb: string): void {
    if (w.lease?.holder !== agentId) {
      throw new TransitionRejected(`${verb} requires the lease-holder (${w.lease?.holder ?? "none"}), not ${agentId}`);
    }
    if (w.lease?.token !== leaseToken) {
      throw new TransitionRejected(`${verb} rejected: stale lease token (held by ${agentId} but token does not match the current lease)`);
    }
  }

  /**
   * True per-row CAS (Design v1.4 getWithRevision + putIfMatch). Decode→transform→
   * putIfMatch(expectedRevision); on revision-mismatch refetch + retry. Returns the
   * updated (re-decoded) WorkItem on success, null if absent. A TransitionRejected /
   * WipCapExceeded thrown by the transform propagates (the policy layer maps it).
   */
  private async tryCasUpdate(
    workId: string,
    transform: (current: WorkItem) => WorkItem,
  ): Promise<WorkItem | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<WorkItem>(KIND, workId);
      if (!existing) return null;
      const next = transform(cloneWorkItem(existing.entity));
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) {
        console.log(`[WorkItemRepositorySubstrate] WorkItem ${workId} → ${next.status}`);
        return cloneWorkItem(next);
      }
      // revision-mismatch → another writer won; refetch + retry
    }
    throw new Error(`[WorkItemRepositorySubstrate] tryCasUpdate exhausted ${MAX_CAS_RETRIES} retries on ${workId}`);
  }
}
