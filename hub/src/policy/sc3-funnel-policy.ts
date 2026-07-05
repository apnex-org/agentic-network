/**
 * sc3-funnel-policy.ts — mission-102 B8-R2 (work-129): the SC3 attention
 * funnel + the CONTRACT TEST 6 gaming flag (design §5 SC3 + §6 #6, G2-BINDING).
 *
 * ONE read-only verb, query_sc3_funnel: the full-funnel denominators over an
 * interval (raised / curated / routed / self-disposed / merged / disposed /
 * director-resolved / stale / reversed) + p50/p95 raise→resolution ages —
 * computed live from decision rows (exact scans; never stored truth).
 *
 * THE GAMING RULE (§6 #6): time-per-Director-decision IMPROVING while the
 * self-disposal ratio, stale count, or reversal count RISES is the SC3
 * anti-pattern — optimizing the metric by diverting or dropping attention
 * instead of earning it. The interval splits at `splitAt` (default midpoint),
 * both halves compute independently, and when the pattern holds the render is
 * FLAGGED — the response's `assessment` is never an unqualified success and
 * `qualification` names the contributing factors.
 *
 * REVERSAL (v1 proxy, documented): a raise whose parentRef points at an
 * already-RESOLVED/EXECUTED decision — a re-litigated outcome. No dedicated
 * reversal machinery exists in v1; this is the honest observable signal.
 *
 * No transcript surveillance (SC3's own constraint): everything derives from
 * decision-row lifecycle fields.
 */
import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import type { Decision } from "../entities/decision.js";

export const SC3_STALE_RAISED_MS = 24 * 3600_000;  // the curation SLO boundary
export const SC3_STALE_ROUTED_MS = 48 * 3600_000;  // the S2.4 normal aging boundary

function ok(body: Record<string, unknown>): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}
function err(errorKind: string, message: string): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message, errorKind }) }], isError: true };
}

function percentile(sortedAsc: number[], q: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(q * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

const DIRECTOR_MODES = new Set(["director-direct", "director-via-proxy"]);
const SELF_MODES = new Set(["architect-t5", "class-grant"]);

interface HalfStats {
  raised: number;
  directorResolved: number;
  selfDisposed: number;
  selfDisposalRatio: number;
  staleCount: number;
  reversalCount: number;
  directorP50AgeMs: number | null;
  directorP95AgeMs: number | null;
}

function statsFor(decisions: Decision[], all: Decision[], nowISO: string): HalfStats {
  const nowMs = Date.parse(nowISO);
  const resolvedById = new Map(all.map((d) => [d.id, d]));
  const directorAges: number[] = [];
  let directorResolved = 0, selfDisposed = 0, stale = 0, reversals = 0;
  for (const d of decisions) {
    const mode = d.resolution?.authorityMode;
    if (mode && DIRECTOR_MODES.has(mode)) {
      directorResolved++;
      if (d.resolution?.resolvedAt) directorAges.push(Date.parse(d.resolution.resolvedAt) - Date.parse(d.createdAt));
    }
    if (mode && SELF_MODES.has(mode)) selfDisposed++;
    // stale = LIVE dwell past the boundary in an attention-holding state
    if (d.status === "raised" && nowMs - Date.parse(d.enteredCurrentStateAt) > SC3_STALE_RAISED_MS) stale++;
    if (d.status === "routed" && nowMs - Date.parse(d.enteredCurrentStateAt) > SC3_STALE_ROUTED_MS) stale++;
    // reversal proxy: a raise disputing an already-settled decision
    if (d.parentRef?.kind === "Decision" || d.parentRef?.kind === "decision") {
      const parent = resolvedById.get(d.parentRef.id);
      if (parent && (parent.status === "resolved" || parent.status === "executed")) reversals++;
    }
  }
  directorAges.sort((a, b) => a - b);
  return {
    raised: decisions.length,
    directorResolved,
    selfDisposed,
    selfDisposalRatio: decisions.length === 0 ? 0 : selfDisposed / decisions.length,
    staleCount: stale,
    reversalCount: reversals,
    directorP50AgeMs: percentile(directorAges, 0.5),
    directorP95AgeMs: percentile(directorAges, 0.95),
  };
}

async function querySc3Funnel(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.decision;
  if (!store) return err("not_wired", "Decision store is not available");
  const from = args.from as string, to = args.to as string;
  if (!from || !to || Date.parse(from) >= Date.parse(to)) {
    return err("invalid_arguments", "query_sc3_funnel requires from < to (ISO-8601)");
  }
  const nowISO = (args.nowISO as string | undefined) ?? new Date().toISOString();
  const splitAt = (args.splitAt as string | undefined)
    ?? new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString();

  const all = await store.listAllDecisions(); // exact scan — the audit-10199 law
  const inWindow = all.filter((d) => d.createdAt >= from && d.createdAt <= to);

  // The full-funnel denominators (SC3: whole-funnel, never a cherry-picked stage).
  const funnel = {
    raised: inWindow.length,
    curated: inWindow.filter((d) => d.curatedBy !== null).length,
    routed: inWindow.filter((d) => d.routedTo !== null).length,
    selfDisposed: inWindow.filter((d) => SELF_MODES.has(d.resolution?.authorityMode ?? "")).length,
    directorResolved: inWindow.filter((d) => DIRECTOR_MODES.has(d.resolution?.authorityMode ?? "")).length,
    merged: inWindow.filter((d) => d.status === "merged").length,
    disposed: inWindow.filter((d) => d.status === "disposed").length,
    withdrawn: inWindow.filter((d) => d.status === "withdrawn").length,
    stale: statsFor(inWindow, all, nowISO).staleCount,
    reversed: statsFor(inWindow, all, nowISO).reversalCount,
    directorP50AgeMs: statsFor(inWindow, all, nowISO).directorP50AgeMs,
    directorP95AgeMs: statsFor(inWindow, all, nowISO).directorP95AgeMs,
  };

  const firstHalf = statsFor(inWindow.filter((d) => d.createdAt < splitAt), all, nowISO);
  const secondHalf = statsFor(inWindow.filter((d) => d.createdAt >= splitAt), all, nowISO);

  // CONTRACT TEST 6 — the gaming rule. Needs comparable director volume on
  // both sides; otherwise the verdict is insufficient-data, never "clean".
  const comparable = firstHalf.directorP50AgeMs !== null && secondHalf.directorP50AgeMs !== null;
  const speedImproved = comparable && secondHalf.directorP50AgeMs! < firstHalf.directorP50AgeMs!;
  const factors: string[] = [];
  if (secondHalf.selfDisposalRatio > firstHalf.selfDisposalRatio) {
    factors.push(`self-disposal ratio rose ${firstHalf.selfDisposalRatio.toFixed(2)}→${secondHalf.selfDisposalRatio.toFixed(2)}`);
  }
  if (secondHalf.staleCount > firstHalf.staleCount) {
    factors.push(`stale count rose ${firstHalf.staleCount}→${secondHalf.staleCount}`);
  }
  if (secondHalf.reversalCount > firstHalf.reversalCount) {
    factors.push(`reversal count rose ${firstHalf.reversalCount}→${secondHalf.reversalCount}`);
  }
  const gamingFlagged = speedImproved && factors.length > 0;
  const assessment = gamingFlagged ? "flagged" : comparable ? "clean" : "insufficient-data";

  return ok({
    from, to, splitAt,
    funnel,
    halves: { first: firstHalf, second: secondHalf },
    gamingFlagged,
    gamingFactors: factors,
    assessment,
    // NEVER an unqualified success while flagged (§6 #6): the qualification is
    // part of the render, not an optional footnote.
    ...(gamingFlagged ? {
      qualification: `SC3 GAMING PATTERN: director-decision p50 improved (${firstHalf.directorP50AgeMs}ms→${secondHalf.directorP50AgeMs}ms) while ${factors.join(" AND ")} — the speed gain is not clean attention efficiency and MUST NOT be reported as unqualified success`,
    } : {}),
  });
}

export function registerSc3FunnelPolicy(router: PolicyRouter): void {
  router.register(
    "query_sc3_funnel",
    "[Any] The SC3 attention funnel over an interval (design §5 SC3 / §6 contract 6): full denominators (raised/curated/routed/self-disposed/director-resolved/merged/disposed/stale/reversed) + p50/p95 raise→resolution ages, split-halved with the GAMING flag — director-decision speed improving while self-disposal ratio / stale age / reversal count rises renders FLAGGED, never as unqualified success. Read-only; derives entirely from decision-row lifecycle fields (no transcript surveillance).",
    {
      from: z.string().describe("ISO-8601 interval start (decision createdAt)"),
      to: z.string().describe("ISO-8601 interval end"),
      splitAt: z.string().optional().describe("Half-split boundary for the gaming comparison (default: interval midpoint)"),
      nowISO: z.string().optional().describe("Staleness reference instant (default: now; tests pin it)"),
    },
    querySc3Funnel,
  );
}
