/**
 * Mission-51 W1 — Message entity unit tests.
 *
 * Covers: kind taxonomy + axis matrix invariants, axis enforcement
 * helpers (`checkAuthorAuthorized`, `requiresTurn`, `shiftsTurn`), Zod
 * schema acceptance/rejection, path helpers, migrationSourceId helper.
 *
 * Repository-level behavior (CRUD, sequence-allocation, queries,
 * migration-shim parity) lives in message-repository.test.ts.
 */

import { describe, expect, it } from "vitest";

import {
  KIND_AXES,
  MESSAGE_AUTHOR_ROLES,
  MESSAGE_DELIVERY_MODES,
  MESSAGE_KINDS,
  MESSAGE_STATUSES,
  MessageSchema,
  checkAuthorAuthorized,
  makeMigrationSourceId,
  messagePath,
  requiresTurn,
  shiftsTurn,
  threadIndexPath,
} from "../../src/entities/message.js";

describe("Message kind taxonomy + axis matrix", () => {
  it("declares exactly five initial kinds (W1 ratified)", () => {
    expect(MESSAGE_KINDS).toEqual([
      "reply",
      "note",
      "external-injection",
      "amendment",
      "urgency-flag",
    ]);
  });

  it("KIND_AXES has an entry for every kind", () => {
    for (const kind of MESSAGE_KINDS) {
      expect(KIND_AXES[kind]).toBeDefined();
      expect(typeof KIND_AXES[kind].requires_turn).toBe("boolean");
      expect(typeof KIND_AXES[kind].shifts_turn).toBe("boolean");
      expect(["any", "director-only", "self-only"]).toContain(
        KIND_AXES[kind].authorized_authors,
      );
    }
  });

  it("reply: requires_turn=true, shifts_turn=true, authorized_authors=any", () => {
    expect(KIND_AXES.reply).toEqual({
      requires_turn: true,
      shifts_turn: true,
      authorized_authors: "any",
    });
  });

  it("note: requires_turn=false, shifts_turn=false, authorized_authors=any", () => {
    expect(KIND_AXES.note).toEqual({
      requires_turn: false,
      shifts_turn: false,
      authorized_authors: "any",
    });
  });

  it("external-injection: requires_turn=false, shifts_turn=false, authorized_authors=any", () => {
    expect(KIND_AXES["external-injection"]).toEqual({
      requires_turn: false,
      shifts_turn: false,
      authorized_authors: "any",
    });
  });

  it("amendment: requires_turn=false, shifts_turn=false, authorized_authors=self-only", () => {
    expect(KIND_AXES.amendment).toEqual({
      requires_turn: false,
      shifts_turn: false,
      authorized_authors: "self-only",
    });
  });

  it("urgency-flag: requires_turn=false, shifts_turn=true, authorized_authors=director-only", () => {
    expect(KIND_AXES["urgency-flag"]).toEqual({
      requires_turn: false,
      shifts_turn: true,
      authorized_authors: "director-only",
    });
  });
});

describe("requiresTurn / shiftsTurn helpers", () => {
  it("requiresTurn returns the per-kind axis value", () => {
    expect(requiresTurn("reply")).toBe(true);
    expect(requiresTurn("note")).toBe(false);
    expect(requiresTurn("external-injection")).toBe(false);
    expect(requiresTurn("amendment")).toBe(false);
    expect(requiresTurn("urgency-flag")).toBe(false);
  });

  it("shiftsTurn returns the per-kind axis value", () => {
    expect(shiftsTurn("reply")).toBe(true);
    expect(shiftsTurn("note")).toBe(false);
    expect(shiftsTurn("external-injection")).toBe(false);
    expect(shiftsTurn("amendment")).toBe(false);
    expect(shiftsTurn("urgency-flag")).toBe(true);
  });
});

describe("checkAuthorAuthorized", () => {
  it("accepts any role for authorized_authors=any (reply, note, external-injection)", () => {
    for (const kind of ["reply", "note", "external-injection"] as const) {
      for (const role of MESSAGE_AUTHOR_ROLES) {
        expect(checkAuthorAuthorized(kind, role, "agent-X")).toBeNull();
      }
    }
  });

  it("rejects non-director authors for urgency-flag (director-only)", () => {
    expect(checkAuthorAuthorized("urgency-flag", "engineer", "eng-1")).toMatch(
      /director author/,
    );
    expect(checkAuthorAuthorized("urgency-flag", "architect", "arch-1")).toMatch(
      /director author/,
    );
    expect(checkAuthorAuthorized("urgency-flag", "system", "sys-1")).toMatch(
      /director author/,
    );
  });

  it("accepts director author for urgency-flag", () => {
    expect(checkAuthorAuthorized("urgency-flag", "director", "dir-1")).toBeNull();
  });

  it("amendment requires priorAuthorAgentId for self-only check", () => {
    const result = checkAuthorAuthorized("amendment", "engineer", "eng-1");
    expect(result).toMatch(/priorAuthorAgentId/);
  });

  it("amendment accepts when caller agentId matches priorAuthorAgentId", () => {
    expect(
      checkAuthorAuthorized("amendment", "engineer", "eng-1", "eng-1"),
    ).toBeNull();
  });

  it("amendment rejects when caller agentId mismatches priorAuthorAgentId", () => {
    const result = checkAuthorAuthorized(
      "amendment",
      "engineer",
      "eng-1",
      "eng-2",
    );
    expect(result).toMatch(/self-only/);
    expect(result).toContain("eng-2");
    expect(result).toContain("eng-1");
  });
});

describe("MessageSchema (Zod validation)", () => {
  const minimal = {
    id: "01HX0000000000000000000000",
    kind: "reply" as const,
    authorRole: "engineer" as const,
    authorAgentId: "eng-1",
    target: null,
    delivery: "push-immediate" as const,
    status: "new" as const,
    payload: { text: "hello" },
    createdAt: "2026-04-25T19:00:00.000Z",
    updatedAt: "2026-04-25T19:00:00.000Z",
  };

  it("accepts a minimal valid message", () => {
    expect(() => MessageSchema.parse(minimal)).not.toThrow();
  });

  it("accepts target with role+agentId pinpoint", () => {
    expect(() =>
      MessageSchema.parse({
        ...minimal,
        target: { role: "architect", agentId: "arch-1" },
      }),
    ).not.toThrow();
  });

  it("accepts thread membership fields", () => {
    expect(() =>
      MessageSchema.parse({
        ...minimal,
        threadId: "thread-1",
        sequenceInThread: 5,
        intent: "decision_needed",
        semanticIntent: "seek_rigorous_critique",
        converged: false,
      }),
    ).not.toThrow();
  });

  it("accepts migrationSourceId for the W1 shim path", () => {
    expect(() =>
      MessageSchema.parse({
        ...minimal,
        migrationSourceId: "thread-message:thread-310/4",
      }),
    ).not.toThrow();
  });

  it("rejects unknown kind values", () => {
    expect(() =>
      MessageSchema.parse({ ...minimal, kind: "telepathy" }),
    ).toThrow();
  });

  it("rejects unknown authorRole values", () => {
    expect(() =>
      MessageSchema.parse({ ...minimal, authorRole: "operator" }),
    ).toThrow();
  });

  it("rejects unknown delivery values", () => {
    expect(() =>
      MessageSchema.parse({ ...minimal, delivery: "carrier-pigeon" }),
    ).toThrow();
  });

  it("rejects unknown status values", () => {
    expect(() =>
      MessageSchema.parse({ ...minimal, status: "weird" }),
    ).toThrow();
  });

  it("rejects negative sequenceInThread", () => {
    expect(() =>
      MessageSchema.parse({ ...minimal, sequenceInThread: -1 }),
    ).toThrow();
  });

  it("rejects empty authorAgentId", () => {
    expect(() =>
      MessageSchema.parse({ ...minimal, authorAgentId: "" }),
    ).toThrow();
  });

  it("rejects empty id", () => {
    expect(() => MessageSchema.parse({ ...minimal, id: "" })).toThrow();
  });
});

describe("Path helpers", () => {
  it("messagePath builds messages/<id>.json", () => {
    expect(messagePath("01HX0000")).toBe("messages/01HX0000.json");
  });

  it("threadIndexPath zero-pads sequence to 10 digits for lex ordering", () => {
    expect(threadIndexPath("thread-1", 0)).toBe(
      "messages-thread-index/thread-1/0000000000.json",
    );
    expect(threadIndexPath("thread-1", 5)).toBe(
      "messages-thread-index/thread-1/0000000005.json",
    );
    expect(threadIndexPath("thread-1", 9999999999)).toBe(
      "messages-thread-index/thread-1/9999999999.json",
    );
  });

  it("threadIndexPath ordering is lex-correct across digit-counts", () => {
    const paths = [9, 10, 100, 99, 1].map((n) =>
      threadIndexPath("t", n),
    );
    const sorted = [...paths].sort();
    // 1, 9, 10, 99, 100 — verifying lex sort produces numeric order
    // because of zero-padding.
    expect(sorted).toEqual([
      threadIndexPath("t", 1),
      threadIndexPath("t", 9),
      threadIndexPath("t", 10),
      threadIndexPath("t", 99),
      threadIndexPath("t", 100),
    ]);
  });

  it("makeMigrationSourceId produces namespace-prefixed identifiers", () => {
    expect(makeMigrationSourceId("thread-message", "thread-310/4")).toBe(
      "thread-message:thread-310/4",
    );
    expect(makeMigrationSourceId("notification", "01HX")).toBe(
      "notification:01HX",
    );
  });
});

describe("Constant arrays — completeness check", () => {
  it("MESSAGE_AUTHOR_ROLES = [architect, engineer, director, system]", () => {
    expect(MESSAGE_AUTHOR_ROLES).toEqual([
      "architect",
      "engineer",
      "director",
      "system",
    ]);
  });

  it("MESSAGE_DELIVERY_MODES = [push-immediate, queued, scheduled]", () => {
    expect(MESSAGE_DELIVERY_MODES).toEqual([
      "push-immediate",
      "queued",
      "scheduled",
    ]);
  });

  it("MESSAGE_STATUSES = [new, received, acked] (mission-56 W3.2 FSM extension)", () => {
    expect(MESSAGE_STATUSES).toEqual(["new", "received", "acked"]);
  });
});
