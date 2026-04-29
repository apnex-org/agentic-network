/**
 * Mission-66 W1+W2 commit 6 — thread_message marker-protocol render tests.
 *
 * Closes calibration #26 (silent thread_message body-truncation marker
 * missing; OPEN since mission-63-W4) per Design §2.1.2 architect-lean (b)
 * `<channel>`-attribute approach.
 *
 * Hub envelope-builder (thread-policy.ts) surfaces `truncated: true` +
 * `fullBytes: <n>` on dispatchPayload when body length > 200 chars
 * (THREAD_MESSAGE_PREVIEW_CHARS canonical Phase 2 constant). Adapter
 * render-template-registry consumes these attributes + appends marker
 * `[…<N> bytes truncated; query thread for full content]`.
 *
 * Test surface per SPEC §2.4 Test 1-4.
 */

import { describe, it, expect } from "vitest";
import { buildPromptText } from "../../src/prompt-format.js";

const cfg = { toolPrefix: "mcp__plugin_agent-adapter_proxy__" };

describe("Mission-66 commit 6 — renderThreadMessage marker-protocol (closes #26)", () => {
  it("renders body unchanged when truncated flag absent (non-truncated case)", () => {
    const out = buildPromptText("thread_message", {
      threadId: "thread-1",
      title: "Test Thread",
      author: "architect",
      message: "short message body",
      currentTurn: "engineer",
    }, cfg);
    expect(out).toContain("Message preview: short message body");
    expect(out).not.toContain("bytes truncated");
  });

  it("appends truncation marker when truncated=true + fullBytes set", () => {
    const out = buildPromptText("thread_message", {
      threadId: "thread-1",
      title: "Test Thread",
      author: "architect",
      message: "preview body — first 200 chars",
      currentTurn: "engineer",
      truncated: true,
      fullBytes: 1245,
    }, cfg);
    expect(out).toContain("Message preview: preview body — first 200 chars");
    expect(out).toContain("[…1245 bytes truncated; query thread for full content]");
  });

  it("does NOT append marker when truncated=true but fullBytes missing (defensive)", () => {
    const out = buildPromptText("thread_message", {
      threadId: "thread-1",
      title: "Test Thread",
      author: "architect",
      message: "body",
      currentTurn: "engineer",
      truncated: true,
      // fullBytes intentionally omitted
    }, cfg);
    expect(out).not.toContain("bytes truncated");
  });

  it("does NOT append marker when truncated=false explicitly", () => {
    const out = buildPromptText("thread_message", {
      threadId: "thread-1",
      title: "Test Thread",
      author: "architect",
      message: "body",
      currentTurn: "engineer",
      truncated: false,
      fullBytes: 100,
    }, cfg);
    expect(out).not.toContain("bytes truncated");
  });

  it("preserves authorLabel + threadId render path with truncation marker present", () => {
    const out = buildPromptText("thread_message", {
      threadId: "thread-99",
      title: "Important Discussion",
      author: "engineer",
      message: "preview",
      currentTurn: "architect",
      truncated: true,
      fullBytes: 500,
    }, cfg);
    expect(out).toContain("[Engineer peer] Replied to thread");
    expect(out).toContain("Important Discussion");
    expect(out).toContain("threadId=\"thread-99\"");
    expect(out).toContain("[…500 bytes truncated; query thread for full content]");
  });

  it("backward-compat: old Hub events without truncated/fullBytes render cleanly (forward-compat preserved)", () => {
    // Phase 1 events that pre-date marker-protocol have no truncated field;
    // adapter must render them without marker (no error). Ratifies forward-
    // compat: vertex-cloudrun adapter (Phase 3) can ignore unknown attrs.
    const out = buildPromptText("thread_message", {
      threadId: "thread-legacy",
      title: "Legacy",
      author: "architect",
      message: "old-style payload",
      currentTurn: "engineer",
      // truncated + fullBytes absent (legacy Phase 1 shape)
    }, cfg);
    expect(out).toContain("Message preview: old-style payload");
    expect(out).not.toContain("bytes truncated");
  });
});
