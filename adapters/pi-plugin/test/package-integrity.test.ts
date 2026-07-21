import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHarnessManifest } from "@apnex/network-adapter";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = <T = any>(path: string): T => JSON.parse(readFileSync(resolve(root, path), "utf-8"));

describe("pi-plugin minimal self-contained artifact", () => {
  it("declares the fresh exact package and finite files", () => {
    const pkg = readJson("package.json");
    expect(pkg.name).toBe("@apnex/pi-plugin");
    expect(pkg.version).toBe("0.1.9");
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.pi.extensions).toEqual(["dist/index.js"]);
    expect(pkg.bin).toEqual({ "ois-seed-skills": "dist/seed-skills.js" });
    expect(pkg.dependencies).toEqual({});
    expect(pkg.peerDependencies).toEqual({ "@earendil-works/pi-tui": "0.81.1", typebox: "1.1.38" });
    expect(pkg.files).toEqual(["dist/", "agent-adapter.manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md"]);
    for (const hook of ["preinstall", "install", "postinstall", "prepack"]) expect(pkg.scripts?.[hook]).toBeUndefined();
  });

  it("keeps the native harness manifest aligned", () => {
    const manifest = loadHarnessManifest(resolve(root, "agent-adapter.manifest.json"));
    expect(manifest.harness).toBe("pi");
    expect(manifest.proxyName).toBe("@apnex/pi-plugin");
    expect(manifest.transport).toBe("pi-native");
    expect(manifest.toolPrefix).toBe("");
  });
});
