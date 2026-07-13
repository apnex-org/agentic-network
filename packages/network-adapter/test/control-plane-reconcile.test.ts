/**
 * control-plane-reconcile.test.ts — the harness-neutral HCAP consumer core tested
 * STANDALONE (hcapskills0 build_core), with a NON-tool, NON-pi actuator over an
 * OPAQUE resource definition (a skill/corpus id string, not a ToolDescriptor). This
 * is the falsifiable proof that the core is genuinely resource-generic — the
 * property the future claude-skills consumer relies on — and it pins the neutral
 * loop's T8 cross-turn escalation contract at its own level, independent of pi.
 */
import { describe, it, expect } from "vitest";
import { SpecStore, ReconcileLoop } from "../src/control-plane/index.js";
import type {
  ResourceSpec,
  ResourceActuatorPort,
  ConvergeResult,
  ManagedObservation,
  ConvergeOutcome,
} from "../src/control-plane/index.js";

/** A generic resource actuator (no tools, no pi) — `applied` is any managed surface.
 *  Optionally defers actuation to a turn boundary (T8) or fails outright. */
class FakeResourceActuator implements ResourceActuatorPort {
  private applied = new Set<string>();
  private pending: string[] | null = null;
  private readonly managed = new Set<string>();
  nextTurnLatency = false;
  failConverge = false;

  converge(desired: readonly ResourceSpec[]): ConvergeResult {
    const managedEnabled = desired.filter((s) => s.enabled).map((s) => s.name);
    for (const s of desired) this.managed.add(s.name);
    if (this.failConverge) {
      return { status: "failed", klass: "actuate-failed", desiredManaged: managedEnabled };
    }
    if (this.nextTurnLatency) this.pending = [...managedEnabled];
    else this.applied = new Set(managedEnabled);
    const observedManaged = [...this.applied].filter((n) => this.managed.has(n));
    return {
      status: sameSet(observedManaged, managedEnabled) ? "converged" : "pending-next-turn",
      desiredManaged: managedEnabled,
    };
  }
  observeManaged(): ManagedObservation {
    return {
      observedManaged: [...this.applied].filter((n) => this.managed.has(n)),
      managedNames: [...this.managed],
    };
  }
  advanceTurn(): void {
    if (this.pending) {
      this.applied = new Set(this.pending);
      this.pending = null;
    }
  }
}

/** definition is an OPAQUE skill/corpus id — deliberately NOT a tool descriptor. */
const skill = (name: string, enabled: boolean): ResourceSpec => ({
  name,
  definition: `corpus://${name}`,
  enabled,
});

function stack(act: FakeResourceActuator, failureBound = 3) {
  const outcomes: ConvergeOutcome[] = [];
  const store = new SpecStore();
  const loop = new ReconcileLoop(
    { store, actuator: act },
    { failureBound, onOutcome: (o) => outcomes.push(o) },
  );
  return { store, loop, outcomes };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const x of b) if (!s.has(x)) return false;
  return true;
}

describe("control-plane — resource-generic (opaque definition, non-tool actuator)", () => {
  it("converges an enabled declared set of opaque resources", () => {
    const act = new FakeResourceActuator();
    const { store, loop } = stack(act);
    store.apply([skill("a", true), skill("b", true), skill("c", false)]);
    const out = loop.sync("steady");
    expect(out.converged).toBe(true);
    // c is declared-inactive → not in the managed active surface.
    expect(new Set(act.observeManaged().observedManaged)).toEqual(new Set(["a", "b"]));
  });

  it("shrink: a removed resource drops from the managed surface on the next converge", () => {
    const act = new FakeResourceActuator();
    const { store, loop } = stack(act);
    store.apply([skill("a", true), skill("b", true)]);
    loop.sync("seed");
    store.apply([skill("a", true)]);
    const out = loop.sync("shrink");
    expect(out.converged).toBe(true);
    expect(new Set(act.observeManaged().observedManaged)).toEqual(new Set(["a"]));
  });
});

describe("control-plane — T8 cross-turn escalation contract (bounded both sides)", () => {
  it("a pending-next-turn is TOLERATED + not counted; next turn converges", () => {
    const act = new FakeResourceActuator();
    act.nextTurnLatency = true;
    const { store, loop } = stack(act, 3);
    store.apply([skill("a", true)]);
    const p1 = loop.sync("t1");
    expect(p1.converged).toBe(false);
    expect(p1.consecutiveFailures).toBe(0); // pending NOT counted (design v2 §2 / ruling a)
    act.advanceTurn();
    const p2 = loop.sync("t2");
    expect(p2.converged).toBe(true);
    expect(p2.consecutiveFailures).toBe(0);
  });

  it("a cross-turn stuck actuation DOES count + escalates at the bound (termination guarantee)", () => {
    const act = new FakeResourceActuator();
    act.nextTurnLatency = true; // never advanceTurn → genuinely stuck across boundaries
    const { store, loop } = stack(act, 3);
    store.apply([skill("a", true)]);
    let last = loop.sync("s0");
    for (let i = 1; i < 5; i++) last = loop.sync(`s${i}`);
    expect(last.converged).toBe(false);
    expect(last.consecutiveFailures).toBeGreaterThanOrEqual(3);
  });

  it("a converge fault counts + escalates immediately (distinct from a pending deferral)", () => {
    const act = new FakeResourceActuator();
    act.failConverge = true;
    const { store, loop } = stack(act, 3);
    store.apply([skill("a", true)]);
    let last = loop.sync("f0");
    for (let i = 1; i < 3; i++) last = loop.sync(`f${i}`);
    expect(last.converged).toBe(false);
    expect(last.consecutiveFailures).toBeGreaterThanOrEqual(3);
  });
});
