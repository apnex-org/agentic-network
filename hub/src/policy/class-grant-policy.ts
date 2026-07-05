/**
 * class-grant-policy.ts — mission-102 P3-B3: the ClassGrant verb surface
 * (design.md v1.0 §1.2, RATIFIED at G2).
 *
 * Tools: mint_class_grant [Architect] · get_class_grant/list_class_grants [Any] ·
 * revoke_class_grant [Architect|Director].
 *
 * The mint is fail-closed on ratification: the grant packet is ratified by the
 * Director AS A DECISION through the rail (the grant is the rail's first cargo),
 * and mint_class_grant verifies the ratificationRef resolves to a Decision in
 * resolved|executed state whose resolution carries director-grade authority
 * (director-direct or director-via-proxy) — an architect-t5 or class-grant
 * resolution cannot ratify a grant (no self-amplifying delegation).
 */
import { z } from "zod";
import type { PolicyRouter } from "./router.js";
import type { IPolicyContext, PolicyResult } from "./types.js";
import { DecisionTransitionRejected } from "../entities/decision-repository-substrate.js";
import { canonicalGrantSpecHash, GRANT_SPEC_HASH_MARKER } from "../entities/class-grant-repository-substrate.js";

function ok(body: Record<string, unknown>): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify(body) }] };
}
function err(errorKind: string, message: string): PolicyResult {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message, errorKind }) }], isError: true };
}
function mapVerbError(e: unknown): PolicyResult {
  if (e instanceof DecisionTransitionRejected) return err("grant_rejected", e.message);
  throw e;
}

async function mintClassGrant(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const grants = ctx.stores.classGrant;
  const decisions = ctx.stores.decision;
  if (!grants || !decisions) return err("not_wired", "ClassGrant/Decision stores are not available");
  // Ratification proof: resolved|executed Decision with DIRECTOR-grade authority.
  const ratification = await decisions.getDecision(args.ratificationRef as string);
  const directorGrade = ratification?.resolution?.authorityMode === "director-direct" || ratification?.resolution?.authorityMode === "director-via-proxy";
  const ratified = !!ratification && (ratification.status === "resolved" || ratification.status === "executed") && directorGrade;
  const spec = {
    class: args.class as string,
    allowedActions: args.allowedActions as string[],
    reversibleOnly: (args.reversibleOnly as boolean | undefined) ?? true,
    parentKinds: (args.parentKinds as string[] | undefined) ?? null,
    excludedRefs: (args.excludedRefs as string[] | undefined) ?? [],
    excludedClasses: (args.excludedClasses as string[] | undefined) ?? [],
    representationDays: args.representationDays as number,
  };
  // PR #488 finding 1: the ratification decision must BIND this exact spec — its
  // context (covered by the Director's B4 confirmation promptHash) must carry the
  // canonical spec hash. An unrelated Director-grade decision, or ANY altered
  // field, diverges the hash and the mint REJECTS. The Director ratified THIS
  // grant, not "a decision".
  if (ratified) {
    const expected = `${GRANT_SPEC_HASH_MARKER}${canonicalGrantSpecHash(spec)}`;
    if (!ratification!.context.includes(expected)) {
      return err("grant_rejected", `mint rejected: ratification ${args.ratificationRef} does not bind this exact grant spec — its context must carry '${GRANT_SPEC_HASH_MARKER}<hash>' matching the supplied fields (recomputed: ${canonicalGrantSpecHash(spec)}). The Director ratifies a SPEC, not a label.`);
    }
  }
  try {
    const grant = await grants.mintGrant(
      { ...spec, ratificationRef: args.ratificationRef as string, supersedes: args.supersedes as string | undefined },
      // Due-date anchors to the DIRECTOR'S ratification instant, never mint time
      // (audit-9886: a delayed mint must not extend the delegation window).
      { resolved: ratified, resolvedAt: ratification?.resolution?.resolvedAt ?? null },
    );
    return ok({ grant });
  } catch (e) { return mapVerbError(e); }
}

async function getClassGrant(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const grants = ctx.stores.classGrant;
  if (!grants) return err("not_wired", "ClassGrant store is not available");
  const grant = await grants.getGrant(args.grantId as string);
  return grant ? ok({ grant }) : err("not_found", `ClassGrant ${args.grantId} not found`);
}

async function listClassGrants(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const grants = ctx.stores.classGrant;
  if (!grants) return err("not_wired", "ClassGrant store is not available");
  const { items, truncated } = await grants.listGrants({
    state: args.state as "active" | "revoked" | "superseded" | undefined,
    class: args.class as string | undefined,
  });
  return ok({ grants: items, count: items.length, truncated });
}

async function revokeClassGrant(args: Record<string, unknown>, ctx: IPolicyContext): Promise<PolicyResult> {
  const grants = ctx.stores.classGrant;
  if (!grants) return err("not_wired", "ClassGrant store is not available");
  try {
    const grant = await grants.revokeGrant(args.grantId as string, args.reason as string);
    return grant ? ok({ grant }) : err("not_found", `ClassGrant ${args.grantId} not found`);
  } catch (e) { return mapVerbError(e); }
}

const GRANT_STATE = z.enum(["active", "revoked", "superseded"]);

export function registerClassGrantPolicy(router: PolicyRouter): void {
  router.register(
    "mint_class_grant",
    "[Architect] Mint a ratified ClassGrant (typed-constraint fields, immutable per version — new version = new row via supersedes). FAIL-CLOSED: ratificationRef must resolve to a resolved/executed Decision carrying DIRECTOR-grade authority (director-direct|director-via-proxy) — a t5/class-grant resolution cannot ratify a grant (no self-amplifying delegation). A reversibleOnly grant listing non-reversible actions rejects at mint (self-contradiction).",
    {
      class: z.string().min(1).describe("The ontology class the grant covers — EXACT match at evaluation"),
      allowedActions: z.array(z.enum(["unblock", "approve"])).min(1).describe("Registry actions the grant may authorize (v1 registry)"),
      reversibleOnly: z.boolean().optional().describe("Default true — plans with non-reversible actions reject"),
      parentKinds: z.array(z.string()).optional().describe("Allowlist for the decision's parentRef.kind"),
      excludedRefs: z.array(z.string()).optional().describe("Machine-checkable forbidden boundary rows (refs the grant may never touch)"),
      excludedClasses: z.array(z.string()).optional().describe("Classes explicitly never covered (belt against reclassification)"),
      ratificationRef: z.string().describe("The resolved Decision that ratified this grant — its context MUST carry grant-spec-hash:<hash> matching these exact fields"),
      representationDays: z.number().int().positive().describe("Re-presentation policy in days (part of the canonical spec hash; the instant is computed at mint)"),
      supersedes: z.string().optional().describe("Prior grant row this version replaces (marks it superseded, links the chain)"),
    },
    mintClassGrant,
  );

  router.register(
    "get_class_grant",
    "[Any] Read a ClassGrant by id (any state — revoked/superseded rows are history, never deleted).",
    { grantId: z.string() },
    getClassGrant,
  );

  router.register(
    "list_class_grants",
    "[Any] List ClassGrants with optional state/class filters (the Director's 'show every item classified under grant X' verification surface starts here).",
    { state: GRANT_STATE.optional(), class: z.string().optional() },
    listClassGrants,
  );

  router.register(
    "revoke_class_grant",
    "[Architect|Director] Revoke an active ClassGrant (terminal; reason required). Evaluation rejects revoked grants immediately on the next fresh read; historical resolutions retain id@version (contract test 3).",
    { grantId: z.string(), reason: z.string().min(1) },
    revokeClassGrant,
  );
}
