#!/usr/bin/env node
/**
 * scripts/build/assert-pack-contents.js [pkgDir] — pack-contents completeness gate
 * (idea-509 / survey G6; closes bug-255 completeness + locks the bug-254 class).
 *
 * ASSERT that every declared `bin` file is actually PRESENT in the package's npm
 * tarball. A declared bin absent from the pack — dist/ not built, a wrong bin path,
 * or a files[] gap — ships a BROKEN published package whose bin is unresolvable (the
 * bug-244 / #461 class: install succeeds, the CLI entrypoint is missing). This fails
 * it BY CONSTRUCTION before publish, rather than at a consumer's runtime.
 *
 * Mechanism: `npm pack --dry-run --json --ignore-scripts` reports the exact file list
 * the tarball WOULD contain (files[] + .npmignore + on-disk state), WITHOUT writing a
 * tarball and — crucially — WITHOUT running the lifecycle scripts, so it does not
 * re-enter prepack (no recursion) and does not rebuild (the caller already built dist/).
 *
 * Exit 0 = every declared bin is packed (or no bin declared). Exit 1 = a declared bin
 * is absent. Self-contained, no network.
 *
 * Usage: node scripts/build/assert-pack-contents.js [pkgDir]   (default: cwd)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkgDir = resolve(process.argv[2] || process.cwd());

function fail(msg) {
  process.stderr.write(`[pack-contents:assert] FAIL — ${msg}\n`);
  process.exit(1);
}
function ok(msg) {
  process.stderr.write(`[pack-contents:assert] OK — ${msg}\n`);
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf-8"));
} catch {
  fail(`no readable package.json in ${pkgDir}`);
}
const pkgName = typeof pkg.name === "string" ? pkg.name : pkgDir;

// Declared bin target(s), normalized to package-relative posix paths. `bin` is either
// a string (single bin named after the package) or an object of name → path.
const bin = pkg.bin;
const binTargets = (
  typeof bin === "string"
    ? [bin]
    : bin && typeof bin === "object"
      ? Object.values(bin)
      : []
)
  .filter((t) => typeof t === "string" && t.length > 0)
  .map((t) => t.replace(/^\.\//, ""));

if (binTargets.length === 0) {
  ok(`${pkgName}: no declared bin — nothing to assert`);
  process.exit(0);
}

// The file list the tarball WOULD contain. --ignore-scripts => no prepack recursion + no
// rebuild; --dry-run => no tarball written; --json => machine-readable.
let packed;
try {
  const out = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: pkgDir, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
  );
  packed = JSON.parse(out);
} catch (e) {
  fail(`${pkgName}: 'npm pack --dry-run --json' failed (${e?.message ?? e})`);
}

const packedFiles = new Set(
  (Array.isArray(packed) ? packed : [])
    .flatMap((p) => (Array.isArray(p?.files) ? p.files : []))
    .map((f) => String(f?.path ?? "").replace(/^\.\//, "")),
);

const missing = binTargets.filter((t) => !packedFiles.has(t));
if (missing.length > 0) {
  fail(
    `${pkgName}: declared bin(s) ABSENT from the tarball: [${missing.join(", ")}]\n` +
      `  packed files: ${[...packedFiles].sort().join(", ") || "(none)"}\n` +
      `  Build dist/ + ensure files[] includes the bin path before publishing.`,
  );
}
ok(`${pkgName}: all ${binTargets.length} declared bin(s) present in the tarball`);
