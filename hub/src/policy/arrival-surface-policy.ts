/**
 * arrival-surface-policy.ts — mission-102 P3-B6: the Director arrival surface
 * (design.md v1.0 §1.4 + §4, RATIFIED at G2).
 *
 * Tools: render_arrival_surface [Architect|Director] · acknowledge_arrival
 * [Architect|Director] · declare_away_stint / declare_present [Architect|Director].
 *
 * THE PULL-PURITY CONTRACT (anti-bug-225, contract test 4): the render verb's
 * output is a pure function of QUEUE STATE — routed decisions, digest counts,
 * failure parks — complete with every push channel dead. The ArrivalSnapshot
 * is recorded BY this verb server-side (a client cannot fake or skip it), and
 * DELIVERED = snapshot membership. Open nudge receipts for rendered decisions
 * flip to presented in the same call.
 *
 * The aging sweep (DecisionAgingSweep) is EMIT-ONLY: it reads dwell, mints
 * NudgeReceipts, emits decision-aging-notification — and NEVER transitions
 * anything (the B1 no-timer invariant). Presence (S3.1) suppresses
 * NON-CRITICAL emission while away — but suppressed nudges STILL mint
 * receipts (emittedRef: null), so backlog accounting survives away-mode.
 * Critical nudges: bounded retry (2) then ONE side-channel escalation (D-A1).
 */
import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { resolveCreatedBy } from "./caller-identity.js";
import { emitAndPush } from "./message-policy.js";
import type { Decision, DecisionActor } from "../entities/decision.js";
import type { SnapshotEntry } from "../entities/arrival-surface.js";
import { canonicalPromptHash } from "../entities/director-proof-repository-substrate.js";

export const DECISION_AGING_EVENT = "decision-aging-notification";
/** S2.4 thresholds. Criticality: ontology classes representing exceptions /
 *  escalations age on the fast clock; everything else is normal. */
export const AGING_NORMAL_MS = 48 * 3600_000;
export const AGING_CRITICAL_MS = 24 * 3600_000;
export const CRITICAL_CLASSES: readonly string[] = ["exception", "escalation"];
const CRITICAL_MAX_RETRIES = 2;

function ok(body: Record<string, unknown>): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}
function err(errorKind: string, message: string): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message, errorKind }) }], isError: true };
}

async function stampActor(ctx: IPolicyContext): Promise<DecisionActor> {
  const p = await resolveCreatedBy(ctx);
  return { agentId: p.agentId, role: p.role, sessionId: ctx.sessionId };
}

/** Every verb here has DELIVERY side effects (a render flips nudge receipts to
 *  presented; an away-stint suppresses Director nudges) — so unlike the B4
 *  provenance-stamp pattern, roles are enforced AT the verb. Architect = the
 *  Director's proxy surface (the B4 director-via-proxy convention). */
async function requireDirectorSurface(ctx: IPolicyContext): Promise<DecisionActor | PolicyResult> {
  const actor = await stampActor(ctx);
  if (actor.role !== "director" && actor.role !== "architect") {
    return err("forbidden", `${actor.role ?? "unregistered"} cannot operate the Director arrival surface — a non-Director render would falsely mark nudges PRESENTED (delivery = snapshot membership)`);
  }
  return actor;
}
function isPolicyResult(v: DecisionActor | PolicyResult): v is PolicyResult {
  return "content" in v;
}

/** The digest, recomputed from QUEUE STATE on every pull (never stored truth). */
async function computeDigest(ctx: IPolicyContext, sinceISO: string | null) {
  const decisions = ctx.stores.decision!;
  const arrival = ctx.stores.arrivalSurface!;
  // INCLUSIVE boundary (>=): an event stamped the same millisecond as the
  // cursor snapshot may double-report on the next pull — benign for a digest.
  // Strictly-greater would silently DROP it, which is the bug-225 failure
  // class this surface exists to kill.
  const after = (d: Decision) => sinceISO === null || d.updatedAt >= sinceISO;
  const [resolved, executed, disposed] = await Promise.all([
    decisions.listDecisions({ status: "resolved" }),
    decisions.listDecisions({ status: "executed" }),
    decisions.listDecisions({ status: "disposed" }),
  ]);
  const completed = [...resolved.items, ...executed.items];
  const selfDisposals = completed.filter((d) => after(d) &&
    (d.resolution?.authorityMode === "architect-t5" || d.resolution?.authorityMode === "class-grant"));
  const disposals = disposed.items.filter(after);
  const failureParks = resolved.items.filter((d) => d.executorBinding !== null && d.executorBinding.ok === false);
  const suppressed = (await arrival.openNudgeReceipts()).filter((n) => n.emittedRef === null);
  return {
    selfDisposals: selfDisposals.map((d) => ({ id: d.id, title: d.title, authorityMode: d.resolution!.authorityMode, authorityRef: d.resolution!.authorityRef ?? null })),
    disposals: disposals.map((d) => ({ id: d.id, title: d.title, reason: d.disposedReason })),
    failureParks: failureParks.map((d) => ({ id: d.id, title: d.title, results: d.executorBinding!.results })),
    suppressedNudges: suppressed.map((n) => ({ decisionId: n.decisionId, level: n.level, emittedAt: n.emittedAt })),
  };
}

async function renderArrivalSurface(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const decisions = ctx.stores.decision;
  const arrival = ctx.stores.arrivalSurface;
  if (!decisions || !arrival) return err("not_wired", "Decision/ArrivalSurface stores are not available");
  // work-128 (B8-R1): PROBE mode — the full pull (queue + digest + a snapshot
  // receipt on the caller-named surface; per-surface cursor chains are
  // isolated) with the two DELIVERY side effects skipped: no nudge-receipt
  // flip (a probe must never falsely mark Director nudges PRESENTED) and no
  // presence touch. The VERIFIER seat is probe-only — that's what lets him
  // live-execute contract #4 from his own seat without becoming a delivery
  // surface; architect/director may probe too (e.g. dry-checking a digest).
  const probe = args.probe === true;
  const actorRaw = await stampActor(ctx);
  if (actorRaw.role === "verifier" && !probe) {
    return err("forbidden", "verifier renders are probe-only — pass probe:true (a non-probe render flips nudge receipts to PRESENTED, which is Director-delivery accounting)");
  }
  if (actorRaw.role !== "director" && actorRaw.role !== "architect" && actorRaw.role !== "verifier") {
    return err("forbidden", `${actorRaw.role ?? "unregistered"} cannot operate the Director arrival surface — a non-Director render would falsely mark nudges PRESENTED (delivery = snapshot membership)`);
  }
  const actor = actorRaw;
  // audit-10269: probe isolation is STRUCTURAL, not caller discipline. A probe
  // render always lands in its own agent-scoped namespace — an omitted surface
  // can never advance the Director's production cursor ('default'), and a real
  // render can never claim a probe surface. latestSnapshot(surface) chains are
  // per-surface, so the two worlds cannot interact by construction.
  const requested = (args.surface as string | undefined) ?? "default";
  if (!probe && requested.startsWith("probe:")) {
    return err("invalid_arguments", "the 'probe:' surface namespace is reserved for probe renders — a real render on it would let a probe cursor shadow delivery accounting");
  }
  const surface = probe ? `probe:${actor.agentId}:${requested}` : requested;
  // PURE PULL: the queue is the single source (contract test 4 — complete with
  // every push channel dead). Cold start = no prior snapshot = everything.
  const prior = await arrival.latestSnapshot(surface);
  const { items: routed, truncated } = await decisions.listDecisions({ status: "routed", routedTarget: "director" });
  const digest = await computeDigest(ctx, prior?.renderedAt ?? null);
  const entries: SnapshotEntry[] = routed.map((d) => ({ decisionId: d.id, promptHash: canonicalPromptHash(d), status: d.status }));
  const snapshot = await arrival.recordSnapshot({
    surface,
    renderedFor: actor,
    sinceSnapshotId: prior?.id ?? null,
    entries,
    digest: {
      routedCount: routed.length,
      selfDisposalsSinceCursor: digest.selfDisposals.length,
      disposalsSinceCursor: digest.disposals.length,
      suppressedNudges: digest.suppressedNudges.length,
      failureParks: digest.failureParks.length,
    },
  });
  // DELIVERED = PRESENTED: open nudge receipts for rendered decisions flip now
  // — UNLESS this is a probe (work-128: probes are observation, not delivery).
  const presented = probe ? 0 : await arrival.markNudgesPresented(routed.map((d) => d.id), snapshot.id);
  // A Director pull is Director activity — presence flips present (S3.1).
  if (!probe && actor.role === "director") await arrival.touchDirectorActivity();
  return ok({
    probe,
    // Explicit for the verifier's B8b evidence (steve's amendment 2): a probe
    // response SAYS it skipped delivery, so the transcript is unambiguous.
    deliveryEffectsSkipped: probe,
    snapshotId: snapshot.id,
    queue: routed.map((d) => ({ id: d.id, title: d.title, class: d.class, context: d.context, options: d.options, executionPlan: d.executionPlan, enteredCurrentStateAt: d.enteredCurrentStateAt })),
    truncated,
    digest,
    nudgesPresented: presented,
    sinceSnapshotId: prior?.id ?? null,
  });
}

async function acknowledgeArrival(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const arrival = ctx.stores.arrivalSurface;
  if (!arrival) return err("not_wired", "ArrivalSurface store is not available");
  const gatedAck = await requireDirectorSurface(ctx);
  if (isPolicyResult(gatedAck)) return gatedAck;
  const snap = await arrival.markSnapshot(args.snapshotId as string, {
    ack: args.ack as string[] | undefined,
    defer: args.defer as string[] | undefined,
  });
  if (!snap) return err("not_found", `ArrivalSnapshot ${args.snapshotId} not found`);
  if (gatedAck.role === "director") await arrival.touchDirectorActivity();
  return ok({ snapshot: snap });
}

async function declareAwayStint(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const arrival = ctx.stores.arrivalSurface;
  if (!arrival) return err("not_wired", "ArrivalSurface store is not available");
  const gatedAway = await requireDirectorSurface(ctx);
  if (isPolicyResult(gatedAway)) return gatedAway;
  const presence = await arrival.setPresence("away", "declared", args.expectedReturn as string | undefined);
  return ok({ presence });
}

async function declarePresent(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const arrival = ctx.stores.arrivalSurface;
  if (!arrival) return err("not_wired", "ArrivalSurface store is not available");
  const gatedBack = await requireDirectorSurface(ctx);
  if (isPolicyResult(gatedBack)) return gatedBack;
  const presence = await arrival.setPresence("present", "declared");
  return ok({ presence });
}

/**
 * The EMIT-ONLY aging sweep (S2.4). Run on an interval by the hub boot; also
 * directly invocable (tests + manual). Reads dwell-in-routed, mints
 * NudgeReceipts, emits decision-aging-notification — never transitions.
 */
export async function runDecisionAgingSweep(ctx: IPolicyContext, nowISO?: string): Promise<{ emitted: number; suppressed: number; escalated: number }> {
  const decisions = ctx.stores.decision;
  const arrival = ctx.stores.arrivalSurface;
  if (!decisions || !arrival) return { emitted: 0, suppressed: 0, escalated: 0 };
  const now = nowISO ?? new Date().toISOString();
  const presence = await arrival.getPresence();
  const open = await arrival.openNudgeReceipts();
  const aging = await decisions.listAging(now, AGING_CRITICAL_MS); // the WIDER net; per-item threshold below
  let emitted = 0, suppressed = 0, escalated = 0;

  for (const d of aging) {
    if (d.routedTo?.target !== "director") continue;
    const critical = d.class !== null && CRITICAL_CLASSES.includes(d.class);
    const dwellMs = Date.parse(now) - Date.parse(d.enteredCurrentStateAt);
    if (dwellMs < (critical ? AGING_CRITICAL_MS : AGING_NORMAL_MS)) continue;
    const existing = open.find((n) => n.decisionId === d.id);
    if (existing) {
      // ONE escalation for critical (D-A1): bounded retry then side-channel, once.
      if (critical && existing.escalatedAt === null) {
        if (existing.retryCount < CRITICAL_MAX_RETRIES) {
          await emitAging(ctx, d, "critical-retry");
          await arrival.bumpNudge(existing.id, { retryCount: existing.retryCount + 1 });
          emitted++;
        } else {
          await emitAging(ctx, d, "side-channel-escalation");
          await arrival.bumpNudge(existing.id, { escalatedAt: now });
          escalated++;
        }
      }
      continue; // normal decisions nudge ONCE (S2.4)
    }
    if (presence.state === "away" && !critical) {
      // Suppressed nudges STILL mint receipts (emittedRef null) — backlog
      // accounting survives away-mode; the arrival digest surfaces them.
      await arrival.mintNudgeReceipt({ decisionId: d.id, level: "normal", emittedRef: null });
      suppressed++;
      continue;
    }
    const ref = await emitAging(ctx, d, critical ? "critical" : "normal");
    await arrival.mintNudgeReceipt({ decisionId: d.id, level: critical ? "critical" : "normal", emittedRef: ref });
    emitted++;
  }
  return { emitted, suppressed, escalated };
}

async function emitAging(ctx: IPolicyContext, d: Decision, kind: string): Promise<string | null> {
  try {
    // work-124 flood stopgap extension (same rule as decision events): aging
    // nudges concern the DIRECTOR queue — director + architect (the proxy
    // operator), never the whole network.
    let msg: unknown;
    for (const target of [{ role: "director" }, { role: "architect" }] as Array<import("../entities/message.js").MessageTarget>)
    msg = await emitAndPush(ctx, {
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "hub",
      target,
      delivery: "push-immediate",
      intent: "decision_aging",
      payload: {
        notificationEvent: DECISION_AGING_EVENT,
        decision_id: d.id,
        title: d.title,
        class: d.class,
        nudge_kind: kind,
        entered_routed_at: d.enteredCurrentStateAt,
        body: `${d.id} has waited in the Director queue since ${d.enteredCurrentStateAt} (${kind}) — "${d.title}"`,
      },
    });
    return (msg as { id?: string } | undefined)?.id ?? null;
  } catch (e) {
    console.error(`[arrival-surface] aging emit failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export function registerArrivalSurfacePolicy(router: PolicyRouter): void {
  router.register(
    "render_arrival_surface",
    "[Architect|Director|Verifier] THE Director arrival pull (design §1.4): the routed queue + since-you-left digest (self-disposals with their grant refs, disposal packets, suppressed-nudge accounting, failure parks) — a PURE function of queue state, complete with every push channel dead (the anti-bug-225 contract). Records the ArrivalSnapshot server-side (DELIVERED = membership), flips open nudge receipts to presented, and counts as Director activity (presence → present).",
    {
      surface: z.string().optional().describe("Rendering surface id (default 'default'); the snapshot cursor chain is per-surface"),
      probe: z.boolean().optional().describe("work-128: PROBE render — full pull + snapshot receipt on this surface, but NO delivery side effects (no nudge-receipt flip, no presence touch). REQUIRED for the verifier seat; available to architect/director"),
    },
    renderArrivalSurface,
  );

  router.register(
    "acknowledge_arrival",
    "[Architect|Director] Set ack/defer markers on a rendered snapshot (post-render). ACT is never a marker — it is the decision's own resolved/executed state.",
    {
      snapshotId: z.string(),
      ack: z.array(z.string()).optional().describe("Decision ids the Director has SEEN"),
      defer: z.array(z.string()).optional().describe("Decision ids consciously postponed"),
    },
    acknowledgeArrival,
  );

  router.register(
    "declare_away_stint",
    "[Architect|Director] Declare a Director away-stint (S3.1): suppresses NON-critical nudge emission (suppressed nudges still mint receipts — backlog accounting survives). Optional expectedReturn. Critical nudges + escalations still fire.",
    { expectedReturn: z.string().optional().describe("ISO-8601 expected return (advisory)") },
    declareAwayStint,
  );

  router.register(
    "declare_present",
    "[Architect|Director] End an away-stint explicitly. (Any Director activity — a pull, an answer — also flips present instantly.)",
    {},
    declarePresent,
  );
}
