/**
 * mission-90 W8 (idea-320 / idea-327) — shape-helpers DECODE-LAYER unit tests.
 *
 * W8 retired the W3-era dual-layer readers (tagsFromEntity / fieldFromEntity /
 * arrayFieldFromEntity) — above the membrane there is now ONE flat domain shape,
 * so policy + consumers read fields directly and the repos decode at their read
 * boundary. What remains in shape-helpers is the membrane MECHANISM:
 *  - phaseFromEntity — the status-extractor the decoders call.
 *  - decodeEnvelopeToFlat — the generic renameMap+partition reverse.
 * This file locks both contracts directly (the deleted helpers' coverage now
 * lives at the repo decode boundary — idea/bug-repository-substrate.test for the
 * metadata.labels→tags inline derivation, layerb-accessor-sweep-w3 for the
 * policy accessors' flat reads against real envelope rows).
 */

import { describe, it, expect } from "vitest";
import { phaseFromEntity, decodeEnvelopeToFlat } from "../shape-helpers.js";

describe("phaseFromEntity — envelope storage shape", () => {
  it("reads status.phase from the {phase,...} bucket object", () => {
    expect(phaseFromEntity({ id: "x", status: { phase: "active" } })).toBe("active");
    expect(phaseFromEntity({ id: "x", status: { phase: "completed", livenessState: "online" } })).toBe("completed");
  });
});

describe("phaseFromEntity — decoded-flat domain shape", () => {
  it("reads a top-level status string directly", () => {
    expect(phaseFromEntity({ id: "x", status: "open" })).toBe("open");
    expect(phaseFromEntity({ id: "x", status: "resolved" })).toBe("resolved");
  });
});

describe("phaseFromEntity — graceful-degrade (never throws)", () => {
  it("returns null for unreadable shapes", () => {
    expect(phaseFromEntity(null)).toBeNull();
    expect(phaseFromEntity(undefined)).toBeNull();
    expect(phaseFromEntity({})).toBeNull();
    expect(phaseFromEntity({ id: "x" })).toBeNull();
    expect(phaseFromEntity({ id: "x", status: 42 })).toBeNull(); // non-string non-object
    expect(phaseFromEntity({ id: "x", status: { foo: "bar" } })).toBeNull(); // object without phase
    expect(phaseFromEntity("not-an-entity")).toBeNull();
  });
});

describe("decodeEnvelopeToFlat — partition flatten", () => {
  it("flattens metadata/spec/status leaves to top-level, status.phase → status string", () => {
    const envelope = {
      id: "idea-1",
      name: "idea-1",
      apiVersion: "core.ois/v1",
      kind: "Idea",
      metadata: { createdAt: "2026-06-01", createdBy: { role: "engineer", agentId: "a-1" }, missionId: "m-9" },
      spec: { text: "do the thing" },
      status: { phase: "open", linkedTaskIds: ["task-1"] },
    };
    const flat = decodeEnvelopeToFlat(envelope) as Record<string, unknown>;

    // leaves lifted to top-level
    expect(flat.createdAt).toBe("2026-06-01");
    expect(flat.createdBy).toEqual({ role: "engineer", agentId: "a-1" });
    expect(flat.missionId).toBe("m-9");
    expect(flat.text).toBe("do the thing");
    expect(flat.linkedTaskIds).toEqual(["task-1"]);
    // status.phase → top-level status string
    expect(flat.status).toBe("open");
    // id preserved
    expect(flat.id).toBe("idea-1");
  });

  it("strips the envelope artifacts (buckets + apiVersion/kind/phase/name)", () => {
    const flat = decodeEnvelopeToFlat({
      id: "x",
      name: "x",
      apiVersion: "core.ois/v1",
      kind: "Bug",
      metadata: {},
      spec: {},
      status: { phase: "open" },
    }) as Record<string, unknown>;

    for (const artifact of ["metadata", "spec", "phase", "apiVersion", "kind", "name"]) {
      expect(flat, `${artifact} stripped`).not.toHaveProperty(artifact);
    }
    // status is the decoded phase STRING, not the bucket object
    expect(flat.status).toBe("open");
  });

  it("surfaces the cascade sourceThreadSummary from metadata.annotations", () => {
    const flat = decodeEnvelopeToFlat({
      id: "task-1",
      apiVersion: "core.ois/v1",
      kind: "Task",
      metadata: { annotations: { "ois.io/sourceThreadSummary": "converged on X" } },
      spec: { directive: "go" },
      status: { phase: "issued" },
    }) as Record<string, unknown>;

    expect(flat.sourceThreadSummary).toBe("converged on X");
  });

  it("preserves leaf objects/arrays by reference-spread (no deep mutation of input)", () => {
    const nested = { foo: ["a", "b"] };
    const flat = decodeEnvelopeToFlat({
      id: "x",
      metadata: {},
      spec: { nested },
      status: { phase: "active" },
    }) as Record<string, unknown>;
    expect(flat.nested).toBe(nested); // leaf-preserving spread
  });
});

describe("decodeEnvelopeToFlat — graceful-degrade (never throws)", () => {
  it("passes a non-object through unchanged", () => {
    expect(decodeEnvelopeToFlat(null)).toBeNull();
    expect(decodeEnvelopeToFlat(undefined)).toBeUndefined();
    expect(decodeEnvelopeToFlat("str" as unknown)).toBe("str");
    expect(decodeEnvelopeToFlat(42 as unknown)).toBe(42);
  });

  it("a bare (already-flat) row with no buckets passes through (status preserved if string)", () => {
    const flat = decodeEnvelopeToFlat({ id: "x", status: "open", title: "t" }) as Record<string, unknown>;
    expect(flat.id).toBe("x");
    expect(flat.status).toBe("open");
    expect(flat.title).toBe("t");
  });
});
