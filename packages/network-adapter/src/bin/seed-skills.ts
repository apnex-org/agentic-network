#!/usr/bin/env node
/**
 * bin/seed-skills.ts — the SEED-TIME headless FAIL-CLOSED skills entrypoint
 * (hcapskills0 build_claude, design §5). A network-adapter bin the ois claude_seed
 * invokes in the `mission_kit_sync` slot: it materializes a role's declared skill
 * baseline into $CLAUDE_CONFIG_DIR/skills BEFORE `exec claude`, headless (no claude
 * runtime), and ABORTS the launch loudly (non-zero) on any converge failure — NEVER
 * `exec claude` with a partial baseline (matching mission_kit_sync's fail-closed cp).
 *
 * THE INTEGRATION POINT: ALL env/ois-layout/git coupling lives HERE (guardrail 2), so
 * the shared skills module (actuator + source) stays fs/env/git-free — the bin reads
 * env, parses the ois manifest, clones the pinned source, and INJECTS concrete paths.
 * `runSeedSkills` is the injected-deps orchestration core (testable without git/env);
 * `main` is the env/git wrapper.
 *
 * COEXIST (design §9): this runs ALONGSIDE the legacy mission_kit_sync (behind the
 * launch flag in ois), never retiring it. The LIVE set-diff gate (below) is what keeps
 * coexist from clobbering an mks skill at runtime under manifest drift.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SpecStore } from "../control-plane/spec-store.js";
import { ReconcileLoop } from "../control-plane/reconcile-loop.js";
import { SkillActuator } from "../skills/skill-actuator.js";
import { FileSkillLedger } from "../skills/file-skill-ledger.js";
import { RoleSkillSource } from "../skills/role-skill-source.js";
import {
  parseWantedBundles,
  parseBundleSkills,
  expandWantedBundles,
  type WantedBundles,
} from "../skills/manifest.js";
import { missingFromRoleMap } from "../skills/set-diff-gate.js";

export interface SeedSkillsDeps {
  /** the seat's skills root ($CLAUDE_CONFIG_DIR/skills) — created cold if absent. */
  skillsDir: string;
  /** the durable managed-ledger sidecar path (kept OUTSIDE skillsDir). */
  ledgerPath: string;
  /** the role whose baseline to land (for the set-diff gate + per-role sets). */
  role: string;
  /** the parsed wanted-bundles manifest. */
  manifest: WantedBundles;
  /** the root of the pinned-source CLONE (contains skills/<id>/ + bundles/<b>.yaml). */
  sourceRoot: string;
  /** optional static role→skills OVERRIDES (the future per-role config surface). Slice-1
   *  passes none → role-agnostic (role_map = the manifest expansion = mks-delivered). A
   *  role override that DROPS an mks skill trips the live set-diff gate below. */
  roleSkills?: ReadonlyMap<string, readonly string[]>;
  log?: (msg: string) => void;
}

export interface SeedSkillsResult {
  ok: boolean;
  reason: string;
  /** the mks-delivered skills missing from role_map (non-empty ⇒ gate FAILED). */
  missing: string[];
  landed: string[];
}

/**
 * The orchestration core (injected deps; no env/git). Runs: mechanical bundle-expand →
 * LIVE fail-closed set-diff gate (role_map ⊇ mks-delivered) → converge via the neutral
 * loop + SkillActuator. Returns ok=false on gate violation OR non-converged
 * (the caller fail-closes the launch).
 */
export function runSeedSkills(deps: SeedSkillsDeps): SeedSkillsResult {
  const log = deps.log ?? (() => {});
  const readBundleSkills = (bundle: string): string[] => {
    const bf = join(deps.sourceRoot, "bundles", `${bundle}.yaml`);
    if (!existsSync(bf)) {
      throw new Error(`bundle '${bundle}' not found (bundles/${bundle}.yaml)`);
    }
    return parseBundleSkills(readFileSync(bf, "utf8"));
  };

  // MECHANICAL expansion — the same derivation mission_kit_sync uses, so mks-delivered
  // and role_map both descend from this manifest (design §5).
  const expanded = expandWantedBundles(deps.manifest, readBundleSkills);
  const source = new RoleSkillSource({
    defaultSkills: expanded, // slice-1: role-agnostic (mirrors mks); per-role generalizes
    roleSkills: deps.roleSkills,
    sourceDirFor: (id) => join(deps.sourceRoot, "skills", id),
  });

  const roleSkills = source.skillIdsForRole(deps.role);
  const mksDelivered = expanded; // what legacy mission_kit_sync would copy for this seat

  // ── LIVE, FAIL-CLOSED set-diff gate (invariant 3b; design §8.2). role_map MUST be a
  //    superset of mks-delivered, or the actuator's ledger-scoped removal could unlink
  //    an mks skill dropped from role_map. Enforced at RUNTIME (not just CI) so it holds
  //    under manifest drift — abort BEFORE any converge/unlink.
  const missing = missingFromRoleMap(roleSkills, mksDelivered);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `set-diff gate VIOLATED for role '${deps.role}': role_map is missing mission_kit_sync-delivered skills [${missing.join(", ")}] — aborting to protect the coexisting legacy baseline`,
      missing,
      landed: [],
    };
  }

  // Cold-seat root + empty ledger are created here (the watcher precondition: the skills
  // root pre-exists once cp is gone).
  mkdirSync(deps.skillsDir, { recursive: true });

  const ledger = new FileSkillLedger(deps.ledgerPath);
  const actuator = new SkillActuator({
    skillsDir: deps.skillsDir,
    ledger,
    log,
    // idea-521: opt-in converge-prune, driven by the manifest `prune_orphans` field.
    pruneOrphans: deps.manifest.pruneOrphans,
  });
  const store = new SpecStore();
  const loop = new ReconcileLoop({ store, actuator }, { log });

  store.apply(source.specsForRole(deps.role));
  const outcome = loop.sync("seed-skills");

  if (!outcome.converged) {
    return {
      ok: false,
      reason: `skills converge did NOT reach converged (klass=${outcome.klass ?? "?"}${outcome.detail ? `: ${outcome.detail}` : ""}) — refusing to launch with a partial baseline`,
      missing: [],
      landed: [...actuator.observeManaged().observedManaged],
    };
  }

  return {
    ok: true,
    reason: `seeded ${roleSkills.length} skill(s) for role '${deps.role}'`,
    missing: [],
    landed: [...actuator.observeManaged().observedManaged],
  };
}

/**
 * The per-seat config-dir env var each harness roots its sovereign dir under. There is NO
 * universal naming convention — claude uses CLAUDE_CONFIG_DIR, pi uses PI_CODING_AGENT_DIR
 * (NOT PI_CONFIG_DIR) — so OIS_HARNESS is mapped EXPLICITLY here. A new harness adds one
 * entry; the ois seat exports that same var (guardrail 2: env/ois-layout coupling lives in
 * this bin, not smeared across the shell).
 */
const HARNESS_CONFIG_DIR_ENV: Readonly<Record<string, string>> = {
  claude: "CLAUDE_CONFIG_DIR",
  pi: "PI_CODING_AGENT_DIR",
};

/**
 * Harness-neutral config-dir selector (piuplift0 p1): OIS_HARNESS selects its mapped env
 * var (e.g. pi → PI_CODING_AGENT_DIR), falling back to CLAUDE_CONFIG_DIR for back-compat so
 * the claude seed path stays byte-identical (with OIS_HARNESS unset this returns
 * CLAUDE_CONFIG_DIR exactly). An unmapped harness also falls back to CLAUDE_CONFIG_DIR.
 */
export function harnessConfigDir(env: NodeJS.ProcessEnv): string | undefined {
  const harness = env.OIS_HARNESS?.trim().toLowerCase();
  const key = harness ? HARNESS_CONFIG_DIR_ENV[harness] : undefined;
  const selected = key ? env[key] : undefined;
  return selected || env.CLAUDE_CONFIG_DIR;
}

/** env/git wrapper: read env, parse the manifest, clone the pinned source, delegate. */
function main(argv: string[]): number {
  const log = (m: string): void => console.error(m);
  const configDir = harnessConfigDir(process.env);
  const skillsDir =
    argv[2] ?? // explicit positional — unchanged, still wins (the live ois seed path)
    process.env.HCAP_SKILLS_DIR ?? // neutral explicit override
    (configDir ? join(configDir, "skills") : undefined);
  const manifestPath = process.env.HCAP_SKILLS_MANIFEST;
  const role = process.env.OIS_ROLE ?? process.env.OIS_AGENT_ROLE ?? "unknown";
  const ledgerPath =
    process.env.HCAP_SKILLS_LEDGER ??
    (configDir ? join(configDir, ".hcap-skills-managed.json") : undefined);

  if (!skillsDir) {
    log("[hcap-skills] FATAL: no skills dir (arg1, HCAP_SKILLS_DIR, or <HARNESS>_CONFIG_DIR/CLAUDE_CONFIG_DIR)");
    return 2;
  }
  if (!manifestPath || !existsSync(manifestPath)) {
    log(`[hcap-skills] FATAL: manifest not found (HCAP_SKILLS_MANIFEST=${manifestPath})`);
    return 2;
  }
  if (!ledgerPath) {
    log("[hcap-skills] FATAL: no ledger path (HCAP_SKILLS_LEDGER or <HARNESS>_CONFIG_DIR/CLAUDE_CONFIG_DIR)");
    return 2;
  }

  const manifest = parseWantedBundles(readFileSync(manifestPath, "utf8"));
  const repo = process.env.SKILL_SYNC_REPO ?? manifest.sourceRepo;
  const ref = process.env.SKILL_SYNC_REF ?? manifest.sourceRef;
  if (!repo || !ref) {
    log("[hcap-skills] FATAL: manifest missing source_repo / source_ref (pin required)");
    return 2;
  }

  let clone: string | undefined;
  try {
    clone = mkdtempSync(join(tmpdir(), "hcap-skills-"));
    execFileSync("git", ["clone", "--quiet", repo, clone], { stdio: ["ignore", "ignore", "inherit"] });
    execFileSync("git", ["-C", clone, "checkout", "--quiet", ref], { stdio: ["ignore", "ignore", "inherit"] });

    const result = runSeedSkills({
      skillsDir,
      ledgerPath,
      role,
      manifest,
      sourceRoot: clone,
      log,
    });

    if (!result.ok) {
      log(`[hcap-skills] ABORT (fail-closed): ${result.reason}`);
      return 1;
    }
    log(`[hcap-skills] OK: ${result.reason} from ${repo}@${ref} → ${skillsDir}`);
    return 0;
  } catch (err) {
    log(`[hcap-skills] ABORT (fail-closed): ${(err as Error)?.message ?? String(err)}`);
    return 1;
  } finally {
    if (clone) rmSync(clone, { recursive: true, force: true });
  }
}

/**
 * True iff this module is the process entrypoint — robust to SYMLINK invocation
 * (bug-251). The npm bin `ois-seed-skills` is a symlink, so `process.argv[1]` is the
 * symlink path while `import.meta.url` is the real file; a raw `===` mismatches and
 * `main()` silently no-ops (the fleet rollout invokes via that symlink → skill delivery
 * would silently vanish). realpath-normalize BOTH sides so they compare canonical paths.
 * Guarded for a missing/unresolvable argv[1] (e.g. under a test importer).
 */
export function isInvokedAsMain(
  moduleUrl: string,
  argv1: string | undefined,
): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

// Run only when invoked as a script (not when imported by a test) — symlink-safe.
if (isInvokedAsMain(import.meta.url, process.argv[1])) {
  process.exit(main(process.argv));
}
