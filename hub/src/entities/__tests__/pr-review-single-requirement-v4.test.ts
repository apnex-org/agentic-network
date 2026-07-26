// bug-377 — A PR-REVIEW OBLIGATION IS ONE PERSON'S TASK.
//
// The projection minted TWO requirements: the reviewer's own artifact, and a second party's
// `verifier-attestation` that the artifact matched. THAT SECOND PARTY WAS NEVER INTENDED TO EXIST —
// the node's runbook asks one reviewer to review a PR and close the item. The reviewer entered
// executorHistory by submitting the artifact and was then blocked from attesting it, parking the
// row in `review` forever; and because a parent's `completionDependsOn` clears ONLY on `done`, the
// parent wedged permanently.
//
// TWO HALVES, BOTH REQUIRED AND NEITHER SUFFICIENT:
//   (1) the two projection rules stop minting the retired requirement  -> no NEW bad rows;
//   (2) evaluateCompletionGate disregards it on a PR-review projection  -> EXISTING bad rows
//       discharge, because evidenceRequirements is IMMUTABLE DATA and the predicate is CODE.
//
// Every case below drives PRODUCTION code: the real projection functions and the real
// WorkItemRepositorySubstrate over an in-memory substrate. Nothing re-implements the predicate.
import { describe, expect, it } from "vitest";
import { evaluateCompletionGate, isProjectedPrReviewObligation, PR_REVIEW_PROJECTION_RULE_ID } from "../work-item.js";
import type { WorkItem } from "../work-item.js";
import { projectPrEvidenceReviewWorkItem } from "../../policy/pr-review-workitem-projection.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";

const NOW = "2026-07-25T22:40:00.000Z";
const ARCHITECT = { role: "architect", agentId: "architect-1" };
/** bug-383 — the Hub-derived author the PR-review projection actually stamps. Verified against the
 *  live row work-prrev-285de00237d65645765a838f, not invented for the fixture. */
const PROJECTION_AUTHOR = { role: "architect", agentId: "system-pr-review-rule" };

/** The RETIRED requirement, verbatim as live rows still carry it. */
const RETIRED_REQ = {
  id: "independent_pr_review_validation",
  kind: "review",
  evidenceAuthority: "verifier-attestation",
  description: "retired by bug-377; live rows still carry it",
} as const;

const ARTIFACT_REQ = { id: "github_review_artifact", kind: "freeform", description: "the reviewer's own artifact" } as const;

/** payload marker the projection stamps; the carve-out keys on THIS and nothing else. */
const PR_REVIEW_PAYLOAD = { obligationKind: "github_pr_review_request", repo: "apnex-org/agentic-network", prNumber: 677 };

function work(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id, type: "task", priority: "normal", roleEligibility: ["verifier"],
    dependsOn: [], completionDependsOn: [], evidenceRequirements: [], references: [],
    targetRef: null, status: "ready", lease: null,
    evidence: [], frictionReflections: [], blockedOn: null, leaseExpiryCount: 0,
    enteredCurrentStateAt: NOW,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    attestationHistory: [], attestations: {}, executorHistory: [], createdBy: ARCHITECT,
    createdAt: NOW, updatedAt: NOW, ...over,
  } as WorkItem;
}

function harness() {
  const substrate = createMemoryStorageSubstrate();
  return { substrate, repo: new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate)) };
}

describe("bug-377 — the projection mints ONE requirement", () => {
  it("🔴 projectPrEvidenceReviewWorkItem emits exactly one requirement, and NO verifier-attestation", () => {
    // Drives the real exported projection entry point (the mint itself lives in the non-exported
    // toPrEvidenceReviewObligationDraft it calls), so this asserts production's output, not a
    // re-description of it.
    const result = projectPrEvidenceReviewWorkItem({
      binding: {
        id: "work-524", repo: "apnex-org/agentic-network", prNumber: 677,
        targetWorkId: "work-bp-wgedit0-m140_residue", provenance: "hub",
        headSha: "0535d3f5", baseSha: "bbedcd7f", lastPusherLogin: "apnex-greg", authorLogin: "apnex-greg",
      } as never,
      locator: {
        repo: "apnex-org/agentic-network", prNumber: 677, source: "github_pr_url",
        raw: "https://github.com/apnex-org/agentic-network/pull/677",
        url: "https://github.com/apnex-org/agentic-network/pull/677",
      } as never,
      sourceMessageId: "pr-evidence:work-bp-wgedit0-m140_residue:pr",
      eligibility: {
        contractVersion: "pr-reviewer-eligibility-v1", ok: true,
        requiredTeams: ["engineer"], pathClasses: ["hub_code"],
        selectedReviewers: [{ agentId: "agent-f148389d", role: "verifier", githubLogin: "apnex" }],
        requestedReviewerStatus: "not_requested", disqualified: [],
        policyVersion: "apnex-agentic-network-review-policy-2026-07-17",
        policySourceRef: "docs/reports/pr-reviewer-eligibility0-behavior.md",
        lastPusherLogin: "apnex-greg",
      } as never,
    });

    expect(result.action, "the fixture must actually reach the create path, or the assertions below are vacuous").toBe("create_review_workitem");
    const reqs = (result as { createSpec: { evidenceRequirements: Array<{ id: string; evidenceAuthority?: string }> } }).createSpec.evidenceRequirements;
    expect(reqs.map((r) => r.id)).toEqual(["github_review_artifact"]);
    expect(
      reqs.filter((r) => r.evidenceAuthority === "verifier-attestation"),
      "NO requirement may demand an attester this design does not have",
    ).toEqual([]);
  });

  // The SECOND mint site (pr-review-request-static-rule.ts) is retired at the TYPE level: the
  // `independent_pr_review_validation` variant was removed from PrReviewObligationDraft's union,
  // so re-adding it is a COMPILE ERROR rather than a test someone can delete. tsc is the guard.
});

describe("bug-377 — the gate carve-out, and its blast radius", () => {
  it("🔴 THE LIVE WEDGE: a row ALREADY carrying the retired requirement is NOT pending", () => {
    // This is the shape of work-prrev-637748e92d1b6f7d61ff4a65 — immutable requirement, no
    // attestation, and no attester who could ever supply one. bug-383: the fixture now carries
    // the Hub-derived author the projection ACTUALLY stamps (verified against the live row
    // work-prrev-285de00237d65645765a838f). It previously carried `architect-1`, i.e. it modelled
    // a CALLER-AUTHORED row while claiming to model a projected one — and that gap is precisely
    // what let the payload-only predicate look correct.
    const row = work("work-prrev-x", { createdBy: PROJECTION_AUTHOR, payload: PR_REVIEW_PAYLOAD, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    const gate = evaluateCompletionGate(row);
    expect(gate.attestationReqsSatisfied, "the existing row must discharge — the requirement is data, the predicate is code").toBe(true);
    expect(gate.pendingAttestationReqs).toEqual([]);
  });

  it("🔴 NEGATIVE CONTROL: the SAME requirement on a NON-PR-review row still blocks", () => {
    // Proves the carve-out is keyed on the projection marker, not on evidenceAuthority — i.e. that
    // NO other node kind lost enforcement. Without this, case 1 is indistinguishable from having
    // disabled the attestation gate globally.
    const row = work("work-normal", { payload: { some: "other-node" }, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    const gate = evaluateCompletionGate(row);
    expect(gate.attestationReqsSatisfied, "a normal node MUST still require its verifier attestation").toBe(false);
    expect(gate.pendingAttestationReqs).toEqual(["independent_pr_review_validation"]);
  });

  it("a row with NO payload at all still blocks (undefined payload must not read as a PR review)", () => {
    const row = work("work-nopayload", { evidenceRequirements: [RETIRED_REQ] as never });
    expect(evaluateCompletionGate(row).attestationReqsSatisfied).toBe(false);
  });

  it("the marker predicate does not match a string payload or an array", () => {
    // A string or array payload must never be coerced into matching.
    expect(isProjectedPrReviewObligation({ createdBy: PROJECTION_AUTHOR, payload: JSON.stringify(PR_REVIEW_PAYLOAD) } as never)).toBe(false);
    expect(isProjectedPrReviewObligation({ createdBy: PROJECTION_AUTHOR, payload: [PR_REVIEW_PAYLOAD] } as never)).toBe(false);
    expect(isProjectedPrReviewObligation({ createdBy: PROJECTION_AUTHOR, payload: PR_REVIEW_PAYLOAD } as never)).toBe(true);
  });
});

// ── bug-383 — THE SELF-ATTESTATION BYPASS ────────────────────────────────────────────────────
//
// The carve-out used to open on `payload.obligationKind` ALONE. `payload` is CALLER-WRITABLE on
// BOTH write paths, so any author could mint the marker on their own row and have every
// `verifier-attestation` requirement skipped.
//
// THE PREMISE THAT HID IT, CORRECTED HERE: the previous suite asserted the create path was
// defended "because create_work stores a JSON-STRING payload raw". IT DOES NOT. `create_work`
// passes `args.payload` through untouched (`z.unknown()`, no coercion) and stores whatever it is
// given — an OBJECT if the caller sends an object. The JSON-string rows were a CALLER'S HABIT
// being read as a control. Measured first-party before this fix: ONE `create_work` call with an
// object payload returned `attestationReqsSatisfied: true` against a live verifier-attestation
// requirement. The bypass needed no `update_work` and no `ready` window.
//
// PER-VERB RED SETS ARE THE POINT: `update_work` and `create_work` are asserted SEPARATELY below.
// Two guards that produce the same red set mean one of them is untested and you cannot tell which.
describe("bug-383 — a caller cannot mint the carve-out on either write path", () => {
  it("🔴 create_work path: a caller-authored row with the OBJECT marker gets NO carve-out", () => {
    // The one-call bypass, in the shape the probe measured. `createdBy` is Hub-derived from the
    // session, so a caller-authored row can never carry the projection author.
    const row = work("work-forged-create", { payload: PR_REVIEW_PAYLOAD, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    expect(isProjectedPrReviewObligation(row), "a payload marker alone must NOT open the carve-out").toBe(false);
    const gate = evaluateCompletionGate(row);
    expect(gate.attestationReqsSatisfied, "the verifier-attestation requirement MUST still bind").toBe(false);
    expect(gate.pendingAttestationReqs).toEqual(["independent_pr_review_validation"]);
  });

  it("🔴 update_work path: ALTERING payload onto an existing row gets NO carve-out either", () => {
    // Same row, mutated the way update_work mutates it: payload replaced wholesale, post-create.
    const before = work("work-forged-update", { payload: { some: "other-node" }, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    expect(evaluateCompletionGate(before).attestationReqsSatisfied).toBe(false);
    const after = { ...before, payload: PR_REVIEW_PAYLOAD };
    expect(isProjectedPrReviewObligation(after), "overwriting payload must not buy the carve-out").toBe(false);
    expect(evaluateCompletionGate(after).attestationReqsSatisfied, "update_work cannot reach the carve-out").toBe(false);
  });

  it("🔴 forging the SERVER-STAMPED marker in payload does not work either", () => {
    // The marker's NAME is public — this proves the carve-out reads the top-level server field,
    // not anything a caller can spell inside payload.
    const row = work("work-forged-nested", {
      payload: { ...PR_REVIEW_PAYLOAD, systemProjection: { ruleId: PR_REVIEW_PROJECTION_RULE_ID } },
      evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never,
    });
    expect(isProjectedPrReviewObligation(row)).toBe(false);
    expect(evaluateCompletionGate(row).attestationReqsSatisfied).toBe(false);
  });

  it("🔴 claiming the projection AUTHOR without the payload marker does not work", () => {
    // Isolates the legacy branch's second conjunct: author alone is not sufficient.
    const row = work("work-author-only", { createdBy: PROJECTION_AUTHOR, payload: { some: "other-node" }, evidenceRequirements: [RETIRED_REQ] as never });
    expect(isProjectedPrReviewObligation(row)).toBe(false);
    expect(evaluateCompletionGate(row).attestationReqsSatisfied).toBe(false);
  });

  it("🔴 POSITIVE CONTROL: the server-stamped marker DOES open the carve-out", () => {
    // Without this, every case above is satisfiable by a predicate that always returns false —
    // i.e. by having disabled the carve-out entirely and re-wedged bug-377.
    const row = work("work-projected-new", {
      createdBy: ARCHITECT, // deliberately NOT the projection author: the stamp alone must suffice
      systemProjection: { ruleId: PR_REVIEW_PROJECTION_RULE_ID },
      payload: { obligationKind: "something-else-entirely" },
      evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never,
    });
    expect(isProjectedPrReviewObligation(row), "the server stamp is sufficient on its own").toBe(true);
    expect(evaluateCompletionGate(row).attestationReqsSatisfied).toBe(true);
  });

  it("🔴 a WRONG ruleId in the server field does not open the carve-out", () => {
    const row = work("work-wrong-rule", {
      systemProjection: { ruleId: "some_other_rule_v0" },
      evidenceRequirements: [RETIRED_REQ] as never,
    });
    expect(isProjectedPrReviewObligation(row)).toBe(false);
    expect(evaluateCompletionGate(row).attestationReqsSatisfied).toBe(false);
  });
});

describe("bug-377 — END TO END through complete_work, both directions", () => {
  async function completeAndReadPhase(over: Partial<WorkItem>): Promise<string> {
    const h = harness();
    const id = "w-e2e";
    await h.substrate.put("WorkItem", work(id, {
      status: "in_progress",
      lease: { holder: "agent-rev", token: "t", claimedAt: NOW, expiresAt: "2099-01-01T00:00:00.000Z", heartbeatAt: NOW },
      executorHistory: ["agent-rev"],
      ...over,
    }) as unknown as Record<string, unknown>);
    await h.repo.completeWork(id, "agent-rev", "t", [
      { requirementId: "github_review_artifact", kind: "freeform", ref: "https://github.com/apnex-org/agentic-network/pull/677#pullrequestreview-1", producedAt: NOW } as never,
    ], { summary: "s", observed: false } as never);
    return (await h.repo.getWorkItem(id))!.status;
  }

  it("🔴 a LEGACY PR-review row carrying the retired requirement reaches `done`, NOT `review`", async () => {
    // `done` is the whole point: a parent's completionDependsOn clears ONLY on `done`, so a row
    // parked in `review` wedges its parent exactly as hard as a missing one. bug-383: a pre-fix
    // row has NO systemProjection, so this drives the LEGACY branch end-to-end through the real
    // substrate — the branch that keeps already-projected production rows finishable.
    const phase = await completeAndReadPhase({ createdBy: PROJECTION_AUTHOR, payload: PR_REVIEW_PAYLOAD, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    expect(phase).toBe("done");
  });

  it("🔴 a NEW server-stamped PR-review row reaches `done` through the real substrate", async () => {
    // The forward path: post-fix rows carry the stamp and must discharge on it alone.
    const phase = await completeAndReadPhase({
      systemProjection: { ruleId: PR_REVIEW_PROJECTION_RULE_ID },
      payload: PR_REVIEW_PAYLOAD,
      evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never,
    });
    expect(phase).toBe("done");
  });

  it("🔴 bug-383 e2e: a CALLER-AUTHORED row wearing the payload marker parks in `review`", async () => {
    // The bypass, end-to-end, through production code. Same payload as the legacy case above —
    // the ONLY difference is that `createdBy` is a real caller rather than the projection. If the
    // predicate ever regresses to reading payload alone, THIS is the case that reddens.
    const phase = await completeAndReadPhase({ payload: PR_REVIEW_PAYLOAD, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    expect(phase, "a forged marker must NOT buy a terminal transition").toBe("review");
  });

  it("🔴 NEGATIVE CONTROL: a NON-PR-review row with the same requirement still parks in `review`", async () => {
    const phase = await completeAndReadPhase({ payload: { some: "other-node" }, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    expect(phase, "attestation enforcement must survive everywhere else").toBe("review");
  });
});
