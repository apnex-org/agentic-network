/**
 * mission-88 W3 cluster-3 — Counter migration module unit tests.
 *
 * Per cluster-3 Design v0.3 §2.4 (Option (a) embedded-map-in-status K8s ConfigMap
 * precedent). Asserts:
 *   - Single-row meta-entity (id="counter" fixed)
 *   - STRUCTURAL TRANSFORMATION: top-level *Counter keys → status.counters embedded map
 *   - spec: {} (uniformity; Counter has no declared-intent)
 *   - status.phase: "active" constant (no real FSM; matches Tele "active" precedent)
 *   - name OMITTED (singleton-meta-entity; id="counter" IS the handle)
 *   - Idempotency reference-equality
 */

import { describe, it, expect } from "vitest";
import { createCounterMigrationModule } from "../../kinds/Counter.js";
import { isEnvelopeShape, DEFAULT_API_VERSION, type EnvelopeShape } from "../../shared/envelope.js";
import type { SchemaDef } from "../../../../types.js";

const counterSchema: SchemaDef = { kind: "Counter", version: 2, fields: [], indexes: [], watchable: false };

function legacyCounter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "counter",
    taskCounter: 500,
    ideaCounter: 315,
    bugCounter: 118,
    missionCounter: 88,
    threadCounter: 645,
    turnCounter: 12,
    teleCounter: 5,
    proposalCounter: 200,
    ...overrides,
  };
}

describe("Counter migration module", () => {
  const module = createCounterMigrationModule(counterSchema);

  it("declares kind=Counter", () => {
    expect(module.kind).toBe("Counter");
  });

  it("encodes legacy Counter to envelope shape", () => {
    const env = module.migrateOne(legacyCounter()) as EnvelopeShape;
    expect(isEnvelopeShape(env)).toBe(true);
    expect(env.kind).toBe("Counter");
    expect(env.id).toBe("counter");
    expect(env.apiVersion).toBe(DEFAULT_API_VERSION);
  });

  it("STRUCTURAL TRANSFORMATION: top-level *Counter keys → status.counters map", () => {
    const env = module.migrateOne(legacyCounter()) as EnvelopeShape;
    expect(env.status.counters).toEqual({
      taskCounter: 500,
      ideaCounter: 315,
      bugCounter: 118,
      missionCounter: 88,
      threadCounter: 645,
      turnCounter: 12,
      teleCounter: 5,
      proposalCounter: 200,
    });
  });

  it("status.phase='active' constant (no real FSM; uniformity convention)", () => {
    const env = module.migrateOne(legacyCounter()) as EnvelopeShape;
    expect(env.status.phase).toBe("active");
  });

  it("spec is empty (uniformity; Counter has no declared-intent fields)", () => {
    const env = module.migrateOne(legacyCounter()) as EnvelopeShape;
    expect(env.spec).toEqual({});
  });

  it("metadata is empty (no createdAt/createdBy on legacy Counter; singleton)", () => {
    const env = module.migrateOne(legacyCounter()) as EnvelopeShape;
    expect(env.metadata).toEqual({});
  });

  it("name OMITTED — defaults to id='counter' (singleton-meta-entity handle)", () => {
    const env = module.migrateOne(legacyCounter()) as EnvelopeShape;
    expect(env.name).toBe("counter");
  });

  it("preserves all per-domain counter values (no loss in structural transform)", () => {
    const seed = {
      id: "counter",
      taskCounter: 123,
      customCounter: 7,  // open-ended domain
      anotherCounter: 42,
    };
    const env = module.migrateOne(seed) as EnvelopeShape;
    const counters = env.status.counters as Record<string, number>;
    expect(counters.taskCounter).toBe(123);
    expect(counters.customCounter).toBe(7);
    expect(counters.anotherCounter).toBe(42);
  });

  it("idempotent: re-encoding envelope returns the SAME REFERENCE", () => {
    const env1 = module.migrateOne(legacyCounter()) as EnvelopeShape;
    const env2 = module.migrateOne(env1);
    expect(env2).toBe(env1);
  });
});
