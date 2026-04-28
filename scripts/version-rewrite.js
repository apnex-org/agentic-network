#!/usr/bin/env node
/**
 * scripts/version-rewrite.js — pre-publish version rewriter
 *
 * Rewrites cross-`@apnex/*` deps in workspace package.json files between
 * source-tree placeholder ("*") and registry-pinned semver ("^X.Y.Z")
 * around the npm publish lifecycle.
 *
 * Why: npm 11.6.2 does NOT support the yarn-workspace `workspace:^` protocol
 * (EUNSUPPORTEDPROTOCOL on install). Plain `*` works for npm install via
 * workspaces graph BUT is NOT rewritten by npm at pack-time — the rendered
 * tarball would still contain `*`, which is unsafe for external consumers.
 *
 * Mission-64 R2 fallback path per Design v1.0 §2.4 + Risk register R2.
 * Calibration #29 (mission-64 W1+W2 surface): empirical npm-vs-yarn
 * workspace-protocol asymmetry; mechanism rather than docs closes
 * calibration-25-class regression structurally.
 *
 * Usage:
 *   node scripts/version-rewrite.js          # rewrite "*" → "^X.Y.Z" (prepublishOnly)
 *   node scripts/version-rewrite.js --revert # rewrite "^X.Y.Z" → "*" (postpublish)
 *   node scripts/version-rewrite.js --check  # dry-run; show what would change
 *
 * Wired via root package.json lifecycle hooks:
 *   "prepublishOnly": "node scripts/version-rewrite.js"
 *   "postpublish":    "node scripts/version-rewrite.js --revert"
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// REPO_ROOT resolution — `git rev-parse --show-toplevel` is cwd-independent
// closure for Calibration #39 (publish bash-session cwd-persistence into
// version-rewrite.js silent MODULE_NOT_FOUND swallow → un-rewritten "*"
// deps shipped). The path.resolve(__dirname, "..") fallback assumes the
// script lives at <repo>/scripts/ which is true today, but using git is
// more robust if the script is ever moved or invoked via symlink.
//
// Mission-64 W1+W2-fix-4 cycle 5 surfaced #39 (PR #126 fix-forward closed
// for 0.1.4 cycle via repo-root cwd discipline; this is the structural
// closure deferred to follow-up per ADR-029 W4 Status flow). Mission-64
// post-cleanup PR delivers it.
function resolveRepoRoot() {
  try {
    const gitTop = execSync("git rev-parse --show-toplevel", {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitTop && fs.existsSync(path.join(gitTop, "package.json"))) {
      return gitTop;
    }
  } catch {
    // Fall through to __dirname-relative fallback below
  }
  // Fallback when not in a git checkout (tarball-extract testing, bare
  // repos, missing .git dir, sparse-checkout edge cases); preserves
  // pre-mission-64-post-cleanup semantics so this script stays loadable
  // in non-git contexts. Note: shallow clones are NOT a fallback case —
  // git rev-parse --show-toplevel is depth-independent and works in them.
  return path.resolve(__dirname, "..");
}

const REPO_ROOT = resolveRepoRoot();
const NAMESPACE = "@apnex";
const PLACEHOLDER = "*";

const args = new Set(process.argv.slice(2));
const REVERT = args.has("--revert");
const CHECK = args.has("--check");

function loadRootWorkspaces() {
  const root = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  if (!Array.isArray(root.workspaces)) {
    throw new Error("Root package.json missing workspaces array");
  }
  // Expand glob patterns "packages/*" + "adapters/*"
  const dirs = [];
  for (const pattern of root.workspaces) {
    if (pattern.endsWith("/*")) {
      const parent = path.join(REPO_ROOT, pattern.slice(0, -2));
      if (fs.existsSync(parent)) {
        for (const entry of fs.readdirSync(parent)) {
          const dir = path.join(parent, entry);
          if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, "package.json"))) {
            dirs.push(dir);
          }
        }
      }
    } else {
      dirs.push(path.join(REPO_ROOT, pattern));
    }
  }
  return dirs;
}

function loadPackageMap(dirs) {
  // name → version (only @apnex/* packages)
  const map = new Map();
  for (const dir of dirs) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (pkg.name && pkg.name.startsWith(`${NAMESPACE}/`)) {
      map.set(pkg.name, pkg.version);
    }
  }
  return map;
}

function rewriteDeps(deps, packageMap, mode) {
  if (!deps) return { deps: undefined, changes: [] };
  const out = { ...deps };
  const changes = [];
  for (const [name, spec] of Object.entries(deps)) {
    if (!packageMap.has(name)) continue; // not an @apnex sibling
    const targetVersion = packageMap.get(name);
    if (mode === "rewrite") {
      // "*" → "^<version>"
      if (spec === PLACEHOLDER) {
        const next = `^${targetVersion}`;
        out[name] = next;
        changes.push({ name, from: spec, to: next });
      }
    } else if (mode === "revert") {
      // "^<version>" → "*"
      if (spec.startsWith("^") || spec.startsWith("~") || /^\d/.test(spec)) {
        out[name] = PLACEHOLDER;
        changes.push({ name, from: spec, to: PLACEHOLDER });
      }
    }
  }
  return { deps: out, changes };
}

function processPackage(dir, packageMap, mode) {
  const pkgPath = path.join(dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const allChanges = [];

  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const result = rewriteDeps(pkg[field], packageMap, mode);
    if (result.changes.length > 0) {
      pkg[field] = result.deps;
      for (const ch of result.changes) {
        allChanges.push({ field, ...ch });
      }
    }
  }

  if (allChanges.length > 0 && !CHECK) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  return { pkg: pkg.name, dir, changes: allChanges };
}

function main() {
  const mode = REVERT ? "revert" : "rewrite";
  const verbAction = mode === "rewrite" ? "REWRITING" : "REVERTING";
  const description = mode === "rewrite" ? `"*" → "^X.Y.Z"` : `"^X.Y.Z" → "*"`;

  console.log(`[version-rewrite] ${verbAction} cross-@apnex deps (${description})${CHECK ? " — DRY RUN" : ""}`);

  const dirs = loadRootWorkspaces();
  const packageMap = loadPackageMap(dirs);

  if (packageMap.size === 0) {
    console.log("[version-rewrite] No @apnex/* packages found in workspaces — nothing to do.");
    process.exit(0);
  }

  console.log(`[version-rewrite] ${packageMap.size} @apnex/* packages in workspaces graph`);
  for (const [name, version] of packageMap) {
    console.log(`[version-rewrite]   ${name}@${version}`);
  }

  let totalChanges = 0;
  for (const dir of dirs) {
    const result = processPackage(dir, packageMap, mode);
    if (result.changes.length > 0) {
      console.log(`[version-rewrite] ${result.pkg}:`);
      for (const ch of result.changes) {
        console.log(`[version-rewrite]   ${ch.field}.${ch.name}: ${ch.from} → ${ch.to}`);
      }
      totalChanges += result.changes.length;
    }
  }

  console.log(`[version-rewrite] ${totalChanges} dep-spec change(s)${CHECK ? " (would apply)" : " applied"}`);
}

main();
