/**
 * skills-seed-bin.test.ts — runSeedSkills orchestration (hcapskills0 build_claude,
 * design §5): mechanical expand → LIVE fail-closed set-diff gate → converge. Injected
 * deps (a fixture sourceRoot, no git/env), so the full seed path is testable. The
 * gate-fail case is the runtime guarantee for unlink-safety invariant 3b.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSeedSkills } from "../src/bin/seed-skills.js";
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
});
