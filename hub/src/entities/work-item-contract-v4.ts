/**
 * node-contract-v4 — Mission-140's pure claimant-contract identity foundation.
 *
 * This module deliberately contains no repository writes.  It is the inert first
 * rollout layer: strict RFC-8785-compatible canonical JSON, authoritative
 * storage-specific reference bindings, logical-revision schema types, and the
 * non-recursive contract/topology/local/global hash functions consumed by later
 * storage/currentness slices.
 *
 * Hash framing is domain-separated as UTF-8(domain + NUL + canonical-json).
 * Strings are never Unicode-normalized; malformed surrogate sequences reject.
 */

import { createHash } from "node:crypto";
import type {
  EvidenceAuthority,
  EvidenceKind,
  ReferenceMode,
  ReferenceStorage,
  WorkItem,
  WorkItemReference,
  WorkItemType,
} from "./work-item.js";

export const NODE_CONTRACT_HASH_VERSION = "node-contract-v4" as const;
export const NODE_TOPOLOGY_HASH_VERSION = "node-topology-v4" as const;
export const LOCAL_EXECUTION_IDENTITY_VERSION = "local-execution-v4" as const;
export const TARGET_BINDING_HASH_VERSION = "target-binding-v4" as const;
export const WORK_TOPOLOGY_HASH_VERSION = "work-topology-v4" as const;
export const ENTITY_STATE_HASH_VERSION = "entity-state-v4" as const;

export type Sha256Hex = string;

/** Fields whose values define the claimant's local contract. */
export const NODE_CONTRACT_V4_INCLUDED_FIELDS = Object.freeze([
  "type",
  "roleEligibility",
  "runbook",
  "payload",
  "targetRef",
  "evidenceRequirements",
  "references",
  "leaseWindowMs",
  "nodeConfig",
] as const);

/**
 * Known WorkItem fields which are intentionally NOT claimant-contract inputs.
 * Edges are excluded here because they are covered by node-topology-v4.
 */
export const NODE_CONTRACT_V4_EXCLUDED_FIELDS = Object.freeze([
  "id",
  "priority",
  "dependsOn",
  "completionDependsOn",
  "blueprintRunId",
  "status",
  "lease",
  "evidence",
  "frictionReflections",
  "blockedOn",
  "leaseExpiryCount",
  "enteredCurrentStateAt",
  "stateDurations",
  "attestationHistory",
  "attestations",
  "executorHistory",
  // Mission-140 storage/currentness identity. These fields bind the physical
  // row to an already-derived contract/topology; they are outputs of this hash,
  // never recursive inputs to it.
  "logicalId",
  "revision",
  "predecessorPhysicalId",
  "revisedBy",
  "revisionReason",
  "revisionGeneration",
  "nodeContractHashVersion",
  "nodeContractHash",
  "nodeTopologyHashVersion",
  "nodeTopologyHash",
  "boundReferences",
  "localExecutionIdentity",
  "topologyGeneration",
  "observedTopologyGeneration",
  "observedTopologyHash",
  "recallHistory",
  "pendingRecallIntents",
  "recallNoticePending",
  "createdBy",
  "createdAt",
  "updatedAt",
] as const);

const KNOWN_WORK_ITEM_FIELDS = new Set<string>([
  ...NODE_CONTRACT_V4_INCLUDED_FIELDS,
  ...NODE_CONTRACT_V4_EXCLUDED_FIELDS,
]);

const EVIDENCE_KINDS = new Set<EvidenceKind>([
  "commit", "pr", "audit", "review", "test-run", "doc", "freeform",
]);
const WORK_ITEM_TYPES = new Set<WorkItemType>([
  "task", "bug", "review", "verifier-gate", "freeform",
]);
const REFERENCE_STORAGES = new Set<ReferenceStorage>(["inline", "git", "hub-doc", "entity"]);
const REFERENCE_MODES = new Set<ReferenceMode>(["read", "triangulate-against"]);
const EVIDENCE_AUTHORITIES = new Set<EvidenceAuthority>(["executor-evidence", "verifier-attestation"]);
const PULSE_RESPONSE_SHAPES = new Set(["ack", "short_status", "full_status"]);
const SHA256_RE = /^[0-9a-f]{64}$/;
const FULL_COMMIT_RE = /^[0-9a-f]{40}$/;
const RESOURCE_VERSION_RE = /^[0-9]+$/;

export class WorkContractV4Error extends Error {
  constructor(
    public readonly code:
      | "canonical.invalid"
      | "schema.unknown_field"
      | "schema.invalid"
      | "schema.duplicate_set_member"
      | "reference.content_identity_unavailable"
      | "reference.snapshot_mismatch"
      | "reference.locator_mismatch"
      | "reference.mutable_git_ref"
      | "hash.input_invalid",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "WorkContractV4Error";
  }
}

function fail(code: WorkContractV4Error["code"], message: string): never {
  throw new WorkContractV4Error(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertExactKeys(value: unknown, allowed: readonly string[], path: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) fail("schema.invalid", `${path} must be a plain object`);
  const permitted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!permitted.has(key)) fail("schema.unknown_field", `${path}.${key} is not admitted by node-contract-v4`);
  }
}

function assertString(value: unknown, path: string, allowEmpty = false): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    fail("schema.invalid", `${path} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  assertWellFormedUnicode(value, path);
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") fail("schema.invalid", `${path} must be boolean`);
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail("schema.invalid", `${path} must be a positive safe integer`);
  }
}

function assertNonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("schema.invalid", `${path} must be a non-negative safe integer`);
  }
}

function assertSha256(value: unknown, path: string): asserts value is Sha256Hex {
  if (typeof value !== "string" || !SHA256_RE.test(value)) fail("schema.invalid", `${path} must be lowercase sha256 hex`);
}

function assertResourceVersion(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !RESOURCE_VERSION_RE.test(value)) {
    fail("schema.invalid", `${path} must be an unsigned decimal resourceVersion string`);
  }
}

function assertUnique(values: readonly string[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail("schema.duplicate_set_member", `${path} contains duplicate '${value}' before canonical sorting`);
    seen.add(value);
  }
}

function sortedUniqueStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail("schema.invalid", `${path} must be an array`);
  const strings = value.map((entry, index) => {
    assertString(entry, `${path}[${index}]`);
    return entry;
  });
  assertUnique(strings, path);
  return strings.slice().sort();
}

/** Reject unpaired UTF-16 surrogates. RFC 8785 requires valid Unicode data. */
export function assertWellFormedUnicode(value: string, path = "string"): void {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("canonical.invalid", `${path} contains an unpaired high surrogate at UTF-16 index ${i}`);
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("canonical.invalid", `${path} contains an unpaired low surrogate at UTF-16 index ${i}`);
    }
  }
}

function canonicalize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertWellFormedUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical.invalid", `${path} contains a non-finite number`);
    // JSON.stringify implements ECMAScript Number serialization used by RFC 8785,
    // including canonical -0 => 0.
    return JSON.stringify(value);
  }
  if (typeof value === "undefined") fail("canonical.invalid", `${path} contains undefined`);
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    fail("canonical.invalid", `${path} contains unsupported ${typeof value}`);
  }
  if (typeof value !== "object") fail("canonical.invalid", `${path} is not JSON data`);
  if (seen.has(value)) fail("canonical.invalid", `${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        if (!own(value, String(i))) fail("canonical.invalid", `${path} contains a sparse array hole at index ${i}`);
      }
      return `[${value.map((entry, index) => canonicalize(entry, `${path}[${index}]`, seen)).join(",")}]`;
    }
    if (!isPlainObject(value)) fail("canonical.invalid", `${path} must be a plain JSON object`);
    const keys = Object.keys(value).sort(); // RFC 8785 / ECMAScript UTF-16 code-unit order.
    return `{${keys.map((key) => {
      assertWellFormedUnicode(key, `${path} key`);
      return `${JSON.stringify(key)}:${canonicalize(value[key], `${path}.${key}`, seen)}`;
    }).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

/** RFC-8785-compatible canonical JSON for already-decoded JSON data. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, "$", new Set<object>());
}

/**
 * Strict JSON parser used at raw boundaries where native JSON.parse would erase
 * duplicate object keys before the contract validator could reject them.
 */
export function parseJsonWithoutDuplicateKeys(text: string): unknown {
  let i = 0;
  const whitespace = () => { while (i < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[i])) i += 1; };
  const stringToken = (): string => {
    if (text[i] !== '"') fail("canonical.invalid", `expected string at byte/character offset ${i}`);
    const start = i;
    i += 1;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i += 1;
        let decoded: unknown;
        try { decoded = JSON.parse(text.slice(start, i)); } catch { fail("canonical.invalid", `invalid JSON string at offset ${start}`); }
        assertString(decoded, `JSON string at offset ${start}`, true);
        return decoded;
      }
      if (c === "\\") {
        i += 1;
        if (i >= text.length) fail("canonical.invalid", `unterminated escape at offset ${i}`);
        if (text[i] === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail("canonical.invalid", `invalid unicode escape at offset ${i}`);
          i += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(text[i])) fail("canonical.invalid", `invalid escape at offset ${i}`);
        i += 1;
        continue;
      }
      if (c.charCodeAt(0) < 0x20) fail("canonical.invalid", `unescaped control character at offset ${i}`);
      i += 1;
    }
    fail("canonical.invalid", `unterminated JSON string at offset ${start}`);
  };
  const value = (): unknown => {
    whitespace();
    if (text[i] === '"') return stringToken();
    if (text[i] === "{") {
      i += 1;
      whitespace();
      const out: Record<string, unknown> = {};
      const keys = new Set<string>();
      if (text[i] === "}") { i += 1; return out; }
      while (true) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) fail("canonical.invalid", `duplicate object key '${key}' at offset ${i}`);
        keys.add(key);
        whitespace();
        if (text[i] !== ":") fail("canonical.invalid", `expected ':' at offset ${i}`);
        i += 1;
        // defineProperty avoids the legacy __proto__ setter: parsed JSON keys are
        // inert data, never a prototype-mutation channel.
        Object.defineProperty(out, key, {
          value: value(), enumerable: true, configurable: true, writable: true,
        });
        whitespace();
        if (text[i] === "}") { i += 1; return out; }
        if (text[i] !== ",") fail("canonical.invalid", `expected ',' or '}' at offset ${i}`);
        i += 1;
      }
    }
    if (text[i] === "[") {
      i += 1;
      whitespace();
      const out: unknown[] = [];
      if (text[i] === "]") { i += 1; return out; }
      while (true) {
        out.push(value());
        whitespace();
        if (text[i] === "]") { i += 1; return out; }
        if (text[i] !== ",") fail("canonical.invalid", `expected ',' or ']' at offset ${i}`);
        i += 1;
      }
    }
    const rest = text.slice(i);
    if (rest.startsWith("true")) { i += 4; return true; }
    if (rest.startsWith("false")) { i += 5; return false; }
    if (rest.startsWith("null")) { i += 4; return null; }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (match) {
      i += match[0].length;
      const n = Number(match[0]);
      if (!Number.isFinite(n)) fail("canonical.invalid", `non-finite JSON number at offset ${i - match[0].length}`);
      return n;
    }
    fail("canonical.invalid", `unexpected token at offset ${i}`);
  };
  const parsed = value();
  whitespace();
  if (i !== text.length) fail("canonical.invalid", `trailing JSON data at offset ${i}`);
  return parsed;
}

export function sha256Utf8(value: string): Sha256Hex {
  assertWellFormedUnicode(value);
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashCanonicalDomain(domain: string, value: unknown): Sha256Hex {
  assertString(domain, "hash domain");
  return createHash("sha256")
    .update(domain, "utf8")
    .update(Buffer.from([0]))
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function exactUtf8Bytes(value: string | Uint8Array, path: string): Buffer {
  if (typeof value === "string") {
    assertWellFormedUnicode(value, path);
    return Buffer.from(value, "utf8");
  }
  if (!(value instanceof Uint8Array)) fail("schema.invalid", `${path} must be exact UTF-8 content`);
  const bytes = Buffer.from(value);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("canonical.invalid", `${path} is not valid UTF-8`);
  }
  return bytes;
}

export interface HubDocumentContentIdentityV4 {
  path: string;
  resourceVersion: string;
  utf8Bytes: number;
  sha256: Sha256Hex;
}
export interface GitContentIdentityV4 {
  repo: string;
  full40CommitSha: string;
  path: string;
  blobSha256: Sha256Hex;
}
export interface InlineContentIdentityV4 {
  utf8Bytes: number;
  sha256: Sha256Hex;
}
export interface EntityContentIdentityV4 {
  kind: string;
  id: string;
  resourceVersion: string;
  stateHash: Sha256Hex;
}
export type ReferenceContentIdentityV4 =
  | HubDocumentContentIdentityV4
  | GitContentIdentityV4
  | InlineContentIdentityV4
  | EntityContentIdentityV4;

export interface BoundWorkItemReferenceV4 {
  kind: string;
  storage: ReferenceStorage;
  mode: ReferenceMode;
  required: boolean;
  locator: string;
  contentIdentity: ReferenceContentIdentityV4;
}

/** Inputs must come from an authoritative resolver; hashes are recomputed here. */
export type AuthoritativeReferenceResolutionV4 =
  | { storage: "hub-doc"; path: string; resourceVersion: string; content: string | Uint8Array; snapshotToken: string }
  | { storage: "git"; repo: string; full40CommitSha: string; path: string; content: string | Uint8Array }
  | { storage: "inline" }
  | { storage: "entity"; kind: string; id: string; resourceVersion: string; state: unknown; snapshotToken: string };

function parseGitLocator(locator: string): { repo?: string; commit: string; path: string } {
  // Existing WorkItem refs admit sha[:path].  node-contract-v4 additionally
  // supports repo@sha:path; the authoritative resolver always supplies repo.
  const withRepo = /^(?<repo>[^@\s]+)@(?<commit>[0-9a-f]{40}):(?<path>.+)$/.exec(locator);
  if (withRepo?.groups) return { repo: withRepo.groups.repo, commit: withRepo.groups.commit, path: withRepo.groups.path };
  const plain = /^(?<commit>[0-9a-f]{40}):(?<path>.+)$/.exec(locator);
  if (plain?.groups) return { commit: plain.groups.commit, path: plain.groups.path };
  fail("reference.mutable_git_ref", `git locator '${locator}' must pin a lowercase full-40 commit and path`);
}

function assertReferenceShape(ref: WorkItemReference, path: string): void {
  assertExactKeys(ref, ["kind", "ref", "storage", "mode", "required"], path);
  assertString(ref.kind, `${path}.kind`);
  assertString(ref.ref, `${path}.ref`, ref.storage === "inline");
  if (!REFERENCE_STORAGES.has(ref.storage)) fail("schema.invalid", `${path}.storage is invalid`);
  if (!REFERENCE_MODES.has(ref.mode)) fail("schema.invalid", `${path}.mode is invalid`);
  assertBoolean(ref.required, `${path}.required`);
}

function assertResolutionShape(resolution: AuthoritativeReferenceResolutionV4, path: string): void {
  if (!isPlainObject(resolution)) fail("reference.content_identity_unavailable", `${path} must be an authoritative resolution object`);
  switch (resolution.storage) {
    case "hub-doc":
      assertExactKeys(resolution, ["storage", "path", "resourceVersion", "content", "snapshotToken"], path);
      break;
    case "git":
      assertExactKeys(resolution, ["storage", "repo", "full40CommitSha", "path", "content"], path);
      break;
    case "inline":
      assertExactKeys(resolution, ["storage"], path);
      break;
    case "entity":
      assertExactKeys(resolution, ["storage", "kind", "id", "resourceVersion", "state", "snapshotToken"], path);
      break;
    default:
      fail("reference.content_identity_unavailable", `${path}.storage is missing or unsupported`);
  }
}

/**
 * Freeze all references from one authoring snapshot. Mutable Hub/entity refs
 * must carry the exact transaction token supplied by the caller; identity
 * digests are computed from the returned content/state, never accepted from a
 * caller-provided precomputed hash.
 */
export function bindWorkItemReferencesV4(
  references: readonly WorkItemReference[],
  resolutions: readonly AuthoritativeReferenceResolutionV4[],
  snapshotToken: string,
): BoundWorkItemReferenceV4[] {
  assertString(snapshotToken, "snapshotToken");
  if (references.length !== resolutions.length) {
    fail("reference.content_identity_unavailable", `reference/resolution length mismatch (${references.length}/${resolutions.length})`);
  }
  return references.map((reference, index) => {
    const path = `references[${index}]`;
    assertReferenceShape(reference, path);
    const resolution = resolutions[index];
    assertResolutionShape(resolution, `resolutions[${index}]`);
    if (reference.storage !== resolution.storage) {
      fail("reference.locator_mismatch", `${path}.storage=${reference.storage} but resolution storage=${resolution.storage}`);
    }
    let contentIdentity: ReferenceContentIdentityV4;
    switch (resolution.storage) {
      case "hub-doc": {
        assertString(resolution.path, `resolutions[${index}].path`);
        assertResourceVersion(resolution.resourceVersion, `resolutions[${index}].resourceVersion`);
        assertString(resolution.snapshotToken, `resolutions[${index}].snapshotToken`);
        if (resolution.snapshotToken !== snapshotToken) {
          fail("reference.snapshot_mismatch", `${path} was resolved in snapshot '${resolution.snapshotToken}', expected '${snapshotToken}'`);
        }
        if (reference.ref !== resolution.path) {
          fail("reference.locator_mismatch", `${path} locator '${reference.ref}' != authoritative path '${resolution.path}'`);
        }
        const bytes = exactUtf8Bytes(resolution.content, `resolutions[${index}].content`);
        contentIdentity = {
          path: resolution.path,
          resourceVersion: resolution.resourceVersion,
          utf8Bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
        break;
      }
      case "git": {
        assertString(resolution.repo, `resolutions[${index}].repo`);
        if (!FULL_COMMIT_RE.test(resolution.full40CommitSha)) {
          fail("reference.mutable_git_ref", `${path} authoritative commit must be lowercase full-40 SHA`);
        }
        assertString(resolution.path, `resolutions[${index}].path`);
        const locator = parseGitLocator(reference.ref);
        if (locator.repo !== undefined && locator.repo !== resolution.repo) {
          fail("reference.locator_mismatch", `${path} repo '${locator.repo}' != authoritative repo '${resolution.repo}'`);
        }
        if (locator.commit !== resolution.full40CommitSha || locator.path !== resolution.path) {
          fail("reference.locator_mismatch", `${path} git locator does not match authoritative commit/path`);
        }
        const bytes = exactUtf8Bytes(resolution.content, `resolutions[${index}].content`);
        contentIdentity = {
          repo: resolution.repo,
          full40CommitSha: resolution.full40CommitSha,
          path: resolution.path,
          blobSha256: createHash("sha256").update(bytes).digest("hex"),
        };
        break;
      }
      case "inline": {
        const bytes = exactUtf8Bytes(reference.ref, path);
        contentIdentity = {
          utf8Bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
        break;
      }
      case "entity": {
        assertString(resolution.kind, `resolutions[${index}].kind`);
        assertString(resolution.id, `resolutions[${index}].id`);
        assertResourceVersion(resolution.resourceVersion, `resolutions[${index}].resourceVersion`);
        assertString(resolution.snapshotToken, `resolutions[${index}].snapshotToken`);
        if (resolution.snapshotToken !== snapshotToken) {
          fail("reference.snapshot_mismatch", `${path} was resolved in snapshot '${resolution.snapshotToken}', expected '${snapshotToken}'`);
        }
        if (reference.kind !== resolution.kind || reference.ref !== resolution.id) {
          fail("reference.locator_mismatch", `${path} entity locator ${reference.kind}/${reference.ref} != authoritative ${resolution.kind}/${resolution.id}`);
        }
        contentIdentity = {
          kind: resolution.kind,
          id: resolution.id,
          resourceVersion: resolution.resourceVersion,
          stateHash: hashCanonicalDomain(ENTITY_STATE_HASH_VERSION, resolution.state),
        };
        break;
      }
    }
    return {
      kind: reference.kind,
      storage: reference.storage,
      mode: reference.mode,
      required: reference.required,
      locator: reference.ref,
      contentIdentity,
    };
  });
}

export function referenceIdentityEqual(a: ReferenceContentIdentityV4, b: ReferenceContentIdentityV4): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

interface CanonicalEvidenceRequirementV4 {
  id: string;
  kind: EvidenceKind;
  descriptionUtf8Sha256: Sha256Hex | null;
  refResolvable: boolean;
  allowPreClaim: boolean;
  evidenceAuthority: EvidenceAuthority;
}

interface CanonicalPulseV4 {
  intervalSeconds: number;
  messageUtf8Sha256: Sha256Hex;
  responseShape: "ack" | "short_status" | "full_status";
  missedThreshold: number;
  firstFireDelaySeconds: number | null;
}

export interface CanonicalNodeContractV4 {
  type: WorkItemType;
  roleEligibility: string[];
  runbookUtf8Sha256: Sha256Hex | null;
  payloadCanonicalSha256: Sha256Hex | null;
  targetRef: { kind: string; id: string } | null;
  evidenceRequirements: CanonicalEvidenceRequirementV4[];
  references: BoundWorkItemReferenceV4[];
  leaseWindowMs: number | null;
  nodeConfig: null | { pulse: CanonicalPulseV4 | null };
}

export interface NodeContractV4Digest {
  version: typeof NODE_CONTRACT_HASH_VERSION;
  contract: CanonicalNodeContractV4;
  canonical: string;
  hash: Sha256Hex;
}

function canonicalEvidenceRequirements(value: unknown): CanonicalEvidenceRequirementV4[] {
  if (!Array.isArray(value)) fail("schema.invalid", "evidenceRequirements must be an array");
  const ids: string[] = [];
  const requirements = value.map((raw, index) => {
    const path = `evidenceRequirements[${index}]`;
    assertExactKeys(raw, ["id", "kind", "description", "refResolvable", "allowPreClaim", "evidenceAuthority"], path);
    assertString(raw.id, `${path}.id`);
    ids.push(raw.id);
    if (typeof raw.kind !== "string" || !EVIDENCE_KINDS.has(raw.kind as EvidenceKind)) {
      fail("schema.invalid", `${path}.kind is invalid`);
    }
    if (own(raw, "description") && raw.description !== undefined) assertString(raw.description, `${path}.description`, true);
    if (own(raw, "refResolvable") && raw.refResolvable !== undefined) assertBoolean(raw.refResolvable, `${path}.refResolvable`);
    if (own(raw, "allowPreClaim") && raw.allowPreClaim !== undefined) assertBoolean(raw.allowPreClaim, `${path}.allowPreClaim`);
    if (own(raw, "evidenceAuthority") && raw.evidenceAuthority !== undefined &&
        (typeof raw.evidenceAuthority !== "string" || !EVIDENCE_AUTHORITIES.has(raw.evidenceAuthority as EvidenceAuthority))) {
      fail("schema.invalid", `${path}.evidenceAuthority is invalid`);
    }
    return {
      id: raw.id,
      kind: raw.kind as EvidenceKind,
      descriptionUtf8Sha256: typeof raw.description === "string" ? sha256Utf8(raw.description) : null,
      refResolvable: raw.refResolvable === true,
      allowPreClaim: raw.allowPreClaim === true,
      evidenceAuthority: (raw.evidenceAuthority as EvidenceAuthority | undefined) ?? "executor-evidence",
    };
  });
  assertUnique(ids, "evidenceRequirements.id");
  // Never localeCompare: canonical order must not depend on host ICU/locale.
  return requirements.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function canonicalTargetRef(value: unknown): { kind: string; id: string } | null {
  if (value === null) return null;
  assertExactKeys(value, ["kind", "id"], "targetRef");
  assertString(value.kind, "targetRef.kind");
  assertString(value.id, "targetRef.id");
  return { kind: value.kind, id: value.id };
}

function canonicalNodeConfig(value: unknown): CanonicalNodeContractV4["nodeConfig"] {
  if (value === undefined || value === null) return null;
  assertExactKeys(value, ["pulse"], "nodeConfig");
  if (value.pulse === undefined || value.pulse === null) return { pulse: null };
  const pulse = value.pulse;
  // Sweeper bookkeeping is known runtime state and intentionally excluded.
  assertExactKeys(pulse, [
    "intervalSeconds", "message", "responseShape", "missedThreshold", "firstFireDelaySeconds",
    "lastFiredAt", "lastResponseAt", "missedCount", "lastEscalatedAt",
  ], "nodeConfig.pulse");
  assertPositiveInteger(pulse.intervalSeconds, "nodeConfig.pulse.intervalSeconds");
  assertString(pulse.message, "nodeConfig.pulse.message", true);
  if (typeof pulse.responseShape !== "string" || !PULSE_RESPONSE_SHAPES.has(pulse.responseShape)) {
    fail("schema.invalid", "nodeConfig.pulse.responseShape is invalid");
  }
  assertPositiveInteger(pulse.missedThreshold, "nodeConfig.pulse.missedThreshold");
  if (own(pulse, "firstFireDelaySeconds") && pulse.firstFireDelaySeconds !== undefined) {
    assertNonNegativeInteger(pulse.firstFireDelaySeconds, "nodeConfig.pulse.firstFireDelaySeconds");
  }
  return {
    pulse: {
      intervalSeconds: pulse.intervalSeconds,
      messageUtf8Sha256: sha256Utf8(pulse.message),
      responseShape: pulse.responseShape as CanonicalPulseV4["responseShape"],
      missedThreshold: pulse.missedThreshold,
      firstFireDelaySeconds: typeof pulse.firstFireDelaySeconds === "number" ? pulse.firstFireDelaySeconds : null,
    },
  };
}

function assertBoundReferenceMatches(
  source: WorkItemReference,
  bound: BoundWorkItemReferenceV4,
  index: number,
): void {
  const path = `boundReferences[${index}]`;
  assertExactKeys(bound, ["kind", "storage", "mode", "required", "locator", "contentIdentity"], path);
  if (bound.kind !== source.kind || bound.storage !== source.storage || bound.mode !== source.mode ||
      bound.required !== source.required || bound.locator !== source.ref) {
    fail("reference.locator_mismatch", `${path} does not bind references[${index}] exactly`);
  }
  // Canonicalization validates nested identity data, while shape validation prevents
  // unknown/caller-injected identity fields for each storage class.
  switch (source.storage) {
    case "hub-doc":
      assertExactKeys(bound.contentIdentity, ["path", "resourceVersion", "utf8Bytes", "sha256"], `${path}.contentIdentity`);
      assertString(bound.contentIdentity.path, `${path}.contentIdentity.path`);
      assertResourceVersion(bound.contentIdentity.resourceVersion, `${path}.contentIdentity.resourceVersion`);
      assertNonNegativeInteger(bound.contentIdentity.utf8Bytes, `${path}.contentIdentity.utf8Bytes`);
      assertSha256(bound.contentIdentity.sha256, `${path}.contentIdentity.sha256`);
      if (bound.contentIdentity.path !== source.ref) fail("reference.locator_mismatch", `${path} hub-doc identity path mismatch`);
      break;
    case "git":
      assertExactKeys(bound.contentIdentity, ["repo", "full40CommitSha", "path", "blobSha256"], `${path}.contentIdentity`);
      assertString(bound.contentIdentity.repo, `${path}.contentIdentity.repo`);
      if (typeof bound.contentIdentity.full40CommitSha !== "string" || !FULL_COMMIT_RE.test(bound.contentIdentity.full40CommitSha)) {
        fail("reference.mutable_git_ref", `${path}.contentIdentity.full40CommitSha must be full-40`);
      }
      assertString(bound.contentIdentity.path, `${path}.contentIdentity.path`);
      assertSha256(bound.contentIdentity.blobSha256, `${path}.contentIdentity.blobSha256`);
      break;
    case "inline":
      assertExactKeys(bound.contentIdentity, ["utf8Bytes", "sha256"], `${path}.contentIdentity`);
      assertNonNegativeInteger(bound.contentIdentity.utf8Bytes, `${path}.contentIdentity.utf8Bytes`);
      assertSha256(bound.contentIdentity.sha256, `${path}.contentIdentity.sha256`);
      break;
    case "entity":
      assertExactKeys(bound.contentIdentity, ["kind", "id", "resourceVersion", "stateHash"], `${path}.contentIdentity`);
      assertString(bound.contentIdentity.kind, `${path}.contentIdentity.kind`);
      assertString(bound.contentIdentity.id, `${path}.contentIdentity.id`);
      assertResourceVersion(bound.contentIdentity.resourceVersion, `${path}.contentIdentity.resourceVersion`);
      assertSha256(bound.contentIdentity.stateHash, `${path}.contentIdentity.stateHash`);
      if (bound.contentIdentity.kind !== source.kind || bound.contentIdentity.id !== source.ref) {
        fail("reference.locator_mismatch", `${path} entity identity mismatch`);
      }
      break;
  }
}

/** Derive the exhaustive claimant-significant node-contract-v4 digest. */
export function deriveNodeContractV4(
  workItem: Pick<WorkItem,
    "type" | "roleEligibility" | "runbook" | "payload" | "targetRef" |
    "evidenceRequirements" | "references" | "leaseWindowMs" | "nodeConfig"
  > & Partial<WorkItem>,
  boundReferences: readonly BoundWorkItemReferenceV4[],
): NodeContractV4Digest {
  if (!isPlainObject(workItem)) fail("schema.invalid", "workItem must be a plain object");
  for (const key of Object.keys(workItem)) {
    if (!KNOWN_WORK_ITEM_FIELDS.has(key)) fail("schema.unknown_field", `workItem.${key} is not classified by node-contract-v4`);
  }
  if (typeof workItem.type !== "string" || !WORK_ITEM_TYPES.has(workItem.type)) fail("schema.invalid", "workItem.type is invalid");
  const roles = sortedUniqueStrings(workItem.roleEligibility, "roleEligibility");
  if (workItem.runbook !== undefined) assertString(workItem.runbook, "runbook", true);
  const refs = workItem.references ?? [];
  if (!Array.isArray(refs)) fail("schema.invalid", "references must be an array");
  refs.forEach((ref, index) => assertReferenceShape(ref, `references[${index}]`));
  if (refs.length !== boundReferences.length) {
    fail("reference.content_identity_unavailable", `references/boundReferences length mismatch (${refs.length}/${boundReferences.length})`);
  }
  refs.forEach((ref, index) => assertBoundReferenceMatches(ref, boundReferences[index], index));
  if (workItem.leaseWindowMs !== undefined) assertPositiveInteger(workItem.leaseWindowMs, "leaseWindowMs");
  const contract: CanonicalNodeContractV4 = {
    type: workItem.type,
    roleEligibility: roles,
    runbookUtf8Sha256: typeof workItem.runbook === "string" ? sha256Utf8(workItem.runbook) : null,
    payloadCanonicalSha256: own(workItem, "payload") && workItem.payload !== undefined
      ? hashCanonicalDomain("payload-canonical-v4", workItem.payload)
      : null,
    targetRef: canonicalTargetRef(workItem.targetRef ?? null),
    evidenceRequirements: canonicalEvidenceRequirements(workItem.evidenceRequirements),
    references: boundReferences.map((ref) => ({ ...ref })),
    leaseWindowMs: workItem.leaseWindowMs ?? null,
    nodeConfig: canonicalNodeConfig(workItem.nodeConfig),
  };
  const canonical = canonicalJson(contract);
  return {
    version: NODE_CONTRACT_HASH_VERSION,
    contract,
    canonical,
    hash: hashCanonicalDomain(NODE_CONTRACT_HASH_VERSION, contract),
  };
}

export interface ActorStampV4 { role: string; agentId: string }
export interface WorkRevisionFamilyV4 {
  logicalId: string;
  originPhysicalId: string;
  latestAllocatedRevision: number;
  originalCreatedBy: ActorStampV4;
  familyScope: { kind: "mission" | "standalone"; id: string };
  createdAt: string;
}
export interface RecallLeaseSnapshotV4 {
  holder: string;
  claimedAt: string;
  expiresAt: string;
  heartbeatAt: string;
  /** Domain-separated fingerprint only — the bearer token is never persisted in history/notices. */
  tokenFingerprint: Sha256Hex;
}
export interface RecallBeforeStateV4 {
  physicalId: string;
  logicalId: string;
  revision: number;
  topologyGeneration: number | null;
  phase: "ready" | "claimed" | "in_progress" | "blocked";
  resourceVersion: string;
  stateHash: Sha256Hex;
  blockedOn: null | { blockerKind: string; blockerIds: string[]; reason: string };
  lease: RecallLeaseSnapshotV4 | null;
}
export interface FrozenRecallAuthorityV4 {
  /** The exact claimant/topology authority frozen by pause, recomputed from persisted fields. */
  version: "frozen-recall-authority-v4";
  mode: "legacy" | "generation";
  logicalId: string;
  physicalId: string;
  revision: number;
  /** Active head generation, not the row's first-materialization generation. */
  generation: number | null;
  nodeContractHash: Sha256Hex;
  nodeTopologyHash: Sha256Hex;
  dependsOnLogicalIds: string[];
  completionDependsOnLogicalIds: string[];
  localExecutionIdentity: Sha256Hex | null;
  authorityHash: Sha256Hex;
}
export interface RecallHistoryEntryV4 {
  operationId: string;
  requestHash: Sha256Hex;
  actor: ActorStampV4;
  reason: string;
  recalledAt: string;
  beforeStateHash: Sha256Hex;
  before: RecallBeforeStateV4;
  /** Optional only for backward decode. New pauses always persist it; unpause fails closed without it. */
  frozenAuthority?: FrozenRecallAuthorityV4;
  holderNoticeIntentId: string | null;
}
export interface PendingRecallIntentV4 {
  intentId: string;
  operationId: string;
  /**
   * THE RECIPIENT ROUTING KEY. `recall-notice-projector.ts` sends to
   * `target: { agentId: intent.exactHolderAgentId }`, so this field decides who is notified.
   *
   * 🔴 work-540: FOR AN AUTHOR NOTICE THIS CARRIES THE AUTHOR, NOT A HOLDER. The name predates the
   * author channel and is now narrower than the field's meaning — read `recipientKind` to know which
   * you are looking at. Renaming it would touch a REQUIRED, INDEXED storage field
   * (`workrevnotice_spec_holder_idx`) for a cosmetic gain, so the name stays and the ambiguity is
   * resolved by an explicit discriminator instead of by a reader's assumption.
   */
  exactHolderAgentId: string;
  /**
   * work-540: which channel produced this intent. `"holder"` when the row had a live lease (the
   * pre-existing behaviour, and the default when absent so every already-persisted intent reads
   * correctly); `"author"` for the notice sent to `createdBy.agentId`.
   *
   * The author notice exists because THE HOLDER CHANNEL CANNOT COVER A ROW WITH NO HOLDER — a row
   * suspended from `ready` has nobody to notify, which is the case the Director asked for.
   */
  recipientKind?: "holder" | "author";
  beforeStateHash: Sha256Hex;
  createdAt: string;
  projectedMessageId: string | null;
  projectedAt: string | null;
}
export interface RevisionFieldsV4 {
  logicalId: string;
  revision: number;
  predecessorPhysicalId?: string;
  revisedBy?: ActorStampV4;
  revisionReason?: string;
  revisionGeneration?: number;
  nodeContractHashVersion: typeof NODE_CONTRACT_HASH_VERSION;
  nodeContractHash: Sha256Hex;
  nodeTopologyHashVersion: typeof NODE_TOPOLOGY_HASH_VERSION;
  nodeTopologyHash: Sha256Hex;
  recallHistory: RecallHistoryEntryV4[];
  pendingRecallIntents: PendingRecallIntentV4[];
}

export interface NodeTopologyV4Digest {
  version: typeof NODE_TOPOLOGY_HASH_VERSION;
  topology: { logicalId: string; dependsOn: string[]; completionDependsOn: string[] };
  hash: Sha256Hex;
}

export function deriveNodeTopologyV4(
  logicalId: string,
  dependsOn: readonly string[],
  completionDependsOn: readonly string[],
): NodeTopologyV4Digest {
  assertString(logicalId, "logicalId");
  const start = sortedUniqueStrings(dependsOn, "dependsOn");
  const completion = sortedUniqueStrings(completionDependsOn, "completionDependsOn");
  const topology = { logicalId, dependsOn: start, completionDependsOn: completion };
  return { version: NODE_TOPOLOGY_HASH_VERSION, topology, hash: hashCanonicalDomain(NODE_TOPOLOGY_HASH_VERSION, topology) };
}

export type EdgeClassV4 = "dependsOn" | "completionDependsOn";
export interface TargetBindingV4 {
  edgeClass: EdgeClassV4;
  targetLogicalId: string;
  targetPhysicalId: string;
  targetRevision: number;
  targetNodeContractHashVersion: typeof NODE_CONTRACT_HASH_VERSION;
  targetNodeContractHash: Sha256Hex;
}

export function deriveTargetBindingDigestV4(binding: TargetBindingV4): Sha256Hex {
  assertExactKeys(binding, [
    "edgeClass", "targetLogicalId", "targetPhysicalId", "targetRevision",
    "targetNodeContractHashVersion", "targetNodeContractHash",
  ], "targetBinding");
  if (binding.edgeClass !== "dependsOn" && binding.edgeClass !== "completionDependsOn") fail("hash.input_invalid", "targetBinding.edgeClass is invalid");
  assertString(binding.targetLogicalId, "targetBinding.targetLogicalId");
  assertString(binding.targetPhysicalId, "targetBinding.targetPhysicalId");
  assertPositiveInteger(binding.targetRevision, "targetBinding.targetRevision");
  if (binding.targetNodeContractHashVersion !== NODE_CONTRACT_HASH_VERSION) fail("hash.input_invalid", "target contract hash version is not node-contract-v4");
  assertSha256(binding.targetNodeContractHash, "targetBinding.targetNodeContractHash");
  return hashCanonicalDomain(TARGET_BINDING_HASH_VERSION, binding);
}

export interface LocalExecutionIdentityV4Input {
  logicalId: string;
  physicalId: string;
  revision: number;
  nodeContractHashVersion: typeof NODE_CONTRACT_HASH_VERSION;
  nodeContractHash: Sha256Hex;
  nodeTopologyHashVersion: typeof NODE_TOPOLOGY_HASH_VERSION;
  nodeTopologyHash: Sha256Hex;
  outgoingTargetBindings: TargetBindingV4[];
}

export function deriveLocalExecutionIdentityV4(input: LocalExecutionIdentityV4Input): Sha256Hex {
  assertExactKeys(input, [
    "logicalId", "physicalId", "revision", "nodeContractHashVersion", "nodeContractHash",
    "nodeTopologyHashVersion", "nodeTopologyHash", "outgoingTargetBindings",
  ], "localExecutionIdentity");
  assertString(input.logicalId, "localExecutionIdentity.logicalId");
  assertString(input.physicalId, "localExecutionIdentity.physicalId");
  assertPositiveInteger(input.revision, "localExecutionIdentity.revision");
  if (input.nodeContractHashVersion !== NODE_CONTRACT_HASH_VERSION) fail("hash.input_invalid", "local contract version mismatch");
  if (input.nodeTopologyHashVersion !== NODE_TOPOLOGY_HASH_VERSION) fail("hash.input_invalid", "local topology version mismatch");
  assertSha256(input.nodeContractHash, "localExecutionIdentity.nodeContractHash");
  assertSha256(input.nodeTopologyHash, "localExecutionIdentity.nodeTopologyHash");
  if (!Array.isArray(input.outgoingTargetBindings)) fail("hash.input_invalid", "outgoingTargetBindings must be an array");
  const digests = input.outgoingTargetBindings.map(deriveTargetBindingDigestV4);
  assertUnique(digests, "outgoingTargetBindingDigests");
  return hashCanonicalDomain(LOCAL_EXECUTION_IDENTITY_VERSION, {
    logicalId: input.logicalId,
    physicalId: input.physicalId,
    revision: input.revision,
    nodeContractHashVersion: input.nodeContractHashVersion,
    nodeContractHash: input.nodeContractHash,
    nodeTopologyHashVersion: input.nodeTopologyHashVersion,
    nodeTopologyHash: input.nodeTopologyHash,
    outgoingTargetBindingDigests: digests.sort(),
  });
}

export interface TopologyBindingV4 {
  physicalId: string;
  revision: number;
  nodeContractHashVersion: typeof NODE_CONTRACT_HASH_VERSION;
  nodeContractHash: Sha256Hex;
  nodeTopologyHashVersion: typeof NODE_TOPOLOGY_HASH_VERSION;
  nodeTopologyHash: Sha256Hex;
}
export interface TopologyEdgeV4 {
  edgeClass: EdgeClassV4;
  sourceLogicalId: string;
  targetLogicalId: string;
}
export interface WorkTopologyV4Input {
  generation: number;
  previousGeneration: number;
  bindings: Record<string, TopologyBindingV4>;
  edges: TopologyEdgeV4[];
}

export function deriveWorkTopologyHashV4(input: WorkTopologyV4Input): Sha256Hex {
  assertExactKeys(input, ["generation", "previousGeneration", "bindings", "edges"], "workTopology");
  assertPositiveInteger(input.generation, "workTopology.generation");
  assertNonNegativeInteger(input.previousGeneration, "workTopology.previousGeneration");
  if (input.generation <= input.previousGeneration) fail("hash.input_invalid", "generation must be greater than previousGeneration");
  if (!isPlainObject(input.bindings)) fail("hash.input_invalid", "bindings must be an object");
  const bindings = Object.keys(input.bindings).sort().map((logicalId) => {
    assertString(logicalId, "binding logicalId");
    const binding = input.bindings[logicalId];
    assertExactKeys(binding, [
      "physicalId", "revision", "nodeContractHashVersion", "nodeContractHash",
      "nodeTopologyHashVersion", "nodeTopologyHash",
    ], `bindings.${logicalId}`);
    assertString(binding.physicalId, `bindings.${logicalId}.physicalId`);
    assertPositiveInteger(binding.revision, `bindings.${logicalId}.revision`);
    if (binding.nodeContractHashVersion !== NODE_CONTRACT_HASH_VERSION || binding.nodeTopologyHashVersion !== NODE_TOPOLOGY_HASH_VERSION) {
      fail("hash.input_invalid", `bindings.${logicalId} carries an unsupported hash version`);
    }
    assertSha256(binding.nodeContractHash, `bindings.${logicalId}.nodeContractHash`);
    assertSha256(binding.nodeTopologyHash, `bindings.${logicalId}.nodeTopologyHash`);
    return { logicalId, ...binding };
  });
  if (!Array.isArray(input.edges)) fail("hash.input_invalid", "edges must be an array");
  const edges = input.edges.map((edge, index) => {
    assertExactKeys(edge, ["edgeClass", "sourceLogicalId", "targetLogicalId"], `edges[${index}]`);
    if (edge.edgeClass !== "dependsOn" && edge.edgeClass !== "completionDependsOn") fail("hash.input_invalid", `edges[${index}].edgeClass is invalid`);
    assertString(edge.sourceLogicalId, `edges[${index}].sourceLogicalId`);
    assertString(edge.targetLogicalId, `edges[${index}].targetLogicalId`);
    return { ...edge };
  });
  const edgeKeys = edges.map((edge) => `${edge.edgeClass}\u0000${edge.sourceLogicalId}\u0000${edge.targetLogicalId}`);
  assertUnique(edgeKeys, "workTopology.edges");
  edges.sort((a, b) => {
    const aa = `${a.edgeClass}\u0000${a.sourceLogicalId}\u0000${a.targetLogicalId}`;
    const bb = `${b.edgeClass}\u0000${b.sourceLogicalId}\u0000${b.targetLogicalId}`;
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  });
  return hashCanonicalDomain(WORK_TOPOLOGY_HASH_VERSION, {
    generation: input.generation,
    previousGeneration: input.previousGeneration,
    bindings,
    edges,
  });
}
