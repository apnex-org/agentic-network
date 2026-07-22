#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateClaudeBundleMetafile, validateClaudePackageJson } from "../build/claude-bundle-policy.mjs";
import {
  assertCopiedClaudePluginMatches,
  fileSha512Integrity,
  inspectInstalledClaudePlugin,
} from "../release/verify-claude-plugin-package.mjs";
import { startMinimalMcpHub } from "./fixtures/minimal-mcp-hub.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageDir = join(repo, "adapters", "claude-plugin");
const fixtureCli = join(repo, "scripts", "test", "fixtures", "claude-code-plugin-fixture.mjs");
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const run = (command, args, cwd = repo, env = process.env) => execFileSync(command, args, {
  cwd,
  env,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const mutations = [];
function killMutation(name, callback) {
  assert.throws(callback, undefined, `mutation survived: ${name}`);
  mutations.push(name);
}
async function waitFor(predicate, timeoutMs, failure) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(failure());
}

const dirty = run("git", ["status", "--porcelain"], repo).trim() !== "";
const buildEnv = {
  ...process.env,
  OIS_BUILD_SHA: run("git", ["rev-parse", "HEAD"], repo).trim(),
  OIS_BUILD_TREE: run("git", ["rev-parse", "HEAD^{tree}"], repo).trim(),
  OIS_BUILD_DIRTY: String(dirty),
  SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH || "0",
  ...(dirty ? { OIS_ALLOW_DIRTY_BUILD: "1" } : {}),
};

run(process.execPath, ["scripts/build/build-self-contained-claude-plugin.mjs"], repo, buildEnv);
const firstBuild = {
  shim: sha256(join(packageDir, "dist", "shim.js")),
  seed: sha256(join(packageDir, "dist", "seed-skills.js")),
  metafile: sha256(join(packageDir, "dist", "metafile.json")),
  members: sha256(join(packageDir, "dist", "member-manifest.json")),
};
run(process.execPath, ["scripts/build/build-self-contained-claude-plugin.mjs"], repo, buildEnv);
const secondBuild = {
  shim: sha256(join(packageDir, "dist", "shim.js")),
  seed: sha256(join(packageDir, "dist", "seed-skills.js")),
  metafile: sha256(join(packageDir, "dist", "metafile.json")),
  members: sha256(join(packageDir, "dist", "member-manifest.json")),
};
assert.deepEqual(secondBuild, firstBuild, "repeat Claude build drifted");

const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
validateClaudePackageJson(pkg, "0.1.18");
const tmp = mkdtempSync(join(os.tmpdir(), "claude-plugin-product-path-"));
let hub;
let child;
try {
  const packRoots = [join(tmp, "pack-a"), join(tmp, "pack-b")];
  const packResults = [];
  for (const packRoot of packRoots) {
    cpSync(packageDir, packRoot, {
      recursive: true,
      filter: (source) => !source.includes(`${join(packageDir, "node_modules")}`) && !source.includes(`${join(packageDir, "src")}`) && !source.includes(`${join(packageDir, "test")}`),
    });
    const packOutput = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json"], packRoot));
    assert.equal(packOutput.length, 1);
    const row = packOutput[0];
    const tgz = join(packRoot, row.filename);
    assert.equal(fileSha512Integrity(tgz), row.integrity, "npm-reported integrity differs from acquired tgz bytes");
    packResults.push({ ...row, tgz });
  }
  assert.equal(packResults[0].integrity, packResults[1].integrity, "two-root npm pack integrity drift");

  const installPrefix = join(tmp, "npm-install");
  run("npm", [
    "install",
    packResults[0].tgz,
    `--prefix=${installPrefix}`,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
  ]);
  const installLock = JSON.parse(readFileSync(join(installPrefix, "package-lock.json"), "utf8"));
  assert.equal(Object.keys(installLock.packages).length, 2, "exact package acquired a floating consumer runtime closure");
  const installedRoot = join(installPrefix, "node_modules", "@apnex", "claude-plugin");
  const acquiredProjection = inspectInstalledClaudePlugin(installedRoot, { expectedVersion: "0.1.18", allowDirty: dirty });

  const claudeConfig = join(tmp, "claude-config");
  const fixtureEnv = { ...process.env, CLAUDE_CONFIG_DIR: claudeConfig };
  let claudeHost;
  let addObservation;
  let installObservation;
  let copiedRoot;
  if (process.env.CLAUDE_CLI) {
    const addOutput = run(process.env.CLAUDE_CLI, ["plugin", "marketplace", "add", installedRoot, "--scope", "user"], repo, fixtureEnv);
    const installOutput = run(process.env.CLAUDE_CLI, ["plugin", "install", "agent-adapter@agentic-network", "--scope", "user"], repo, fixtureEnv);
    copiedRoot = join(claudeConfig, "plugins", "cache", "agentic-network", "agent-adapter", "0.1.18");
    assert.ok(existsSync(copiedRoot), "real Claude CLI did not create the exact package cache path");
    claudeHost = "real-claude-cli";
    addObservation = { accepted: /Successfully added marketplace/.test(addOutput) };
    installObservation = { accepted: /Successfully installed plugin/.test(installOutput) };
  } else {
    addObservation = JSON.parse(run(process.execPath, [fixtureCli, "plugin", "marketplace", "add", installedRoot], repo, fixtureEnv));
    installObservation = JSON.parse(run(process.execPath, [fixtureCli, "plugin", "install", "agent-adapter@agentic-network"], repo, fixtureEnv));
    assert.equal(addObservation.marketplace, "agentic-network");
    assert.equal(installObservation.version, "0.1.18");
    copiedRoot = installObservation.destination;
    claudeHost = "claude-cli-fixture";
  }
  assert.equal(addObservation.accepted ?? true, true);
  assert.equal(installObservation.accepted ?? true, true);
  assertCopiedClaudePluginMatches(acquiredProjection, copiedRoot, { expectedVersion: "0.1.18", allowDirty: dirty });

  hub = await startMinimalMcpHub();
  const workDir = join(tmp, "work");
  mkdirSync(join(workDir, ".ois"), { recursive: true });
  let stderr = "";
  let stdout = "";
  child = spawn(process.execPath, [join(copiedRoot, "dist", "shim.js")], {
    cwd: workDir,
    env: {
      ...process.env,
      WORK_DIR: workDir,
      OIS_HUB_URL: hub.url,
      OIS_HUB_TOKEN: "fixture-token",
      OIS_HUB_ROLE: "engineer",
      OIS_AGENT_NAME: "claude-product-smoke",
      OIS_COGNITIVE_BYPASS: "1",
      TRANSPORT_HEARTBEAT_ENABLED: "false",
      OIS_LIVENESS_WATCHDOG_ENABLED: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (bytes) => { stderr += bytes.toString(); });
  child.stdout.on("data", (bytes) => { stdout += bytes.toString(); });
  let childExit = null;
  child.once("exit", (code, signal) => { childExit = { code, signal }; });
  await waitFor(
    () => hub.calls.filter((call) => call.name === "register_role").length >= 2
      && hub.calls.some((call) => call.name === "list_missions")
      && hub.calls.some((call) => call.name === "get_pending_actions")
      && hub.calls.some((call) => call.name === "drain_pending_actions"),
    12_000,
    () => `packaged Claude startup did not complete Hub handshake/sync; exit=${JSON.stringify(childExit)} stderr=${stderr} stdout=${stdout}`,
  );
  assert.equal(childExit, null, `packaged shim exited during Hub smoke: ${JSON.stringify(childExit)}`);

  const authorityMutation = join(tmp, "authority-mismatch");
  cpSync(installedRoot, authorityMutation, { recursive: true });
  const authorityIdentityPath = join(authorityMutation, "dist", "identity.json");
  const authorityIdentity = JSON.parse(readFileSync(authorityIdentityPath, "utf8"));
  authorityIdentity.sourceCommit = "f".repeat(40);
  writeFileSync(authorityIdentityPath, `${JSON.stringify(authorityIdentity, null, 2)}\n`);
  killMutation("source-authority-mismatch", () => inspectInstalledClaudePlugin(authorityMutation, { expectedVersion: "0.1.18", allowDirty: true }));
  killMutation("caller-invented-attestation-authority", () => inspectInstalledClaudePlugin(installedRoot, { expectedVersion: "0.1.18", allowDirty: dirty, publicationAttestation: "caller:invented" }));

  const cacheMutation = join(tmp, "copied-cache-mismatch");
  cpSync(copiedRoot, cacheMutation, { recursive: true });
  const cacheShim = join(cacheMutation, "dist", "shim.js");
  chmodSync(cacheShim, 0o644);
  writeFileSync(cacheShim, `${readFileSync(cacheShim, "utf8")}\n// copied-cache mutation\n`);
  killMutation("copied-cache-package-mismatch", () => assertCopiedClaudePluginMatches(acquiredProjection, cacheMutation, { expectedVersion: "0.1.18", allowDirty: true }));

  const metafile = JSON.parse(readFileSync(join(installedRoot, "dist", "metafile.json"), "utf8"));
  const optionalBranchMutation = structuredClone(metafile);
  optionalBranchMutation.inputs["node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth-extensions.js"] = { bytes: 1, imports: [] };
  killMutation("reachable-auth-extension-without-jose", () => validateClaudeBundleMetafile(optionalBranchMutation));
  killMutation("floating-consumer-dependency", () => validateClaudePackageJson({ ...pkg, dependencies: { jose: "^6.1.3" } }, "0.1.18"));
  killMutation("registry-integrity-mismatch", () => assert.equal(packResults[0].integrity, `sha512-${Buffer.alloc(64).toString("base64")}`));

  const familyPublisher = readFileSync(join(repo, "scripts", "publish-packages.sh"), "utf8");
  const dedicatedWorkflow = readFileSync(join(repo, ".github", "workflows", "publish-claude-plugin.yml"), "utf8");
  assert.ok(!familyPublisher.includes('"@apnex/claude-plugin"'), "legacy family publisher still owns the Claude package");
  for (const required of [
    "claude-plugin-v*",
    "npm publish --workspace=@apnex/claude-plugin --access public --provenance --ignore-scripts",
    "npm pack @apnex/claude-plugin@0.1.18",
    "CLAUDE_EXPECTED_INTEGRITY",
    "workflow_dispatch",
  ]) assert.ok(dedicatedWorkflow.includes(required), `protected Claude workflow missing: ${required}`);

  const observedHubCalls = [...new Set(hub.calls.map((call) => call.name))].sort();
  child.kill("SIGTERM");
  await new Promise((resolveExit) => child.once("exit", resolveExit));
  child = null;
  await hub.close();
  hub = null;

  const observations = {
    package: `${acquiredProjection.packageName}@${acquiredProjection.packageVersion}`,
    npmIntegrity: packResults[0].integrity,
    acquiredTreeSha256: acquiredProjection.treeSha256,
    copiedTreeSha256: inspectInstalledClaudePlugin(copiedRoot, { expectedVersion: "0.1.18", allowDirty: dirty }).treeSha256,
    sourceCommit: acquiredProjection.sourceCommit,
    sourceTree: acquiredProjection.sourceTree,
    cleanIdentity: !acquiredProjection.dirty,
    claudeHost,
    marketplaceAddObserved: true,
    pluginInstallObserved: true,
    hubCalls: observedHubCalls,
    repeatBuild: firstBuild,
    mutationsKilled: mutations.length,
    mutations,
  };
  console.log(JSON.stringify({ pass: true, observations }, null, 2));
} finally {
  if (child) {
    child.kill("SIGKILL");
    await new Promise((resolveExit) => child.once("exit", resolveExit));
  }
  if (hub) await hub.close().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
}
