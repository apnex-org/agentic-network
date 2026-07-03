import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CognitivePipeline,
  NotificationCoalescer,
  type CoalescedNotification,
} from "@apnex/network-adapter";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..", "..");
const srcRoot = resolve(root, "src");
const FORBIDDEN = ["@apnex/cognitive-layer", "@apnex/message-router"];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...tsFiles(path));
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("opencode-plugin facade boundary", () => {
  it("network-adapter facade exports every OpenCode runtime primitive needed from cognitive/message-router", () => {
    expect(CognitivePipeline).toBeTypeOf("function");
    expect(NotificationCoalescer).toBeTypeOf("function");
    // Compile-time guard: CoalescedNotification must be consumable from the facade.
    const _typeOnly: CoalescedNotification | null = null;
    expect(_typeOnly).toBeNull();
  });

  it("src imports only the @apnex/network-adapter facade from the @apnex graph", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(srcRoot)) {
      const source = readFileSync(file, "utf-8");
      for (const match of source.matchAll(/\b(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/gs)) {
        const spec = match[1];
        if (FORBIDDEN.includes(spec)) offenders.push(`${file.replace(`${root}/`, "")}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("package and root lockfile depend on @apnex/network-adapter only (no cognitive/message-router backdoor)", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
    const deps = pkg.dependencies ?? {};
    expect(deps["@apnex/network-adapter"]).toBeDefined();
    expect(deps["@apnex/cognitive-layer"]).toBeUndefined();
    expect(deps["@apnex/message-router"]).toBeUndefined();

    const lock = JSON.parse(readFileSync(resolve(repoRoot, "package-lock.json"), "utf-8"));
    const lockDeps = lock.packages?.["adapters/opencode-plugin"]?.dependencies ?? {};
    expect(lockDeps["@apnex/network-adapter"]).toBeDefined();
    expect(lockDeps["@apnex/cognitive-layer"]).toBeUndefined();
    expect(lockDeps["@apnex/message-router"]).toBeUndefined();
  });
});
