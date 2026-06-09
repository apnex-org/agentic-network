/**
 * mission-83 W2.1 — SchemaDef reconciler.
 *
 * Per Design v1.3 §2.3:
 *   - Boot-time: read all SchemaDef entities; emit any missing/updated indexes
 *     via CREATE INDEX CONCURRENTLY IF NOT EXISTS
 *   - Runtime: subscribe to substrate.watch('SchemaDef'); on put → re-reconcile
 *     that kind's indexes; on delete → drop indexes
 *   - Idempotent: re-running emits no-op DDL when current state matches declared
 *   - Failure-isolated: per-kind index emission failure doesn't block others
 *   - Index-only scope: NEVER emits DDL for tables/columns (Flavor A: single
 *     entities table; never altered after bootstrap)
 *   - Restart-safe: each step uses IF NOT EXISTS / ON CONFLICT DO NOTHING /
 *     CONCURRENTLY semantics per §2.3 restart-safety statement
 *
 * Per architect-dispatch engineer-judgment-lean: explicit `start()` method
 * (substrate-instance-without-reconciler is useful for tests).
 *
 * mission-83 W2 substrate-shell extension.
 */

import pg from "pg";
import { attachPgErrorHandler } from "./pg-error-handler.js";
import type { HubStorageSubstrate, SchemaDef, FieldDef, IndexDef, RenameMap } from "./types.js";
import { isEnvelopeShape } from "./migrations/v2-envelope/shared/envelope.js";
import { createSchemaDefMigrationModule } from "./migrations/v2-envelope/kinds/SchemaDef.js";

const { Pool } = pg;

export interface SchemaReconcilerOptions {
  /** Subset of SchemaDefs to reconcile at boot; default is the full ALL_SCHEMAS export. */
  initialSchemas?: SchemaDef[];

  /** Logger; defaults to console.log/warn. */
  log?: (msg: string) => void;
  warn?: (msg: string, err?: unknown) => void;

  /** AbortSignal for runtime watch loop; reconciler boot path is not abortable (one-shot). */
  signal?: AbortSignal;
}

/**
 * Construct + return a reconciler. Caller invokes `start()` to apply boot-time
 * schemas + begin runtime watch loop.
 */
export function createSchemaReconciler(
  substrate: HubStorageSubstrate,
  connectionString: string,
  opts: SchemaReconcilerOptions = {},
): SchemaReconciler {
  return new SchemaReconciler(substrate, connectionString, opts);
}

export class SchemaReconciler {
  private readonly pool: pg.Pool;
  private readonly log: (msg: string) => void;
  private readonly warn: (msg: string, err?: unknown) => void;
  /**
   * Internal AbortController for runtime-loop cancellation. Chains to opts.signal
   * if provided (caller-side abort triggers internal abort); close() also triggers
   * internal abort for clean shutdown of substrate.watch LISTEN client.
   */
  private readonly internalAbort: AbortController;

  /**
   * mission-90 W1 (Design §2.2): per-kind reverse-translation cache —
   * Map<kind, Map<bare-filter-key, envelope-JSONB-dotted-path>>. Built as a
   * side-effect of applySchemaIndexes (boot-time + runtime SchemaDef put);
   * no TTL / no invalidation — exact to the current SchemaDef inventory;
   * Hub restart rebuilds all caches at boot.
   */
  private readonly fieldTranslationMap = new Map<string, Map<string, string>>();

  /**
   * mission-90 W1 boot-put envelope-correctness (thread-658 preflight c1/c2
   * fold): the SchemaDef migration module is the single shape-authority for
   * envelope-encoding SchemaDef rows — reusing migrateOne guarantees boot-put
   * rows are byte-shape-identical to migrated rows (rename kind→metadata.name,
   * spec partition, status.phase="applied" stamp). The module only reads
   * schema.kind at encode-time, so a minimal self-describing arg is deliberate.
   */
  private readonly schemaDefEnvelopeEncoder = createSchemaDefMigrationModule({
    kind: "SchemaDef",
    version: 1,
    fields: [],
    indexes: [],
    watchable: true,
  });

  constructor(
    private readonly substrate: HubStorageSubstrate,
    connectionString: string,
    private readonly opts: SchemaReconcilerOptions = {},
  ) {
    this.pool = new Pool({ connectionString });
    // bug-110 — pg Pool without an 'error' listener crashes the process on an
    // idle-connection backend error.
    attachPgErrorHandler(this.pool, "SchemaReconciler pool");
    this.log = opts.log ?? ((m) => console.log(`[SchemaReconciler] ${m}`));
    this.warn = opts.warn ?? ((m, err) => console.warn(`[SchemaReconciler] ${m}`, err ?? ""));
    this.internalAbort = new AbortController();
    if (opts.signal) {
      if (opts.signal.aborted) {
        this.internalAbort.abort();
      } else {
        opts.signal.addEventListener("abort", () => this.internalAbort.abort(), { once: true });
      }
    }
  }

  /**
   * Boot path: apply initialSchemas (if any), then begin runtime watch loop.
   * Returns a Promise that resolves when boot-time reconciliation is complete;
   * runtime watch loop runs in background and is cancelled via opts.signal.
   *
   * bug-100 fix (mission-84 post-mortem): STRICT-ALL-OR-NOTHING semantic per
   * architect §5 disposition — reconciler is architectural-defense vector
   * (Design v1.4 §2.3); silent-degradation on per-kind apply-failure is NOT
   * acceptable. If ANY SchemaDef apply fails, start() throws after collecting
   * per-kind failure context (operator sees fail-to-start + log-context-for-
   * debug; vs prior silent-fail-and-keep-running false-positive completion).
   *
   * Truth-log replaces false-positive `complete (N kinds)` with accurate
   * `complete (M of N kinds applied; K failures)`. On failure, throw includes
   * the per-kind failure summary.
   */
  async start(): Promise<void> {
    const initial = this.opts.initialSchemas ?? [];

    // ── Boot-time: apply initial SchemaDefs + emit indexes ────────────────
    this.log(`boot — applying ${initial.length} initial SchemaDefs`);
    const failures: Array<{ kind: string; error: unknown }> = [];
    for (const def of initial) {
      try {
        // Store SchemaDef in entities table (so runtime watch will see future changes
        // via NOTIFY). Per Design §2.3 bootstrap-self-referential: SchemaDef-for-
        // SchemaDef seeded first; subsequent entries reconciled via same path.
        //
        // mission-90 W1 (thread-658 c1/c2 fold): rows are written ENVELOPE-shaped
        // via the SchemaDef migration module — the prior bare `{id, ...def}` put
        // re-bared all SchemaDef rows at every restart (a live bare-writer surface)
        // and would clobber W5's status-writes. W5's status-write MERGES into this
        // row shape (Design §4 W5 row).
        await this.substrate.put("SchemaDef", this.toEnvelopeRow(def));
        await this.applySchemaIndexes(def);
      } catch (err) {
        // Per-kind failure: capture context for STRICT throw post-loop.
        this.warn(`failed to apply SchemaDef for kind=${def.kind}`, err);
        failures.push({ kind: def.kind, error: err });
      }
    }

    const successCount = initial.length - failures.length;
    if (failures.length > 0) {
      // STRICT-ALL-OR-NOTHING per bug-100 fix + architect §5 disposition.
      // Accurate truth-log + throw (caller's Hub-bootstrap fatal-exits → operator
      // sees Hub-fail-to-start AND log-context-for-debug).
      this.warn(
        `boot — SchemaDef application FAILED: ${successCount}/${initial.length} applied; ${failures.length} failure${failures.length === 1 ? "" : "s"} on kinds=[${failures.map(f => f.kind).join(", ")}]`,
      );
      const summary = failures.map(f => `${f.kind}: ${(f.error as Error)?.message ?? String(f.error)}`).join("; ");
      throw new Error(
        `[SchemaReconciler] boot failed: ${failures.length} of ${initial.length} SchemaDef apply failures: ${summary}`,
      );
    }
    this.log(`boot — initial SchemaDef application complete (${successCount} of ${initial.length} kinds applied; 0 failures)`);

    // ── Runtime: subscribe to substrate.watch('SchemaDef') for ongoing changes ──
    // Fire-and-forget; runs until opts.signal is aborted OR substrate.watch terminates
    void this.runtimeLoop();
  }

  /**
   * Emit per-kind expression indexes for a single SchemaDef. Idempotent via
   * CREATE INDEX CONCURRENTLY IF NOT EXISTS; failure-isolated per-index.
   *
   * mission-88 W7 (bug-123 fix): if SchemaDef.indexOwnershipPattern is set,
   * also hard-drop any postgres index matching the pattern but NOT in
   * `def.indexes[]` (handles index renames during envelope migration —
   * e.g. `thread_status_idx` → `thread_status_phase_idx`). Foreign indexes
   * (not matching pattern) are left alone per W7 Q3 refinement (operator-DX
   * affordance for ad-hoc diagnostic indexes).
   */
  private async applySchemaIndexes(def: SchemaDef): Promise<void> {
    // mission-90 W1 (Design §2.2): build the field-translation cache FIRST,
    // OUTSIDE the per-index try/catch blocks below — a malformed-renameMap
    // throw MUST propagate out of applySchemaIndexes to start()'s failure
    // collector (STRICT-ALL-OR-NOTHING boot), NOT be swallowed like the
    // per-index / ownership-pattern failures. Pure additive side-effect:
    // reads ONLY def.renameMap; index DDL below reads ONLY
    // kind/indexes/indexOwnershipPattern — zero index-churn by construction
    // (ADR mechanism statement: Design §8).
    this.buildFieldTranslationMap(def);

    // First pass: CREATE INDEX CONCURRENTLY IF NOT EXISTS for declared indexes
    const declaredNames = new Set<string>();
    for (const idx of def.indexes) {
      declaredNames.add(idx.name);
      try {
        const sql = this.buildCreateIndexSQL(def.kind, idx);
        await this.pool.query(sql);
      } catch (err) {
        this.warn(`failed to create index ${idx.name} for kind=${def.kind}; skipping`, err);
      }
    }

    // Second pass: drop owned-but-deprecated indexes (W7 bug-123 fix; handles
    // index renames + envelope-path migrations).
    if (def.indexOwnershipPattern) {
      try {
        const pattern = new RegExp(def.indexOwnershipPattern);
        const existing = await this.pool.query<{ indexname: string }>(
          `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'entities'`,
        );
        for (const row of existing.rows) {
          const name = row.indexname;
          if (pattern.test(name) && !declaredNames.has(name)) {
            try {
              await this.pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
              this.log(`reconcileIndexes — dropped owned-but-undeclared index: ${name} (kind=${def.kind})`);
            } catch (dropErr) {
              this.warn(`failed to drop deprecated index ${name} for kind=${def.kind}; skipping`, dropErr);
            }
          }
        }
      } catch (regexErr) {
        this.warn(
          `failed to compile indexOwnershipPattern='${def.indexOwnershipPattern}' for kind=${def.kind}; skipping ownership-pattern drop pass`,
          regexErr,
        );
      }
    }
  }

  /**
   * mission-90 W1 (Design §2.2): validate + cache def.renameMap into the
   * per-kind reverse-translation table. Throws on malformed entries (empty
   * key, non-string target, target not rooted at metadata/spec/status) —
   * positioned in applySchemaIndexes so the throw reaches start()'s STRICT
   * failure collector at boot.
   */
  private buildFieldTranslationMap(def: SchemaDef): void {
    const entries = Object.entries(def.renameMap ?? {});
    for (const [bareKey, targetPath] of entries) {
      if (typeof bareKey !== "string" || bareKey.length === 0) {
        throw new Error(`[SchemaReconciler] invalid renameMap for kind=${def.kind}: empty/non-string key`);
      }
      if (typeof targetPath !== "string" || !/^(metadata|spec|status)\.[A-Za-z0-9_.]+$/.test(targetPath)) {
        throw new Error(
          `[SchemaReconciler] invalid renameMap for kind=${def.kind}: key='${bareKey}' target='${String(targetPath)}' — target must be a dotted path rooted at metadata/spec/status`,
        );
      }
    }
    this.fieldTranslationMap.set(def.kind, new Map(entries));
  }

  /**
   * mission-90 W1 (Design §2.2): public accessor consumed by the substrate
   * filter/sort translation (W2, §2.3) and any later policy-layer consumer.
   * Returns the envelope JSONB dotted-path for a renamed bare key, or null
   * for non-renamed keys and unknown kinds (caller passes the bare key
   * through unchanged on null).
   */
  public getFieldTranslation(kind: string, bareKey: string): string | null {
    return this.fieldTranslationMap.get(kind)?.get(bareKey) ?? null;
  }

  /**
   * mission-90 W1: envelope-encode a runtime SchemaDef for the boot put via
   * the SchemaDef migration module (single shape-authority — see field-init
   * comment). Input is the bare legacy shape `{id, ...def}`; output is the
   * envelope row (metadata.name=kind, spec carries version/fields/indexes/
   * watchable/indexOwnershipPattern/renameMap, status stamped "applied").
   */
  private toEnvelopeRow(def: SchemaDef): Record<string, unknown> {
    return this.schemaDefEnvelopeEncoder.migrateOne({ id: def.kind, ...def }) as Record<string, unknown>;
  }

  /**
   * mission-90 W1: decode a watched SchemaDef row back to the runtime
   * SchemaDef shape. Envelope rows (post boot-put fix) carry the described
   * kind at metadata.name and the schema config under spec; bare rows
   * (legacy in-flight during first post-deploy boot) pass through unchanged.
   * Without this decode, applySchemaIndexes(envelope) would read def.kind
   * as the ENTITY kind ("SchemaDef") instead of the described kind.
   */
  private schemaDefFromRow(row: Record<string, unknown>): SchemaDef {
    if (!isEnvelopeShape(row)) {
      return row as unknown as SchemaDef;
    }
    const md = row.metadata as Record<string, unknown>;
    const spec = row.spec as Record<string, unknown>;
    const kind =
      typeof md.name === "string" && md.name.length > 0
        ? md.name
        : String((row as { name?: unknown }).name ?? (row as { id?: unknown }).id ?? "");
    const def: SchemaDef = {
      kind,
      version: typeof spec.version === "number" ? spec.version : 1,
      fields: Array.isArray(spec.fields) ? (spec.fields as FieldDef[]) : [],
      indexes: Array.isArray(spec.indexes) ? (spec.indexes as IndexDef[]) : [],
      watchable: typeof spec.watchable === "boolean" ? spec.watchable : true,
    };
    if (typeof spec.indexOwnershipPattern === "string") {
      def.indexOwnershipPattern = spec.indexOwnershipPattern;
    }
    if (spec.renameMap && typeof spec.renameMap === "object" && !Array.isArray(spec.renameMap)) {
      def.renameMap = spec.renameMap as RenameMap;
    }
    return def;
  }

  /**
   * Drop all indexes for a kind. Used when SchemaDef is deleted via watch event.
   * Idempotent via DROP INDEX IF EXISTS.
   *
   * NOTE: this drops indexes named per SchemaDef.indexes[].name; if a SchemaDef
   * version-bump renamed indexes, the prior-named indexes are orphaned (NOT
   * a problem at v1 — Flavor A doesn't ALTER; version-bumps add new indexes
   * with new names + leave prior orphaned until manual cleanup or follow-on
   * mission). Document for v2+.
   */
  private async dropSchemaIndexes(def: SchemaDef): Promise<void> {
    for (const idx of def.indexes) {
      try {
        await this.pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${idx.name}`);
      } catch (err) {
        this.warn(`failed to drop index ${idx.name} for kind=${def.kind}; skipping`, err);
      }
    }
  }

  /**
   * Build CREATE INDEX CONCURRENTLY SQL from IndexDef.
   *
   * Single-field: CREATE INDEX CONCURRENTLY IF NOT EXISTS <name>
   *               ON entities ((data->>'<field>')) WHERE kind = '<Kind>';
   *
   * Multi-field: CREATE INDEX CONCURRENTLY IF NOT EXISTS <name>
   *              ON entities ((data->>'<f1>'), (data->>'<f2>')) WHERE kind = '<Kind>';
   *
   * Nested (dotted-path): uses data#>>'{a,b}' instead of data->>'a'.
   *
   * IndexDef.where (partial-index predicate per §2.3) — NOT YET SUPPORTED at W2;
   * single-field + multi-field indexes cover all current SchemaDef inventory
   * use-cases. Partial-index support deferrable to W2.x or v2 architect-decision.
   */
  private buildCreateIndexSQL(kind: string, idx: IndexDef): string {
    const fieldExprs = idx.fields.map(f => this.jsonbExtract(f));
    const fieldsList = fieldExprs.map(e => `(${e})`).join(", ");
    // Use double-single-quote escaping for kind name (basic SQL injection mitigation —
    // SchemaDef.kind is engineer-authored content, not external input, but safe-by-default)
    const safeKind = kind.replace(/'/g, "''");
    return `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${idx.name} ON entities (${fieldsList}) WHERE kind = '${safeKind}'`;
  }

  /**
   * Translate dotted-path field name to JSONB extract expression.
   * Examples:
   *   "status"          → "data->>'status'"
   *   "metadata.env"    → "data#>>'{metadata,env}'"
   *
   * (Mirrors postgres-substrate.ts jsonbField helper; kept inline here to avoid
   * cross-module dep + because reconciler emits text-extracted indexes only.)
   */
  private jsonbExtract(dottedPath: string): string {
    const parts = dottedPath.split(".");
    if (parts.length === 1) {
      const safe = parts[0]!.replace(/'/g, "''");
      return `data->>'${safe}'`;
    }
    const safe = parts.map(p => p.replace(/'/g, "''")).join(",");
    return `data#>>'{${safe}}'`;
  }

  /**
   * Runtime watch loop: subscribe to substrate.watch('SchemaDef') + reconcile
   * indexes on put/delete events. Cancelled via opts.signal.
   */
  private async runtimeLoop(): Promise<void> {
    try {
      for await (const event of this.substrate.watch<Record<string, unknown>>("SchemaDef", { signal: this.internalAbort.signal })) {
        if (event.op === "put" && event.entity) {
          // mission-90 W1: rows are envelope-shaped post boot-put fix — decode
          // back to the runtime SchemaDef (described kind at metadata.name)
          // before reconciling; bare rows pass through (first-boot tolerance).
          const def = this.schemaDefFromRow(event.entity);
          this.log(`runtime — re-reconciling kind=${def.kind} (rv=${event.resourceVersion})`);
          try {
            await this.applySchemaIndexes(def);
          } catch (err) {
            this.warn(`runtime apply failed for kind=${def.kind}`, err);
          }
        } else if (event.op === "delete") {
          // Need the SchemaDef shape to know which indexes to drop. Watch payload
          // only carries (kind, id); on delete, entity is absent. We could SELECT
          // the prior-state from postgres if we had MVCC visibility, but DELETE
          // already removed the row. Best-effort: log + skip (orphan indexes can
          // be manually cleaned up; deletion is rare per Flavor A discipline).
          this.warn(`runtime — SchemaDef deleted for id=${event.id}; orphan indexes NOT cleaned (manual cleanup needed)`);
        }
      }
    } catch (err) {
      // Watch terminated unexpectedly (signal aborted OR substrate-side error)
      if (this.internalAbort.signal.aborted) {
        this.log(`runtime — watch loop aborted via signal`);
      } else {
        this.warn(`runtime — watch loop terminated unexpectedly`, err);
      }
    }
  }

  /**
   * Close reconciler. Aborts runtime watch loop (cleanly ends substrate.watch
   * LISTEN client) + closes reconciler's own pg pool. Caller's responsibility;
   * substrate's pool is separate.
   */
  async close(): Promise<void> {
    this.internalAbort.abort();
    // Give the watch loop a moment to teardown its LISTEN client cleanly
    await new Promise(r => setTimeout(r, 50));
    await this.pool.end();
  }
}
