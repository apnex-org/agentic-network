/**
 * bug-175 — RBAC fail-open closure regression matrix (Steve's audit-4116 oracle).
 *
 * The router membership-gate now DENIES a caller whose resolved role is not in a role-gated
 * tool's role-set; an UNKNOWN (pre-register_role) caller is no longer waved through (was the
 * fail-open). [Any] tools still admit everyone (incl. unknown — that's the register_role
 * bootstrap path). Adapters register the role at the handshake, so a legitimate caller is
 * never unknown at a role-gated tool.
 */
import { describe, it, expect } from "vitest";
import { PolicyRouter } from "../src/policy/router.js";
import { registerSessionPolicy } from "../src/policy/session-policy.js";
import { registerWorkItemPolicy } from "../src/policy/work-item-policy.js";
import { createTestContext } from "../src/policy/test-utils.js";

function makeRouter(): PolicyRouter {
  const router = new PolicyRouter(() => {});
  // work-162 (A1): registerTaskPolicy retired; matrix covered by
  // reset_work ([Architect|Director]) + register_role ([Any]).
  //
  // 🔴 work-593 — THIS FILE'S ADMIN EXEMPLAR WAS SUBSTITUTED, NOT DELETED.
  // The matrix previously exercised `clear_work_quarantine`, which was retired with the [A]
  // claim-thrash mechanism. That verb was this file's ONLY [Architect|Director] case, so
  // deleting its four tests would have left a "RBAC fail-open closure matrix" containing a
  // single [Any] test — full green, zero coverage of the fail-open it exists to prevent.
  // `reset_work` carries the IDENTICAL composite tag, so all four rows (unknown-denied,
  // non-member-denied, member-allowed, composite-member-allowed) are preserved.
  //
  // ⚠️ A test file named after an invariant does not protect that invariant; the SPECIFIC
  // verb it drives does. Retiring a feature silently retires whatever unrelated coverage
  // happened to be riding on it.
  registerSessionPolicy(router);   // register_role [Any]
  registerWorkItemPolicy(router);  // reset_work [Architect|Director]
  return router;
}
const unknownCtx = () => createTestContext(undefined, { skipRoleRegister: true }); // getRole→"unknown"
const asRole = (role: string) => createTestContext({ role });
const denied = (r: { isError?: boolean; content: Array<{ text: string }> }) =>
  r.isError === true && /Authorization denied/.test(JSON.parse(r.content[0].text).error ?? "");

describe("bug-175 RBAC membership-gate matrix (audit-4116)", () => {
  it("unknown × reset_work ([Architect|Director]) → DENIED", async () => {
    expect(denied(await makeRouter().handle("reset_work", { workId: "w" }, unknownCtx()))).toBe(true);
  });

  it("engineer × reset_work ([Architect|Director]) → DENIED (engineer not a member)", async () => {
    expect(denied(await makeRouter().handle("reset_work", { workId: "w" }, asRole("engineer")))).toBe(true);
  });

  it("architect × reset_work → ALLOWED (member; reaches the handler, not RBAC-denied)", async () => {
    // The discriminator is DENIED-vs-REACHED, not success. A missing workId makes the
    // HANDLER fail on its own terms, which is precisely the proof that the membership gate
    // let the caller through — a stronger signal than the old no-op success, because a
    // blanket denial could never produce it.
    const r = await makeRouter().handle("reset_work", { workId: "no-such-work" }, asRole("architect"));
    expect(denied(r)).toBe(false);
  });

  it("director × reset_work → ALLOWED (composite-tag member)", async () => {
    expect(denied(await makeRouter().handle("reset_work", { workId: "w" }, asRole("director")))).toBe(false);
  });

  it("unknown × [Any] register_role → ALLOWED + establishes the role (bootstrap path)", async () => {
    const ctx = unknownCtx();
    const r = await makeRouter().handle("register_role", { role: "engineer" }, ctx);
    expect(r.isError).toBeFalsy();
    expect(ctx.stores.engineerRegistry.getRole(ctx.sessionId)).toBe("engineer"); // role now established
  });

});
