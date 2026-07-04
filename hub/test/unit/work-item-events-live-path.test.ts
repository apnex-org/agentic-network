/**
 * work-54 PR #480 verifier finding — LIVE-path render/suppression tests.
 *
 * emitAndPush wraps every system emission in an outer `message_arrived` SSE
 * event, so the payload-level vocabulary (payload.notificationEvent) never
 * reached the filter/render tables keyed on those names: routine WI
 * transitions could not be suppressed at the adapter/LLM wake layer, and
 * rendered work/deploy bodies never surfaced. These tests pin the fix at the
 * REAL wire seam — augmentDataWithRenderFields called exactly as
 * dispatchEvent calls it, with a full message_arrived envelope.
 */
import { describe, expect, it } from "vitest";

import { augmentDataWithRenderFields } from "../../src/hub-networking.js";

/** A message_arrived envelope exactly as emitAndPush dispatches it. */
function envelope(kind: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    message: {
      id: "01TESTMSG",
      kind,
      authorRole: "system",
      authorAgentId: "hub",
      target: null,
      delivery: "push-immediate",
      payload,
      status: "new",
      createdAt: "2026-07-04T00:00:00.000Z",
    },
  };
}

describe("message_arrived live-path suppression (work-54 / PR #480)", () => {
  it("a routine claim_work transition is SUPPRESSED on the wire (suppress_peek_line=true, no render)", () => {
    const data = envelope("external-injection", {
      body: "work-1 ready→claimed (claim_work) by engineer/agent-a",
      work_id: "work-1", verb: "claim_work", from_status: "ready", to_status: "claimed",
      notificationEvent: "work-transition-notification",
    });
    const augmented = augmentDataWithRenderFields("message_arrived", data);
    expect(augmented.suppress_peek_line).toBe(true);
    expect(augmented.body).toBeUndefined();          // no render work on suppressed events
    expect(augmented.message).toBe(data.message);    // envelope preserved for state-machine consumption
  });

  it("start_work and resume_work (→in_progress) are suppressed too", () => {
    for (const verb of ["start_work", "resume_work"]) {
      const augmented = augmentDataWithRenderFields("message_arrived", envelope("external-injection", {
        work_id: "work-1", verb, to_status: "in_progress",
        notificationEvent: "work-transition-notification",
      }));
      expect(augmented.suppress_peek_line).toBe(true);
    }
  });
});

describe("message_arrived live-path render (work-54 / PR #480)", () => {
  it("a complete→done transition renders the canonical peek-line on the OUTER data", () => {
    const augmented = augmentDataWithRenderFields("message_arrived", envelope("external-injection", {
      body: "work-1 in_progress→done (complete_work) by engineer/agent-a",
      work_id: "work-1", verb: "complete_work", from_status: "in_progress", to_status: "done",
      title: "Ship the slice",
      notificationEvent: "work-transition-notification",
    }));
    expect(augmented.suppress_peek_line).toBeUndefined();
    expect(augmented.sourceClass).toBe("Hub");
    expect(augmented.body).toContain("Completed");
    expect(augmented.body).toContain("work-1");
    expect(augmented.actionability).toBe("FYI");
  });

  it("a work-unblocked event renders your-turn (the claimable wake)", () => {
    const augmented = augmentDataWithRenderFields("message_arrived", envelope("external-injection", {
      body: "work-9 is now claimable (engineer) — its last unmet dependency work-1 completed",
      work_id: "work-9", unblocked_by: "work-1", role_eligibility: ["engineer"],
      notificationEvent: "work-unblocked-notification",
    }));
    expect(augmented.body).toContain("Unblocked, now claimable");
    expect(augmented.body).toContain("work-9");
    expect(augmented.actionability).toBe("your-turn");
  });

  it("a deploy failure renders your-turn with the deploy verb", () => {
    const augmented = augmentDataWithRenderFields("message_arrived", envelope("external-injection", {
      body: 'deploy failure: "deploy-hub" — head_sha=8244c09@main',
      run_id: 42, workflow_name: "deploy-hub", conclusion: "failure", status: "completed",
      notificationEvent: "deploy-completed-notification",
    }));
    expect(augmented.body).toContain("Deploy failed");
    expect(augmented.actionability).toBe("your-turn");
  });

  it("activates the previously-dormant workflow-run filter on the live path (in-progress suppressed)", () => {
    const augmented = augmentDataWithRenderFields("message_arrived", envelope("external-injection", {
      body: 'in_progress: "test" — head_sha=8244c09',
      run_id: 43, workflow_name: "test", status: "in_progress",
      notificationEvent: "workflow-run-in-progress-notification",
    }));
    expect(augmented.suppress_peek_line).toBe(true);
  });
});

describe("message_arrived live-path — non-notification envelopes unchanged (regression)", () => {
  it("a kind=note message is passed through (no unwrap, no suppress, no render)", () => {
    const data = envelope("note", { body: "hey greg, status?" });
    const augmented = augmentDataWithRenderFields("message_arrived", data);
    expect(augmented.suppress_peek_line).toBeUndefined();
    // falls through to the default deriveRenderContext case for message_arrived
    expect(augmented.message).toBe(data.message);
  });

  it("a pulse external-injection (no notificationEvent) is untouched — pulse handling stays Phase-1.5 #1.1 scope", () => {
    const data = envelope("external-injection", {
      pulseKind: "status_check", missionId: "mission-1", message: "status?",
    });
    const augmented = augmentDataWithRenderFields("message_arrived", data);
    expect(augmented.suppress_peek_line).toBeUndefined();
    expect(augmented.message).toBe(data.message);
  });
});
