/**
 * Hub observability — shadow-invariant logger (Phase 2d CP1, M-Cognitive-Hypervisor).
 *
 * Emits structured telemetry for INV-TH* enforcement events. Called
 * one line before every invariant throw site; also callable for
 * shadow-only checks (soft near-misses where we observe but don't
 * throw).
 *
 * Each call:
 *   1. Increments metrics bucket `<inv>.shadow_breach` (normalized id)
 *   2. Appends an audit-log entry `<inv>_shadow_breach` (fire-and-forget)
 *   3. Emits a console.warn for local/dev visibility
 *
 * Non-fatal: audit-write failures are swallowed (INV-TH26 pattern —
 * audit is declared recoverable; it must never perturb caller control
 * flow). This helper is strictly additive — it changes no invariant
 * behaviour, only observes.
 */

import type { IPolicyContext } from "../policy/types.js";

/**
 * Normalize an invariant identifier for bucket + audit-action keying.
 * Accepts "INV-TH19", "inv-th19", "TH19", "th19", "19" — all produce
 * `inv_th19`. Keeps the emitted telemetry consistent regardless of how
 * the caller spells the id.
 */
export function normalizeInvId(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleaned.startsWith("invth")) return `inv_th${cleaned.slice(5)}`;
  if (cleaned.startsWith("inv")) return `inv_${cleaned.slice(3)}`;
  if (cleaned.startsWith("th")) return `inv_th${cleaned.slice(2)}`;
  return `inv_th${cleaned}`;
}

export type ShadowBreachKind = "breach" | "near_miss";

export interface LogShadowOptions {
  /** Related entity id (thread-*, task-*, idea-*) for audit back-link. */
  relatedEntity?: string;
  /** "breach" (default) = invariant just fired. "near_miss" = soft
   *  observation of a condition approaching the breach threshold. */
  kind?: ShadowBreachKind;
  /** Optional structured payload — recorded in metrics.recentDetails
   *  for audit-report sampling. */
  extra?: Record<string, unknown>;
}

/**
 * Log a shadow-invariant event. Call at every INV-TH* throw site
 * (kind defaults to "breach") and at near-miss observation sites
 * (kind = "near_miss").
 *
 * @param inv - invariant id ("INV-TH19", "TH19", etc.)
 * @param summary - short human-readable description of the event
 * @param ctx - policy context (for metrics + audit + session identity)
 * @param options - related entity id + kind + extra payload
 */
export function logShadowInvariantBreach(
  inv: string,
  summary: string,
  ctx: IPolicyContext,
  options: LogShadowOptions = {},
): void {
  const { relatedEntity, kind = "breach", extra } = options;
  const normalized = normalizeInvId(inv);
  const bucket = kind === "near_miss" ? `${normalized}.near_miss` : `${normalized}.shadow_breach`;

  ctx.metrics.increment(bucket, { inv, kind, summary, role: ctx.role, ...(extra ?? {}) });

  const auditAction = kind === "near_miss" ? `${normalized}_near_miss` : `${normalized}_shadow_breach`;
  // INV-TH26: audit is declared recoverable. Swallow failures so the
  // observability path never perturbs caller control flow.
  ctx.stores.audit.logEntry("hub", auditAction, summary, relatedEntity).catch((err: unknown) => {
    console.error(`[logShadowInvariantBreach] audit.logEntry failed for ${inv}:`, err);
  });

  const suffix = relatedEntity ? ` (entity=${relatedEntity})` : "";
  const prefix = kind === "near_miss" ? "[SHADOW-INV near-miss]" : "[SHADOW-INV]";
  console.warn(`${prefix} ${inv} ${kind}: ${summary}${suffix}`);
}
