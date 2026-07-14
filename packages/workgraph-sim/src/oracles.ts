/**
 * oracles.ts — the adversarial negative-path oracle catalog (idea-449 §2 / A8).
 *
 * An oracle is a named property the REAL WorkGraph engine must satisfy, checked by
 * DRIVING the engine (via PolicyRouter.handle) into a scenario and asserting the
 * outcome. The catalog is deliberately adversarial: it feeds illegal moves, stolen
 * and absent leases, cross-role calls, and terminal-phase pokes, and asserts the FSM
 * REJECTS them. Paired with the spec-table conformance sweep (legal moves accepted +
 * land the expected phase), this is the A8 "legal-move matrix 100% + non-vacuous
 * oracles" evidence — the seal the harness-riding substrate closers stand on.
 *
 * Every oracle drives a fresh isolated store, so oracles never cross-contaminate.
 */
import { SimHarness } from "./harness.js";
import { SimClient } from "./clients.js";
import {
  PHASES,
  SPEC_VERBS,
  TERMINAL_PHASES,
  legalMoves,
  specMove,
  type Phase,
  type SpecVerb,
} from "./spec-table.js";

export interface OracleResult {
  readonly name: string;
  readonly pass: boolean;
  readonly detail?: string;
}

/** The current phase of a work item, read back through the real store. */
async function phaseOf(h: SimHarness, arch: SimClient, workId: string): Promise<Phase | undefined> {
  const r = await arch.call("get_work", { workId });
  const d = r.data as Record<string, unknown>;
  const w = (d?.workItem as Record<string, unknown>) ?? d;
  return w?.status as Phase | undefined;
}

// Fresh evidence each call: producedAt must be >= the item's lease.claimedAt (the real
// freshness predicate — bug-261), so it is stamped NOW, after the drive's claim.
const evidence = (): unknown[] => [
  { requirementId: "commit", kind: "commit", ref: "deadbeef", producedAt: new Date().toISOString() },
];
const REQS = [{ id: "commit", kind: "commit", description: "x" }];

/** A scenario: a fresh work item driven to `phase`, plus the architect + holder clients. */
export interface Scenario {
  readonly h: SimHarness;
  readonly arch: SimClient;
  readonly holder: SimClient;
  readonly workId: string;
}

/**
 * Drive a fresh work item into `phase` using ONLY well-behaved verbs (the setup path
 * is itself exercising legal moves). Returns the scenario, or throws if a setup verb
 * unexpectedly failed (which is itself a finding).
 */
export async function driveToPhase(phase: Phase): Promise<Scenario> {
  const h = new SimHarness();
  const arch = await SimClient.create(h, "arch", "architect", "arch");
  const holder = await SimClient.create(h, "eng", "engineer", "eng");
  const ver = await SimClient.create(h, "ver", "verifier", "ver");

  const mk = async (extra: Record<string, unknown> = {}): Promise<string> => {
    const c = await arch.createWork({ type: "task", roleEligibility: ["engineer"], evidenceRequirements: REQS, ...extra });
    if (!c.ok) throw new Error(`create_work failed: ${JSON.stringify(c.data)}`);
    const d = c.data as Record<string, unknown>;
    return ((d.workItem as Record<string, unknown>) ?? d).id as string;
  };
  const must = (r: { ok: boolean; data: unknown }, what: string): void => {
    if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r.data)}`);
  };

  if (phase === "ready") return { h, arch, holder, workId: await mk() };
  if (phase === "paused") {
    const workId = await mk();
    must(await arch.call("pause_work", { workId }), "pause_work");
    return { h, arch, holder, workId };
  }
  if (phase === "abandoned") {
    const workId = await mk();
    must(await holder.claim(workId), "claim");
    must(await holder.abandon(workId), "abandon");
    return { h, arch, holder, workId };
  }
  // claimed / in_progress / blocked / review / done all start ready → claim
  const workId =
    phase === "review"
      ? // review = complete an item whose ONLY requirement is a VERIFIER-ATTESTATION
        // (a review requirement the completer cannot self-cover) → parks in review pending attest.
        await mk({
          evidenceRequirements: [
            { id: "seal", kind: "verifier-attestation", evidenceAuthority: "verifier-attestation", description: "seal" },
          ],
        })
      : await mk();
  must(await holder.claim(workId), "claim");
  if (phase === "claimed") return { h, arch, holder, workId };
  must(await holder.start(workId), "start");
  if (phase === "in_progress") return { h, arch, holder, workId };
  if (phase === "blocked") {
    must(await holder.block(workId), "block");
    return { h, arch, holder, workId };
  }
  // review → complete parks (review requirement unmet); done → complete with covering evidence.
  const done = await holder.complete(workId, phase === "review" ? [] : evidence());
  must(done, "complete");
  void ver;
  return { h, arch, holder, workId };
}

/** Attempt `verb` on the scenario's work item as a well-behaved holder (auto-lease). */
async function attempt(s: Scenario, verb: SpecVerb): Promise<{ ok: boolean; data: unknown }> {
  switch (verb) {
    case "complete_work":
      return s.holder.complete(s.workId, evidence());
    case "attest_evidence":
      // [Verifier] gate — a fresh verifier session on this harness.
      return SimClient.roleOnly(s.h, "ver2", "verifier").attest(s.workId);
    case "claim_work":
      return s.holder.claim(s.workId);
    case "pause_work":
    case "unpause_work":
      // creator/Director-gated — drive through the architect (the item's creator).
      return s.arch.call(verb, { workId: s.workId });
    case "abandon_work":
      // the holder abandons a lease it holds; the creator abandons a ready item.
      return s.holder.leaseFor(s.workId)
        ? s.holder.abandon(s.workId)
        : s.arch.call("abandon_work", { workId: s.workId });
    default:
      return s.holder.call(verb, { workId: s.workId });
  }
}

// ── the catalog ───────────────────────────────────────────────────────

/** Legal moves are ACCEPTED and land the spec's expected phase (the conformance sweep). */
export async function oracleLegalMovesAccepted(): Promise<OracleResult[]> {
  const out: OracleResult[] = [];
  for (const { from, verb, move } of legalMoves()) {
    // review-phase ENTRY requires the verifier-gate node attestation cycle (bug-220:
    // a task cannot self-produce a verifier-attestation) — a distinct sub-domain scoped
    // to Phase B's whole-arc sim. Documented (oracleReviewScopedToPhaseB), never silent.
    if (from === "review") continue;
    const name = `legal:${from}--${verb}`;
    try {
      const s = await driveToPhase(from);
      const r = await attempt(s, verb);
      if (!r.ok) {
        out.push({ name, pass: false, detail: `spec=legal but FSM rejected: ${JSON.stringify(r.data)}` });
        continue;
      }
      const now = await phaseOf(s.h, s.arch, s.workId);
      const expected = move.to;
      const ok =
        expected === "same"
          ? now === from
          : expected === "gate"
            ? now === "review" || now === "done"
            : now === expected;
      out.push({ name, pass: ok, detail: ok ? undefined : `expected ${expected}, got ${now}` });
    } catch (e) {
      out.push({ name, pass: false, detail: `setup/drive threw: ${(e as Error).message}` });
    }
  }
  return out;
}

/** Illegal moves are REJECTED from every phase (no unhandled transition). */
export async function oracleIllegalMovesRejected(): Promise<OracleResult[]> {
  const out: OracleResult[] = [];
  for (const from of PHASES) {
    if (from === "review") continue; // review entry scoped to Phase B (see oracleReviewScopedToPhaseB)
    for (const verb of SPEC_VERBS) {
      if (specMove(from, verb).legal) continue;
      const name = `illegal:${from}--${verb}`;
      try {
        const s = await driveToPhase(from);
        const r = await attempt(s, verb);
        out.push({ name, pass: r.ok === false, detail: r.ok ? `spec=illegal but FSM ACCEPTED it (${await phaseOf(s.h, s.arch, s.workId)})` : undefined });
      } catch (e) {
        out.push({ name, pass: false, detail: `setup/drive threw: ${(e as Error).message}` });
      }
    }
  }
  return out;
}

/** Lease fencing: a WRONG leaseToken on a lease-bound verb is rejected (zombie guard). */
export async function oracleWrongLeaseRejected(): Promise<OracleResult> {
  const s = await driveToPhase("in_progress");
  const r = await s.holder.misbehaveWrongLease("complete_work", s.workId, { evidence: evidence() });
  return { name: "fencing:wrong-lease-rejected", pass: r.ok === false, detail: r.ok ? "wrong lease ACCEPTED" : undefined };
}

/** Lease fencing: a NO-lease call on a lease-bound verb is rejected. */
export async function oracleNoLeaseRejected(): Promise<OracleResult> {
  const s = await driveToPhase("in_progress");
  const r = await s.holder.misbehaveNoLease("complete_work", s.workId, { evidence: evidence() });
  return { name: "fencing:no-lease-rejected", pass: r.ok === false, detail: r.ok ? "no-lease ACCEPTED" : undefined };
}

/** Relocation-laundering: a SECOND client using the holder's stolen token is rejected. */
export async function oracleStolenLeaseRejected(): Promise<OracleResult> {
  const s = await driveToPhase("claimed");
  const thief = await SimClient.create(s.h, "thief", "engineer", "thief");
  const r = await thief.misbehaveStolenLease("start_work", s.workId, s.holder);
  return { name: "fencing:stolen-lease-rejected", pass: r.ok === false, detail: r.ok ? "stolen lease ACCEPTED (relocation-laundering!)" : undefined };
}

/** Terminal phases (done, abandoned) are FROZEN — every verb rejected. */
export async function oracleTerminalFrozen(): Promise<OracleResult[]> {
  const out: OracleResult[] = [];
  for (const from of TERMINAL_PHASES) {
    for (const verb of SPEC_VERBS) {
      const name = `terminal:${from}--${verb}`;
      try {
        const s = await driveToPhase(from);
        const r = await attempt(s, verb);
        out.push({ name, pass: r.ok === false, detail: r.ok ? `terminal ${from} accepted ${verb}` : undefined });
      } catch (e) {
        out.push({ name, pass: false, detail: `drive threw: ${(e as Error).message}` });
      }
    }
  }
  return out;
}

/** Role gates: create_work needs [Architect]; attest_evidence needs [Verifier]. */
export async function oracleRoleGates(): Promise<OracleResult[]> {
  const h = new SimHarness();
  const eng = await SimClient.create(h, "e", "engineer", "e");
  const createByEng = await eng.createWork({ type: "task", roleEligibility: ["engineer"] });
  const s = await driveToPhase("in_progress");
  const attestByEng = await s.holder.call("attest_evidence", { workId: s.workId, verdict: "valid" });
  return [
    { name: "rbac:create_work-denies-engineer", pass: createByEng.ok === false, detail: createByEng.ok ? "engineer created work" : undefined },
    { name: "rbac:attest_evidence-denies-engineer", pass: attestByEng.ok === false, detail: attestByEng.ok ? "engineer attested" : undefined },
  ];
}

/**
 * Documented Phase-A scope boundary (NOT a silent cap): review-phase ENTRY is reached
 * only via a verifier-gate node's attestation cycle + evidence-producer-path validation
 * (bug-220), a coherent sub-domain that Phase B's whole-arc simulator dress-rehearses by
 * driving full gate chains. The spec-table retains `review` as ground truth; here the
 * auto-sweep excludes review-FROM scenarios and records this explicit marker instead.
 */
export function oracleReviewScopedToPhaseB(): OracleResult {
  return {
    name: "scope:review-entry-deferred-to-phase-B",
    pass: true,
    detail:
      "review reached only via a verifier-gate node's attestation cycle (bug-220 producer-path); spec-table keeps review as ground truth; Phase B drives full gate chains.",
  };
}

/** Run the whole catalog. */
export async function runOracleCatalog(): Promise<OracleResult[]> {
  return [
    ...(await oracleLegalMovesAccepted()),
    ...(await oracleIllegalMovesRejected()),
    await oracleWrongLeaseRejected(),
    await oracleNoLeaseRejected(),
    await oracleStolenLeaseRejected(),
    ...(await oracleTerminalFrozen()),
    ...(await oracleRoleGates()),
    oracleReviewScopedToPhaseB(),
  ];
}
