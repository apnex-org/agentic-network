/**
 * hcap-converge.test.ts — HCAP-on-PI convergence semantics (seam-arch §4/§5, KF1/KF2/KF5).
 *
 * Proves the whole neutral stack (U1 SpecStore → U2 DiffEngine → U3
 * ConvergenceActuator → U4 SpecReconcileLoop + the facade) against a FAKE
 * ToolActuatorPort — NO pi runtime, NO Hub (A3 Local Reasoning). The fake is the
 * pi ground-truth in miniature: register accumulates a managed ledger, setActive is
 * an authoritative REPLACE, snapshot reads both back. There is deliberately NO
 * remove verb on the port — REMOVE is proven to happen purely by set-subtraction.
 */
import { describe, it, expect } from "vitest";
import { SpecStore } from "../src/hcap/tools/spec-store.js";
import { DiffEngine } from "../src/hcap/tools/diff-engine.js";
import { ConvergenceActuator } from "../src/hcap/tools/convergence-actuator.js";
import { SpecReconcileLoop } from "../src/hcap/tools/reconcile-loop.js";
import { PiToolControlPlane } from "../src/hcap/tools/tool-control-plane.js";
import type {
  RunningSnapshot,
  ToolActuatorPort,
  ToolDefinitionNeutral,
  ToolSpec,
} from "../src/hcap/tools/contracts.js";

/** The pi actuation ground-truth in miniature — the ONLY thing the stack touches. */
class FakeActuatorPort implements ToolActuatorPort {
  /** every register call in order (repeats visible → KF2 assertions). */
  readonly registerLog: string[] = [];
  private active: Set<string>;
  private readonly managed = new Set<string>();
  private readonly builtins: string[];

  constructor(initialActive: string[] = []) {
    // e.g. a pi built-in already active and NOT managed by this plane.
    this.active = new Set(initialActive);
    // R1: the preserve baseline is captured at construction (before any register).
    this.builtins = [...initialActive];
  }

  register(def: ToolDefinitionNeutral): void {
    this.registerLog.push(def.name);
    this.managed.add(def.name);
  }

  setActive(names: string[]): void {
    // authoritative REPLACE (never union) — mirrors pi.setActiveTools.
    this.active = new Set(names);
  }

  snapshot(): RunningSnapshot {
    return {
      activeNames: [...this.active],
      managedNames: [...this.managed],
      builtinNames: [...this.builtins],
    };
  }
}

const spec = (name: string, enabled: boolean): ToolSpec => ({
  name,
  definition: { name },
  enabled,
});

function makeStack(initialActive: string[] = []) {
  const port = new FakeActuatorPort(initialActive);
  const store = new SpecStore();
  const loop = new SpecReconcileLoop({
    store,
    diff: new DiffEngine(),
    actuator: new ConvergenceActuator(port),
    port,
  });
  const plane = new PiToolControlPlane({ store, loop, port });
  return { port, store, loop, plane };
}

const sortedActive = (port: FakeActuatorPort): string[] =>
  [...port.snapshot().activeNames].sort();

describe("HCAP converge — level 2 activation (built-in-preserving REPLACE)", () => {
  it("converges an enabled declared spec onto the active-set, PRESERVING built-ins", () => {
    const { port, plane, loop } = makeStack(["pi_builtin"]);
    plane.applyConfig([spec("a", true), spec("b", true)]);

    const out = loop.sync("test");

    expect(out.converged).toBe(true);
    expect(out.consecutiveFailures).toBe(0);
    // preserved built-in ∪ the enabled subset — never a union with a prior Hub seed.
    expect(sortedActive(port)).toEqual(["a", "b", "pi_builtin"]);
    expect(port.registerLog).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("KF1 — an EMPTY declared spec converges to built-ins-only, NO escalation", () => {
    const { port, loop } = makeStack(["pi_builtin"]);

    const out = loop.sync("empty");

    expect(out.converged).toBe(true);
    expect(out.consecutiveFailures).toBe(0);
    expect(out.klass).toBeUndefined();
    expect(sortedActive(port)).toEqual(["pi_builtin"]);
  });

  it("enabled:false → REGISTERED (level 1) but NOT active (level 2)", () => {
    const { port, plane, loop } = makeStack(["pi_builtin"]);
    plane.applyConfig([spec("a", true), spec("c", false)]);

    loop.sync("mixed");

    expect(port.registerLog).toEqual(expect.arrayContaining(["a", "c"])); // both registered
    expect(sortedActive(port)).toEqual(["a", "pi_builtin"]); // c inactive
  });
});

describe("HCAP converge — REMOVE via set-subtraction (pi has no deregister)", () => {
  it("drops a tool from the active-set on the next converge, keeping built-ins", () => {
    const { port, plane, loop } = makeStack(["pi_builtin"]);
    plane.applyConfig([spec("a", true), spec("b", true)]);
    loop.sync("seed");
    expect(sortedActive(port)).toEqual(["a", "b", "pi_builtin"]);

    // remove b from the DECLARED spec (authoritative replace) + reconcile.
    plane.applyConfig([spec("a", true)]);
    const out = loop.sync("remove");

    expect(out.converged).toBe(true);
    expect(sortedActive(port)).toEqual(["a", "pi_builtin"]); // b subtracted, built-in kept
  });

  it("KF5 — a removed tool is absent-but-still-managed in listRunningTools", () => {
    const { plane, loop } = makeStack(["pi_builtin"]);
    plane.applyConfig([spec("a", true), spec("b", true)]);
    loop.sync("seed");
    plane.applyConfig([spec("a", true)]); // b removed
    loop.sync("remove");

    const rows = plane.listRunningTools();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

    expect(byName["a"]).toMatchObject({
      declared: true,
      enabled: true,
      active: true,
      managed: true,
    });
    // b: gone from the spec, dropped from active, but the U5 ledger still remembers it.
    expect(byName["b"]).toMatchObject({
      declared: false,
      enabled: false,
      active: false,
      managed: true,
    });
    // the built-in: active + un-managed (never declared by this plane).
    expect(byName["pi_builtin"]).toMatchObject({
      declared: false,
      active: true,
      managed: false,
    });
  });
});

describe("HCAP converge — KF2 definition-drift (re-register ALL each pass)", () => {
  it("re-registers every declared definition on every converge pass", () => {
    const { port, plane, loop } = makeStack();
    plane.applyConfig([spec("a", true)]);
    loop.sync("pass-1");
    // definition drift on the SAME name — must be re-registered to refresh it.
    plane.applyConfig([{ name: "a", definition: { name: "a", description: "v2" }, enabled: true }]);
    loop.sync("pass-2");

    const aRegistrations = port.registerLog.filter((n) => n === "a").length;
    expect(aRegistrations).toBe(2); // once per pass — a name-only diff would skip pass-2
  });
});
