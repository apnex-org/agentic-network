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
import { PiToolControlPlane } from "../src/hcap/tools/tool-control-plane.js";
import { SpecStore, ReconcileLoop } from "@apnex/network-adapter";
import type { ConvergeOutcome, ResourceSpec } from "@apnex/network-adapter";

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

const spec = (name: string, enabled: boolean): ResourceSpec => ({
  name,
  definition: { name },
  enabled,
});

function makeStack(stub: StubExtensionAPI, failureBound = 3) {
  const outcomes: ConvergeOutcome[] = [];
  const port = new PiToolActuatorPort(stub as unknown as ExtensionAPI, makeCtx());
  const store = new SpecStore();
  const loop = new ReconcileLoop(
    { store, actuator: port },
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

describe("golden-master S2 — T8 pending-next-turn is TOLERATED (loosened per lily ruling (a))", () => {
  it("a within-turn stale re-read is not-converged + NOT escalated; next turn converges", () => {
    const stub = new StubExtensionAPI();
    stub.nextTurnLatency = true; // setActive lands NEXT turn
    const { plane, loop } = makeStack(stub, 3);
    plane.applyConfig([spec("a", true)]);

    const p1 = loop.sync("turn-1"); // actuated this turn; immediate re-read stale
    // CONTRACT both current & refactored satisfy: a within-turn deferral is not
    // converged and has NOT escalated. We deliberately DO NOT pin consecutiveFailures:
    // current counts it (=1); design v2 §2 refines pending to NOT count (=0). The count
    // is the impl detail the refactor changes — pinning it = a false-regression signal.
    expect(p1.converged).toBe(false);
    expect(p1.consecutiveFailures).toBeLessThan(3); // not escalated

    stub.advanceTurn(); // the queued setActive now takes effect (turn boundary elapsed)
    const p2 = loop.sync("turn-2");
    expect(p2.converged).toBe(true);
    expect(p2.consecutiveFailures).toBe(0); // resets on convergence
  });
});

describe("golden-master S2b — cross-turn stuck DOES count + escalates (termination guarantee)", () => {
  it("actuation that never lands across repeated turns escalates at the bound — no infinite silent retry", () => {
    const stub = new StubExtensionAPI();
    stub.nextTurnLatency = true; // and we NEVER advanceTurn → genuinely stuck across boundaries
    const { plane, loop } = makeStack(stub, 3);
    plane.applyConfig([spec("a", true)]);

    let last = loop.sync("stuck-0");
    for (let i = 1; i < 5; i++) last = loop.sync(`stuck-${i}`); // 5 turns, boundary never satisfied
    // CONTRACT both must satisfy (the mirror of S2's loosening): a genuinely-stuck
    // converge MUST reach escalation. A never-incrementing impl — which would trivially
    // pass loosened S2 — FAILS here. This is the two-sided pin lily required.
    expect(last.converged).toBe(false);
    expect(last.consecutiveFailures).toBeGreaterThanOrEqual(3); // escalated at/after bound-3
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

describe("golden-master S1 — poison: registration hard-reject counts + escalates (distinct from pending)", () => {
  it("a genuine registration reject is NOT silently absorbed — it throws or escalates, never activates the good tool", () => {
    const stub = new StubExtensionAPI();
    stub.poisonRegister = "poison";
    const { plane, loop } = makeStack(stub, 3);
    plane.applyConfig([spec("poison", true), spec("ok", true)]);

    // A registration reject is a DISTINCT escalation input from a T8 deferral (lily #3):
    // decoupling pending from the counter does not weaken it. CONTRACT both satisfy:
    // current PROPAGATES the register throw out of sync (threw); refactored converge
    // CATCHES it → failed → counts + escalates. Either way it is loud, and the good
    // 'ok' tool is never activated behind the failed register.
    let threw = false;
    let last: ConvergeOutcome | undefined;
    try {
      for (let i = 0; i < 5; i++) last = loop.sync(`poison-${i}`);
    } catch {
      threw = true;
    }
    expect(threw || (last !== undefined && last.consecutiveFailures >= 3)).toBe(true);
    expect(activeSet(stub).has("ok")).toBe(false);
  });
});
