/**
 * control-plane-import-boundary.test.ts — the AGNOSTICISM guard (hcapskills0
 * build_core). The neutral HCAP consumer core (`src/control-plane/`) must import
 * NOTHING outside itself: no pi SDK, no host adapter types, not even a node builtin.
 * Its only legal edges are relative (`./…`) siblings within control-plane/.
 *
 * This replaces the deleted pi-side hcap-import-boundary guard with the inverse,
 * stronger one: the pi test proved pi-isms stayed BELOW the port; this proves the
 * neutral core stays FREE of them. Resource-genericity is true at this commit
 * (control-plane-reconcile.test.ts proves the behavior); THIS test keeps a future
 * edit from quietly re-coupling the core to a host — the coupling would fail here
 * before it could rot the P4 boundary.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const coreDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "control-plane");

/** Every `from "…"` / `import "…"` specifier in a source file. */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /\b(?:from|import)\s*(?:type\s*)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push(m[1]);
  return out;
}

describe("control-plane import boundary — the neutral core imports nothing external", () => {
  const files = readdirSync(coreDir).filter((f) => f.endsWith(".ts"));

  it("has source files to guard", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} imports only relative control-plane siblings (no host/pi/node)`, () => {
      const specs = importSpecifiers(readFileSync(join(coreDir, file), "utf8"));
      const external = specs.filter((s) => !s.startsWith("./") && !s.startsWith("../"));
      expect(external).toEqual([]);
    });
  }
});
