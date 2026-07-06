/**
 * Audit Policy — VERBS RETIRED (SEAL C(c), idea-444).
 *
 * SCOPE (additive, 104): the `create_audit_entry` + `list_audit_entries` VERBS are retired —
 * there is no MCP audit-verdict AUTHORING surface anymore; verifier verdicts are now load-bearing
 * `attest_evidence` attestations (A2). `registerAuditPolicy` is a documented no-op; the
 * catalog-negative test asserts both verbs are unregistered → dispatch to "Unknown tool".
 *
 * EXPLICITLY RETAINED (NOT retired here): the `Audit` KIND, the audit store's `logEntry` (the
 * firehose STILL persists Audit rows), and `get`/`listEntries` — the legacy verifier-gate/review
 * verdict READ path still resolves, fenced read-only. A2's hard fence keeps legacy/firehose Audit
 * reads from satisfying `verifier-attestation` requirements (proven in seal-a2-attest).
 *
 * DEFERRED → idea-457 (verify-flow-unification): the ~34-site firehose→structured-log redirect,
 * the observability-oracle test migration, the audit read-path removal, verifier-gate→attestation,
 * and full `Audit` KIND retirement + the complete firehose no-bypass. This slice does NOT do them.
 */

import type { PolicyRouter } from "./router.js";

// ── Registration ────────────────────────────────────────────────────
export function registerAuditPolicy(_router: PolicyRouter): void {
  // SEAL C(c): the create_audit_entry + list_audit_entries VERBS are retired — intentionally
  // register nothing. (The Audit kind + store logEntry/get/listEntries are RETAINED, fenced.)
}
