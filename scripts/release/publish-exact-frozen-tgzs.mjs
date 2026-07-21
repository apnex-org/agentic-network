#!/usr/bin/env node
/**
 * Publish one authority-bound @apnex release from already-frozen tarballs.
 *
 * This deliberately does not accept workspaces or directories. Every artifact is
 * re-identified before the first registry probe; publication is direct from the
 * absolute .tgz paths in the manifest, in the fixed three-package order.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const EXPECTED_ORDER = [
  ["@apnex/cognitive-layer", "0.1.4"],
  ["@apnex/network-adapter", "0.1.14"],
  ["@apnex/claude-plugin", "0.1.16"],
];
const EXPECTED_INTERNAL_DEPENDENCIES = {
  "@apnex/cognitive-layer": {},
  "@apnex/network-adapter": {
    "@apnex/cognitive-layer": "0.1.4",
    "@apnex/message-router": "0.1.3",
  },
  "@apnex/claude-plugin": {
    "@apnex/network-adapter": "0.1.14",
  },
};

function usage() {
  console.error("usage: publish-exact-frozen-tgzs.mjs <absolute-manifest.json> [--dry-run] [--recover]");
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const recovery = argv.includes("--recover");
const positional = argv.filter((arg) => !arg.startsWith("--"));
if (positional.length !== 1 || !isAbsolute(positional[0])) {
  usage();
  process.exit(2);
}

const manifestPath = positional[0];
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const statePath = manifest.statePath;
if (!isAbsolute(statePath ?? "")) throw new Error("manifest.statePath must be absolute");

const state = {
  protocolVersion: 1,
  manifestPath,
  dryRun,
  recovery,
  status: "preflight",
  startedAt: new Date().toISOString(),
  steps: [],
};

function persist() {
  const tmp = `${statePath}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, statePath);
}

function run(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: process.env });
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${combined.trim()}`);
  }
  return { status: result.status ?? 1, stdout: (result.stdout ?? "").trim(), combined: combined.trim() };
}

function hashFile(path, algorithm) {
  return createHash(algorithm).update(readFileSync(path)).digest(algorithm === "sha512" ? "base64" : "hex");
}

function packedManifest(path) {
  const result = run("tar", ["-xOf", path, "package/package.json"]);
  return JSON.parse(result.stdout);
}

function requireExact(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function registryRecord(spec) {
  const version = run("npm", ["view", spec, "version", "--json"], { allowFailure: true });
  if (version.status !== 0) {
    if (/E404|404 Not Found|is not in this registry|No match found/i.test(version.combined)) return null;
    throw new Error(`registry probe failed for ${spec}: ${version.combined}`);
  }
  return {
    version: JSON.parse(version.stdout),
    integrity: JSON.parse(run("npm", ["view", spec, "dist.integrity", "--json"]).stdout),
    gitHead: JSON.parse(run("npm", ["view", spec, "gitHead", "--json"]).stdout),
  };
}

try {
  persist();
  requireExact(manifest.protocolVersion, 1, "manifest protocolVersion");
  requireExact(manifest.executor?.agentName, "lily", "executor agentName");
  requireExact(manifest.executor?.role, "architect", "executor role");
  if (!/^[0-9a-f]{40}$/.test(manifest.source?.commit ?? "")) throw new Error("source.commit must be a full 40-hex commit");
  if (!/^[0-9a-f]{40}$/.test(manifest.source?.tree ?? "")) throw new Error("source.tree must be a full 40-hex tree");
  requireExact(process.env.OIS_AGENT_NAME, manifest.executor.agentName, "runtime executor agentName");
  requireExact(process.env.OIS_HUB_ROLE, manifest.executor.role, "runtime executor role");

  const npmVersion = run("npm", ["--version"]).stdout;
  requireExact(npmVersion, manifest.npmCliVersion, "npm CLI version");
  const npmIdentity = run("npm", ["whoami"]).stdout;
  requireExact(npmIdentity, manifest.executor.npmIdentity, "npm identity");

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== EXPECTED_ORDER.length) {
    throw new Error(`manifest must contain exactly ${EXPECTED_ORDER.length} artifacts`);
  }

  // Re-identify every frozen byte before the first registry read or mutation.
  for (let i = 0; i < EXPECTED_ORDER.length; i += 1) {
    const artifact = manifest.artifacts[i];
    const [name, version] = EXPECTED_ORDER[i];
    requireExact(artifact.name, name, `artifact ${i + 1} name`);
    requireExact(artifact.version, version, `artifact ${i + 1} version`);
    if (!isAbsolute(artifact.path) || !artifact.path.endsWith(".tgz")) {
      throw new Error(`${name}: artifact path must be an absolute .tgz path`);
    }
    requireExact(hashFile(artifact.path, "sha256"), artifact.sha256, `${name}: SHA-256`);
    requireExact(`sha512-${hashFile(artifact.path, "sha512")}`, artifact.integrity, `${name}: SHA-512 integrity`);
    const packed = packedManifest(artifact.path);
    requireExact(packed.name, name, `${name}: packed name`);
    requireExact(packed.version, version, `${name}: packed version`);
    requireExact(artifact.gitHead, manifest.source.commit, `${name}: manifest gitHead/source commit`);
    requireExact(packed.gitHead, artifact.gitHead, `${name}: packed gitHead`);
    const internalDependencies = Object.fromEntries(
      Object.entries(packed.dependencies ?? {}).filter(([dependency]) => dependency.startsWith("@apnex/")),
    );
    requireExact(
      JSON.stringify(internalDependencies),
      JSON.stringify(EXPECTED_INTERNAL_DEPENDENCIES[name]),
      `${name}: packed internal dependency lineage`,
    );
    state.steps.push({ name, version, path: artifact.path, status: "bytes-verified" });
  }
  persist();

  let sawVacant = false;
  for (let i = 0; i < manifest.artifacts.length; i += 1) {
    const artifact = manifest.artifacts[i];
    const spec = `${artifact.name}@${artifact.version}`;
    const published = registryRecord(spec);
    if (published === null) {
      sawVacant = true;
      state.steps[i].status = "vacant";
      continue;
    }
    if (!recovery) throw new Error(`${spec} is already published; fresh execution requires vacancy`);
    if (sawVacant) throw new Error(`${spec} is published after a vacant earlier step; refusing non-prefix recovery`);
    requireExact(published.version, artifact.version, `${spec}: registry version`);
    requireExact(published.integrity, artifact.integrity, `${spec}: registry integrity`);
    requireExact(published.gitHead, artifact.gitHead, `${spec}: registry gitHead`);
    state.steps[i].status = "verified-existing";
  }
  persist();

  for (let i = 0; i < manifest.artifacts.length; i += 1) {
    const artifact = manifest.artifacts[i];
    if (state.steps[i].status === "verified-existing") continue;
    state.currentStep = `${artifact.name}@${artifact.version}`;
    persist();
    const args = ["publish", artifact.path, "--access", "public", "--tag", "latest"];
    if (dryRun) args.push("--dry-run");
    run("npm", args);
    state.steps[i].status = dryRun ? "dry-run-validated" : "published";
    state.currentStep = null;
    persist();
  }

  state.status = dryRun ? "dry-run-complete" : "published-complete";
  state.completedAt = new Date().toISOString();
  persist();
  console.log(`[publish-exact] ${state.status}: ${manifest.artifacts.map((a) => `${a.name}@${a.version}`).join(" -> ")}`);
} catch (error) {
  state.status = "failed";
  state.error = error instanceof Error ? error.message : String(error);
  state.completedAt = new Date().toISOString();
  try { persist(); } catch { /* retain original failure */ }
  console.error(`[publish-exact] FAIL: ${state.error}`);
  process.exit(1);
}
