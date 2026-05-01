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
import { MemoryStorageProvider } from "@apnex/storage-provider";
import { MissionRepository } from "../../src/entities/mission-repository.js";
import { MessageRepository } from "../../src/entities/message-repository.js";
import { TaskRepository } from "../../src/entities/task-repository.js";
import { IdeaRepository } from "../../src/entities/idea-repository.js";
import { StorageBackedCounter } from "../../src/entities/counter.js";
import { PulseSweeper, pulseSelector } from "../../src/policy/pulse-sweeper.js";
import { createMetricsCounter } from "../../src/observability/metrics.js";
import type { IPolicyContext } from "../../src/policy/types.js";
import type { Mission, Message, MissionPulses } from "../../src/entities/index.js";

const MS = (s: number) => s * 1000;

function buildSweeperRig() {
  const storage = new MemoryStorageProvider();
  const counter = new StorageBackedCounter(storage);
  const taskStore = new TaskRepository(storage, counter);
  const ideaStore = new IdeaRepository(storage, counter);
  const missionStore = new MissionRepository(storage, counter, taskStore, ideaStore);
  const messageStore = new MessageRepository(storage);
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
          task: taskStore,
          idea: ideaStore,
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
        config: { storageBackend: "memory", gcsBucket: "" },
      } as unknown as IPolicyContext),
    },
    { graceMs: 30_000, now: () => nowMs, intervalMs: 60_000 },
  );
  return { sweeper, missionStore, messageStore, taskStore, ideaStore, advance, setNow, getNowMs: () => nowMs, dispatched };
}

async function createPulseMission(
  rig: ReturnType<typeof buildSweeperRig>,
  pulses: MissionPulses,
): Promise<Mission> {
  const created = await rig.missionStore.createMission(
    "Pulse Mission",
    "test",
    undefined,
    undefined,
    undefined,
    undefined,
    "coordination-primitive-shipment",
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

  it("paused pulse stops firing after escalation", async () => {
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

    // First fire
    rig.setNow(new Date(mission.createdAt).getTime() + MS(61));
    await rig.sweeper.tick();

    // Advance past grace → missed (count=1) → threshold breached → escalate + pause
    rig.setNow(new Date(mission.createdAt).getTime() + MS(61) + MS(60) + 31_000);
    let result = await rig.sweeper.tick();
    expect(result.escalated).toBe(1);

    // Subsequent ticks: no further fires (pulse paused)
    rig.setNow(new Date(mission.createdAt).getTime() + MS(1200));
    result = await rig.sweeper.tick();
    expect(result.fired).toBe(0);
    expect(result.escalated).toBe(0);
    expect(result.skipped).toBe(1); // paused → skip
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
      undefined,
      undefined,
      undefined,
      undefined,
      "coordination-primitive-shipment",
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
      undefined,
      undefined,
      undefined,
      undefined,
      "coordination-primitive-shipment",
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
