/**
 * skill-actuator.ts — SkillActuator (piuplift0 p1): the HARNESS-NEUTRAL SKILLS
 * `ResourceActuatorPort` impl. A filesystem SKILL.md-tree materializer parameterized by an
 * INJECTED `skillsDir` (node:fs only, NO harness SDK) — the SAME universal class seeds every
 * harness that discovers SKILL.md from a config dir: claude ($CLAUDE_CONFIG_DIR/skills) AND
 * pi ($PI_CODING_AGENT_DIR/skills), each via the headless seed bin with its own injected dir.
 * (Renamed from ClaudeSkillActuator — it was ALREADY harness-neutral, so a per-harness
 * subclass would be redundant duplication; the fs mechanism is not in the name.)
 *
 * RUNTIME-FREE by construction — node:fs only, NO harness SDK — which is what lets the
 * headless seed bin materialize skills before/without the harness runtime (design §5).
 * The SOLE coupling is to the SKILL.md-tree shape (fs layout); skill-isms live here,
 * NEVER in control-plane/ (the import-boundary test guards it).
 *
 * COEXISTENCE UNLINK SAFETY (design §9 firebreak; the load-bearing fleet-safety
 * property during coexist with legacy `mission_kit_sync`, which writes the SAME dir):
 *   1. The managed ledger is DURABLE (injected `SkillLedgerPort`; the bin file-backs
 *      it) — a fresh headless process each launch reconstructs its managed set.
 *   2. Removal is STRICTLY ledger-scoped: the unlink set is `managed \ managedEnabled`,
 *      iterated over the persisted ledger — NEVER `readdir`. The actuator is
 *      structurally incapable of unlinking a path it did not itself materialize
 *      (bootstrap / user / mission_kit_sync skills are not in the ledger → untouchable).
 *   3. Materialize is merge-copy (mkdir -p + recursive force copy), mirroring
 *      `mission_kit_sync`'s `cp` — a shared-name collision writes identical pinned
 *      content, never a split-brain.
 *
 * Seed-time materialize is race-free (the bin completes before `exec claude`, so the
 * watcher is not yet running). Atomic temp-dir+rename is a DEFERRED refinement only
 * the future mid-session dynamic path needs.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type {
  ResourceActuatorPort,
  ResourceSpec,
  ConvergeResult,
  ManagedObservation,
} from "../control-plane/contracts.js";
import type { SkillDefinition, SkillLedgerPort } from "./contracts.js";

export interface SkillActuatorDeps {
  /** the seat's skills root — $CLAUDE_CONFIG_DIR/skills (INJECTED by the bin; the
   *  shared package never reads env). Must exist (the bin creates it cold). */
  skillsDir: string;
  /** durable managed-set persistence (invariant 1). */
  ledger: SkillLedgerPort;
  /** idea-521 (opt-in, default false): CONVERGE-PRUNE — after the ledger-scoped removal,
   *  also unlink any on-disk skill entry (a dir with SKILL.md) NOT in the wanted-set, so
   *  the seat converges to EXACTLY the delivered baseline (sweeps orphaned/legacy
   *  leftovers a retired mission_kit_sync left behind). This is the ONLY readdir-based
   *  removal and it is OFF by default — the default path keeps the strictly-ledger-scoped
   *  coexistence firebreak (invariant 2) fully intact. */
  pruneOrphans?: boolean;
  log?: (msg: string) => void;
}

export class SkillActuator implements ResourceActuatorPort {
  private readonly skillsDir: string;
  private readonly ledger: SkillLedgerPort;
  private readonly log: (msg: string) => void;
  /** idea-521 opt-in converge-prune (default false); see SkillActuatorDeps. */
  private readonly pruneOrphans: boolean;
  /** the DURABLE managed ledger, in memory for this pass — seeded from persistence at
   *  construct, written back after every converge. The ONLY set removal may touch. */
  private readonly managed: Set<string>;

  constructor(deps: SkillActuatorDeps) {
    this.skillsDir = deps.skillsDir;
    this.ledger = deps.ledger;
    this.log = deps.log ?? (() => {});
    this.pruneOrphans = deps.pruneOrphans ?? false;
    this.managed = new Set(this.ledger.read());
  }

  converge(desired: readonly ResourceSpec[]): ConvergeResult {
    const managedEnabled = desired.filter((s) => s.enabled).map((s) => s.name);
    const managedEnabledSet = new Set(managedEnabled);

    try {
      // Level 1 — MATERIALIZE every enabled declared skill (merge-copy, idempotent).
      // A materialize fault (missing source tree, unwritable target) is an actuation
      // fault → status:"failed" so the seed bin can fail-closed (abort launch).
      for (const spec of desired) {
        if (!spec.enabled) continue;
        this.materialize(spec.name, spec.definition as SkillDefinition);
        this.managed.add(spec.name); // ledger records only what we actually wrote
      }

      // Level 2 — REMOVE the set-subtraction, STRICTLY ledger-scoped (invariant 2):
      // `managed \ managedEnabled` — a skill THIS actuator materialized in a prior
      // pass that is no longer desired-enabled. We iterate the persisted ledger, NEVER
      // readdir, so a foreign/bootstrap/mission_kit_sync skill (absent from the ledger)
      // can never be unlinked. The set-diff gate (role_map ⊇ mks-delivered) is the
      // second guarantee that an mks-delivered skill is never in this set.
      for (const name of [...this.managed]) {
        if (managedEnabledSet.has(name)) continue;
        this.unlink(name);
        this.managed.delete(name);
      }

      // Level 3 — CONVERGE-PRUNE (idea-521, OPT-IN via `pruneOrphans`): converge the seat
      // to EXACTLY the wanted-set by removing any on-disk skill entry not in it. This is
      // the ONLY readdir-based removal — it exists to sweep ORPHANS the ledger-scoped
      // removal structurally can't reach (e.g. a legacy mission_kit_sync skill dropped
      // from the baseline once mission_kit_sync itself is retired). DEFAULT OFF ⇒ the
      // coexistence firebreak (invariant 2) is untouched. Safe-by-construction guards:
      // (a) only entries that are a directory WITH a SKILL.md — never the ledger sidecar
      // (it lives outside skillsDir) nor stray files; (b) NEVER a wanted/baseline skill
      // (managedEnabled is skipped). Orphans are adopt-and-pruned (dropped from the ledger
      // too) so ledger and disk stay coherent.
      if (this.pruneOrphans) {
        for (const name of this.readSkillDirsOnDisk()) {
          if (managedEnabledSet.has(name)) continue; // baseline — never prune
          this.pruneOrphan(name);
          this.managed.delete(name);
        }
      }
    } catch (err) {
      // persist whatever we durably achieved before the fault (no ledger/disk skew).
      this.ledger.write([...this.managed]);
      return {
        status: "failed",
        klass: "actuate-failed",
        detail: (err as Error)?.message ?? String(err),
        desiredManaged: managedEnabled,
      };
    }

    this.ledger.write([...this.managed]);

    // Observe the MANAGED subset fresh off DISK (readdir ∩ managed). The filesystem is
    // synchronous + authoritative, so a successful materialize is observable this pass
    // → converged (no next-turn latency like pi; the claude WATCHER's async pickup is
    // the harness's concern, not the actuator's convergence signal).
    const observedManaged = this.readManagedOnDisk();
    const status = sameSet(observedManaged, managedEnabled) ? "converged" : "pending";
    return { status, desiredManaged: managedEnabled };
  }

  observeManaged(): ManagedObservation {
    return {
      observedManaged: this.readManagedOnDisk(),
      managedNames: [...this.managed],
    };
  }

  /** merge-copy sourceDir → skillsDir/<name>/ (mkdir -p + recursive force copy). */
  private materialize(name: string, def: SkillDefinition): void {
    const sourceDir = def?.sourceDir;
    if (typeof sourceDir !== "string" || sourceDir.length === 0) {
      throw new Error(`skill '${name}': definition.sourceDir missing`);
    }
    if (!existsSync(join(sourceDir, "SKILL.md"))) {
      throw new Error(
        `skill '${name}': source tree has no SKILL.md (${sourceDir}) — refusing to materialize an empty skill`,
      );
    }
    const dest = join(this.skillsDir, name);
    mkdirSync(dest, { recursive: true });
    cpSync(sourceDir, dest, { recursive: true, force: true });
    this.log(`[hcap-skills] materialized '${name}' → ${dest}`);
  }

  /** unlink skillsDir/<name>/ — only ever called for a name IN the managed ledger. */
  private unlink(name: string): void {
    const dest = join(this.skillsDir, name);
    rmSync(dest, { recursive: true, force: true });
    this.log(`[hcap-skills] unlinked managed skill '${name}' (no longer desired)`);
  }

  /** idea-521 converge-prune: rm an ORPHANED on-disk skill dir not in the wanted-set.
   *  Only reachable under the `pruneOrphans` opt-in; the caller has already excluded the
   *  baseline and confirmed the entry is a SKILL.md-bearing directory. */
  private pruneOrphan(name: string): void {
    const dest = join(this.skillsDir, name);
    rmSync(dest, { recursive: true, force: true });
    this.log(`[hcap-skills] pruned orphaned skill '${name}' (not in wanted-set)`);
  }

  /** every on-disk entry under skillsDir that is a DIRECTORY holding a SKILL.md — a
   *  claude-visible skill (idea-521 converge-prune scope). Unlike readManagedOnDisk this
   *  is NOT ledger-filtered (it must see orphans); it is only ever called under the
   *  pruneOrphans opt-in. A missing skillsDir yields []. */
  private readSkillDirsOnDisk(): string[] {
    let entries: string[];
    try {
      entries = readdirSync(this.skillsDir);
    } catch {
      return [];
    }
    return entries.filter(
      (name) =>
        isDir(join(this.skillsDir, name)) &&
        existsSync(join(this.skillsDir, name, "SKILL.md")),
    );
  }

  /** the managed-scoped on-disk observation: dirs under skillsDir that hold a SKILL.md
   *  AND are in our managed ledger. Never reports foreign/bootstrap/legacy skills. */
  private readManagedOnDisk(): string[] {
    let entries: string[];
    try {
      entries = readdirSync(this.skillsDir);
    } catch {
      return []; // skillsDir absent (cold seat pre-mkdir) → nothing observed yet.
    }
    return entries.filter(
      (name) =>
        this.managed.has(name) &&
        isDir(join(this.skillsDir, name)) &&
        existsSync(join(this.skillsDir, name, "SKILL.md")),
    );
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Order-independent set equality over string name lists. */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}
