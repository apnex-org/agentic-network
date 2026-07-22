#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateBuiltRuntimeText,
  validateClaudeBundleMetafile,
  validateClaudePackageJson,
} from "../build/claude-bundle-policy.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha512Integrity = (bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertSafeMemberPath(path) {
  assert.ok(path.length > 0, "empty member path");
  assert.ok(!path.startsWith("/"), `absolute member path: ${path}`);
  assert.ok(!path.includes("\\"), `backslash member path: ${path}`);
  assert.ok(!path.split("/").includes(".."), `parent traversal member path: ${path}`);
}

function walkFiles(root, current = root) {
  const rows = [];
  for (const name of readdirSync(current).sort()) {
    const absolute = join(current, name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`symbolic link is forbidden in installed package: ${absolute}`);
    if (stat.isDirectory()) rows.push(...walkFiles(root, absolute));
    else if (stat.isFile()) rows.push(relative(root, absolute).split(sep).join("/"));
    else throw new Error(`non-regular installed member: ${absolute}`);
  }
  return rows;
}

export function fileSha512Integrity(path) {
  return sha512Integrity(readFileSync(path));
}

export function inspectInstalledClaudePlugin(rootPath, options = {}) {
  const allowedOptions = new Set(["expectedName", "expectedVersion", "allowDirty"]);
  const unknownOptions = Object.keys(options).filter((key) => !allowedOptions.has(key));
  assert.deepEqual(unknownOptions, [], `caller-supplied authority/options are forbidden: ${unknownOptions.join(",")}`);
  const root = resolve(rootPath);
  const pkg = readJson(join(root, "package.json"));
  const expectedVersion = options.expectedVersion ?? pkg.version;
  validateClaudePackageJson(pkg, expectedVersion);
  assert.equal(pkg.name, options.expectedName ?? "@apnex/claude-plugin");

  const plugin = readJson(join(root, ".claude-plugin", "plugin.json"));
  const marketplace = readJson(join(root, ".claude-plugin", "marketplace.json"));
  assert.equal(plugin.version, pkg.version, "Claude plugin version differs from npm package");
  assert.equal(marketplace.plugins?.length, 1, "marketplace must project exactly one plugin");
  assert.equal(marketplace.plugins[0].name, plugin.name, "marketplace/plugin name mismatch");
  assert.equal(marketplace.plugins[0].version, pkg.version, "marketplace/package version mismatch");
  assert.equal(marketplace.plugins[0].source, "./", "marketplace source must be package-relative");

  const identity = readJson(join(root, "dist", "identity.json"));
  assert.equal(identity.packageName, pkg.name, "embedded package name mismatch");
  assert.equal(identity.packageVersion, pkg.version, "embedded package version mismatch");
  assert.match(identity.sourceCommit, /^[0-9a-f]{40}$/, "embedded source commit must be full");
  assert.match(identity.sourceTree, /^[0-9a-f]{40}$/, "embedded source tree must be full");
  if (!options.allowDirty) assert.equal(identity.dirty, false, "published candidate must be clean");

  const metafile = readJson(join(root, "dist", "metafile.json"));
  const derivedFeaturePolicy = validateClaudeBundleMetafile(metafile);
  const recordedFeaturePolicy = readJson(join(root, "dist", "runtime-features.json"));
  assert.deepEqual(recordedFeaturePolicy, derivedFeaturePolicy, "runtime feature disposition is not derived from the bundle graph");
  validateBuiltRuntimeText(readFileSync(join(root, "dist", "shim.js"), "utf8"), recordedFeaturePolicy);
  validateBuiltRuntimeText(readFileSync(join(root, "dist", "seed-skills.js"), "utf8"), recordedFeaturePolicy);

  const manifestPath = join(root, "dist", "member-manifest.json");
  const memberManifest = readJson(manifestPath);
  assert.equal(memberManifest.package, `${pkg.name}@${pkg.version}`);
  const expectedMembers = new Set(["dist/member-manifest.json"]);
  for (const member of memberManifest.files) {
    assertSafeMemberPath(member.path);
    assert.equal(member.type, "file");
    assert.ok(!expectedMembers.has(member.path), `duplicate member: ${member.path}`);
    expectedMembers.add(member.path);
    const absolute = join(root, member.path);
    const stat = statSync(absolute);
    assert.ok(stat.isFile(), `member is not a regular file: ${member.path}`);
    assert.equal(stat.size, member.size, `member size mismatch: ${member.path}`);
    assert.equal(sha256(readFileSync(absolute)), member.sha256, `member hash mismatch: ${member.path}`);
    assert.equal((stat.mode & 0o111) ? "0755" : "0644", member.mode, `member mode mismatch: ${member.path}`);
  }
  const actualMembers = walkFiles(root);
  assert.deepEqual(actualMembers, [...expectedMembers].sort(), "installed package contains missing or unprojected files");

  const projectionRows = actualMembers.map((path) => {
    const absolute = join(root, path);
    const stat = statSync(absolute);
    return {
      path,
      mode: (stat.mode & 0o111) ? "0755" : "0644",
      size: stat.size,
      sha256: sha256(readFileSync(absolute)),
    };
  });
  return {
    schemaVersion: 1,
    packageName: pkg.name,
    packageVersion: pkg.version,
    sourceCommit: identity.sourceCommit,
    sourceTree: identity.sourceTree,
    dirty: identity.dirty,
    memberManifestSha256: sha256(readFileSync(manifestPath)),
    treeSha256: sha256(Buffer.from(JSON.stringify(projectionRows))),
    fileCount: projectionRows.length,
    runtimeFeatures: recordedFeaturePolicy,
  };
}

export function assertCopiedClaudePluginMatches(sourceProjection, copiedRoot, options = {}) {
  const copiedProjection = inspectInstalledClaudePlugin(copiedRoot, options);
  assert.deepEqual(copiedProjection, sourceProjection, "Claude copied cache/package identity differs from the exact acquired package");
  return copiedProjection;
}

async function main() {
  const [command, path, version] = process.argv.slice(2);
  if (command === "inspect" && path && version) {
    console.log(JSON.stringify(inspectInstalledClaudePlugin(path, { expectedVersion: version }), null, 2));
    return;
  }
  if (command === "integrity" && path && !version) {
    console.log(fileSha512Integrity(path));
    return;
  }
  throw new Error("usage: verify-claude-plugin-package.mjs inspect <installed-root> <version> | integrity <tgz>");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
