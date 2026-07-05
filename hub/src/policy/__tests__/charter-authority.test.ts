/**
 * work-150 (mission-103 P3-S1) — the charter authority set (design v1.0 §2/§6,
 * steve's five binding rows adopted at G2):
 *
 *   1. NO-RAW-WRITES: no router verb mutates the charter — mutation exists
 *      ONLY as decision-plan registry actions (enforcement by absence);
 *   2. RAIL-REQUIRED: bind_axiom / amend_charter effects fire exclusively
 *      through the atomic resolve+execute path (B5), never standalone;
 *   3. BINDING EXACTNESS: the appended record carries the EXECUTING decision
 *      id + its authority proof — Hub-bound, never caller-supplied;
 *   4. APPEND-ONLY: every amendment is a new version row; prior versions
 *      are immutable (no code path rewrites them);
 *   5. SELF-REFERENCE GUARD: a binding cannot cite itself as its own
 *      predecessor/supersedes — rejected pre-effect (contract 11: the
 *      decision stays routed, ZERO charter effects).
 *
 * Real repos through the router; the rail path runs the full proof loop
 * (mint confirmation → Director capture → resolve_as_director proofRef).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerDecisionPolicy } from "../decision-policy.js";
import { registerDirectorProofPolicy } from "../director-proof-policy.js";
import { registerConstitutionPolicy } from "../constitution-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";
import { DirectorProofRepositorySubstrate } from "../../entities/director-proof-repository-substrate.js";
import {
  ConstitutionRepositorySubstrate,
  OrgCharterRepositorySubstrate,
} from "../../entities/constitution-repository-substrate.js";
import { parseGate } from "../../storage-substrate/constitution-sync.js";
import type { DecisionActor, DecisionPlanAction } from "../../entities/decision.js";

const RAISER: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "s-a" };
const CORPUS = {
  "axioms/A1.md": "# Evidence Over Assertion\n\nShow, don't claim.",
  "axioms/A7.md": "# Fault Boundaries\n\nBlame the boundary.",
};

function body(r: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(r.content[0].text);
}

describe("charter authority set (work-150 / mission-103 S1)", () => {
  let router: PolicyRouter;
  let archCtx: TestPolicyContext;
  let dirCtx: TestPolicyContext;
  let decisions: DecisionRepositorySubstrate;
  let proofs: DirectorProofRepositorySubstrate;
  let constitution: ConstitutionRepositorySubstrate;
  let charter: OrgCharterRepositorySubstrate;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    decisions = new DecisionRepositorySubstrate(substrate, counter);
    proofs = new DirectorProofRepositorySubstrate(substrate, counter);
    constitution = new ConstitutionRepositorySubstrate(substrate, { sourceRepo: "apnex/mission-kit", staleAfterMs: 600_000 });
    charter = new OrgCharterRepositorySubstrate(substrate, counter);
    router = new PolicyRouter();
    registerDecisionPolicy(router);
    registerDirectorProofPolicy(router);
    registerConstitutionPolicy(router);
    archCtx = createTestContext({ role: "architect" });
    dirCtx = createTestContext({ role: "director" });
    for (const c of [archCtx, dirCtx]) {
      c.stores.decision = decisions;
      c.stores.directorProof = proofs;
      c.stores.constitution = constitution;
      c.stores.orgCharter = charter;
    }
    dirCtx.stores.message = archCtx.stores.message;
    // The served constitution the bindings gate against.
    await constitution.swapSnapshot({
      sha: "sha-live", syncedAt: new Date().toISOString(), manifestHash: "mh",
      files: CORPUS, manifest: parseGate(CORPUS),
    });
  });

  /** The full rail: routed decision with plan → confirmation → Director
   *  answer → resolve_as_director(proofRef). Returns {decisionId, dconfId}. */
  async function railResolve(plan: DecisionPlanAction[], over: { contextRefs?: unknown[] } = {}): Promise<{ decisionId: string; dconfId: string }> {
    const d = await decisions.raiseDecision({
      title: "charter change", context: "c", class: "constitutional",
      options: [{ id: "yes", label: "Yes", description: "y" }], raisedBy: RAISER,
      // Design §4: a constitutional plan action executes only on a decision
      // CARRYING required evidence (the S2 batch's = the fidelity audit).
      contextRefs: (over.contextRefs ?? [{ kind: "audit", ref: "audit-fidelity-1", storage: "entity", mode: "read", required: true }]) as never,
    });
    await decisions.curateDecision(d.id, RAISER);
    await decisions.routeDecision(d.id, RAISER, { target: "director" }, plan);
    const minted = body(await router.handle("mint_director_confirmation", { decisionId: d.id, chosenOptionId: "yes" }, archCtx)) as { confirmation: { id: string } };
    const captured = await router.handle("capture_director_signal", {
      channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "authenticated", confirmationId: minted.confirmation.id,
    }, dirCtx);
    expect(captured.isError).toBeFalsy();
    const resolved = await router.handle("resolve_as_director", { decisionId: d.id, chosenOptionId: "yes", proofRef: minted.confirmation.id }, archCtx);
    expect(resolved.isError, `resolve failed: ${resolved.content[0].text}`).toBeFalsy();
    return { decisionId: d.id, dconfId: minted.confirmation.id };
  }

  it("NO-RAW-WRITES: the tool surface has ZERO charter mutation verbs — enforcement by absence", () => {
    const catalog = router.getRegisteredTools();
    expect(catalog).toContain("get_charter");            // the read exists...
    for (const forbidden of ["bind_axiom", "amend_charter", "create_charter", "update_charter", "set_charter"]) {
      expect(catalog, `verb '${forbidden}' must NOT exist as a tool`).not.toContain(forbidden);
    }
  });

  it("RAIL-REQUIRED + BINDING EXACTNESS: bind_axiom through the full proof loop stamps the EXECUTING decision + consumed confirmation on the record", async () => {
    const { decisionId, dconfId } = await railResolve([
      { action: "bind_axiom", targetRef: "A7", params: { predecessor: "tele-7" } },
    ]);
    const current = await charter.getCurrentCharter();
    expect(current).not.toBeNull();
    expect(current!.bindings).toHaveLength(1);
    const b = current!.bindings[0];
    expect(b.axiom).toBe("A7");
    expect(b.predecessor).toBe("tele-7");
    expect(b.status).toBe("bound");
    expect(b.ratifiedBy).toBe(decisionId);   // the EXECUTING decision — Hub-bound
    expect(b.proofRef).toBe(dconfId);        // the consumed confirmation — never caller text
    // ...and the decision reached `executed` (the B5 atomic close).
    const d = await decisions.getDecision(decisionId);
    expect(d!.status).toBe("executed");
  });

  it("the BATCH shape (S2 preview): one decision, multiple bind_axiom steps — one {ratifiedBy, proofRef} pair stamped across all rows", async () => {
    const { decisionId, dconfId } = await railResolve([
      { action: "bind_axiom", targetRef: "A1", params: { predecessor: "tele-1" } },
      { action: "bind_axiom", targetRef: "A7", params: { predecessor: "tele-7" } },
    ]);
    const current = await charter.getCurrentCharter();
    expect(current!.bindings).toHaveLength(2);
    for (const b of current!.bindings) {
      expect(b.ratifiedBy).toBe(decisionId);
      expect(b.proofRef).toBe(dconfId);
    }
  });

  it("APPEND-ONLY: every amendment is a NEW version row; the prior version is untouched and lineage-linked", async () => {
    await railResolve([{ action: "bind_axiom", targetRef: "A1" }]);
    const v1 = await charter.getCurrentCharter();
    await railResolve([{ action: "amend_charter", targetRef: "vision", params: { text: "Compounding evidence-first autonomy." } }]);
    const v2 = await charter.getCurrentCharter();
    expect(v2!.charterVersion).toBeGreaterThan(v1!.charterVersion);
    expect(v2!.supersedes).toBe(v1!.id);
    expect(v2!.bindings).toEqual(v1!.bindings);           // carried forward
    expect(v2!.vision!.text).toContain("Compounding");
    expect(v2!.vision!.ratificationRef).toMatch(/^decision-\d+:dconf-/); // rail provenance on the section
    expect(v1!.vision).toBeNull();                        // the prior ROW is immutable — not retro-edited
  });

  it("SELF-REFERENCE GUARD is pre-effect (contract 11): predecessor==axiom rejects at validatePlan — decision stays routed, ZERO charter effects", async () => {
    const d = await decisions.raiseDecision({
      title: "self-ref", context: "c", class: "constitutional",
      options: [{ id: "yes", label: "Yes", description: "y" }], raisedBy: RAISER,
      contextRefs: [{ kind: "audit", ref: "audit-fidelity-1", storage: "entity", mode: "read", required: true }] as never,
    });
    await decisions.curateDecision(d.id, RAISER);
    await decisions.routeDecision(d.id, RAISER, { target: "director" }, [
      { action: "bind_axiom", targetRef: "A7", params: { predecessor: "A7" } },
    ]);
    const minted = body(await router.handle("mint_director_confirmation", { decisionId: d.id, chosenOptionId: "yes" }, archCtx)) as { confirmation: { id: string } };
    await router.handle("capture_director_signal", { channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "authenticated", confirmationId: minted.confirmation.id }, dirCtx);
    const r = await router.handle("resolve_as_director", { decisionId: d.id, chosenOptionId: "yes", proofRef: minted.confirmation.id }, archCtx);
    expect(r.isError).toBe(true);
    expect(String((body(r) as { error: string }).error)).toContain("self-reference");
    expect((await decisions.getDecision(d.id))!.status).toBe("routed"); // whole-transition reject
    expect(await charter.getCurrentCharter()).toBeNull();               // zero effects
  });

  it("DESIGN §4 EVIDENCE GATE: a constitutional plan action on an evidence-free decision rejects pre-effect (the complete_work anti-gameability posture)", async () => {
    const d = await decisions.raiseDecision({
      title: "no evidence", context: "c", class: "constitutional",
      options: [{ id: "yes", label: "Yes", description: "y" }], raisedBy: RAISER,
      // NO contextRefs — the batch without its fidelity audit.
    });
    await decisions.curateDecision(d.id, RAISER);
    await decisions.routeDecision(d.id, RAISER, { target: "director" }, [{ action: "bind_axiom", targetRef: "A7" }]);
    const minted = body(await router.handle("mint_director_confirmation", { decisionId: d.id, chosenOptionId: "yes" }, archCtx)) as { confirmation: { id: string } };
    await router.handle("capture_director_signal", { channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "authenticated", confirmationId: minted.confirmation.id }, dirCtx);
    const r = await router.handle("resolve_as_director", { decisionId: d.id, chosenOptionId: "yes", proofRef: minted.confirmation.id }, archCtx);
    expect(r.isError).toBe(true);
    expect(String((body(r) as { error: string }).error)).toContain("required evidence");
    expect((await decisions.getDecision(d.id))!.status).toBe("routed"); // whole-transition reject
    expect(await charter.getCurrentCharter()).toBeNull();               // zero effects
  });

  it("REFERENTIAL pre-effect: bind_axiom to an axiom NOT in the served constitution rejects with zero effects; so does binding before any sync", async () => {
    const d = await decisions.raiseDecision({
      title: "dangling", context: "c", class: "constitutional",
      options: [{ id: "yes", label: "Yes", description: "y" }], raisedBy: RAISER,
      contextRefs: [{ kind: "audit", ref: "audit-fidelity-1", storage: "entity", mode: "read", required: true }] as never,
    });
    await decisions.curateDecision(d.id, RAISER);
    await decisions.routeDecision(d.id, RAISER, { target: "director" }, [{ action: "bind_axiom", targetRef: "A99" }]);
    const minted = body(await router.handle("mint_director_confirmation", { decisionId: d.id, chosenOptionId: "yes" }, archCtx)) as { confirmation: { id: string } };
    await router.handle("capture_director_signal", { channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "authenticated", confirmationId: minted.confirmation.id }, dirCtx);
    const r = await router.handle("resolve_as_director", { decisionId: d.id, chosenOptionId: "yes", proofRef: minted.confirmation.id }, archCtx);
    expect(r.isError).toBe(true);
    expect(String((body(r) as { error: string }).error)).toContain("not in the served constitution");
    expect((await decisions.getDecision(d.id))!.status).toBe("routed");
  });

  it("amend_charter validation: empty text and an unknown section both reject pre-effect", async () => {
    for (const plan of [
      [{ action: "amend_charter", targetRef: "vision", params: { text: "  " } }],
      [{ action: "amend_charter", targetRef: "motto", params: { text: "hi" } }],
    ] as DecisionPlanAction[][]) {
      const d = await decisions.raiseDecision({
        title: "bad amend", context: "c", class: "constitutional",
        options: [{ id: "yes", label: "Yes", description: "y" }], raisedBy: RAISER,
        contextRefs: [{ kind: "audit", ref: "audit-fidelity-1", storage: "entity", mode: "read", required: true }] as never,
      });
      await decisions.curateDecision(d.id, RAISER);
      await decisions.routeDecision(d.id, RAISER, { target: "director" }, plan);
      const minted = body(await router.handle("mint_director_confirmation", { decisionId: d.id, chosenOptionId: "yes" }, archCtx)) as { confirmation: { id: string } };
      await router.handle("capture_director_signal", { channel: "ois-say", answer: "yes", capturedBySurface: "cli", confidence: "authenticated", confirmationId: minted.confirmation.id }, dirCtx);
      const r = await router.handle("resolve_as_director", { decisionId: d.id, chosenOptionId: "yes", proofRef: minted.confirmation.id }, archCtx);
      expect(r.isError, `plan ${JSON.stringify(plan)} must reject`).toBe(true);
      expect((await decisions.getDecision(d.id))!.status).toBe("routed");
    }
  });

  it("duplicate live binding rejects at the effect (loud in the executor binding), and explicit supersession works", async () => {
    await railResolve([{ action: "bind_axiom", targetRef: "A7" }]);
    // A second live bind WITHOUT supersedes: validatePlan passes (registry +
    // referential are fine) but the EFFECT fails at the repo's duplicate
    // guard → the decision parks in `resolved` with the failure recorded in
    // the executor binding (the B5 failure-park path — loud, never silent).
    const { decisionId } = await railResolve([{ action: "bind_axiom", targetRef: "A7" }]);
    const parked = await decisions.getDecision(decisionId);
    expect(parked!.status).toBe("resolved");
    expect(JSON.stringify(parked!.executorBinding ?? "")).toContain("live binding");
    // Explicit supersession: allowed, old row flips superseded.
    await railResolve([{ action: "bind_axiom", targetRef: "A7", params: { supersedes: "A7-v1", predecessor: "tele-7" } }]);
    const current = await charter.getCurrentCharter();
    const live = current!.bindings.filter((b) => b.axiom === "A7" && b.status === "bound");
    expect(live).toHaveLength(1);
    expect(live[0].predecessor).toBe("tele-7");
  });
});
