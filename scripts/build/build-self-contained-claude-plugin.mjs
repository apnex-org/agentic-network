#!/usr/bin/env node
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateBuiltRuntimeText,
  validateClaudeBundleMetafile,
  validateClaudePackageJson,
} from "./claude-bundle-policy.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageDir = join(repo, "adapters", "claude-plugin");
const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const dist = join(packageDir, "dist");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const full40 = /^[0-9a-f]{40}$/;

validateClaudePackageJson(pkg, "0.1.20");
const sourceCommit = process.env.OIS_BUILD_SHA || git("rev-parse", "HEAD");
const sourceTree = process.env.OIS_BUILD_TREE || git("rev-parse", "HEAD^{tree}");
if (!full40.test(sourceCommit) || !full40.test(sourceTree)) {
  throw new Error("full OIS_BUILD_SHA and OIS_BUILD_TREE are required");
}
const gitDirty = git("status", "--porcelain") !== "";
if (gitDirty && process.env.OIS_ALLOW_DIRTY_BUILD !== "1") {
  throw new Error("Claude package build requires a clean source tree");
}
if (process.env.OIS_BUILD_DIRTY !== undefined && process.env.OIS_BUILD_DIRTY !== String(gitDirty)) {
  throw new Error(`OIS_BUILD_DIRTY=${process.env.OIS_BUILD_DIRTY} disagrees with observed dirty=${gitDirty}`);
}
const sourceEpoch = process.env.SOURCE_DATE_EPOCH || "0";
if (!/^\d+$/.test(sourceEpoch)) throw new Error("SOURCE_DATE_EPOCH must be an integer");
const buildTime = new Date(Number(sourceEpoch) * 1000).toISOString();
const esbuildPkg = JSON.parse(readFileSync(join(repo, "node_modules", "esbuild", "package.json"), "utf8"));
if (esbuildPkg.version !== "0.28.0") throw new Error(`esbuild must be 0.28.0, observed ${esbuildPkg.version}`);
const esbuildBin = join(repo, "node_modules", "@esbuild", "linux-x64", "bin", "esbuild");
if (!existsSync(esbuildBin)) throw new Error(`pinned esbuild binary absent: ${esbuildBin}`);

const identity = {
  schemaVersion: 1,
  packageName: pkg.name,
  packageVersion: pkg.version,
  sourceCommit,
  sourceTree,
  dirty: gitDirty,
  sourceEpoch,
  buildTime,
  nodeVersion: process.version,
  npmVersion: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
  bundlerVersion: esbuildPkg.version,
  bundlerSha256: sha256(readFileSync(esbuildBin)),
  target: "node24",
  format: "esm",
  splitting: false,
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const result = await build({
  absWorkingDir: repo,
  entryPoints: {
    shim: join(packageDir, "src", "shim.ts"),
    "seed-skills": join(repo, "packages", "network-adapter", "src", "bin", "seed-skills.ts"),
  },
  outdir: dist,
  entryNames: "[name]",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  splitting: false,
  sourcemap: false,
  metafile: true,
  legalComments: "none",
  alias: {
    "@apnex/network-adapter": join(repo, "packages", "network-adapter", "src", "index.ts"),
    "@apnex/cognitive-layer": join(repo, "packages", "cognitive-layer", "src", "index.ts"),
    "@apnex/message-router": join(repo, "packages", "message-router", "src", "index.ts"),
  },
  external: [],
  define: {
    __OIS_EMBEDDED_IDENTITY__: JSON.stringify(JSON.stringify(identity)),
  },
  logLevel: "warning",
});

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
  }
  return value;
}

const canonicalMeta = sortDeep(result.metafile);
const featurePolicy = validateClaudeBundleMetafile(canonicalMeta);
for (const output of ["shim.js", "seed-skills.js"]) {
  validateBuiltRuntimeText(readFileSync(join(dist, output), "utf8"), featurePolicy);
}
writeFileSync(join(dist, "metafile.json"), `${JSON.stringify(canonicalMeta, null, 2)}\n`);
writeFileSync(join(dist, "identity.json"), `${JSON.stringify(identity, null, 2)}\n`);
writeFileSync(join(dist, "runtime-features.json"), `${JSON.stringify(featurePolicy, null, 2)}\n`);
writeFileSync(
  join(dist, "build-info.json"),
  `${JSON.stringify({ commitSha: sourceCommit, dirty: gitDirty, buildTime, branch: "canonical" }, null, 2)}\n`,
);
copyFileSync(join(repo, "LICENSE"), join(packageDir, "LICENSE"));

function packageNameFromInput(input) {
  const marker = `node_modules${sep}`;
  const native = resolve(repo, input);
  const index = native.lastIndexOf(marker);
  if (index < 0) return null;
  const rest = native.slice(index + marker.length).split(sep);
  return rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
}

const dependencyNames = [...new Set(
  Object.keys(result.metafile.inputs).map(packageNameFromInput).filter(Boolean),
)].sort();
const lock = JSON.parse(readFileSync(join(repo, "package-lock.json"), "utf8"));
const licenseDir = join(dist, "licenses");
mkdirSync(licenseDir, { recursive: true });
const components = [];
for (const name of dependencyNames) {
  const root = join(repo, "node_modules", ...name.split("/"));
  const depPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const licenseFile = readdirSync(root).find((file) => /^licen[cs]e(?:\.|$)/i.test(file));
  if (!licenseFile) throw new Error(`bundled dependency has no license file: ${name}`);
  const outName = `${name.replaceAll("/", "__")}@${depPkg.version}.txt`;
  copyFileSync(join(root, licenseFile), join(licenseDir, outName));
  const lockRow = lock.packages?.[`node_modules/${name}`] || {};
  components.push({
    name,
    version: depPkg.version,
    license: depPkg.license || "NOASSERTION",
    integrity: lockRow.integrity || null,
    licenseFile: `dist/licenses/${outName}`,
  });
}
const sbom = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `${pkg.name}@${pkg.version}`,
  documentNamespace: `https://ois.local/spdx/${encodeURIComponent(pkg.name)}/${pkg.version}/${sourceCommit}`,
  creationInfo: { created: buildTime, creators: ["Tool: ois-claude-bundle-builder/1"] },
  packages: components.map((component, index) => ({
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name: component.name,
    versionInfo: component.version,
    licenseConcluded: component.license,
    licenseDeclared: component.license,
    checksums: component.integrity ? [{
      algorithm: "SHA512",
      checksumValue: Buffer.from(component.integrity.replace(/^sha512-/, ""), "base64").toString("hex"),
    }] : [],
    filesAnalyzed: false,
  })),
};
writeFileSync(join(dist, "sbom.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
const notices = [
  "# Third-party notices",
  "",
  `Generated from the exact Claude bundle metafile for ${pkg.name}@${pkg.version}.`,
  "",
  ...components.flatMap((component) => [
    `## ${component.name}@${component.version}`,
    `License: ${component.license}`,
    `Integrity: ${component.integrity || "NOASSERTION"}`,
    `Full text: ${component.licenseFile}`,
    "",
  ]),
].join("\n");
writeFileSync(join(packageDir, "THIRD_PARTY_NOTICES.md"), notices.endsWith("\n") ? notices : `${notices}\n`);

chmodSync(join(dist, "seed-skills.js"), 0o755);
function walk(root, prefix = "") {
  const rows = [];
  for (const name of readdirSync(root).sort()) {
    const absolute = join(root, name);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    const stat = statSync(absolute);
    if (stat.isDirectory()) rows.push(...walk(absolute, relativePath));
    else if (stat.isFile()) {
      rows.push({
        path: relativePath,
        type: "file",
        mode: (stat.mode & 0o111) ? "0755" : "0644",
        size: stat.size,
        sha256: sha256(readFileSync(absolute)),
      });
    } else throw new Error(`unsupported package member: ${relativePath}`);
  }
  return rows;
}

const rootMembers = [
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
  ".mcp.json",
  "LICENSE",
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "agent-adapter.manifest.json",
  "package.json",
];
const files = [];
for (const relativePath of rootMembers) {
  const absolute = join(packageDir, relativePath);
  if (!existsSync(absolute)) throw new Error(`declared package asset absent: ${relativePath}`);
  const stat = statSync(absolute);
  files.push({ path: relativePath, type: "file", mode: "0644", size: stat.size, sha256: sha256(readFileSync(absolute)) });
}
files.push(...walk(dist, "dist").filter((row) => row.path !== "dist/member-manifest.json"));
files.sort((left, right) => left.path.localeCompare(right.path));
const memberManifest = {
  schemaVersion: 1,
  package: `${pkg.name}@${pkg.version}`,
  selfRule: "dist/member-manifest.json is excluded from its own projection; npm dist.integrity binds it",
  files,
};
writeFileSync(join(dist, "member-manifest.json"), `${JSON.stringify(memberManifest, null, 2)}\n`);

console.log(JSON.stringify({
  package: `${pkg.name}@${pkg.version}`,
  identity,
  entries: ["shim", "seed-skills"],
  featurePolicy,
  bundledDependencies: dependencyNames,
  files: files.length,
}));
