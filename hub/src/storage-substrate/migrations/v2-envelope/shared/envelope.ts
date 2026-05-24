/**
 * mission-88 W0 — shared envelope encode/parse library.
 *
 * Per thread-639 Q1 disposition: two-function pure-API consumed by W1-W5
 * per-kind migration modules + reader/writer tolerance paths.
 *
 *   encodeEnvelope(legacy, schemaRef) → EnvelopeShape
 *   parseEnvelope(envelope, schemaRef) → { metadata, spec, status }
 *
 * Substrate-currency-discipline framing: this library is the **write-validation
 * envelope tolerance** + **reader-parse tolerance** mechanism (NOT a SchemaDef-
 * reconciler concern; per thread-639 precision-pin (ii)). Reconciler manages
 * indexes only.
 *
 * Cluster-Design references honored:
 *   - cluster-1 §1.5 handle-classified vs content-classified — PartitionRules
 *     in MigrationSchemaRef expresses both axes per kind
 *   - cluster-2 §1.6 multi-FSM-in-status — partition.status can carry multiple
 *     FSM-tagged fields (e.g., Agent's 4 orthogonal FSMs)
 *   - cluster-4 §1.7 field-name collision — renameMap mechanically rewrites
 *     legacy field-paths to envelope field-paths (Message.kind →
 *     metadata.messageKind canonical)
 */

import type { MigrationSchemaRef, PartitionRules, RenameMap } from "../kinds/_contract.js";

/**
 * K8s envelope shape per Phase 4 cluster Designs. apiVersion + kind +
 * metadata + spec + status. id + name preserved at envelope top-level
 * for substrate-mediated CRUD path compatibility.
 */
export interface EnvelopeShape {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly apiVersion: string;
  readonly metadata: Record<string, unknown>;
  readonly spec: Record<string, unknown>;
  readonly status: Record<string, unknown>;
}

/**
 * Default apiVersion for cluster-Design partitions. Per Phase 5 v0.2 anti-
 * goal #13: additive changes preserve `core.ois/v1`; non-additive changes
 * would bump to `core.ois/v2`.
 */
export const DEFAULT_API_VERSION = "core.ois/v1";

/**
 * Envelope-shape probe. Returns true if the input looks like an already-
 * encoded envelope (idempotency check per KindMigrationModule contract).
 */
export function isEnvelopeShape(input: unknown): input is EnvelopeShape {
  if (typeof input !== "object" || input === null) return false;
  const rec = input as Record<string, unknown>;
  return (
    typeof rec.apiVersion === "string" &&
    typeof rec.kind === "string" &&
    typeof rec.metadata === "object" && rec.metadata !== null &&
    typeof rec.spec === "object" && rec.spec !== null &&
    typeof rec.status === "object" && rec.status !== null
  );
}

/**
 * Default partition heuristic. Used when MigrationSchemaRef.partition is
 * absent; per-kind modules override for substantive deviations.
 *
 * Defaults:
 *   - metadata: id, name, kind, labels, annotations, sourceThreadId, sourceActionId
 *   - spec: explicit empty (per-kind module supplies)
 *   - status: explicit empty (per-kind module supplies)
 *
 * Per-kind modules SHOULD supply explicit partition rules; the default is
 * a safety-net for trivial kinds with no domain semantics (RepoEventBridge*).
 */
const DEFAULT_METADATA_KEYS = new Set([
  "id",
  "name",
  "kind",
  "labels",
  "annotations",
  "sourceThreadId",
  "sourceActionId",
  "sourceThreadSummary",
  "createdAt",
  "createdBy",
  "updatedAt",
]);

/**
 * Encode a legacy-shape entity into envelope-shape.
 *
 * @param legacy  the legacy-flat-shape entity (substrate-current shape pre-W1+)
 * @param schemaRef  per-kind schema + rename + partition rules
 * @returns envelope-shape entity
 *
 * Idempotency: if `legacy` is already envelope-shape, returns it unchanged.
 */
export function encodeEnvelope(legacy: unknown, schemaRef: MigrationSchemaRef): EnvelopeShape {
  if (isEnvelopeShape(legacy)) return legacy;
  if (typeof legacy !== "object" || legacy === null) {
    throw new Error(`[envelope] encodeEnvelope: input must be an object, got ${typeof legacy}`);
  }

  const src = legacy as Record<string, unknown>;
  const kind = schemaRef.schema.kind;
  const id = typeof src.id === "string" ? src.id : "";
  if (!id) {
    throw new Error(`[envelope] encodeEnvelope: input.id must be a non-empty string for kind=${kind}`);
  }
  // Per cluster-1 §3.x + cluster-2 §2.1: metadata.name preserves the entity-ID prefix
  const name = typeof src.name === "string" ? src.name : id;

  // Apply rename rules BEFORE partition; rename rewrites legacy keys to their
  // envelope field-path (e.g., "kind" → "metadata.messageKind" for cluster-4).
  const renamed = applyRenameMap(src, schemaRef.renameMap);

  // Partition into metadata / spec / status.
  const partition = schemaRef.partition;
  const metadata: Record<string, unknown> = {};
  const spec: Record<string, unknown> = {};
  const status: Record<string, unknown> = {};

  // Preserve id + name + kind at envelope top-level (do not also put in metadata
  // unless partition rules say so).
  const envelopeReserved = new Set(["id", "name", "apiVersion"]);

  for (const [key, value] of Object.entries(renamed)) {
    if (envelopeReserved.has(key)) continue;
    // Dotted-path keys from rename go straight to nested partition (handled below)
    if (key.includes(".")) {
      assignDottedPath({ metadata, spec, status }, key, value);
      continue;
    }
    const target = pickPartition(key, partition);
    if (target === "metadata") metadata[key] = value;
    else if (target === "spec") spec[key] = value;
    else if (target === "status") status[key] = value;
  }

  return {
    id,
    name,
    kind,
    apiVersion: DEFAULT_API_VERSION,
    metadata,
    spec,
    status,
  };
}

/**
 * Parse an envelope-shape entity into its partitioned constituents.
 *
 * @param envelope  the envelope-shape entity
 * @param schemaRef  per-kind schema (not used at parse-time today; reserved
 *                   for schema-validation extension at W6 strict-flip)
 * @returns { metadata, spec, status } partition
 *
 * Tolerance: if input is legacy-shape (NOT envelope), throws — caller is
 * responsible for shape-probing via isEnvelopeShape first.
 */
export function parseEnvelope(
  envelope: EnvelopeShape,
  _schemaRef: MigrationSchemaRef,
): { metadata: Record<string, unknown>; spec: Record<string, unknown>; status: Record<string, unknown> } {
  if (!isEnvelopeShape(envelope)) {
    throw new Error("[envelope] parseEnvelope: input is not envelope-shape; probe with isEnvelopeShape first");
  }
  return {
    metadata: envelope.metadata,
    spec: envelope.spec,
    status: envelope.status,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function applyRenameMap(
  src: Record<string, unknown>,
  renameMap: RenameMap | undefined,
): Record<string, unknown> {
  if (!renameMap || Object.keys(renameMap).length === 0) return { ...src };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(src)) {
    const renamed = renameMap[key];
    if (renamed) {
      out[renamed] = value;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function pickPartition(
  key: string,
  partition: PartitionRules | undefined,
): "metadata" | "spec" | "status" {
  if (partition) {
    if (partition.metadata?.includes(key)) return "metadata";
    if (partition.spec?.includes(key)) return "spec";
    if (partition.status?.includes(key)) return "status";
    // Per-kind partition supplied but key not listed: fall through to default
  }
  if (DEFAULT_METADATA_KEYS.has(key)) return "metadata";
  // Default unmatched-key bucket: spec (the conservative "what" partition)
  return "spec";
}

function assignDottedPath(
  buckets: { metadata: Record<string, unknown>; spec: Record<string, unknown>; status: Record<string, unknown> },
  dottedPath: string,
  value: unknown,
): void {
  const [bucketName, ...rest] = dottedPath.split(".");
  if (bucketName !== "metadata" && bucketName !== "spec" && bucketName !== "status") {
    throw new Error(
      `[envelope] rename target path must start with metadata/spec/status, got: ${dottedPath}`,
    );
  }
  const bucket = buckets[bucketName];
  let cursor: Record<string, unknown> = bucket;
  for (let i = 0; i < rest.length - 1; i++) {
    const seg = rest[i];
    if (!(seg in cursor) || typeof cursor[seg] !== "object" || cursor[seg] === null) {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, unknown>;
  }
  cursor[rest[rest.length - 1]] = value;
}
