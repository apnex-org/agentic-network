/**
 * hcap-import-boundary.test.ts — KF3 STATIC import-boundary guard (seam-arch §1/§6, A3 Air-Gap).
 *
 * The load-bearing structural invariant: exactly ONE unit (U5 PiToolActuatorPort)
 * may cross the pi ExtensionAPI air-gap. U1-U4, U6, the facade, and contracts are
 * pi-NEUTRAL — they must not import the pi SDK NOR `tool-bridge` (which imports pi).
 * A source-text assertion, so a future edit that leaks `ExtensionAPI` into a neutral
 * unit fails CI, not review. (Slice-2 extraction relies on this: the neutral set is
 * a verbatim file-move, only U5 is re-authored per host.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const UNITS = resolve(HERE, "..", "src", "hcap", "tools");
const read = (file: string): string => readFileSync(resolve(UNITS, file), "utf8");

const PI_SDK = "@earendil-works/pi-coding-agent";
const TOOL_BRIDGE = "tool-bridge";

const NEUTRAL = [
  "contracts.ts",
  "spec-store.ts",
  "diff-engine.ts",
  "convergence-actuator.ts",
  "reconcile-loop.ts",
  "hub-spec-source.ts",
  "tool-control-plane.ts",
];

/** Only lines that actually import (ignore prose in the doc-comment banners). */
const importLines = (src: string): string =>
  src
    .split("\n")
    .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
    .join("\n");

describe("KF3 — HCAP pi-air-gap import boundary", () => {
  for (const file of NEUTRAL) {
    it(`${file} imports NEITHER the pi SDK nor tool-bridge (neutral)`, () => {
      const imports = importLines(read(file));
      expect(imports).not.toContain(PI_SDK);
      expect(imports).not.toContain(TOOL_BRIDGE);
    });
  }

  it("pi-tool-actuator-port.ts IS the sole crossing (imports the pi SDK)", () => {
    const imports = importLines(read("pi-tool-actuator-port.ts"));
    expect(imports).toContain(PI_SDK);
  });
});
