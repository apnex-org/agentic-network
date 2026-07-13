/**
 * skills/ — the Claude SKILLS kind-module (hcapskills0 build_claude): the SECOND kind
 * composed onto the neutral control-plane/ Controller (the FIRST being pi-tools, in
 * adapters/pi-plugin). Contains the ClaudeSkillActuator (outbound edge-seam) +
 * RoleSkillSource (inbound) + the wanted-bundles manifest expansion + the durable
 * ledger. Skill-isms (node:fs, SKILL.md layout, the managed ledger) live HERE — NEVER
 * in control-plane/ (the import-boundary test guards that). The Controller still depends
 * only on ResourceActuatorPort; the seed bin constructs + injects this actuator.
 */
export type { SkillDefinition, SkillLedgerPort } from "./contracts.js";
export {
  ClaudeSkillActuator,
  type ClaudeSkillActuatorDeps,
} from "./claude-skill-actuator.js";
export { FileSkillLedger } from "./file-skill-ledger.js";
export { RoleSkillSource, type RoleSkillSourceDeps } from "./role-skill-source.js";
export {
  parseWantedBundles,
  parseBundleSkills,
  expandWantedBundles,
  type WantedBundles,
} from "./manifest.js";
export { missingFromRoleMap } from "./set-diff-gate.js";
