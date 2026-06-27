#!/usr/bin/env node
/**
 * scripts/build/write-build-info.js — per-package build-identity stamper
 *
 * Invoked by each package's `prepack` hook. npm runs prepack from the
 * package directory before tarball pack, so process.cwd() is the package
 * root — we write `dist/build-info.json` there.
 *
 * Mission: M-Build-Identity-AdvisoryTag (idea-256). Solves the class of
 * "did the deploy land?" diagnostics where package.json `version` is
 * stable across many code changes (today's PR #190 motivating incident:
 * canonical-main-stale fault chain invisible from get-agents output).
 *
 * Schema (Design v1.0 §1.1):
 *   { commitSha: "ecc20e7", dirty: false, buildTime: "ISO-8601", branch: "main" }
 *
 * commitSha is the 7-char short SHA. dirty is a separate boolean (NOT a
 * suffix on commitSha at this layer; the "-dirty" suffix is rendered at
 * the get-agents COMMIT column display layer per Design v1.0 §1.6 + §2.3).
 *
 * Graceful fallback: if git is unavailable (extracted-tarball without git
 * context, e.g., npm-installed consumer rebuilding from source), all
 * fields fall back to "unknown" / null rather than failing the build.
 */

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function safeExec(cmd, fallback) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

// Exit-code probe (no stdout capture): 0 if the command exits 0, 1 otherwise.
// Treats a git ERROR identically to a non-zero result — never throws, so the
// caller can never spuriously fail when state can't be determined.
function safeExitOk(cmd) {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const sha = safeExec("git rev-parse --short HEAD", "unknown");
const dirty = safeExec("git status --porcelain", "") !== "";
const branch = safeExec("git rev-parse --abbrev-ref HEAD", "unknown");

const buildInfo = {
  commitSha: sha,
  dirty,
  buildTime: new Date().toISOString(),
  branch,
};

const distDir = resolve(process.cwd(), "dist");
mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(distDir, "build-info.json"), JSON.stringify(buildInfo, null, 2));

// Log to stderr — `npm pack --silent` only suppresses npm's own stdout, so
// any prepack-script stdout would leak into a caller's capture
// (`TARBALL_NAME=$(npm pack --silent)`). build-hub.sh + publish-packages.sh
// rely on that capture; stderr keeps the diagnostic visible without poisoning
// the contract.
process.stderr.write(
  `[build-info] dist/build-info.json: ${sha}${dirty ? "-dirty" : ""} on ${branch} at ${buildInfo.buildTime}\n`,
);

// ── --assert mode (idea-355 SLICE-3 / bug-182 version-bump GATE) ─────────
//
// fork 1 = ASSERT/GATE (NOT auto-increment). Wired into the `prepack` (ship)
// hook only — `prebuild` (dev/CI `npm run build`) stays stamp-only so a build
// can never fail here. The gate FAILS iff a package's source advanced PAST its
// last version bump (i.e. you shipped src changes without bumping the version).
//
// Self-contained, no network. Runs with cwd = the package root (npm sets that
// for prepack). GRACEFUL-SKIP (exit 0) whenever state can't be determined —
// no git, missing/unversioned package.json, or no version-introducing commit
// (first release). Idempotent (claude-plugin prepack multi-fires).
if (process.argv.includes("--assert")) {
  runAssert();
}

function assertSkip(note) {
  process.stderr.write(`[build-info:assert] skip — ${note}\n`);
}

function runAssert() {
  // No git context → the top-level `git rev-parse` already fell back to
  // "unknown". Nothing to assert against.
  if (sha === "unknown") {
    assertSkip("no git context");
    return;
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8"));
  } catch {
    assertSkip("no readable package.json in cwd");
    return;
  }
  const pkgName = typeof pkg.name === "string" ? pkg.name : process.cwd();
  const currentVersion = pkg.version;
  if (typeof currentVersion !== "string" || currentVersion === "") {
    assertSkip(`${pkgName}: no version string in package.json`);
    return;
  }

  // Last commit touching the package's src/.
  const srcCommit = safeExec("git log -1 --format=%H -- src", "");
  // Last commit that introduced the CURRENT version string into package.json
  // (pickaxe: the count of `"version": "<v>"` changed → the bump commit).
  const versionCommit = safeExec(
    `git log -1 --format=%H -S '"version": "${currentVersion}"' -- package.json`,
    "",
  );
  if (!srcCommit || !versionCommit) {
    assertSkip(
      `${pkgName}@${currentVersion}: indeterminate ` +
        `(srcCommit=${srcCommit || "none"} versionCommit=${versionCommit || "none"})`,
    );
    return;
  }

  // FAIL iff src advanced PAST the version bump: versionCommit is a strict
  // ancestor of srcCommit. PASS if srcCommit is an ancestor-or-equal of
  // versionCommit (version bumped with/after the latest src change). A git
  // error in --is-ancestor falls through to PASS (never a spurious failure).
  const srcAheadOfVersion =
    versionCommit !== srcCommit && safeExitOk(`git merge-base --is-ancestor ${versionCommit} ${srcCommit}`);
  if (srcAheadOfVersion) {
    process.stderr.write(
      `[build-info:assert] FAIL — ${pkgName}@${currentVersion}: src/ advanced PAST the version bump.\n` +
        `  version-bump commit: ${versionCommit}\n` +
        `  latest src/ commit:  ${srcCommit}\n` +
        `  Bump ${pkgName}'s package.json version before shipping.\n`,
    );
    process.exit(1);
  }
  process.stderr.write(
    `[build-info:assert] OK — ${pkgName}@${currentVersion} (src not ahead of the version bump)\n`,
  );
}
