/**
 * mission-63 W3 — buildPromptText canonical render-template registry tests.
 *
 * Per Design v1.0 §4.2 + ADR-028: per-event-type if-ladder retired in
 * favour of a registry pattern. 4 mandatory templates per §6.4 substrate-
 * self-dogfood verification:
 *   1. message_arrived (pulse + note) — preserved from mission-62 Pass 7
 *      (covered in prompt-format-message-arrived.test.ts)
 *   2. thread_message — body inlining (calibration #20 retire)
 *   3. thread_convergence_finalized — truncation removal (calibration
 *      #20 sub-finding retire)
 *   4. agent_state_changed — NEW (canonical envelope `previous` shape
 *      diff-rendered with `cause`)
 *
 * Existing per-event templates (clarification_answered, task_issued,
 * review_completed, revision_required, proposal_decided) covered by the
 * pre-existing dispatcher tests + the registry's mechanical-port
 * preservation.
 */

import { describe, it, expect } from "vitest";
import { buildPromptText } from "../../src/prompt-format.js";

const cfg = { toolPrefix: "mcp__plugin_agent-adapter_proxy__" };

describe("buildPromptText — thread_message (mission-63 W3 calibration #20 retire)", () => {
  it("surfaces the message body inline in addition to the action prompt", () => {
    const text = buildPromptText(
      "thread_message",
      {
        threadId: "thread-399",
        title: "M-Wire-Entity-Convergence Design v0.1 — round-1 audit",
        author: "architect",
        message:
          "Lily — round-1 engineer-side audit. Read Design v0.1 + Survey + spot-checked the actual code/state",
        currentTurn: "engineer",
      },
      cfg,
    );
    // calibration #20 retire: the actual message body surfaces inline,
    // not just the envelope-shell action prompt.
    expect(text).toContain("Message preview:");
    expect(text).toContain("Lily — round-1 engineer-side audit");
    // Original action prompt preserved (caller still gets the
    // get_thread → create_thread_reply guidance + Threads 2.0 discipline).
    expect(text).toContain("It is your turn");
    expect(text).toContain("get_thread");
    expect(text).toContain("create_thread_reply");
    expect(text).toContain("Threads 2.0 discipline");
  });

  it("renders the architect author label correctly", () => {
    const text = buildPromptText(
      "thread_message",
      { threadId: "t-1", title: "X", author: "architect", message: "hi", currentTurn: "engineer" },
      cfg,
    );
    expect(text).toContain("[Architect]");
  });

  it("renders the engineer-peer label for engineer↔engineer threads", () => {
    const text = buildPromptText(
      "thread_message",
      { threadId: "t-1", title: "X", author: "engineer", message: "hi", currentTurn: "engineer" },
      cfg,
    );
    expect(text).toContain("[Engineer peer]");
  });

  it("omits the message-preview line when no body is present (defensive empty-message path)", () => {
    const text = buildPromptText(
      "thread_message",
      { threadId: "t-1", title: "X", author: "architect", currentTurn: "engineer" },
      cfg,
    );
    expect(text).not.toContain("Message preview:");
    // Action prompt still surfaces (envelope-only graceful degradation)
    expect(text).toContain("It is your turn");
  });
});

describe("buildPromptText — thread_convergence_finalized (mission-63 W3 calibration #20 sub-finding retire)", () => {
  it("surfaces the full summary verbatim — no mid-string truncation", () => {
    // Pre-mission-63 the template did `summary.slice(0, 200)`. The
    // calibration #20 sub-finding observed that the LLM lost convergence
    // context past 200 chars. Now the full summary surfaces.
    const longSummary =
      "Phase 4 Design ratification for M-Wire-Entity-Convergence (idea-219) closed bilaterally at " +
      "Design v1.0. 4-round thread arc: round 1 architect v0.1 draft + round-1-audit ask; round 2 engineer 8-ask audit; " +
      "round 3 architect v0.2 ratify + framing tweaks applied; round 4 engineer round-2 ratify accepted (Design v1.0).";
    const text = buildPromptText(
      "thread_convergence_finalized",
      {
        threadId: "thread-399",
        title: "M-Wire-Entity-Convergence Design v0.1 — round-1 audit",
        intent: "implementation_ready",
        summary: longSummary,
        committedActionCount: 1,
        executedCount: 1,
        failedCount: 0,
      },
      cfg,
    );
    // Full summary surfaces (length > 200, end of summary present)
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("Phase 4 Design ratification");
    expect(text).toContain("Design v1.0)."); // tail of summary
    expect(text).toContain("Committed actions: 1");
    expect(text).toContain("executed=1");
  });

  it("falls back to '(none)' when summary is empty string", () => {
    const text = buildPromptText(
      "thread_convergence_finalized",
      {
        threadId: "t-1",
        title: "X",
        intent: "decision_needed",
        summary: "",
      },
      cfg,
    );
    expect(text).toContain("Summary: (none)");
  });

  it("surfaces warning indicator when present", () => {
    const text = buildPromptText(
      "thread_convergence_finalized",
      {
        threadId: "t-1",
        title: "X",
        intent: "implementation_ready",
        summary: "ok",
        committedActionCount: 2,
        executedCount: 1,
        failedCount: 1,
        warning: true,
      },
      cfg,
    );
    expect(text).toContain("WARNING");
  });
});

describe("buildPromptText — agent_state_changed (mission-63 W3 NEW template)", () => {
  it("diff-renders activityState transition using `previous` shape with `cause`", () => {
    // Canonical payload per Design §3.4: {agent, previous: {livenessState?,
    // activityState?}, changed[], cause, at}. `previous` carries only
    // fields that changed (TS optional-key absent semantics).
    const text = buildPromptText(
      "agent_state_changed",
      {
        event: "agent_state_changed",
        agent: {
          id: "eng-greg-1",
          name: "greg",
          role: "engineer",
          livenessState: "online",
          activityState: "online_working",
          labels: { team: "billing" },
        },
        previous: { activityState: "online_idle" },
        changed: ["activityState", "lastToolCallAt", "workingSince"],
        cause: "signal_working_started",
        at: "2026-04-28T04:00:00.000Z",
      },
      cfg,
    );
    expect(text).toContain("Agent engineer/greg (eng-greg-1)");
    expect(text).toContain("activityState online_idle → online_working");
    expect(text).toContain("cause=signal_working_started");
    // livenessState UNCHANGED → no liveness transition rendered
    expect(text).not.toContain("livenessState");
  });

  it("diff-renders combined liveness + activity transition when both change", () => {
    const text = buildPromptText(
      "agent_state_changed",
      {
        agent: {
          id: "eng-x", name: "x", role: "engineer",
          livenessState: "online", activityState: "online_idle", labels: {},
        },
        previous: { livenessState: "offline", activityState: "offline" },
        changed: ["livenessState", "activityState"],
        cause: "first_tool_call",
        at: "2026-04-28T04:00:00.000Z",
      },
      cfg,
    );
    expect(text).toContain("livenessState offline → online");
    expect(text).toContain("activityState offline → online_idle");
    expect(text).toContain("cause=first_tool_call");
    // Both transitions in same line, joined by '; '
    expect(text).toMatch(/livenessState .* → .*; activityState .* → .*/);
  });

  it("falls back gracefully when `previous` is empty (no FSM-state delta)", () => {
    const text = buildPromptText(
      "agent_state_changed",
      {
        agent: {
          id: "eng-x", name: "x", role: "engineer",
          livenessState: "online", activityState: "online_idle", labels: {},
        },
        previous: {},
        changed: ["lastToolCallAt"],
        cause: "signal_working_started",
        at: "2026-04-28T04:00:00.000Z",
      },
      cfg,
    );
    expect(text).toContain("no FSM-state delta");
    expect(text).toContain("cause=signal_working_started");
  });

  it("uses agent.id when name is missing", () => {
    const text = buildPromptText(
      "agent_state_changed",
      {
        agent: {
          id: "eng-noname", role: "engineer",
          livenessState: "online", activityState: "online_idle", labels: {},
        },
        previous: { activityState: "online_idle" },
        changed: [],
        cause: "explicit_claim",
      },
      cfg,
    );
    expect(text).toContain("(eng-noname)");
  });
});

describe("buildPromptText — registry default fallthrough", () => {
  it("renders unknown event-types via default template (preserves prior behavior)", () => {
    const text = buildPromptText("unknown_event_type", { whatever: "x" }, cfg);
    expect(text).toBe("[Hub] Notification: unknown_event_type.");
  });
});

describe("buildPromptText — preserves existing inline templates (mechanical port)", () => {
  it("clarification_answered template preserved", () => {
    const text = buildPromptText("clarification_answered", { taskId: "task-1" }, cfg);
    expect(text).toContain("[Architect]");
    expect(text).toContain("clarification request for task-1");
    expect(text).toContain("get_clarification");
  });

  it("task_issued template preserved", () => {
    const text = buildPromptText("task_issued", { taskId: "task-2" }, cfg);
    expect(text).toContain("Issued a new directive (task-2)");
    expect(text).toContain("get_task");
  });

  it("review_completed template preserved", () => {
    const text = buildPromptText("review_completed", { taskId: "task-3" }, cfg);
    expect(text).toContain("Reviewed task-3");
    expect(text).toContain("get_review");
  });

  it("revision_required template preserved", () => {
    const text = buildPromptText(
      "revision_required",
      { taskId: "task-4", feedback: "too brief", previousReportRef: "report-9", revisionCount: 2 },
      cfg,
    );
    expect(text).toContain("REJECTED");
    expect(text).toContain("too brief");
    expect(text).toContain("report-9");
    expect(text).toContain("Revision 2");
    expect(text).toContain("create_report");
  });

  it("proposal_decided template preserved", () => {
    const text = buildPromptText("proposal_decided", { proposalId: "p-1", decision: "approved" }, cfg);
    expect(text).toContain("Proposal p-1: approved");
  });
});
