/**
 * hcap-falsifier.test.ts — HCAP-on-PI falsifier + conformance suite (seam-arch §6, T1-T10).
 *
 * The A3 Air-Gap proof + the "PI needs no MCP, no Hub" existence proof: the whole
 * U1-U4 stack + facade driven purely through `applyConfig`/`sync` against a
 * `FakeToolActuatorPort` (in-memory registered ledger + active Set + seeded
 * built-ins) — NO McpAgentClient, NO Hub, NO ToolSurfaceReconciler. Each test is
 * pure/in-memory.
 *
 * The fake is the pi actuation ground-truth in miniature, with adversarial knobs:
 *   - injectDrift()   — mutate the active set OUT-OF-BAND (not via the plane) for T4.
 *   - deferActivation — model pi's next-turn setActive landing (T8).
 *   - snapshotThrows  — model an observation fault (T7 fail-closed).
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

const BUILTINS = ["bash", "read", "edit"];

class FakeToolActuatorPort implements ToolActuatorPort {
  readonly registerLog: string[] = [];
  readonly setActiveLog: string[][] = [];
  private active: Set<string>;
  private readonly managed = new Set<string>();
  private readonly baseline: string[];
  private staged: string[] | null = null;
  snapshotThrows = false;
  deferActivation = false;

  constructor(builtins: string[] = BUILTINS) {
    this.active = new Set(builtins);
    // R1: the preserve baseline captured at construction (before any register).
    this.baseline = [...builtins];
  }

  register(def: ToolDefinitionNeutral): void {
    this.registerLog.push(def.name);
    this.managed.add(def.name);
  }

  setActive(names: string[]): void {
    this.setActiveLog.push([...names]);
    if (this.deferActivation) this.staged = [...names];
    else this.active = new Set(names);
  }

  snapshot(): RunningSnapshot {
    if (this.snapshotThrows) throw new Error("snapshot boom");
    return {
      activeNames: [...this.active],
      managedNames: [...this.managed],
      builtinNames: [...this.baseline],
    };
  }

  /** simulate the next agent turn landing a previously-deferred setActive (T8). */
  commitDeferred(): void {
    if (this.staged) {
      this.active = new Set(this.staged);
      this.staged = null;
    }
  }

  /** out-of-band mutation NOT routed through the plane (drift injection, T4). */
  injectDrift(mutate: (active: Set<string>) => void): void {
    mutate(this.active);
  }
}

const spec = (name: string, enabled: boolean): ToolSpec => ({
  name,
  definition: { name },
  enabled,
});

function makeStack(port = new FakeToolActuatorPort()) {
  const logs: string[] = [];
  const store = new SpecStore();
  const loop = new SpecReconcileLoop(
    {
      store,
      diff: new DiffEngine(),
      actuator: new ConvergenceActuator(port),
      port,
    },
    { log: (m) => logs.push(m) },
  );
  const plane = new PiToolControlPlane({ store, loop, port });
  return { port, store, loop, plane, logs };
}

const activeSet = (port: FakeToolActuatorPort): Set<string> =>
  new Set(port.snapshot().activeNames);
const has = (port: FakeToolActuatorPort, name: string): boolean =>
  activeSet(port).has(name);
const builtinsPreserved = (port: FakeToolActuatorPort): boolean =>
  BUILTINS.every((b) => has(port, b));

describe("HCAP falsifier — convergence (T1/T2) driven with NO MCP, NO Hub", () => {
  it("T1 — applyConfig([a:on,b:on]); sync → active == builtins ∪ {a,b}; {a,b} ⊆ registered", () => {
    const { port, plane, loop } = makeStack();
    plane.applyConfig([spec("a", true), spec("b", true)]);

    const out = loop.sync("T1");

    expect(out.converged).toBe(true);
    expect(activeSet(port)).toEqual(new Set([...BUILTINS, "a", "b"]));
    expect(port.registerLog).toEqual(expect.arrayContaining(["a", "b"]));
    expect(builtinsPreserved(port)).toBe(true);
  });

  it("T2 — applyConfig([a:on,b:off]); sync → active == builtins ∪ {a}; b registered, b ∉ active", () => {
    const { port, plane, loop } = makeStack();
    plane.applyConfig([spec("a", true), spec("b", false)]);

    loop.sync("T2");

    expect(activeSet(port)).toEqual(new Set([...BUILTINS, "a"]));
    expect(port.registerLog).toContain("b"); // level-1 registered
    expect(has(port, "b")).toBe(false); // level-2 inactive
  });
});

describe("HCAP falsifier — REMOVE via set-subtraction (T3), no deregister", () => {
  it("T3 — from T1, applyConfig([a:on]); sync → b subtracted, b∈managedNames, status declared:false", () => {
    const { port, plane, loop } = makeStack();
    plane.applyConfig([spec("a", true), spec("b", true)]);
    loop.sync("seed");

    plane.applyConfig([spec("a", true)]); // b removed from the declared spec
    loop.sync("T3");

    expect(activeSet(port)).toEqual(new Set([...BUILTINS, "a"]));
    expect(has(port, "b")).toBe(false);
    expect(port.snapshot().managedNames).toContain("b"); // ledger remembers (no deregister)
    const bStatus = plane.listRunningTools().find((r) => r.name === "b");
    expect(bStatus).toMatchObject({ declared: false, enabled: false, active: false, managed: true });
  });
});

describe("HCAP falsifier — built-in preservation (T5) holds across every pass", () => {
  it("T5 — built-ins ⊆ active after enable, disable, and remove passes", () => {
    const { port, plane, loop } = makeStack();
    plane.applyConfig([spec("a", true), spec("b", true)]);
    loop.sync("p1");
    expect(builtinsPreserved(port)).toBe(true);
    plane.applyConfig([spec("a", true), spec("b", false)]);
    loop.sync("p2");
    expect(builtinsPreserved(port)).toBe(true);
    plane.applyConfig([spec("a", true)]);
    loop.sync("p3");
    expect(builtinsPreserved(port)).toBe(true);
  });
});

describe("HCAP falsifier — idempotence (T6)", () => {
  it("T6 — sync twice with no spec change → 2nd pass converged, active unchanged", () => {
    const { port, plane, loop } = makeStack();
    plane.applyConfig([spec("a", true), spec("b", true)]);
    loop.sync("first");
    const afterFirst = activeSet(port);

    const second = loop.sync("second");

    expect(second.converged).toBe(true);
    expect(second.consecutiveFailures).toBe(0);
    expect(activeSet(port)).toEqual(afterFirst); // no churn
  });
});

describe("HCAP falsifier — fail-closed (T7)", () => {
  it("T7 — snapshot() throws → NO setActive, surface preserved, converged:false, LOUD escalation after bound", () => {
    const { port, plane, loop, logs } = makeStack();
    plane.applyConfig([spec("a", true)]);
    port.snapshotThrows = true;

    const o1 = loop.sync("f1");
    const o2 = loop.sync("f2");
    const o3 = loop.sync("f3");

    expect(o1.converged).toBe(false);
    expect(o1.klass).toBe("snapshot-failed");
    expect(port.setActiveLog).toHaveLength(0); // never actuated on a bad read
    expect(o3.consecutiveFailures).toBe(3);
    // F5: a persistent divergence is never a silent no-op.
    expect(logs.some((l) => l.includes("ESCALATION"))).toBe(true);
  });
});

describe("HCAP falsifier — next-turn tolerance (T8)", () => {
  it("T8 — deferred setActive: 1st sync records intent (not-yet-converged), 2nd observes+confirms", () => {
    const { port, plane, loop } = makeStack();
    port.deferActivation = true;
    plane.applyConfig([spec("a", true)]);

    const first = loop.sync("turn-1");
    expect(first.converged).toBe(false);
    expect(first.klass).toBe("still-diverged"); // intent recorded, effect pending

    port.commitDeferred(); // the next agent turn lands the setActive
    const second = loop.sync("turn-2");
    expect(second.converged).toBe(true); // observed + confirmed
    expect(activeSet(port)).toEqual(new Set([...BUILTINS, "a"]));
  });
});

describe("HCAP falsifier — KF1 empty-spec→built-ins-only (T9), KF2 def-drift (T10)", () => {
  it("T9 — empty declared spec → setActive(builtins), converged, NO escalation", () => {
    const { port, loop, logs } = makeStack();

    const out = loop.sync("T9"); // store never populated

    expect(out.converged).toBe(true);
    expect(out.klass).toBeUndefined();
    expect(activeSet(port)).toEqual(new Set(BUILTINS)); // built-ins-only, not empty
    expect(logs.some((l) => l.includes("ESCALATION"))).toBe(false);
  });

  it("T9b — dropping the LAST declared tool converges to built-ins-only (still no poison)", () => {
    const { port, plane, loop } = makeStack();
    plane.applyConfig([spec("a", true)]);
    loop.sync("has-one");
    plane.applyConfig([]); // drop the last tool — a VALID intentional-empty state
    const out = loop.sync("now-empty");

    expect(out.converged).toBe(true);
    expect(activeSet(port)).toEqual(new Set(BUILTINS));
  });

  it("T10 — mutate a declared tool's definition (same name) → sync re-registers, served def refreshes", () => {
    const { port, plane, loop } = makeStack();
    plane.applyConfig([spec("a", true)]);
    loop.sync("v1");
    plane.applyConfig([{ name: "a", definition: { name: "a", description: "v2" }, enabled: true }]);
    loop.sync("v2");

    // KF2: re-register EVERY declared def each pass — a name-only diff would skip v2.
    expect(port.registerLog.filter((n) => n === "a")).toHaveLength(2);
  });
});

describe("HCAP falsifier — A2 phantom auto-revert (T4, ruling R1)", () => {
  it("T4 — out-of-band ROGUE reverted on next sync; dropped b restored; built-ins preserved", () => {
    const { port, plane, loop } = makeStack();
    plane.applyConfig([spec("a", true), spec("b", true)]);
    loop.sync("seed");
    expect(activeSet(port)).toEqual(new Set([...BUILTINS, "a", "b"]));

    // out-of-band drift NOT via the plane: drop a declared tool AND add an
    // unmanaged ROGUE (Snowflake-Entropy injected).
    port.injectDrift((active) => {
      active.delete("b");
      active.add("ROGUE");
    });

    const out = loop.sync("T4"); // NO spec change — the level loop alone must heal

    expect(out.converged).toBe(true);
    // converges to baseline ∪ enabled: ROGUE (∉baseline, ∉enabled) reverted, b
    // (declared+enabled) restored, built-ins preserved. Snowflake-Entropy killed.
    expect(activeSet(port)).toEqual(new Set([...BUILTINS, "a", "b"]));
    expect(has(port, "ROGUE")).toBe(false);
  });
});
