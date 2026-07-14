import { describe, it, expect } from "vitest";
import { parseHarnessManifest, serverCapabilitiesFromManifest } from "../../src/kernel/harness-manifest.js";

/**
 * Harness-manifest schema validation (M-Adapter-Modernization P1b). NON-VACUOUS:
 * each bad field must throw (closes the test-theater trap on the validation end).
 */
const valid = {
  manifestVersion: 1,
  harness: "claude",
  proxyName: "@apnex/x",
  transport: "stdio-mcp-proxy",
  serverName: "proxy",
  toolPrefix: "mcp__x__",
  injectionChannel: "claude/channel",
  injectionMechanism: "mcp-server-notification",
  capabilityMatrix: { "consumption-ack": { value: "partial", reason: "r" } },
  authOrder: ["env"],
  envTemplate: ["OIS_HUB_URL"],
};

describe("harness-manifest schema validation (fail-closed, non-vacuous)", () => {
  it("accepts a valid manifest + round-trips the fields", () => {
    const m = parseHarnessManifest(valid);
    expect(m.proxyName).toBe("@apnex/x");
    expect(m.capabilityMatrix["consumption-ack"].value).toBe("partial");
  });

  it("rejects a non-object / wrong manifestVersion", () => {
    expect(() => parseHarnessManifest(null)).toThrow();
    expect(() => parseHarnessManifest({ ...valid, manifestVersion: 2 })).toThrow(/manifestVersion/);
  });

  it("rejects a missing OR empty required string field (each one; toolPrefix is exempt — see below)", () => {
    // toolPrefix is EXCLUDED: bug-266 relaxed it to allow "" (raw registration). Its own case below.
    for (const k of ["harness", "proxyName", "transport", "serverName", "injectionChannel", "injectionMechanism"]) {
      expect(() => parseHarnessManifest({ ...valid, [k]: "" }), `empty ${k}`).toThrow(new RegExp(k));
      const without: Record<string, unknown> = { ...valid };
      delete without[k];
      expect(() => parseHarnessManifest(without), `missing ${k}`).toThrow(new RegExp(k));
    }
  });

  it("ACCEPTS an empty toolPrefix (bug-266: a raw-registration harness like pi carries \"\") — still required + typed", () => {
    // Empty is now a MEANINGFUL value (raw tool names in wake prompts) — must NOT throw.
    const m = parseHarnessManifest({ ...valid, toolPrefix: "" });
    expect(m.toolPrefix).toBe("");
    // ...but the field is STILL required (missing or non-string throws).
    const without: Record<string, unknown> = { ...valid };
    delete without.toolPrefix;
    expect(() => parseHarnessManifest(without), "missing toolPrefix").toThrow(/toolPrefix/);
    expect(() => parseHarnessManifest({ ...valid, toolPrefix: 5 }), "non-string toolPrefix").toThrow(/toolPrefix/);
  });

  it("rejects a capability cell with an invalid 3-valued value", () => {
    expect(() => parseHarnessManifest({ ...valid, capabilityMatrix: { x: { value: "maybe", reason: "r" } } })).toThrow(/yes\|partial\|no/);
  });

  it("rejects a capability cell with a missing reason (the unevenness rationale is MANDATORY)", () => {
    expect(() => parseHarnessManifest({ ...valid, capabilityMatrix: { x: { value: "no" } } })).toThrow(/reason/);
  });

  it("rejects a non-array authOrder / envTemplate", () => {
    expect(() => parseHarnessManifest({ ...valid, authOrder: "env" })).toThrow(/authOrder/);
    expect(() => parseHarnessManifest({ ...valid, envTemplate: [1, 2] })).toThrow(/envTemplate/);
  });

  it("builds serverCapabilities from the injectionChannel", () => {
    expect(serverCapabilitiesFromManifest(parseHarnessManifest(valid))).toEqual({
      tools: {},
      experimental: { "claude/channel": {} },
    });
  });
});
