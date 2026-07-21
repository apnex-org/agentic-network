import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHarnessManifest } from "@apnex/network-adapter";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T = any>(path: string): T => JSON.parse(readFileSync(resolve(root, path), "utf-8"));

describe("claude-plugin minimal self-contained artifact", () => {
  it("declares the fresh exact package and finite files", () => {
    const pkg = readJson("package.json");
    expect(pkg.name).toBe("@apnex/claude-plugin");
    expect(pkg.version).toBe("0.1.18");
    expect(pkg.main).toBe("dist/shim.js");
    expect(pkg.dependencies).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
    expect(pkg.files).toEqual(["dist/", "agent-adapter.manifest.json", ".claude-plugin/", ".mcp.json", "LICENSE", "THIRD_PARTY_NOTICES.md"]);
    for (const hook of ["preinstall", "install", "postinstall", "prepack"]) expect(pkg.scripts?.[hook]).toBeUndefined();
  });

  it("uses one package/plugin/catalog version and relative native marketplace source", () => {
    const pkg = readJson("package.json");
    const plugin = readJson(".claude-plugin/plugin.json");
    const marketplace = readJson(".claude-plugin/marketplace.json");
    expect(plugin.version).toBe(pkg.version);
    expect(marketplace.plugins[0].version).toBe(pkg.version);
    expect(marketplace.plugins[0].source).toBe("./");
    expect(readJson(".mcp.json").proxy.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/shim.js"]);
  });

  it("keeps the harness manifest aligned", () => {
    const manifest = parseHarnessManifest(readJson("agent-adapter.manifest.json"));
    expect(manifest.harness).toBe("claude");
    expect(manifest.proxyName).toBe("@apnex/claude-plugin");
    expect(manifest.transport).toBe("stdio-mcp-proxy");
  });
});
