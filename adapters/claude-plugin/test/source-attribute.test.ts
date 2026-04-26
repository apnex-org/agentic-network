/**
 * Mission-56 W2.3 — claude-plugin render-surface taxonomy.
 *
 * Pure-function tests for `resolveSourceAttribute(eventType)`. Pinned
 * invariants:
 *   - Mission-52 repo-event subkinds → repo-event family
 *   - director_attention_required → directive family
 *   - Known general Hub events → notification family
 *   - Anything else → proxy fallback (preserves backward compat with
 *     pre-taxonomy events)
 *
 * Spec: docs/specs/universal-adapter-notification-contract.md
 *       §"Render-surface semantics" worked example
 * Design: docs/designs/m-push-foundation-design.md v1.2
 *         §"Architectural commitments #4"
 */

import { describe, expect, it } from "vitest";
import {
  resolveSourceAttribute,
  isPulseEvent,
  SOURCE_ATTRIBUTE_FAMILIES,
} from "../src/source-attribute.js";

describe("resolveSourceAttribute — repo-event family", () => {
  const repoEventSubkinds = [
    "pr-opened",
    "pr-closed",
    "pr-merged",
    "pr-review-submitted",
    "pr-review-approved",
    "pr-review-comment",
    "commit-pushed",
    "unknown",
  ];

  for (const subkind of repoEventSubkinds) {
    it(`maps ${subkind} → ${SOURCE_ATTRIBUTE_FAMILIES.REPO_EVENT}`, () => {
      expect(resolveSourceAttribute(subkind)).toBe(SOURCE_ATTRIBUTE_FAMILIES.REPO_EVENT);
    });
  }
});

describe("resolveSourceAttribute — directive family", () => {
  it("maps director_attention_required → directive", () => {
    expect(resolveSourceAttribute("director_attention_required")).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.DIRECTIVE,
    );
  });

  it("does NOT route directive_acknowledged to directive (it's a general notification)", () => {
    expect(resolveSourceAttribute("directive_acknowledged")).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.NOTIFICATION,
    );
  });
});

describe("resolveSourceAttribute — notification family", () => {
  const notificationEvents = [
    "thread_message",
    "thread_convergence_finalized",
    "task_issued",
    "report_submitted",
    "review_completed",
    "revision_required",
    "proposal_submitted",
    "proposal_decided",
    "clarification_requested",
    "clarification_answered",
    "directive_acknowledged",
    "idea_submitted",
    "mission_created",
    "mission_activated",
    "turn_created",
    "turn_updated",
    "tele_defined",
    "cascade_failure",
    "thread_opened",
    "thread_abandoned",
    "message_arrived",
  ];

  for (const eventType of notificationEvents) {
    it(`maps ${eventType} → ${SOURCE_ATTRIBUTE_FAMILIES.NOTIFICATION}`, () => {
      expect(resolveSourceAttribute(eventType)).toBe(
        SOURCE_ATTRIBUTE_FAMILIES.NOTIFICATION,
      );
    });
  }
});

describe("resolveSourceAttribute — proxy fallback", () => {
  it("falls back to proxy for unrecognised event types", () => {
    expect(resolveSourceAttribute("totally_unknown_event")).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.PROXY,
    );
  });

  it("falls back to proxy for the empty string (defensive)", () => {
    expect(resolveSourceAttribute("")).toBe(SOURCE_ATTRIBUTE_FAMILIES.PROXY);
  });

  it("does not partial-match on substrings (exact-match only)", () => {
    expect(resolveSourceAttribute("pr-merged-but-not")).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.PROXY,
    );
    expect(resolveSourceAttribute("almost_director_attention_required")).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.PROXY,
    );
  });
});

describe("resolveSourceAttribute — exhaustive families", () => {
  it("exposes the five ratified family strings on SOURCE_ATTRIBUTE_FAMILIES", () => {
    expect(SOURCE_ATTRIBUTE_FAMILIES.REPO_EVENT).toBe("plugin:agent-adapter:repo-event");
    expect(SOURCE_ATTRIBUTE_FAMILIES.DIRECTIVE).toBe("plugin:agent-adapter:directive");
    expect(SOURCE_ATTRIBUTE_FAMILIES.NOTIFICATION).toBe(
      "plugin:agent-adapter:notification",
    );
    expect(SOURCE_ATTRIBUTE_FAMILIES.PULSE).toBe("plugin:agent-adapter:pulse");
    expect(SOURCE_ATTRIBUTE_FAMILIES.PROXY).toBe("plugin:agent-adapter:proxy");
  });
});

// Mission-57 W3 — pulse-family extension tests

describe("resolveSourceAttribute — pulse family (mission-57 W3)", () => {
  const pulseStatusCheck = {
    message: {
      kind: "external-injection",
      payload: { pulseKind: "status_check", missionId: "mission-57", message: "status?" },
    },
  };

  const pulseEscalation = {
    message: {
      kind: "external-injection",
      payload: { pulseKind: "missed_threshold_escalation", missionId: "mission-57", silentRole: "engineer" },
    },
  };

  it("routes message_arrived + pulseKind=status_check → pulse family", () => {
    expect(resolveSourceAttribute("message_arrived", pulseStatusCheck)).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.PULSE,
    );
  });

  it("routes message_arrived + pulseKind=missed_threshold_escalation → pulse family", () => {
    expect(resolveSourceAttribute("message_arrived", pulseEscalation)).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.PULSE,
    );
  });

  it("routes message_arrived without pulseKind → notification family (existing behavior)", () => {
    const nonPulseMessage = {
      message: {
        kind: "reply",
        payload: { text: "thread reply" },
      },
    };
    expect(resolveSourceAttribute("message_arrived", nonPulseMessage)).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.NOTIFICATION,
    );
  });

  it("backward-compat: message_arrived without eventData → notification family", () => {
    expect(resolveSourceAttribute("message_arrived")).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.NOTIFICATION,
    );
  });

  it("does NOT route non-message_arrived events with pulseKind payload → falls through normal taxonomy", () => {
    expect(resolveSourceAttribute("thread_message", pulseStatusCheck)).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.NOTIFICATION,
    );
  });

  it("rejects unknown pulseKind values → notification family", () => {
    const unknownPulseKind = {
      message: {
        payload: { pulseKind: "not-a-real-pulse-kind" },
      },
    };
    expect(resolveSourceAttribute("message_arrived", unknownPulseKind)).toBe(
      SOURCE_ATTRIBUTE_FAMILIES.NOTIFICATION,
    );
  });
});

describe("isPulseEvent (mission-57 W3)", () => {
  it("returns true for message_arrived + pulseKind=status_check", () => {
    expect(
      isPulseEvent("message_arrived", {
        message: { payload: { pulseKind: "status_check" } },
      }),
    ).toBe(true);
  });

  it("returns true for message_arrived + pulseKind=missed_threshold_escalation", () => {
    expect(
      isPulseEvent("message_arrived", {
        message: { payload: { pulseKind: "missed_threshold_escalation" } },
      }),
    ).toBe(true);
  });

  it("returns false for non-message_arrived eventType", () => {
    expect(
      isPulseEvent("thread_message", {
        message: { payload: { pulseKind: "status_check" } },
      }),
    ).toBe(false);
  });

  it("returns false when payload lacks pulseKind", () => {
    expect(
      isPulseEvent("message_arrived", {
        message: { payload: { text: "regular reply" } },
      }),
    ).toBe(false);
  });

  it("returns false when eventData is omitted", () => {
    expect(isPulseEvent("message_arrived")).toBe(false);
  });

  it("returns false for unknown pulseKind values", () => {
    expect(
      isPulseEvent("message_arrived", {
        message: { payload: { pulseKind: "not-a-real-pulse-kind" } },
      }),
    ).toBe(false);
  });
});
