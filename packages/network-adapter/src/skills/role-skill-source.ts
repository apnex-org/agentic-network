/**
 * role-skill-source.ts — RoleSkillSource (hcapskills0 build_claude): the skills-kind
 * SOURCE (inbound edge-seam = the desired-set). A STATIC role→skills declaration that
 * emits `ResourceSpec[]` for the neutral SpecStore — the mirror of pi's HubSpecSource,
 * but static (no Hub skills-catalog / skillsRevision in slice-1; the source-poll half
 * is deferred, design §4). The source-poll half is NOT exercised here.
 *
 * Slice-1 is role-AGNOSTIC (every fleet role → the same manifest-expanded set, which is
 * exactly what mission_kit_sync delivers today), but the signature is per-role so
 * per-role bundles generalize without a reshape. The skill CONTENT source (`sourceDirFor`)
 * is injected by the bin (the pinned clone), so the source itself stays fs/env-free.
 */
import type { ResourceSpec } from "../control-plane/contracts.js";
import type { SkillDefinition } from "./contracts.js";

export interface RoleSkillSourceDeps {
  /** static role→skill-ids overrides; a role absent here falls back to `defaultSkills`. */
  roleSkills?: ReadonlyMap<string, readonly string[]>;
  /** the set every role receives when not overridden (slice-1: the whole expanded set). */
  defaultSkills: readonly string[];
  /** resolve a skill-id → the source tree dir the actuator copies FROM (bin-injected). */
  sourceDirFor: (skillId: string) => string;
}

export class RoleSkillSource {
  constructor(private readonly deps: RoleSkillSourceDeps) {}

  /** the declared skill-ids for a role — the load-bearing input to the set-diff gate. */
  skillIdsForRole(role: string): string[] {
    const ids = this.deps.roleSkills?.get(role) ?? this.deps.defaultSkills;
    return [...ids];
  }

  /** the desired ResourceSpec set for a role: enabled, opaque `{sourceDir}` definition. */
  specsForRole(role: string): ResourceSpec[] {
    return this.skillIdsForRole(role).map((id) => ({
      name: id,
      definition: { sourceDir: this.deps.sourceDirFor(id) } satisfies SkillDefinition,
      enabled: true,
    }));
  }
}
