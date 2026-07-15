import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHarnessManifest } from "@apnex/network-adapter";

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

describe("pi-plugin package/install integrity", () => {
  it("package metadata declares the pi npm artifact and loader-safe entry surface", () => {
    const pkg = readJson("package.json");

    expect(pkg.name).toBe("@apnex/pi-plugin");
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.pi.extensions).toEqual(["dist/index.js"]);
    expect(pkg.keywords).toEqual(expect.arrayContaining(["pi-package"]));

    expect(pkg.files).toEqual([
      "dist/",
      "src/",
      "agent-adapter.manifest.json",
      "tsconfig.json",
      "QUICKSTART.md",
    ]);
    expect(pkg.files).not.toContain("test/");
    expect(pkg.scripts.prebuild).toBe("node ../../scripts/build/write-build-info.js");
    expect(pkg.scripts.prepack).toBe("node ../../scripts/build/write-build-info.js --assert");
    expect(pkg.scripts.build).toBe("tsc");
    expect(pkg.scripts.start).toBe("node dist/index.js");
  });

  it("dependency graph and lockfile stay facade-clean for the pi-native adapter", () => {
    const pkg = readJson("package.json");
    expect(pkg.dependencies).toEqual({
      "@apnex/network-adapter": "*",
    });
    expect(pkg.dependencies["@apnex/cognitive-layer"]).toBeUndefined();
    expect(pkg.dependencies["@apnex/message-router"]).toBeUndefined();

    expect(pkg.peerDependencies).toEqual({
      "@earendil-works/pi-coding-agent": "*",
      "@earendil-works/pi-tui": "*",
      typebox: "*",
    });

    const lock = JSON.parse(readRepoText("package-lock.json"));
    const lockDeps = lock.packages?.["adapters/pi-plugin"]?.dependencies ?? {};
    expect(lockDeps).toEqual({
      "@apnex/network-adapter": "*",
    });
    expect(lock.packages?.["adapters/pi-plugin"]?.peerDependencies).toEqual(pkg.peerDependencies);
  });

  it("adapter manifest stays schema-valid and describes the raw-name pi-native binding", () => {
    const manifest = loadHarnessManifest(resolve(root, "agent-adapter.manifest.json"));
    expect(manifest.harness).toBe("pi");
    expect(manifest.proxyName).toBe("@apnex/pi-plugin");
    expect(manifest.transport).toBe("pi-native");
    expect(manifest.serverName).toBe("hub-proxy");
    expect(manifest.toolPrefix).toBe("");
    expect(manifest.injectionChannel).toBe("pi/session");
    expect(manifest.injectionMechanism).toBe("pi-sendUserMessage");
    expect(manifest.envTemplate).toEqual(expect.arrayContaining([
      "OIS_HUB_URL",
      "OIS_HUB_TOKEN",
      "OIS_HUB_ROLE",
      "OIS_HUB_LABELS",
      "OIS_AGENT_NAME",
      "WORK_DIR",
      "HUB_LLM_MODEL",
    ]));
  });

  it("publish family wiring includes pi and rewrites its workspace dependency", () => {
    const publishScript = readRepoText("scripts/publish-packages.sh");
    expect(publishScript).toMatch(/"@apnex\/claude-plugin"[\s\S]*"@apnex\/opencode-plugin"[\s\S]*"@apnex\/pi-plugin"/);

    const publishWorkflow = readRepoText(".github/workflows/publish-npm.yml");
    expect(publishWorkflow).toContain("--workspace=@apnex/pi-plugin");
    expect(publishWorkflow).toContain("( cd adapters/pi-plugin && npm run build )");

    const networkAdapterVersion = JSON.parse(
      readRepoText("packages/network-adapter/package.json"),
    ).version;
    const rewriteCheck = run("node", ["scripts/version-rewrite.js", "--check"], repoRoot);
    expect(rewriteCheck).toContain("@apnex/pi-plugin:");
    expect(rewriteCheck).toContain(`dependencies.@apnex/network-adapter: * → ^${networkAdapterVersion}`);
  });

  it("quickstart and changelog document the npm runtime path and bounded distribution boundary", () => {
    const quickstart = readText("QUICKSTART.md");
    expect(quickstart).toContain("npm:@apnex/pi-plugin");
    expect(quickstart).toContain("agent-adapter.manifest.json");
    expect(quickstart).toContain("OIS_HUB_URL");
    expect(quickstart).toContain("OIS_HUB_TOKEN");

    const changelog = readText("CHANGELOG.md");
    expect(changelog).toContain("0.1.7");
    expect(changelog).toContain("package-integrity");
    expect(changelog).toContain("Full pi npm-distribution convergence remains deferred");
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

    expect(packed.name).toBe("@apnex/pi-plugin");
    expect(packed.filename).toBe(`apnex-pi-plugin-${packed.version}.tgz`);
    expect(files).toEqual(expect.arrayContaining([
      "package.json",
      "dist/build-info.json",
      "dist/footer-install.js",
      "dist/footer.js",
      "dist/index.js",
      "dist/shim.js",
      "dist/tool-bridge.js",
      "dist/wake.js",
      "src/index.ts",
      "src/shim.ts",
      "src/tool-bridge.ts",
      "src/wake.ts",
      "agent-adapter.manifest.json",
      "QUICKSTART.md",
      "tsconfig.json",
    ]));
    expect(files.some((f) => f.startsWith("test/") || f.includes("node_modules"))).toBe(false);

    const buildInfo = readJson("dist/build-info.json");
    expect(buildInfo.commitSha).toMatch(/^[0-9a-f]{7}|unknown$/);
    expect(typeof buildInfo.dirty).toBe("boolean");
    expect(typeof buildInfo.buildTime).toBe("string");
    expect(typeof buildInfo.branch).toBe("string");
  });
});
