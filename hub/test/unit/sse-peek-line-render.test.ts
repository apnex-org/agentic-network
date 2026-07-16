/**
 * M-SSE-Peek-Line-Cleanup Phase 1 — render-function + auto-derivation
 * tests per Design v1.1 §3 test discipline.
 *
 * Pin contract via format-regex (per `feedback_format_regex_over_hardcoded_hash_tests.md`)
 * not specific values — less brittle to render-impl tuning.
 */

import { describe, expect, it } from "vitest";

import {
  deriveRenderContext,
  PEEK_LINE_BUDGET,
  PEEK_LINE_FORMAT_REGEX,
  renderPeekLineBody,
  renderUnknownFallback,
  shouldFilterPeekLine,
  SOURCE_CLASSES,
} from "../../src/policy/sse-peek-line-render.js";

describe("renderPeekLineBody", () => {
  it("renders the canonical §2.1 template format", () => {
    const body = renderPeekLineBody({
      sourceClass: "Engineer",
      actionVerb: "Replied to",
      entityRef: { type: "thread", id: "thread-487", title: "idea-252 cleanup" },
      bodyPreview: "Round-2 audit response. Concur on 7 design-asks",
      actionability: "your-turn",
    });
    // Format-regex contract pins canonical structure (§3 render contract test)
    expect(body).toMatch(PEEK_LINE_FORMAT_REGEX);
    // sourceClass-prefix in brackets
    expect(body).toMatch(/^\[Engineer\]/);
    // actionability-marker in brackets at end
    expect(body).toMatch(/\[your-turn\]$/);
    // entity-id present
    expect(body).toContain("thread-487");
  });

  it("respects the §2.3 ~200-char total budget when content fits", () => {
    const body = renderPeekLineBody({
      sourceClass: "Hub",
      actionVerb: "Activated",
      entityRef: { type: "mission", id: "mission-76", title: "M-Test" },
      actionability: "FYI",
    });
    // Short content → no truncation suffix
    expect(body).not.toContain("...");
    expect(body.length).toBeLessThanOrEqual(PEEK_LINE_BUDGET);
  });

  it("truncates body-preview first when over §2.3 budget", () => {
    const longPreview = "x".repeat(300); // overflow the 200-char budget
    const body = renderPeekLineBody({
      sourceClass: "Hub",
      actionVerb: "Replied to",
      entityRef: { type: "thread", id: "thread-1" },
      bodyPreview: longPreview,
      actionability: "FYI",
    });
    expect(body.length).toBeLessThanOrEqual(PEEK_LINE_BUDGET);
    // body-preview tail truncation marker per §2.3
    expect(body).toContain("...");
    // sourceClass + entity-id + actionability NEVER truncated
    expect(body).toMatch(/^\[Hub\]/);
    expect(body).toContain("thread-1");
    expect(body).toMatch(/\[FYI\]$/);
  });

  it("renders with no entityRef (bare system note)", () => {
    const body = renderPeekLineBody({
      sourceClass: "Hub",
      actionVerb: "Heartbeat",
      actionability: "FYI",
    });
    expect(body).toMatch(/^\[Hub\] Heartbeat/);
    expect(body).toMatch(/\[FYI\]$/);
  });
});

describe("renderUnknownFallback (§3 backward-compat)", () => {
  it("prefixes [unknown] for pre-Phase-1 records", () => {
    const body = renderUnknownFallback("legacy peek-line content");
    expect(body).toMatch(/^\[unknown\]/);
  });

  it("respects budget", () => {
    const body = renderUnknownFallback("x".repeat(300));
    expect(body.length).toBeLessThanOrEqual(PEEK_LINE_BUDGET);
  });
});

describe("shouldFilterPeekLine (§1.5 filter list — F4 fold)", () => {
  it("filters agent_state_changed (load-bearing default per §1.5)", () => {
    expect(shouldFilterPeekLine("agent_state_changed")).toBe(true);
  });

  it("filters touchAgent rate-limited updates", () => {
    expect(shouldFilterPeekLine("touchAgent")).toBe(true);
  });

  it("filters W1b replay-truncated synthetic SSE events", () => {
    expect(shouldFilterPeekLine("sse_replay_truncated")).toBe(true);
  });

  it("filters engineerPulse on standby-acknowledged state (template-carryover)", () => {
    expect(
      shouldFilterPeekLine("engineerPulse", { state: "standby", acknowledged: true }),
    ).toBe(true);
  });

  it("does NOT filter engineerPulse on non-standby states (still operator-relevant)", () => {
    expect(shouldFilterPeekLine("engineerPulse", { state: "active" })).toBe(false);
  });

  it("does NOT filter normal events (thread_message, mission_status_changed, etc.)", () => {
    expect(shouldFilterPeekLine("thread_message")).toBe(false);
    expect(shouldFilterPeekLine("mission_status_changed")).toBe(false);
    expect(shouldFilterPeekLine("pr-opened-notification")).toBe(false);
  });
});

describe("deriveRenderContext (§1.2 + §2.2 resolution table)", () => {
  it("maps thread_message → Engineer/Architect sourceClass per author", () => {
    const ctx = deriveRenderContext("thread_message", {
      author: "architect",
      threadId: "thread-1",
      title: "T",
    });
    expect(ctx).not.toBeNull();
    expect(ctx?.sourceClass).toBe("Architect");
    expect(ctx?.actionVerb).toBe("Replied to");
    expect(ctx?.entityRef?.type).toBe("thread");
    expect(ctx?.actionability).toBe("your-turn");
  });

  it("maps thread_convergence_finalized → Hub", () => {
    const ctx = deriveRenderContext("thread_convergence_finalized", {
      threadId: "thread-2",
    });
    expect(ctx?.sourceClass).toBe("Hub");
    expect(ctx?.actionVerb).toBe("Converged");
    expect(ctx?.actionability).toBe("FYI");
  });

  it("maps mission_status_changed:proposed→active to Activated verb", () => {
    const ctx = deriveRenderContext("mission_status_changed", {
      missionId: "mission-1",
      fromStatus: "proposed",
      toStatus: "active",
    });
    expect(ctx?.actionVerb).toBe("Activated");
    expect(ctx?.entityRef?.type).toBe("mission");
  });

  it("maps PR-events → System-PR sourceClass", () => {
    const ctx = deriveRenderContext("pr-opened-notification", {
      authorRole: "engineer",
      prNumber: 42,
      prTitle: "test PR",
    });
    expect(ctx?.sourceClass).toBe("System-PR");
    expect(ctx?.actionVerb).toContain("opened");
    expect(ctx?.entityRef?.id).toBe("PR #42");
    expect(ctx?.actionability).toBe("emitted");
  });

  it("maps review-request notifications with explicit actionability wording", () => {
    const requested = deriveRenderContext("pr-review-requested-notification", {
      prNumber: 624,
      title: "manifest PR",
      requestedReviewerLogin: "apnex-lily",
    });
    expect(requested?.sourceClass).toBe("System-PR");
    expect(requested?.actionVerb).toBe("Review requested from apnex-lily");
    expect(requested?.entityRef?.id).toBe("PR #624");
    expect(requested?.actionability).toBe("emitted");

    const removed = deriveRenderContext("pr-review-request-removed-notification", {
      prNumber: 625,
      requestedTeamSlug: "platform-reviewers",
    });
    expect(removed?.actionVerb).toBe("Review request removed for platform-reviewers");
    expect(removed?.entityRef?.id).toBe("PR #625");
  });

  it("renders review-request fallback reason without making WorkGraph claims", () => {
    const ctx = deriveRenderContext("pr-review-requested-notification", {
      prNumber: 626,
      requestedReviewerLogin: "apnex-lily",
      ruleId: "pr_review_request_to_workitem_v0",
      bindingDecision: { ok: false, reason: "binding_missing", fallbackOnly: true },
    });
    expect(ctx?.sourceClass).toBe("System-PR");
    expect(ctx?.actionVerb).toBe("Review requested from apnex-lily");
    expect(ctx?.bodyPreview).toBe("fallback=binding_missing via pr_review_request_to_workitem_v0");
    expect(ctx?.actionability).toBe("emitted");
  });

  it("maps pulse events → System-Pulse sourceClass", () => {
    const ctx = deriveRenderContext("engineerPulse", {
      missionId: "mission-1",
      state: "active",
    });
    expect(ctx?.sourceClass).toBe("System-Pulse");
    expect(ctx?.actionability).toBe("FYI");
  });

  it("returns null for filter-listed events (§1.5)", () => {
    expect(deriveRenderContext("agent_state_changed", {})).toBeNull();
    expect(
      deriveRenderContext("engineerPulse", { state: "standby", acknowledged: true }),
    ).toBeNull();
  });

  it("falls back to Hub sourceClass for unknown events", () => {
    const ctx = deriveRenderContext("custom_event", {});
    expect(ctx?.sourceClass).toBe("Hub");
    expect(ctx?.actionability).toBe("FYI");
  });
});

describe("Source-class enum contract (§3)", () => {
  it("includes exactly the 8 ratified classes (§1.2 + idea-255 System-Workflow)", () => {
    expect(SOURCE_CLASSES).toEqual([
      "Hub",
      "Director",
      "Engineer",
      "Architect",
      "System-PR",
      "System-Pulse",
      "System-Audit",
      "System-Workflow",
    ]);
  });
});

// ── work-54 (idea-357 pts 1-2): WorkItem-transition + deploy events ──

describe("work-transition-notification filter + render (work-54)", () => {
  it("suppresses the routine hot-path transitions (claim / start / resume)", () => {
    expect(shouldFilterPeekLine("work-transition-notification", { to_status: "claimed", verb: "claim_work" })).toBe(true);
    expect(shouldFilterPeekLine("work-transition-notification", { to_status: "in_progress", verb: "start_work" })).toBe(true);
    expect(shouldFilterPeekLine("work-transition-notification", { to_status: "in_progress", verb: "resume_work" })).toBe(true);
  });

  it("renders the actionable state-changes (blocked / ready / review / done / abandoned / created)", () => {
    for (const [to, verb] of [
      ["blocked", "block_work"], ["ready", "release_work"], ["ready", "lease_expired"],
      ["review", "complete_work"], ["done", "complete_work"], ["abandoned", "abandon_work"],
      ["ready", "create_work"],
    ]) {
      expect(shouldFilterPeekLine("work-transition-notification", { to_status: to, verb })).toBe(false);
    }
  });

  it("derives a workitem entityRef + per-transition action verb", () => {
    const ctx = deriveRenderContext("work-transition-notification", {
      work_id: "work-9", to_status: "done", from_status: "in_progress",
      verb: "complete_work", title: "Ship the slice",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.sourceClass).toBe("Hub");
    expect(ctx!.actionVerb).toBe("Completed");
    expect(ctx!.entityRef).toEqual({ type: "workitem", id: "work-9", title: "Ship the slice" });
    expect(ctx!.actionability).toBe("FYI");
  });

  it("a review-park is the verifier's turn", () => {
    const ctx = deriveRenderContext("work-transition-notification", {
      work_id: "work-9", to_status: "review", verb: "complete_work",
    });
    expect(ctx!.actionVerb).toBe("Parked in review");
    expect(ctx!.actionability).toBe("your-turn");
  });

  it("a lease-expiry requeue names the sweeper path", () => {
    const ctx = deriveRenderContext("work-transition-notification", {
      work_id: "work-9", to_status: "ready", verb: "lease_expired",
    });
    expect(ctx!.actionVerb).toBe("Lease-expired, re-queued");
  });
});

describe("work-unblocked-notification render (work-54)", () => {
  it("always renders as your-turn (an agent should claim)", () => {
    expect(shouldFilterPeekLine("work-unblocked-notification", { work_id: "work-9" })).toBe(false);
    const ctx = deriveRenderContext("work-unblocked-notification", { work_id: "work-9", title: "Downstream" });
    expect(ctx!.actionVerb).toBe("Unblocked, now claimable");
    expect(ctx!.entityRef).toEqual({ type: "workitem", id: "work-9", title: "Downstream" });
    expect(ctx!.actionability).toBe("your-turn");
  });
});

describe("deploy-completed-notification render (work-54)", () => {
  it("success renders FYI; failure renders your-turn", () => {
    const ok = deriveRenderContext("deploy-completed-notification", {
      run_id: 42, workflow_name: "deploy-hub", conclusion: "success",
    });
    expect(ok!.sourceClass).toBe("System-Workflow");
    expect(ok!.actionVerb).toBe("Deploy succeeded");
    expect(ok!.entityRef).toEqual({ type: "workflow", id: "run-42", title: "deploy-hub" });
    expect(ok!.actionability).toBe("FYI");

    const bad = deriveRenderContext("deploy-completed-notification", {
      run_id: 42, workflow_name: "deploy-hub", conclusion: "failure",
    });
    expect(bad!.actionVerb).toBe("Deploy failed");
    expect(bad!.actionability).toBe("your-turn");
  });
});
