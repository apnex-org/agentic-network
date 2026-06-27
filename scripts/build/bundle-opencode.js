#!/usr/bin/env node
/**
 * scripts/build/bundle-opencode.js — OpenCode self-contained bundle builder.
 *
 * idea-355 SLICE-3 (fork 3, single-sha): the OpenCode plugin ships as ONE
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
  },
});

process.stderr.write(
  `[bundle-opencode] dist/shim.js bundled; build-info inlined ` +
    `(${buildInfo.commitSha}${buildInfo.dirty ? "-dirty" : ""} on ${buildInfo.branch})\n`,
);
