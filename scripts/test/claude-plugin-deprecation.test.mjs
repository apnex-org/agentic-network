#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const script = join(repo, "scripts", "release", "deprecate-claude-plugin-version.mjs");
const workflowPath = join(repo, ".github", "workflows", "deprecate-claude-plugin.yml");
const ciPath = join(repo, ".github", "workflows", "test.yml");
const expectedSpec = "@apnex/claude-plugin@0.1.19";
const expectedTag = "claude-plugin-v0.1.19";
const expectedMessage = "Failed post-publication qualification; do not install or reuse this version.";
const expectedConfirmation = `DEPRECATE_FAILED_QUALIFICATION:${expectedSpec}`;
const tmp = mkdtempSync(join(os.tmpdir(), "claude-plugin-deprecation-"));
const fakeBin = join(tmp, "bin");
const fakeNpm = join(fakeBin, "npm");

try {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(fakeBin, { recursive: true }));
  writeFileSync(fakeNpm, `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify(args) + "\\n");
const command = args[0];
const field = args[2];
if (command === "view" && field === "version") {
  if (process.env.FAKE_NPM_MODE === "missing") { console.error("E404"); process.exit(1); }
  console.log(JSON.stringify("0.1.19"));
  process.exit(0);
}
if (command === "deprecate") {
  if (process.env.FAKE_NPM_MODE === "deprecate-fails") { console.error("E401"); process.exit(1); }
  writeFileSync(process.env.FAKE_NPM_STATE, "deprecated");
  process.exit(0);
}
if (command === "view" && field === "deprecated") {
  const verified = existsSync(process.env.FAKE_NPM_STATE) && process.env.FAKE_NPM_MODE !== "verify-mismatch";
  console.log(JSON.stringify(verified ? ${JSON.stringify(expectedMessage)} : ""));
  process.exit(0);
}
console.error("unexpected npm command", JSON.stringify(args));
process.exit(2);
`);
  chmodSync(fakeNpm, 0o755);

  let caseId = 0;
  function runCase(overrides = {}) {
    caseId += 1;
    const log = join(tmp, `npm-${caseId}.log`);
    const state = join(tmp, `state-${caseId}`);
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      NODE_AUTH_TOKEN: "fixture-token",
      DEPRECATION_PACKAGE: "@apnex/claude-plugin",
      DEPRECATION_VERSION: "0.1.19",
      DEPRECATION_TAG: expectedTag,
      DEPRECATION_CONFIRMATION: expectedConfirmation,
      DEPRECATION_VERIFY_ATTEMPTS: "1",
      DEPRECATION_VERIFY_DELAY_MS: "0",
      FAKE_NPM_LOG: log,
      FAKE_NPM_STATE: state,
      ...overrides,
    };
    if (overrides.NODE_AUTH_TOKEN === null) delete env.NODE_AUTH_TOKEN;
    const result = spawnSync(process.execPath, [script], { cwd: repo, env, encoding: "utf8" });
    const calls = readFileSync(log, { encoding: "utf8", flag: "a+" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { result, calls };
  }

  const positive = runCase();
  assert.equal(positive.result.status, 0, positive.result.stderr);
  assert.deepEqual(positive.calls.map((args) => [args[0], args[2]]), [
    ["view", "version"],
    ["deprecate", expectedMessage],
    ["view", "deprecated"],
  ]);
  assert.equal(positive.calls.filter((args) => args[0] === "deprecate").length, 1);
  assert.ok(positive.calls.every((args) => args.includes("--registry=https://registry.npmjs.org")));
  assert.equal(JSON.parse(positive.result.stdout).verified, true);

  for (const [name, override] of [
    ["package", { DEPRECATION_PACKAGE: "@apnex/pi-plugin" }],
    ["stale-version-0.1.18", { DEPRECATION_VERSION: "0.1.18" }],
    ["stale-tag-0.1.18", { DEPRECATION_TAG: "claude-plugin-v0.1.18" }],
    ["stale-confirmation-0.1.18", { DEPRECATION_CONFIRMATION: "DEPRECATE_FAILED_QUALIFICATION:@apnex/claude-plugin@0.1.18" }],
    ["credential", { NODE_AUTH_TOKEN: null }],
  ]) {
    const rejected = runCase(override);
    assert.notEqual(rejected.result.status, 0, `${name} mutation survived`);
    assert.equal(rejected.calls.length, 0, `${name} mutation reached npm`);
  }

  const missing = runCase({ FAKE_NPM_MODE: "missing" });
  assert.notEqual(missing.result.status, 0, "missing exact registry version survived");
  assert.equal(missing.calls.filter((args) => args[0] === "deprecate").length, 0);

  const mutationFailure = runCase({ FAKE_NPM_MODE: "deprecate-fails" });
  assert.notEqual(mutationFailure.result.status, 0, "failed registry mutation was ignored");
  assert.equal(mutationFailure.calls.length, 2);

  const verificationFailure = runCase({ FAKE_NPM_MODE: "verify-mismatch" });
  assert.notEqual(verificationFailure.result.status, 0, "registry verification mismatch survived");
  assert.equal(verificationFailure.calls.filter((args) => args[0] === "deprecate").length, 1);

  const workflow = readFileSync(workflowPath, "utf8");
  for (const required of [
    "workflow_dispatch:",
    "environment: npm-production",
    "contents: read",
    "registry-url: 'https://registry.npmjs.org'",
    "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
    "DEPRECATION_PACKAGE: ${{ inputs.package }}",
    "DEPRECATION_VERSION: ${{ inputs.version }}",
    "DEPRECATION_TAG: ${{ inputs.tag }}",
    "DEPRECATION_CONFIRMATION: ${{ inputs.confirmation }}",
    "node scripts/release/deprecate-claude-plugin-version.mjs",
  ]) assert.ok(workflow.includes(required), `workflow missing ${required}`);
  for (const exactBinding of [
    "default: '0.1.19'",
    "default: 'claude-plugin-v0.1.19'",
    "Type DEPRECATE_FAILED_QUALIFICATION:@apnex/claude-plugin@0.1.19",
    "group: deprecate-claude-plugin-0.1.19",
  ]) assert.ok(workflow.includes(exactBinding), `workflow missing exact 0.1.19 binding: ${exactBinding}`);
  assert.ok(!workflow.includes("0.1.18"), "stale 0.1.18 binding survived in workflow");
  assert.ok(!workflow.includes("id-token: write"), "deprecation workflow has broader identity permission");
  assert.ok(!/npm\s+(publish|unpublish|dist-tag)/.test(workflow), "deprecation workflow contains a publication/overwrite path");
  assert.ok(!/^\s+(push|pull_request):/m.test(workflow), "deprecation mutation is not manual-dispatch-only");

  const ci = readFileSync(ciPath, "utf8");
  assert.ok(ci.includes("node scripts/test/claude-plugin-deprecation.test.mjs"), "deprecation contract is not CI-gated");

  console.log(JSON.stringify({
    pass: true,
    exactSpec: expectedSpec,
    confirmation: expectedConfirmation,
    positiveNpmCalls: positive.calls.length,
    negativeCases: 8,
    soleMutation: "npm deprecate",
    registryVerification: true,
    publicationPathPresent: false,
  }, null, 2));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
