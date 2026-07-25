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
import { evaluateCompletionGate, isProjectedPrReviewObligation } from "../work-item.js";
import type { WorkItem } from "../work-item.js";
import { projectPrEvidenceReviewWorkItem } from "../../policy/pr-review-workitem-projection.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";

const NOW = "2026-07-25T22:40:00.000Z";
const ARCHITECT = { role: "architect", agentId: "architect-1" };

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
    // attestation, and no attester who could ever supply one.
    const row = work("work-prrev-x", { payload: PR_REVIEW_PAYLOAD, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    const gate = evaluateCompletionGate(row);
    expect(gate.attestationReqsSatisfied, "the existing row must discharge — the requirement is data, the predicate is code").toBe(true);
    expect(gate.pendingAttestationReqs).toEqual([]);
  });

  it("🔴 NEGATIVE CONTROL: the SAME requirement on a NON-PR-review row still blocks", () => {
    // Proves the carve-out is keyed on the payload marker, not on evidenceAuthority — i.e. that
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

  it("the marker predicate itself does not match a string payload or an array", () => {
    // create_work stores a JSON-STRING payload raw (bug-376's sibling) — a string must not be
    // coerced into matching, or a hand-written row could opt itself out of attestation.
    expect(isProjectedPrReviewObligation({ payload: JSON.stringify(PR_REVIEW_PAYLOAD) } as never)).toBe(false);
    expect(isProjectedPrReviewObligation({ payload: [PR_REVIEW_PAYLOAD] } as never)).toBe(false);
    expect(isProjectedPrReviewObligation({ payload: PR_REVIEW_PAYLOAD } as never)).toBe(true);
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

  it("🔴 a PR-review row carrying the retired requirement reaches `done`, NOT `review`", async () => {
    // `done` is the whole point: a parent's completionDependsOn clears ONLY on `done`, so a row
    // parked in `review` wedges its parent exactly as hard as a missing one.
    const phase = await completeAndReadPhase({ payload: PR_REVIEW_PAYLOAD, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    expect(phase).toBe("done");
  });

  it("🔴 NEGATIVE CONTROL: a NON-PR-review row with the same requirement still parks in `review`", async () => {
    const phase = await completeAndReadPhase({ payload: { some: "other-node" }, evidenceRequirements: [ARTIFACT_REQ, RETIRED_REQ] as never });
    expect(phase, "attestation enforcement must survive everywhere else").toBe("review");
  });
});
