/**
 * curation-policy.ts — mission-102 P3-B2: the anti-laundering Director queries
 * + curation SLO (design §2, RATIFIED at G2; work-116).
 *
 * ONE read-only verb, query_curation, with the five §2 query modes that make
 * laundering visible by CONSTRUCTION (contract test 2):
 *
 *   raw_feed          — every raise in an interval, complete INCLUDING
 *                       decisions since disposed/merged (contract test 8:
 *                       nothing ever vanishes from the raw feed);
 *   raw_vs_presented  — field diff between the immutable raise capture and
 *                       the curated row the Director is shown;
 *   class_changed     — decisions whose presented class differs from raw;
 *   per_grant         — every record citing a given grant (the self-disposal
 *                       classification packet trail);
 *   merge_lineage     — a decision's full constituent set: every source raw
 *                       id + its immutable content (minority claims stay
 *                       reachable);
 *   slo_breaches      — decisions past the 24h curation SLO (dwell in raised),
 *                       measured live off queue state.
 *
 * The 24h SLO breach EMISSION rides the one emit-only sweep (S2.4 / §4): see
 * runCurationSloSweep, called from the same boot interval as the B6 aging
 * sweep. Breaches emit ONCE (NudgeReceipt level "slo") and are exceptions —
 * curation is architect work, so Director away-mode never suppresses them.
 */
import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { emitAndPush } from "./message-policy.js";
import type { Decision } from "../entities/decision.js";
import type { RawDecisionRaised } from "../entities/curation.js";

export const CURATION_SLO_MS = 24 * 3600_000;
export const CURATION_SLO_EVENT = "curation-slo-breach";

/** The fields §2 treats as PRESENTED content — the diff surface. */
const PRESENTED_FIELDS = ["title", "context", "class", "options"] as const;

function ok(body: Record<string, unknown>): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}
function err(errorKind: string, message: string): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message, errorKind }) }], isError: true };
}

function diffRawVsPresented(raw: RawDecisionRaised, presented: Decision): Record<string, { raw: unknown; presented: unknown }> {
  const diff: Record<string, { raw: unknown; presented: unknown }> = {};
  for (const f of PRESENTED_FIELDS) {
    const a = JSON.stringify(raw[f] ?? null);
    const b = JSON.stringify(presented[f] ?? null);
    if (a !== b) diff[f] = { raw: raw[f] ?? null, presented: presented[f] ?? null };
  }
  return diff;
}

async function queryCuration(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const curation = ctx.stores.curation;
  const decisions = ctx.stores.decision;
  if (!curation || !decisions) return err("not_wired", "Curation/Decision stores are not available");

  switch (args.query) {
    case "raw_feed": {
      if (!args.from || !args.to) return err("invalid_arguments", "raw_feed requires from + to (ISO-8601)");
      const rows = await curation.listRawInterval(args.from as string, args.to as string);
      // Contract test 8: the feed carries the CURRENT terminal state alongside
      // the immutable capture, so disposed/merged raises are visibly present.
      const withState = await Promise.all(rows.map(async (r) => ({
        raw: r,
        currentStatus: (await decisions.getDecision(r.decisionId))?.status ?? "missing",
      })));
      return ok({ query: "raw_feed", from: args.from, to: args.to, count: withState.length, items: withState });
    }
    case "raw_vs_presented": {
      if (!args.decisionId) return err("invalid_arguments", "raw_vs_presented requires decisionId");
      const raw = await curation.getRawForDecision(args.decisionId as string);
      const presented = await decisions.getDecision(args.decisionId as string);
      if (!raw || !presented) return err("not_found", `no raw capture / decision for ${args.decisionId}`);
      return ok({
        query: "raw_vs_presented", decisionId: args.decisionId,
        diff: diffRawVsPresented(raw, presented),
        records: await curation.listRecordsForDecision(args.decisionId as string),
      });
    }
    case "class_changed": {
      const { items } = await decisions.listDecisions();
      const changed: Array<Record<string, unknown>> = [];
      for (const d of items) {
        const raw = await curation.getRawForDecision(d.id);
        if (raw && JSON.stringify(raw.class) !== JSON.stringify(d.class)) {
          changed.push({ decisionId: d.id, rawClass: raw.class, presentedClass: d.class, status: d.status });
        }
      }
      return ok({ query: "class_changed", count: changed.length, items: changed });
    }
    case "per_grant": {
      if (!args.grantRef) return err("invalid_arguments", "per_grant requires grantRef");
      const records = (await curation.listAllRecords()).filter((r) => r.grantCitation === args.grantRef);
      return ok({ query: "per_grant", grantRef: args.grantRef, count: records.length, items: records });
    }
    case "merge_lineage": {
      if (!args.decisionId) return err("invalid_arguments", "merge_lineage requires decisionId");
      // The full constituent set: this decision's raw + every raw cited by
      // merge records POINTING AT it (children merged in), recursively flat.
      const { items } = await decisions.listDecisions({ status: "merged" });
      const constituents = items.filter((d) => d.mergedInto === args.decisionId);
      const ownRaw = await curation.getRawForDecision(args.decisionId as string);
      const lineage = await Promise.all(constituents.map(async (c) => ({
        decisionId: c.id,
        raw: await curation.getRawForDecision(c.id),
        records: await curation.listRecordsForDecision(c.id),
      })));
      return ok({ query: "merge_lineage", decisionId: args.decisionId, own: ownRaw, mergedIn: lineage });
    }
    case "slo_breaches": {
      const now = Date.now();
      const { items } = await decisions.listDecisions({ status: "raised" });
      const breaches = items
        .filter((d) => now - Date.parse(d.enteredCurrentStateAt) > CURATION_SLO_MS)
        .map((d) => ({ decisionId: d.id, title: d.title, raisedAt: d.enteredCurrentStateAt, dwellMs: now - Date.parse(d.enteredCurrentStateAt) }));
      return ok({ query: "slo_breaches", sloMs: CURATION_SLO_MS, count: breaches.length, items: breaches });
    }
    default:
      return err("invalid_arguments", `unknown query '${String(args.query)}'`);
  }
}

/**
 * The 24h curation-SLO breach pass — EMIT-ONLY (the B1 no-timer invariant),
 * sharing the boot interval with the B6 aging sweep. Breaches are EXCEPTIONS:
 * Director presence never suppresses them (curation is architect work), and
 * each decision breaches ONCE (deduped via NudgeReceipt level "slo").
 */
export async function runCurationSloSweep(ctx: IPolicyContext, nowISO?: string): Promise<{ emitted: number }> {
  const decisions = ctx.stores.decision;
  const arrival = ctx.stores.arrivalSurface;
  if (!decisions || !arrival) return { emitted: 0 };
  const now = nowISO ?? new Date().toISOString();
  const { items } = await decisions.listDecisions({ status: "raised" });
  const open = await arrival.openNudgeReceipts();
  let emitted = 0;
  for (const d of items) {
    if (Date.parse(now) - Date.parse(d.enteredCurrentStateAt) <= CURATION_SLO_MS) continue;
    if (open.some((n) => n.decisionId === d.id && n.level === "slo")) continue; // once
    let ref: string | null = null;
    try {
      const msg = await emitAndPush(ctx, {
        kind: "external-injection",
        authorRole: "system",
        authorAgentId: "hub",
        target: null,
        delivery: "push-immediate",
        intent: "curation_slo_breach",
        payload: {
          notificationEvent: CURATION_SLO_EVENT,
          decision_id: d.id,
          title: d.title,
          raised_at: d.enteredCurrentStateAt,
          body: `${d.id} has sat UNCURATED past the 24h SLO (raised ${d.enteredCurrentStateAt}) — "${d.title}"`,
        },
      });
      ref = (msg as { id?: string } | undefined)?.id ?? null;
    } catch (e) {
      console.error(`[curation-slo] breach emit failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
    await arrival.mintNudgeReceipt({ decisionId: d.id, level: "slo", emittedRef: ref });
    emitted++;
  }
  return { emitted };
}

export function registerCurationPolicy(router: PolicyRouter): void {
  router.register(
    "query_curation",
    "[Architect|Director] The §2 anti-laundering queries over the append-only curation trail: raw_feed (interval, complete incl. disposed+merged — contract test 8), raw_vs_presented (immutable capture vs curated view diff + records), class_changed, per_grant (self-disposal classification packets), merge_lineage (all constituent raws — minority claims reachable), slo_breaches (24h curation SLO, live off queue state). Read-only.",
    {
      query: z.enum(["raw_feed", "raw_vs_presented", "class_changed", "per_grant", "merge_lineage", "slo_breaches"]),
      decisionId: z.string().optional(),
      grantRef: z.string().optional(),
      from: z.string().optional().describe("ISO-8601 interval start (raw_feed)"),
      to: z.string().optional().describe("ISO-8601 interval end (raw_feed)"),
    },
    queryCuration,
  );
}
