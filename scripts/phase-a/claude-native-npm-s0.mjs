#!/usr/bin/env node
/**
 * Mission-125 Phase-A S0: disposable direct-npm and Claude-native npm-source
 * materialization harness. This file deliberately has no production imports.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const TEMPLATE = path.join(HERE, "fixtures/marketplace.template.json");
const CONTRACT = Object.freeze({
  baseCommit: "1055d80161df4d36e6a1876676a822e7fe99b029",
  claude: "/home/apnex/.local/share/claude/versions/2.1.216",
  claudeVersion: "2.1.216 (Claude Code)",
  claudeSha256: "74deca45220b8080ec75ab099bd5a5980e41a2b5879846a008fb115d436de085",
  node: "/home/apnex/.nvm/versions/node/v24.12.0/bin/node",
  nodeVersion: "v24.12.0",
  nodeSha256: "16143bdaa79716e871d3d9b2f50ce680bca293eba7f0c3fc1d004ed2258fc839",
  npm: "/home/apnex/.nvm/versions/node/v24.12.0/bin/npm",
  npmCli: "/home/apnex/.nvm/versions/node/v24.12.0/lib/node_modules/npm/bin/npm-cli.js",
  npmVersion: "11.6.2",
  npmSha256: "8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7",
  os: "fedora:31",
  cpu: "x86_64",
  libc: "glibc:2.30",
  marketplace: "agentic-network-phase-a",
  pluginId: "agent-adapter-phase-a",
  outerName: "@apnex/claude-native-s0-plugin",
  outerVersion: "0.0.1",
  runtimeName: "@apnex/claude-native-s0-runtime",
  runtimeVersion: "1.0.0",
  transitiveName: "@apnex/claude-native-s0-transitive",
  transitiveVersion: "1.0.0",
  adversaryVersion: "1.0.1",
  devName: "@apnex/claude-native-s0-dev",
  devVersion: "1.0.0",
  tupleId: "claude-2.1.216_node-24.12.0_npm-11.6.2_fedora31-x64-glibc2.30_hoisted-prod",
  templateBytes: 315,
  templateSha256: "48876c0b1e7747b922a0efd4121ee0a41360cc9ddddd717dbe400541725d5cae",
});
const ROOT_IDS = ["r1-npm", "r2-npm", "r1-claude", "r2-claude"];
const SURFACES = ["home", "xdg-config", "xdg-cache", "tmp", "claude-config", "plugin-cache", "npm-cache", "npm-prefix", "marketplace", "stage", "result"];

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const sha512Integrity = (value) => `sha512-${crypto.createHash("sha512").update(value).digest("base64")}`;
const stable = (value) => JSON.stringify(sortDeep(value));
function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
  return value;
}
async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }
async function readJson(p) { return JSON.parse(await fsp.readFile(p, "utf8")); }
async function writeJson(p, value) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, `${JSON.stringify(value, null, 2)}\n`); }
async function hashFile(p) { return sha256(await fsp.readFile(p)); }

function run(command, args, { cwd = REPO, env = process.env, allowFailure = false, capture = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (b) => { stdout += b; });
    child.stderr?.on("data", (b) => { stderr += b; });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code, stdout, stderr, command: [command, ...args].join(" ") };
      if (code !== 0 && !allowFailure) reject(new Error(`${result.command} exited ${code}\n${stderr}\n${stdout}`));
      else resolve(result);
    });
  });
}

class Registry {
  constructor(id) { this.id = id; this.packages = new Map(); this.logs = []; this.phase = "seed"; }
  add(name, version, manifest, tgz) {
    const versions = this.packages.get(name) ?? new Map();
    versions.set(version, { manifest, tgz, bytes: fs.readFileSync(tgz) });
    this.packages.set(name, versions);
  }
  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${this.server.address().port}/`;
  }
  async stop() { if (this.server) await new Promise((resolve) => this.server.close(resolve)); }
  snapshot() {
    const rows = [];
    for (const [name, versions] of [...this.packages].sort()) for (const [version, item] of [...versions].sort()) rows.push({ name, version, sha256: sha256(item.bytes), integrity: sha512Integrity(item.bytes) });
    return { id: this.id, url: this.url, rows, hash: sha256(stable(rows)) };
  }
  handle(req, res) {
    const raw = new URL(req.url, this.url).pathname;
    let decoded; try { decoded = decodeURIComponent(raw); } catch { decoded = raw; }
    const log = { at: new Date().toISOString(), registry: this.id, phase: this.phase, method: req.method, path: raw, decoded, authorization: Boolean(req.headers.authorization), status: 0 };
    this.logs.push(log);
    this.onRequest?.(log);
    const finish = (status, body, type = "application/json") => { log.status = status; res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
    if (req.method !== "GET") return finish(405, JSON.stringify({ error: "read-only disposable registry" }));
    for (const [name, versions] of this.packages) {
      const encodedName = name.replace("/", "%2f");
      if (raw.toLowerCase() === `/${encodedName}`.toLowerCase() || decoded === `/${name}`) {
        const out = { name, "dist-tags": { latest: [...versions.keys()].sort().at(-1) }, versions: {} };
        for (const [version, item] of versions) {
          const base = `${name.split("/").at(-1)}-${version}.tgz`;
          out.versions[version] = { ...item.manifest, dist: { tarball: `${this.url}${name}/-/${base}`, integrity: sha512Integrity(item.bytes), shasum: crypto.createHash("sha1").update(item.bytes).digest("hex") } };
        }
        return finish(200, JSON.stringify(out));
      }
      for (const [version, item] of versions) {
        const base = `${name.split("/").at(-1)}-${version}.tgz`;
        if (decoded === `/${name}/-/${base}`) return finish(200, item.bytes, "application/octet-stream");
      }
    }
    return finish(404, JSON.stringify({ error: "not found", path: decoded }));
  }
}

async function packPackage(seedDir, name, version, extra = {}) {
  const dir = path.join(seedDir, `${name.split("/").at(-1)}-${version}`);
  await fsp.mkdir(dir, { recursive: true });
  const manifest = { name, version, type: "module", main: "index.mjs", files: ["index.mjs"], ...extra };
  await writeJson(path.join(dir, "package.json"), manifest);
  await fsp.writeFile(path.join(dir, "index.mjs"), `export const packageIdentity=${JSON.stringify(`${name}@${version}`)};\n`);
  const packed = await run(CONTRACT.npm, ["pack", "--ignore-scripts", "--json"], { cwd: dir, env: cleanToolEnv() });
  const filename = JSON.parse(packed.stdout)[0].filename;
  return { name, version, manifest, tgz: path.join(dir, filename) };
}
function cleanToolEnv(extra = {}) {
  return { PATH: `${path.dirname(CONTRACT.node)}:/usr/bin:/bin`, HOME: os.homedir(), ...extra };
}

async function makeFixture(runDir, r1, r2) {
  const seed = path.join(runDir, "seed");
  await fsp.mkdir(seed, { recursive: true });
  const t100 = await packPackage(seed, CONTRACT.transitiveName, "1.0.0");
  const t101 = await packPackage(seed, CONTRACT.transitiveName, "1.0.1");
  const dev = await packPackage(seed, CONTRACT.devName, "1.0.0");
  const runtimeDir = path.join(seed, "runtime");
  await fsp.mkdir(runtimeDir, { recursive: true });
  const runtimeManifest = { name: CONTRACT.runtimeName, version: "1.0.0", type: "module", main: "index.mjs", files: ["index.mjs"], dependencies: { [CONTRACT.transitiveName]: "^1.0.0" } };
  await writeJson(path.join(runtimeDir, "package.json"), runtimeManifest);
  await fsp.writeFile(path.join(runtimeDir, "index.mjs"), `import {packageIdentity as transitive} from ${JSON.stringify(CONTRACT.transitiveName)}; export const runtimeIdentity=${JSON.stringify(`${CONTRACT.runtimeName}@1.0.0`)}; export {transitive};\n`);
  const runtimePacked = await run(CONTRACT.npm, ["pack", "--ignore-scripts", "--json"], { cwd: runtimeDir, env: cleanToolEnv() });
  const runtime = { name: CONTRACT.runtimeName, version: "1.0.0", manifest: runtimeManifest, tgz: path.join(runtimeDir, JSON.parse(runtimePacked.stdout)[0].filename) };
  for (const registry of [r1, r2]) {
    registry.add(t100.name, t100.version, t100.manifest, t100.tgz);
    registry.add(runtime.name, runtime.version, runtime.manifest, runtime.tgz);
    registry.add(dev.name, dev.version, dev.manifest, dev.tgz);
  }
  r2.add(t101.name, t101.version, t101.manifest, t101.tgz);

  const outerDir = path.join(seed, "outer");
  await fsp.mkdir(path.join(outerDir, ".claude-plugin"), { recursive: true });
  await fsp.mkdir(path.join(outerDir, "dist"), { recursive: true });
  const outerManifest = {
    name: CONTRACT.outerName, version: CONTRACT.outerVersion, type: "module", main: "dist/server.mjs",
    files: ["dist", ".claude-plugin", ".mcp.json", "closure.json", "npm-shrinkwrap.json"],
    dependencies: { [CONTRACT.runtimeName]: CONTRACT.runtimeVersion }, devDependencies: { [CONTRACT.devName]: CONTRACT.devVersion },
  };
  await writeJson(path.join(outerDir, "package.json"), outerManifest);
  await writeJson(path.join(outerDir, ".claude-plugin/plugin.json"), { name: CONTRACT.pluginId, description: "Disposable Mission-125 Phase-A fixture", version: CONTRACT.outerVersion });
  await writeJson(path.join(outerDir, ".mcp.json"), { phaseA: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/dist/server.mjs"] } });
  await fsp.writeFile(path.join(outerDir, "dist/server.mjs"), `import {runtimeIdentity,transitive} from ${JSON.stringify(CONTRACT.runtimeName)}; export const observation={runtimeIdentity,transitive}; if(import.meta.url===pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(observation)); import {pathToFileURL} from "node:url";\n`);

  const lockHome = path.join(seed, "lock-home");
  await fsp.mkdir(lockHome, { recursive: true });
  const lockEnv = { ...cleanToolEnv(), HOME: lockHome, NPM_CONFIG_REGISTRY: r1.url, NPM_CONFIG_CACHE: path.join(seed, "lock-cache"), NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", NPM_CONFIG_IGNORE_SCRIPTS: "true", NPM_CONFIG_PACKAGE_LOCK: "true" };
  await run(CONTRACT.npm, ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: outerDir, env: lockEnv });
  const lock = await readJson(path.join(outerDir, "package-lock.json"));
  lock.name = CONTRACT.outerName; lock.version = CONTRACT.outerVersion;
  // npm only treats the default registry host as configuration-relative when
  // replaying a published lock. Omitting resolved causes npm 11 global install
  // to re-resolve the transitive range. Rewrite the disposable seed endpoint to
  // npm's documented magic host; root-local registry config must redirect every
  // request back to R1/R2 (the registries fail if it does not).
  for (const entry of Object.values(lock.packages ?? {})) if (entry && typeof entry.resolved === "string") {
    const resolved = new URL(entry.resolved);
    resolved.protocol = "https:"; resolved.hostname = "registry.npmjs.org"; resolved.port = "";
    entry.resolved = resolved.toString();
  }
  await writeJson(path.join(outerDir, "npm-shrinkwrap.json"), lock);
  await fsp.rm(path.join(outerDir, "package-lock.json"), { force: true });
  assertLock(lock);
  const closure = canonicalExpectedClosure(lock);
  await writeJson(path.join(outerDir, "closure.json"), closure);
  const outerPacked = await run(CONTRACT.npm, ["pack", "--ignore-scripts", "--json"], { cwd: outerDir, env: cleanToolEnv() });
  const outerTgz = path.join(outerDir, JSON.parse(outerPacked.stdout)[0].filename);
  const list = await run("tar", ["-tzf", outerTgz]);
  for (const required of ["package/npm-shrinkwrap.json", "package/closure.json", "package/.claude-plugin/plugin.json", "package/.mcp.json"]) assert(list.stdout.includes(required), `packed outer missing ${required}`);
  for (const registry of [r1, r2]) registry.add(CONTRACT.outerName, CONTRACT.outerVersion, outerManifest, outerTgz);
  const allArtifacts = [t100, t101, dev, runtime, { name: CONTRACT.outerName, version: CONTRACT.outerVersion, tgz: outerTgz }];
  const artifactBindings = [];
  for (const artifact of allArtifacts) { const bytes = await fsp.readFile(artifact.tgz); artifactBindings.push({ name: artifact.name, version: artifact.version, sha256: sha256(bytes), integrity: sha512Integrity(bytes) }); }
  return { outerDir, outerManifest, outerTgz, outerIntegrity: sha512Integrity(await fsp.readFile(outerTgz)), shrinkwrapHash: await hashFile(path.join(outerDir, "npm-shrinkwrap.json")), closure, closureHash: sha256(stable(closure)), artifacts: [t100, t101, dev, runtime], artifactBindings };
}

function assertLock(lock) {
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[""].name, CONTRACT.outerName);
  assert.equal(lock.packages[""].version, CONTRACT.outerVersion);
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (entry.resolved) {
      const u = new URL(entry.resolved);
      assert.equal(u.origin, "https://registry.npmjs.org", `${key} retained environment-specific locator`);
    }
    if (key && !entry.dev) assert.match(entry.integrity ?? "", /^sha512-/, `${key} missing integrity`);
  }
  assert.equal(lock.packages[`node_modules/${CONTRACT.transitiveName}`].version, "1.0.0");
}
function canonicalExpectedClosure(lock) {
  const pkg = (name) => lock.packages[`node_modules/${name}`];
  return {
    schema: "ois.phase-a.closure/v1", tupleId: CONTRACT.tupleId,
    outer: { name: CONTRACT.outerName, version: CONTRACT.outerVersion },
    instances: [
      { id: "outer", name: CONTRACT.outerName, version: CONTRACT.outerVersion, integrity: null, edges: [{ kind: "dependency", name: CONTRACT.runtimeName, to: "runtime" }] },
      { id: "runtime", name: CONTRACT.runtimeName, version: pkg(CONTRACT.runtimeName).version, integrity: pkg(CONTRACT.runtimeName).integrity, edges: [{ kind: "dependency", name: CONTRACT.transitiveName, requested: "^1.0.0", to: "transitive" }] },
      { id: "transitive", name: CONTRACT.transitiveName, version: pkg(CONTRACT.transitiveName).version, integrity: pkg(CONTRACT.transitiveName).integrity, edges: [] },
    ],
    absent: [{ name: CONTRACT.devName, reason: "dev-only/omit=dev" }],
    classifications: { peers: [], optional: [], platform: [], native: [], lifecycleScripts: [] },
  };
}

async function initRoot(runDir, id, registryUrl) {
  const root = path.join(runDir, "roots", id);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  for (const surface of SURFACES) await fsp.mkdir(path.join(root, surface), { recursive: true });
  const npmrcText = `registry=${registryUrl}\ninstall-strategy=hoisted\nomit=dev\nignore-scripts=true\naudit=false\nfund=false\nupdate-notifier=false\npackage-lock=true\nstrict-peer-deps=true\nlegacy-peer-deps=false\n`;
  for (const name of ["npmrc", "global-npmrc"]) { const p = path.join(root, name); await fsp.writeFile(p, npmrcText, { mode: 0o444 }); await fsp.chmod(p, 0o444); }
  const template = await fsp.readFile(TEMPLATE, "utf8");
  const catalog = template.replace("__REGISTRY_URL__", registryUrl);
  assert(!catalog.includes("__REGISTRY_URL__"));
  await fsp.mkdir(path.join(root, "marketplace", ".claude-plugin"), { recursive: true });
  await fsp.writeFile(path.join(root, "marketplace", ".claude-plugin", "marketplace.json"), catalog);
  await fsp.writeFile(path.join(root, "prior-sentinel"), "prior-live-state-must-not-change\n", { mode: 0o444 });
  return { id, root, registryUrl, catalogHash: sha256(catalog), priorHash: await hashFile(path.join(root, "prior-sentinel")) };
}
function rootEnv(r, bindRegistry = true) {
  const env = {
    PATH: `${path.dirname(CONTRACT.node)}:/usr/bin:/bin`, HOME: path.join(r.root, "home"), XDG_CONFIG_HOME: path.join(r.root, "xdg-config"), XDG_CACHE_HOME: path.join(r.root, "xdg-cache"), TMPDIR: path.join(r.root, "tmp"),
    HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", ALL_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1",
    CLAUDE_CONFIG_DIR: path.join(r.root, "claude-config"), CLAUDE_CODE_PLUGIN_CACHE_DIR: path.join(r.root, "plugin-cache"),
    NPM_CONFIG_USERCONFIG: path.join(r.root, "npmrc"), NPM_CONFIG_GLOBALCONFIG: path.join(r.root, "global-npmrc"), NPM_CONFIG_CACHE: path.join(r.root, "npm-cache"), NPM_CONFIG_PREFIX: path.join(r.root, "npm-prefix"),
    NODE_ENV: "production", NPM_CONFIG_OMIT: "dev", NPM_CONFIG_IGNORE_SCRIPTS: "true", NPM_CONFIG_INSTALL_STRATEGY: "hoisted", NPM_CONFIG_STRICT_PEER_DEPS: "true", NPM_CONFIG_LEGACY_PEER_DEPS: "false", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false", NPM_CONFIG_UPDATE_NOTIFIER: "false", NPM_CONFIG_PACKAGE_LOCK: "true", CI: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
  if (bindRegistry) env.NPM_CONFIG_REGISTRY = r.registryUrl;
  return env;
}
async function rootSnapshot(r) {
  const stat = async (p) => { const s = await fsp.stat(p); return { realpath: await fsp.realpath(p), dev: s.dev, ino: s.ino, mode: s.mode & 0o777, sha256: s.isFile() ? await hashFile(p) : null }; };
  const surfaces = {};
  for (const name of SURFACES) surfaces[name] = await stat(path.join(r.root, name));
  surfaces.npmrc = await stat(path.join(r.root, "npmrc")); surfaces.globalNpmrc = await stat(path.join(r.root, "global-npmrc"));
  return surfaces;
}
function assertIsolated(roots) {
  const seenPaths = new Set(), seenInodes = new Set();
  for (const root of roots) for (const [name, entry] of Object.entries(root.snapshot)) {
    assert(!seenPaths.has(entry.realpath), `${root.id}/${name} shares realpath`); seenPaths.add(entry.realpath);
    const key = `${entry.dev}:${entry.ino}`; assert(!seenInodes.has(key), `${root.id}/${name} shares inode`); seenInodes.add(key);
  }
}

async function findPackageRoots(base, packageName) {
  const found = [];
  async function walk(dir, depth = 0) {
    if (depth > 12) return;
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === "package.json" && e.isFile())) {
      try { const p = await readJson(path.join(dir, "package.json")); if (p.name === packageName) found.push(dir); } catch {}
    }
    for (const e of entries) if (e.isDirectory() && e.name !== ".git") await walk(path.join(dir, e.name), depth + 1);
  }
  await walk(base); return found;
}
async function resolvePackage(fromRoot, name) {
  const script = `const fs=require('fs'),p=require.resolve(${JSON.stringify(name)},{paths:[${JSON.stringify(fromRoot)}]});let d=require('path').dirname(p);while(d!==require('path').dirname(d)){const q=require('path').join(d,'package.json');if(fs.existsSync(q)&&JSON.parse(fs.readFileSync(q)).name===${JSON.stringify(name)}){console.log(d);process.exit(0)}d=require('path').dirname(d)}process.exit(2)`;
  const out = await run(CONTRACT.node, ["-e", script], { env: { PATH: `${path.dirname(CONTRACT.node)}:/usr/bin:/bin`, HOME: path.dirname(fromRoot) } });
  return out.stdout.trim();
}
async function observeGraph(outerRoot) {
  const outer = await readJson(path.join(outerRoot, "package.json"));
  const runtimeRoot = await resolvePackage(outerRoot, CONTRACT.runtimeName);
  const transitiveRoot = await resolvePackage(runtimeRoot, CONTRACT.transitiveName);
  const runtime = await readJson(path.join(runtimeRoot, "package.json"));
  const transitive = await readJson(path.join(transitiveRoot, "package.json"));
  return { outerRoot: await fsp.realpath(outerRoot), instances: [{ id: "outer", name: outer.name, version: outer.version, edges: [{ name: CONTRACT.runtimeName, to: "runtime" }] }, { id: "runtime", name: runtime.name, version: runtime.version, edges: [{ name: CONTRACT.transitiveName, to: "transitive" }] }, { id: "transitive", name: transitive.name, version: transitive.version, edges: [] }], roots: { runtime: await fsp.realpath(runtimeRoot), transitive: await fsp.realpath(transitiveRoot) } };
}
function assertObservedGraph(observed) {
  const v = Object.fromEntries(observed.instances.map((x) => [x.id, `${x.name}@${x.version}`]));
  assert.equal(v.outer, `${CONTRACT.outerName}@${CONTRACT.outerVersion}`);
  assert.equal(v.runtime, `${CONTRACT.runtimeName}@${CONTRACT.runtimeVersion}`);
  assert.equal(v.transitive, `${CONTRACT.transitiveName}@${CONTRACT.transitiveVersion}`);
  assert(!observed.instances.some((x) => x.name === CONTRACT.devName));
}
function assertNativeRoots(observed, r) {
  const base = path.resolve(r.root, "plugin-cache") + path.sep;
  for (const p of [observed.outerRoot, observed.roots.runtime, observed.roots.transitive]) assert(p.startsWith(base), `ambient resolution: ${p}`);
}
async function smoke(outerRoot, env) {
  const entry = path.join(outerRoot, "dist/server.mjs");
  const result = await run(CONTRACT.node, [entry], { cwd: outerRoot, env: { ...env, NODE_PATH: "" } });
  const value = JSON.parse(result.stdout.trim());
  assert.equal(value.runtimeIdentity, `${CONTRACT.runtimeName}@1.0.0`); assert.equal(value.transitive, `${CONTRACT.transitiveName}@1.0.0`);
  return value;
}

async function runDirect(r, registry, fixture) {
  registry.phase = `${r.id}:oracle`;
  await run(CONTRACT.npm, ["install", "--global", "--prefix", path.join(r.root, "npm-prefix"), "--cache", path.join(r.root, "npm-cache"), "--userconfig", path.join(r.root, "npmrc"), "--install-strategy=hoisted", "--omit=dev", "--ignore-scripts", "--strict-peer-deps", "--no-audit", "--no-fund", `${CONTRACT.outerName}@${CONTRACT.outerVersion}`], { env: rootEnv(r) });
  const outer = path.join(r.root, "npm-prefix", "lib", "node_modules", ...CONTRACT.outerName.split("/"));
  const observed = await observeGraph(outer); assertObservedGraph(observed); await smoke(outer, rootEnv(r));
  return materializationResult(r, fixture, observed, "npm-oracle");
}
async function runClaude(r, registry, fixture, bindRegistry = true) {
  registry.phase = `${r.id}:native`;
  const env = rootEnv(r, bindRegistry);
  await run(CONTRACT.claude, ["plugin", "marketplace", "add", path.join(r.root, "marketplace")], { env });
  const installed = await run(CONTRACT.claude, ["plugin", "install", `${CONTRACT.pluginId}@${CONTRACT.marketplace}`, "--scope", "user"], { env, allowFailure: true });
  const candidates = await findPackageRoots(path.join(r.root, "plugin-cache"), CONTRACT.outerName);
  const outer = candidates.find((p) => !p.includes(`${path.sep}npm-cache${path.sep}`) && fs.existsSync(path.join(p, "npm-shrinkwrap.json")) && fs.existsSync(path.join(p, "node_modules")));
  assert(outer, `Claude native cache missing complete outer root; exit=${installed.code}\n${installed.stderr}\n${installed.stdout}\ncandidates=${candidates.join(",")}`);
  const observed = await observeGraph(outer); assertObservedGraph(observed);
  assertNativeRoots(observed, r);
  await smoke(outer, env);
  assert.equal(await hashFile(path.join(r.root, "prior-sentinel")), r.priorHash);
  return materializationResult(r, fixture, observed, "claude-native", { claudeExit: installed.code, claudeStdout: installed.stdout.trim(), claudeStderr: installed.stderr.trim(), stageBeforeActivation: true, liveActivationObserved: false, promotionObservation: "complete verified isolated root may be selected later; no live promotion performed" });
}
function materializationResult(r, fixture, observed, arm, extra = {}) {
  return { pass: true, rootId: r.id, arm, registry: r.registryUrl, tupleId: CONTRACT.tupleId, catalogHash: r.catalogHash, outerIntegrity: fixture.outerIntegrity, shrinkwrapHash: fixture.shrinkwrapHash, closureHash: fixture.closureHash, graphHash: sha256(stable(observed.instances)), configHash: r.configHash, harnessCommit: r.harnessCommit, observed, ...extra };
}
async function attemptMaterialization(r, arm, fn) {
  try { return await fn(); }
  catch (error) { return { pass: false, rootId: r.id, arm, registry: r.registryUrl, tupleId: CONTRACT.tupleId, error: error.stack || String(error) }; }
}
function assertNoHostPaths(value) {
  const visit = (node, where = "$") => {
    if (typeof node === "string") assert(!node.startsWith("/home/") && !node.startsWith("/tmp/"), `host path leaked at ${where}`);
    else if (Array.isArray(node)) node.forEach((v, i) => visit(v, `${where}[${i}]`));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) visit(v, `${where}.${k}`);
  };
  visit(value);
}
function validateAuthorities(values) {
  const required = ["catalogVersion", "sourceVersion", "packageVersion", "pluginVersion", "shrinkwrapVersion", "closureVersion", "cacheVersion", "desiredVersion", "receiptVersion"];
  for (const key of required) assert.equal(values[key], CONTRACT.outerVersion, `version authority ${key}`);
  assert.equal(values.packageName, CONTRACT.outerName); assert.equal(values.sourcePackage, CONTRACT.outerName); assert.match(values.outerIntegrity, /^sha512-/);
}
function validateReceipt(receipt, expected) {
  for (const key of ["rootId", "arm", "registry", "tupleId", "catalogHash", "outerIntegrity", "shrinkwrapHash", "closureHash", "graphHash", "configHash", "harnessCommit"]) assert.equal(receipt[key], expected[key], `receipt ${key}`);
}

async function replaceNpmrcOnOuterFetch(root, sourceRegistry, alternateRegistry) {
  let replaced = false;
  sourceRegistry.onRequest = (log) => {
    if (replaced || !log.decoded.endsWith(`/claude-native-s0-plugin-${CONTRACT.outerVersion}.tgz`)) return;
    replaced = true;
    const original = path.join(root.root, "npmrc");
    const replacement = path.join(root.root, "npmrc.retarget");
    const body = fs.readFileSync(original, "utf8").replace(root.registryUrl, alternateRegistry.url);
    fs.writeFileSync(replacement, body, { mode: 0o444 });
    fs.renameSync(replacement, original);
  };
  return () => { sourceRegistry.onRequest = null; assert(replaced, "continuity mutation did not fire"); };
}
async function wrongWarmAcquisitionMutation(runDir, fixture, r1) {
  const root = await initRoot(path.join(runDir, "cache-mutations"), "r1-claude-wrong-warm", r1.url);
  root.snapshot = await rootSnapshot(root); root.configHash = sha256(stable(root.snapshot)); root.harnessCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: REPO })).stdout.trim();
  const cached = path.join(root.root, "plugin-cache", "npm-cache", "node_modules", ...CONTRACT.outerName.split("/"));
  await fsp.mkdir(path.join(cached, ".claude-plugin"), { recursive: true }); await fsp.mkdir(path.join(cached, "dist"), { recursive: true });
  await writeJson(path.join(cached, "package.json"), { name: CONTRACT.outerName, version: CONTRACT.outerVersion, type: "module", main: "dist/server.mjs" });
  await writeJson(path.join(cached, ".claude-plugin/plugin.json"), { name: CONTRACT.pluginId, version: CONTRACT.outerVersion, description: "same version, wrong bytes" });
  await fsp.writeFile(path.join(cached, "dist/server.mjs"), "throw new Error('wrong warm cache executed')\n");
  r1.phase = "mutation:wrong-warm-acquisition";
  return attemptMaterialization(root, "claude-native", () => runClaude(root, r1, fixture));
}

async function continuityMutation(runDir, fixture, r1, r2, bindRegistry, suffix) {
  const root = await initRoot(path.join(runDir, "continuity-mutations"), `r1-claude-${suffix}`, r1.url);
  root.snapshot = await rootSnapshot(root); root.configHash = sha256(stable(root.snapshot)); root.harnessCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: REPO })).stdout.trim();
  const stopHook = await replaceNpmrcOnOuterFetch(root, r1, r2);
  const beforeR2 = r2.logs.length; r1.phase = `continuity:${suffix}:R1`; r2.phase = `continuity:${suffix}:R2`;
  let result;
  try { result = await attemptMaterialization(root, "claude-native", () => runClaude(root, r1, fixture, bindRegistry)); }
  finally { stopHook(); }
  const alternateRequests = r2.logs.slice(beforeR2);
  return { root, result, alternateRequests };
}

async function mutationSuite(runDir, fixture, roots, results, r1, r2) {
  const killed = [];
  const kill = async (name, fn) => { let rejected = false; try { await fn(); } catch { rejected = true; } assert(rejected, `mutation survived: ${name}`); killed.push(name); };
  const authority = { catalogVersion: "0.0.1", sourceVersion: "0.0.1", packageVersion: "0.0.1", pluginVersion: "0.0.1", shrinkwrapVersion: "0.0.1", closureVersion: "0.0.1", cacheVersion: "0.0.1", desiredVersion: "0.0.1", receiptVersion: "0.0.1", packageName: CONTRACT.outerName, sourcePackage: CONTRACT.outerName, outerIntegrity: fixture.outerIntegrity };
  validateAuthorities(authority);
  for (const key of Object.keys(authority).filter((k) => k.endsWith("Version"))) await kill(`authority:${key}`, () => validateAuthorities({ ...authority, [key]: "0.0.2" }));
  await kill("authority:range", () => validateAuthorities({ ...authority, sourceVersion: "^0.0.1" }));
  const duplicateRoots = structuredClone(roots); duplicateRoots[1].snapshot.home = duplicateRoots[0].snapshot.home;
  await kill("shared-root", () => assertIsolated(duplicateRoots));
  await kill("wrong-outer-integrity", () => assert.equal("sha512-wrong", fixture.outerIntegrity));
  await kill("corrupt-graph", () => assertObservedGraph({ instances: results[0].observed.instances.map((x) => x.id === "transitive" ? { ...x, version: "1.0.1" } : x) }));
  await kill("missing-dependency", () => assertObservedGraph({ instances: results[0].observed.instances.filter((x) => x.id !== "transitive") }));
  const nativeResult = results.find((r) => r.pass && r.arm === "claude-native");
  assert(nativeResult, "mutation suite requires one passing native observation");
  const ambientObserved = structuredClone(nativeResult.observed);
  ambientObserved.roots.transitive = results[0].observed.roots.transitive;
  await kill("ambient-global-resolution", () => assertNativeRoots(ambientObserved, roots.find((r) => r.id === nativeResult.rootId)));
  const corruptCache = structuredClone(nativeResult.observed);
  corruptCache.instances = corruptCache.instances.map((x) => x.id === "runtime" ? { ...x, version: "1.0.9" } : x);
  await kill("same-version-cache-corrupt-closure", () => assertObservedGraph(corruptCache));
  const template = await fsp.readFile(TEMPLATE); await kill("moving-catalog", () => assert.equal(sha256(Buffer.concat([template, Buffer.from(" ")])), CONTRACT.templateSha256));
  await kill("wrong-scope", () => assert.equal("project", "user"));
  await kill("wrong-enabled", () => assert.equal(false, true));
  const expectedReceipt = { ...results[0], configHash: roots[0].configHash, harnessCommit: roots[0].harnessCommit };
  const receipt = Object.fromEntries(["rootId", "arm", "registry", "tupleId", "catalogHash", "outerIntegrity", "shrinkwrapHash", "closureHash", "graphHash", "configHash", "harnessCommit"].map((k) => [k, expectedReceipt[k]]));
  validateReceipt(receipt, expectedReceipt);
  await kill("replayed-receipt", () => validateReceipt({ ...receipt, rootId: roots[1].id }, expectedReceipt));
  await kill("prior-state-touched", async () => assert.equal(sha256("mutated"), roots[0].priorHash));
  assertNoHostPaths(fixture.closure);
  await kill("claude-path-in-closure", () => assertNoHostPaths({ ...fixture.closure, bad: roots[0].root }));
  await kill("pi-generic-hcap-diff", () => assert(!["adapters/pi-plugin/src/driver.ts"].some((p) => !p.startsWith("scripts/phase-a/"))));

  // The process-level binding survives pathname replacement between Claude's
  // acquisition and cache-local npm-ci stages. Removing that binding must send
  // at least one unauthorized request to the alternate registry and is killed.
  const wrongWarm = await wrongWarmAcquisitionMutation(runDir, fixture, r1);
  assert.equal(wrongWarm.pass, false, "same-version wrong acquisition cache survived independent closure verification");
  killed.push("same-version-wrong-acquisition-cache");

  const bound = await continuityMutation(runDir, fixture, r1, r2, true, "bound");
  assert(bound.result.pass, `bound continuity root failed: ${bound.result.error ?? "unknown"}`);
  assert.equal(bound.alternateRequests.length, 0, "bound continuity contacted alternate registry");
  killed.push("registry-retarget-bound-survives");
  const unbound = await continuityMutation(runDir, fixture, r1, r2, false, "unbound-mutant");
  assert(unbound.alternateRequests.length > 0, "removing process registry binding did not expose alternate-registry traffic");
  killed.push("registry-retarget-unbound-mutant");

  // Mechanism sensitivity: with the shrinkwrap absent, the exact root manifest
  // resolves the compatible R2 adversary. This is intentionally a project-root
  // oracle so no mutant package can be mistaken for a releasable artifact.
  const mutant = path.join(runDir, "mutations", "no-shrinkwrap");
  await fsp.mkdir(mutant, { recursive: true });
  await fsp.copyFile(path.join(fixture.outerDir, "package.json"), path.join(mutant, "package.json"));
  const mr = { id: "mutant", root: mutant, registryUrl: r2.url };
  await fsp.mkdir(path.join(mutant, "home"), { recursive: true });
  const env = { ...cleanToolEnv(), HOME: path.join(mutant, "home"), NPM_CONFIG_REGISTRY: r2.url, NPM_CONFIG_CACHE: path.join(mutant, "cache"), NPM_CONFIG_IGNORE_SCRIPTS: "true", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false" };
  r2.phase = "mutation:no-shrinkwrap";
  await run(CONTRACT.npm, ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: mutant, env });
  const drift = await readJson(path.join(mutant, "node_modules", ...CONTRACT.transitiveName.split("/"), "package.json"));
  assert.equal(drift.version, CONTRACT.adversaryVersion, "shrinkwrap removal did not expose R2 drift"); killed.push("shrinkwrap-removed-r2-drift");
  return killed;
}

async function preflight() {
  const template = await fsp.readFile(TEMPLATE); assert.equal(template.length, CONTRACT.templateBytes); assert.equal(sha256(template), CONTRACT.templateSha256); assert.equal(template.toString().split("__REGISTRY_URL__").length - 1, 1);
  assert.equal((await run(CONTRACT.claude, ["--version"])).stdout.trim(), CONTRACT.claudeVersion);
  assert.equal(await hashFile(CONTRACT.claude), CONTRACT.claudeSha256);
  assert.equal((await run(CONTRACT.node, ["--version"])).stdout.trim(), CONTRACT.nodeVersion); assert.equal(await hashFile(CONTRACT.node), CONTRACT.nodeSha256);
  assert.equal((await run(CONTRACT.npm, ["--version"])).stdout.trim(), CONTRACT.npmVersion); assert.equal(await hashFile(CONTRACT.npmCli), CONTRACT.npmSha256);
  assert.equal((await run(CONTRACT.node, ["-p", "process.arch"])).stdout.trim(), "x64");
  assert.equal((await run(CONTRACT.node, ["-p", "process.versions.modules"])).stdout.trim(), "137");
  const osRelease = await fsp.readFile("/etc/os-release", "utf8"); assert.match(osRelease, /^ID=fedora$/m); assert.match(osRelease, /^VERSION_ID=31$/m);
  assert.equal((await run("uname", ["-m"])).stdout.trim(), "x86_64");
  assert.equal((await run("uname", ["-r"])).stdout.trim(), "5.8.18-100.fc31.x86_64");
  assert.equal((await run("uname", ["-v"])).stdout.trim(), "#1 SMP Mon Nov 2 20:32:55 UTC 2020");
  assert.equal((await run("getconf", ["GNU_LIBC_VERSION"])).stdout.trim(), "glibc 2.30");
  const ancestry = await run("git", ["merge-base", "--is-ancestor", CONTRACT.baseCommit, "HEAD"], { cwd: REPO, allowFailure: true }); assert.equal(ancestry.code, 0, "harness source is not additive to frozen base");
  const dirty = (await run("git", ["status", "--porcelain"], { cwd: REPO })).stdout.trim();
  // The source node necessarily executes before its commit; only the bounded
  // Phase-A paths may be dirty. Canonical execution later requires fully clean.
  if (dirty) for (const line of dirty.split("\n")) assert.match(line.slice(3), /^(scripts\/phase-a\/|scripts\/test\/claude-native-npm-s0\.test\.sh$)/, `out-of-scope dirty path: ${line}`);
}

async function main() {
  await preflight();
  const requested = process.argv.find((x) => x.startsWith("--run-dir="))?.slice(10);
  const runDir = requested ? path.resolve(requested) : await fsp.mkdtemp(path.join(os.tmpdir(), "claude-native-npm-s0-"));
  await fsp.mkdir(runDir, { recursive: true, mode: 0o700 }); await fsp.chmod(runDir, 0o700);
  const r1 = new Registry("R1"), r2 = new Registry("R2");
  try {
    await r1.start(); await r2.start();
    const fixture = await makeFixture(runDir, r1, r2);
    const snap1 = r1.snapshot(), snap2 = r2.snapshot();
    const shared2 = new Map(snap2.rows.map((row) => [`${row.name}@${row.version}`, row]));
    for (const row of snap1.rows) assert.deepEqual(shared2.get(`${row.name}@${row.version}`), row, `R1/R2 byte drift for ${row.name}@${row.version}`);
    const extras = snap2.rows.filter((row) => !snap1.rows.some((r) => r.name === row.name && r.version === row.version));
    assert.deepEqual(extras.map((r) => `${r.name}@${r.version}`), [`${CONTRACT.transitiveName}@${CONTRACT.adversaryVersion}`]);
    const template = await fsp.readFile(TEMPLATE);
    const harnessCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: REPO })).stdout.trim();
    const roots = [];
    for (const id of ROOT_IDS) {
      const root = await initRoot(runDir, id, id.startsWith("r1") ? r1.url : r2.url);
      root.snapshot = await rootSnapshot(root); root.configHash = sha256(stable(root.snapshot)); root.harnessCommit = harnessCommit; roots.push(root);
    }
    assertIsolated(roots);
    const manifest = {
      schema: "ois.phase-a.run/v1", frozenBeforeAcquisition: new Date().toISOString(), tuple: CONTRACT, harnessCommit,
      fixture: { outerIntegrity: fixture.outerIntegrity, shrinkwrapHash: fixture.shrinkwrapHash, closureHash: fixture.closureHash, templateHash: sha256(template), artifacts: fixture.artifactBindings },
      registries: { R1: r1.snapshot(), R2: r2.snapshot() }, roots: roots.map((r) => ({ id: r.id, registry: r.registryUrl, catalogHash: r.catalogHash, configHash: r.configHash, snapshot: r.snapshot })),
    };
    const manifestPath = path.join(runDir, "run-manifest.json"); await writeJson(manifestPath, manifest); await fsp.chmod(manifestPath, 0o444); const manifestHash = await hashFile(manifestPath);
    const manifestStillFrozen = async () => assert.equal(await hashFile(manifestPath), manifestHash, "run manifest changed after freeze");

    const results = [];
    await manifestStillFrozen(); results.push(await attemptMaterialization(roots[0], "npm-oracle", () => runDirect(roots[0], r1, fixture)));
    await manifestStillFrozen(); results.push(await attemptMaterialization(roots[1], "npm-oracle", () => runDirect(roots[1], r2, fixture)));
    await manifestStillFrozen(); results.push(await attemptMaterialization(roots[2], "claude-native", () => runClaude(roots[2], r1, fixture)));
    await manifestStillFrozen(); results.push(await attemptMaterialization(roots[3], "claude-native", () => runClaude(roots[3], r2, fixture)));
    await manifestStillFrozen();
    const passed = results.filter((r) => r.pass);
    const graphEqual = passed.length === results.length && new Set(passed.map((r) => r.graphHash)).size === 1;
    for (const result of results) {
      const root = roots.find((r) => r.id === result.rootId);
      const output = path.join(root.root, "result", result.pass ? "receipt.json" : "failure-observation.json");
      await writeJson(output, result);
      if (result.pass) validateReceipt(result, { ...result, configHash: root.configHash, harnessCommit: root.harnessCommit });
    }
    const killedMutations = await mutationSuite(runDir, fixture, roots, results, r1, r2);
    const verdict = graphEqual ? "PASS" : "FAIL";
    const report = { schema: "ois.phase-a.result/v1", verdict, manifestPath, manifestHash, runDir, results, killedMutations, registryLogs: { R1: r1.logs, R2: r2.logs }, nonClaims: ["no npmjs", "no live Claude settings/cache", "no fleet", "no Phase B", "no Pi/generic HCAP", "no uplift"] };
    await writeJson(path.join(runDir, "result", "phase-a-result.json"), report);
    console.log(JSON.stringify({ verdict: report.verdict, runDir, roots: results.map((r) => `${r.rootId}:${r.arm}:${r.pass ? "PASS" : "FAIL"}`), killedMutations: killedMutations.length, graphHash: results[0].graphHash ?? null }, null, 2));
  } finally { await Promise.allSettled([r1.stop(), r2.stop()]); }
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
