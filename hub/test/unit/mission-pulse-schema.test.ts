/**
 * Mission-57 W1 — Mission entity pulse-schema extension tests.
 *
 * Pins:
 *   - Schema additive: missions without pulses + missionClass parse unchanged (backward-compat)
 *   - create_mission accepts new fields; auto-inject defaults applied
 *   - update_mission accepts new fields; sweeper-managed bookkeeping stripped at MCP boundary
 *   - update_mission preserves on-disk sweeper bookkeeping when caller updates engineer-authored fields only
 *   - precondition: null explicitly disables auto-inject (engineer opt-out)
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

describe("mission-57 W1 — schema backward-compat", () => {
  it("create_mission without missionClass + pulses parses unchanged", async () => {
    const { router, ctx } = setup();
    const created = await router.handle(
      "create_mission",
      { title: "Backward-compat mission", description: "no pulses" },
      ctx,
    );
    const out = parse(created) as { missionId: string; missionClass?: unknown; pulses?: unknown };
    expect(out.missionId).toMatch(/^mission-/);
    expect(out.missionClass).toBeUndefined();
    expect(out.pulses).toBeUndefined();
  });

  it("update_mission without missionClass + pulses preserves backward-compat", async () => {
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
    const out = parse(updated) as { missionClass?: unknown; pulses?: unknown };
    expect(out.missionClass).toBeUndefined();
    expect(out.pulses).toBeUndefined();
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

describe("mission-57 W1 — pulses auto-injection", () => {
  it("auto-injects firstFireDelaySeconds + missedThreshold + precondition defaults", async () => {
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
            // missedThreshold + precondition + firstFireDelaySeconds omitted
          },
        },
      },
      ctx,
    );
    const out = parse(created) as { pulses: { engineerPulse: Record<string, unknown> } };
    const pulse = out.pulses.engineerPulse;
    expect(pulse.firstFireDelaySeconds).toBe(1800);
    expect(pulse.missedThreshold).toBe(DEFAULT_MISSED_THRESHOLD);
    expect(pulse.precondition).toEqual({
      fn: "mission_idle_for_at_least",
      args: { seconds: 1800 },
    });
  });

  it("preserves explicit overrides", async () => {
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
            precondition: { fn: "thread-still-active", args: { threadId: "thread-X" } },
          },
        },
      },
      ctx,
    );
    const out = parse(created) as { pulses: { architectPulse: Record<string, unknown> } };
    const pulse = out.pulses.architectPulse;
    expect(pulse.missedThreshold).toBe(5);
    expect(pulse.firstFireDelaySeconds).toBe(600);
    expect(pulse.precondition).toEqual({
      fn: "thread-still-active",
      args: { threadId: "thread-X" },
    });
  });

  it("explicit precondition: null disables auto-inject", async () => {
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
            message: "status?",
            responseShape: "ack",
            precondition: null,
          },
        },
      },
      ctx,
    );
    const out = parse(created) as { pulses: { engineerPulse: Record<string, unknown> } };
    const pulse = out.pulses.engineerPulse;
    expect(pulse.precondition).toBeNull();
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
    // (PulseSweeper's path; bypasses MCP)
    await ctx.stores.mission.updateMission(created.missionId, {
      pulses: {
        engineerPulse: {
          intervalSeconds: 1800,
          message: "status?",
          responseShape: "short_status",
          missedThreshold: DEFAULT_MISSED_THRESHOLD,
          precondition: { fn: "mission_idle_for_at_least", args: { seconds: 1800 } },
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
