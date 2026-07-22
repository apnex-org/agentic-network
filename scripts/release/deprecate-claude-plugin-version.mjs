#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const EXPECTED_PACKAGE = "@apnex/claude-plugin";
const EXPECTED_VERSION = "0.1.18";
const EXPECTED_SPEC = `${EXPECTED_PACKAGE}@${EXPECTED_VERSION}`;
const EXPECTED_CONFIRMATION = `DEPRECATE_FAILED_QUALIFICATION:${EXPECTED_SPEC}`;
const DEPRECATION_MESSAGE = "Failed post-publication qualification; do not install or reuse this version.";
const REGISTRY = "https://registry.npmjs.org";

function fail(message) {
  throw new Error(message);
}

function requireExact(name, actual, expected) {
  if (actual !== expected) fail(`${name} must equal ${JSON.stringify(expected)}`);
}

function npm(args) {
  const result = spawnSync("npm", [...args, `--registry=${REGISTRY}`], {
    encoding: "utf8",
    env: {
      ...process.env,
      NPM_CONFIG_IGNORE_SCRIPTS: "true",
    },
  });
  if (result.error) fail(`could not execute npm: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "npm command failed").trim();
    fail(`npm ${args[0]} failed: ${detail}`);
  }
  return result.stdout.trim();
}

function jsonScalar(output, label) {
  try {
    const value = JSON.parse(output);
    if (typeof value !== "string") fail(`${label} was not a JSON string`);
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${label} was not valid JSON`);
    throw error;
  }
}

const packageName = process.env.DEPRECATION_PACKAGE ?? "";
const version = process.env.DEPRECATION_VERSION ?? "";
const confirmation = process.env.DEPRECATION_CONFIRMATION ?? "";

requireExact("DEPRECATION_PACKAGE", packageName, EXPECTED_PACKAGE);
requireExact("DEPRECATION_VERSION", version, EXPECTED_VERSION);
requireExact("DEPRECATION_CONFIRMATION", confirmation, EXPECTED_CONFIRMATION);
if (!process.env.NODE_AUTH_TOKEN) fail("NODE_AUTH_TOKEN is required from the protected npm-production environment");

const observedVersion = jsonScalar(
  npm(["view", EXPECTED_SPEC, "version", "--json"]),
  "registry version preflight",
);
requireExact("registry version preflight", observedVersion, EXPECTED_VERSION);

// This is the sole registry mutation in this capability. npm does not permit
// overwriting package bytes; this command only marks the exact failed version.
npm(["deprecate", EXPECTED_SPEC, DEPRECATION_MESSAGE]);

const attempts = Number.parseInt(process.env.DEPRECATION_VERIFY_ATTEMPTS ?? "12", 10);
const delayMs = Number.parseInt(process.env.DEPRECATION_VERIFY_DELAY_MS ?? "5000", 10);
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 12) fail("invalid verification attempt count");
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 5000) fail("invalid verification delay");

let observedDeprecation = "";
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  observedDeprecation = jsonScalar(
    npm(["view", EXPECTED_SPEC, "deprecated", "--json"]),
    "registry deprecation verification",
  );
  if (observedDeprecation === DEPRECATION_MESSAGE) break;
  if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
}
requireExact("registry deprecation verification", observedDeprecation, DEPRECATION_MESSAGE);

console.log(JSON.stringify({
  deprecated: EXPECTED_SPEC,
  message: DEPRECATION_MESSAGE,
  registry: REGISTRY,
  verified: true,
}));
