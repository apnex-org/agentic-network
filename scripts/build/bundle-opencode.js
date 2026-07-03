#!/usr/bin/env node
/**
 * scripts/build/bundle-opencode.js — OpenCode self-contained compatibility bundle builder.
 *
 * Mission-101 W6 makes graph-published npm the canonical distribution target;
 * this builder is retained for the legacy GitHub/source-bundle bridge.
 * idea-355 SLICE-3 (fork 3, single-sha): the legacy OpenCode bundle ships as ONE
 * esbuild bundle — the `@apnex/*` kernel is inlined FROM SOURCE, so there is
 * no node_modules and no adjacent dist/build-info.json at runtime (unlike the
 * claude shim, which reads its build-info off disk). So build-identity must be
 * INLINED into the bundle at build time, NOT read from disk at runtime.
 *
 * Mechanism: stamp dist/build-info.json (the bundle's git sha — stamp-only, no
 * --assert; the version-bump gate runs on the release/ship path), then esbuild
 * with the build-info injected via `define: { __OPENCODE_BUILD_INFO__: ... }`.
 * shim.ts reads that global behind a typeof-guard, falling back to
 * UNKNOWN_BUILD_INFO on the dev/test (tsx/vitest) paths where the define is
 * absent. Because it is ONE build, the SAME sha/dirty stamps both the shim
 * (PROXY) and the kernel (SDK) build-identity.
 *
 * Invoked via `npm run bundle` (cwd = the opencode-plugin package dir, set by
 * npm). Mirrors the prior inline esbuild CLI flags exactly (entry / aliases /
 * externals), plus the build-info define.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkgDir = process.cwd(); // npm sets cwd = the workspace package dir
const scriptDir = dirname(fileURLToPath(import.meta.url));
const writeBuildInfo = resolve(scriptDir, "write-build-info.js");

// 1. Stamp dist/build-info.json (bundle git sha). Stamp-only — the --assert
//    version-bump gate is a separate ship-path step (release-opencode-plugin.sh).
execSync(`node ${JSON.stringify(writeBuildInfo)}`, {
  cwd: pkgDir,
  stdio: ["ignore", "ignore", "inherit"],
});

// 2. Read it back to inline into the bundle (NO runtime file read).
const buildInfo = JSON.parse(readFileSync(resolve(pkgDir, "dist", "build-info.json"), "utf-8"));

// 2b. idea-355 SLICE-3 follow-up (bug-183 opencode close): inline the REAL
//     kernel version (@apnex/network-adapter) at build time. In the
//     self-contained bundle the kernel is inlined FROM SOURCE — there is no
//     resolvable @apnex/network-adapter/package.json on disk at runtime — so
//     without this the shim's NETWORK_ADAPTER_PKG_VERSION catch-falls-back to
//     the SHIM's OWN version, making sdkVersion report a FALSE kernel skew
//     (steve @shim-version vs claude @kernel-version for the SAME kernel = the
//     phantom-version class). Inlining the source-of-truth version keeps
//     sdkVersion honest. pkgDir = adapters/opencode-plugin (npm cwd); ../../ = repo root.
const networkAdapterVersion = JSON.parse(
  readFileSync(resolve(pkgDir, "..", "..", "packages", "network-adapter", "package.json"), "utf-8"),
).version;

// 3. esbuild self-contained bundle with build-info inlined via --define.
await build({
  absWorkingDir: pkgDir,
  entryPoints: ["src/plugin-entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist/shim.js",
  external: ["@opencode-ai/plugin"],
  alias: {
    "@apnex/cognitive-layer": "../../packages/cognitive-layer/src/index.ts",
    "@apnex/message-router": "../../packages/message-router/src/index.ts",
    "@apnex/network-adapter": "../../packages/network-adapter/src/index.ts",
  },
  define: {
    // esbuild substitutes the identifier with this JSON object literal.
    __OPENCODE_BUILD_INFO__: JSON.stringify(buildInfo),
    // ...and the real kernel version (string literal) for honest sdkVersion.
    __NETWORK_ADAPTER_VERSION__: JSON.stringify(networkAdapterVersion),
  },
});

process.stderr.write(
  `[bundle-opencode] dist/shim.js bundled; build-info inlined ` +
    `(${buildInfo.commitSha}${buildInfo.dirty ? "-dirty" : ""} on ${buildInfo.branch}); ` +
    `kernel @apnex/network-adapter@${networkAdapterVersion} inlined\n`,
);
