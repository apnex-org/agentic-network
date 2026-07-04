/**
 * idea-255 / M-Workflow-Run-Events-Hub-Integration Design v1.0 §2.1 —
 * end-to-end wire-flow integration test (calibration #62 15-instance
 * discipline; explicitly mandated by F7 fold).
 *
 * Pin contract per `feedback_format_regex_over_hardcoded_hash_tests.md`:
 * format-regex on run.id (^\d+$); format-regex on head_sha (40-hex);
 * shape + verb-derivation logic only. NO hardcoded notification bodies.
 *
 * Wire flow exercised:
 *   /actions/runs response shape → translateWorkflowRun → external-injection
 *   Message → handler → MessageDispatch with sourceClass=System-Workflow,
 *   entityRef.type=workflow, body matching §1.3 render template, head_sha
 *   propagated for idea-256 composability.
 *
 * Cold-start path: no pre-seeded handler state; handler reads only from
 * Message.payload (per F7 + `feedback_local_test_masking_via_cached_state.md`).
 */

import { describe, it, expect } from "vitest";
import { translateWorkflowRun } from "@apnex/repo-event-bridge";
import type { WorkflowRun } from "@apnex/repo-event-bridge";
import {
  WORKFLOW_RUN_COMPLETED_HANDLER,
  WORKFLOW_RUN_DISPATCHED_HANDLER,
  WORKFLOW_RUN_IN_PROGRESS_HANDLER,
} from "../../src/policy/repo-event-workflow-run-handler.js";
import {
  shouldFilterPeekLine,
  deriveRenderContext,
  PEEK_LINE_FORMAT_REGEX,
  renderPeekLineBody,
} from "../../src/policy/sse-peek-line-render.js";
import type { Message } from "../../src/entities/index.js";
import type { IPolicyContext } from "../../src/policy/types.js";

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 25529674489,
    name: "release-plugin",
    status: "completed",
    conclusion: "success",
    event: "push",
    head_sha: "8244c096b5f7d5a171aae118a7a53b4ad31fb7e3",
    head_branch: "main",
    html_url: "https://github.com/apnex-org/agentic-network/actions/runs/25529674489",
    run_started_at: "2026-05-08T00:30:00Z",
    updated_at: "2026-05-08T00:32:01Z",
    created_at: "2026-05-08T00:30:00Z",
    actor: { login: "apnex-lily" },
    triggering_actor: { login: "apnex-lily" },
    run_number: 1,
    run_attempt: 1,
    ...overrides,
  };
}

function wrapAsExternalInjectionMessage(repoEvent: { kind: string; subkind: string; payload: unknown }): Message {
  return {
    id: "01TEST",
    kind: "external-injection",
    authorRole: "architect",
    authorAgentId: "anonymous-architect",
    target: null,
    delivery: "push-immediate",
    payload: repoEvent,
    status: "new",
    createdAt: "2026-05-08T00:32:01Z",
  } as unknown as Message;
}

const stubCtx = {} as IPolicyContext;

// ── End-to-end wire flow: completed + success ─────────────────────────

describe("workflow-run wire-flow (calibration #62 §2.1) — completed + success", () => {
  it("translator → handler → MessageDispatch with System-Workflow sourceClass + workflow EntityRef", async () => {
    const run = makeRun({
      name: "release-plugin",
      status: "completed",
      conclusion: "success",
      event: "push",
    });
    const repoEvent = translateWorkflowRun(run, "apnex-org/agentic-network");
    expect(repoEvent.subkind).toBe("workflow-run-completed");

    const inbound = wrapAsExternalInjectionMessage(repoEvent);
    const dispatches = await WORKFLOW_RUN_COMPLETED_HANDLER.handle(inbound, stubCtx);
    expect(dispatches).toHaveLength(1);

    const dispatch = dispatches[0];
    expect(dispatch.kind).toBe("external-injection");
    expect(dispatch.target).toBeNull();

    const payload = dispatch.payload as Record<string, unknown>;
    expect(payload.notificationEvent).toBe("workflow-run-completed-notification");
    expect(payload.workflow_name).toBe("release-plugin");
    expect(payload.conclusion).toBe("success");

    // F6 fold: head_sha propagation for idea-256 composability
    expect(typeof payload.head_sha).toBe("string");
    expect(payload.head_sha).toMatch(/^[a-f0-9]{40}$/);

    // Run-id format-regex
    expect(String(payload.run_id)).toMatch(/^\d+$/);

    // Body carries the render-ready summary
    expect(typeof payload.body).toBe("string");
    expect(payload.body as string).toContain("succeeded");
    expect(payload.body as string).toContain("release-plugin");
    expect(payload.body as string).toMatch(/head_sha=[a-f0-9]{7}/);
  });
});

describe("workflow-run wire-flow — completed + failure", () => {
  it("propagates failure surface + html_url for operator follow-up", async () => {
    const run = makeRun({
      name: "deploy-hub",
      status: "completed",
      conclusion: "failure",
      event: "push",
    });
    const repoEvent = translateWorkflowRun(run, "apnex-org/agentic-network");
    const inbound = wrapAsExternalInjectionMessage(repoEvent);
    const dispatches = await WORKFLOW_RUN_COMPLETED_HANDLER.handle(inbound, stubCtx);
    // work-54: deploy-hub also gets the derived deploy-completed dispatch (2nd entry)
    expect(dispatches).toHaveLength(2);

    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.conclusion).toBe("failure");
    expect(payload.body as string).toContain("failed");
    expect(payload.body as string).toContain("see https://github.com/");
  });
});

// ── work-54 (idea-357 pt-2): the derived first-class deploy event ─────

describe("deploy-completed recognizer (work-54)", () => {
  it("a deploy workflow's completed run emits an ADDITIONAL deploy-completed dispatch", async () => {
    const run = makeRun({ name: "deploy-hub", status: "completed", conclusion: "success", event: "push" });
    const repoEvent = translateWorkflowRun(run, "apnex-org/agentic-network");
    const inbound = wrapAsExternalInjectionMessage(repoEvent);
    const dispatches = await WORKFLOW_RUN_COMPLETED_HANDLER.handle(inbound, stubCtx);
    expect(dispatches).toHaveLength(2);

    // [0] stays the generic workflow-run event (unchanged contract)
    expect((dispatches[0].payload as Record<string, unknown>).notificationEvent)
      .toBe("workflow-run-completed-notification");

    const deploy = dispatches[1];
    expect(deploy.kind).toBe("external-injection");
    expect(deploy.target).toBeNull();
    expect(deploy.intent).toBe("deploy-completed");
    const p = deploy.payload as Record<string, unknown>;
    expect(p.notificationEvent).toBe("deploy-completed-notification");
    expect(p.workflow_name).toBe("deploy-hub");
    expect(p.conclusion).toBe("success");
    expect(p.head_sha).toMatch(/^[a-f0-9]{40}$/); // the gating agent's roll-identity key
    expect(p.body as string).toContain("deploy success");
  });

  it("a deploy failure's derived body carries the run url for follow-up", async () => {
    const run = makeRun({ name: "deploy-hub", status: "completed", conclusion: "failure", event: "push" });
    const inbound = wrapAsExternalInjectionMessage(translateWorkflowRun(run, "apnex-org/agentic-network"));
    const dispatches = await WORKFLOW_RUN_COMPLETED_HANDLER.handle(inbound, stubCtx);
    const p = dispatches[1].payload as Record<string, unknown>;
    expect(p.body as string).toContain("deploy failure");
    expect(p.body as string).toContain("see https://github.com/");
  });

  it("a non-deploy workflow emits NO deploy dispatch", async () => {
    const run = makeRun({ name: "release-plugin", status: "completed", conclusion: "success" });
    const inbound = wrapAsExternalInjectionMessage(translateWorkflowRun(run, "apnex-org/agentic-network"));
    const dispatches = await WORKFLOW_RUN_COMPLETED_HANDLER.handle(inbound, stubCtx);
    expect(dispatches).toHaveLength(1);
    expect((dispatches[0].payload as Record<string, unknown>).notificationEvent)
      .toBe("workflow-run-completed-notification");
  });
});

describe("workflow-run wire-flow — workflow_dispatch (manual)", () => {
  it("dispatches via WORKFLOW_RUN_DISPATCHED_HANDLER + body names triggering actor", async () => {
    const run = makeRun({
      name: "deploy-hub",
      status: "completed",
      event: "workflow_dispatch",
      triggering_actor: { login: "apnex-greg" },
    });
    const repoEvent = translateWorkflowRun(run, "apnex-org/agentic-network");
    expect(repoEvent.subkind).toBe("workflow-run-dispatched");

    const inbound = wrapAsExternalInjectionMessage(repoEvent);
    const dispatches = await WORKFLOW_RUN_DISPATCHED_HANDLER.handle(inbound, stubCtx);
    expect(dispatches).toHaveLength(1);

    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.notificationEvent).toBe("workflow-run-dispatched-notification");
    expect(payload.body as string).toContain("manual_dispatch");
    expect(payload.body as string).toContain("deploy-hub");
    expect(payload.body as string).toContain("apnex-greg");
  });
});

describe("workflow-run wire-flow — in-progress", () => {
  it("dispatches via WORKFLOW_RUN_IN_PROGRESS_HANDLER (default-filtered)", async () => {
    const run = makeRun({
      status: "in_progress",
      conclusion: null,
    });
    const repoEvent = translateWorkflowRun(run, "apnex-org/agentic-network");
    expect(repoEvent.subkind).toBe("workflow-run-in-progress");

    const inbound = wrapAsExternalInjectionMessage(repoEvent);
    const dispatches = await WORKFLOW_RUN_IN_PROGRESS_HANDLER.handle(inbound, stubCtx);
    expect(dispatches).toHaveLength(1);

    const payload = dispatches[0].payload as Record<string, unknown>;
    expect(payload.notificationEvent).toBe("workflow-run-in-progress-notification");
  });
});

// ── Filter-list (F3 fold) ─────────────────────────────────────────────

describe("shouldFilterPeekLine — workflow-run filter-list (§1.8 F3 fold)", () => {
  it("filters in-progress notifications (transient state)", () => {
    expect(
      shouldFilterPeekLine("workflow-run-in-progress-notification", {
        workflow_name: "release-plugin",
      }),
    ).toBe(true);
  });

  it("filters routine CI on success (test/secret-scan/no-engineer-id)", () => {
    expect(
      shouldFilterPeekLine("workflow-run-completed-notification", {
        workflow_name: "test",
        conclusion: "success",
      }),
    ).toBe(true);
    expect(
      shouldFilterPeekLine("workflow-run-completed-notification", {
        workflow_name: "secret-scan",
        conclusion: "success",
      }),
    ).toBe(true);
    expect(
      shouldFilterPeekLine("workflow-run-completed-notification", {
        workflow_name: "no-engineer-id",
        conclusion: "success",
      }),
    ).toBe(true);
  });

  it("never filters failures (any workflow)", () => {
    expect(
      shouldFilterPeekLine("workflow-run-completed-notification", {
        workflow_name: "test",
        conclusion: "failure",
      }),
    ).toBe(false);
    expect(
      shouldFilterPeekLine("workflow-run-completed-notification", {
        workflow_name: "release-plugin",
        conclusion: "failure",
      }),
    ).toBe(false);
  });

  it("renders operator-significant successes (deploy-hub / release-plugin)", () => {
    expect(
      shouldFilterPeekLine("workflow-run-completed-notification", {
        workflow_name: "deploy-hub",
        conclusion: "success",
      }),
    ).toBe(false);
    expect(
      shouldFilterPeekLine("workflow-run-completed-notification", {
        workflow_name: "release-plugin",
        conclusion: "success",
      }),
    ).toBe(false);
  });

  it("never filters manual workflow_dispatch (operator triggered)", () => {
    expect(
      shouldFilterPeekLine("workflow-run-dispatched-notification", {
        workflow_name: "deploy-hub",
      }),
    ).toBe(false);
  });
});

// ── deriveRenderContext + format-regex contract ───────────────────────

describe("deriveRenderContext — System-Workflow + workflow EntityRef + verb derivation", () => {
  it("workflow-run-completed + success → 'succeeded' verb + FYI actionability", () => {
    const ctx = deriveRenderContext("workflow-run-completed-notification", {
      workflow_name: "release-plugin",
      run_id: 25529674489,
      head_branch: "main",
      conclusion: "success",
      status: "completed",
      event: "push",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.sourceClass).toBe("System-Workflow");
    expect(ctx!.entityRef?.type).toBe("workflow");
    expect(ctx!.entityRef?.id).toMatch(/^run-\d+$/);
    expect(ctx!.actionVerb).toContain("succeeded");
    expect(ctx!.actionability).toBe("FYI");
  });

  it("workflow-run-completed + failure → 'failed' verb + your-turn actionability", () => {
    const ctx = deriveRenderContext("workflow-run-completed-notification", {
      workflow_name: "deploy-hub",
      run_id: 1,
      conclusion: "failure",
      status: "completed",
      event: "push",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.sourceClass).toBe("System-Workflow");
    expect(ctx!.actionVerb).toContain("failed");
    expect(ctx!.actionability).toBe("your-turn");
  });

  it("workflow-run-dispatched → 'Manual dispatch fired' verb", () => {
    const ctx = deriveRenderContext("workflow-run-dispatched-notification", {
      workflow_name: "deploy-hub",
      run_id: 1,
      event: "workflow_dispatch",
      status: "completed",
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.sourceClass).toBe("System-Workflow");
    expect(ctx!.actionVerb).toContain("Manual dispatch");
  });

  it("workflow-run-in-progress filtered (returns null per filter-list)", () => {
    const ctx = deriveRenderContext("workflow-run-in-progress-notification", {
      workflow_name: "test",
      run_id: 1,
      status: "in_progress",
    });
    expect(ctx).toBeNull();
  });

  it("renderPeekLineBody output matches PEEK_LINE_FORMAT_REGEX for System-Workflow", () => {
    const ctx = deriveRenderContext("workflow-run-completed-notification", {
      workflow_name: "release-plugin",
      run_id: 25529674489,
      head_branch: "main",
      conclusion: "success",
      status: "completed",
      event: "push",
      body: "push succeeded: \"release-plugin\" — head_sha=8244c09@main",
    });
    expect(ctx).not.toBeNull();
    const line = renderPeekLineBody({
      sourceClass: ctx!.sourceClass,
      actionVerb: ctx!.actionVerb,
      entityRef: ctx!.entityRef,
      bodyPreview: ctx!.bodyPreview,
      actionability: ctx!.actionability,
    });
    expect(line).toMatch(PEEK_LINE_FORMAT_REGEX);
    expect(line).toContain("[System-Workflow]");
  });
});

// ── Defensive: missing payload ────────────────────────────────────────

describe("workflow-run handler — defensive on malformed input", () => {
  it("returns 0 dispatches when payload.payload is missing", async () => {
    const inbound = {
      id: "01BAD",
      kind: "external-injection",
      payload: {},
    } as unknown as Message;
    const dispatches = await WORKFLOW_RUN_COMPLETED_HANDLER.handle(inbound, stubCtx);
    expect(dispatches).toHaveLength(0);
  });

  it("returns 0 dispatches when run_id is absent", async () => {
    const inbound = wrapAsExternalInjectionMessage({
      kind: "repo-event",
      subkind: "workflow-run-completed",
      payload: {
        workflowName: "release-plugin",
        // runId omitted
      },
    });
    const dispatches = await WORKFLOW_RUN_COMPLETED_HANDLER.handle(inbound, stubCtx);
    expect(dispatches).toHaveLength(0);
  });
});
