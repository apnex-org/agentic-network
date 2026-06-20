/**
 * session-event.test.ts — bug-161 + de-any regression coverage.
 *
 * The OpenCode shim's session-event handler was 0.4.x-shaped: it compared the
 * v2 `session.status` payload (an OBJECT {type:"idle"|"retry"|"busy"}) as if it
 * were a status STRING, so the comparisons never matched in v2 → `sessionActive`
 * never went true → the notificationQueue never engaged (notifications surfaced
 * mid-stream). The de-any fix types the handler against the v2 Event union and
 * remaps `status.type`. These tests pin that behavior (they would FAIL against
 * the pre-bug-161 string-compare handler).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { _testOnly } from "../src/shim.js";

type SessionEvent = Parameters<typeof _testOnly.handleSessionEvent>[0];

const sessionStatus = (statusType: string): SessionEvent =>
  ({
    type: "session.status",
    properties: { sessionID: "s1", status: { type: statusType } },
  }) as unknown as SessionEvent;

const sessionCreated = (id: string): SessionEvent =>
  ({ type: "session.created", properties: { info: { id } } }) as unknown as SessionEvent;

const sessionUpdated = (id: string): SessionEvent =>
  ({ type: "session.updated", properties: { info: { id } } }) as unknown as SessionEvent;

const sessionIdle = (): SessionEvent =>
  ({ type: "session.idle", properties: { sessionID: "s1" } }) as unknown as SessionEvent;

describe("handleSessionEvent — sessionActive tracking (bug-161, de-any)", () => {
  beforeEach(() => {
    _testOnly.setSessionActive(false);
    _testOnly.setHubAdapter(null);
  });

  it("session.status {type:busy} → sessionActive true (bug-161: v2 status is an object, not a string)", async () => {
    _testOnly.setSessionActive(false);
    await _testOnly.handleSessionEvent(sessionStatus("busy"));
    expect(_testOnly.getSessionActive()).toBe(true);
  });

  it("session.status {type:retry} → sessionActive true (mid-task)", async () => {
    _testOnly.setSessionActive(false);
    await _testOnly.handleSessionEvent(sessionStatus("retry"));
    expect(_testOnly.getSessionActive()).toBe(true);
  });

  it("session.status {type:idle} → sessionActive false", async () => {
    _testOnly.setSessionActive(true);
    await _testOnly.handleSessionEvent(sessionStatus("idle"));
    expect(_testOnly.getSessionActive()).toBe(false);
  });

  it("session.idle → sessionActive false", async () => {
    _testOnly.setSessionActive(true);
    await _testOnly.handleSessionEvent(sessionIdle());
    expect(_testOnly.getSessionActive()).toBe(false);
  });

  it("session.created → currentSessionId = properties.info.id (v2 shape; no .id fallback)", async () => {
    await _testOnly.handleSessionEvent(sessionCreated("sess-created"));
    expect(_testOnly.getCurrentSessionId()).toBe("sess-created");
  });

  it("session.updated → currentSessionId = properties.info.id", async () => {
    await _testOnly.handleSessionEvent(sessionUpdated("sess-updated"));
    expect(_testOnly.getCurrentSessionId()).toBe("sess-updated");
  });
});
