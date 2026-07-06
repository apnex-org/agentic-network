/**
 * SEAL C(c) (idea-444) — audit-VERB retirement CATALOG-NEGATIVE gate.
 *
 * SCOPE (additive, 104): the two Audit authoring/listing VERBS (create_audit_entry +
 * list_audit_entries) are retired from the production policy surface — the standing proof that
 * neither survives: each resolves to "Unknown tool". Verifier verdicts are now attest_evidence
 * attestations (A2). The Audit KIND + the store's logEntry (firehose still persists) + get/listEntries
 * are RETAINED, fenced read-only. The firehose→log redirect + full no-bypass + kind-removal = idea-457.
 */

import { describe, it, expect } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import {
  registerSystemPolicy,
  registerAuditPolicy,
  registerSessionPolicy,
  registerIdeaPolicy,
  registerMissionPolicy,
  registerProposalPolicy,
  registerThreadPolicy,
  registerMessagePolicy,
} from "../src/policy/index.js";
import { registerBugPolicy } from "../src/policy/bug-policy.js";
import { registerWorkItemPolicy } from "../src/policy/work-item-policy.js";
import { createTestContext } from "../src/policy/test-utils.js";

const RETIRED_AUDIT_VERBS = ["create_audit_entry", "list_audit_entries"] as const;

/** The full production policy surface (mirrors hub/src/index.ts). registerAuditPolicy is now a
 *  no-op, so these verbs can come from nowhere — their absence is the retirement. */
function fullProductionRouter(): PolicyRouter {
  const router = new PolicyRouter(() => {});
  registerSystemPolicy(router);
  registerAuditPolicy(router);
  registerSessionPolicy(router);
  registerIdeaPolicy(router);
  registerMissionPolicy(router);
  registerProposalPolicy(router);
  registerThreadPolicy(router);
  registerMessagePolicy(router);
  registerBugPolicy(router);
  registerWorkItemPolicy(router);
  return router;
}

describe("SEAL C catalog-negative — audit-verb retirement", () => {
  it("neither audit verb is registered on the full production surface", () => {
    const router = fullProductionRouter();
    for (const verb of RETIRED_AUDIT_VERBS) {
      expect(router.has(verb), `${verb} must NOT be registered`).toBe(false);
      expect(router.getAllToolNames(), `${verb} must NOT be a tool name/alias`).not.toContain(verb);
    }
  });

  it("dispatching either retired audit verb returns an Unknown tool error", async () => {
    const router = fullProductionRouter();
    const ctx = createTestContext();
    for (const verb of RETIRED_AUDIT_VERBS) {
      const result = await router.handle(verb, {}, ctx);
      expect(result.isError, `${verb} must error`).toBe(true);
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.error, `${verb} must be Unknown tool`).toContain("Unknown tool");
    }
  });
});
