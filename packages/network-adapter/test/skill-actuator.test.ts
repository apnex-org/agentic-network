/**
 * skill-actuator.test.ts — SkillActuator fs behavior + the COEXISTENCE
 * UNLINK-SAFETY invariants (hcapskills0 build_claude; renamed harness-neutral in piuplift0 p1). These are the load-bearing
 * fleet-safety properties the pi-boundary golden master can't see — the backstop's
 * precise watch. Real temp dirs (no mocks): the actuator writes/unlinks actual
 * SKILL.md trees, and we assert on the disk + the durable ledger.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SkillActuator,
  FileSkillLedger,
  type SkillLedgerPort,
} from "../src/skills/index.js";
import type { ResourceSpec } from "../src/control-plane/index.js";

let root: string;
let skillsDir: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hcap-skills-test-"));
  skillsDir = join(root, "config", "skills");
  sourceRoot = join(root, "src");
  mkdirSync(skillsDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** create a source SKILL.md tree under sourceRoot/skills/<id>/ and return its dir. */
function makeSource(id: string, body = `# ${id}\nskill ${id}\n`): string {
  const d = join(sourceRoot, "skills", id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "SKILL.md"), body);
  return d;
}
function skill(id: string, enabled = true): ResourceSpec {
  return { name: id, definition: { sourceDir: makeSource(id) }, enabled };
}
function onDisk(id: string): boolean {
  return existsSync(join(skillsDir, id, "SKILL.md"));
}

/** in-memory ledger for the pure-logic tests. */
class MemLedger implements SkillLedgerPort {
  private names: string[] = [];
  constructor(seed: string[] = []) {
    this.names = [...seed];
  }
  read(): string[] {
    return [...this.names];
  }
  write(n: readonly string[]): void {
    this.names = [...n];
  }
}

describe("SkillActuator — materialize + observe", () => {
  it("materializes enabled declared skills onto disk; observe is managed-scoped", () => {
    const act = new SkillActuator({ skillsDir, ledger: new MemLedger() });
    const r = act.converge([skill("a"), skill("b"), skill("c", false)]);
    expect(r.status).toBe("converged");
    expect(onDisk("a")).toBe(true);
    expect(onDisk("b")).toBe(true);
    // c is declared-inactive → never materialized.
    expect(onDisk("c")).toBe(false);
    expect(new Set(act.observeManaged().observedManaged)).toEqual(new Set(["a", "b"]));
  });

  it("materialize is an idempotent merge-copy (converge twice = same converged state)", () => {
    const act = new SkillActuator({ skillsDir, ledger: new MemLedger() });
    act.converge([skill("a")]);
    const r2 = act.converge([skill("a")]);
    expect(r2.status).toBe("converged");
    expect(onDisk("a")).toBe(true);
  });

  it("fails (not throws) when a source tree has no SKILL.md — drives the bin fail-closed", () => {
    const emptyDir = join(sourceRoot, "skills", "empty");
    mkdirSync(emptyDir, { recursive: true }); // no SKILL.md inside
    const act = new SkillActuator({ skillsDir, ledger: new MemLedger() });
    const r = act.converge([
      { name: "empty", definition: { sourceDir: emptyDir }, enabled: true },
    ]);
    expect(r.status).toBe("failed");
    expect(r.klass).toBe("actuate-failed");
  });
});

describe("SkillActuator — coexistence unlink-safety invariants", () => {
  it("INVARIANT 2: never unlinks a FOREIGN skill absent from the ledger", () => {
    // a foreign/bootstrap/mission_kit_sync skill lands on disk NOT via this actuator.
    const foreign = join(skillsDir, "foreign");
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "SKILL.md"), "# foreign\n");

    const act = new SkillActuator({ skillsDir, ledger: new MemLedger() });
    act.converge([skill("a")]); // manages only "a"

    // foreign survives (removal is ledger-scoped; foreign was never in the ledger) …
    expect(onDisk("foreign")).toBe(true);
    // … and never shows up as managed drift.
    expect(act.observeManaged().observedManaged).not.toContain("foreign");
  });

  it("removal is ledger-scoped: a dropped MANAGED skill unlinks; a co-present one stays", () => {
    const act = new SkillActuator({ skillsDir, ledger: new MemLedger() });
    act.converge([skill("mks"), skill("other")]);
    expect(onDisk("mks")).toBe(true);
    expect(onDisk("other")).toBe(true);

    // drop "other" but keep "mks" → only "other" is unlinked; "mks" survives.
    const r = act.converge([skill("mks")]);
    expect(r.status).toBe("converged");
    expect(onDisk("mks")).toBe(true);
    expect(onDisk("other")).toBe(false);
  });

  it("INVARIANT 1: the durable ledger persists removal authority ACROSS launches", () => {
    const ledgerPath = join(root, ".hcap-skills-managed.json");

    // launch 1: a fresh process materializes a + b, persists the ledger, exits.
    const act1 = new SkillActuator({
      skillsDir,
      ledger: new FileSkillLedger(ledgerPath),
    });
    act1.converge([skill("a"), skill("b")]);
    expect(onDisk("a")).toBe(true);
    expect(onDisk("b")).toBe(true);

    // launch 2: a BRAND-NEW actuator+ledger reads the sidecar → reconstructs managed
    // {a,b}; dropping b now unlinks it (an in-memory ledger could not have done this).
    const act2 = new SkillActuator({
      skillsDir,
      ledger: new FileSkillLedger(ledgerPath),
    });
    expect(new Set(act2.observeManaged().managedNames)).toEqual(new Set(["a", "b"]));
    act2.converge([skill("a")]);
    expect(onDisk("a")).toBe(true);
    expect(onDisk("b")).toBe(false); // durable cross-launch removal
  });

  it("a cold/absent ledger unlinks NOTHING (safe direction: orphans, never missing)", () => {
    // pre-existing on-disk skill, empty ledger (cold seat) → converge a DIFFERENT set.
    const pre = join(skillsDir, "pre-existing");
    mkdirSync(pre, { recursive: true });
    writeFileSync(join(pre, "SKILL.md"), "# pre\n");

    const act = new SkillActuator({ skillsDir, ledger: new MemLedger() });
    act.converge([skill("a")]);
    // nothing outside the (empty→{a}) ledger is touched.
    expect(onDisk("pre-existing")).toBe(true);
    expect(onDisk("a")).toBe(true);
  });
});

describe("SkillActuator — idea-521 converge-prune (pruneOrphans opt-in)", () => {
  /** land a skill tree straight on disk (as legacy mission_kit_sync / a foreign source
   *  would) — NOT via this actuator, so it is absent from the ledger. */
  function putOnDisk(id: string): void {
    const d = join(skillsDir, id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "SKILL.md"), `# ${id}\n`);
  }

  it("pruneOrphans:true converges the seat to EXACTLY the wanted-set — sweeps orphans the ledger can't reach", () => {
    // the fleetskills0 residual: legacy leftovers on disk, absent from the HCAP ledger.
    putOnDisk("research-artefacts");
    putOnDisk("substrate-audit");

    const act = new SkillActuator({
      skillsDir,
      ledger: new MemLedger(),
      pruneOrphans: true,
    });
    const r = act.converge([skill("arc-lifecycle"), skill("survey")]);

    expect(r.status).toBe("converged");
    // baseline (the wanted-set) present + untouched …
    expect(onDisk("arc-lifecycle")).toBe(true);
    expect(onDisk("survey")).toBe(true);
    // … and the orphaned legacy leftovers are pruned — estate converged to the wanted-set.
    expect(onDisk("research-artefacts")).toBe(false);
    expect(onDisk("substrate-audit")).toBe(false);
  });

  it("pruneOrphans defaults OFF — an orphan survives (coexistence firebreak intact)", () => {
    putOnDisk("legacy-leftover");
    const act = new SkillActuator({ skillsDir, ledger: new MemLedger() }); // no opt-in
    act.converge([skill("arc-lifecycle")]);
    expect(onDisk("arc-lifecycle")).toBe(true);
    expect(onDisk("legacy-leftover")).toBe(true); // NOT pruned by default (invariant 2)
  });

  it("converge-prune NEVER removes a wanted/baseline skill, even alongside pruned orphans", () => {
    putOnDisk("orphan");
    const act = new SkillActuator({
      skillsDir,
      ledger: new MemLedger(),
      pruneOrphans: true,
    });
    act.converge([skill("keep-me")]);
    expect(onDisk("keep-me")).toBe(true); // baseline untouched
    expect(onDisk("orphan")).toBe(false); // orphan swept
  });

  it("converge-prune touches only SKILL.md-bearing dirs — a non-skill directory is left alone", () => {
    const notASkill = join(skillsDir, "not-a-skill");
    mkdirSync(notASkill, { recursive: true });
    writeFileSync(join(notASkill, "README.md"), "# not a skill\n"); // no SKILL.md
    const act = new SkillActuator({
      skillsDir,
      ledger: new MemLedger(),
      pruneOrphans: true,
    });
    act.converge([skill("a")]);
    expect(existsSync(join(skillsDir, "not-a-skill", "README.md"))).toBe(true);
  });

  it("prune is durable-ledger-coherent: an adopted orphan is dropped from the managed set", () => {
    putOnDisk("orphan");
    const ledger = new MemLedger();
    const act = new SkillActuator({ skillsDir, ledger, pruneOrphans: true });
    act.converge([skill("a")]);
    // the pruned orphan must not linger in the persisted managed set.
    expect(ledger.read()).not.toContain("orphan");
    expect(new Set(ledger.read())).toEqual(new Set(["a"]));
  });
});
