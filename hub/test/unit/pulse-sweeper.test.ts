/**
 * PulseSweeper unit tests — mission-57 W2.
 *
 * Covers:
 *   - Sweeper FSM: fire-due check + missed-threshold pause + precondition skip
 *   - firePulse with deterministic migrationSourceId (Item-1 Option A)
 *   - Idempotency on sweeper restart (double-fire prevention via short-circuit)
 *   - escalateMissedThreshold with E1 mediation-invariant routing (target.role=architect)
 *   - E2 3-condition missed-count guard (no false-positive on precondition-skip)
 *   - onPulseAcked webhook (Item-2): reset missedCount + update lastResponseAt
 *   - First-fire timing: mission.createdAt + firstFireDelaySeconds
 *   - Cadence-based fire: lastFiredAt + intervalSeconds
 *   - (unset)/legacy missionClass = NO PULSE backward-compat
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorageSubstrate } from "../../src/storage-substrate/index.js";
import { MissionRepositorySubstrate as MissionRepository } from "../../src/entities/mission-repository-substrate.js";
import { MessageRepositorySubstrate as MessageRepository } from "../../src/entities/message-repository-substrate.js";
import { IdeaRepositorySubstrate as IdeaRepository } from "../../src/entities/idea-repository-substrate.js";
import { SubstrateCounter } from "../../src/entities/substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../../src/entities/work-item-repository-substrate.js";
import { PulseSweeper, pulseSelector } from "../../src/policy/pulse-sweeper.js";
import { createMetricsCounter } from "../../src/observability/metrics.js";
import type { IPolicyContext } from "../../src/policy/types.js";
import type { Mission, Message, MissionPulses, MessageAuthorRole } from "../../src/entities/index.js";

const MS = (s: number) => s * 1000;

function buildSweeperRig(opts: { omitRegistry?: boolean; agents?: Array<{ id: string; role: string }> } = {}) {
  const storage = createMemoryStorageSubstrate();
  const counter = new SubstrateCounter(storage);
  const ideaStore = new IdeaRepository(storage, counter);
  const missionStore = new MissionRepository(storage, counter, ideaStore);
  const messageStore = new MessageRepository(storage);
  const workItemStore = new WorkItemRepositorySubstrate(storage, counter);
  let nowMs = new Date("2026-04-26T10:00:00.000Z").getTime();
  const advance = (ms: number) => {
    nowMs += ms;
  };
  const setNow = (ms: number) => {
    nowMs = ms;
  };
  // Mission-61 W1 Fix #1: capture dispatch calls for verification of
  // Path A SSE-push wiring.
  const dispatched: Array<{
    event: string;
    data: Record<string, unknown>;
    selector: { roles?: string[]; agentId?: string };
  }> = [];
  const sweeper = new PulseSweeper(
    missionStore,
    messageStore,
    {
      forSweeper: () => ({
        stores: {
          mission: missionStore,
          message: messageStore,
          idea: ideaStore,
          // bug-176 — iterateAgentPulses reads engineerRegistry.listAgents() on
          // EVERY tick; without it the pass threw `Cannot read properties of
          // undefined (reading 'listAgents')` deterministically (caught + logged,
          // so it never failed an assertion — pure noise masquerading as a flake).
          // An empty roster makes the agent-pulse pass a clean no-op. The
          // `omitRegistry` variant drops it to exercise the prod null-guard.
          workItem: workItemStore,
          ...(opts.omitRegistry ? {} : { engineerRegistry: { listAgents: async () => (opts.agents ?? []) } }),
        },
        metrics: createMetricsCounter(),
        emit: async () => {},
        dispatch: async (event: string, data: Record<string, unknown>, selector: { roles?: string[]; agentId?: string }) => {
          dispatched.push({ event, data, selector });
        },
        sessionId: "test-pulse-sweeper",
        clientIp: "127.0.0.1",
        role: "system",
        internalEvents: [],
      } as unknown as IPolicyContext),
    },
    { graceMs: 30_000, now: () => nowMs, intervalMs: 60_000 },
  );
  return { sweeper, missionStore, messageStore, workItemStore, ideaStore, advance, setNow, getNowMs: () => nowMs, dispatched };
}

async function createPulseMission(
  rig: ReturnType<typeof buildSweeperRig>,
  pulses: MissionPulses,
): Promise<Mission> {
  const created = await rig.missionStore.createMission(
    "Pulse Mission",
    "test",
    undefined,  // documentRef
    undefined,  // backlink
    undefined,  // createdBy
    // work-162 (A1): plannedTasks positional arg removed from createMission.
    "coordination-primitive-shipment",  // missionClass
    pulses,
  );
  // Flip to active so the sweeper iterates this mission
  const activated = await rig.missionStore.updateMission(created.id, { status: "active" });
  return activated!;
}

describe("PulseSweeper — fire-due semantics", () => {
  it("fires the first pulse after firstFireDelaySeconds elapses", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 1800,
        message: "status?",
        responseShape: "short_status",
        missedThreshold: 3,
        firstFireDelaySeconds: 1800,
      },
    });

    // Tick at mission.createdAt → not yet due
    rig.setNow(new Date(mission.createdAt).getTime());
    let result = await rig.sweeper.tick();
    expect(result.fired).toBe(0);
    expect(result.skipped).toBe(1);
    // bug-176 — a tick must complete with NO iterateAgentPulses error. Pre-fix
    // (no engineerRegistry in the rig) this was ≥1 on every tick; this assertion
    // makes the registry stub load-bearing so the deterministic noise can't
    // silently return.
    expect(result.errors).toBe(0);

    // Advance just over firstFireDelay → fire-due
    rig.setNow(new Date(mission.createdAt).getTime() + MS(1801));
    result = await rig.sweeper.tick();
    expect(result.fired).toBe(1);

    const messages = await rig.messageStore.listMessages({});
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("external-injection");
    expect(messages[0].target).toEqual({ role: "engineer" });
    expect(messages[0].migrationSourceId).toMatch(/^pulse:mission-\d+:engineerPulse:/);
    expect((messages[0].payload as { pulseKind: string }).pulseKind).toBe("status_check");
  });

  it("bug-176 — a context whose stores OMIT engineerRegistry sweeps cleanly (the prod null-guard)", async () => {
    // Directly exercises the production guard (the non-vacuous regression test):
    // without it, iterateAgentPulses does `ctx.stores.engineerRegistry.listAgents()`
    // on a missing registry → `Cannot read properties of undefined (reading
    // 'listAgents')` every tick (caught → result.errors++). With the guard, a
    // registry-less context is a clean no-op. Remove the prod guard and this
    // assertion fails (errors ≥ 1).
    const rig = buildSweeperRig({ omitRegistry: true });
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 1800,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 1800,
      },
    });
    rig.setNow(new Date(mission.createdAt).getTime() + MS(1801));
    const result = await rig.sweeper.tick();
    expect(result.errors).toBe(0);
  });

  it("does not fire before firstFireDelaySeconds elapses", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 600,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 600,
      },
    });

    rig.setNow(new Date(mission.createdAt).getTime() + MS(599));
    const result = await rig.sweeper.tick();
    expect(result.fired).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("fires subsequent pulses at intervalSeconds cadence after lastFiredAt", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 600,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 600,
      },
    });

    // First fire at mission.createdAt + 600s
    rig.setNow(new Date(mission.createdAt).getTime() + MS(601));
    await rig.sweeper.tick();
    const messagesAfter1 = await rig.messageStore.listMessages({});
    expect(messagesAfter1).toHaveLength(1);

    // Tick again immediately — no new fire (next due at lastFiredAt + 600s)
    let result = await rig.sweeper.tick();
    expect(result.fired).toBe(0);

    // Need to ack the first pulse (so missedCount doesn't increment + escalate
    // before the cadence-based second fire). Otherwise after grace+intervalSeconds
    // the missedCount increments to threshold and we get an escalation.
    const lastFired = (await rig.missionStore.getMission(mission.id))!.pulses!
      .engineerPulse!.lastFiredAt!;
    await rig.missionStore.updateMission(mission.id, {
      pulses: {
        engineerPulse: {
          ...mission.pulses!.engineerPulse!,
          lastFiredAt: lastFired,
          lastResponseAt: lastFired,
          missedCount: 0,
        },
      },
    });

    // Advance past lastFiredAt + intervalSeconds — second pulse fires
    rig.setNow(new Date(lastFired).getTime() + MS(601));
    result = await rig.sweeper.tick();
    expect(result.fired).toBe(1);

    const messagesAfter2 = await rig.messageStore.listMessages({});
    expect(messagesAfter2).toHaveLength(2);
  });
});

describe("PulseSweeper — idempotency (Item-1 deterministic key)", () => {
  it("short-circuits double-fire when sweeper restarts mid-tick", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 600,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 600,
      },
    });

    rig.setNow(new Date(mission.createdAt).getTime() + MS(601));
    await rig.sweeper.tick();
    const messagesAfter1 = await rig.messageStore.listMessages({});
    expect(messagesAfter1).toHaveLength(1);

    // Simulate sweeper crash: clear the lastFiredAt bookkeeping so a
    // restart would compute the same nextFireDueAt + try to fire again
    const fresh = (await rig.missionStore.getMission(mission.id))!;
    await rig.missionStore.updateMission(mission.id, {
      pulses: {
        engineerPulse: {
          ...fresh.pulses!.engineerPulse!,
          lastFiredAt: undefined,
        },
      },
    });

    // Tick again — should short-circuit (existing migrationSourceId match)
    // The short-circuit branch is hit inside firePulse; counted as "fired"
    // outcome in evaluatePulse return value.
    await rig.sweeper.tick();

    // No new Message created (short-circuit prevented duplicate)
    const messagesAfter2 = await rig.messageStore.listMessages({});
    expect(messagesAfter2).toHaveLength(1);

    // lastFiredAt reconciled
    const reconciled = (await rig.missionStore.getMission(mission.id))!;
    expect(reconciled.pulses!.engineerPulse!.lastFiredAt).toBeDefined();
  });
});

describe("PulseSweeper — missed-count + escalation (E1 + E2)", () => {
  it("E2 3-condition guard PRESERVED INTACT post-mission-68 — pulseFiredAtLeastOnce condition prevents false-positive before first fire (mission-68 C1)", async () => {
    // Mission-68 W1: precondition layer removed (Q3a Director-pick); the
    // 3-condition guard (`pulseFiredAtLeastOnce && noAckSinceLastFire &&
    // graceWindowElapsed`) PRESERVED INTACT per CRITICAL C1 fold —
    // ORTHOGONAL to precondition layer; load-bearing for missed-count
    // semantics. Verify the FIRST condition (`pulseFiredAtLeastOnce`)
    // continues to prevent false-positives before the first fire happens
    // (e.g., before firstFireDelaySeconds elapsed).
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 60,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 600, // 10x intervalSeconds — first fire deferred
      },
    });

    // Advance past intervalSeconds + grace BUT NOT past firstFireDelaySeconds
    // → no fire yet → 3-condition guard's pulseFiredAtLeastOnce condition
    // prevents missedCount increment.
    rig.setNow(new Date(mission.createdAt).getTime() + MS(300));
    let result = await rig.sweeper.tick();
    expect(result.fired).toBe(0);
    expect(result.skipped).toBe(1);

    // missedCount should NOT have incremented (pulseFiredAtLeastOnce=false)
    let m = (await rig.missionStore.getMission(mission.id))!;
    expect(m.pulses!.engineerPulse!.missedCount ?? 0).toBe(0);
    expect(m.pulses!.engineerPulse!.lastFiredAt).toBeUndefined();

    // Advance further (still pre-firstFire); still no missedCount increment
    rig.setNow(new Date(mission.createdAt).getTime() + MS(500));
    result = await rig.sweeper.tick();
    expect(result.fired).toBe(0);
    m = (await rig.missionStore.getMission(mission.id))!;
    expect(m.pulses!.engineerPulse!.missedCount ?? 0).toBe(0);
  });

  it("E1 mediation-invariant: missed-threshold escalation routes to architect (NOT director)", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 60,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 2,
        firstFireDelaySeconds: 60,
        // No precondition (always fire)
      },
    });

    // First fire
    rig.setNow(new Date(mission.createdAt).getTime() + MS(61));
    await rig.sweeper.tick();
    let messages = await rig.messageStore.listMessages({});
    expect(messages).toHaveLength(1);

    // Advance grace + intervalSeconds → missed (count=1)
    rig.setNow(new Date(mission.createdAt).getTime() + MS(61) + MS(60) + 31_000);
    let result = await rig.sweeper.tick();
    let m = (await rig.missionStore.getMission(mission.id))!;
    expect(m.pulses!.engineerPulse!.missedCount).toBe(1);

    // Simulate a second fire happening (so we can test the second
    // missed-window → escalation path). Bump lastFiredAt manually.
    const after1stMiss = (await rig.missionStore.getMission(mission.id))!;
    const newFireMs = rig.getNowMs() + 5000;
    const newFireAt = new Date(newFireMs).toISOString();
    await rig.missionStore.updateMission(mission.id, {
      pulses: {
        engineerPulse: {
          ...after1stMiss.pulses!.engineerPulse!,
          lastFiredAt: newFireAt,
        },
      },
    });

    // Advance past second grace window
    rig.setNow(newFireMs + MS(60) + 31_000);
    result = await rig.sweeper.tick();
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    // Verify escalation Message routed to architect (NOT director)
    messages = await rig.messageStore.listMessages({});
    const escalation = messages.find(
      (m) => (m.payload as { pulseKind?: string })?.pulseKind === "missed_threshold_escalation",
    );
    expect(escalation).toBeDefined();
    expect(escalation!.target).toEqual({ role: "architect" });
    expect((escalation!.payload as { silentRole: string }).silentRole).toBe("engineer");
    // Option C: no migrationSourceId on escalation Messages
    expect(escalation!.migrationSourceId).toBeUndefined();
  });

  // S1a-(i) (idea-458): the anti-idle backstop must NOT self-disable on
  // escalation. Previously a missedThreshold breach paused the pulse (skipped
  // forever) — a silent backstop is worse than none. Now it escalates ONCE and
  // keeps firing at a floor cadence. These two tests pin the new contract
  // (they replace the old "paused pulse stops firing after escalation" test,
  // which asserted the self-disable this slice removes).
  it("continues firing at a FLOOR cadence after escalation — no self-disable (S1a-(i))", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 60,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 1,
        firstFireDelaySeconds: 60,
      },
    });
    const t0 = new Date(mission.createdAt).getTime();

    // First fire (lastFiredAt = t0+60s).
    rig.setNow(t0 + MS(61));
    expect((await rig.sweeper.tick()).fired).toBe(1);

    // Grace elapses with no ack → missedCount 0→1 → threshold(1) breached →
    // escalate ONCE (this tick returns "escalated", does not fire a pulse).
    rig.setNow(t0 + MS(152));
    let r = await rig.sweeper.tick();
    expect(r.escalated).toBe(1);
    expect(r.fired).toBe(0);

    // PRE-FIX: the pulse would now be permanently paused (skipped forever).
    // POST-FIX: the very next tick floor-fires (floorDue = lastFired t0+60 +
    // floor 60 = t0+120, already past) — the backstop is ALIVE, still nudging.
    r = await rig.sweeper.tick();
    expect(r.fired).toBe(1); // STILL FIRING (was 0 / paused pre-fix)
    expect(r.escalated).toBe(0); // no re-escalation

    // Quiet BETWEEN floor fires — floor cadence not yet due (quiet, not silent).
    rig.setNow(t0 + MS(170)); // lastFired now t0+120 → next floorDue t0+180
    r = await rig.sweeper.tick();
    expect(r.fired).toBe(0);
    expect(r.skipped).toBe(1);

    // Next floor cadence due → fires again.
    rig.setNow(t0 + MS(185));
    expect((await rig.sweeper.tick()).fired).toBe(1);

    // Escalation happened EXACTLY ONCE across all of the above (no storm).
    const escalations = (await rig.messageStore.listMessages({})).filter(
      (m) => (m.payload as { pulseKind?: string })?.pulseKind === "missed_threshold_escalation",
    );
    expect(escalations).toHaveLength(1);
  });

  it("escalates exactly once but keeps firing for N cadences after breach (no storm, no silence)", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 60,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 1,
        firstFireDelaySeconds: 60,
      },
    });
    const t0 = new Date(mission.createdAt).getTime();

    rig.setNow(t0 + MS(61));
    await rig.sweeper.tick(); // first fire
    rig.setNow(t0 + MS(152));
    expect((await rig.sweeper.tick()).escalated).toBe(1); // breach + escalate once

    // Drive 10 floor cadences well past threshold breach: the pulse fires every
    // cadence (never goes silent) and never re-escalates (no storm).
    let fires = 0;
    let t = t0 + MS(152);
    for (let i = 0; i < 10; i++) {
      t += MS(60); // advance one floor cadence
      rig.setNow(t);
      const r = await rig.sweeper.tick();
      fires += r.fired;
      expect(r.escalated).toBe(0);
    }
    expect(fires).toBe(10); // still firing every cadence — NOT self-disabled

    const escalations = (await rig.messageStore.listMessages({})).filter(
      (m) => (m.payload as { pulseKind?: string })?.pulseKind === "missed_threshold_escalation",
    );
    expect(escalations).toHaveLength(1); // exactly once, N cadences later
  });
});

describe("PulseSweeper — S1a-(ii) target-agent-scoped authored-write crediting (idea-458)", () => {
  const AGENTS = [
    { id: "arch-1", role: "architect" },
    { id: "eng-1", role: "engineer" },
  ];

  // The sweeper clock is simulated (rig.now) but the message + mission stores
  // stamp REAL wall-clock time. To keep authored-write / ack timestamps
  // comparable to lastFiredAt, seed a "fired 200s ago (real)" state via
  // updateMission (the same manual-bookkeeping pattern the E1 test uses) so
  // real-stamped writes land AFTER lastFired. In production all clocks are real
  // and consistent; this only reconciles the test harness's clock split.
  async function seedFiredArchitectPulse(
    rig: ReturnType<typeof buildSweeperRig>,
    overrides: Record<string, unknown> = {},
  ) {
    const mission = await createPulseMission(rig, {
      architectPulse: {
        intervalSeconds: 60,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 60,
      },
    });
    const firedAtMs = Date.now() - MS(200); // fired 200s ago (real clock)
    const base = mission.pulses!.architectPulse!;
    await rig.missionStore.updateMission(mission.id, {
      pulses: { architectPulse: { ...base, lastFiredAt: new Date(firedAtMs).toISOString(), missedCount: 0, ...overrides } },
    });
    // Advance the sweeper past the grace window relative to the seeded fire.
    rig.setNow(Date.now() + MS(1));
    return { mission, firedAtMs };
  }

  async function authorMessage(rig: ReturnType<typeof buildSweeperRig>, agentId: string, role: string) {
    await rig.messageStore.createMessage({
      kind: "note",
      authorRole: role as MessageAuthorRole,
      authorAgentId: agentId,
      target: null,
      delivery: "push-immediate",
      payload: { body: "working" },
    });
  }

  it("MISSED witness [load-bearing]: target (architect) quiescent WHILE another agent (engineer) writes → STILL credits target MISSED", async () => {
    const rig = buildSweeperRig({ agents: AGENTS });
    // The ENGINEER is actively writing; the ARCHITECT (the pulse's target) is NOT.
    await authorMessage(rig, "eng-1", "engineer");
    const { mission } = await seedFiredArchitectPulse(rig);
    await rig.sweeper.tick();

    // The engineer's write must NOT credit the architectPulse — scoping is
    // per-target-agentId, never any-agent. So the architect pulse is MISSED
    // (else the incident reproduces inverted: architect idle, engineers busy).
    const m = (await rig.missionStore.getMission(mission.id))!;
    expect(m.pulses!.architectPulse!.missedCount).toBe(1);
  });

  it("LIVE witness: target (architect) authors a write WITHOUT acking in-window → credits LIVE (the literal incident, no false-pause)", async () => {
    const rig = buildSweeperRig({ agents: AGENTS });
    // The ARCHITECT authored real work — but never acked the synthetic pulse.
    await authorMessage(rig, "arch-1", "architect");
    const { mission } = await seedFiredArchitectPulse(rig);
    await rig.sweeper.tick();

    // Authored-write credits liveness → NOT missed (pre-fix this false-paused
    // the backstop — the idea-458 lived incident).
    const m = (await rig.missionStore.getMission(mission.id))!;
    expect(m.pulses!.architectPulse!.missedCount ?? 0).toBe(0);
  });

  it("regression: an ack still credits LIVE (backward-compat — ack remains an additional positive signal)", async () => {
    const rig = buildSweeperRig({ agents: AGENTS });
    // The architect acked the pulse (lastResponseAt after the fire) and authored
    // no other write — the existing ack signal must still credit LIVE.
    const { mission } = await seedFiredArchitectPulse(rig, {
      lastResponseAt: new Date(Date.now()).toISOString(),
    });
    await rig.sweeper.tick();

    const m = (await rig.missionStore.getMission(mission.id))!;
    expect(m.pulses!.architectPulse!.missedCount ?? 0).toBe(0);
  });

  it("BOUNDED existence [cap-immunity, bug-117/idea-292 class]: >500 OLD target messages + one newer in-window write → still credits LIVE", async () => {
    const rig = buildSweeperRig({ agents: AGENTS });
    // 500 OLD architect messages (created first → smallest ULID ids). An
    // ascending + LIST_PREFETCH_CAP(500) listMessages returns exactly these,
    // hiding any newer message beyond the page — the first-N-cap trap the fix
    // closes. hasAuthoredSince resolves the global newest (id-desc, limit 1).
    for (let i = 0; i < 500; i++) await authorMessage(rig, "arch-1", "architect");
    await new Promise((r) => setTimeout(r, 5)); // ensure the fire boundary is strictly after the 500 old writes
    const firedAtMs = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    // the 501st architect message — newest id, authored IN-WINDOW (after the fire).
    await authorMessage(rig, "arch-1", "architect");

    const mission = await createPulseMission(rig, {
      architectPulse: { intervalSeconds: 60, message: "status?", responseShape: "ack", missedThreshold: 3, firstFireDelaySeconds: 60 },
    });
    const base = mission.pulses!.architectPulse!;
    await rig.missionStore.updateMission(mission.id, {
      pulses: { architectPulse: { ...base, lastFiredAt: new Date(firedAtMs).toISOString(), missedCount: 0 } },
    });
    rig.setNow(firedAtMs + MS(150)); // past grace (150s > intervalSeconds+grace = 90s)
    await rig.sweeper.tick();

    // The bounded newest-by-author lookup finds the 501st (in-window) despite the
    // 500 older ones → LIVE. The old listMessages(...).length-1 (newest of the
    // OLDEST 500, all pre-fire) would have false-MISSED — the exact defect for a
    // long-lived, prolific target this fix targets.
    const m = (await rig.missionStore.getMission(mission.id))!;
    expect(m.pulses!.architectPulse!.missedCount ?? 0).toBe(0);
  });
});

describe("PulseSweeper — W1 node-native pulse pass (idea-446 / work-181)", () => {
  const PULSE = { intervalSeconds: 60, message: "status?", responseShape: "ack" as const, missedThreshold: 3, firstFireDelaySeconds: 60 };

  async function makePulseNode(rig: ReturnType<typeof buildSweeperRig>, roleEligibility: string[]) {
    return rig.workItemStore.createWorkItem({
      type: "task", roleEligibility, evidenceRequirements: [], nodeConfig: { pulse: { ...PULSE } },
    });
  }
  async function authorMessage(rig: ReturnType<typeof buildSweeperRig>, agentId: string, role: string) {
    await rig.messageStore.createMessage({
      kind: "note", authorRole: role as MessageAuthorRole, authorAgentId: agentId, target: null, delivery: "push-immediate", payload: { body: "working" },
    });
  }
  // Like S1a-(ii): the sweeper clock is simulated but the stores stamp REAL time,
  // so seed lastFiredAt to the real past → real-stamped writes land AFTER it.
  async function seedFired(rig: ReturnType<typeof buildSweeperRig>, nodeId: string, overrides: Record<string, unknown> = {}) {
    await rig.workItemStore.updateNodePulseBookkeeping(nodeId, { lastFiredAt: new Date(Date.now() - MS(200)).toISOString(), missedCount: 0, ...overrides });
    rig.setNow(Date.now() + MS(1));
  }

  it("FIRES a node-native pulse when first-fire is due (message carries nodeId; bookkeeping advances)", async () => {
    const rig = buildSweeperRig();
    const node = await makePulseNode(rig, ["engineer"]);
    rig.setNow(new Date(node.createdAt).getTime() + MS(61)); // past firstFireDelay
    const r = await rig.sweeper.tick();
    expect(r.fired).toBeGreaterThanOrEqual(1);
    const msg = (await rig.messageStore.listMessages({})).find(
      (m) => (m.payload as { pulseKind?: string; nodeId?: string })?.pulseKind === "status_check" && (m.payload as { nodeId?: string })?.nodeId === node.id,
    );
    expect(msg).toBeDefined();
    const after = (await rig.workItemStore.getWorkItem(node.id))!;
    expect(after.nodeConfig!.pulse!.lastFiredAt).toBeDefined();
  });

  it("LIVE (fork-c holder-scoped reprieve): the HOLDER's authored write credits liveness → NOT missed", async () => {
    const rig = buildSweeperRig({ agents: [{ id: "eng-1", role: "engineer" }] });
    const node = await makePulseNode(rig, ["engineer"]);
    await rig.workItemStore.claimWorkItem(node.id, "eng-1", "engineer"); // holder = eng-1
    await authorMessage(rig, "eng-1", "engineer"); // the HOLDER authored real work, no ack
    await seedFired(rig, node.id);
    await rig.sweeper.tick();
    expect((await rig.workItemStore.getWorkItem(node.id))!.nodeConfig!.pulse!.missedCount ?? 0).toBe(0);
  });

  it("MISSED [load-bearing scoping]: holder quiescent WHILE another agent writes → still credits the node MISSED (holder-scoped, not any-agent)", async () => {
    const rig = buildSweeperRig({ agents: [{ id: "eng-1", role: "engineer" }, { id: "eng-2", role: "engineer" }] });
    const node = await makePulseNode(rig, ["engineer"]);
    await rig.workItemStore.claimWorkItem(node.id, "eng-1", "engineer"); // holder = eng-1
    await authorMessage(rig, "eng-2", "engineer"); // a DIFFERENT agent writes; the holder is silent
    await seedFired(rig, node.id);
    await rig.sweeper.tick();
    // eng-2's write must NOT credit eng-1's node — else the S1a-(ii) multi-agent trap reappears.
    expect((await rig.workItemStore.getWorkItem(node.id))!.nodeConfig!.pulse!.missedCount).toBe(1);
  });

  it("EMPTY roleEligibility (any-role, unleased): authored-write does NOT reprieve (ack-only) — no any-agent false-credit", async () => {
    const rig = buildSweeperRig({ agents: [{ id: "eng-1", role: "engineer" }] });
    const node = await makePulseNode(rig, []); // any-role, unleased
    await authorMessage(rig, "eng-1", "engineer"); // some agent writes — must NOT credit
    await seedFired(rig, node.id);
    await rig.sweeper.tick();
    expect((await rig.workItemStore.getWorkItem(node.id))!.nodeConfig!.pulse!.missedCount).toBe(1);
  });

  it("EMPTY roleEligibility: an ACK still credits LIVE (the fallback signal)", async () => {
    const rig = buildSweeperRig();
    const node = await makePulseNode(rig, []);
    await seedFired(rig, node.id, { lastResponseAt: new Date(Date.now()).toISOString() }); // acked after fire
    await rig.sweeper.tick();
    expect((await rig.workItemStore.getWorkItem(node.id))!.nodeConfig!.pulse!.missedCount ?? 0).toBe(0);
  });
});

describe("PulseSweeper — onPulseAcked webhook (Item-2)", () => {
  it("resets missedCount + updates lastResponseAt", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 60,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 60,
      },
    });

    // First fire
    rig.setNow(new Date(mission.createdAt).getTime() + MS(61));
    await rig.sweeper.tick();

    // Manually bump missedCount as if 1 fire was missed
    const m1 = (await rig.missionStore.getMission(mission.id))!;
    await rig.missionStore.updateMission(mission.id, {
      pulses: {
        engineerPulse: {
          ...m1.pulses!.engineerPulse!,
          missedCount: 1,
        },
      },
    });

    // Find the pulse Message + simulate webhook ack
    const messages = await rig.messageStore.listMessages({});
    const pulseMsg = messages.find(
      (msg) => (msg.payload as { pulseKind?: string })?.pulseKind === "status_check",
    )!;
    rig.setNow(rig.getNowMs() + 5000);
    await rig.sweeper.onPulseAcked(pulseMsg);

    // missedCount reset to 0 + lastResponseAt populated
    const m2 = (await rig.missionStore.getMission(mission.id))!;
    expect(m2.pulses!.engineerPulse!.missedCount).toBe(0);
    expect(m2.pulses!.engineerPulse!.lastResponseAt).toBeDefined();
  });
});

describe("PulseSweeper — multi-pulse + multi-mission", () => {
  it("iterates engineerPulse + architectPulse on the same mission", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 60,
        message: "engineer status?",
        responseShape: "short_status",
        missedThreshold: 3,
        firstFireDelaySeconds: 60,
      },
      architectPulse: {
        intervalSeconds: 60,
        message: "architect status?",
        responseShape: "short_status",
        missedThreshold: 3,
        firstFireDelaySeconds: 60,
      },
    });

    rig.setNow(new Date(mission.createdAt).getTime() + MS(61));
    const result = await rig.sweeper.tick();
    expect(result.fired).toBe(2);

    const messages = await rig.messageStore.listMessages({});
    expect(messages).toHaveLength(2);
    const targets = messages.map((m) => m.target?.role).sort();
    expect(targets).toEqual(["architect", "engineer"]);
  });

  it("skips missions in non-active status", async () => {
    const rig = buildSweeperRig();
    // Create proposed mission directly (bypass createPulseMission's auto-activate)
    const mission = await rig.missionStore.createMission(
      "Proposed",
      "test",
      undefined,  // documentRef
      undefined,  // backlink
      undefined,  // createdBy
      "coordination-primitive-shipment",  // missionClass (work-162: plannedTasks slot removed)
      {
        engineerPulse: {
          intervalSeconds: 60,
          message: "status?",
          responseShape: "ack",
          missedThreshold: 3,
          firstFireDelaySeconds: 60,
        },
      },
    );

    // Mission still in `proposed` status — sweeper iterates only `active`
    rig.setNow(new Date(mission.createdAt).getTime() + MS(120));
    const result = await rig.sweeper.tick();
    expect(result.scanned).toBe(0);
    expect(result.fired).toBe(0);
  });
});

describe("PulseSweeper — backward-compat", () => {
  it("ignores missions without missionClass + pulses", async () => {
    const rig = buildSweeperRig();
    const mission = await rig.missionStore.createMission("Plain", "no pulses");
    await rig.missionStore.updateMission(mission.id, { status: "active" });
    const result = await rig.sweeper.tick();
    expect(result.scanned).toBe(0);
    expect(result.fired).toBe(0);
  });

  it("ignores missions with missionClass set but no pulses field", async () => {
    const rig = buildSweeperRig();
    const mission = await rig.missionStore.createMission(
      "Class-only",
      "no pulses",
      undefined,  // documentRef
      undefined,  // backlink
      undefined,  // createdBy
      "coordination-primitive-shipment",  // missionClass (work-162: plannedTasks slot removed)
      undefined, // no pulses
    );
    await rig.missionStore.updateMission(mission.id, { status: "active" });
    const result = await rig.sweeper.tick();
    expect(result.scanned).toBe(0);
  });
});

// ── Mission-61 W1 Fix #1+#2: Path A SSE wiring + force-fire ─────────

describe("pulseSelector helper", () => {
  it("produces single-role selector for engineer", () => {
    expect(pulseSelector("engineer")).toEqual({ roles: ["engineer"] });
  });
  it("produces single-role selector for architect", () => {
    expect(pulseSelector("architect")).toEqual({ roles: ["architect"] });
  });
});

describe("PulseSweeper — Mission-61 W1 Fix #1 (Path A SSE wiring)", () => {
  it("dispatches message_arrived event after firing engineerPulse", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 60,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 60,
      },
    });
    rig.setNow(new Date(mission.createdAt).getTime() + MS(120));
    const result = await rig.sweeper.tick();
    expect(result.fired).toBe(1);

    // mission-60 Gap #1 closure verification: PulseSweeper now fires
    // the same `message_arrived` event the MCP-tool boundary fires
    // (Path A symmetry per `message-policy.ts:208-221`).
    expect(rig.dispatched.length).toBe(1);
    const dispatched = rig.dispatched[0];
    expect(dispatched.event).toBe("message_arrived");
    expect(dispatched.selector).toEqual({ roles: ["engineer"] });
    const message = (dispatched.data as { message: Message }).message;
    expect(message.kind).toBe("external-injection");
    expect((message.payload as { pulseKind?: string }).pulseKind).toBe("status_check");
  });

  it("dispatches message_arrived event for architect-routed escalation", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 60,
        message: "status?",
        responseShape: "ack",
        missedThreshold: 1, // Threshold = 1 → first miss escalates immediately
        firstFireDelaySeconds: 60,
      },
    });
    // Tick 1: fire pulse #1 (cadence-due at +60s)
    rig.setNow(new Date(mission.createdAt).getTime() + MS(120));
    await rig.sweeper.tick();
    rig.dispatched.length = 0; // clear; only assert on tick-2 dispatches
    // Tick 2: pulse #1 unacked past grace window → missedCount=1 = threshold → escalate
    rig.setNow(rig.getNowMs() + MS(120));
    const result = await rig.sweeper.tick();
    expect(result.escalated).toBe(1);

    // mission-60 bonus surface 1 closure: escalation Messages also flow
    // through Path A SSE wiring (architect-routed).
    expect(rig.dispatched.length).toBe(1);
    const dispatched = rig.dispatched[0];
    expect(dispatched.event).toBe("message_arrived");
    expect(dispatched.selector).toEqual({ roles: ["architect"] });
    const message = (dispatched.data as { message: Message }).message;
    expect((message.payload as { pulseKind?: string }).pulseKind).toBe(
      "missed_threshold_escalation",
    );
  });
});

describe("PulseSweeper — Mission-61 W1 Fix #2 (forceFire admin path)", () => {
  it("forceFire bypasses cadence + firstFireDelay; fires immediately (mission-68: precondition gate gone)", async () => {
    const rig = buildSweeperRig();
    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 600, // Long cadence — ordinary tick would NOT fire
        message: "status?",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 600,
        // Mission-68 W1: precondition field removed; cadence + firstFireDelay
        // are the only natural-tick gates remaining.
      },
    });
    // Set now within the firstFireDelay window — natural tick should
    // skip (cadence + firstFireDelay block fire)
    rig.setNow(new Date(mission.createdAt).getTime() + MS(60));
    const tickResult = await rig.sweeper.tick();
    expect(tickResult.fired).toBe(0);
    expect(rig.dispatched.length).toBe(0);

    // Now force-fire from "architect" — bypass cadence/firstFireDelay
    const fireAt = await rig.sweeper.forceFire(mission.id, "engineerPulse");
    expect(fireAt).toBeTruthy();

    // Bookkeeping advanced
    const fresh = await rig.missionStore.getMission(mission.id);
    expect(fresh?.pulses?.engineerPulse?.lastFiredAt).toBe(fireAt);

    // SSE dispatch fired (Path A wiring)
    expect(rig.dispatched.length).toBe(1);
    expect(rig.dispatched[0].event).toBe("message_arrived");
    expect(rig.dispatched[0].selector).toEqual({ roles: ["engineer"] });
  });

  it("forceFire throws on missing mission OR missing pulse config", async () => {
    const rig = buildSweeperRig();
    await expect(rig.sweeper.forceFire("mission-nonexistent", "engineerPulse")).rejects.toThrow(
      /mission-nonexistent not found/,
    );

    const mission = await createPulseMission(rig, {
      engineerPulse: {
        intervalSeconds: 60,
        message: "x",
        responseShape: "ack",
        missedThreshold: 3,
        firstFireDelaySeconds: 60,
      },
    });
    // Mission has engineerPulse but not architectPulse
    await expect(rig.sweeper.forceFire(mission.id, "architectPulse")).rejects.toThrow(
      /no architectPulse configured/,
    );
  });
});
