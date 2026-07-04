import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "..", "..");

const readJson = <T = any>(path: string): T => JSON.parse(readFileSync(resolve(root, path), "utf-8"));
const readText = (path: string): string => readFileSync(resolve(root, path), "utf-8");
const readRepoText = (path: string): string => readFileSync(resolve(repoRoot, path), "utf-8");

function run(cmd: string, args: string[], cwd = root): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf-8",
  });
}

describe("opencode-plugin package integrity", () => {
  it("package metadata declares the graph-published npm artifact and loader-safe entry surface", () => {
    const pkg = readJson("package.json");

    expect(pkg.name).toBe("@apnex/opencode-plugin");
    expect(pkg.main).toBe("dist/plugin-entry.js");
    expect(pkg.types).toBe("dist/plugin-entry.d.ts");
    expect(pkg.exports["."]).toEqual({
      types: "./dist/plugin-entry.d.ts",
      import: "./dist/plugin-entry.js",
    });
    expect(pkg.exports["./shim"]).toEqual({
      types: "./dist/shim.d.ts",
      import: "./dist/shim.js",
    });
    expect(pkg.exports["./runtime"]).toEqual({
      types: "./dist/runtime.d.ts",
      import: "./dist/runtime.js",
    });
    expect(pkg.exports["./package.json"]).toBe("./package.json");

    expect(pkg.files).toEqual([
      "dist/",
      "src/",
      "tsconfig.json",
      "QUICKSTART.md",
      "CHANGELOG.md",
      "AGENTS.md",
    ]);
    expect(pkg.files).not.toContain("test/");
    expect(pkg.scripts.prebuild).toBe("node ../../scripts/build/write-build-info.js");
    expect(pkg.scripts.prepack).toBe("node ../../scripts/build/write-build-info.js --assert");
    expect(pkg.scripts.start).toBe("node dist/plugin-entry.js");
    expect(pkg.keywords).toEqual(expect.arrayContaining(["opencode-plugin", "opencode", "mcp"]));
  });

  it("dependency graph, lockfile, and publish-family wiring stay facade-clean", () => {
    const pkg = readJson("package.json");
    expect(pkg.dependencies).toEqual({
      "@modelcontextprotocol/sdk": "1.29.0",
      "@apnex/network-adapter": "*",
    });
    expect(pkg.dependencies["@apnex/cognitive-layer"]).toBeUndefined();
    expect(pkg.dependencies["@apnex/message-router"]).toBeUndefined();

    const lock = JSON.parse(readRepoText("package-lock.json"));
    const lockDeps = lock.packages?.["adapters/opencode-plugin"]?.dependencies ?? {};
    expect(lockDeps).toEqual({
      "@apnex/network-adapter": "*",
      "@modelcontextprotocol/sdk": "1.29.0",
    });

    const publishScript = readRepoText("scripts/publish-packages.sh");
    expect(publishScript).toMatch(/"@apnex\/claude-plugin"[\s\S]*"@apnex\/opencode-plugin"[\s\S]*"@apnex\/pi-plugin"/);

    const publishWorkflow = readRepoText(".github/workflows/publish-npm.yml");
    expect(publishWorkflow).toContain("--workspace=@apnex/opencode-plugin");
    expect(publishWorkflow).toContain("( cd adapters/opencode-plugin && npm run build )");

    const networkAdapterVersion = JSON.parse(
      readRepoText("packages/network-adapter/package.json"),
    ).version;
    const rewriteCheck = run("node", ["scripts/version-rewrite.js", "--check"], repoRoot);
    expect(rewriteCheck).toContain("@apnex/opencode-plugin:");
    expect(rewriteCheck).toContain(`dependencies.@apnex/network-adapter: * → ^${networkAdapterVersion}`);
  });

  it("install docs and changelog state npm target, migration bridge, and no-publish boundary", () => {
    const quickstart = readText("QUICKSTART.md");
    expect(quickstart).toContain("npm:@apnex/opencode-plugin");
    expect(quickstart).toContain("github:apnex/opencode-hub-plugin");
    expect(quickstart).toContain("adapters/opencode-plugin/src/shim.ts");
    expect(quickstart).toContain("Legacy compatibility bridge");
    expect(quickstart).toContain("npm pack --workspace=@apnex/opencode-plugin --dry-run --ignore-scripts --json");
    expect(quickstart).toContain("The npm channel is only valid after the release node publishes");
    expect(quickstart).toContain("proxyName: @apnex/opencode-plugin");

    const changelog = readText("CHANGELOG.md");
    expect(changelog).toContain("npm graph-publish shape prepared");
    expect(changelog).toContain("first-class `@apnex/*` npm-family member");
    expect(changelog).toContain("W6 does **not** publish a release");
  });

  it("npm pack dry-run carries the graph artifact contents and excludes tests", { timeout: 120_000 }, () => {
    rmSync(resolve(root, "dist"), { recursive: true, force: true });
    run("npm", ["run", "build"]);

    const packJson = run("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"]);
    const packed = JSON.parse(packJson)[0] as {
      filename: string;
      name: string;
      version: string;
      files: Array<{ path: string }>;
    };
    const files = packed.files.map((f) => f.path).sort();

    expect(packed.name).toBe("@apnex/opencode-plugin");
    expect(packed.filename).toBe(`apnex-opencode-plugin-${packed.version}.tgz`);
    expect(files).toEqual(expect.arrayContaining([
      "package.json",
      "dist/build-info.json",
      "dist/plugin-entry.js",
      "dist/plugin-entry.d.ts",
      "dist/runtime.js",
      "dist/runtime.d.ts",
      "dist/shim.js",
      "dist/shim.d.ts",
      "src/plugin-entry.ts",
      "src/runtime.ts",
      "src/shim.ts",
      "QUICKSTART.md",
      "CHANGELOG.md",
      "AGENTS.md",
      "tsconfig.json",
    ]));
    expect(files.some((f) => f.startsWith("test/") || f.includes("node_modules"))).toBe(false);

    const pluginEntry = readText("dist/plugin-entry.js");
    const pluginEntryExports = [...pluginEntry.matchAll(/^export\s+[^;]+;/gm)].map((m) => m[0]).join("\n");
    expect(pluginEntryExports).toBe('export { HubPlugin } from "./shim.js";');
    expect(pluginEntryExports).not.toMatch(/_testOnly|makeOpenCodeFetchHandler|createOpenCodeRuntime/);

    const buildInfo = readJson("dist/build-info.json");
    expect(buildInfo.commitSha).toMatch(/^[0-9a-f]{7}|unknown$/);
    expect(typeof buildInfo.dirty).toBe("boolean");
    expect(typeof buildInfo.buildTime).toBe("string");
    expect(typeof buildInfo.branch).toBe("string");
  });

});
