/**
 * skills-seed-bin.test.ts — runSeedSkills orchestration (hcapskills0 build_claude,
 * design §5): mechanical expand → LIVE fail-closed set-diff gate → converge. Injected
 * deps (a fixture sourceRoot, no git/env), so the full seed path is testable. The
 * gate-fail case is the runtime guarantee for unlink-safety invariant 3b.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runSeedSkills, isInvokedAsMain } from "../src/bin/seed-skills.js";
import { parseWantedBundles } from "../src/skills/manifest.js";
import type { WantedBundles } from "../src/skills/index.js";

let root: string;
let sourceRoot: string;
let skillsDir: string;
let ledgerPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hcap-seed-test-"));
  sourceRoot = join(root, "clone");
  skillsDir = join(root, "config", "skills");
  ledgerPath = join(root, "config", ".hcap-skills-managed.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function makeSkillTree(id: string, withSkillMd = true): void {
  const d = join(sourceRoot, "skills", id);
  mkdirSync(d, { recursive: true });
  if (withSkillMd) writeFileSync(join(d, "SKILL.md"), `# ${id}\n`);
}

const manifest: WantedBundles = {
  sourceRepo: "r",
  sourceRef: "s",
  bundles: [],
  extraSkills: ["alpha", "beta"],
  pruneOrphans: false,
};

describe("runSeedSkills", () => {
  it("happy path: gate passes, converges, materializes the role baseline on disk", () => {
    makeSkillTree("alpha");
    makeSkillTree("beta");

    const r = runSeedSkills({ skillsDir, ledgerPath, role: "engineer", manifest, sourceRoot });

    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(new Set(r.landed)).toEqual(new Set(["alpha", "beta"]));
    expect(existsSync(join(skillsDir, "alpha", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillsDir, "beta", "SKILL.md"))).toBe(true);
    expect(existsSync(ledgerPath)).toBe(true); // durable ledger written
  });

  it("FAIL-CLOSED: a role override that drops an mks-delivered skill trips the gate — no converge", () => {
    makeSkillTree("alpha");
    makeSkillTree("beta");

    const r = runSeedSkills({
      skillsDir,
      ledgerPath,
      role: "engineer",
      manifest, // mks-delivered = {alpha, beta}
      sourceRoot,
      roleSkills: new Map([["engineer", ["alpha"]]]), // role_map drops beta → violation
    });

    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["beta"]);
    // aborted BEFORE any converge/unlink — nothing materialized.
    expect(existsSync(join(skillsDir, "alpha", "SKILL.md"))).toBe(false);
  });

  it("FAIL-CLOSED: a skill whose source tree lacks SKILL.md fails the converge (no partial launch)", () => {
    makeSkillTree("alpha");
    makeSkillTree("beta", /* withSkillMd */ false); // materialize will fault

    const r = runSeedSkills({ skillsDir, ledgerPath, role: "engineer", manifest, sourceRoot });

    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([]); // gate passed; the FAILURE is at converge
  });

  it("idea-521: manifest prune_orphans converges the seat — prunes an on-disk orphan, keeps the baseline", () => {
    makeSkillTree("alpha");
    makeSkillTree("beta");
    // a legacy leftover already on disk (foreign to the HCAP ledger), as post-retire seats carry.
    const orphanDir = join(skillsDir, "legacy-leftover");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "SKILL.md"), "# legacy-leftover\n");

    const r = runSeedSkills({
      skillsDir,
      ledgerPath,
      role: "engineer",
      manifest: { ...manifest, pruneOrphans: true },
      sourceRoot,
    });

    expect(r.ok).toBe(true);
    expect(existsSync(join(skillsDir, "alpha", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillsDir, "beta", "SKILL.md"))).toBe(true);
    // the orphan is swept — estate converged to the wanted-set {alpha, beta}.
    expect(existsSync(join(skillsDir, "legacy-leftover", "SKILL.md"))).toBe(false);
  });

  it("idea-521: default (no prune_orphans) leaves an on-disk orphan intact — firebreak preserved", () => {
    makeSkillTree("alpha");
    makeSkillTree("beta");
    const orphanDir = join(skillsDir, "legacy-leftover");
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, "SKILL.md"), "# legacy-leftover\n");

    const r = runSeedSkills({ skillsDir, ledgerPath, role: "engineer", manifest, sourceRoot });

    expect(r.ok).toBe(true);
    expect(existsSync(join(skillsDir, "legacy-leftover", "SKILL.md"))).toBe(true); // preserved
  });
});

describe("parseWantedBundles — prune_orphans (idea-521)", () => {
  it("parses `prune_orphans: true`", () => {
    const m = parseWantedBundles(
      "source_repo: r\nsource_ref: s\nextra_skills:\n  - a\nprune_orphans: true\n",
    );
    expect(m.pruneOrphans).toBe(true);
    expect(m.extraSkills).toEqual(["a"]);
  });
  it("defaults prune_orphans to false when the key is absent", () => {
    const m = parseWantedBundles("source_repo: r\nsource_ref: s\nextra_skills:\n  - a\n");
    expect(m.pruneOrphans).toBe(false);
  });
  it("treats any non-`true` value as false (fail-safe)", () => {
    const m = parseWantedBundles("source_repo: r\nsource_ref: s\nprune_orphans: no\n");
    expect(m.pruneOrphans).toBe(false);
  });
});

describe("isInvokedAsMain — bug-251 symlink main-guard regression", () => {
  it("resolves main invocation through a SYMLINK (the npm-bin shape), not just direct", () => {
    // Reproduce the npm bin topology: a real compiled module + a `.bin` symlink to it.
    const real = join(root, "seed-skills.js");
    writeFileSync(real, "// compiled bin\n");
    const link = join(root, "ois-seed-skills"); // mirrors node_modules/.bin/<name>
    symlinkSync(real, link);
    const moduleUrl = pathToFileURL(real).href; // import.meta.url resolves to the real file

    // Invoked via the SYMLINK, process.argv[1] is the symlink path — the EXACT bug input.
    // Pre-fix (raw `===`) this was FALSE → main() silently no-op'd → skill delivery lost.
    expect(isInvokedAsMain(moduleUrl, link)).toBe(true);
    // Direct invocation still detected; unrelated / undefined argv[1] → not main.
    expect(isInvokedAsMain(moduleUrl, real)).toBe(true);
    expect(isInvokedAsMain(moduleUrl, join(root, "not-a-file.js"))).toBe(false);
    expect(isInvokedAsMain(moduleUrl, undefined)).toBe(false);
  });
});
