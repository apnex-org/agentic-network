#!/usr/bin/env node
/**
 * Deterministic dep-prune (M-Adapter-Modernization P1e carry-c) — SUBTRACT from the
 * P1a-PROVEN node_modules, never rebuild it.
 *
 * Per the architect's decisive call: (a) version-rewrite+install and (b) tarball-stage
 * both RE-RESOLVE the dep tree (a fresh install) -> re-open the byte-reproducibility P1a
 * closed. (c) subtracts deterministically: same SHA -> lockfile-pinned full tree (P1a-proven
 * repro) -> same `npm ls --omit=dev` closure -> same SET-BASED rm -> same pruned tree -> same
 * digest. Bonus: dropping google-auth-library/jose/@google-cloud (other-workspace bloat) also
 * STRENGTHENS cred-free (those cloud-auth libs are what the cred-scan guards against).
 *
 * keep-set = the transitive --omit=dev closure of @apnex/network-adapter + @apnex/claude-plugin
 * (npm ls --all traverses the HOISTED tree -> captures root-hoisted transitives; shared pkgs
 * other workspaces also use STAY because they're in the closure; only EXCLUSIVELY-other-
 * workspace pkgs get removed). Always KEEP @apnex/* (workspace pkgs) + .bin + npm metadata.
 *
 * DRY_RUN=1 prints what it WOULD remove without removing (local validation).
 */
const { execSync } = require("node:child_process");
const { readdirSync, rmSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const NM = process.env.PRUNE_NM_DIR || "node_modules";
const DRY = process.env.DRY_RUN === "1";
const ROOTS = ["@apnex/network-adapter", "@apnex/claude-plugin"];

/** The set of package names (flat "p" or scoped "@s/p") in the adapter prod closure. */
function closurePkgNames() {
  const keep = new Set();
  for (const ws of ROOTS) {
    let out = "";
    try {
      out = execSync(`npm ls --omit=dev --all --parseable --workspace=${ws}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch (e) {
      // npm ls exits non-zero on extraneous/peer warnings; its stdout is still the tree.
      out = (e.stdout && e.stdout.toString()) || "";
    }
    const marker = `${NM}/`;
    for (const line of out.split("\n")) {
      const idx = line.lastIndexOf(marker);
      if (idx === -1) continue;
      const after = line.slice(idx + marker.length);
      const parts = after.split("/");
      const name = parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
      if (name) keep.add(name);
    }
  }
  return keep;
}

const keep = closurePkgNames();
const ALWAYS = new Set([".bin", ".package-lock.json", ".modules.yaml"]);
const removed = [];

for (const entry of readdirSync(NM)) {
  const p = join(NM, entry);
  if (ALWAYS.has(entry) || entry === "@apnex") continue; // npm metadata + workspace pkgs: keep
  if (entry.startsWith("@")) {
    // scope dir: keep only members in the closure; remove the rest.
    for (const member of readdirSync(p)) {
      const full = `${entry}/${member}`;
      if (!keep.has(full)) {
        if (!DRY) rmSync(join(p, member), { recursive: true, force: true });
        removed.push(full);
      }
    }
    if (existsSync(p) && readdirSync(p).length === 0 && !DRY) rmSync(p, { recursive: true, force: true });
  } else if (!keep.has(entry)) {
    if (!DRY) rmSync(p, { recursive: true, force: true });
    removed.push(entry);
  }
}

removed.sort(); // set-based / ordering-independent output
console.error(`[dep-prune]${DRY ? " DRY-RUN" : ""} keep-set ${keep.size} pkgs; removed ${removed.length}: ${removed.join(", ")}`);
