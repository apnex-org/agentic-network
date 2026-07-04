#!/usr/bin/env node
/**
 * scripts/build/stage-skills.js — stage repo-root skills/ into the package
 * being packed, so the npm tarball is the COMPLETE consumer artifact.
 *
 * Invoked from @apnex/claude-plugin's `prepack` (cwd = the package root; npm
 * sets that). Runs AFTER write-build-info.js --assert in the prepack chain so
 * the staged (untracked) files can never influence the `dirty` stamp.
 * `postpack` invokes `--clean` to remove the staged copy, keeping the working
 * tree in its authored state.
 *
 * Why: the sovereign-skills payload (skills/survey, consumed by
 * lib/bootstrap-skills.sh at install time) previously reached consumers only
 * via the GitHub-Release tarball path; pure npm pulls silently shipped without
 * it (observed on @apnex/claude-plugin 0.1.12). With the npm registry as the
 * single publish channel, staging happens inside the npm pack lifecycle.
 *
 * Graceful skip: in an extracted-tarball context (npm-installed consumer
 * rebuilding from source) there is no repo-root skills/ — skip without error;
 * the tarball already carries its skills/.
 */

import { cpSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const pkgDir = process.cwd();
const dst = join(pkgDir, "skills");

if (process.argv.includes("--clean")) {
  rmSync(dst, { recursive: true, force: true });
  process.stderr.write("[stage-skills] cleaned staged skills/\n");
  process.exit(0);
}

// Repo root is two levels up from adapters/<plugin>/ in the source tree.
const src = resolve(pkgDir, "..", "..", "skills");

if (!existsSync(src)) {
  process.stderr.write("[stage-skills] skip — no repo-root skills/ (tarball context)\n");
  process.exit(0);
}

rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
process.stderr.write(`[stage-skills] staged ${src} -> skills/\n`);
