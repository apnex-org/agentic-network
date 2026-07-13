/**
 * set-diff-gate.ts — the coexist acceptance gate (hcapskills0 build_claude; design
 * §8.2 + unlink-safety invariant 3b). During coexist, `role_map(role)` MUST be a
 * SUPERSET of what `mission_kit_sync` delivers for that role. Why it's LOAD-BEARING,
 * not cosmetic: a skill X that this actuator materialized (∈ its ledger) but which is
 * later dropped from role_map while mks still delivers X lands in `managed \
 * managedEnabled` → the removal loop would unlink X → an mks-delivered skill is
 * clobbered. Ledger-scoping does NOT prevent this (X IS in the ledger). ONLY
 * `role_map ⊇ mks-delivered` holding AT RUNTIME does (X∈mks ⟹ X∈role_map ⟹
 * X∈managedEnabled ⟹ X never in the removal set).
 *
 * So this is evaluated as a LIVE, FAIL-CLOSED check in the seed bin (abort launch on
 * violation) — the CI unit test is the fast signal, the seed-time gate is the
 * runtime guarantee under manifest drift. Pure: the bin injects both sets.
 */

/**
 * The mks-delivered skills MISSING from a role's role_map (empty ⇒ the gate passes).
 * A non-empty result is a HARD fail-closed condition at seed time.
 */
export function missingFromRoleMap(
  roleSkills: readonly string[],
  mksDelivered: readonly string[],
): string[] {
  const have = new Set(roleSkills);
  return [...new Set(mksDelivered)].filter((s) => !have.has(s)).sort();
}
