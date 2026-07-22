import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = resolve(root, "src");
const ALLOWED_APNEX_IMPORTS = new Set(["@apnex/network-adapter"]);

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

describe("claude-plugin facade boundary", () => {
  it("src imports only the @apnex/network-adapter facade from the @apnex graph", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(srcRoot)) {
      const source = readFileSync(file, "utf-8");
      for (const match of source.matchAll(/\b(?:import|export)\b[^;]*?from\s+["']([^"']+)["']/gs)) {
        const spec = match[1];
        if (spec.startsWith("@apnex/") && !ALLOWED_APNEX_IMPORTS.has(spec)) {
          offenders.push(`${file.replace(`${root}/`, "")}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("package.json has no consumer runtime dependency edge", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
