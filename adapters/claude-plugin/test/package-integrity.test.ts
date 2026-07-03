import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHarnessManifest } from "@apnex/network-adapter";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T = any>(path: string): T => JSON.parse(readFileSync(resolve(root, path), "utf-8"));
const readText = (path: string): string => readFileSync(resolve(root, path), "utf-8");

describe("claude-plugin package/install integrity", () => {
  it("package files whitelist carries every no-clone install artifact", () => {
    const pkg = readJson("package.json");
    expect(pkg.files).toEqual(expect.arrayContaining([
      "dist/",
      "agent-adapter.manifest.json",
      ".claude-plugin/",
      ".mcp.json",
      "install.sh",
      "QUICKSTART.md",
      "lib/",
      "skills/",
      "apnex-*.tgz",
    ]));
    expect(pkg.main).toBe("dist/shim.js");
    expect(pkg.scripts.prebuild).toBe("node ../../scripts/build/write-build-info.js");
    expect(pkg.scripts.prepack).toBe("node ../../scripts/build/write-build-info.js --assert");
  });

  it("package dependencies honor the Claude facade boundary", () => {
    const deps = readJson("package.json").dependencies;
    expect(deps["@modelcontextprotocol/sdk"]).toBe("1.29.0");
    expect(deps["@apnex/network-adapter"]).toBe("*");
    expect(deps["@apnex/cognitive-layer"]).toBeUndefined();
    expect(deps["@apnex/message-router"]).toBeUndefined();
  });

  it("MCP declaration points Claude at the packaged shim dist entry", () => {
    const mcp = readJson(".mcp.json");
    expect(mcp.mcpServers.proxy.command).toBe("node");
    expect(mcp.mcpServers.proxy.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/shim.js"]);
  });

  it("Claude plugin marketplace manifests are present and self-consistent", () => {
    const plugin = readJson(".claude-plugin/plugin.json");
    const marketplace = readJson(".claude-plugin/marketplace.json");
    expect(plugin.name).toBe("agent-adapter");
    expect(plugin.description).toMatch(/Universal agent adapter/i);
    expect(marketplace.name).toBe("agentic-network");
    expect(marketplace.plugins).toContainEqual(expect.objectContaining({
      name: "agent-adapter",
      source: "./",
    }));
  });

  it("adapter manifest stays schema-valid and matches the MCP declaration", () => {
    const manifest = parseHarnessManifest(readJson("agent-adapter.manifest.json"));
    expect(manifest.harness).toBe("claude");
    expect(manifest.proxyName).toBe("@apnex/claude-plugin");
    expect(manifest.transport).toBe("stdio-mcp-proxy");
    expect(manifest.serverName).toBe("proxy");
    expect(manifest.toolPrefix).toBe("mcp__plugin_agent-adapter_proxy__");
    expect(manifest.envTemplate).toContain("OIS_HUB_TOKEN");
  });

  it("install.sh covers both source-tree and npm-installed no-clone paths", () => {
    const install = readText("install.sh");
    expect(install).toContain("detect_context()");
    expect(install).toContain("source-tree");
    expect(install).toContain("npm-installed");
    expect(install).toContain("npm-installed context but no dist/ found");
    expect(install).toContain("npm install --no-audit --no-fund --no-save");
    expect(install).toContain("Clearing stale cache");
    expect(install).toContain("claude plugin marketplace add");
    expect(install).toContain("claude plugin install");
    expect(install).toContain("bootstrap_skills");
  });

  it("quickstart documents the no-clone tarball install and build-identity check", () => {
    const quickstart = readText("QUICKSTART.md");
    expect(quickstart).toContain("gh release download <TAG>");
    expect(quickstart).toContain("bash package/install.sh");
    expect(quickstart).toContain("dist/build-info.json");
    expect(quickstart).toContain("Tarball install fails to resolve `@apnex/...`");
  });
});
