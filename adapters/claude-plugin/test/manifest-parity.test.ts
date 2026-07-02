import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHarnessManifest, serverCapabilitiesFromManifest } from "@apnex/network-adapter";

/**
 * PARITY (M-Adapter-Modernization P1b): the claude agent-adapter.manifest.json
 * values MUST equal the prior hardcoded shim literals — proving the extraction is
 * behavior-preserving (the whole risk in a config-extraction refactor). Paired with
 * the kernel's non-vacuous schema validation, this closes test-theater on both ends.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = parseHarnessManifest(
  JSON.parse(readFileSync(resolve(root, "agent-adapter.manifest.json"), "utf-8")),
);

describe("claude agent-adapter.manifest.json — parity with the prior hardcoded shim config", () => {
  it("validates against the versioned schema", () => {
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.harness).toBe("claude");
  });

  // The four literals the shim used to hardcode (shim.ts handshake + dispatcher + toolPrefix):
  it("proxyName == prior hardcoded handshake.proxyName", () => {
    expect(manifest.proxyName).toBe("@apnex/claude-plugin");
  });
  it("transport == prior hardcoded handshake.transport", () => {
    expect(manifest.transport).toBe("stdio-mcp-proxy");
  });
  it("serverName == prior hardcoded dispatcher.serverName", () => {
    expect(manifest.serverName).toBe("proxy");
  });
  it("toolPrefix == prior hardcoded buildPromptText toolPrefix", () => {
    expect(manifest.toolPrefix).toBe("mcp__plugin_agent-adapter_proxy__");
  });
  it("serverCapabilities deep-equal the prior hardcoded dispatcher.serverCapabilities", () => {
    expect(serverCapabilitiesFromManifest(manifest)).toEqual({
      tools: {},
      experimental: { "claude/channel": {} },
    });
  });

  it("carries the 3-valued capability cells (consumption-ack=partial [P1d], tools-list-changed=no [bug-203], coalescer=no)", () => {
    expect(manifest.capabilityMatrix["consumption-ack"].value).toBe("partial");
    expect(manifest.capabilityMatrix["tools-list-changed-honored"].value).toBe("no");
    expect(manifest.capabilityMatrix["notification-coalescer"].value).toBe("no");
    // every cell carries a non-empty REASON (the per-capability unevenness rationale)
    for (const cell of Object.values(manifest.capabilityMatrix)) {
      expect(cell.reason.length).toBeGreaterThan(0);
    }
  });

  it("envTemplate carries only var NAMES, never values — the secret-contract is STRUCTURAL (no raw secret possible)", () => {
    for (const v of manifest.envTemplate) {
      expect(v, `${v} must be an ENV var NAME (UPPER_SNAKE), not a value`).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
    expect(manifest.envTemplate).toContain("OIS_HUB_TOKEN"); // the token's NAME is here; its VALUE is not
  });
});
