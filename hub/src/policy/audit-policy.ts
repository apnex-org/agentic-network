/**
 * Audit Policy — RETIRED (SEAL C, idea-444).
 *
 * The `create_audit_entry` + `list_audit_entries` verbs are retired: verifier verdicts are now
 * load-bearing `attest_evidence` attestations (A2), and the ~34-site `logEntry` firehose is
 * redirected to the structured-log stream (stdout, NO persist — see observability/structured-log.ts).
 * No new `Audit` rows are minted — closing the firehose-verdict-mint bypass. The `Audit` KIND stays
 * READABLE (the audit store's get/listEntries) for the FENCED legacy verifier-gate/review verdict
 * path ONLY (A2's hard fence keeps legacy Audit reads from satisfying verifier-attestation reqs).
 * Full kind-removal + verifier-gate→attestation migration = idea-457 (verify-flow-unification).
 *
 * `registerAuditPolicy` is a documented no-op so the policy-index wiring is unchanged; the
 * catalog-negative test asserts both verbs are unregistered → dispatch to "Unknown tool".
 */

import type { PolicyRouter } from "./router.js";

// ── Registration ────────────────────────────────────────────────────
export function registerAuditPolicy(_router: PolicyRouter): void {
  // SEAL C: create_audit_entry + list_audit_entries are RETIRED — intentionally register nothing.
}
