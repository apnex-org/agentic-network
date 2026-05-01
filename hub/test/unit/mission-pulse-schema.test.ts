/**
 * Mission-57 W1 + mission-68 W1 — Mission entity pulse-schema extension tests.
 *
 * Pins:
 *   - Mission-68 NEW: create_mission without explicit `pulses` config → unified
 *     10/20/2 defaults auto-injected (per Design v1.0 §5 + §7 NEW-missions-only)
 *   - create_mission accepts new fields; auto-inject defaults applied (mission-68:
 *     missedThreshold default 2, was 3; precondition field REMOVED)
 *   - update_mission accepts new fields; sweeper-managed bookkeeping stripped at MCP boundary
 *   - update_mission preserves on-disk sweeper bookkeeping when caller updates engineer-authored fields only
 *   - update_mission FSM-handler proposed→active auto-inject (mission-68 §7 + §11.1 C3 fold)
 *   - missionClass enum validation
 *   - intervalSeconds floor enforced (60s anti-pattern guard)
 *   - responseShape required (no default)
 */

import { describe, expect, it } from "vitest";
import { PolicyRouter } from "../../src/policy/router.js";
import { registerMissionPolicy } from "../../src/policy/mission-policy.js";
import { createTestContext } from "../../src/policy/test-utils.js";
import {
  DEFAULT_MISSED_THRESHOLD,
  DEFAULT_ENGINEER_PULSE_INTERVAL_SECONDS,
  DEFAULT_ARCHITECT_PULSE_INTERVAL_SECONDS,
  PULSE_INTERVAL_FLOOR_SECONDS,
} from "../../src/entities/index.js";

function setup() {
  const router = new PolicyRouter(() => {});
  registerMissionPolicy(router);
  const ctx = createTestContext();
  return { router, ctx };
}

function parse(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

describe("mission-68 W1 — unified default-injection (Design v1.0 §5 + §7)", () => {
  it("create_mission without explicit pulses auto-injects unified 10/20/2 defaults (NEW per mission-68)", async () => {
    const { router, ctx } = setup();
    const created = await router.handle(
      "create_mission",
      { title: "M", description: "no pulses provided" },
      ctx,
    );
    const out = parse(created) as {
      missionId: string;
      missionClass?: unknown;
      pulses?: { engineerPulse?: Record<string, unknown>; architectPulse?: Record<string, unknown> };
    };
    expect(out.missionId).toMatch(/^mission-/);
    expect(out.missionClass).toBeUndefined();
    expect(out.pulses).toBeDefined();
    // Engineer default: 600s (10min) + missedThreshold=2
    expect(out.pulses!.engineerPulse).toBeDefined();
    expect(out.pulses!.engineerPulse!.intervalSeconds).toBe(DEFAULT_ENGINEER_PULSE_INTERVAL_SECONDS);
    expect(out.pulses!.engineerPulse!.missedThreshold).toBe(DEFAULT_MISSED_THRESHOLD);
    expect(out.pulses!.engineerPulse!.responseShape).toBe("short_status");
    // Architect default: 1200s (20min) + missedThreshold=2
    expect(out.pulses!.architectPulse).toBeDefined();
    expect(out.pulses!.architectPulse!.intervalSeconds).toBe(DEFAULT_ARCHITECT_PULSE_INTERVAL_SECONDS);
    expect(out.pulses!.architectPulse!.missedThreshold).toBe(DEFAULT_MISSED_THRESHOLD);
  });

  it("update_mission with description-only doesn't trigger pulse auto-inject", async () => {
    const { router, ctx } = setup();
    const created = parse(await router.handle(
      "create_mission",
      { title: "M", description: "d" },
      ctx,
    )) as { missionId: string };
    const updated = await router.handle(
      "update_mission",
      { missionId: created.missionId, description: "updated" },
      ctx,
    );
    // create_mission auto-injected defaults; update_mission description-only
    // doesn't change them (FSM-handler injection only fires on proposed→active flip)
    const out = parse(updated) as {
      pulses?: { engineerPulse?: Record<string, unknown> };
    };
    expect(out.pulses?.engineerPulse?.intervalSeconds).toBe(DEFAULT_ENGINEER_PULSE_INTERVAL_SECONDS);
  });
});

describe("mission-57 W1 — missionClass validation", () => {
  it("create_mission accepts valid missionClass", async () => {
    const { router, ctx } = setup();
    const created = await router.handle(
      "create_mission",
      {
        title: "M",
        description: "d",
        missionClass: "coordination-primitive-shipment",
      },
      ctx,
    );
    const out = parse(created) as { missionClass: string };
    expect(out.missionClass).toBe("coordination-primitive-shipment");
  });

  it("create_mission rejects invalid missionClass", async () => {
    const { router, ctx } = setup();
    const created = await router.handle(
      "create_mission",
      {
        title: "M",
        description: "d",
        missionClass: "not-a-real-class",
      },
      ctx,
    );
    expect(created.isError).toBe(true);
    const out = parse(created) as { error: string };
    expect(out.error).toContain("missionClass must be one of");
  });
});

describe("mission-57 W1 + mission-68 W1 — pulses auto-injection (precondition removed)", () => {
  it("auto-injects firstFireDelaySeconds + missedThreshold defaults (precondition no longer in schema per mission-68 §4.2)", async () => {
    const { router, ctx } = setup();
    const created = await router.handle(
      "create_mission",
      {
        title: "M",
        description: "d",
        missionClass: "coordination-primitive-shipment",
        pulses: {
          engineerPulse: {
            intervalSeconds: 1800,
            message: "status?",
            responseShape: "short_status",
            // missedThreshold + firstFireDelaySeconds omitted
          },
        },
      },
      ctx,
    );
    const out = parse(created) as { pulses: { engineerPulse: Record<string, unknown> } };
    const pulse = out.pulses.engineerPulse;
    expect(pulse.firstFireDelaySeconds).toBe(1800);
    expect(pulse.missedThreshold).toBe(DEFAULT_MISSED_THRESHOLD); // 2 post-mission-68
    expect(pulse.precondition).toBeUndefined(); // field removed
  });

  it("preserves explicit overrides (no precondition support)", async () => {
    const { router, ctx } = setup();
    const created = await router.handle(
      "create_mission",
      {
        title: "M",
        description: "d",
        missionClass: "coordination-primitive-shipment",
        pulses: {
          architectPulse: {
            intervalSeconds: 3600,
            message: "status?",
            responseShape: "short_status",
            missedThreshold: 5,
            firstFireDelaySeconds: 600,
          },
        },
      },
      ctx,
    );
    const out = parse(created) as { pulses: { architectPulse: Record<string, unknown> } };
    const pulse = out.pulses.architectPulse;
    expect(pulse.missedThreshold).toBe(5);
    expect(pulse.firstFireDelaySeconds).toBe(600);
  });
});

describe("mission-57 W1 — pulses validation", () => {
  it("rejects intervalSeconds below floor", async () => {
    const { router, ctx } = setup();
    const created = await router.handle(
      "create_mission",
      {
        title: "M",
        description: "d",
        missionClass: "spike",
        pulses: {
          engineerPulse: {
            intervalSeconds: 30, // below 60s floor
            message: "status?",
            responseShape: "short_status",
          },
        },
      },
      ctx,
    );
    expect(created.isError).toBe(true);
    const out = parse(created) as { error: string };
    expect(out.error).toContain(`≥ ${PULSE_INTERVAL_FLOOR_SECONDS}s`);
  });

  it("rejects empty message", async () => {
    const { router, ctx } = setup();
    const created = await router.handle(
      "create_mission",
      {
        title: "M",
        description: "d",
        missionClass: "spike",
        pulses: {
          engineerPulse: {
            intervalSeconds: 600,
            message: "",
            responseShape: "ack",
          },
        },
      },
      ctx,
    );
    expect(created.isError).toBe(true);
    const out = parse(created) as { error: string };
    expect(out.error).toContain("message must be a non-empty string");
  });
});

describe("mission-57 W1 — sweeper-managed bookkeeping stripping", () => {
  it("strips lastFiredAt + lastResponseAt + missedCount + lastEscalatedAt at MCP boundary", async () => {
    const { router, ctx } = setup();
    const created = await router.handle(
      "create_mission",
      {
        title: "M",
        description: "d",
        missionClass: "coordination-primitive-shipment",
        pulses: {
          engineerPulse: {
            intervalSeconds: 1800,
            message: "status?",
            responseShape: "short_status",
            // External caller tries to inject sweeper-managed fields:
            lastFiredAt: "2026-04-26T11:00:00Z",
            lastResponseAt: "2026-04-26T11:01:00Z",
            missedCount: 99,
            lastEscalatedAt: "2026-04-26T11:02:00Z",
          },
        },
      },
      ctx,
    );
    const out = parse(created) as { pulses: { engineerPulse: Record<string, unknown> } };
    const pulse = out.pulses.engineerPulse;
    expect(pulse.lastFiredAt).toBeUndefined();
    expect(pulse.lastResponseAt).toBeUndefined();
    expect(pulse.missedCount).toBeUndefined();
    expect(pulse.lastEscalatedAt).toBeUndefined();
  });

  it("update_mission preserves on-disk sweeper bookkeeping when re-asserting engineer-authored fields", async () => {
    const { router, ctx } = setup();
    // Step 1: create mission with pulses
    const created = parse(await router.handle(
      "create_mission",
      {
        title: "M",
        description: "d",
        missionClass: "coordination-primitive-shipment",
        pulses: {
          engineerPulse: {
            intervalSeconds: 1800,
            message: "status?",
            responseShape: "short_status",
          },
        },
      },
      ctx,
    )) as { missionId: string };

    // Step 2: simulate sweeper writing bookkeeping via direct repo update
    // (PulseSweeper's path; bypasses MCP). Mission-68 W1: precondition
    // field no longer in schema.
    await ctx.stores.mission.updateMission(created.missionId, {
      pulses: {
        engineerPulse: {
          intervalSeconds: 1800,
          message: "status?",
          responseShape: "short_status",
          missedThreshold: DEFAULT_MISSED_THRESHOLD,
          firstFireDelaySeconds: 1800,
          lastFiredAt: "2026-04-26T11:00:00Z",
          lastResponseAt: "2026-04-26T11:01:00Z",
          missedCount: 1,
          lastEscalatedAt: null,
        },
      },
    });

    // Step 3: caller updates only engineer-authored field (e.g. message)
    // via MCP tool; sweeper bookkeeping should be preserved
    const updated = parse(await router.handle(
      "update_mission",
      {
        missionId: created.missionId,
        pulses: {
          engineerPulse: {
            intervalSeconds: 1800,
            message: "status updated",  // engineer-authored change
            responseShape: "short_status",
          },
        },
      },
      ctx,
    )) as { pulses: { engineerPulse: Record<string, unknown> } };

    const pulse = updated.pulses.engineerPulse;
    expect(pulse.message).toBe("status updated");           // engineer-authored applied
    expect(pulse.lastFiredAt).toBe("2026-04-26T11:00:00Z"); // bookkeeping preserved
    expect(pulse.lastResponseAt).toBe("2026-04-26T11:01:00Z");
    expect(pulse.missedCount).toBe(1);
  });
});

describe("mission-57 W1 — update_mission persistence", () => {
  it("update_mission can add pulses to a mission that lacked them", async () => {
    const { router, ctx } = setup();
    const created = parse(await router.handle(
      "create_mission",
      { title: "M", description: "d" },
      ctx,
    )) as { missionId: string };

    const updated = await router.handle(
      "update_mission",
      {
        missionId: created.missionId,
        missionClass: "spike",
        pulses: {
          engineerPulse: {
            intervalSeconds: 600,
            message: "status?",
            responseShape: "short_status",
          },
        },
      },
      ctx,
    );
    const out = parse(updated) as {
      missionClass: string;
      pulses: { engineerPulse: Record<string, unknown> };
    };
    expect(out.missionClass).toBe("spike");
    expect(out.pulses.engineerPulse.message).toBe("status?");
  });
});

describe("mission-68 W1 — update_mission FSM-handler proposed→active auto-inject (Design §7 + §11.1 C3 fold)", () => {
  it("proposed→active flip injects unified 10/20/2 defaults when mission has no pulses", async () => {
    const { router, ctx } = setup();
    // Manually create a `proposed` mission with NO pulses (simulates legacy
    // pre-mission-57 mission OR explicit-no-pulses on create_mission via
    // direct repo write). Bypasses createMission auto-inject by writing
    // directly to the store.
    const created = await ctx.stores.mission.createMission(
      "Legacy proposed mission",
      "no pulses",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined, // no pulses
    );
    expect(created.status).toBe("proposed");
    expect(created.pulses).toBeUndefined();

    // Flip to active via update_mission — FSM-handler should auto-inject
    const updated = await router.handle(
      "update_mission",
      { missionId: created.id, status: "active" },
      ctx,
    );
    const out = parse(updated) as {
      pulses?: { engineerPulse?: Record<string, unknown>; architectPulse?: Record<string, unknown> };
    };
    expect(out.pulses).toBeDefined();
    expect(out.pulses!.engineerPulse!.intervalSeconds).toBe(DEFAULT_ENGINEER_PULSE_INTERVAL_SECONDS);
    expect(out.pulses!.engineerPulse!.missedThreshold).toBe(DEFAULT_MISSED_THRESHOLD);
    expect(out.pulses!.architectPulse!.intervalSeconds).toBe(DEFAULT_ARCHITECT_PULSE_INTERVAL_SECONDS);
    expect(out.pulses!.architectPulse!.missedThreshold).toBe(DEFAULT_MISSED_THRESHOLD);
  });

  it("proposed→active flip preserves existing pulses if mission already has them", async () => {
    const { router, ctx } = setup();
    // Mission created via createMission with EXPLICIT pulses (not unified default)
    const created = parse(await router.handle(
      "create_mission",
      {
        title: "M",
        description: "d",
        pulses: {
          engineerPulse: {
            intervalSeconds: 1800, // explicit 30min override
            message: "custom",
            responseShape: "ack",
          },
        },
      },
      ctx,
    )) as { missionId: string };
    // Flip to active; should NOT inject unified defaults (mission already has pulses)
    const updated = await router.handle(
      "update_mission",
      { missionId: created.missionId, status: "active" },
      ctx,
    );
    const out = parse(updated) as {
      pulses?: { engineerPulse?: Record<string, unknown> };
    };
    expect(out.pulses!.engineerPulse!.intervalSeconds).toBe(1800); // preserved
    expect(out.pulses!.engineerPulse!.message).toBe("custom");
  });

  it("proposed→active flip with caller-passed pulses uses caller's pulses (not auto-inject)", async () => {
    const { router, ctx } = setup();
    const created = await ctx.stores.mission.createMission(
      "Legacy",
      "no pulses",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const updated = await router.handle(
      "update_mission",
      {
        missionId: created.id,
        status: "active",
        pulses: {
          engineerPulse: {
            intervalSeconds: 900, // explicit 15min in update payload
            message: "custom",
            responseShape: "ack",
          },
        },
      },
      ctx,
    );
    const out = parse(updated) as {
      pulses?: { engineerPulse?: Record<string, unknown> };
    };
    expect(out.pulses!.engineerPulse!.intervalSeconds).toBe(900);
  });

  it("non-flip status changes (active→completed) do NOT trigger auto-inject", async () => {
    const { router, ctx } = setup();
    const created = parse(await router.handle(
      "create_mission",
      { title: "M", description: "d" }, // gets unified defaults
      ctx,
    )) as { missionId: string };
    // First flip to active
    await router.handle(
      "update_mission",
      { missionId: created.missionId, status: "active" },
      ctx,
    );
    const beforeComplete = (await ctx.stores.mission.getMission(created.missionId))!;
    // Now flip to completed; pulses should be unchanged
    await router.handle(
      "update_mission",
      { missionId: created.missionId, status: "completed" },
      ctx,
    );
    const afterComplete = (await ctx.stores.mission.getMission(created.missionId))!;
    expect(afterComplete.pulses?.engineerPulse?.intervalSeconds).toBe(
      beforeComplete.pulses?.engineerPulse?.intervalSeconds,
    );
  });
});
