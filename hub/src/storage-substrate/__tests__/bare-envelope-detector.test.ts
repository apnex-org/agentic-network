/**
 * bare-envelope-detector.test.ts — C3-R4b piece 2 (cal-84 0-bare detector), unit.
 *
 * Covers the narrow full-envelope signature + the production-armed-only gate. The
 * real-pg integration (all kinds decode-flat-NO-throw + a synthetic bare row
 * throws + sweep-continues-on-quarantine) lives in the testcontainers suite; this
 * file is the fast pure-logic belt.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  BareEnvelopeError,
  isFullEnvelopeShape,
  assertDecodedFlat,
  armBareEnvelopeDetector,
  disarmBareEnvelopeDetector,
  isBareEnvelopeDetectorArmed,
} from "../bare-envelope-error.js";

const FULL_ENVELOPE = {
  apiVersion: "ois.io/v1",
  kind: "Idea",
  id: "idea-1",
  name: "idea-1",
  metadata: { id: "idea-1", createdAt: "2026-01-01T00:00:00Z" },
  spec: { title: "x", missionId: "m-1" },
  status: { phase: "proposed" },
};

const DECODED_FLAT = {
  id: "idea-1",
  name: "idea-1",
  title: "x",
  missionId: "m-1",
  status: "proposed", // flat string, not {phase}
  createdAt: "2026-01-01T00:00:00Z",
};

describe("isFullEnvelopeShape — the narrow co-present signature", () => {
  it("matches a fully-intact undecoded envelope (apiVersion + spec-obj + status.phase)", () => {
    expect(isFullEnvelopeShape(FULL_ENVELOPE)).toBe(true);
  });

  it("does NOT match a correctly-decoded flat object", () => {
    expect(isFullEnvelopeShape(DECODED_FLAT)).toBe(false);
  });

  it("does NOT match a flat object with a string `status` (the decoded phase)", () => {
    expect(isFullEnvelopeShape({ apiVersion: "v1", spec: {}, status: "proposed" })).toBe(false);
  });

  it("does NOT match a flat object that merely has a `kind` field", () => {
    // The classic false-positive guard: a coincidental flat `kind` must not trip it.
    expect(isFullEnvelopeShape({ kind: "Idea", id: "x", status: "open" })).toBe(false);
  });

  it("does NOT match a partial envelope (missing spec)", () => {
    expect(isFullEnvelopeShape({ apiVersion: "v1", status: { phase: "p" } })).toBe(false);
  });

  it("does NOT match a partial envelope (missing apiVersion)", () => {
    expect(isFullEnvelopeShape({ spec: {}, status: { phase: "p" } })).toBe(false);
  });

  it("does NOT match a partial envelope (status with no phase)", () => {
    expect(isFullEnvelopeShape({ apiVersion: "v1", spec: {}, status: { other: 1 } })).toBe(false);
  });

  it("does NOT match an empty-string apiVersion", () => {
    expect(isFullEnvelopeShape({ apiVersion: "", spec: {}, status: { phase: "p" } })).toBe(false);
  });

  it("does NOT match null / primitives / arrays", () => {
    expect(isFullEnvelopeShape(null)).toBe(false);
    expect(isFullEnvelopeShape(undefined)).toBe(false);
    expect(isFullEnvelopeShape("x")).toBe(false);
    expect(isFullEnvelopeShape(42)).toBe(false);
    expect(isFullEnvelopeShape([FULL_ENVELOPE])).toBe(false); // bare array is not an entity
  });
});

describe("assertDecodedFlat — production-armed-only gate", () => {
  afterEach(() => disarmBareEnvelopeDetector());

  it("is INERT when unarmed: returns even a bare envelope unchanged (no throw)", () => {
    expect(isBareEnvelopeDetectorArmed("Idea")).toBe(false);
    expect(assertDecodedFlat(FULL_ENVELOPE, "Idea")).toBe(FULL_ENVELOPE);
  });

  it("throws BareEnvelopeError when armed for a partitioned kind + result is bare", () => {
    armBareEnvelopeDetector((kind) => kind === "Idea");
    expect(isBareEnvelopeDetectorArmed("Idea")).toBe(true);
    expect(() => assertDecodedFlat(FULL_ENVELOPE, "Idea")).toThrow(BareEnvelopeError);
    try {
      assertDecodedFlat(FULL_ENVELOPE, "Idea");
    } catch (err) {
      expect(err).toBeInstanceOf(BareEnvelopeError);
      expect((err as BareEnvelopeError).kind).toBe("Idea");
      expect((err as BareEnvelopeError).entityId).toBe("idea-1");
    }
  });

  it("is INERT for an armed-but-NON-partitioned kind (ad-hoc/test kind)", () => {
    armBareEnvelopeDetector((kind) => kind === "Idea");
    expect(assertDecodedFlat(FULL_ENVELOPE, "AdHocKind")).toBe(FULL_ENVELOPE);
  });

  it("passes a correctly-decoded flat object through unchanged when armed", () => {
    armBareEnvelopeDetector(() => true);
    expect(assertDecodedFlat(DECODED_FLAT, "Idea")).toBe(DECODED_FLAT);
  });

  it("asserts per-element on an array; throws on the FIRST bare element", () => {
    armBareEnvelopeDetector(() => true);
    const list = [DECODED_FLAT, { ...FULL_ENVELOPE, id: "idea-2" }];
    expect(() => assertDecodedFlat(list, "Idea")).toThrow(BareEnvelopeError);
    try {
      assertDecodedFlat(list, "Idea");
    } catch (err) {
      expect((err as BareEnvelopeError).entityId).toBe("idea-2");
    }
  });

  it("passes an all-flat array through unchanged when armed", () => {
    armBareEnvelopeDetector(() => true);
    const list = [DECODED_FLAT, { ...DECODED_FLAT, id: "idea-3" }];
    expect(assertDecodedFlat(list, "Idea")).toBe(list);
  });
});
