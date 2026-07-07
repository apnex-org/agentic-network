/**
 * hcap-u5-seam.test.ts — KF3 behavioral half: the REAL PiToolActuatorPort (U5)
 * over a STUB ExtensionAPI.
 *
 * Where the pure FakePort suite proves U1-U4, this proves the actual air-gap
 * crossing: U5 renders descriptors through the tool-bridge and calls ONLY the
 * ExtensionAPI verbs (registerTool / getActiveTools / setActiveTools) — never
 * AgentHarness.setTools; its managedNames ledger is populated by register (the
 * built-in-subtraction key a pure fake can't verify); and a full converge through
 * the real U5 preserves stub built-ins while activating the enabled subset. NO Hub,
 * NO MCP. (The STATIC import-boundary half of KF3 is hcap-import-boundary.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { WorkLeaseTracker } from "@apnex/network-adapter";
import type {
  ToolDispatchContext,
  IToolDispatchAgent,
} from "@apnex/network-adapter";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PiToolActuatorPort } from "../src/hcap/tools/pi-tool-actuator-port.js";
import { SpecStore } from "../src/hcap/tools/spec-store.js";
import { DiffEngine } from "../src/hcap/tools/diff-engine.js";
import { ConvergenceActuator } from "../src/hcap/tools/convergence-actuator.js";
import { SpecReconcileLoop } from "../src/hcap/tools/reconcile-loop.js";
import { PiToolControlPlane } from "../src/hcap/tools/tool-control-plane.js";
import type { ToolSpec } from "../src/hcap/tools/contracts.js";

const BUILTINS = ["bash", "read"];

/** Records ONLY the ExtensionAPI surface U5 is permitted to touch. */
class StubExtensionAPI {
  readonly registerCalls: string[] = [];
  readonly setActiveCalls: string[][] = [];
  private active: Set<string>;
  private readonly all = new Set<string>();

  constructor(builtins: string[] = BUILTINS) {
    this.active = new Set(builtins);
    for (const b of builtins) this.all.add(b);
  }

  registerTool(def: { name: string }): void {
    this.registerCalls.push(def.name);
    this.all.add(def.name);
  }
  getActiveTools(): string[] {
    return [...this.active];
  }
  getAllTools(): Array<{ name: string }> {
    return [...this.all].map((name) => ({ name }));
  }
  setActiveTools(names: string[]): void {
    this.setActiveCalls.push([...names]);
    this.active = new Set(names);
  }
}

function fakeAgent(): IToolDispatchAgent {
  return {
    state: "streaming",
    isConnected: true,
    async call() {
      return { ok: true };
    },
    async listTools() {
      return [];
    },
  };
}

function makeCtx(): ToolDispatchContext {
  return {
    getAgent: () => fakeAgent(),
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

function makeRealU5Stack(stub: StubExtensionAPI) {
  const port = new PiToolActuatorPort(stub as unknown as ExtensionAPI, makeCtx());
  const store = new SpecStore();
  const loop = new SpecReconcileLoop(
    { store, diff: new DiffEngine(), actuator: new ConvergenceActuator(port), port },
    {},
  );
  const plane = new PiToolControlPlane({ store, loop, port });
  return { port, store, loop, plane };
}

describe("KF3 — real PiToolActuatorPort (U5) over a stub ExtensionAPI", () => {
  it("converges through the real seam: registers declared defs, activates enabled subset, preserves built-ins", () => {
    const stub = new StubExtensionAPI();
    const { plane, loop } = makeRealU5Stack(stub);
    plane.applyConfig([spec("a", true), spec("b", true)]);

    const out = loop.sync("real-u5");

    expect(out.converged).toBe(true);
    // U5 rendered + registered each declared def via ExtensionAPI.registerTool.
    expect(stub.registerCalls).toEqual(expect.arrayContaining(["a", "b"]));
    // authoritative REPLACE preserved built-ins + added the enabled subset.
    const lastSetActive = stub.setActiveCalls.at(-1);
    expect(new Set(lastSetActive)).toEqual(new Set([...BUILTINS, "a", "b"]));
    expect(new Set(stub.getActiveTools())).toEqual(new Set([...BUILTINS, "a", "b"]));
  });

  it("the managedNames ledger is populated by register (built-in-subtraction key)", () => {
    const stub = new StubExtensionAPI();
    const { port, plane, loop } = makeRealU5Stack(stub);
    plane.applyConfig([spec("a", true), spec("b", false)]);
    loop.sync("ledger");

    const snap = port.snapshot();
    // both registered (level-1) → both managed; built-ins are NEVER managed.
    expect(new Set(snap.managedNames)).toEqual(new Set(["a", "b"]));
    expect(snap.managedNames).not.toContain("bash");
  });

  it("T4 at the real seam — out-of-band ROGUE (direct stub.setActiveTools) reverted on sync", () => {
    const stub = new StubExtensionAPI();
    const { plane, loop } = makeRealU5Stack(stub);
    plane.applyConfig([spec("a", true), spec("b", true)]);
    loop.sync("seed");

    // an out-of-band actor mutates pi's active set directly, bypassing the plane:
    // drops b, injects ROGUE. Only the captured baseline (not activeNames−managed)
    // lets U3 revert ROGUE while restoring b + preserving built-ins.
    stub.setActiveTools([...BUILTINS, "a", "ROGUE"]);

    const out = loop.sync("rogue");

    expect(out.converged).toBe(true);
    expect(new Set(stub.getActiveTools())).toEqual(new Set([...BUILTINS, "a", "b"]));
    expect(stub.getActiveTools()).not.toContain("ROGUE");
  });

  it("never clobbers a stub built-in across enable→disable→remove (real setActive REPLACE)", () => {
    const stub = new StubExtensionAPI();
    const { plane, loop } = makeRealU5Stack(stub);
    plane.applyConfig([spec("a", true)]);
    loop.sync("on");
    plane.applyConfig([]); // remove a
    loop.sync("off");

    expect(new Set(stub.getActiveTools())).toEqual(new Set(BUILTINS)); // built-ins intact, a gone
    for (const call of stub.setActiveCalls) {
      for (const b of BUILTINS) expect(call).toContain(b);
    }
  });
});
