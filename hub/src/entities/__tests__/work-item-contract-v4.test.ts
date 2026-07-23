import { describe, expect, it } from "vitest";
import type { WorkItem, WorkItemReference } from "../work-item.js";
import {
  LOCAL_EXECUTION_IDENTITY_VERSION,
  NODE_CONTRACT_HASH_VERSION,
  NODE_TOPOLOGY_HASH_VERSION,
  WorkContractV4Error,
  bindWorkItemReferencesV4,
  canonicalJson,
  deriveLocalExecutionIdentityV4,
  deriveNodeContractV4,
  deriveNodeTopologyV4,
  deriveTargetBindingDigestV4,
  deriveWorkTopologyHashV4,
  hashCanonicalDomain,
  parseJsonWithoutDuplicateKeys,
  referenceIdentityEqual,
  sha256Utf8,
  type AuthoritativeReferenceResolutionV4,
  type BoundWorkItemReferenceV4,
  type LocalExecutionIdentityV4Input,
  type TargetBindingV4,
  type TopologyBindingV4,
} from "../work-item-contract-v4.js";

const COMMIT = "a".repeat(40);
const SNAPSHOT = "pg-snapshot-77";
const HUB_PATH = "docs/spec.md";

const references: WorkItemReference[] = [
  { kind: "doc", ref: HUB_PATH, storage: "hub-doc", mode: "triangulate-against", required: true },
  { kind: "source", ref: `${COMMIT}:hub/src/x.ts`, storage: "git", mode: "read", required: true },
  { kind: "calibration", ref: "é", storage: "inline", mode: "read", required: false },
  { kind: "mission", ref: "mission-140", storage: "entity", mode: "read", required: true },
];

const resolutions: AuthoritativeReferenceResolutionV4[] = [
  { storage: "hub-doc", path: HUB_PATH, resourceVersion: "42", content: "alpha\n", snapshotToken: SNAPSHOT },
  { storage: "git", repo: "apnex/agentic-network", full40CommitSha: COMMIT, path: "hub/src/x.ts", content: "export {};\n" },
  { storage: "inline" },
  { storage: "entity", kind: "mission", id: "mission-140", resourceVersion: "99", state: { status: "active", title: "M" }, snapshotToken: SNAPSHOT },
];

function baseWork(): WorkItem {
  return {
    id: "work-physical-1",
    type: "task",
    priority: "critical",
    roleEligibility: ["verifier", "engineer"],
    dependsOn: ["logical-a"],
    completionDependsOn: ["logical-b"],
    evidenceRequirements: [
      { id: "tests", kind: "test-run", description: "exact tests", refResolvable: false },
      { id: "commit", kind: "commit", allowPreClaim: true, evidenceAuthority: "executor-evidence" },
    ],
    runbook: "Perform exact work.\n",
    references: structuredClone(references),
    leaseWindowMs: 1_800_000,
    targetRef: { kind: "mission", id: "mission-140" },
    payload: { z: 2, a: [true, null, "é"] },
    blueprintRunId: "run-ignored",
    status: "in_progress",
    lease: { holder: "agent-1", token: "secret", claimedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T00:15:00Z", heartbeatAt: "2026-01-01T00:00:00Z" },
    evidence: [],
    frictionReflections: [],
    blockedOn: null,
    leaseExpiryCount: 2,
    enteredCurrentStateAt: "2026-01-01T00:00:00Z",
    stateDurations: { ready: 1, claimed: 2, in_progress: 3, blocked: 4, paused: 5, review: 6 },
    attestationHistory: [],
    attestations: {},
    executorHistory: ["agent-1"],
    nodeConfig: {
      pulse: {
        intervalSeconds: 300,
        message: "status?",
        responseShape: "short_status",
        missedThreshold: 2,
        firstFireDelaySeconds: 60,
        lastFiredAt: "2026-01-01T00:00:00Z",
        missedCount: 1,
      },
    },
    createdBy: { role: "architect", agentId: "arch-1" },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:01:00Z",
  };
}

function bound(
  refs: WorkItemReference[] = structuredClone(references),
  rs: AuthoritativeReferenceResolutionV4[] = structuredClone(resolutions),
): BoundWorkItemReferenceV4[] {
  return bindWorkItemReferencesV4(refs, rs, SNAPSHOT);
}

function digest(work = baseWork(), bindings = bound()) {
  return deriveNodeContractV4(work, bindings);
}

function changed(mutator: (work: WorkItem) => void, bindings?: BoundWorkItemReferenceV4[]) {
  const work = baseWork();
  mutator(work);
  return deriveNodeContractV4(work, bindings ?? bound()).hash;
}

describe("node-contract-v4 canonical JSON", () => {
  it("sorts object keys, preserves sequence order, canonicalizes -0, and does no Unicode normalization", () => {
    expect(canonicalJson({ z: -0, a: [3, 2, 1], s: "é" })).toBe('{"a":[3,2,1],"s":"é","z":0}');
    expect(hashCanonicalDomain("unicode", "é")).not.toBe(hashCanonicalDomain("unicode", "e\u0301"));
    expect(canonicalJson({ n: 1e30 })).toBe('{"n":1e+30}');
  });

  it("rejects values JSON would silently erase or coerce", () => {
    expect(() => canonicalJson({ x: undefined })).toThrow(WorkContractV4Error);
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
    expect(() => canonicalJson("\ud800")).toThrow(/unpaired high surrogate/);
    const sparse = new Array(2); sparse[1] = "x";
    expect(() => canonicalJson(sparse)).toThrow(/sparse array hole/);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(/cycle/);
  });

  it("detects duplicate raw JSON object keys before JSON.parse can erase them", () => {
    expect(() => parseJsonWithoutDuplicateKeys('{"a":1,"a":2}')).toThrow(/duplicate object key/);
    expect(parseJsonWithoutDuplicateKeys('{"a":[1,{"b":true}],"n":null}')).toEqual({ a: [1, { b: true }], n: null });
    const protoKey = parseJsonWithoutDuplicateKeys('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(protoKey, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("node-contract-v4 exhaustive claimant contract", () => {
  it("matches the frozen golden vector", () => {
    const result = digest();
    expect(result.version).toBe(NODE_CONTRACT_HASH_VERSION);
    expect(result.hash).toBe("c683c8cbc9f2021266b7762a563fc3a984452f7a491027db844c167032df4f82");
    expect(sha256Utf8(result.canonical)).toBe("5fbe99a3816529f02d130df731ea3d9f9795535a5bd48311e635d99fb82c0491");
    expect(result.contract.roleEligibility).toEqual(["engineer", "verifier"]);
    expect(result.contract.evidenceRequirements.map((r) => r.id)).toEqual(["commit", "tests"]);
  });

  const includedMutations: Array<[string, (work: WorkItem) => void]> = [
    ["type", (w) => { w.type = "bug"; }],
    ["roleEligibility", (w) => { w.roleEligibility.push("architect"); }],
    ["runbook", (w) => { w.runbook = `${w.runbook}more`; }],
    ["payload", (w) => { w.payload = { z: 3, a: [true, null, "é"] }; }],
    ["targetRef", (w) => { w.targetRef = { kind: "mission", id: "mission-other" }; }],
    ["evidenceRequirements.id", (w) => { w.evidenceRequirements[0].id = "tests2"; }],
    ["evidenceRequirements.kind", (w) => { w.evidenceRequirements[0].kind = "doc"; }],
    ["evidenceRequirements.description", (w) => { w.evidenceRequirements[0].description = "changed"; }],
    ["evidenceRequirements.refResolvable", (w) => { w.evidenceRequirements[0].refResolvable = true; }],
    ["evidenceRequirements.allowPreClaim", (w) => { w.evidenceRequirements[0].allowPreClaim = true; }],
    ["evidenceRequirements.evidenceAuthority", (w) => { w.evidenceRequirements[0].evidenceAuthority = "verifier-attestation"; }],
    ["leaseWindowMs", (w) => { w.leaseWindowMs = 1_800_001; }],
    ["nodeConfig.pulse.interval", (w) => { w.nodeConfig!.pulse!.intervalSeconds = 301; }],
    ["nodeConfig.pulse.message", (w) => { w.nodeConfig!.pulse!.message = "changed"; }],
    ["nodeConfig.pulse.responseShape", (w) => { w.nodeConfig!.pulse!.responseShape = "full_status"; }],
    ["nodeConfig.pulse.missedThreshold", (w) => { w.nodeConfig!.pulse!.missedThreshold = 3; }],
    ["nodeConfig.pulse.firstFireDelay", (w) => { w.nodeConfig!.pulse!.firstFireDelaySeconds = 61; }],
  ];

  for (const [name, mutate] of includedMutations) {
    it(`changes hash when included field ${name} changes`, () => {
      expect(changed(mutate)).not.toBe(digest().hash);
    });
  }

  it("changes hash when a declared reference identity or declared position changes", () => {
    const contentChanged = structuredClone(resolutions);
    (contentChanged[0] as Extract<AuthoritativeReferenceResolutionV4, { storage: "hub-doc" }>).content = "beta\n";
    expect(digest(baseWork(), bound(structuredClone(references), contentChanged)).hash).not.toBe(digest().hash);

    const refsReordered = structuredClone(references);
    const rsReordered = structuredClone(resolutions);
    [refsReordered[0], refsReordered[1]] = [refsReordered[1], refsReordered[0]];
    [rsReordered[0], rsReordered[1]] = [rsReordered[1], rsReordered[0]];
    expect(digest({ ...baseWork(), references: refsReordered }, bound(refsReordered, rsReordered)).hash).not.toBe(digest().hash);
  });

  const excludedMutations: Array<[string, (work: WorkItem) => void]> = [
    ["id", (w) => { w.id = "work-physical-other"; }],
    ["priority", (w) => { w.priority = "low"; }],
    ["dependsOn", (w) => { w.dependsOn.push("other"); }],
    ["completionDependsOn", (w) => { w.completionDependsOn.push("other"); }],
    ["blueprintRunId", (w) => { w.blueprintRunId = "other"; }],
    ["status", (w) => { w.status = "blocked"; }],
    ["lease", (w) => { w.lease!.heartbeatAt = "2030-01-01T00:00:00Z"; }],
    ["evidence", (w) => { w.evidence.push({ requirementId: "tests", kind: "test-run", ref: "run", producedAt: "2026-01-01T00:00:00Z" }); }],
    ["frictionReflections", (w) => { w.frictionReflections.push({ producedAt: "2026-01-01T00:00:00Z", producedBy: "a", sourceVerb: "complete_work", observed: false, summary: "none", categories: [], compatibility: "explicit" }); }],
    ["blockedOn", (w) => { w.blockedOn = { blockerKind: "external", reason: "x" }; }],
    ["leaseExpiryCount", (w) => { w.leaseExpiryCount += 1; }],
    ["enteredCurrentStateAt", (w) => { w.enteredCurrentStateAt = "2030-01-01T00:00:00Z"; }],
    ["stateDurations", (w) => { w.stateDurations.ready += 1; }],
    ["attestationHistory", (w) => { w.attestationHistory = []; }],
    ["attestations", (w) => { w.attestations = {}; }],
    ["executorHistory", (w) => { w.executorHistory.push("other"); }],
    ["createdBy", (w) => { w.createdBy = { role: "engineer", agentId: "other" }; }],
    ["createdAt", (w) => { w.createdAt = "2030-01-01T00:00:00Z"; }],
    ["updatedAt", (w) => { w.updatedAt = "2030-01-01T00:00:00Z"; }],
    ["pulse bookkeeping", (w) => { w.nodeConfig!.pulse!.lastFiredAt = "2030-01-01T00:00:00Z"; w.nodeConfig!.pulse!.missedCount = 44; }],
  ];

  for (const [name, mutate] of excludedMutations) {
    it(`preserves hash when excluded runtime field ${name} changes`, () => {
      expect(changed(mutate)).toBe(digest().hash);
    });
  }

  it("is invariant to declared set order and requirement declaration order", () => {
    expect(changed((w) => { w.roleEligibility.reverse(); w.evidenceRequirements.reverse(); })).toBe(digest().hash);
  });

  it("distinguishes payload null from payload absence", () => {
    const nullPayload = baseWork(); nullPayload.payload = null;
    const absentPayload = baseWork(); delete absentPayload.payload;
    expect(digest(nullPayload).hash).not.toBe(digest(absentPayload).hash);
  });

  it("rejects duplicate declared-set members, duplicate requirement IDs, and unknown fields", () => {
    expect(() => changed((w) => { w.roleEligibility.push("engineer"); })).toThrow(/duplicate/);
    expect(() => changed((w) => { w.evidenceRequirements[1].id = "tests"; })).toThrow(/duplicate/);
    expect(() => deriveNodeContractV4({ ...baseWork(), futureClaimField: true } as any, bound())).toThrow(/unknown_field/);
    expect(() => deriveNodeContractV4({ ...baseWork(), nodeConfig: { pulse: { ...baseWork().nodeConfig!.pulse!, future: true } } } as any, bound())).toThrow(/unknown_field/);
  });
});

describe("storage-specific same-snapshot reference identity", () => {
  it("binds Hub documents by path/resourceVersion/exact UTF-8 bytes/sha in one snapshot", () => {
    const refs = bound();
    expect(refs[0].contentIdentity).toEqual({
      path: HUB_PATH,
      resourceVersion: "42",
      utf8Bytes: 6,
      sha256: sha256Utf8("alpha\n"),
    });
    const byteIdenticalNewRv = structuredClone(resolutions);
    (byteIdenticalNewRv[0] as any).resourceVersion = "43";
    const newer = bound(structuredClone(references), byteIdenticalNewRv);
    expect(referenceIdentityEqual(refs[0].contentIdentity, newer[0].contentIdentity)).toBe(false);
  });

  it("rejects cross-snapshot, path mismatch, and caller-injected precomputed identity", () => {
    const cross = structuredClone(resolutions); (cross[0] as any).snapshotToken = "other";
    expect(() => bound(structuredClone(references), cross)).toThrow(/snapshot_mismatch/);
    const moved = structuredClone(resolutions); (moved[0] as any).path = "docs/other.md";
    expect(() => bound(structuredClone(references), moved)).toThrow(/locator_mismatch/);
    const forged = structuredClone(resolutions); (forged[0] as any).contentIdentity = { sha256: "0".repeat(64) };
    expect(() => bound(structuredClone(references), forged)).toThrow(/unknown_field/);
  });

  it("rejects mutable/short Git locators and binds full commit, repo, path, and blob bytes", () => {
    for (const locator of ["main:hub/src/x.ts", "abcdef1:hub/src/x.ts", "HEAD:hub/src/x.ts"]) {
      const refs = structuredClone(references); refs[1].ref = locator;
      expect(() => bound(refs, structuredClone(resolutions))).toThrow(/mutable_git_ref/);
    }
    const identity = bound()[1].contentIdentity as any;
    expect(identity).toEqual({
      repo: "apnex/agentic-network",
      full40CommitSha: COMMIT,
      path: "hub/src/x.ts",
      blobSha256: sha256Utf8("export {};\n"),
    });
    const wrongRepoRefs = structuredClone(references); wrongRepoRefs[1].ref = `apnex/other@${COMMIT}:hub/src/x.ts`;
    expect(() => bound(wrongRepoRefs, structuredClone(resolutions))).toThrow(/locator_mismatch/);
  });

  it("counts exact inline UTF-8 bytes and invalidates entity identity on version or state drift", () => {
    const refs = bound();
    expect(refs[2].contentIdentity).toEqual({ utf8Bytes: 2, sha256: sha256Utf8("é") });
    const entityRv = structuredClone(resolutions); (entityRv[3] as any).resourceVersion = "100";
    const entityState = structuredClone(resolutions); (entityState[3] as any).state = { status: "completed", title: "M" };
    expect(referenceIdentityEqual(refs[3].contentIdentity, bound(structuredClone(references), entityRv)[3].contentIdentity)).toBe(false);
    expect(referenceIdentityEqual(refs[3].contentIdentity, bound(structuredClone(references), entityState)[3].contentIdentity)).toBe(false);
  });
});

describe("non-recursive node/local/global topology identities", () => {
  const CHILD_CONTRACT = "1".repeat(64);
  const CHILD_TOPOLOGY = "2".repeat(64);

  function target(overrides: Partial<TargetBindingV4> = {}): TargetBindingV4 {
    return {
      edgeClass: "dependsOn",
      targetLogicalId: "child",
      targetPhysicalId: "work-child-r1",
      targetRevision: 1,
      targetNodeContractHashVersion: NODE_CONTRACT_HASH_VERSION,
      targetNodeContractHash: CHILD_CONTRACT,
      ...overrides,
    };
  }

  function local(overrides: Partial<LocalExecutionIdentityV4Input> = {}) {
    const contract = digest();
    const topology = deriveNodeTopologyV4("root", ["child"], ["review"]);
    return deriveLocalExecutionIdentityV4({
      logicalId: "root",
      physicalId: "work-root-r1",
      revision: 1,
      nodeContractHashVersion: NODE_CONTRACT_HASH_VERSION,
      nodeContractHash: contract.hash,
      nodeTopologyHashVersion: NODE_TOPOLOGY_HASH_VERSION,
      nodeTopologyHash: topology.hash,
      outgoingTargetBindings: [target()],
      ...overrides,
    });
  }

  it("sorts own edge sets, rejects duplicates, and freezes a golden node-topology hash", () => {
    const a = deriveNodeTopologyV4("root", ["b", "a"], ["d", "c"]);
    const b = deriveNodeTopologyV4("root", ["a", "b"], ["c", "d"]);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe("cc3eb50fccd2ee8a3f7bc4a2eb62d0e69df516f921410c5a4cc2536cea921015");
    expect(() => deriveNodeTopologyV4("root", ["a", "a"], [])).toThrow(/duplicate/);
  });

  it("invalidates local identity on own contract/topology/direct-target change, never on unrelated generation", () => {
    const baseline = local();
    expect(baseline).toBe("dc5ec652ac883ee1d17f8eb283c2b6378c3c39522f21db8d0057bed96465d48d");
    expect(local({ nodeContractHash: "3".repeat(64) })).not.toBe(baseline);
    expect(local({ nodeTopologyHash: "4".repeat(64) })).not.toBe(baseline);
    expect(local({ outgoingTargetBindings: [target({ targetPhysicalId: "work-child-r2", targetRevision: 2 })] })).not.toBe(baseline);
    // No generation/global-topology input exists: a disconnected generation change is structurally unable to perturb local identity.
    expect(local()).toBe(baseline);
  });

  it("target digest consumes exact direct target binding but not recursive target-local identity", () => {
    const binding = target();
    expect(deriveTargetBindingDigestV4(binding)).toBe("8be8548e4e4890e79b585d0f369ec243e38e286b8325a4283ef4f2f662e59766");
    expect(deriveTargetBindingDigestV4({ ...binding, edgeClass: "completionDependsOn" })).not.toBe(deriveTargetBindingDigestV4(binding));
    expect(Object.keys(binding)).not.toContain("targetLocalExecutionIdentity");
  });

  it("hashes sorted bindings and tagged global edge sets, rejecting duplicate edges", () => {
    const binding: TopologyBindingV4 = {
      physicalId: "work-root-r1",
      revision: 1,
      nodeContractHashVersion: NODE_CONTRACT_HASH_VERSION,
      nodeContractHash: digest().hash,
      nodeTopologyHashVersion: NODE_TOPOLOGY_HASH_VERSION,
      nodeTopologyHash: CHILD_TOPOLOGY,
    };
    const input = {
      generation: 2,
      previousGeneration: 1,
      bindings: { root: binding, child: { ...binding, physicalId: "work-child-r1" } },
      edges: [
        { edgeClass: "completionDependsOn" as const, sourceLogicalId: "root", targetLogicalId: "child" },
        { edgeClass: "dependsOn" as const, sourceLogicalId: "child", targetLogicalId: "root" },
      ],
    };
    const hash = deriveWorkTopologyHashV4(input);
    expect(hash).toBe("06b58198a558cf32e8643f160114c00bcccd1815df92689b6bdabc9447a00514");
    expect(deriveWorkTopologyHashV4({ ...input, bindings: { child: input.bindings.child, root: input.bindings.root }, edges: input.edges.slice().reverse() })).toBe(hash);
    expect(() => deriveWorkTopologyHashV4({ ...input, edges: [input.edges[0], input.edges[0]] })).toThrow(/duplicate/);
  });

  it("exports the explicit local identity version", () => {
    expect(LOCAL_EXECUTION_IDENTITY_VERSION).toBe("local-execution-v4");
  });
});
