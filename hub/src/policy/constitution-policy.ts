/**
 * constitution-policy.ts — mission-103 P3-S1: the constitutional read surface
 * (design v1.0 §2, RATIFIED at G2 via decision-17).
 *
 * Four PURE read verbs — projections of the ConstitutionSnapshot singleton +
 * the current OrgCharter version. All [Any]: the constitution is for everyone.
 *
 * The payload law (binding, contract-tested): every response carries
 * `provenance {sourceRepo, sha, syncedAt, lastVerifiedAt, manifestHash, stale,
 * ageSeconds}` BESIDE content; charter responses additionally carry per-binding
 * {ratifiedBy, proofRef}. A response omitting provenance is a defect.
 *
 * Zero write verbs — enforcement by absence (T2: the PR gauntlet is the
 * ratification act; the Hub never writes axioms back). Charter mutation
 * exists ONLY as decision-rail registry actions (decision-executor.ts:
 * bind_axiom / amend_charter), never here.
 *
 * First boot: the loud `not_synced` error — structurally distinct from an
 * empty corpus. No unlabeled bootstrap content ever.
 */
import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";

function ok(body: Record<string, unknown>): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}
function err(errorKind: string, message: string): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message, errorKind }) }], isError: true };
}

const NOT_SYNCED_MSG =
  "constitution not yet synced: no snapshot has committed since boot — this is NOT an empty constitution; retry after the first sync tick (seconds-class) or check the sync loop / OIS_GH_API_TOKEN wiring";

async function getConstitution(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.constitution;
  if (!store) return err("not_wired", "Constitution store is not available");
  const snapshot = await store.getCurrent();
  if (!snapshot) return err("not_synced", NOT_SYNCED_MSG);
  const charter = await ctx.stores.orgCharter?.getCurrentCharter();
  return ok({
    provenance: store.buildProvenance(snapshot),
    axioms: snapshot.manifest.map((m) => ({ id: m.id, title: m.title, path: m.path, contentHash: m.contentHash, body: snapshot.files[m.path] })),
    charter: charter ?? null,
  });
}

async function listAxioms(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.constitution;
  if (!store) return err("not_wired", "Constitution store is not available");
  const snapshot = await store.getCurrent();
  if (!snapshot) return err("not_synced", NOT_SYNCED_MSG);
  return ok({ provenance: store.buildProvenance(snapshot), axioms: snapshot.manifest });
}

async function getAxiom(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const store = ctx.stores.constitution;
  if (!store) return err("not_wired", "Constitution store is not available");
  const snapshot = await store.getCurrent();
  if (!snapshot) return err("not_synced", NOT_SYNCED_MSG);
  const entry = snapshot.manifest.find((m) => m.id === args.axiomId);
  if (!entry) {
    return err("not_found", `axiom '${args.axiomId}' is not in the served constitution (sha ${snapshot.sha}); known: ${snapshot.manifest.map((m) => m.id).join(", ")}`);
  }
  return ok({ provenance: store.buildProvenance(snapshot), axiom: { ...entry, body: snapshot.files[entry.path] } });
}

async function getCharter(_args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const constitution = ctx.stores.constitution;
  const charterStore = ctx.stores.orgCharter;
  if (!constitution || !charterStore) return err("not_wired", "Constitution/OrgCharter stores are not available");
  const snapshot = await constitution.getCurrent();
  if (!snapshot) return err("not_synced", NOT_SYNCED_MSG);
  const charter = await charterStore.getCurrentCharter();
  return ok({
    provenance: constitution.buildProvenance(snapshot),
    charter: charter ?? null,
    note: charter ? undefined : "no charter version exists yet — bindings arrive via the batch ratification (bind_axiom rail actions)",
  });
}

export function registerConstitutionPolicy(router: PolicyRouter): void {
  router.register(
    "get_constitution",
    "[Any] THE COLD-START VERB (recall-proofness = one round trip): the whole constitutional corpus — manifest + every axiom body + the current org charter — with provenance {sourceRepo, sha, syncedAt, lastVerifiedAt, manifestHash, stale, ageSeconds} beside content. syncedAt identifies content acquisition; lastVerifiedAt drives freshness after successful upstream verification. Serves the last-good snapshot marked stale:true when verification lags (fail-open with honesty); loud not_synced before the first sync (never unlabeled bootstrap content).",
    {},
    getConstitution,
  );
  router.register(
    "list_axioms",
    "[Any] The axiom manifest (id, title, path, contentHash) + snapshot provenance. Cheap index over the served constitution.",
    {},
    listAxioms,
  );
  router.register(
    "get_axiom",
    "[Any] One axiom's verbatim markdown body + snapshot provenance. The content is served exactly as the mission-kit gauntlet ratified it (git is canonical; the Hub read-serves).",
    { axiomId: z.string().min(1).describe("Axiom id, e.g. 'A7'") },
    getAxiom,
  );
  router.register(
    "get_charter",
    "[Any] The current org-charter version (axiom bindings with per-binding {ratifiedBy, proofRef} rail provenance, vision, director profile) + snapshot provenance. Charter mutation has NO verbs — it exists only as decision-rail registry actions (bind_axiom / amend_charter).",
    {},
    getCharter,
  );
}
