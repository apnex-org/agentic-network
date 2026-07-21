#!/usr/bin/env node
/**
 * Publish one authority-bound @apnex release from already-frozen tarballs.
 *
 * This deliberately does not accept workspaces or directories. Every manifest
 * path is audited before registry probes. Before the first mutation, every
 * pending artifact is opened once, re-identified from that held inode, and kept
 * open. npm receives the same descriptor as child fd 3 through a private
 * mode-0700 `.tgz` alias to `/proc/self/fd/3`, so it never reopens the mutable
 * manifest pathname.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readlinkSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
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
const CHILD_ARTIFACT_FD = 3;
const CHILD_ARTIFACT_PATH = `/proc/self/fd/${CHILD_ARTIFACT_FD}`;
const DESCRIPTOR_ALIAS_PREFIX = "ois-held-inode-";

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
const manifestFd = openSync(manifestPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
let manifest;
try {
  manifest = JSON.parse(readHeldBytes(manifestFd, manifestPath).bytes.toString("utf8"));
} finally {
  closeSync(manifestFd);
}
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
const heldArtifacts = [];
let descriptorAliasDir = null;

function persist() {
  const tmp = `${statePath}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, statePath);
}

function run(command, args, { allowFailure = false, input, inheritedFd } = {}) {
  const options = { encoding: "utf8", env: process.env, input };
  if (inheritedFd !== undefined) {
    options.stdio = ["ignore", "pipe", "pipe", inheritedFd];
  }
  const result = spawnSync(command, args, options);
  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${combined.trim()}`);
  }
  return { status: result.status ?? 1, stdout: (result.stdout ?? "").trim(), combined: combined.trim() };
}

function readHeldBytes(fd, label) {
  const before = fstatSync(fd, { bigint: true });
  if (!before.isFile()) throw new Error(`${label}: artifact must be a regular file`);
  if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label}: artifact is too large`);
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.length) {
    const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
    if (count === 0) throw new Error(`${label}: unexpected EOF while reading held inode`);
    offset += count;
  }
  const after = fstatSync(fd, { bigint: true });
  for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
    if (before[field] !== after[field]) throw new Error(`${label}: held inode changed during identification (${field})`);
  }
  return {
    bytes,
    inode: {
      dev: before.dev.toString(),
      ino: before.ino.toString(),
      size: before.size.toString(),
      mtimeNs: before.mtimeNs.toString(),
      ctimeNs: before.ctimeNs.toString(),
    },
  };
}

function openArtifact(path) {
  if (process.platform !== "linux") throw new Error("held-inode publication requires Linux /proc/self/fd semantics");
  return openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
}

function packedManifest(bytes) {
  const result = run("tar", ["-xzOf", "-", "package/package.json"], { input: bytes });
  return JSON.parse(result.stdout);
}

function requireExact(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function identifyArtifact(fd, artifact, name, version, boundary) {
  const identified = readHeldBytes(fd, `${name}: ${boundary}`);
  requireExact(createHash("sha256").update(identified.bytes).digest("hex"), artifact.sha256, `${name}: ${boundary} SHA-256`);
  requireExact(
    `sha512-${createHash("sha512").update(identified.bytes).digest("base64")}`,
    artifact.integrity,
    `${name}: ${boundary} SHA-512 integrity`,
  );
  const packed = packedManifest(identified.bytes);
  requireExact(packed.name, name, `${name}: ${boundary} packed name`);
  requireExact(packed.version, version, `${name}: ${boundary} packed version`);
  requireExact(artifact.gitHead, manifest.source.commit, `${name}: manifest gitHead/source commit`);
  requireExact(packed.gitHead, artifact.gitHead, `${name}: ${boundary} packed gitHead`);
  const internalDependencies = Object.fromEntries(
    Object.entries(packed.dependencies ?? {}).filter(([dependency]) => dependency.startsWith("@apnex/")),
  );
  requireExact(
    JSON.stringify(internalDependencies),
    JSON.stringify(EXPECTED_INTERNAL_DEPENDENCIES[name]),
    `${name}: ${boundary} packed internal dependency lineage`,
  );
  return identified.inode;
}

function identifyPath(artifact, name, version, boundary) {
  const fd = openArtifact(artifact.path);
  try {
    return identifyArtifact(fd, artifact, name, version, boundary);
  } finally {
    closeSync(fd);
  }
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

  // Initial all-artifact preflight, before the first registry read or mutation.
  for (let i = 0; i < EXPECTED_ORDER.length; i += 1) {
    const artifact = manifest.artifacts[i];
    const [name, version] = EXPECTED_ORDER[i];
    requireExact(artifact.name, name, `artifact ${i + 1} name`);
    requireExact(artifact.version, version, `artifact ${i + 1} version`);
    if (!isAbsolute(artifact.path) || !artifact.path.endsWith(".tgz")) {
      throw new Error(`${name}: artifact path must be an absolute .tgz path`);
    }
    const inode = identifyPath(artifact, name, version, "initial preflight");
    state.steps.push({ name, version, path: artifact.path, status: "bytes-verified", preflightInode: inode });
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

  // Final use boundary: open and re-identify every artifact still to be published,
  // then keep every verified descriptor open before the first npm invocation.
  // A pre-open pathname swap fails before any publish. A later pathname swap
  // cannot redirect npm because npm receives the already-held inode as fd 3.
  for (let i = 0; i < manifest.artifacts.length; i += 1) {
    if (state.steps[i].status === "verified-existing") continue;
    const artifact = manifest.artifacts[i];
    const [name, version] = EXPECTED_ORDER[i];
    const fd = openArtifact(artifact.path);
    try {
      const inode = identifyArtifact(fd, artifact, name, version, "final held-inode use boundary");
      heldArtifacts.push({ index: i, artifact, fd });
      state.steps[i].status = "use-bytes-verified";
      state.steps[i].useInode = inode;
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  if (heldArtifacts.length > 0) {
    descriptorAliasDir = mkdtempSync(join(tmpdir(), DESCRIPTOR_ALIAS_PREFIX));
    chmodSync(descriptorAliasDir, 0o700);
    for (const held of heldArtifacts) {
      const aliasPath = join(descriptorAliasDir, `${held.index + 1}-${basename(held.artifact.path)}`);
      symlinkSync(CHILD_ARTIFACT_PATH, aliasPath);
      held.npmPath = aliasPath;
      state.steps[held.index].npmPath = aliasPath;
      state.steps[held.index].npmPathTarget = CHILD_ARTIFACT_PATH;
    }
  }
  persist();

  for (const held of heldArtifacts) {
    const { index, artifact, fd, npmPath } = held;
    state.currentStep = `${artifact.name}@${artifact.version}`;
    persist();
    if (!lstatSync(npmPath).isSymbolicLink() || readlinkSync(npmPath) !== CHILD_ARTIFACT_PATH) {
      throw new Error(`${artifact.name}: private descriptor alias changed before npm use`);
    }
    const args = ["publish", npmPath, "--access", "public", "--tag", "latest"];
    if (dryRun) args.push("--dry-run");
    run("npm", args, { inheritedFd: fd });
    state.steps[index].status = dryRun ? "dry-run-validated" : "published";
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
  process.exitCode = 1;
} finally {
  for (const held of heldArtifacts) {
    try { closeSync(held.fd); } catch { /* all publication work is already complete or failed */ }
  }
  if (descriptorAliasDir !== null) {
    try { rmSync(descriptorAliasDir, { recursive: true, force: true }); } catch { /* preserve primary outcome */ }
  }
}
