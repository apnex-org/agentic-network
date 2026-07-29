/**
 * bug-424 + bug-423 — DISPOSAL AUTHORITY and the WATCHDOG's suspension faces
 * (work-bp-nodestate0-impl_disposal).
 *
 * PART A asserts the matrix ROW BY ROW. The architect's original instruction was a
 * blanket "creator, architect, or lease-holder" exception; steve's audit rejected it
 * because an architect may have suspended an ACTIVE HOLDER PRECISELY TO STOP TERMINAL
 * ACTION. So the two holder rows MUST DIFFER, and that is the assertion this file
 * exists for — it cannot be answered from `agentId` alone.
 */
import { describe, it, expect } from "vitest";
import { evaluateSuspendedDisposalAuthority } from "../work-item-repository-substrate.js";
import {
  evaluateDriverLivenessWatchdog,
  fingerprintWorkItemForDriverProgress,
} from "../../policy/driver-liveness-watchdog.js";

const HOLDER = "agent-holder";
const STEWARD = "agent-arch";
const CREATOR = "agent-creator";
const TOKEN = "tok-1";

function suspendedRow(over: Record<string, unknown> = {}) {
  return {
    suspended: true,
    status: "in_progress",
    lease: { holder: HOLDER, token: TOKEN, expiresAt: "2099-01-01T00:00:00Z" },
    createdBy: { role: "architect", agentId: CREATOR },
    recallHistory: [{ actor: { role: "architect", agentId: STEWARD } }],
    ...over,
  } as never;
}

describe("bug-424: the disposal authority matrix, row by row", () => {
  it("architect / director stewardship => ALLOW on any suspended row", () => {
    for (const role of ["architect", "director"]) {
      const v = evaluateSuspendedDisposalAuthority(suspendedRow(), { agentId: "agent-x", role }, {});
      expect(v.allowed).toBe(true);
      expect(v.reason).toBe("steward");
    }
  });

  it("creator on own suspended-READY row => ALLOW (no lease, so no second-claimant race)", () => {
    const row = suspendedRow({ status: "ready", lease: null });
    const v = evaluateSuspendedDisposalAuthority(row, { agentId: CREATOR, role: "engineer" }, {});
    expect(v.allowed).toBe(true);
    expect(v.reason).toBe("creator_of_suspended_ready");
  });

  it("🔴 exact holder after SELF-suspension => ALLOW (their own withdrawal to reverse)", () => {
    const row = suspendedRow({ recallHistory: [{ actor: { role: "engineer", agentId: HOLDER } }] });
    const v = evaluateSuspendedDisposalAuthority(row, { agentId: HOLDER, role: "engineer" }, { leaseToken: TOKEN });
    expect(v.allowed).toBe(true);
    expect(v.reason).toBe("holder_after_self_suspension");
  });

  it("🔴 exact holder after STEWARD suspension => DENY (management withdrawal outranks the withdrawn)", () => {
    const v = evaluateSuspendedDisposalAuthority(suspendedRow(), { agentId: HOLDER, role: "engineer" }, { leaseToken: TOKEN });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("holder_after_steward_suspension");
  });

  it("🔴 THE ROW THAT IS THE WHOLE POINT: the two holder cases MUST DIFFER", () => {
    // Same caller, same token, same row shape — only WHO SUSPENDED differs. A blanket
    // holder exception (the rejected original instruction) makes these identical.
    const afterSelf = evaluateSuspendedDisposalAuthority(
      suspendedRow({ recallHistory: [{ actor: { role: "engineer", agentId: HOLDER } }] }),
      { agentId: HOLDER, role: "engineer" }, { leaseToken: TOKEN });
    const afterSteward = evaluateSuspendedDisposalAuthority(
      suspendedRow(), { agentId: HOLDER, role: "engineer" }, { leaseToken: TOKEN });
    expect(afterSelf.allowed).not.toBe(afterSteward.allowed);
  });

  it("suspender UNKNOWN (no recall history) => DENY, fail-closed", () => {
    // Legacy rows carry no recall entry. Treating unknown as "self" would hand the
    // holder an override of a withdrawal nobody can prove they made.
    const v = evaluateSuspendedDisposalAuthority(
      suspendedRow({ recallHistory: [] }), { agentId: HOLDER, role: "engineer" }, { leaseToken: TOKEN });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("holder_but_suspender_unknown_fail_closed");
  });

  it("unrelated caller => ALWAYS DENIED", () => {
    const v = evaluateSuspendedDisposalAuthority(suspendedRow(), { agentId: "agent-nobody", role: "engineer" }, {});
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("unrelated_caller");
  });

  it("a holder WITHOUT a matching token is not a holder", () => {
    const v = evaluateSuspendedDisposalAuthority(
      suspendedRow({ recallHistory: [{ actor: { role: "engineer", agentId: HOLDER } }] }),
      { agentId: HOLDER, role: "engineer" }, { leaseToken: "wrong-token" });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("unrelated_caller");
  });
});

describe("bug-423 F9 face 3: the progress fingerprint sees suspension", () => {
  it("pause/unpause changes the fingerprint even when phase, holder and evidence do not", () => {
    const base = { status: "in_progress", lease: null, blockedOn: null, evidence: [] } as never;
    const parked = { ...(base as object), suspended: true } as never;
    const live = fingerprintWorkItemForDriverProgress(base);
    const fenced = fingerprintWorkItemForDriverProgress(parked);
    // Without `suspended` in the fingerprint these are byte-identical and a fence
    // registers as "nothing happened".
    expect(live).not.toEqual(fenced);
    expect(fenced.suspended).toBe(true);
    expect(live.suspended).toBe(false);
  });
});

describe("bug-423: the watchdog, BOTH directions — accuracy, not suppression", () => {
  const now = "2026-01-01T12:00:00Z";
  const baseline = { recordedAt: "2026-01-01T00:00:00Z" } as never;
  const driver = {
    id: "drv", status: "in_progress", suspended: false,
    lease: { holder: "agent-drv", token: "t", expiresAt: "2099-01-01T00:00:00Z" },
    blockedOn: null, evidence: [], enteredCurrentStateAt: "2026-01-01T00:00:00Z",
  } as never;

  // the watchdog requires a next-action projection; `nextAction: null` = nothing claimable,
  // which is what forces evaluation down to the in-flight / parked reasoning under test.
  const noAction = { nextAction: null, readyCandidates: 0, emptyReason: null } as never;

  function child(over: Record<string, unknown>) {
    return {
      id: "c", status: "ready", suspended: false, lease: null, blockedOn: null,
      evidence: [], enteredCurrentStateAt: "2026-01-01T00:00:00Z", ...over,
    } as never;
  }

  it("🔴 a SUSPENDED DRIVER is not treated as active (F9 face 2)", () => {
    const v = evaluateDriverLivenessWatchdog({
      now, thresholdMs: 1, baseline, driverNextAction: noAction,
      driver: { ...(driver as object), suspended: true } as never,
      children: [child({})],
    } as never);
    expect(v.reason).toBe("driver_not_active");
  });

  it("🔴 childStatuses SURFACES suspension — a fenced row must not read as plain `ready`", () => {
    const v = evaluateDriverLivenessWatchdog({
      now, thresholdMs: 1, baseline, driver, driverNextAction: noAction,
      children: [child({ id: "fenced", suspended: true })],
    } as never);
    const row = v.childStatuses.find((c) => c.id === "fenced");
    expect(row!.status).toBe("ready");   // phase is untouched by suspension...
    expect(row!.suspended).toBe(true);   // ...so THIS is the field that tells the truth
  });

  it("🔴 a SUSPENDED in-flight child with a retained lease is NOT live (F9 face 1)", () => {
    // Without the fix this child suppressed the warning — silence caused by parking.
    const v = evaluateDriverLivenessWatchdog({
      now, thresholdMs: 1, baseline, driver, driverNextAction: noAction,
      children: [child({ id: "parked", status: "in_progress", suspended: true,
        lease: { holder: "h", token: "t", expiresAt: "2099-01-01T00:00:00Z" } })],
    } as never);
    expect(v.reason).not.toBe("in_flight_child");
  });

  it("🟢 THE OTHER DIRECTION: a genuinely live in-flight child STILL suppresses", () => {
    // The fix must be accuracy, not blanket silencing.
    const v = evaluateDriverLivenessWatchdog({
      now, thresholdMs: 1, baseline, driver, driverNextAction: noAction,
      children: [child({ id: "live", status: "in_progress", suspended: false,
        lease: { holder: "h", token: "t", expiresAt: "2099-01-01T00:00:00Z" } })],
    } as never);
    expect(v.reason).toBe("in_flight_child");
  });
});
