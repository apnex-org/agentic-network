/**
 * facade-boundary.test.ts — the pi plugin must consume the @apnex/* graph ONLY
 * through the @apnex/network-adapter facade, never a deep kernel/control-plane
 * path. Mirrors adapters/claude-plugin + adapters/opencode-plugin. pi legitimately
 * pulls MORE symbols from that one facade (native tool-bridge dispatch + the
 * control-plane spec/reconcile core) than claude does — this test reflects pi's
 * real allowed surface: ONE specifier, many symbols.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runToolDispatch,
  SpecStore,
  ReconcileLoop,
  type SessionState,
  type ToolDescriptor,
  type ResourceSpec,
} from "@apnex/network-adapter";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..", "..");
const srcRoot = resolve(root, "src");
const ALLOWED_APNEX_IMPORTS = new Set(["@apnex/network-adapter"]);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("pi-plugin facade boundary", () => {
  it("the network-adapter facade exports every pi runtime primitive needed from the kernel/control-plane", () => {
    // The native tool-binding dispatch authority + the HCAP spec/reconcile core the
    // pi shim wires — all consumable from the facade, no deep import required.
    expect(runToolDispatch).toBeTypeOf("function");
    expect(SpecStore).toBeTypeOf("function"); // class
    expect(ReconcileLoop).toBeTypeOf("function"); // class
    // Compile-time guard: pi's facade TYPE surface must stay consumable too.
    const _sess: SessionState | null = null;
    const _desc: ToolDescriptor | null = null;
    const _spec: ResourceSpec | null = null;
    expect([_sess, _desc, _spec]).toEqual([null, null, null]);
  });

  it("src imports only the @apnex/network-adapter facade from the @apnex graph", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(srcRoot)) {
      const source = readFileSync(file, "utf-8");
      // Match `import ... from "X"` AND `export ... from "X"` — pi's footer.ts has a
      // real `export … from "@earendil-works/pi-tui"` re-export, so the alternation is
      // load-bearing (it must catch a future `export … from "@apnex/<deep>"` backdoor).
      for (const match of source.matchAll(/\b(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/gs)) {
        const spec = match[1];
        if (spec.startsWith("@apnex/") && !ALLOWED_APNEX_IMPORTS.has(spec)) {
          offenders.push(`${file.replace(`${root}/`, "")}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("package + root lockfile depend on @apnex/network-adapter only (no cognitive/message-router backdoor)", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
    const deps = pkg.dependencies ?? {};
    expect(deps["@apnex/network-adapter"]).toBeDefined();
    expect(deps["@apnex/cognitive-layer"]).toBeUndefined();
    expect(deps["@apnex/message-router"]).toBeUndefined();

    const lock = JSON.parse(readFileSync(resolve(repoRoot, "package-lock.json"), "utf-8"));
    const lockDeps = lock.packages?.["adapters/pi-plugin"]?.dependencies ?? {};
    expect(lockDeps["@apnex/network-adapter"]).toBeDefined();
    expect(lockDeps["@apnex/cognitive-layer"]).toBeUndefined();
    expect(lockDeps["@apnex/message-router"]).toBeUndefined();
  });
});
