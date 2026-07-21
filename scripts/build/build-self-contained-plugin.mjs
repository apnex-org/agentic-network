#!/usr/bin/env node
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const kind = process.argv[2];
if (!['claude', 'pi'].includes(kind)) throw new Error('usage: build-self-contained-plugin.mjs <claude|pi>');
const packageDir = join(repo, 'adapters', `${kind}-plugin`);
const pkgPath = join(packageDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const dist = join(packageDir, 'dist');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const full40 = /^[0-9a-f]{40}$/;
const sourceCommit = process.env.OIS_BUILD_SHA || git('rev-parse', 'HEAD');
const sourceTree = process.env.OIS_BUILD_TREE || git('rev-parse', 'HEAD^{tree}');
if (!full40.test(sourceCommit) || !full40.test(sourceTree)) throw new Error('full OIS_BUILD_SHA and OIS_BUILD_TREE are required');
const gitDirty = git('status', '--porcelain') !== '';
if (gitDirty && process.env.OIS_ALLOW_DIRTY_BUILD !== '1') throw new Error('self-contained build requires a clean source tree');
if (process.env.OIS_BUILD_DIRTY && process.env.OIS_BUILD_DIRTY !== 'false') throw new Error('OIS_BUILD_DIRTY must be false');
const sourceEpoch = process.env.SOURCE_DATE_EPOCH || '0';
if (!/^\d+$/.test(sourceEpoch)) throw new Error('SOURCE_DATE_EPOCH must be an integer');
const buildTime = new Date(Number(sourceEpoch) * 1000).toISOString();
const esbuildPkg = JSON.parse(readFileSync(join(repo, 'node_modules/esbuild/package.json'), 'utf8'));
const esbuildBin = join(repo, 'node_modules/@esbuild/linux-x64/bin/esbuild');
if (!existsSync(esbuildBin)) throw new Error(`pinned esbuild binary absent: ${esbuildBin}`);
const identity = {
  schemaVersion: 1,
  packageName: pkg.name,
  packageVersion: pkg.version,
  sourceCommit,
  sourceTree,
  dirty: false,
  sourceEpoch,
  buildTime,
  nodeVersion: process.version,
  npmVersion: execFileSync(process.env.NPM_CLI_JS ? process.execPath : 'npm', process.env.NPM_CLI_JS ? [process.env.NPM_CLI_JS, '--version'] : ['--version'], { encoding: 'utf8' }).trim(),
  bundlerVersion: esbuildPkg.version,
  bundlerSha256: sha256(readFileSync(esbuildBin)),
  target: 'node24',
  format: 'esm',
  splitting: false,
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const alias = {
  '@apnex/network-adapter': join(repo, 'packages/network-adapter/src/index.ts'),
  '@apnex/cognitive-layer': join(repo, 'packages/cognitive-layer/src/index.ts'),
  '@apnex/message-router': join(repo, 'packages/message-router/src/index.ts'),
};
const externals = kind === 'pi' ? ['@earendil-works/pi-tui', 'typebox'] : [];
const entries = kind === 'claude'
  ? { shim: join(packageDir, 'src/shim.ts'), 'seed-skills': join(repo, 'packages/network-adapter/src/bin/seed-skills.ts') }
  : { index: join(packageDir, 'src/index.ts'), 'seed-skills': join(repo, 'packages/network-adapter/src/bin/seed-skills.ts') };
const result = await build({
  absWorkingDir: repo,
  entryPoints: entries,
  outdir: dist,
  entryNames: '[name]',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  splitting: false,
  sourcemap: false,
  metafile: true,
  legalComments: 'none',
  alias,
  external: externals,
  define: { __OIS_EMBEDDED_IDENTITY__: JSON.stringify(JSON.stringify(identity)) },
  logLevel: 'warning',
});

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortDeep(value[k])]));
  return value;
}
const canonicalMeta = sortDeep(result.metafile);
writeFileSync(join(dist, 'metafile.json'), `${JSON.stringify(canonicalMeta, null, 2)}\n`);
writeFileSync(join(dist, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
writeFileSync(join(dist, 'build-info.json'), `${JSON.stringify({ commitSha: sourceCommit, dirty: false, buildTime, branch: 'canonical' }, null, 2)}\n`);
writeFileSync(join(dist, 'unsupported-features.json'), `${JSON.stringify({ schemaVersion: 1, unsupported: ['mcp-client-auth-extensions-jose'], policy: 'fail-closed-before-use' }, null, 2)}\n`);
copyFileSync(join(repo, 'LICENSE'), join(packageDir, 'LICENSE'));

function packageNameFromInput(input) {
  const marker = `node_modules${sep}`;
  const native = resolve(repo, input);
  const i = native.lastIndexOf(marker);
  if (i < 0) return null;
  const rest = native.slice(i + marker.length).split(sep);
  return rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
}
const dependencyNames = [...new Set(Object.keys(result.metafile.inputs).map(packageNameFromInput).filter(Boolean))].sort();
const lock = JSON.parse(readFileSync(join(repo, 'package-lock.json'), 'utf8'));
const licenseDir = join(dist, 'licenses');
mkdirSync(licenseDir, { recursive: true });
const components = [];
for (const name of dependencyNames) {
  const root = join(repo, 'node_modules', ...name.split('/'));
  const depPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const licenseFile = readdirSync(root).find((f) => /^licen[cs]e(?:\.|$)/i.test(f));
  if (!licenseFile) throw new Error(`bundled dependency has no license file: ${name}`);
  const outName = `${name.replaceAll('/', '__')}@${depPkg.version}.txt`;
  copyFileSync(join(root, licenseFile), join(licenseDir, outName));
  const lockRow = lock.packages?.[`node_modules/${name}`] || {};
  components.push({ name, version: depPkg.version, license: depPkg.license || 'NOASSERTION', integrity: lockRow.integrity || null, licenseFile: `dist/licenses/${outName}` });
}
const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `${pkg.name}@${pkg.version}`,
  documentNamespace: `https://ois.local/spdx/${encodeURIComponent(pkg.name)}/${pkg.version}/${sourceCommit}`,
  creationInfo: { created: buildTime, creators: ['Tool: ois-self-contained-builder/1'] },
  packages: components.map((c, i) => ({ SPDXID: `SPDXRef-Package-${i + 1}`, name: c.name, versionInfo: c.version, licenseConcluded: c.license, licenseDeclared: c.license, checksums: c.integrity ? [{ algorithm: 'SHA512', checksumValue: Buffer.from(c.integrity.replace(/^sha512-/, ''), 'base64').toString('hex') }] : [], filesAnalyzed: false })),
};
writeFileSync(join(dist, 'sbom.spdx.json'), `${JSON.stringify(sbom, null, 2)}\n`);
const notices = ['# Third-party notices', '', `Generated from the exact bundle metafile for ${pkg.name}@${pkg.version}.`, '', ...components.flatMap((c) => [`## ${c.name}@${c.version}`, `License: ${c.license}`, `Integrity: ${c.integrity || 'NOASSERTION'}`, `Full text: ${c.licenseFile}`, ''])].join('\n');
writeFileSync(join(packageDir, 'THIRD_PARTY_NOTICES.md'), `${notices}\n`);

chmodSync(join(dist, 'seed-skills.js'), 0o755);
function walk(root, prefix = '') {
  const rows = [];
  for (const name of readdirSync(root).sort()) {
    const abs = join(root, name); const rel = prefix ? `${prefix}/${name}` : name; const st = statSync(abs);
    if (st.isDirectory()) rows.push(...walk(abs, rel));
    else if (st.isFile()) rows.push({ path: rel, type: 'file', mode: (st.mode & 0o111) ? '0755' : '0644', size: st.size, sha256: sha256(readFileSync(abs)) });
    else throw new Error(`unsupported member type: ${rel}`);
  }
  return rows;
}
const rootMembers = ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'agent-adapter.manifest.json'];
if (kind === 'claude') rootMembers.push('.mcp.json', '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json');
const files = [];
for (const relPath of rootMembers.sort()) {
  const abs = join(packageDir, relPath); if (!existsSync(abs)) throw new Error(`declared asset absent: ${relPath}`);
  const st = statSync(abs); files.push({ path: relPath, type: 'file', mode: '0644', size: st.size, sha256: sha256(readFileSync(abs)) });
}
files.push(...walk(dist, 'dist').filter((r) => r.path !== 'dist/member-manifest.json'));
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = { schemaVersion: 1, package: `${pkg.name}@${pkg.version}`, selfRule: 'member-manifest.json excluded; its hash is bound by npm dist.integrity and AVR', files };
writeFileSync(join(dist, 'member-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ package: `${pkg.name}@${pkg.version}`, identity, entries: Object.keys(entries), externals, bundledDependencies: dependencyNames, files: files.length }));
