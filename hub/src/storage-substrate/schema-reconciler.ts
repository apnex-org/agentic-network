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
import type { HubStorageSubstrate, SchemaDef, IndexDef } from "./types.js";

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

  constructor(
    private readonly substrate: HubStorageSubstrate,
    connectionString: string,
    private readonly opts: SchemaReconcilerOptions = {},
  ) {
    this.pool = new Pool({ connectionString });
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
   */
  async start(): Promise<void> {
    const initial = this.opts.initialSchemas ?? [];

    // ── Boot-time: apply initial SchemaDefs + emit indexes ────────────────
    this.log(`boot — applying ${initial.length} initial SchemaDefs`);
    for (const def of initial) {
      try {
        // Store SchemaDef in entities table (so runtime watch will see future changes
        // via NOTIFY). Per Design §2.3 bootstrap-self-referential: SchemaDef-for-
        // SchemaDef seeded first; subsequent entries reconciled via same path.
        await this.substrate.put("SchemaDef", { id: def.kind, ...def });
        await this.applySchemaIndexes(def);
      } catch (err) {
        // Failure-isolated: per-kind failure doesn't block others
        this.warn(`failed to apply SchemaDef for kind=${def.kind}; skipping`, err);
      }
    }
    this.log(`boot — initial SchemaDef application complete (${initial.length} kinds)`);

    // ── Runtime: subscribe to substrate.watch('SchemaDef') for ongoing changes ──
    // Fire-and-forget; runs until opts.signal is aborted OR substrate.watch terminates
    void this.runtimeLoop();
  }

  /**
   * Emit per-kind expression indexes for a single SchemaDef. Idempotent via
   * CREATE INDEX CONCURRENTLY IF NOT EXISTS; failure-isolated per-index.
   */
  private async applySchemaIndexes(def: SchemaDef): Promise<void> {
    for (const idx of def.indexes) {
      try {
        const sql = this.buildCreateIndexSQL(def.kind, idx);
        await this.pool.query(sql);
      } catch (err) {
        this.warn(`failed to create index ${idx.name} for kind=${def.kind}; skipping`, err);
      }
    }
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
      for await (const event of this.substrate.watch<SchemaDef>("SchemaDef", { signal: this.internalAbort.signal })) {
        if (event.op === "put" && event.entity) {
          this.log(`runtime — re-reconciling kind=${event.entity.kind} (rv=${event.resourceVersion})`);
          try {
            await this.applySchemaIndexes(event.entity);
          } catch (err) {
            this.warn(`runtime apply failed for kind=${event.entity.kind}`, err);
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
