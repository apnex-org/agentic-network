import { describe, expect, it } from "vitest";
import type { WorkItem } from "../../src/entities/work-item.js";
import {
  prWorkGraphBindingProofFromWorkItem,
  resolvePrEvidenceBinding,
  validatePrEvidenceBinding,
} from "../../src/policy/pr-evidence-admission-binding.js";

const locator = { repo: "apnex-org/agentic-network", prNumber: 621, source: "repo_pr_number" as const, raw: "apnex-org/agentic-network#621" };

function bindingItem(overrides: Record<string, unknown> = {}, itemOverrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "prbind-621",
    status: "ready",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    createdBy: { role: "architect", agentId: "agent-architect" },
    type: "task",
    priority: "normal",
    roleEligibility: [],
    dependsOn: [],
    completionDependsOn: [],
    evidenceRequirements: [],
    evidence: [],
    blockedOn: null,
    lease: null,
    attestations: {},
    attestationHistory: [],
    executorHistory: [],
    frictionReflections: [],
    leaseExpiryCount: 0,
    stateDurations: { ready: 0, claimed: 0, in_progress: 0, blocked: 0, paused: 0, review: 0 },
    enteredCurrentStateAt: "2026-07-17T00:00:00.000Z",
    payload: {
      obligationKind: "github_pr_workgraph_binding",
      repo: locator.repo,
      prNumber: locator.prNumber,
      targetWorkId: "work-parent",
      headSha: "head-1",
      baseSha: "base-1",
      version: "v1",
      changedPaths: ["hub/src/policy/work-item-policy.ts"],
      pathClasses: ["hub_code"],
      changedPathSource: "test-fixture",
      lastPusherLogin: "apnex-greg",
      ...overrides,
    },
    ...itemOverrides,
  } as WorkItem;
}

describe("PR evidence admission binding validation", () => {
  it("extracts Hub-owned binding proof fields from WorkItem payload", () => {
    expect(prWorkGraphBindingProofFromWorkItem(bindingItem(), locator)).toEqual({
      id: "prbind-621",
      repo: locator.repo,
      prNumber: locator.prNumber,
      targetWorkId: "work-parent",
      provenance: "hub",
      headSha: "head-1",
      baseSha: "base-1",
      version: "v1",
      changedPaths: ["hub/src/policy/work-item-policy.ts"],
      pathClasses: ["hub_code"],
      changedPathSource: "test-fixture",
      lastPusherLogin: "apnex-greg",
    });
  });

  it("does not extract non-binding rows or rows for a different PR", () => {
    expect(prWorkGraphBindingProofFromWorkItem(bindingItem({ obligationKind: "other" }), locator)).toBeNull();
    expect(prWorkGraphBindingProofFromWorkItem(bindingItem({ prNumber: 620 }), locator)).toBeNull();
    expect(prWorkGraphBindingProofFromWorkItem(bindingItem({ repo: "apnex-org/other" }), locator)).toBeNull();
  });

  it("validates the happy path and rejects non-Hub provenance", () => {
    const binding = prWorkGraphBindingProofFromWorkItem(bindingItem(), locator)!;
    expect(validatePrEvidenceBinding({ locator, binding, targetWorkId: "work-parent", expectedHeadSha: "head-1", expectedBaseSha: "base-1" })).toMatchObject({
      ok: true,
      bindingId: "prbind-621",
      targetWorkId: "work-parent",
    });
    expect(validatePrEvidenceBinding({ locator, binding: { ...binding, provenance: "raw-body-marker" }, targetWorkId: "work-parent" })).toMatchObject({
      ok: false,
      reason: "binding_not_hub_authored",
      fallbackOnly: true,
      candidateBindingIds: ["prbind-621"],
    });
  });

  it("rejects repo, PR, target, head, and base mismatches", () => {
    const binding = prWorkGraphBindingProofFromWorkItem(bindingItem(), locator)!;
    expect(validatePrEvidenceBinding({ locator: { ...locator, repo: "apnex-org/other" }, binding, targetWorkId: "work-parent" })).toMatchObject({ ok: false, reason: "binding_repo_mismatch" });
    expect(validatePrEvidenceBinding({ locator: { ...locator, prNumber: 622 }, binding, targetWorkId: "work-parent" })).toMatchObject({ ok: false, reason: "binding_pr_mismatch" });
    expect(validatePrEvidenceBinding({ locator, binding, targetWorkId: "work-other" })).toMatchObject({ ok: false, reason: "binding_target_mismatch" });
    expect(validatePrEvidenceBinding({ locator, binding, targetWorkId: "work-parent", expectedHeadSha: "other-head" })).toMatchObject({ ok: false, reason: "binding_head_mismatch" });
    expect(validatePrEvidenceBinding({ locator, binding, targetWorkId: "work-parent", expectedBaseSha: "other-base" })).toMatchObject({ ok: false, reason: "binding_base_mismatch" });
  });

  it("uses keyed binding lookup rather than a broad WorkItem scan", async () => {
    const calls: Array<[string, number]> = [];
    const store = {
      async listPrReviewBindingWorkItems(repo: string, prNumber: number) {
        calls.push([repo, prNumber]);
        return { items: [bindingItem()], truncated: false };
      },
      async listWorkItems() {
        throw new Error("broad scan must not be used");
      },
    };

    await expect(resolvePrEvidenceBinding({ store, locator, targetWorkId: "work-parent" })).resolves.toMatchObject({ ok: true, bindingId: "prbind-621" });
    expect(calls).toEqual([["apnex-org/agentic-network", 621]]);
  });

  it("fails closed for missing, ambiguous, and unavailable binding lookup", async () => {
    await expect(resolvePrEvidenceBinding({ store: null, locator, targetWorkId: "work-parent" })).resolves.toMatchObject({
      ok: false,
      reason: "binding_lookup_unavailable",
    });
    await expect(resolvePrEvidenceBinding({
      store: { async listPrReviewBindingWorkItems() { return { items: [], truncated: false }; } },
      locator,
      targetWorkId: "work-parent",
    })).resolves.toMatchObject({ ok: false, reason: "binding_missing" });
    await expect(resolvePrEvidenceBinding({
      store: { async listPrReviewBindingWorkItems() { return { items: [bindingItem(), bindingItem({}, { id: "prbind-621b" })], truncated: false }; } },
      locator,
      targetWorkId: "work-parent",
    })).resolves.toMatchObject({
      ok: false,
      reason: "binding_ambiguous",
      candidateBindingIds: ["prbind-621", "prbind-621b"],
    });
  });

  it("surfaces target mismatch from the resolved binding", async () => {
    await expect(resolvePrEvidenceBinding({
      store: { async listPrReviewBindingWorkItems() { return { items: [bindingItem()], truncated: false }; } },
      locator,
      targetWorkId: "work-other",
    })).resolves.toMatchObject({ ok: false, reason: "binding_target_mismatch" });
  });
});
