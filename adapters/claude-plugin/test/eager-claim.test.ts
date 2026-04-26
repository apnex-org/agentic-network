/**
 * Unit tests for adapter T3 (mission-40) eager-claim helpers.
 *
 * Pins the load-bearing behaviors:
 *   - OIS_EAGER_SESSION_CLAIM env-var detection (strict "1" only)
 *   - claim_session response parsing handles all wrapper shapes defensively
 *   - takeover detection keys on sessionClaimed + displacedPriorSession from
 *     the parsed response, NOT on epoch delta (HC #1)
 *   - log line format matches the structured-parseable contract (HC #5)
 */

import { describe, it, expect } from "vitest";
import {
  isEagerWarmupEnabled,
  parseClaimSessionResponse,
  formatSessionClaimedLogLine,
} from "@ois/network-adapter";

describe("M-Session-Claim-Separation T3 — isEagerWarmupEnabled", () => {
  it("returns true when OIS_EAGER_SESSION_CLAIM === '1'", () => {
    expect(isEagerWarmupEnabled({ OIS_EAGER_SESSION_CLAIM: "1" })).toBe(true);
  });

  it("returns false when env var unset (lazy default — HC #2: probes inherit env without setting)", () => {
    expect(isEagerWarmupEnabled({})).toBe(false);
  });

  it("returns false on '0', 'true', 'false', or whitespace (strict '1' only — typo-safe)", () => {
    expect(isEagerWarmupEnabled({ OIS_EAGER_SESSION_CLAIM: "0" })).toBe(false);
    expect(isEagerWarmupEnabled({ OIS_EAGER_SESSION_CLAIM: "true" })).toBe(false);
    expect(isEagerWarmupEnabled({ OIS_EAGER_SESSION_CLAIM: "false" })).toBe(false);
    expect(isEagerWarmupEnabled({ OIS_EAGER_SESSION_CLAIM: " 1" })).toBe(false);
    expect(isEagerWarmupEnabled({ OIS_EAGER_SESSION_CLAIM: "1 " })).toBe(false);
    expect(isEagerWarmupEnabled({ OIS_EAGER_SESSION_CLAIM: "" })).toBe(false);
  });
});

describe("M-Session-Claim-Separation T3 — parseClaimSessionResponse", () => {
  const FULL_PAYLOAD = {
    engineerId: "eng-abc123",
    sessionEpoch: 7,
    sessionClaimed: true,
    displacedPriorSession: { sessionId: "sess-old", epoch: 6 },
  };

  it("unwraps the canonical MCP tool-call shape { content: [{ text }] }", () => {
    const wrapper = {
      content: [{ type: "text" as const, text: JSON.stringify(FULL_PAYLOAD) }],
    };
    const parsed = parseClaimSessionResponse(wrapper);
    expect(parsed).toEqual(FULL_PAYLOAD);
  });

  it("unwraps a JSON-encoded string wrapper", () => {
    const wrapper = JSON.stringify(FULL_PAYLOAD);
    const parsed = parseClaimSessionResponse(wrapper);
    expect(parsed).toEqual(FULL_PAYLOAD);
  });

  it("returns an already-parsed object as-is", () => {
    const parsed = parseClaimSessionResponse(FULL_PAYLOAD);
    expect(parsed).toEqual(FULL_PAYLOAD);
  });

  it("returns empty object on null / undefined / malformed input", () => {
    expect(parseClaimSessionResponse(null)).toEqual({});
    expect(parseClaimSessionResponse(undefined)).toEqual({});
    expect(parseClaimSessionResponse("not-json")).toEqual({});
    expect(parseClaimSessionResponse({ content: [{ text: "not-json" }] })).toEqual({});
  });

  it("HC #1: surfaces sessionClaimed + displacedPriorSession for takeover detection (NOT epoch delta)", () => {
    // The takeover-detection contract: callers key on these two fields.
    const wrapper = {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          engineerId: "eng-x",
          sessionEpoch: 9,
          sessionClaimed: true,
          displacedPriorSession: { sessionId: "sess-prior", epoch: 8 },
        }),
      }],
    };
    const parsed = parseClaimSessionResponse(wrapper);
    expect(parsed.sessionClaimed).toBe(true);
    expect(parsed.displacedPriorSession).toEqual({ sessionId: "sess-prior", epoch: 8 });
    // The epoch is informational (used in the log line) but takeover
    // detection MUST NOT compute (current_epoch - prior_epoch) — that
    // pattern is silently broken post-T2.
  });

  it("handles claim_session response with no displacement (first claim, no prior session)", () => {
    const wrapper = {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          engineerId: "eng-fresh",
          sessionEpoch: 1,
          sessionClaimed: true,
          // displacedPriorSession omitted on first-claim
        }),
      }],
    };
    const parsed = parseClaimSessionResponse(wrapper);
    expect(parsed.sessionClaimed).toBe(true);
    expect(parsed.displacedPriorSession).toBeUndefined();
  });
});

describe("M-Session-Claim-Separation T3 — formatSessionClaimedLogLine", () => {
  it("matches HC #5 structured-parseable contract — full payload", () => {
    const parsed = {
      engineerId: "eng-abc",
      sessionEpoch: 5,
      sessionClaimed: true,
      displacedPriorSession: { sessionId: "sess-old", epoch: 4 },
    };
    expect(formatSessionClaimedLogLine(parsed)).toBe(
      "[Handshake] Session claimed: epoch=5 (displaced prior: sess-old)"
    );
  });

  it("renders 'displaced prior: none' when no prior session was evicted", () => {
    const parsed = { engineerId: "eng-x", sessionEpoch: 1, sessionClaimed: true };
    expect(formatSessionClaimedLogLine(parsed)).toBe(
      "[Handshake] Session claimed: epoch=1 (displaced prior: none)"
    );
  });

  it("renders 'epoch=unknown' when response parse failed (defensive — never throws on malformed input)", () => {
    expect(formatSessionClaimedLogLine({})).toBe(
      "[Handshake] Session claimed: epoch=unknown (displaced prior: none)"
    );
  });

  it("preserves the literal '[Handshake] ' prefix for dashboard log-line consumption", () => {
    const parsed = { sessionEpoch: 42 };
    const line = formatSessionClaimedLogLine(parsed);
    expect(line.startsWith("[Handshake] Session claimed:")).toBe(true);
  });
});
