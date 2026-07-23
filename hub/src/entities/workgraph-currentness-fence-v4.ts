import { AsyncLocalStorage } from "node:async_hooks";
import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import { LOCK_CLASS, withAdvisoryLock } from "../storage-substrate/advisory-lock.js";
import type { WorkItem } from "./work-item.js";
import {
  NODE_CONTRACT_HASH_VERSION,
  NODE_TOPOLOGY_HASH_VERSION,
  deriveLocalExecutionIdentityV4,
  type TargetBindingV4,
  type TopologyEdgeV4,
} from "./work-item-contract-v4.js";
import {
  WORK_GRAPH_HEAD_ID,
  WorkRevisionStorageRepositoryV4,
  type WorkGraphTopologyGenerationV4,
  type WorkGraphTopologyHeadV4,
} from "./work-revision-storage-v4.js";

export const WORKGRAPH_WRITER_PROTOCOL_V4 = "workgraph-writer-v4" as const;
export const WORKGRAPH_FENCE_LOCK_TIMEOUT_MS = 5_000;

export type WorkGraphPinV4 =
  | { mode: "legacy"; generation: null; head: null; headResourceVersion: null }
  | {
      mode: "generation";
      generation: WorkGraphTopologyGenerationV4;
      head: WorkGraphTopologyHeadV4;
      headResourceVersion: string;
    };

export interface CurrentWorkBindingV4 {
  logicalId: string;
  physicalId: string;
  revision: number;
  generation: number;
  localExecutionIdentity: string;
}

export class WorkGraphCurrentnessRejected extends Error {
  constructor(
    public readonly code:
      | "workgraph.currentness.old_or_draft"
      | "workgraph.currentness.identity_mismatch"
      | "workgraph.currentness.head_changed"
      | "workgraph.currentness.revision_required"
      | "workgraph.currentness.integrity"
      | "revision.actor_forbidden"
      | "revision.architect_required"
      | "revision.director_or_architect_required"
      | "revision.cross_scope_forbidden"
      | "revision.family_owner_mismatch"
      | "revision.holder_has_no_authority"
      | "revision.authority_expansion_forbidden"
      | "revision.failed_gate_sealed"
      | "revision.affected_state_forbidden"
      | "revision.affected_set_mismatch"
      | "revision.currentness_mismatch",
    message: string,
    public readonly current?: { logicalId: string; physicalId: string; revision: number; generation: number },
  ) {
    super(`${code}: ${message}`);
    this.name = "WorkGraphCurrentnessRejected";
  }
}

function compareString(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function edgesFromGeneration(generation: WorkGraphTopologyGenerationV4, logicalId: string): TopologyEdgeV4[] {
  const edges: TopologyEdgeV4[] = [];
  for (const targetLogicalId of generation.dependsOn[logicalId] ?? []) {
    edges.push({ edgeClass: "dependsOn", sourceLogicalId: logicalId, targetLogicalId });
  }
  for (const targetLogicalId of generation.completionDependsOn[logicalId] ?? []) {
    edges.push({ edgeClass: "completionDependsOn", sourceLogicalId: logicalId, targetLogicalId });
  }
  return edges.sort((a, b) => compareString(
    `${a.edgeClass}\0${a.targetLogicalId}`,
    `${b.edgeClass}\0${b.targetLogicalId}`,
  ));
}

/**
 * Mission-140 universal topology/currentness seam.
 *
 * - No head: legacy/shadow mode; existing WorkItem behavior is unchanged.
 * - Head present: every writer runs under the one global advisory lock and every
 *   current projection pins one immutable generation.
 * - Exact physical reads remain possible; mutation/projection authority does not.
 */
export class WorkGraphCurrentnessFenceV4 {
  private readonly storage: WorkRevisionStorageRepositoryV4;
  private readonly context = new AsyncLocalStorage<{ pin: WorkGraphPinV4; writer: boolean }>();

  constructor(private readonly substrate: HubStorageSubstrate) {
    this.storage = new WorkRevisionStorageRepositoryV4(substrate);
  }

  currentPin(): WorkGraphPinV4 | undefined { return this.context.getStore()?.pin; }

  async pin(): Promise<WorkGraphPinV4> {
    const headRow = await this.storage.getHead();
    if (!headRow) return { mode: "legacy", generation: null, head: null, headResourceVersion: null };
    const generation = await this.storage.getGeneration(headRow.head.generation);
    if (!generation || generation.id !== headRow.head.manifestId || generation.topologyHash !== headRow.head.topologyHash ||
        generation.operationId !== headRow.head.operationId || headRow.head.domain !== WORK_GRAPH_HEAD_ID) {
      throw new WorkGraphCurrentnessRejected(
        "workgraph.currentness.integrity",
        `head ${headRow.head.generation} does not exact-bind its immutable generation`,
      );
    }
    return { mode: "generation", generation, head: headRow.head, headResourceVersion: headRow.resourceVersion };
  }

  async withReadPin<T>(fn: (pin: WorkGraphPinV4) => Promise<T>): Promise<T> {
    const existing = this.context.getStore();
    if (existing) return fn(existing.pin);
    const pin = await this.pin();
    return this.context.run({ pin, writer: false }, async () => {
      const result = await fn(pin);
      await this.assertHeadUnchanged(pin);
      return result;
    });
  }

  async withWriterFence<T>(fn: (pin: WorkGraphPinV4) => Promise<T>): Promise<T> {
    const existing = this.context.getStore();
    if (existing?.writer) return fn(existing.pin);
    return withAdvisoryLock(
      this.substrate,
      LOCK_CLASS.workGraphGlobal,
      WORK_GRAPH_HEAD_ID,
      async () => {
        const pin = await this.pin();
        return this.context.run({ pin, writer: true }, async () => {
          const result = await fn(pin);
          await this.assertHeadUnchanged(pin);
          return result;
        });
      },
      { timeoutMs: WORKGRAPH_FENCE_LOCK_TIMEOUT_MS },
    );
  }

  assertCreateAllowed(pin: WorkGraphPinV4): void {
    if (pin.mode === "generation") {
      throw new WorkGraphCurrentnessRejected(
        "workgraph.currentness.revision_required",
        `direct ready WorkItem creation is disabled after topology generation ${pin.head.generation}; prepare a semantic revision instead`,
      );
    }
  }

  assertCurrent(item: WorkItem, pin: WorkGraphPinV4): CurrentWorkBindingV4 | null {
    if (pin.mode === "legacy") return null;
    const logicalId = item.logicalId;
    const binding = logicalId ? pin.generation.bindings[logicalId] : undefined;
    const current = logicalId && binding
      ? { logicalId, physicalId: binding.physicalId, revision: binding.revision, generation: pin.head.generation }
      : undefined;
    if (!logicalId || !binding || binding.physicalId !== item.id) {
      throw new WorkGraphCurrentnessRejected(
        "workgraph.currentness.old_or_draft",
        `physical WorkItem ${item.id} is not current in generation ${pin.head.generation}`,
        current,
      );
    }
    if (item.revision !== binding.revision || item.nodeContractHashVersion !== NODE_CONTRACT_HASH_VERSION ||
        item.nodeContractHash !== binding.nodeContractHash || item.nodeTopologyHashVersion !== NODE_TOPOLOGY_HASH_VERSION ||
        item.nodeTopologyHash !== binding.nodeTopologyHash || !item.localExecutionIdentity) {
      throw new WorkGraphCurrentnessRejected(
        "workgraph.currentness.identity_mismatch",
        `physical WorkItem ${item.id} does not exact-match current binding ${logicalId}@${binding.revision}`,
        current,
      );
    }
    const outgoing: TargetBindingV4[] = edgesFromGeneration(pin.generation, logicalId).map((edge) => {
      const target = pin.generation.bindings[edge.targetLogicalId];
      if (!target) {
        throw new WorkGraphCurrentnessRejected(
          "workgraph.currentness.integrity",
          `generation ${pin.head.generation} has dangling target ${edge.targetLogicalId}`,
        );
      }
      return {
        edgeClass: edge.edgeClass,
        targetLogicalId: edge.targetLogicalId,
        targetPhysicalId: target.physicalId,
        targetRevision: target.revision,
        targetNodeContractHashVersion: target.nodeContractHashVersion,
        targetNodeContractHash: target.nodeContractHash,
      };
    });
    const localIdentity = deriveLocalExecutionIdentityV4({
      logicalId,
      physicalId: item.id,
      revision: binding.revision,
      nodeContractHashVersion: binding.nodeContractHashVersion,
      nodeContractHash: binding.nodeContractHash,
      nodeTopologyHashVersion: binding.nodeTopologyHashVersion,
      nodeTopologyHash: binding.nodeTopologyHash,
      outgoingTargetBindings: outgoing,
    });
    if (localIdentity !== item.localExecutionIdentity) {
      throw new WorkGraphCurrentnessRejected(
        "workgraph.currentness.identity_mismatch",
        `physical WorkItem ${item.id} local execution identity is stale`,
        current,
      );
    }
    return {
      logicalId,
      physicalId: binding.physicalId,
      revision: binding.revision,
      generation: pin.head.generation,
      localExecutionIdentity: localIdentity,
    };
  }

  isCurrent(item: WorkItem, pin: WorkGraphPinV4): boolean {
    try { this.assertCurrent(item, pin); return true; } catch { return false; }
  }

  filterCurrent(items: readonly WorkItem[], pin: WorkGraphPinV4): WorkItem[] {
    return pin.mode === "legacy" ? [...items] : items.filter((item) => this.isCurrent(item, pin));
  }

  async assertHeadUnchanged(pin: WorkGraphPinV4): Promise<void> {
    const now = await this.storage.getHead();
    if (pin.mode === "legacy") {
      if (now) throw new WorkGraphCurrentnessRejected("workgraph.currentness.head_changed", "topology head appeared during a pinned legacy operation");
      return;
    }
    if (!now || now.resourceVersion !== pin.headResourceVersion || now.head.generation !== pin.head.generation ||
        now.head.topologyHash !== pin.head.topologyHash || now.head.operationId !== pin.head.operationId) {
      throw new WorkGraphCurrentnessRejected(
        "workgraph.currentness.head_changed",
        `topology head changed during pinned generation ${pin.head.generation}`,
      );
    }
  }
}
