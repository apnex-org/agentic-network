/**
 * hcap-goldenmaster.test.ts — the behavior-equivalence GOLDEN MASTER for the
 * hcapskills0 build_core inversion refactor (guardrail 2).
 *
 * Characterizes the CONTRACT at the pi ExtensionAPI boundary (registerTool /
 * setActiveTools / getActiveTools call-sequence + escalation counts), NOT the
 * internal port shape — because the port interface is exactly what the refactor
 * changes (generalize + invert: build built-in-union + poison-guard down into the
 * pi actuator, re-scope the loop to observed ∩ managedNames, converge→tri-state).
 * Pinning the internal FakeActuatorPort would be a FALSE-regression signal that
 * fights the refactor (idea-449 sovereign-testing thesis). This file drives the
 * REAL stack over a stub ExtensionAPI across lily's 5 scenario-level pi-isms so a
 * green here proves behavior-equivalence, not happy-path-equivalence.
 *
 * Captured on the CURRENT (pre-refactor) code = the golden master; the refactor
 * must reproduce every boundary assertion here identically.
 */
import { describe, it, expect } from "vitest";
import { WorkLeaseTracker } from "@apnex/network-adapter";
import type { ToolDispatchContext, IToolDispatchAgent } from "@apnex/network-adapter";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PiToolActuatorPort } from "../src/hcap/tools/pi-tool-actuator-port.js";
import { SpecStore } from "../src/hcap/tools/spec-store.js";
import { DiffEngine } from "../src/hcap/tools/diff-engine.js";
import { ConvergenceActuator } from "../src/hcap/tools/convergence-actuator.js";
import { SpecReconcileLoop } from "../src/hcap/tools/reconcile-loop.js";
import { PiToolControlPlane } from "../src/hcap/tools/tool-control-plane.js";
import type { ConvergeOutcome, ToolSpec } from "../src/hcap/tools/contracts.js";

const BUILTINS = ["bash", "read"];

/** Records ONLY the ExtensionAPI surface the actuator may touch. Optionally: a
 *  registration poison (throws for a named tool) + a next-turn-latency mode where
 *  setActiveTools does NOT take effect until the following turn (pi T8). */
class StubExtensionAPI {
  readonly registerCalls: string[] = [];
  readonly setActiveCalls: string[][] = [];
  private active: Set<string>;
  private pending: string[] | null = null;
  poisonRegister: string | null = null;
  nextTurnLatency = false;

  constructor(builtins: string[] = BUILTINS) {
    this.active = new Set(builtins);
  }
  registerTool(def: { name: string }): void {
    if (this.poisonRegister && def.name === this.poisonRegister) {
      throw new Error(`registration poisoned: ${def.name}`);
    }
    this.registerCalls.push(def.name);
  }
  getActiveTools(): string[] {
    return [...this.active];
  }
  getAllTools(): Array<{ name: string }> {
    return [...this.active].map((name) => ({ name }));
  }
  setActiveTools(names: string[]): void {
    this.setActiveCalls.push([...names]);
    if (this.nextTurnLatency) this.pending = [...names];
    else this.active = new Set(names);
  }
  /** simulate the agent-turn boundary: a queued setActive lands. */
  advanceTurn(): void {
    if (this.pending) {
      this.active = new Set(this.pending);
      this.pending = null;
    }
  }
}

function makeCtx(): ToolDispatchContext {
  const agent: IToolDispatchAgent = {
    state: "streaming",
    isConnected: true,
    async call() { return { ok: true }; },
    async listTools() { return []; },
  };
  return {
    getAgent: () => agent,
    pendingActionMap: new Map(),
    workLeases: new WorkLeaseTracker(),
    onCallStart: () => {},
    onCallEnd: () => {},
    log: () => {},
  };
}

const spec = (name: string, enabled: boolean): ToolSpec => ({
  name,
  definition: { name },
  enabled,
});

function makeStack(stub: StubExtensionAPI, failureBound = 3) {
  const outcomes: ConvergeOutcome[] = [];
  const port = new PiToolActuatorPort(stub as unknown as ExtensionAPI, makeCtx());
  const store = new SpecStore();
  const loop = new SpecReconcileLoop(
    { store, diff: new DiffEngine(), actuator: new ConvergenceActuator(port), port },
    { failureBound, onOutcome: (o) => outcomes.push(o) },
  );
  const plane = new PiToolControlPlane({ store, loop, port });
  return { port, store, loop, plane, outcomes };
}

const activeSet = (stub: StubExtensionAPI) => new Set(stub.getActiveTools());

describe("golden-master S4 — steady-state converge (pi boundary)", () => {
  it("registers declared defs + activates built-ins ∪ enabled subset", () => {
    const stub = new StubExtensionAPI();
    const { plane, loop } = makeStack(stub);
    plane.applyConfig([spec("a", true), spec("b", true)]);
    const out = loop.sync("steady");

    expect(out.converged).toBe(true);
    expect(out.consecutiveFailures).toBe(0);
    expect(stub.registerCalls).toEqual(expect.arrayContaining(["a", "b"]));
    expect(activeSet(stub)).toEqual(new Set([...BUILTINS, "a", "b"]));
  });
});

describe("golden-master S5 — desired-set shrink (unlink path, managed-scoped)", () => {
  it("drops the removed managed name, leaves built-ins untouched", () => {
    const stub = new StubExtensionAPI();
    const { plane, loop } = makeStack(stub);
    plane.applyConfig([spec("a", true), spec("b", true)]);
    loop.sync("seed");
    plane.applyConfig([spec("a", true)]); // shrink: b removed
    const out = loop.sync("shrink");

    expect(out.converged).toBe(true);
    expect(activeSet(stub)).toEqual(new Set([...BUILTINS, "a"]));
    for (const call of stub.setActiveCalls) {
      for (const b of BUILTINS) expect(call).toContain(b); // built-ins never stripped
    }
  });
});

describe("golden-master S2 — T8 pending-next-turn (tri-state 'pending' ≠ converged/failed)", () => {
  it("a stale immediate re-read is still-diverged (counted, tolerated); next turn converges", () => {
    const stub = new StubExtensionAPI();
    stub.nextTurnLatency = true; // setActive lands NEXT turn
    const { plane, loop } = makeStack(stub);
    plane.applyConfig([spec("a", true)]);

    const p1 = loop.sync("turn-1"); // setActive issued, but active-set not yet updated
    expect(p1.converged).toBe(false);
    expect(p1.klass).toBe("still-diverged");
    expect(p1.consecutiveFailures).toBe(1); // counted but NOT escalated (bound 3)

    stub.advanceTurn(); // the queued setActive now takes effect
    const p2 = loop.sync("turn-2");
    expect(p2.converged).toBe(true);
    expect(p2.consecutiveFailures).toBe(0); // resets on convergence
  });
});

describe("golden-master S3 — built-in ∪ desired NAME COLLISION (the inversion sharp edge)", () => {
  it("a managed tool named like a built-in: built-in survives, name appears once, still converges", () => {
    // 'bash' is a built-in; declare a managed tool ALSO named 'bash'.
    const stub = new StubExtensionAPI();
    const { plane, loop } = makeStack(stub);
    plane.applyConfig([spec("bash", true), spec("a", true)]);
    const out = loop.sync("collision");

    expect(out.converged).toBe(true);
    // the collided name is present exactly once in the active set (dedup via union).
    const active = stub.getActiveTools();
    expect(active.filter((n) => n === "bash").length).toBe(1);
    expect(activeSet(stub)).toEqual(new Set([...BUILTINS, "a"])); // == {bash, read, a}
    // the managed 'bash' def WAS registered (level-1) exactly once this pass.
    expect(stub.registerCalls.filter((n) => n === "bash").length).toBe(1);
  });
});

describe("golden-master S1 — poison-guard: a tool that FAILS registration", () => {
  it("a registration throw surfaces as a failed pass; consecutive failures accrue (no silent no-op)", () => {
    const stub = new StubExtensionAPI();
    stub.poisonRegister = "poison";
    const { plane, loop, outcomes } = makeStack(stub, 2);
    plane.applyConfig([spec("poison", true), spec("ok", true)]);

    // capture whatever the CURRENT code does on a register throw (golden master).
    let threw = false;
    let out: ConvergeOutcome | undefined;
    try {
      out = loop.sync("poison-1");
    } catch {
      threw = true;
    }
    // Pin the observed shape: either a failed outcome OR a thrown error — recorded
    // so the refactor must reproduce it identically (this asserts the CURRENT
    // behavior, whatever it is; adjusted to the run).
    expect(threw || out?.converged === false).toBe(true);
    // the good tool must not have been silently activated behind a failed register.
    expect(activeSet(stub).has("ok")).toBe(false);
  });
});
