/**
 * arc.test.ts — WholeArcSim B1 (task-node core): the whole-arc driver plays a graph of
 * WorkItems to all-done through the REAL engine, honors readiness + completion gates,
 * reports a dependency cycle as deadlock (never hangs), and fails LOUDLY on a
 * not-yet-supported verifier-gate node rather than silently skipping it.
 */
import { describe, it, expect } from "vitest";
import { SimHarness } from "../src/harness.js";
import { VirtualClock } from "hub/dist/entities/clock.js";
import { WholeArcSim, topoOrder, type ArcScenario } from "../src/arc.js";

const sim = (): WholeArcSim => new WholeArcSim(new SimHarness({ clock: new VirtualClock(1_700_000_000_000) }));

describe("topoOrder", () => {
  it("orders a DAG deps-before-dependents", () => {
    const order = topoOrder([{ id: "c", dependsOn: ["b"] }, { id: "a" }, { id: "b", dependsOn: ["a"] }]);
    expect(order?.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
  it("returns null on a dependency cycle", () => {
    expect(topoOrder([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }])).toBeNull();
  });
});

describe("WholeArcSim — task-node arcs (B1)", () => {
  it("drives a linear dependsOn chain to all-done", async () => {
    const scenario: ArcScenario = {
      nodes: [{ id: "design" }, { id: "build", dependsOn: ["design"] }, { id: "ship", dependsOn: ["build"] }],
    };
    const r = await sim().run(scenario);
    expect(r.deadlock).toBe(false);
    expect(r.stuck).toEqual([]);
    expect(new Set(r.done)).toEqual(new Set(["design", "build", "ship"]));
  });

  it("drives a diamond (fan-out then fan-in) to all-done", async () => {
    const scenario: ArcScenario = {
      nodes: [
        { id: "root" },
        { id: "left", dependsOn: ["root"] },
        { id: "right", dependsOn: ["root"] },
        { id: "join", dependsOn: ["left", "right"] },
      ],
    };
    const r = await sim().run(scenario);
    expect(r.deadlock).toBe(false);
    expect(new Set(r.done)).toEqual(new Set(["root", "left", "right", "join"]));
  });

  it("honors a completion gate — the parent completes only after its completionDependsOn child", async () => {
    const scenario: ArcScenario = {
      nodes: [{ id: "closer", completionDependsOn: ["gate"] }, { id: "gate" }],
    };
    const r = await sim().run(scenario);
    expect(r.deadlock).toBe(false);
    expect(new Set(r.done)).toEqual(new Set(["closer", "gate"]));
  });

  it("reports a dependency cycle as deadlock (never hangs)", async () => {
    const scenario: ArcScenario = {
      nodes: [{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }],
    };
    const r = await sim().run(scenario);
    expect(r.deadlock).toBe(true);
    expect(new Set(r.stuck)).toEqual(new Set(["a", "b"]));
  });

  it("fails LOUDLY on a not-yet-supported verifier-gate node (no silent skip)", async () => {
    await expect(sim().run({ nodes: [{ id: "vg", gate: true }] })).rejects.toThrow(/verifier-gate/);
  });
});
