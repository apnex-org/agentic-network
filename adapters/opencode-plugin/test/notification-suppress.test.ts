/**
 * notification-suppress.test.ts — thread-671 presence/telemetry filter.
 *
 * Covers `isEventSuppressed`, the pure predicate behind the shim's
 * `onInformationalEvent` surface gate: presence/telemetry events
 * (`agent_state_changed`) must be suppressed from the toast/inject surface
 * so they don't flood the TUI or burn the session context window (tele-12),
 * while real traffic flows through untouched.
 */

import { describe, it, expect } from "vitest";
import { isEventSuppressed } from "../src/shim.js";

describe("isEventSuppressed — notification-surface gate (thread-671)", () => {
  it("suppresses agent_state_changed by default (no config needed)", () => {
    expect(isEventSuppressed("agent_state_changed")).toBe(true);
    expect(isEventSuppressed("agent_state_changed", [])).toBe(true);
  });

  it("does NOT suppress real traffic — actionable + other informational events flow through", () => {
    // The acute-flood fix must not silently swallow signal.
    expect(isEventSuppressed("thread_message")).toBe(false);
    expect(isEventSuppressed("report_submitted")).toBe(false);
    expect(isEventSuppressed("message_arrived")).toBe(false);
    expect(isEventSuppressed("turn_created")).toBe(false);
  });

  it("config.suppressEvents ADDS to the default set (operator extension)", () => {
    const extra = ["turn_created", "turn_updated"];
    expect(isEventSuppressed("turn_created", extra)).toBe(true);
    expect(isEventSuppressed("turn_updated", extra)).toBe(true);
    // default still applies alongside the config extension
    expect(isEventSuppressed("agent_state_changed", extra)).toBe(true);
    // an event in neither set is still surfaced
    expect(isEventSuppressed("thread_message", extra)).toBe(false);
  });

  it("treats an absent/empty config list as no extra suppression", () => {
    expect(isEventSuppressed("turn_created", undefined)).toBe(false);
    expect(isEventSuppressed("turn_created", [])).toBe(false);
  });
});
