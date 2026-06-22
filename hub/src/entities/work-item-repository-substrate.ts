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
import type {
  WorkItem,
  WorkItemPhase,
  WorkItemType,
  WorkItemPriority,
  EvidenceRequirement,
  IWorkItemStore,
} from "./work-item.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";

const KIND = "WorkItem";
const LIST_CAP = 500;

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
  // CAS-update (getWithRevision + putIfMatch loop) + the claim/lease/FSM verbs
  // land in sub-PR-3 on top of this storage surface.
}
