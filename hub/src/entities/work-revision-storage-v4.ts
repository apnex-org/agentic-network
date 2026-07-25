import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import { LOCK_CLASS, withAdvisoryLock } from "../storage-substrate/advisory-lock.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";
import type { WorkItem } from "./work-item.js";
import { isFailedGateSealed } from "./work-item-repository-substrate.js";
import {
  NODE_CONTRACT_HASH_VERSION,
  NODE_TOPOLOGY_HASH_VERSION,
  WORK_TOPOLOGY_HASH_VERSION,
  canonicalJson,
  deriveLocalExecutionIdentityV4,
  deriveNodeContractV4,
  deriveNodeTopologyV4,
  deriveWorkTopologyHashV4,
  hashCanonicalDomain,
  type ActorStampV4,
  type BoundWorkItemReferenceV4,
  type EdgeClassV4,
  type RevisionFieldsV4,
  type Sha256Hex,
  type TargetBindingV4,
  type TopologyBindingV4,
  type TopologyEdgeV4,
  type WorkRevisionFamilyV4,
} from "./work-item-contract-v4.js";

export const WORK_REVISION_STORAGE_VERSION = "work-revision-storage-v4" as const;
export const WORK_TOPOLOGY_MANIFEST_VERSION = "work-topology-manifest-v4" as const;
export const WORK_TOPOLOGY_SHARD_VERSION = "work-topology-shard-v4" as const;
export const WORK_REVISION_SNAPSHOT_VERSION = "work-revision-snapshot-v4" as const;
export const WORK_GRAPH_HEAD_ID = "global-v1" as const;
export const DEFAULT_TOPOLOGY_SHARD_SIZE = 500;

export const WORK_REVISION_KINDS = Object.freeze({
  family: "WorkRevisionFamily",
  generation: "WorkGraphTopologyGeneration",
  shard: "WorkGraphTopologyShard",
  head: "WorkGraphTopologyHead",
  edge: "WorkGraphTopologyEdge",
  operation: "WorkGraphRevisionOperation",
  notice: "WorkGraphRevisionNotice",
} as const);

export type FamilyScopeV4 = { kind: "mission" | "standalone"; id: string };
export type TopologyBindingRecordV4 = Record<string, TopologyBindingV4>;
export type TopologyAdjacencyV4 = Record<string, string[]>;

export interface WorkRevisionFamilyRowV4 extends WorkRevisionFamilyV4 { id: string }

export interface AllocateWorkRevisionV4 {
  readonly logicalId: string;
  readonly originPhysicalId: string;
  readonly originalCreatedBy: ActorStampV4;
  readonly familyScope: FamilyScopeV4;
  readonly createdAt: string;
}

export interface WorkGraphRevisionOperationV4 {
  id: string;
  operationId: string;
  requestHash: Sha256Hex;
  generation: number;
  previousGeneration: number;
  topologyHash: Sha256Hex;
  manifestId: string;
  /** Pending current-successor logical IDs that must recommit paused→ready in
   *  one atomic batch. Cleared only in the same multi-row CAS that readies the
   *  rows; recommittedSet preserves the immutable receipt projection. */
  recommitSet: string[];
  recommittedSet?: string[];
  recommitOperationId?: string;
  recommitRequestHash?: Sha256Hex;
  recommittedAt?: string;
  state: "prepared" | "committed";
  preparedAt: string;
  committedAt?: string;
}

export interface WorkGraphRevisionNoticeV4 {
  id: string;
  intentId: string;
  operationId: string;
  generation: number;
  logicalId: string;
  physicalId: string;
  exactHolderAgentId: string;
  payloadHash: Sha256Hex;
  createdAt: string;
  projected: boolean;
  projectedMessageId?: string;
  projectedAt?: string;
}

export interface WorkGraphTopologyShardV4 {
  id: string;
  generation: number;
  shardIndex: number;
  logicalIds: string[];
  bindings: TopologyBindingRecordV4;
  dependsOn: TopologyAdjacencyV4;
  completionDependsOn: TopologyAdjacencyV4;
  reverseDependsOn: TopologyAdjacencyV4;
  reverseCompletionDependsOn: TopologyAdjacencyV4;
  shardHash: Sha256Hex;
  createdAt: string;
}

export interface WorkGraphTopologyEdgeV4 extends TopologyEdgeV4 {
  id: string;
  generation: number;
}

export interface WorkGraphTopologyGenerationV4 {
  id: string;
  schemaVersion: typeof WORK_REVISION_STORAGE_VERSION;
  generation: number;
  previousGeneration: number;
  bindings: TopologyBindingRecordV4;
  dependsOn: TopologyAdjacencyV4;
  completionDependsOn: TopologyAdjacencyV4;
  reverseDependsOn: TopologyAdjacencyV4;
  reverseCompletionDependsOn: TopologyAdjacencyV4;
  topologyHash: Sha256Hex;
  manifestHash: Sha256Hex;
  operationId: string;
  requestHash: Sha256Hex;
  notificationIntentIds: string[];
  shardHashes: Sha256Hex[];
  createdAt: string;
}

export interface WorkGraphTopologyHeadV4 {
  id: typeof WORK_GRAPH_HEAD_ID;
  domain: typeof WORK_GRAPH_HEAD_ID;
  generation: number;
  manifestId: string;
  topologyHash: Sha256Hex;
  operationId: string;
  activatedAt: string;
}

export interface ProjectedWorkRevisionV4 {
  physicalId: string;
  logicalId: string;
  revision: number;
  family: WorkRevisionFamilyRowV4;
  revisionFields: RevisionFieldsV4;
  boundReferences: BoundWorkItemReferenceV4[];
  localExecutionIdentity: Sha256Hex;
  effectiveDisposition: "failed_sealed" | null;
  workItem: WorkItem;
}

export interface BuiltWorkRevisionStorageV4 {
  generation: WorkGraphTopologyGenerationV4;
  shards: WorkGraphTopologyShardV4[];
  edges: WorkGraphTopologyEdgeV4[];
  families: WorkRevisionFamilyRowV4[];
  projections: ProjectedWorkRevisionV4[];
  operation: WorkGraphRevisionOperationV4;
  notices: WorkGraphRevisionNoticeV4[];
}

export interface BuildWorkRevisionStorageInputV4 {
  workItems: readonly WorkItem[];
  boundReferencesByPhysicalId: Readonly<Record<string, readonly BoundWorkItemReferenceV4[]>>;
  familyScopesByPhysicalId?: Readonly<Record<string, FamilyScopeV4>>;
  /** Existing immutable family rows for successor bindings. Required whenever a
   *  current physical row has a predecessor; origin/creator/scope are never
   *  inferred from successor authorship. */
  existingFamiliesByLogicalId?: Readonly<Record<string, WorkRevisionFamilyRowV4>>;
  generation: number;
  previousGeneration: number;
  operationId: string;
  requestHash?: Sha256Hex;
  createdAt: string;
  notices?: readonly Omit<WorkGraphRevisionNoticeV4, "id" | "projected">[];
  /** Exact sorted logical successor set activated paused by this generation. */
  recommitSet?: readonly string[];
  shardSize?: number;
}

export interface RevisionStorageSnapshotV4 {
  head: WorkGraphTopologyHeadV4 | null;
  generation: WorkGraphTopologyGenerationV4;
  shards: WorkGraphTopologyShardV4[];
  edges: WorkGraphTopologyEdgeV4[];
  families: WorkRevisionFamilyRowV4[];
  operation: WorkGraphRevisionOperationV4;
  notices: WorkGraphRevisionNoticeV4[];
  workItems?: WorkItem[];
}

export interface RevisionSnapshotManifestV4 {
  version: typeof WORK_REVISION_SNAPSHOT_VERSION;
  generation: number;
  topologyHash: Sha256Hex;
  manifestHash: Sha256Hex;
  counts: { bindings: number; shards: number; edges: number; families: number; notices: number };
  snapshotHash: Sha256Hex;
}

export interface ShadowComparisonV4 {
  equal: boolean;
  divergences: string[];
  expectedTopologyHash: Sha256Hex;
  actualTopologyHash: Sha256Hex;
  expectedManifestHash: Sha256Hex;
  actualManifestHash: Sha256Hex;
}

export class WorkRevisionStorageError extends Error {
  constructor(
    public readonly code:
      | "storage.invalid"
      | "storage.dangling_edge"
      | "storage.cycle"
      | "storage.duplicate"
      | "storage.immutable_conflict"
      | "storage.snapshot_drift"
      | "storage.integrity"
      | "storage.pointer_rollback"
      | "storage.head_conflict"
      | "storage.operation_conflict"
      | "storage.family_identity_conflict"
      | "storage.reference_unbound"
      // bug-364: a row carrying SOME but not all of the nine immutable-identity fields. Distinct
      // from `immutable_conflict` on purpose — that one means "identified, and the identity
      // disagrees"; this one means "half-identified", which is a corruption or a torn write and
      // must not be auto-completed. Sharing a code would let the two be confused in exactly the
      // situation where telling them apart matters.
      | "storage.partial_identity",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "WorkRevisionStorageError";
  }
}

function fail(code: WorkRevisionStorageError["code"], message: string): never {
  throw new WorkRevisionStorageError(code, message);
}

function assertNonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) fail("storage.invalid", `${path} must be non-empty`);
}

function assertPositiveInt(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail("storage.invalid", `${path} must be a positive safe integer`);
}

function assertNonNegativeInt(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("storage.invalid", `${path} must be a non-negative safe integer`);
}

function compareString(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function sortedUnique(values: readonly string[], path: string): string[] {
  const out = [...values].sort(compareString);
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] === out[i - 1]) fail("storage.duplicate", `${path} contains duplicate '${out[i]}'`);
  }
  return out;
}

function plainPersisted<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutTopologyObservation(item: WorkItem): WorkItem {
  const persisted = plainPersisted(item);
  delete persisted.observedTopologyGeneration;
  delete persisted.observedTopologyHash;
  return persisted;
}

function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(plainPersisted(a)) === canonicalJson(plainPersisted(b));
}

/**
 * bug-364 — the nine fields the persist-time immutable-identity comparison reads. Listed once so
 * "which fields are absent" and "which fields are compared" cannot drift apart; the comparison
 * below is still written out longhand deliberately, because collapsing it into a loop over this
 * array would change its semantics for `boundReferences` (canonical, not `!==`).
 *
 * MEASURED disjoint from the four sealed fields (attestations, attestationHistory, failedGateSeal,
 * evidence) — overlap zero. Materialising identity therefore cannot touch a FAIL record.
 */
const IMMUTABLE_IDENTITY_FIELDS = [
  "logicalId", "revision",
  "nodeContractHashVersion", "nodeContractHash",
  "nodeTopologyHashVersion", "nodeTopologyHash",
  "localExecutionIdentity", "topologyGeneration",
  "boundReferences",
] as const;

/**
 * ABSENT means the stored row never carried the field — NOT that it holds a falsy or empty value.
 * The distinction is the whole point of bug-364, so it is `=== undefined` and nothing looser:
 * `boundReferences: []` is PRESENT-and-empty and must not be read as unidentified. (Note the
 * legacy comparison coerced `?? []`, which made an absent `boundReferences` compare EQUAL to an
 * empty candidate — so that field alone never triggered the old conflict.)
 */
function identityFieldAbsent(row: WorkItem, field: (typeof IMMUTABLE_IDENTITY_FIELDS)[number]): boolean {
  return (row as unknown as Record<string, unknown>)[field] === undefined;
}

function decodeRow<T>(raw: T, kind: string): T {
  return decodeEnvelopeToFlat(raw as unknown as Record<string, unknown>, kind) as unknown as T;
}

function topologyGenerationId(generation: number): string { return `work-topology-generation-${generation}`; }
function topologyShardId(generation: number, index: number): string { return `work-topology-shard-${generation}-${index}`; }
function edgeId(generation: number, edge: TopologyEdgeV4): string {
  return `work-topology-edge-${generation}-${hashCanonicalDomain("work-topology-edge-v4", edge)}`;
}

function deriveFamilyScope(item: WorkItem): FamilyScopeV4 {
  if (item.targetRef?.kind === "mission") return { kind: "mission", id: item.targetRef.id };
  return { kind: "standalone", id: item.id };
}

function actorStamp(item: WorkItem): ActorStampV4 {
  return item.createdBy
    ? { role: item.createdBy.role, agentId: item.createdBy.agentId }
    : { role: "system", agentId: "legacy-unknown" };
}

function contractInput(item: WorkItem): Pick<WorkItem,
  "type" | "roleEligibility" | "runbook" | "payload" | "targetRef" |
  "evidenceRequirements" | "references" | "leaseWindowMs" | "nodeConfig"
> {
  // Never feed lifecycle/storage output fields back into the claimant hash.
  // This explicit projection makes the non-recursion structural rather than a
  // caller convention while deriveNodeContractV4 still rejects unknown fields
  // at raw authoring boundaries.
  return plainPersisted({
    type: item.type,
    roleEligibility: item.roleEligibility ?? [],
    ...(item.runbook !== undefined ? { runbook: item.runbook } : {}),
    ...(item.payload !== undefined ? { payload: item.payload } : {}),
    targetRef: item.targetRef ?? null,
    evidenceRequirements: item.evidenceRequirements ?? [],
    references: item.references ?? [],
    ...(item.leaseWindowMs !== undefined ? { leaseWindowMs: item.leaseWindowMs } : {}),
    ...(item.nodeConfig !== undefined ? { nodeConfig: item.nodeConfig } : {}),
  });
}

function ensureMapKeys(map: TopologyAdjacencyV4, logicalIds: readonly string[], path: string): void {
  const expected = [...logicalIds].sort(compareString);
  const actual = Object.keys(map).sort(compareString);
  if (!canonicalEqual(expected, actual)) fail("storage.integrity", `${path} keyset does not equal binding keyset`);
  for (const id of expected) sortedUnique(map[id] ?? [], `${path}.${id}`);
}

function adjacencyFromEdges(logicalIds: readonly string[], edges: readonly TopologyEdgeV4[]): {
  dependsOn: TopologyAdjacencyV4;
  completionDependsOn: TopologyAdjacencyV4;
  reverseDependsOn: TopologyAdjacencyV4;
  reverseCompletionDependsOn: TopologyAdjacencyV4;
} {
  const dependsOn: TopologyAdjacencyV4 = {};
  const completionDependsOn: TopologyAdjacencyV4 = {};
  const reverseDependsOn: TopologyAdjacencyV4 = {};
  const reverseCompletionDependsOn: TopologyAdjacencyV4 = {};
  for (const id of logicalIds) {
    dependsOn[id] = [];
    completionDependsOn[id] = [];
    reverseDependsOn[id] = [];
    reverseCompletionDependsOn[id] = [];
  }
  for (const edge of edges) {
    if (!(edge.sourceLogicalId in dependsOn) || !(edge.targetLogicalId in dependsOn)) {
      fail("storage.dangling_edge", `${edge.edgeClass}:${edge.sourceLogicalId}->${edge.targetLogicalId}`);
    }
    const forward = edge.edgeClass === "dependsOn" ? dependsOn : completionDependsOn;
    const reverse = edge.edgeClass === "dependsOn" ? reverseDependsOn : reverseCompletionDependsOn;
    forward[edge.sourceLogicalId]!.push(edge.targetLogicalId);
    reverse[edge.targetLogicalId]!.push(edge.sourceLogicalId);
  }
  for (const maps of [dependsOn, completionDependsOn, reverseDependsOn, reverseCompletionDependsOn]) {
    for (const id of logicalIds) maps[id] = sortedUnique(maps[id]!, `${id} adjacency`);
  }
  return { dependsOn, completionDependsOn, reverseDependsOn, reverseCompletionDependsOn };
}

function assertAcyclic(logicalIds: readonly string[], maps: Pick<WorkGraphTopologyGenerationV4, "dependsOn" | "completionDependsOn">): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      fail("storage.cycle", [...path.slice(start), id].join(" -> "));
    }
    if (visited.has(id)) return;
    visiting.add(id);
    path.push(id);
    for (const target of [...maps.dependsOn[id]!, ...maps.completionDependsOn[id]!]) visit(target);
    path.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of logicalIds) visit(id);
}

function shardPayload(shard: Omit<WorkGraphTopologyShardV4, "id" | "shardHash" | "createdAt">): unknown {
  return shard;
}

function buildShards(
  generation: number,
  logicalIds: readonly string[],
  bindings: TopologyBindingRecordV4,
  maps: Pick<WorkGraphTopologyGenerationV4, "dependsOn" | "completionDependsOn" | "reverseDependsOn" | "reverseCompletionDependsOn">,
  createdAt: string,
  shardSize: number,
): WorkGraphTopologyShardV4[] {
  assertPositiveInt(shardSize, "shardSize");
  if (shardSize > 500) fail("storage.invalid", "shardSize must not exceed substrate page cap 500");
  const shards: WorkGraphTopologyShardV4[] = [];
  for (let offset = 0, shardIndex = 0; offset < logicalIds.length; offset += shardSize, shardIndex += 1) {
    const ids = logicalIds.slice(offset, offset + shardSize);
    const pickBinding: TopologyBindingRecordV4 = {};
    const pick = (): TopologyAdjacencyV4 => ({});
    const dependsOn = pick();
    const completionDependsOn = pick();
    const reverseDependsOn = pick();
    const reverseCompletionDependsOn = pick();
    for (const id of ids) {
      // Shards are immutable independent rows, never aliases into the in-memory
      // manifest object (a caller mutating a draft shard must not mutate the
      // candidate generation before persistence).
      pickBinding[id] = plainPersisted(bindings[id]!);
      dependsOn[id] = [...maps.dependsOn[id]!];
      completionDependsOn[id] = [...maps.completionDependsOn[id]!];
      reverseDependsOn[id] = [...maps.reverseDependsOn[id]!];
      reverseCompletionDependsOn[id] = [...maps.reverseCompletionDependsOn[id]!];
    }
    const payload = {
      generation, shardIndex, logicalIds: ids, bindings: pickBinding, dependsOn,
      completionDependsOn, reverseDependsOn, reverseCompletionDependsOn,
    };
    shards.push({
      id: topologyShardId(generation, shardIndex),
      ...payload,
      shardHash: hashCanonicalDomain(WORK_TOPOLOGY_SHARD_VERSION, shardPayload(payload)),
      createdAt,
    });
  }
  return shards;
}

function manifestPayload(generation: Omit<WorkGraphTopologyGenerationV4, "manifestHash">): unknown {
  return generation;
}

/** Build a complete, immutable generation entirely in memory before any write. */
export function buildWorkRevisionStorageV4(input: BuildWorkRevisionStorageInputV4): BuiltWorkRevisionStorageV4 {
  assertPositiveInt(input.generation, "generation");
  assertNonNegativeInt(input.previousGeneration, "previousGeneration");
  if (input.generation !== input.previousGeneration + 1) fail("storage.pointer_rollback", "generation must be exactly previousGeneration + 1");
  assertNonEmpty(input.operationId, "operationId");
  assertNonEmpty(input.createdAt, "createdAt");
  const shardSize = input.shardSize ?? DEFAULT_TOPOLOGY_SHARD_SIZE;

  const itemByPhysical = new Map<string, WorkItem>();
  const logicalByPhysical = new Map<string, string>();
  const physicalByLogical = new Map<string, string>();
  for (const source of input.workItems) {
    const item = withoutTopologyObservation(source);
    assertNonEmpty(item.id, "WorkItem.id");
    assertNonEmpty(item.createdAt, `${item.id}.createdAt`);
    if (itemByPhysical.has(item.id)) fail("storage.duplicate", `physical WorkItem '${item.id}'`);
    const logicalId = item.logicalId ?? item.id;
    assertNonEmpty(logicalId, `${item.id}.logicalId`);
    if (physicalByLogical.has(logicalId)) fail("storage.duplicate", `current logical binding '${logicalId}'`);
    itemByPhysical.set(item.id, item);
    logicalByPhysical.set(item.id, logicalId);
    physicalByLogical.set(logicalId, item.id);
  }
  const logicalIds = [...physicalByLogical.keys()].sort(compareString);
  if (logicalIds.length === 0) fail("storage.invalid", "cannot build an empty topology generation");

  const normalizedEdges: TopologyEdgeV4[] = [];
  const logicalTarget = (locator: string, sourceId: string): string => {
    const mapped = logicalByPhysical.get(locator) ?? (physicalByLogical.has(locator) ? locator : undefined);
    if (!mapped) fail("storage.dangling_edge", `${sourceId} references absent target '${locator}'`);
    return mapped;
  };
  for (const logicalId of logicalIds) {
    const item = itemByPhysical.get(physicalByLogical.get(logicalId)!)!;
    for (const target of item.dependsOn ?? []) normalizedEdges.push({ edgeClass: "dependsOn", sourceLogicalId: logicalId, targetLogicalId: logicalTarget(target, item.id) });
    for (const target of item.completionDependsOn ?? []) normalizedEdges.push({ edgeClass: "completionDependsOn", sourceLogicalId: logicalId, targetLogicalId: logicalTarget(target, item.id) });
  }
  const edgeKeys = normalizedEdges.map((e) => `${e.edgeClass}\0${e.sourceLogicalId}\0${e.targetLogicalId}`);
  sortedUnique(edgeKeys, "topology edges");
  normalizedEdges.sort((a, b) => compareString(`${a.edgeClass}\0${a.sourceLogicalId}\0${a.targetLogicalId}`, `${b.edgeClass}\0${b.sourceLogicalId}\0${b.targetLogicalId}`));
  const maps = adjacencyFromEdges(logicalIds, normalizedEdges);
  assertAcyclic(logicalIds, maps);

  const projections: ProjectedWorkRevisionV4[] = [];
  const families: WorkRevisionFamilyRowV4[] = [];
  const bindings: TopologyBindingRecordV4 = {};
  for (const logicalId of logicalIds) {
    const physicalId = physicalByLogical.get(logicalId)!;
    const item = itemByPhysical.get(physicalId)!;
    // Failed-seal is deliberately classified before raw phase/currentness. A
    // legacy raw-ready active FAIL remains in history but can never be treated as
    // an ordinary ready row by later storage consumers.
    const effectiveDisposition = isFailedGateSealed(item) ? "failed_sealed" : null;
    const refs = input.boundReferencesByPhysicalId[physicalId];
    if ((item.references?.length ?? 0) !== (refs?.length ?? 0)) {
      fail("storage.reference_unbound", `${physicalId} claimant references are not exactly content-bound (${item.references?.length ?? 0}/${refs?.length ?? 0})`);
    }
    const boundReferences: BoundWorkItemReferenceV4[] = [...plainPersisted(refs ?? [])];
    const contract = deriveNodeContractV4(contractInput(item), boundReferences);
    if (item.nodeContractHash && (item.nodeContractHashVersion !== NODE_CONTRACT_HASH_VERSION || item.nodeContractHash !== contract.hash)) {
      fail("storage.integrity", `${physicalId} persisted node contract identity disagrees with exact recomputation`);
    }
    const topology = deriveNodeTopologyV4(logicalId, maps.dependsOn[logicalId]!, maps.completionDependsOn[logicalId]!);
    if (item.nodeTopologyHash && (item.nodeTopologyHashVersion !== NODE_TOPOLOGY_HASH_VERSION || item.nodeTopologyHash !== topology.hash)) {
      fail("storage.integrity", `${physicalId} persisted node topology identity disagrees with exact recomputation`);
    }
    const revision = item.revision ?? 1;
    assertPositiveInt(revision, `${physicalId}.revision`);
    const scope = input.familyScopesByPhysicalId?.[physicalId] ?? deriveFamilyScope(item);
    if ((scope.kind !== "mission" && scope.kind !== "standalone") || typeof scope.id !== "string" || scope.id.length === 0) {
      fail("storage.invalid", `${physicalId}.familyScope is invalid`);
    }
    const existingFamily = input.existingFamiliesByLogicalId?.[logicalId];
    if (existingFamily) assertPositiveInt(existingFamily.latestAllocatedRevision, `${logicalId}.latestAllocatedRevision`);
    if (item.predecessorPhysicalId && !existingFamily) {
      fail("storage.integrity", `${physicalId} is a successor but immutable family '${logicalId}' was not supplied`);
    }
    if (existingFamily && (existingFamily.id !== logicalId || existingFamily.logicalId !== logicalId ||
        existingFamily.latestAllocatedRevision < revision || !canonicalEqual(existingFamily.familyScope, scope))) {
      fail("storage.integrity", `${physicalId} disagrees with immutable family '${logicalId}'`);
    }
    const family: WorkRevisionFamilyRowV4 = existingFamily
      ? plainPersisted(existingFamily)
      : {
          id: logicalId,
          logicalId,
          originPhysicalId: physicalId,
          latestAllocatedRevision: revision,
          originalCreatedBy: actorStamp(item),
          familyScope: plainPersisted(scope),
          createdAt: item.createdAt,
        };
    families.push(family);
    const revisionFields: RevisionFieldsV4 = {
      logicalId,
      revision,
      ...(item.predecessorPhysicalId ? { predecessorPhysicalId: item.predecessorPhysicalId } : {}),
      ...(item.revisedBy ? { revisedBy: item.revisedBy } : {}),
      ...(item.revisionReason ? { revisionReason: item.revisionReason } : {}),
      ...(item.revisionGeneration !== undefined ? { revisionGeneration: item.revisionGeneration } : {}),
      nodeContractHashVersion: NODE_CONTRACT_HASH_VERSION,
      nodeContractHash: contract.hash,
      nodeTopologyHashVersion: NODE_TOPOLOGY_HASH_VERSION,
      nodeTopologyHash: topology.hash,
      recallHistory: plainPersisted(item.recallHistory ?? []),
      pendingRecallIntents: plainPersisted(item.pendingRecallIntents ?? []),
    };
    bindings[logicalId] = {
      physicalId,
      revision,
      nodeContractHashVersion: NODE_CONTRACT_HASH_VERSION,
      nodeContractHash: contract.hash,
      nodeTopologyHashVersion: NODE_TOPOLOGY_HASH_VERSION,
      nodeTopologyHash: topology.hash,
    };
    projections.push({
      physicalId, logicalId, revision, family, revisionFields, boundReferences,
      localExecutionIdentity: "", effectiveDisposition, workItem: item,
    });
  }

  for (const projection of projections) {
    const outgoing: TargetBindingV4[] = [];
    for (const edge of normalizedEdges.filter((e) => e.sourceLogicalId === projection.logicalId)) {
      const target = bindings[edge.targetLogicalId]!;
      outgoing.push({
        edgeClass: edge.edgeClass,
        targetLogicalId: edge.targetLogicalId,
        targetPhysicalId: target.physicalId,
        targetRevision: target.revision,
        targetNodeContractHashVersion: target.nodeContractHashVersion,
        targetNodeContractHash: target.nodeContractHash,
      });
    }
    projection.localExecutionIdentity = deriveLocalExecutionIdentityV4({
      logicalId: projection.logicalId,
      physicalId: projection.physicalId,
      revision: projection.revision,
      nodeContractHashVersion: NODE_CONTRACT_HASH_VERSION,
      nodeContractHash: projection.revisionFields.nodeContractHash,
      nodeTopologyHashVersion: NODE_TOPOLOGY_HASH_VERSION,
      nodeTopologyHash: projection.revisionFields.nodeTopologyHash,
      outgoingTargetBindings: outgoing,
    });
    if (projection.workItem.localExecutionIdentity && projection.workItem.localExecutionIdentity !== projection.localExecutionIdentity) {
      fail("storage.integrity", `${projection.physicalId} persisted local execution identity disagrees with exact recomputation`);
    }
  }

  const topologyHash = deriveWorkTopologyHashV4({
    generation: input.generation,
    previousGeneration: input.previousGeneration,
    bindings,
    edges: normalizedEdges,
  });
  const requestHash = input.requestHash ?? hashCanonicalDomain("workgraph-bootstrap-request-v4", {
    generation: input.generation,
    previousGeneration: input.previousGeneration,
    operationId: input.operationId,
    topologyHash,
  });
  const notices: WorkGraphRevisionNoticeV4[] = (input.notices ?? []).map((notice) => ({
    ...plainPersisted(notice), id: notice.intentId, projected: false,
  })).sort((a, b) => compareString(a.intentId, b.intentId));
  sortedUnique(notices.map((n) => n.intentId), "notice intent IDs");
  for (const notice of notices) {
    if (notice.operationId !== input.operationId || notice.generation !== input.generation) {
      fail("storage.integrity", `notice ${notice.intentId} operation/generation mismatch`);
    }
    if (physicalByLogical.get(notice.logicalId) !== notice.physicalId) {
      fail("storage.integrity", `notice ${notice.intentId} target is not current in candidate generation`);
    }
  }

  const shards = buildShards(input.generation, logicalIds, bindings, maps, input.createdAt, shardSize);
  const generationWithoutManifest: Omit<WorkGraphTopologyGenerationV4, "manifestHash"> = {
    id: topologyGenerationId(input.generation),
    schemaVersion: WORK_REVISION_STORAGE_VERSION,
    generation: input.generation,
    previousGeneration: input.previousGeneration,
    bindings,
    ...maps,
    topologyHash,
    operationId: input.operationId,
    requestHash,
    notificationIntentIds: notices.map((n) => n.intentId),
    shardHashes: shards.map((s) => s.shardHash),
    createdAt: input.createdAt,
  };
  const generation: WorkGraphTopologyGenerationV4 = {
    ...generationWithoutManifest,
    manifestHash: hashCanonicalDomain(WORK_TOPOLOGY_MANIFEST_VERSION, manifestPayload(generationWithoutManifest)),
  };
  const recommitSet = sortedUnique(input.recommitSet ?? [], "recommitSet");
  for (const logicalId of recommitSet) {
    if (!bindings[logicalId]) fail("storage.integrity", `recommitSet names absent logical ID ${logicalId}`);
    const projection = projections.find((candidate) => candidate.logicalId === logicalId)!;
    if (projection.workItem.status !== "paused" || projection.workItem.lease) {
      fail("storage.integrity", `recommitSet ${logicalId} must bind a paused, unleased successor`);
    }
  }
  const operation: WorkGraphRevisionOperationV4 = {
    id: input.operationId,
    operationId: input.operationId,
    requestHash,
    generation: input.generation,
    previousGeneration: input.previousGeneration,
    topologyHash,
    manifestId: generation.id,
    recommitSet,
    state: "prepared",
    preparedAt: input.createdAt,
  };
  const edges = normalizedEdges.map((edge) => ({ id: edgeId(input.generation, edge), generation: input.generation, ...edge }));
  return { generation, shards, edges, families, projections, operation, notices };
}

function topologyEdgesFromGeneration(generation: WorkGraphTopologyGenerationV4): TopologyEdgeV4[] {
  const edges: TopologyEdgeV4[] = [];
  for (const source of Object.keys(generation.bindings).sort(compareString)) {
    for (const target of generation.dependsOn[source] ?? []) edges.push({ edgeClass: "dependsOn", sourceLogicalId: source, targetLogicalId: target });
    for (const target of generation.completionDependsOn[source] ?? []) edges.push({ edgeClass: "completionDependsOn", sourceLogicalId: source, targetLogicalId: target });
  }
  return edges.sort((a, b) => compareString(`${a.edgeClass}\0${a.sourceLogicalId}\0${a.targetLogicalId}`, `${b.edgeClass}\0${b.sourceLogicalId}\0${b.targetLogicalId}`));
}

/** Fail-closed guard used before snapshot acceptance or restore mutation. */
export function assertRevisionStorageIntegrityV4(snapshot: RevisionStorageSnapshotV4): void {
  const { generation } = snapshot;
  if (generation.schemaVersion !== WORK_REVISION_STORAGE_VERSION) fail("storage.integrity", `unsupported generation schema ${generation.schemaVersion}`);
  assertPositiveInt(generation.generation, "generation");
  assertNonNegativeInt(generation.previousGeneration, "previousGeneration");
  if (generation.id !== topologyGenerationId(generation.generation) || generation.generation !== generation.previousGeneration + 1) {
    fail("storage.integrity", "generation identity/sequence mismatch");
  }
  const logicalIds = Object.keys(generation.bindings).sort(compareString);
  if (logicalIds.length === 0) fail("storage.integrity", "generation has no bindings");
  for (const logicalId of logicalIds) {
    assertNonEmpty(logicalId, "binding logicalId");
    const binding = generation.bindings[logicalId]!;
    assertNonEmpty(binding.physicalId, `${logicalId}.physicalId`);
    assertPositiveInt(binding.revision, `${logicalId}.revision`);
    if (binding.nodeContractHashVersion !== NODE_CONTRACT_HASH_VERSION || binding.nodeTopologyHashVersion !== NODE_TOPOLOGY_HASH_VERSION ||
        !/^[0-9a-f]{64}$/.test(binding.nodeContractHash) || !/^[0-9a-f]{64}$/.test(binding.nodeTopologyHash)) {
      fail("storage.integrity", `${logicalId} binding hash identity is malformed`);
    }
  }
  if (!canonicalEqual(generation.notificationIntentIds, sortedUnique(generation.notificationIntentIds, "notificationIntentIds"))) {
    fail("storage.integrity", "notification intent inventory is not canonical");
  }
  ensureMapKeys(generation.dependsOn, logicalIds, "dependsOn");
  ensureMapKeys(generation.completionDependsOn, logicalIds, "completionDependsOn");
  ensureMapKeys(generation.reverseDependsOn, logicalIds, "reverseDependsOn");
  ensureMapKeys(generation.reverseCompletionDependsOn, logicalIds, "reverseCompletionDependsOn");
  const edges = topologyEdgesFromGeneration(generation);
  const rebuilt = adjacencyFromEdges(logicalIds, edges);
  for (const key of ["dependsOn", "completionDependsOn", "reverseDependsOn", "reverseCompletionDependsOn"] as const) {
    if (!canonicalEqual(generation[key], rebuilt[key])) fail("storage.integrity", `${key} is incomplete or inconsistent`);
  }
  assertAcyclic(logicalIds, generation);
  const topologyHash = deriveWorkTopologyHashV4({
    generation: generation.generation,
    previousGeneration: generation.previousGeneration,
    bindings: generation.bindings,
    edges,
  });
  if (topologyHash !== generation.topologyHash) fail("storage.integrity", "topologyHash mismatch");
  const { manifestHash: _ignored, ...withoutManifest } = generation;
  const manifestHash = hashCanonicalDomain(WORK_TOPOLOGY_MANIFEST_VERSION, manifestPayload(withoutManifest));
  if (manifestHash !== generation.manifestHash) fail("storage.integrity", "manifestHash mismatch");

  const expectedShards = buildShards(
    generation.generation, logicalIds, generation.bindings, generation,
    generation.createdAt, Math.max(1, snapshot.shards[0]?.logicalIds.length ?? DEFAULT_TOPOLOGY_SHARD_SIZE),
  );
  // Last-shard size makes exact rebuild ambiguous; validate each shard independently
  // plus total ordered coverage and declared hash sequence instead.
  const orderedShards = [...snapshot.shards].sort((a, b) => a.shardIndex - b.shardIndex);
  const covered: string[] = [];
  orderedShards.forEach((shard, index) => {
    if (shard.generation !== generation.generation || shard.shardIndex !== index || shard.id !== topologyShardId(generation.generation, index)) {
      fail("storage.integrity", `shard ${shard.id} identity mismatch`);
    }
    const { id: _id, shardHash: _hash, createdAt: _created, ...payload } = shard;
    if (hashCanonicalDomain(WORK_TOPOLOGY_SHARD_VERSION, shardPayload(payload)) !== shard.shardHash) fail("storage.integrity", `shard ${shard.id} hash mismatch`);
    covered.push(...shard.logicalIds);
    for (const logicalId of shard.logicalIds) {
      if (!canonicalEqual(shard.bindings[logicalId], generation.bindings[logicalId]) ||
          !canonicalEqual(shard.dependsOn[logicalId], generation.dependsOn[logicalId]) ||
          !canonicalEqual(shard.completionDependsOn[logicalId], generation.completionDependsOn[logicalId]) ||
          !canonicalEqual(shard.reverseDependsOn[logicalId], generation.reverseDependsOn[logicalId]) ||
          !canonicalEqual(shard.reverseCompletionDependsOn[logicalId], generation.reverseCompletionDependsOn[logicalId])) {
        fail("storage.integrity", `shard ${shard.id} disagrees for ${logicalId}`);
      }
    }
  });
  void expectedShards; // documents the same construction path; coverage checks below are authoritative for variable last shard.
  if (!canonicalEqual(covered, logicalIds)) fail("storage.integrity", "shards do not cover every binding exactly once in sorted order");
  if (!canonicalEqual(orderedShards.map((s) => s.shardHash), generation.shardHashes)) fail("storage.integrity", "generation shard hash inventory mismatch");

  const storedEdges = [...snapshot.edges].sort((a, b) => compareString(a.id, b.id));
  const expectedEdgeRows = edges.map((edge) => ({ id: edgeId(generation.generation, edge), generation: generation.generation, ...edge })).sort((a, b) => compareString(a.id, b.id));
  if (!canonicalEqual(storedEdges, expectedEdgeRows)) fail("storage.integrity", "edge rows do not exactly represent generation edges");

  const familyByLogical = new Map(snapshot.families.map((f) => [f.logicalId, f]));
  if (familyByLogical.size !== logicalIds.length) fail("storage.integrity", "family inventory count mismatch");
  for (const logicalId of logicalIds) {
    const family = familyByLogical.get(logicalId);
    const binding = generation.bindings[logicalId]!;
    if (!family || family.id !== logicalId || family.latestAllocatedRevision < binding.revision) fail("storage.integrity", `family mismatch for ${logicalId}`);
  }
  if (snapshot.operation.operationId !== generation.operationId || snapshot.operation.requestHash !== generation.requestHash ||
      snapshot.operation.generation !== generation.generation || snapshot.operation.topologyHash !== generation.topologyHash ||
      snapshot.operation.manifestId !== generation.id) fail("storage.integrity", "operation receipt mismatch");
  const notices = [...snapshot.notices].sort((a, b) => compareString(a.intentId, b.intentId));
  if (!canonicalEqual(notices.map((n) => n.intentId), generation.notificationIntentIds)) fail("storage.integrity", "notice inventory mismatch");
  for (const notice of notices) {
    if (notice.id !== notice.intentId || notice.operationId !== generation.operationId || notice.generation !== generation.generation) fail("storage.integrity", `notice ${notice.id} mismatch`);
  }
  if (snapshot.head) {
    if (snapshot.head.domain !== WORK_GRAPH_HEAD_ID || snapshot.head.id !== WORK_GRAPH_HEAD_ID ||
        snapshot.head.generation !== generation.generation || snapshot.head.manifestId !== generation.id ||
        snapshot.head.topologyHash !== generation.topologyHash || snapshot.head.operationId !== generation.operationId) {
      fail("storage.integrity", "head does not exact-bind the supplied generation");
    }
    if (snapshot.operation.state !== "committed" || snapshot.operation.committedAt !== snapshot.head.activatedAt) {
      fail("storage.integrity", "head-visible generation lacks its exact committed operation projection");
    }
  }
  if (snapshot.workItems) {
    const workById = new Map(snapshot.workItems.map((w) => [w.id, w]));
    for (const [logicalId, binding] of Object.entries(generation.bindings)) {
      const item = workById.get(binding.physicalId);
      if (!item) fail("storage.integrity", `bound WorkItem ${binding.physicalId} missing`);
      // Failed seal is classified before phase/currentness to make a raw-ready
      // legacy FAIL impossible to bless through restore integrity.
      const failed = isFailedGateSealed(item);
      if (failed && item.effectiveDisposition !== "failed_sealed" && item.failedGateSeal == null) {
        // Legacy is valid only as a derived seal; no write-on-read required.
        if (!item.attestations || !Object.values(item.attestations).some((a) => a.verdict === "fail")) fail("storage.integrity", `${logicalId} failed-seal derivation is inconsistent`);
      }
      if (item.logicalId && item.logicalId !== logicalId) fail("storage.integrity", `${binding.physicalId} logicalId mismatch`);
      if (item.revision && item.revision !== binding.revision) fail("storage.integrity", `${binding.physicalId} revision mismatch`);
      if (item.topologyGeneration !== undefined && (!Number.isSafeInteger(item.topologyGeneration) || item.topologyGeneration <= 0 || item.topologyGeneration > generation.generation)) {
        fail("storage.integrity", `${binding.physicalId} materialization generation mismatch`);
      }
      if (item.nodeContractHash && item.nodeContractHash !== binding.nodeContractHash) fail("storage.integrity", `${binding.physicalId} contract hash mismatch`);
      if (item.nodeTopologyHash && item.nodeTopologyHash !== binding.nodeTopologyHash) fail("storage.integrity", `${binding.physicalId} topology hash mismatch`);
    }
  }
}

export function createRevisionSnapshotManifestV4(snapshot: RevisionStorageSnapshotV4): RevisionSnapshotManifestV4 {
  assertRevisionStorageIntegrityV4(snapshot);
  const canonicalSnapshot = {
    head: snapshot.head,
    generation: snapshot.generation,
    shards: [...snapshot.shards].sort((a, b) => a.shardIndex - b.shardIndex),
    edges: [...snapshot.edges].sort((a, b) => compareString(a.id, b.id)),
    families: [...snapshot.families].sort((a, b) => compareString(a.logicalId, b.logicalId)),
    operation: snapshot.operation,
    notices: [...snapshot.notices].sort((a, b) => compareString(a.intentId, b.intentId)),
  };
  return {
    version: WORK_REVISION_SNAPSHOT_VERSION,
    generation: snapshot.generation.generation,
    topologyHash: snapshot.generation.topologyHash,
    manifestHash: snapshot.generation.manifestHash,
    counts: {
      bindings: Object.keys(snapshot.generation.bindings).length,
      shards: snapshot.shards.length,
      edges: snapshot.edges.length,
      families: snapshot.families.length,
      notices: snapshot.notices.length,
    },
    snapshotHash: hashCanonicalDomain(WORK_REVISION_SNAPSHOT_VERSION, canonicalSnapshot),
  };
}

export function assertRevisionSnapshotManifestV4(snapshot: RevisionStorageSnapshotV4, manifest: RevisionSnapshotManifestV4): void {
  const actual = createRevisionSnapshotManifestV4(snapshot);
  if (!canonicalEqual(actual, manifest)) fail("storage.integrity", `snapshot/restore manifest mismatch expected=${manifest.snapshotHash} actual=${actual.snapshotHash}`);
}

export function compareShadowGenerationV4(
  input: BuildWorkRevisionStorageInputV4,
  actual: WorkGraphTopologyGenerationV4,
): ShadowComparisonV4 {
  const expected = buildWorkRevisionStorageV4(input).generation;
  const divergences: string[] = [];
  for (const key of [
    "schemaVersion", "generation", "previousGeneration", "bindings", "dependsOn", "completionDependsOn",
    "reverseDependsOn", "reverseCompletionDependsOn", "topologyHash", "manifestHash",
    "operationId", "requestHash", "notificationIntentIds", "shardHashes", "createdAt",
  ] as const) {
    if (!canonicalEqual(expected[key], actual[key])) divergences.push(key);
  }
  return {
    equal: divergences.length === 0,
    divergences,
    expectedTopologyHash: expected.topologyHash,
    actualTopologyHash: actual.topologyHash,
    expectedManifestHash: expected.manifestHash,
    actualManifestHash: actual.manifestHash,
  };
}

async function listAllStableWithSnapshot<T>(substrate: HubStorageSubstrate, kind: string, filter?: Record<string, unknown>): Promise<{ items: T[]; snapshotRevision: string }> {
  const out: T[] = [];
  let offset = 0;
  let snapshotRevision: string | undefined;
  while (true) {
    const page = await substrate.list<T>(kind, {
      ...(filter ? { filter: filter as never } : {}),
      sort: [{ field: "id", order: "asc" }],
      limit: 500,
      offset,
    });
    if (snapshotRevision === undefined) snapshotRevision = page.snapshotRevision;
    else if (snapshotRevision !== page.snapshotRevision) fail("storage.snapshot_drift", `${kind} scan changed high-water revision ${snapshotRevision}->${page.snapshotRevision}`);
    out.push(...page.items.map((row) => decodeRow(row, kind)));
    if (page.items.length < 500) return { items: out, snapshotRevision };
    offset += page.items.length;
  }
}

async function listAllStable<T>(substrate: HubStorageSubstrate, kind: string, filter?: Record<string, unknown>): Promise<T[]> {
  return (await listAllStableWithSnapshot<T>(substrate, kind, filter)).items;
}

export interface BootstrapLegacyShadowOptionsV4 {
  generation: number;
  previousGeneration: number;
  operationId: string;
  createdAt: string;
  bindReferences: (item: WorkItem, snapshotToken: string) => Promise<readonly BoundWorkItemReferenceV4[]>;
  resolveFamilyScope?: (item: WorkItem) => Promise<FamilyScopeV4> | FamilyScopeV4;
  shardSize?: number;
}

/** Storage repository: all generation/shard/edge rows are create-only. */
export class WorkRevisionStorageRepositoryV4 {
  constructor(private readonly substrate: HubStorageSubstrate) {}

  private async immutablePut<T extends { id: string }>(kind: string, row: T): Promise<void> {
    const created = await this.substrate.createOnly(kind, row);
    if (created.ok) return;
    const existingRaw = await this.substrate.get<T>(kind, row.id);
    if (!existingRaw) fail("storage.immutable_conflict", `${kind}/${row.id} conflicted but cannot be read`);
    const existing = decodeRow(existingRaw, kind);
    if (!canonicalEqual(existing, row)) fail("storage.immutable_conflict", `${kind}/${row.id} exists with different bytes`);
  }

  private familyIdentity(row: WorkRevisionFamilyRowV4): unknown {
    return {
      id: row.id,
      logicalId: row.logicalId,
      originPhysicalId: row.originPhysicalId,
      originalCreatedBy: row.originalCreatedBy,
      familyScope: row.familyScope,
      createdAt: row.createdAt,
    };
  }

  private assertSameFamilyIdentity(existing: WorkRevisionFamilyRowV4, requested: WorkRevisionFamilyRowV4): void {
    if (!canonicalEqual(this.familyIdentity(existing), this.familyIdentity(requested))) {
      fail("storage.family_identity_conflict", `family ${requested.logicalId} immutable identity changed`);
    }
  }

  private async persistFamily(family: WorkRevisionFamilyRowV4): Promise<void> {
    const created = await this.substrate.createOnly(WORK_REVISION_KINDS.family, family);
    if (created.ok) return;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const row = await this.substrate.getWithRevision<WorkRevisionFamilyRowV4>(WORK_REVISION_KINDS.family, family.id);
      if (!row) fail("storage.family_identity_conflict", `family ${family.logicalId} conflicted but is unreadable`);
      const existing = decodeRow(row.entity, WORK_REVISION_KINDS.family);
      this.assertSameFamilyIdentity(existing, family);
      if (existing.latestAllocatedRevision >= family.latestAllocatedRevision) return;
      const cas = await this.substrate.putIfMatch(
        WORK_REVISION_KINDS.family,
        { ...existing, latestAllocatedRevision: family.latestAllocatedRevision },
        row.resourceVersion,
      );
      if (cas.ok) return;
    }
    fail("storage.head_conflict", `family ${family.logicalId} monotonic high-water CAS did not converge`);
  }

  async allocateNextRevision(input: AllocateWorkRevisionV4): Promise<{ family: WorkRevisionFamilyRowV4; revision: number }> {
    assertNonEmpty(input.logicalId, "logicalId");
    assertNonEmpty(input.originPhysicalId, "originPhysicalId");
    assertNonEmpty(input.originalCreatedBy.role, "originalCreatedBy.role");
    assertNonEmpty(input.originalCreatedBy.agentId, "originalCreatedBy.agentId");
    assertNonEmpty(input.familyScope.id, "familyScope.id");
    if (input.familyScope.kind !== "mission" && input.familyScope.kind !== "standalone") fail("storage.invalid", "familyScope.kind is invalid");
    assertNonEmpty(input.createdAt, "createdAt");
    const id = input.logicalId;
    return withAdvisoryLock(this.substrate, LOCK_CLASS.workGraphGlobal, WORK_GRAPH_HEAD_ID, async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const row = await this.substrate.getWithRevision<WorkRevisionFamilyRowV4>(WORK_REVISION_KINDS.family, id);
        if (!row) {
          const family: WorkRevisionFamilyRowV4 = { id, ...input, latestAllocatedRevision: 1 };
          const created = await this.substrate.createOnly(WORK_REVISION_KINDS.family, family);
          if (created.ok) return { family, revision: 1 };
          continue;
        }
        const existing = decodeRow(row.entity, WORK_REVISION_KINDS.family);
        this.assertSameFamilyIdentity(existing, { id, ...input, latestAllocatedRevision: existing.latestAllocatedRevision });
        const revision = existing.latestAllocatedRevision + 1;
        const next = { ...existing, latestAllocatedRevision: revision };
        const cas = await this.substrate.putIfMatch(WORK_REVISION_KINDS.family, next, row.resourceVersion);
        if (cas.ok) return { family: next, revision };
      }
      fail("storage.head_conflict", `family ${input.logicalId} revision allocation did not converge`);
    });
  }

  private async persistPreparedOperation(operation: WorkGraphRevisionOperationV4): Promise<void> {
    const created = await this.substrate.createOnly(WORK_REVISION_KINDS.operation, operation);
    if (created.ok) return;
    const existing = await this.getOperation(operation.operationId);
    if (!existing) fail("storage.immutable_conflict", `operation ${operation.operationId} conflicted but is unreadable`);
    const identity = (row: WorkGraphRevisionOperationV4) => ({
      id: row.id, operationId: row.operationId, requestHash: row.requestHash,
      generation: row.generation, previousGeneration: row.previousGeneration,
      topologyHash: row.topologyHash, manifestId: row.manifestId,
      recommitSet: row.recommitSet, preparedAt: row.preparedAt,
    });
    if (!canonicalEqual(identity(existing), identity(operation))) {
      fail("storage.operation_conflict", `operation ${operation.operationId} was reused with another canonical request`);
    }
  }

  private async persistPreparedNotice(notice: WorkGraphRevisionNoticeV4): Promise<void> {
    const created = await this.substrate.createOnly(WORK_REVISION_KINDS.notice, notice);
    if (created.ok) return;
    const existing = await this.getNotice(notice.intentId);
    if (!existing) fail("storage.immutable_conflict", `notice ${notice.intentId} conflicted but is unreadable`);
    const authority = (row: WorkGraphRevisionNoticeV4) => ({
      id: row.id, intentId: row.intentId, operationId: row.operationId,
      generation: row.generation, logicalId: row.logicalId, physicalId: row.physicalId,
      exactHolderAgentId: row.exactHolderAgentId, payloadHash: row.payloadHash,
      createdAt: row.createdAt,
    });
    if (!canonicalEqual(authority(existing), authority(notice))) {
      fail("storage.operation_conflict", `notice ${notice.intentId} immutable authority changed`);
    }
  }

  async persistPrepared(storage: BuiltWorkRevisionStorageV4): Promise<void> {
    assertRevisionStorageIntegrityV4({
      head: null,
      generation: storage.generation,
      shards: storage.shards,
      edges: storage.edges,
      families: storage.families,
      operation: storage.operation,
      notices: storage.notices,
    });
    // Every row is inert until the last head CAS. Publish the operation lookup
    // LAST: observing a prepared operation proves its complete generation,
    // shards, edges, families, and notices are durable (restart replay never
    // follows a half-written lookup pointer).
    for (const family of storage.families) await this.persistFamily(family);
    for (const notice of storage.notices) await this.persistPreparedNotice(notice);
    for (const edge of storage.edges) await this.immutablePut(WORK_REVISION_KINDS.edge, edge);
    for (const shard of storage.shards) await this.immutablePut(WORK_REVISION_KINDS.shard, shard);
    await this.immutablePut(WORK_REVISION_KINDS.generation, storage.generation);
    await this.persistPreparedOperation(storage.operation);
  }

  async bootstrapLegacyShadow(opts: BootstrapLegacyShadowOptionsV4): Promise<BuiltWorkRevisionStorageV4> {
    // One uncapped scan. A moving substrate high-water fails closed rather than
    // combining rows from different snapshots.
    const scan = await listAllStableWithSnapshot<WorkItem>(this.substrate, "WorkItem");
    const rows = scan.items;
    // Binders receive the exact high-water token shared by every page. A mutable
    // reference resolver must prove it read from this same snapshot or reject.
    const snapshotToken = scan.snapshotRevision;
    const boundReferencesByPhysicalId: Record<string, BoundWorkItemReferenceV4[]> = {};
    const familyScopesByPhysicalId: Record<string, FamilyScopeV4> = {};
    for (const item of rows) {
      boundReferencesByPhysicalId[item.id] = [...plainPersisted(await opts.bindReferences(item, snapshotToken))];
      familyScopesByPhysicalId[item.id] = plainPersisted(await opts.resolveFamilyScope?.(item) ?? deriveFamilyScope(item));
    }
    const built = buildWorkRevisionStorageV4({
      workItems: rows,
      boundReferencesByPhysicalId,
      familyScopesByPhysicalId,
      generation: opts.generation,
      previousGeneration: opts.previousGeneration,
      operationId: opts.operationId,
      createdAt: opts.createdAt,
      shardSize: opts.shardSize,
    });
    await this.persistPrepared(built);
    return built;
  }

  /** Materialize new exact immutable physical rows that a candidate binding names. */
  async persistProjectedWorkItems(storage: BuiltWorkRevisionStorageV4): Promise<void> {
    return withAdvisoryLock(this.substrate, LOCK_CLASS.workGraphGlobal, WORK_GRAPH_HEAD_ID, () =>
      this.persistProjectedWorkItemsUnderLock(storage));
  }

  /**
   * bug-364 CASE 1 — write the derived identity onto a row that has never had one.
   *
   * THE NINE IDENTITY FIELDS AND NOTHING ELSE. Every other field is carried from the STORED row,
   * not from the candidate: the candidate's `workItem` is a projection built for this generation
   * and must not be allowed to overwrite live lifecycle state (status, lease, evidence,
   * attestations, seals). Spreading `existing` first and then only the nine is what makes that
   * checkable by reading it — and the four sealed fields are provably untouched because they are
   * not in the list and the list is the only thing applied.
   *
   * CAS, and a LOSING CAS REFUSES rather than retrying. A retry-until-win loop would be wrong
   * here: losing means another writer moved the row, so the identity the builder derived may no
   * longer match the row's content, and re-deriving is the caller's business, not this write's.
   * (`persistFamily` above retries because it converges a monotonic high-water mark — a different
   * problem with a different safety argument.)
   */
  private async materializeIdentityOnLegacyRow(row: WorkItem): Promise<void> {
    const current = await this.substrate.getWithRevision<WorkItem>("WorkItem", row.id);
    if (!current) {
      fail("storage.integrity", `WorkItem/${row.id} vanished between read and identity materialization`);
    }
    // Re-decode under the CAS read: the row may have moved since the comparison above, and the
    // absence that justified case 1 must still hold at the instant we write.
    const fresh = decodeRow(current.entity, "WorkItem");
    const stillAbsent = IMMUTABLE_IDENTITY_FIELDS.every((f) => identityFieldAbsent(fresh, f));
    if (!stillAbsent) {
      fail(
        "storage.immutable_conflict",
        `WorkItem/${row.id} acquired an immutable identity between admission and materialization`,
      );
    }
    const next: WorkItem = {
      ...fresh,
      logicalId: row.logicalId,
      revision: row.revision,
      nodeContractHashVersion: row.nodeContractHashVersion,
      nodeContractHash: row.nodeContractHash,
      nodeTopologyHashVersion: row.nodeTopologyHashVersion,
      nodeTopologyHash: row.nodeTopologyHash,
      localExecutionIdentity: row.localExecutionIdentity,
      topologyGeneration: row.topologyGeneration,
      boundReferences: plainPersisted(row.boundReferences ?? []),
    };
    const cas = await this.substrate.putIfMatch("WorkItem", next, current.resourceVersion);
    if (!cas.ok) {
      fail(
        "storage.immutable_conflict",
        `WorkItem/${row.id} identity materialization lost a CAS — the row changed concurrently; ` +
        `not retried, because the derived identity may no longer match the row's content`,
      );
    }
  }

  private async persistProjectedWorkItemsUnderLock(storage: BuiltWorkRevisionStorageV4): Promise<void> {
    const missing: WorkItem[] = [];
    for (const projection of storage.projections) {
      const row: WorkItem = {
        ...plainPersisted(projection.workItem),
        ...plainPersisted(projection.revisionFields),
        boundReferences: plainPersisted(projection.boundReferences),
        localExecutionIdentity: projection.localExecutionIdentity,
        // The immutable physical row records its first materialization. A
        // disconnected later head may retain this exact binding/local identity.
        topologyGeneration: projection.workItem.topologyGeneration ?? storage.generation.generation,
      };
      const existingRaw = await this.substrate.get<WorkItem>("WorkItem", row.id);
      if (existingRaw) {
        const existing = decodeRow(existingRaw, "WorkItem");
        // bug-364 / bug-372 — ABSENT IS NOT DIFFERENT. `existing.X !== row.X` is true when X is
        // DIFFERENT and when X is ABSENT, and those mean opposite things. Every row written
        // before the v4 identity existed carries all nine fields undefined, so the old comparison
        // read "unidentified" as "conflicting" and refused it — stranding, permanently, every row
        // that exists today. That was an accident of a conflated comparison, not a safety property.
        const absent = IMMUTABLE_IDENTITY_FIELDS.filter((f) => identityFieldAbsent(existing, f));
        if (absent.length === IMMUTABLE_IDENTITY_FIELDS.length) {
          // CASE 1 — FIRST MATERIALISATION. Nothing is stored, so there is nothing to conflict
          // WITH. The identity is derived deterministically from the row's own content by the
          // builder, in this same call, and is disjoint from every sealed field.
          await this.materializeIdentityOnLegacyRow(row);
          continue;
        }
        if (absent.length > 0) {
          // CASE 3 — MIXED. NOT a first materialisation, and NEVER silently healed: a
          // partially-identified row is either corrupt or mid-write, and quietly completing it
          // destroys the evidence of which. Distinct code, and it NAMES the absent fields.
          fail(
            "storage.partial_identity",
            `WorkItem/${row.id} has a PARTIAL immutable identity — ${absent.length} of ` +
            `${IMMUTABLE_IDENTITY_FIELDS.length} fields absent [${absent.join(", ")}]; this is not a first ` +
            `materialization and is not auto-completed. Investigate whether the row is corrupt or mid-write.`,
          );
        }
        // CASE 2 — FULLY IDENTIFIED. Compare exactly as before. Retaining an exact physical
        // binding across a disconnected generation must not overwrite its live lifecycle row;
        // activation later recomputes the full contract/local identity fresh.
        if (existing.logicalId !== row.logicalId || existing.revision !== row.revision ||
            existing.nodeContractHashVersion !== row.nodeContractHashVersion || existing.nodeContractHash !== row.nodeContractHash ||
            existing.nodeTopologyHashVersion !== row.nodeTopologyHashVersion || existing.nodeTopologyHash !== row.nodeTopologyHash ||
            existing.localExecutionIdentity !== row.localExecutionIdentity || existing.topologyGeneration !== row.topologyGeneration ||
            !canonicalEqual(existing.boundReferences ?? [], row.boundReferences ?? [])) {
          fail("storage.immutable_conflict", `WorkItem/${row.id} retained binding has different immutable identity`);
        }
        continue;
      }
      missing.push(row);
    }
    // A process death may occur before or after this transaction, never between
    // successor rows. Retained old bindings are read-only validations; every new
    // physical successor for the generation is one all-or-nothing create batch.
    const created = await this.substrate.createBatchOnly(missing.map((entity) => ({ kind: "WorkItem", entity })));
    if (!created.ok) fail("storage.immutable_conflict", `successor batch conflicted at ${created.existing.map((entry) => entry.id).join(",")}`);
  }

  /**
   * Preserve-not-inject legacy cut: upgrade rows from the exact shadow scan by
   * one CAS each. Any intervening lifecycle/storage change fails closed; no
   * migration code guesses how to merge a moving row.
   */
  async migrateLegacyProjectedWorkItems(storage: BuiltWorkRevisionStorageV4): Promise<void> {
    return withAdvisoryLock(this.substrate, LOCK_CLASS.workGraphGlobal, WORK_GRAPH_HEAD_ID, () =>
      this.migrateLegacyProjectedWorkItemsUnderLock(storage));
  }

  private async migrateLegacyProjectedWorkItemsUnderLock(storage: BuiltWorkRevisionStorageV4): Promise<void> {
    for (const projection of storage.projections) {
      const target: WorkItem = {
        ...plainPersisted(projection.workItem),
        ...plainPersisted(projection.revisionFields),
        boundReferences: plainPersisted(projection.boundReferences),
        localExecutionIdentity: projection.localExecutionIdentity,
        topologyGeneration: projection.workItem.topologyGeneration ?? storage.generation.generation,
      };
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const row = await this.substrate.getWithRevision<WorkItem>("WorkItem", projection.physicalId);
        if (!row) fail("storage.snapshot_drift", `legacy WorkItem ${projection.physicalId} disappeared after shadow scan`);
        const existing = decodeRow(row.entity, "WorkItem");
        // Evaluate negative authority before any legacy/current distinction.
        isFailedGateSealed(existing);
        if (canonicalEqual(existing, target)) break;
        const alreadyRevisioned = existing.logicalId !== undefined || existing.revision !== undefined ||
          existing.nodeContractHash !== undefined || existing.nodeTopologyHash !== undefined ||
          existing.localExecutionIdentity !== undefined || existing.topologyGeneration !== undefined;
        if (alreadyRevisioned) fail("storage.immutable_conflict", `legacy WorkItem ${projection.physicalId} has a partial/conflicting revision identity`);
        if (!canonicalEqual(existing, projection.workItem)) {
          fail("storage.snapshot_drift", `legacy WorkItem ${projection.physicalId} changed after shadow scan`);
        }
        const cas = await this.substrate.putIfMatch("WorkItem", target, row.resourceVersion);
        if (cas.ok) break;
        if (attempt === 19) fail("storage.snapshot_drift", `legacy WorkItem ${projection.physicalId} migration CAS did not converge`);
      }
    }
  }

  async getHead(): Promise<{ head: WorkGraphTopologyHeadV4; resourceVersion: string } | null> {
    const row = await this.substrate.getWithRevision<WorkGraphTopologyHeadV4>(WORK_REVISION_KINDS.head, WORK_GRAPH_HEAD_ID);
    return row ? { head: decodeRow(row.entity, WORK_REVISION_KINDS.head), resourceVersion: row.resourceVersion } : null;
  }

  async getGeneration(idOrGeneration: string | number): Promise<WorkGraphTopologyGenerationV4 | null> {
    const id = typeof idOrGeneration === "number" ? topologyGenerationId(idOrGeneration) : idOrGeneration;
    const row = await this.substrate.get<WorkGraphTopologyGenerationV4>(WORK_REVISION_KINDS.generation, id);
    return row ? decodeRow(row, WORK_REVISION_KINDS.generation) : null;
  }

  async getFamily(logicalId: string): Promise<WorkRevisionFamilyRowV4 | null> {
    const row = await this.substrate.get<WorkRevisionFamilyRowV4>(WORK_REVISION_KINDS.family, logicalId);
    return row ? decodeRow(row, WORK_REVISION_KINDS.family) : null;
  }

  async getOperation(operationId: string): Promise<WorkGraphRevisionOperationV4 | null> {
    const row = await this.substrate.get<WorkGraphRevisionOperationV4>(WORK_REVISION_KINDS.operation, operationId);
    return row ? decodeRow(row, WORK_REVISION_KINDS.operation) : null;
  }

  async getNotice(intentId: string): Promise<WorkGraphRevisionNoticeV4 | null> {
    const row = await this.substrate.get<WorkGraphRevisionNoticeV4>(WORK_REVISION_KINDS.notice, intentId);
    return row ? decodeRow(row, WORK_REVISION_KINDS.notice) : null;
  }

  async loadEdgesComplete(generation: number): Promise<WorkGraphTopologyEdgeV4[]> {
    return listAllStable<WorkGraphTopologyEdgeV4>(this.substrate, WORK_REVISION_KINDS.edge, { generation });
  }

  async listReverseSources(generation: number, targetLogicalId: string, edgeClass: EdgeClassV4): Promise<string[]> {
    const rows = await listAllStable<WorkGraphTopologyEdgeV4>(this.substrate, WORK_REVISION_KINDS.edge, {
      generation, targetLogicalId, edgeClass,
    });
    return sortedUnique(rows.map((r) => r.sourceLogicalId), "reverse sources");
  }

  async listPendingNotices(): Promise<WorkGraphRevisionNoticeV4[]> {
    return listAllStable<WorkGraphRevisionNoticeV4>(this.substrate, WORK_REVISION_KINDS.notice, { projected: false });
  }

  async markNoticeProjected(intentId: string, messageId: string, projectedAt: string): Promise<WorkGraphRevisionNoticeV4> {
    const row = await this.substrate.getWithRevision<WorkGraphRevisionNoticeV4>(WORK_REVISION_KINDS.notice, intentId);
    if (!row) fail("storage.integrity", `notice ${intentId} missing`);
    const current = decodeRow(row.entity, WORK_REVISION_KINDS.notice);
    if (current.projected) {
      if (current.projectedMessageId !== messageId) fail("storage.operation_conflict", `notice ${intentId} already projected to another Message`);
      return current;
    }
    const next = { ...current, projected: true, projectedMessageId: messageId, projectedAt };
    const cas = await this.substrate.putIfMatch(WORK_REVISION_KINDS.notice, next, row.resourceVersion);
    if (!cas.ok) fail("storage.head_conflict", `notice ${intentId} CAS lost to rv=${cas.actualRevision}`);
    return next;
  }

  private async assertBoundPhysicalRows(generation: WorkGraphTopologyGenerationV4): Promise<void> {
    const outgoingByLogical = new Map<string, TopologyEdgeV4[]>();
    for (const edge of topologyEdgesFromGeneration(generation)) {
      const list = outgoingByLogical.get(edge.sourceLogicalId) ?? [];
      list.push(edge);
      outgoingByLogical.set(edge.sourceLogicalId, list);
    }
    for (const [logicalId, binding] of Object.entries(generation.bindings).sort(([a], [b]) => compareString(a, b))) {
      const raw = await this.substrate.get<WorkItem>("WorkItem", binding.physicalId);
      if (!raw) fail("storage.integrity", `bound physical WorkItem ${binding.physicalId} is absent`);
      const item = decodeRow(raw, "WorkItem");
      // Failed-seal authority is derived before currentness/hash validation. The
      // row remains an exact historical binding but can never be reclassified by
      // a raw phase while activation is checking it.
      const failedSealed = isFailedGateSealed(item);
      if (item.logicalId !== logicalId || item.revision !== binding.revision || !Number.isSafeInteger(item.topologyGeneration) ||
          (item.topologyGeneration as number) <= 0 || (item.topologyGeneration as number) > generation.generation ||
          item.nodeContractHashVersion !== binding.nodeContractHashVersion || item.nodeContractHash !== binding.nodeContractHash ||
          item.nodeTopologyHashVersion !== binding.nodeTopologyHashVersion || item.nodeTopologyHash !== binding.nodeTopologyHash) {
        fail("storage.integrity", `bound physical WorkItem ${binding.physicalId} revision identity mismatch`);
      }
      if (failedSealed && item.effectiveDisposition !== "failed_sealed" && item.failedGateSeal != null) {
        fail("storage.integrity", `bound failed-sealed WorkItem ${binding.physicalId} has inconsistent effective disposition`);
      }
      const boundReferences = item.boundReferences ?? [];
      if ((item.references?.length ?? 0) !== boundReferences.length) {
        fail("storage.reference_unbound", `${binding.physicalId} persisted reference binding is incomplete`);
      }
      const contract = deriveNodeContractV4(contractInput(item), boundReferences);
      const topology = deriveNodeTopologyV4(logicalId, generation.dependsOn[logicalId]!, generation.completionDependsOn[logicalId]!);
      if (contract.hash !== binding.nodeContractHash || topology.hash !== binding.nodeTopologyHash) {
        fail("storage.integrity", `${binding.physicalId} exact contract/topology recomputation mismatch`);
      }
      const outgoing: TargetBindingV4[] = (outgoingByLogical.get(logicalId) ?? [])
        .map((edge) => {
          const target = generation.bindings[edge.targetLogicalId]!;
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
        physicalId: binding.physicalId,
        revision: binding.revision,
        nodeContractHashVersion: binding.nodeContractHashVersion,
        nodeContractHash: binding.nodeContractHash,
        nodeTopologyHashVersion: binding.nodeTopologyHashVersion,
        nodeTopologyHash: binding.nodeTopologyHash,
        outgoingTargetBindings: outgoing,
      });
      if (item.localExecutionIdentity !== localIdentity) fail("storage.integrity", `${binding.physicalId} local execution identity mismatch`);
    }
  }

  private async reconcileCommittedOperation(
    generation: WorkGraphTopologyGenerationV4,
    operationId: string,
    committedAt: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const opRow = await this.substrate.getWithRevision<WorkGraphRevisionOperationV4>(WORK_REVISION_KINDS.operation, operationId);
      if (!opRow) fail("storage.integrity", `operation ${operationId} missing after head commit`);
      const op = decodeRow(opRow.entity, WORK_REVISION_KINDS.operation);
      if (op.requestHash !== generation.requestHash || op.generation !== generation.generation || op.manifestId !== generation.id) {
        fail("storage.operation_conflict", `operation ${operationId} binding mismatch`);
      }
      if (op.state === "committed") {
        if (op.committedAt !== committedAt) fail("storage.operation_conflict", `operation ${operationId} committedAt disagrees with head`);
        return;
      }
      const cas = await this.substrate.putIfMatch(
        WORK_REVISION_KINDS.operation,
        { ...op, state: "committed", committedAt },
        opRow.resourceVersion,
      );
      if (cas.ok) return;
    }
    fail("storage.head_conflict", `operation ${operationId} projection could not converge after head commit`);
  }

  async activateGeneration(generationNumber: number, operationId: string, activatedAt: string): Promise<WorkGraphTopologyHeadV4> {
    return withAdvisoryLock(this.substrate, LOCK_CLASS.workGraphGlobal, WORK_GRAPH_HEAD_ID, async () => {
      const current = await this.getHead();
      if (current?.head.generation === generationNumber) {
        // Recovery window: the authoritative head may have committed while its
        // operation lookup projection did not. Read the bound manifest directly,
        // reconcile projection, then run the full snapshot/physical guards.
        const generation = await this.getGeneration(generationNumber);
        if (!generation) fail("storage.integrity", `head-bound generation ${generationNumber} is absent`);
        if (generation.operationId !== operationId || current.head.operationId !== operationId || current.head.topologyHash !== generation.topologyHash) {
          fail("storage.head_conflict", "same generation points at different operation/hash");
        }
        await this.reconcileCommittedOperation(generation, operationId, current.head.activatedAt);
        await this.readSnapshot(generationNumber);
        await this.assertBoundPhysicalRows(generation);
        return current.head;
      }
      // Generation is written last during preparation, but activation still
      // re-reads and validates the complete immutable inventory. Direct/ad-hoc
      // manifest injection or any missing shard/edge/family/intent fails closed.
      const preparedSnapshot = await this.readSnapshot(generationNumber);
      const generation = preparedSnapshot.generation;
      if (generation.operationId !== operationId) fail("storage.operation_conflict", `generation operation '${generation.operationId}' != '${operationId}'`);
      await this.assertBoundPhysicalRows(generation);
      const actualPrevious = current?.head.generation ?? 0;
      if (actualPrevious !== generation.previousGeneration) {
        if (generationNumber <= actualPrevious) fail("storage.pointer_rollback", `head=${actualPrevious}, requested=${generationNumber}`);
        fail("storage.head_conflict", `expected previous=${generation.previousGeneration}, actual=${actualPrevious}`);
      }
      const head: WorkGraphTopologyHeadV4 = {
        id: WORK_GRAPH_HEAD_ID,
        domain: WORK_GRAPH_HEAD_ID,
        generation: generation.generation,
        manifestId: generation.id,
        topologyHash: generation.topologyHash,
        operationId,
        activatedAt,
      };
      if (!current) {
        const created = await this.substrate.createOnly(WORK_REVISION_KINDS.head, head);
        if (!created.ok) fail("storage.head_conflict", "head create raced");
      } else {
        const cas = await this.substrate.putIfMatch(WORK_REVISION_KINDS.head, head, current.resourceVersion);
        if (!cas.ok) fail("storage.head_conflict", `head CAS lost to rv=${cas.actualRevision}`);
      }
      // Operation state is a non-authoritative lookup projection. Reconcile it
      // after head commit; an idempotent retry repairs a crash in this window.
      await this.reconcileCommittedOperation(generation, operationId, activatedAt);
      return head;
    }, { timeoutMs: 5_000 });
  }

  async readSnapshot(generationNumber?: number): Promise<RevisionStorageSnapshotV4> {
    const head = await this.getHead();
    const generationId = generationNumber ?? head?.head.generation;
    if (!generationId) fail("storage.integrity", "no head/generation selected");
    const generation = await this.getGeneration(generationId);
    if (!generation) fail("storage.integrity", `generation ${generationId} missing`);
    const [shards, edges, families, notices] = await Promise.all([
      listAllStable<WorkGraphTopologyShardV4>(this.substrate, WORK_REVISION_KINDS.shard, { generation: generationId }),
      listAllStable<WorkGraphTopologyEdgeV4>(this.substrate, WORK_REVISION_KINDS.edge, { generation: generationId }),
      Promise.all(Object.keys(generation.bindings).sort(compareString).map((id) => this.getFamily(id)))
        .then((rows) => rows.filter((row): row is WorkRevisionFamilyRowV4 => row !== null)),
      Promise.all(generation.notificationIntentIds.map((id) => this.getNotice(id))).then((rows) => rows.filter((r): r is WorkGraphRevisionNoticeV4 => r !== null)),
    ]);
    const operation = await this.getOperation(generation.operationId);
    if (!operation) fail("storage.integrity", `operation ${generation.operationId} missing`);
    const snapshot = { head: head?.head.generation === generationId ? head.head : null, generation, shards, edges, families, operation, notices };
    assertRevisionStorageIntegrityV4(snapshot);
    return snapshot;
  }
}
