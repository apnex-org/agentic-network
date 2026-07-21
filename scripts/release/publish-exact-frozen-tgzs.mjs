#!/usr/bin/env node
/**
 * Publish one authority-bound @apnex release from already-frozen tarballs.
 *
 * This deliberately does not accept workspaces or directories. Every manifest
 * path is audited before registry probes. Before the first mutation, every
 * pending artifact is opened once and re-identified from that held inode. The
 * complete verified bytes are then passed directly to npm's own programmatic
 * publisher as a Buffer. No artifact pathname exists between final identity
 * verification and the registry request.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
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
  protocolVersion: 2,
  manifestPath,
  dryRun,
  recovery,
  status: "preflight",
  startedAt: new Date().toISOString(),
  steps: [],
};
const heldArtifacts = [];

function persist() {
  const tmp = `${statePath}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, statePath);
}

function run(command, args, { allowFailure = false, input } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: process.env, input });
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
  return { ...identified, packed };
}

function identifyPath(artifact, name, version, boundary) {
  const fd = openArtifact(artifact.path);
  try {
    return identifyArtifact(fd, artifact, name, version, boundary).inode;
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

async function loadProgrammaticNpm() {
  const globalRoot = run("npm", ["root", "--global"]).stdout;
  const npmRoot = realpathSync(join(globalRoot, "npm"));
  const npmPackage = JSON.parse(readFileSync(join(npmRoot, "package.json"), "utf8"));
  requireExact(npmPackage.version, manifest.npmCliVersion, "programmatic npm version");

  const npmRequire = createRequire(join(npmRoot, "package.json"));
  const Npm = npmRequire("./lib/npm.js");
  const { publish } = npmRequire("libnpmpublish");
  const { otplease } = npmRequire("./lib/utils/auth.js");
  const libnpmpublishPackage = npmRequire("libnpmpublish/package.json");
  requireExact(
    libnpmpublishPackage.version,
    manifest.libnpmpublishVersion,
    "programmatic libnpmpublish version",
  );

  // npm's Config parser deliberately consumes process.argv. Give it the same
  // explicit access/tag contract as the former CLI call, then restore our argv.
  const originalArgv = process.argv;
  const originalTitle = process.title;
  let npm;
  try {
    process.argv = [process.execPath, join(npmRoot, "bin/npm-cli.js"), "publish", "--access", "public", "--tag", "latest"];
    npm = new Npm();
    const loaded = await npm.load();
    if (!loaded?.exec || loaded.command !== "publish") throw new Error("failed to initialize npm publish configuration");
  } finally {
    process.argv = originalArgv;
    process.title = originalTitle;
  }

  return {
    npm,
    publish,
    otplease,
    options: {
      ...npm.flatOptions,
      access: "public",
      defaultTag: "latest",
      npmVersion: npmPackage.version,
      progress: false,
    },
    npmVersion: npmPackage.version,
    libnpmpublishVersion: libnpmpublishPackage.version,
  };
}

try {
  persist();
  requireExact(manifest.protocolVersion, 2, "manifest protocolVersion");
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

  // Final use boundary: open and re-identify every pending artifact, copy its
  // complete bytes from that descriptor, and retain both descriptor and Buffer
  // before the first registry mutation. No consumer pathname is created.
  for (let i = 0; i < manifest.artifacts.length; i += 1) {
    if (state.steps[i].status === "verified-existing") continue;
    const artifact = manifest.artifacts[i];
    const [name, version] = EXPECTED_ORDER[i];
    const fd = openArtifact(artifact.path);
    try {
      const identified = identifyArtifact(fd, artifact, name, version, "final held-inode use boundary");
      heldArtifacts.push({
        index: i,
        artifact,
        fd,
        bytes: Buffer.from(identified.bytes),
        packed: identified.packed,
      });
      state.steps[i].status = "use-bytes-verified";
      state.steps[i].useInode = identified.inode;
      state.steps[i].consumerTransport = "npm-programmatic-tarball-buffer";
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  persist();

  const publisher = await loadProgrammaticNpm();
  state.npmConsumer = {
    transport: "npm-programmatic-tarball-buffer",
    npmVersion: publisher.npmVersion,
    libnpmpublishVersion: publisher.libnpmpublishVersion,
  };
  persist();

  for (const held of heldArtifacts) {
    const { index, artifact, bytes, packed } = held;
    state.currentStep = `${artifact.name}@${artifact.version}`;
    const consumerBytes = Buffer.from(bytes);
    const consumerSha256 = createHash("sha256").update(consumerBytes).digest("hex");
    requireExact(consumerSha256, artifact.sha256, `${artifact.name}: consumer Buffer SHA-256`);
    requireExact(packed.name, artifact.name, `${artifact.name}: consumer manifest name`);
    requireExact(packed.version, artifact.version, `${artifact.name}: consumer manifest version`);
    requireExact(packed.gitHead, artifact.gitHead, `${artifact.name}: consumer manifest gitHead`);
    state.steps[index].consumerSha256 = consumerSha256;
    persist();

    if (!dryRun) {
      await publisher.otplease(publisher.npm, publisher.options, (options) =>
        publisher.publish(structuredClone(packed), consumerBytes, options));
    }
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
}
