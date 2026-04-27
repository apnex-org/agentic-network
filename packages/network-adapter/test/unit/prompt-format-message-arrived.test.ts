/**
 * Mission-62 W1+W2 Pass 7 — buildPromptText `message_arrived` rendering tests.
 *
 * Pre-Pass-7 the message_arrived event fell through to the default
 * "[Hub] Notification: message_arrived." envelope-only render (the gap
 * surfaced on thread-391 as the pulse content-delivery bug + thread-382
 * as the note-kind enqueue gap). This test file pins the Pass-7 fix:
 * pulse fires, kind=note Messages, and external-injection wrappers each
 * render their payload content inline so the LLM has actionable info.
 */

import { describe, it, expect } from "vitest";
import { buildPromptText } from "../../src/prompt-format.js";

const cfg = { toolPrefix: "mcp__plugin_agent-adapter_proxy__" };

describe("buildPromptText — message_arrived (mission-62 Pass 7)", () => {
  it("renders pulse fire payload with pulseKind, missionId, message, responseShape", () => {
    const text = buildPromptText("message_arrived", {
      message: {
        id: "01KQABCDEFGHIJ",
        kind: "external-injection",
        authorRole: "system",
        authorAgentId: "hub",
        payload: {
          pulseKind: "status_check",
          missionId: "mission-62",
          intervalSeconds: 900,
          message: "mission-62 W1+W2 status check — current sub-item position",
          responseShape: "short_status",
        },
      },
    }, cfg);
    expect(text).toContain("Pulse fired (status_check)");
    expect(text).toContain("mission-62");
    expect(text).toContain("mission-62 W1+W2 status check");
    expect(text).toContain("short_status");
    expect(text).toContain("01KQABCDEFGHIJ");
  });

  it("renders kind=note Message with body + sender inline (closes thread-382 gap)", () => {
    const text = buildPromptText("message_arrived", {
      message: {
        id: "01KQ71RGYFZ",
        kind: "note",
        authorRole: "architect",
        authorAgentId: "eng-40903c59d19f",
        payload: {
          body: "PR #106 review needed + please explain note-handling state",
        },
      },
    }, cfg);
    expect(text).toContain("[architect/eng-40903c59d19f]");
    expect(text).toContain("PR #106 review needed");
    expect(text).toContain("01KQ71RGYFZ");
    expect(text).not.toContain("Notification: message_arrived"); // not the envelope-only default
  });

  it("falls back to body|text|message field carriers for kind=note", () => {
    const textCase = buildPromptText("message_arrived", {
      message: { id: "x", kind: "note", authorRole: "engineer", authorAgentId: "eng-z", payload: { text: "via text field" } },
    }, cfg);
    expect(textCase).toContain("via text field");
    const msgCase = buildPromptText("message_arrived", {
      message: { id: "y", kind: "note", authorRole: "engineer", authorAgentId: "eng-z", payload: { message: "via message field" } },
    }, cfg);
    expect(msgCase).toContain("via message field");
  });

  it("renders external-injection wrapped events via getActionText", () => {
    const text = buildPromptText("message_arrived", {
      message: {
        id: "01KQXYZ",
        kind: "external-injection",
        payload: {
          event: "task_issued",
          data: { taskId: "task-99" },
          targetRoles: ["engineer"],
        },
      },
    }, cfg);
    expect(text).toContain("Hub event injected: task_issued");
    expect(text).toContain("Pick up with get_task");
    expect(text).toContain("01KQXYZ");
  });

  it("falls back to generic kind+id render for unrecognized message shapes", () => {
    const text = buildPromptText("message_arrived", {
      message: { id: "01KQXYZUNK", kind: "future-kind", payload: {} },
    }, cfg);
    expect(text).toContain("Message 01KQXYZUNK");
    expect(text).toContain("kind=future-kind");
    expect(text).toContain("list_messages");
    expect(text).not.toContain("Notification: message_arrived"); // never the envelope-only default
  });

  it("handles empty/null payload defensively (no crash)", () => {
    const text = buildPromptText("message_arrived", { message: {} }, cfg);
    expect(text).toContain("Message ?");
    expect(text).toContain("kind=unknown");
  });
});
