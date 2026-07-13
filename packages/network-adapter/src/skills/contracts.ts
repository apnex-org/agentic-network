/**
 * skills/contracts.ts — skills-kind-LOCAL types (hcapskills0 build_claude). These are
 * NOT part of the neutral control-plane/ core; they carry the skill-ism (a skill is a
 * directory TREE materialized on a filesystem claude watches). The neutral core sees
 * only `ResourceSpec` with an OPAQUE `definition` — here we pin what that opaque
 * payload IS for the skills kind, and the ledger the actuator scopes itself with.
 *
 * Home rule (ratified 2026-07-13): an actuator lives at the LOWEST layer that can
 * express its coupling. `ClaudeSkillActuator` is contract-coupled but RUNTIME-FREE
 * (node:fs to a path claude watches; no claude SDK) → it lives in the shared package
 * as a control-plane/ SIBLING, reachable by the headless seed bin — which is exactly
 * what lets §5's entrypoint materialize skills before/without the claude runtime.
 */

/**
 * The opaque `ResourceSpec.definition` payload for a skill: WHERE its SKILL.md tree is
 * read from. The seed bin resolves this (a path inside the pinned-source clone); the
 * actuator only materializes it (fs copy) — git/clone never enters the actuator.
 */
export interface SkillDefinition {
  /** absolute path to the source `skills/<name>/` tree (contains SKILL.md; depth:2). */
  sourceDir: string;
}

/**
 * Persistence for the managed-skill LEDGER — the skill-ids THIS actuator has
 * materialized. It scopes observe + removal to our OWN set, so a foreign/bootstrap
 * skill or a legacy `mission_kit_sync`-copied skill is never mistaken for drift nor
 * unlinked (the coexist firebreak, design §9). Cold seat ⇒ `read()` returns `[]`
 * (the ledger is created empty on the first `write`).
 */
export interface SkillLedgerPort {
  read(): string[];
  write(names: readonly string[]): void;
}
