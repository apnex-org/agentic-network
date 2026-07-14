/**
 * skills/ — the SKILLS kind-module (hcapskills0 build_claude; harness-neutral per
 * piuplift0 p1): the SECOND kind composed onto the neutral control-plane/ Controller (the
 * FIRST being pi-tools, in adapters/pi-plugin). Contains the SkillActuator (outbound edge-seam) +
 * RoleSkillSource (inbound) + the wanted-bundles manifest expansion + the durable
 * ledger. Skill-isms (node:fs, SKILL.md layout, the managed ledger) live HERE — NEVER
 * in control-plane/ (the import-boundary test guards that). The Controller still depends
 * only on ResourceActuatorPort; the seed bin constructs + injects this actuator.
 */
export type { SkillDefinition, SkillLedgerPort } from "./contracts.js";
export {
  SkillActuator,
  type SkillActuatorDeps,
} from "./skill-actuator.js";
export { FileSkillLedger } from "./file-skill-ledger.js";
export { RoleSkillSource, type RoleSkillSourceDeps } from "./role-skill-source.js";
export {
  parseWantedBundles,
  parseBundleSkills,
  expandWantedBundles,
  type WantedBundles,
} from "./manifest.js";
export { missingFromRoleMap } from "./set-diff-gate.js";
