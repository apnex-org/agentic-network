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
  // clear_work_quarantine ([Architect|Director]) + register_role ([Any]).
  registerSessionPolicy(router);   // register_role [Any]
  registerWorkItemPolicy(router);  // clear_work_quarantine [Architect|Director]
  return router;
}
const unknownCtx = () => createTestContext(undefined, { skipRoleRegister: true }); // getRole→"unknown"
const asRole = (role: string) => createTestContext({ role });
const denied = (r: { isError?: boolean; content: Array<{ text: string }> }) =>
  r.isError === true && /Authorization denied/.test(JSON.parse(r.content[0].text).error ?? "");

describe("bug-175 RBAC membership-gate matrix (audit-4116)", () => {
  it("unknown × clear_work_quarantine ([Architect|Director]) → DENIED", async () => {
    expect(denied(await makeRouter().handle("clear_work_quarantine", { agentId: "a" }, unknownCtx()))).toBe(true);
  });

  it("engineer × clear_work_quarantine ([Architect|Director]) → DENIED (engineer not a member)", async () => {
    expect(denied(await makeRouter().handle("clear_work_quarantine", { agentId: "a" }, asRole("engineer")))).toBe(true);
  });

  it("architect × clear_work_quarantine → ALLOWED (member; not RBAC-denied)", async () => {
    const r = await makeRouter().handle("clear_work_quarantine", { agentId: "a" }, asRole("architect"));
    expect(denied(r)).toBe(false);
    expect(r.isError).toBeFalsy(); // clears a non-existent agent's quarantine → no-op ok
  });

  it("director × clear_work_quarantine → ALLOWED (composite-tag member)", async () => {
    expect(denied(await makeRouter().handle("clear_work_quarantine", { agentId: "a" }, asRole("director")))).toBe(false);
  });

  it("unknown × [Any] register_role → ALLOWED + establishes the role (bootstrap path)", async () => {
    const ctx = unknownCtx();
    const r = await makeRouter().handle("register_role", { role: "engineer" }, ctx);
    expect(r.isError).toBeFalsy();
    expect(ctx.stores.engineerRegistry.getRole(ctx.sessionId)).toBe("engineer"); // role now established
  });

});
