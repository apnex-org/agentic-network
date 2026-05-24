/**
 * mission-88 W0 — envelope library unit tests.
 *
 * Per thread-639 Q1 disposition. Verifies encodeEnvelope / parseEnvelope /
 * isEnvelopeShape under:
 *   - default partition heuristic
 *   - explicit per-kind partition rules
 *   - per-kind rename mapping (cluster-4 §1.7 canonical: Message.kind →
 *     metadata.messageKind)
 *   - idempotency (re-encoding envelope-shape returns it unchanged)
 *   - validation guards (id required, object input required)
 */

import { describe, it, expect } from "vitest";
import {
  encodeEnvelope,
  parseEnvelope,
  isEnvelopeShape,
  DEFAULT_API_VERSION,
  type EnvelopeShape,
} from "../shared/envelope.js";
import type { MigrationSchemaRef } from "../kinds/_contract.js";
import type { SchemaDef } from "../../../types.js";

function mkSchema(kind: string): SchemaDef {
  return { kind, version: 1, fields: [], indexes: [], watchable: true };
}

describe("isEnvelopeShape", () => {
  it("returns true for fully-shaped envelope", () => {
    const env: EnvelopeShape = {
      id: "x-1",
      name: "x-1",
      kind: "X",
      apiVersion: DEFAULT_API_VERSION,
      metadata: {},
      spec: {},
      status: {},
    };
    expect(isEnvelopeShape(env)).toBe(true);
  });

  it("returns false for legacy-flat shape", () => {
    expect(isEnvelopeShape({ id: "x-1", title: "test" })).toBe(false);
  });

  it("returns false for null / non-object", () => {
    expect(isEnvelopeShape(null)).toBe(false);
    expect(isEnvelopeShape("string")).toBe(false);
    expect(isEnvelopeShape(42)).toBe(false);
  });

  it("returns false when metadata/spec/status are non-object", () => {
    const partial = {
      id: "x-1",
      name: "x-1",
      kind: "X",
      apiVersion: "core.ois/v1",
      metadata: null,  // wrong shape
      spec: {},
      status: {},
    };
    expect(isEnvelopeShape(partial)).toBe(false);
  });
});

describe("encodeEnvelope — default partition heuristic", () => {
  const schemaRef: MigrationSchemaRef = { schema: mkSchema("Audit") };

  it("encodes legacy entity preserving id + name + kind at envelope top-level", () => {
    const legacy = { id: "audit-1", timestamp: "2026-05-24T00:00:00Z", actor: "engineer", action: "ship", details: "ok", relatedEntity: null };
    const env = encodeEnvelope(legacy, schemaRef);
    expect(env.id).toBe("audit-1");
    expect(env.name).toBe("audit-1");  // defaults to id when name absent
    expect(env.kind).toBe("Audit");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("default heuristic places known metadata keys in metadata", () => {
    const legacy = {
      id: "x-1",
      name: "x-1",
      labels: { env: "prod" },
      createdAt: "2026-01-01T00:00:00Z",
      sourceThreadId: "thread-1",
      domainField: "stays-in-spec",
    };
    const env = encodeEnvelope(legacy, { schema: mkSchema("X") });
    expect(env.metadata.labels).toEqual({ env: "prod" });
    expect(env.metadata.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(env.metadata.sourceThreadId).toBe("thread-1");
    expect(env.spec.domainField).toBe("stays-in-spec");
  });

  it("unknown legacy keys default to spec bucket", () => {
    const legacy = { id: "x-1", randomField: "value", another: 42 };
    const env = encodeEnvelope(legacy, { schema: mkSchema("X") });
    expect(env.spec.randomField).toBe("value");
    expect(env.spec.another).toBe(42);
    expect(env.metadata).toEqual({});
    expect(env.status).toEqual({});
  });
});

describe("encodeEnvelope — explicit per-kind partition rules", () => {
  it("respects partition.metadata + partition.spec + partition.status", () => {
    const schemaRef: MigrationSchemaRef = {
      schema: mkSchema("Idea"),
      partition: {
        metadata: ["createdAt", "createdBy"],
        spec: ["title", "description"],
        status: ["lifecycle", "missionId"],
      },
    };
    const legacy = {
      id: "idea-1",
      createdAt: "2026-01-01T00:00:00Z",
      createdBy: "director",
      title: "Test idea",
      description: "A description",
      lifecycle: "triaged",
      missionId: null,
    };
    const env = encodeEnvelope(legacy, schemaRef);
    expect(env.metadata.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(env.metadata.createdBy).toBe("director");
    expect(env.spec.title).toBe("Test idea");
    expect(env.spec.description).toBe("A description");
    expect(env.status.lifecycle).toBe("triaged");
    expect(env.status.missionId).toBe(null);
  });
});

describe("encodeEnvelope — rename mapping (cluster-4 §1.7 canonical)", () => {
  it("renames Message.kind → metadata.messageKind (field-name collision case)", () => {
    const schemaRef: MigrationSchemaRef = {
      schema: mkSchema("Message"),
      renameMap: { kind: "metadata.messageKind" },
    };
    const legacy = {
      id: "msg-1",
      threadId: "thread-1",
      kind: "reply",  // collides with envelope.kind
      body: "hello",
    };
    const env = encodeEnvelope(legacy, schemaRef);
    expect(env.kind).toBe("Message");  // envelope.kind preserved (from schemaRef.schema.kind)
    expect(env.metadata.messageKind).toBe("reply");  // renamed
    expect(env.spec.body).toBe("hello");  // default-spec
    expect(env.spec.threadId).toBe("thread-1");  // default-spec
  });

  it("renames into nested status field", () => {
    const schemaRef: MigrationSchemaRef = {
      schema: mkSchema("Agent"),
      renameMap: { lastSeenAt: "status.fsm.lastSeenAt" },
    };
    const legacy = { id: "agent-1", lastSeenAt: "2026-05-24T01:00:00Z" };
    const env = encodeEnvelope(legacy, schemaRef);
    const fsm = env.status.fsm as Record<string, unknown> | undefined;
    expect(fsm?.lastSeenAt).toBe("2026-05-24T01:00:00Z");
  });
});

describe("encodeEnvelope — idempotency", () => {
  it("returns envelope-shape input unchanged (re-encode is no-op)", () => {
    const env: EnvelopeShape = {
      id: "x-1",
      name: "x-1",
      kind: "X",
      apiVersion: DEFAULT_API_VERSION,
      metadata: { a: 1 },
      spec: { b: 2 },
      status: { c: 3 },
    };
    const re = encodeEnvelope(env, { schema: mkSchema("X") });
    expect(re).toBe(env);  // same reference; not re-encoded
  });
});

describe("encodeEnvelope — validation guards", () => {
  it("throws when input is not an object", () => {
    const schemaRef: MigrationSchemaRef = { schema: mkSchema("X") };
    expect(() => encodeEnvelope("string", schemaRef)).toThrow(/must be an object/);
    expect(() => encodeEnvelope(42, schemaRef)).toThrow(/must be an object/);
    expect(() => encodeEnvelope(null, schemaRef)).toThrow(/must be an object/);
  });

  it("throws when id is missing or non-string", () => {
    const schemaRef: MigrationSchemaRef = { schema: mkSchema("X") };
    expect(() => encodeEnvelope({ name: "x" }, schemaRef)).toThrow(/non-empty string/);
    expect(() => encodeEnvelope({ id: 42 }, schemaRef)).toThrow(/non-empty string/);
    expect(() => encodeEnvelope({ id: "" }, schemaRef)).toThrow(/non-empty string/);
  });
});

describe("parseEnvelope", () => {
  it("returns the three partition buckets", () => {
    const env: EnvelopeShape = {
      id: "x-1",
      name: "x-1",
      kind: "X",
      apiVersion: DEFAULT_API_VERSION,
      metadata: { a: 1 },
      spec: { b: 2 },
      status: { c: 3 },
    };
    const parsed = parseEnvelope(env, { schema: mkSchema("X") });
    expect(parsed.metadata).toEqual({ a: 1 });
    expect(parsed.spec).toEqual({ b: 2 });
    expect(parsed.status).toEqual({ c: 3 });
  });

  it("throws when input is not envelope-shape", () => {
    const legacy = { id: "x-1", title: "legacy" };
    expect(() =>
      parseEnvelope(legacy as unknown as EnvelopeShape, { schema: mkSchema("X") }),
    ).toThrow(/not envelope-shape/);
  });
});
