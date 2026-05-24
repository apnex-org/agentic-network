/**
 * mission-88 W8 cluster-4 — Notification migration module unit tests (bug-124).
 *
 * Per W8 Design v1.0 (PR #285). Asserts:
 *   - id preserved at envelope top-level + copied to metadata.name (handle)
 *   - timestamp → metadata.createdAt (envelope-uniformity rename per Audit precedent)
 *   - event → spec.eventType (declared-routing-intent rename)
 *   - data → spec.payload (content)
 *   - targetRoles → spec (declared-routing-intent)
 *   - status.phase: "logged" constant (append-only per Audit precedent; no FSM)
 *   - 14-eventType enum validation + "unknown" fallback (W8 Q1)
 *   - Cascade-provenance injection for REQUIRED + OPTIONAL thread-sourced
 *     eventTypes (W8 Q2)
 *   - Idempotency reference-equality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNotificationMigrationModule } from "../../kinds/Notification.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const notificationSchema: SchemaDef = {
  kind: "Notification",
  version: 2,
  fields: [],
  indexes: [],
  watchable: true,
};

function legacyNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "01KP2JD2Q408F58QKY32HQEEYS",
    event: "report_submitted",
    timestamp: "2026-04-13T04:43:08.901Z",
    targetRoles: ["architect"],
    data: { taskId: "task-90", summary: "AMP Phase 1 complete", reportRef: "reports/task-90-report.md" },
    ...overrides,
  };
}

describe("Notification migration module — envelope-shape encoding", () => {
  const module = createNotificationMigrationModule(notificationSchema);

  it("declares kind=Notification", () => {
    expect(module.kind).toBe("Notification");
  });

  it("encodes legacy Notification to envelope shape", () => {
    const env = module.migrateOne(legacyNotification()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Notification");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
    expect(env.id).toBe("01KP2JD2Q408F58QKY32HQEEYS");
  });

  it("id → metadata.name (handle-classified per cluster-2 precedent)", () => {
    const env = module.migrateOne(legacyNotification()) as EnvelopeShape;
    expect(env.metadata.name).toBe("01KP2JD2Q408F58QKY32HQEEYS");
    expect(env.name).toBe("01KP2JD2Q408F58QKY32HQEEYS");
  });

  it("timestamp → metadata.createdAt (envelope-uniformity rename per Audit precedent)", () => {
    const env = module.migrateOne(legacyNotification()) as EnvelopeShape;
    expect(env.metadata.createdAt).toBe("2026-04-13T04:43:08.901Z");
    expect((env.metadata as Record<string, unknown>).timestamp).toBeUndefined();
  });

  it("event → spec.eventType (declared-routing-intent rename)", () => {
    const env = module.migrateOne(legacyNotification()) as EnvelopeShape;
    expect((env.spec as Record<string, unknown>).eventType).toBe("report_submitted");
    expect((env.spec as Record<string, unknown>).event).toBeUndefined();
  });

  it("data → spec.payload (content)", () => {
    const env = module.migrateOne(legacyNotification()) as EnvelopeShape;
    const spec = env.spec as Record<string, unknown>;
    expect(spec.payload).toEqual({
      taskId: "task-90",
      summary: "AMP Phase 1 complete",
      reportRef: "reports/task-90-report.md",
    });
    expect(spec.data).toBeUndefined();
  });

  it("targetRoles → spec.targetRoles", () => {
    const env = module.migrateOne(legacyNotification()) as EnvelopeShape;
    expect((env.spec as Record<string, unknown>).targetRoles).toEqual(["architect"]);
  });

  it("status.phase: 'logged' constant injection (append-only per Audit precedent)", () => {
    const env = module.migrateOne(legacyNotification()) as EnvelopeShape;
    expect((env.status as Record<string, unknown>).phase).toBe("logged");
  });

  it("NO updatedAt (append-only; immutable post-create)", () => {
    const env = module.migrateOne(legacyNotification()) as EnvelopeShape;
    expect((env.metadata as Record<string, unknown>).updatedAt).toBeUndefined();
  });
});

describe("Notification migration module — eventType enum validation (W8 Q1)", () => {
  const module = createNotificationMigrationModule(notificationSchema);
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  const knownEventTypes = [
    "review_completed",
    "thread_message",
    "report_submitted",
    "directive_issued",
    "directive_acknowledged",
    "idea_submitted",
    "thread_converged",
    "proposal_decided",
    "proposal_submitted",
    "mission_created",
    "turn_created",
    "tele_defined",
    "clarification_requested",
    "clarification_answered",
  ];

  // Provide threadId for REQUIRED thread-sourced eventTypes so the cascade-
  // provenance WARN doesn't fire (we're testing enum acceptance, not cascade).
  const requiredThreadSourced = new Set(["thread_message", "thread_converged", "turn_created"]);

  it.each(knownEventTypes)("accepts known eventType=%s without WARN", (eventType) => {
    const data = requiredThreadSourced.has(eventType)
      ? { threadId: "thread-test", extra: "data" }
      : { taskId: "task-test" };
    const env = module.migrateOne(legacyNotification({ event: eventType, data })) as EnvelopeShape;
    expect((env.spec as Record<string, unknown>).eventType).toBe(eventType);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to 'unknown' + WARNs on un-cataloged eventType", () => {
    const env = module.migrateOne(legacyNotification({ event: "future_event_v2" })) as EnvelopeShape;
    expect((env.spec as Record<string, unknown>).eventType).toBe("unknown");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/unknown eventType="future_event_v2"/);
    expect(warnSpy.mock.calls[0][0]).toMatch(/cataloging-gap/);
  });
});

describe("Notification migration module — cascade-provenance (W8 Q2)", () => {
  const module = createNotificationMigrationModule(notificationSchema);
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("injects metadata.sourceThreadId for REQUIRED thread-sourced eventType (thread_message)", () => {
    const env = module.migrateOne(
      legacyNotification({
        event: "thread_message",
        data: { threadId: "thread-650", messageId: "msg-1" },
      }),
    ) as EnvelopeShape;
    expect((env.metadata as Record<string, unknown>).sourceThreadId).toBe("thread-650");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("WARNs when REQUIRED thread-sourced eventType lacks data.threadId", () => {
    const env = module.migrateOne(
      legacyNotification({ event: "thread_converged", data: { otherField: "x" } }),
    ) as EnvelopeShape;
    expect((env.metadata as Record<string, unknown>).sourceThreadId).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/REQUIRED-thread-sourced eventType="thread_converged"/);
  });

  it("injects metadata.sourceThreadId for OPTIONAL thread-sourced eventType when present (idea_submitted)", () => {
    const env = module.migrateOne(
      legacyNotification({
        event: "idea_submitted",
        data: { threadId: "thread-X", ideaId: "idea-1" },
      }),
    ) as EnvelopeShape;
    expect((env.metadata as Record<string, unknown>).sourceThreadId).toBe("thread-X");
  });

  it("SKIPS metadata.sourceThreadId for OPTIONAL thread-sourced eventType when absent (idea_submitted)", () => {
    const env = module.migrateOne(
      legacyNotification({ event: "idea_submitted", data: { ideaId: "idea-1" } }),
    ) as EnvelopeShape;
    expect((env.metadata as Record<string, unknown>).sourceThreadId).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does NOT inject sourceThreadId for non-thread-sourced eventType (report_submitted)", () => {
    const env = module.migrateOne(
      legacyNotification({
        event: "report_submitted",
        data: { taskId: "task-90", threadId: "thread-Z" /* should be ignored */ },
      }),
    ) as EnvelopeShape;
    expect((env.metadata as Record<string, unknown>).sourceThreadId).toBeUndefined();
  });
});

describe("Notification migration module — idempotency", () => {
  const module = createNotificationMigrationModule(notificationSchema);

  it("returns reference-equal input when already envelope-shape", () => {
    const env = module.migrateOne(legacyNotification());
    const env2 = module.migrateOne(env);
    expect(env2).toBe(env);
  });

  it("throws on non-object input", () => {
    expect(() => module.migrateOne("string-input")).toThrow(/must be object/);
    expect(() => module.migrateOne(null)).toThrow(/must be object/);
    expect(() => module.migrateOne(42)).toThrow(/must be object/);
  });
});
