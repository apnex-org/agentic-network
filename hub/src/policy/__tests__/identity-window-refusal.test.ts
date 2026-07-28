/**
 * work-592 / bug-398 — BOUND THE HANDSHAKE WINDOW.
 *
 * 🔴 THE DEFECT IS NOT THE PLACEHOLDER. IT IS THE UNBOUNDED WINDOW.
 *
 * `caller-identity.ts` documents `anonymous-<role>` as the state between the two
 * handshake phases: plain `register_role` binds the ROLE, the enriched call binds
 * the IDENTITY. That gap is legitimate and self-clearing. What never existed was
 * any check that it had CLOSED — so a handshake IN FLIGHT and one that FAILED
 * FOREVER produced an identical principal with full role authority.
 *
 * ─── THE TWO RAILS THIS FILE ENFORCES ────────────────────────────────────────
 *
 * 🔴 RAIL 1 — THE GUARD ADDS A THROW, IT NEVER DELETES `:63`. Deleting the
 * placeholder promotes `HUB_SYSTEM_PROVENANCE`, so a degraded seat would resolve
 * as the Hub's own internal principal — a WIDER authority, not a narrower one. A
 * test below reads the source and asserts the line still exists, so the guard
 * cannot be "simplified" into a deletion later.
 *
 * 🔴 RAIL 2 — SYSTEM / RULE PRINCIPALS MUST STILL FUNCTION. PR #682 added a
 * throw to this exact file and cost ~50 minutes of fleet downtime. The verifier's
 * L12: *"a fix that refuses the substrate's own automation is worse than the
 * defect it closes."* ⚠️ And the org has already produced a FALSE CLEARANCE on
 * this ladder — a resolver-caller search comes back clean while the repo-event
 * bridge's `create_message` lands on `message-policy.ts`'s OWN fallback, which
 * that search cannot see. So the system principal is proven HERE, by exercising
 * it, not by the absence of callers.
 *
 * ─── CLAUSE 2 (idea-677), AND THE SHARP VERSION THE RUNBOOK ASKED FOR ────────
 * *"Would a guard that refuses ALWAYS pass your test? If yes, you have not tested
 * the WINDOW — only the refusal."* The open-window case below is precisely that
 * discriminator: a guard that refused unconditionally would fail it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCreatedBy, HUB_SYSTEM_PROVENANCE, IdentityUnboundError, IDENTITY_HANDSHAKE_WINDOW_MS } from "../caller-identity.js";
import { toErrorEnvelope } from "../error-envelope.js";
import type { IPolicyContext } from "../types.js";

/** Minimal registry stub: a role, no bound agent, and a window we control. */
function ctxWith(opts: { role?: string | null; elapsedMs?: number | null; omitWindowFn?: boolean }): IPolicyContext {
  const registry: Record<string, unknown> = {
    getRole: () => opts.role ?? "unknown",
    getAgentForSession: async () => null,          // identity NEVER binds
  };
  if (!opts.omitWindowFn) {
    registry.identityWindowElapsedMs = () => opts.elapsedMs ?? null;
  }
  return {
    sessionId: "sess-w592",
    role: opts.role ?? "unknown",
    stores: { engineerRegistry: registry },
  } as unknown as IPolicyContext;
}

const PAST = IDENTITY_HANDSHAKE_WINDOW_MS + 1_000;
const INSIDE = Math.floor(IDENTITY_HANDSHAKE_WINDOW_MS / 2);

describe("work-592: the handshake window is bounded, and only the window", () => {
  it("🟢 WINDOW OPEN — the documented placeholder still works (the correct case survives)", async () => {
    // CLAUSE 2, and the discriminator the runbook demanded: a guard that refused
    // unconditionally would FAIL here. This proves the WINDOW is tested, not just
    // the refusal. `caller-identity.ts:9-16` documents this case as legitimate.
    const p = await resolveCreatedBy(ctxWith({ role: "engineer", elapsedMs: INSIDE }));
    expect(p).toEqual({ role: "engineer", agentId: "anonymous-engineer" });
  });

  it("🔴 WINDOW CLOSED — an unbound identity is REFUSED, not fabricated", async () => {
    await expect(resolveCreatedBy(ctxWith({ role: "engineer", elapsedMs: PAST })))
      .rejects.toBeInstanceOf(IdentityUnboundError);
  });

  it("🔴 RAIL 2 — a SYSTEM principal (no role at all) still resolves, however long it has been", async () => {
    // The criterion most likely to fail and least likely to be tested. Hub-internal
    // callers — reaper, watchdog, backfill — carry no session role, so they must
    // fall to HUB_SYSTEM_PROVENANCE and NEVER meet the throw, even with a window
    // long past its limit.
    const p = await resolveCreatedBy(ctxWith({ role: null, elapsedMs: PAST * 100 }));
    expect(p).toEqual(HUB_SYSTEM_PROVENANCE);
  });

  it("🔴 RAIL 2 — a registry that cannot date the window FAILS OPEN, never closed", async () => {
    // A registry without the bookkeeping method leaves the window unbounded — i.e.
    // exactly today's behaviour. The guard can only refuse where the substrate can
    // actually date the window; it must never refuse on absence of information.
    const p = await resolveCreatedBy(ctxWith({ role: "architect", omitWindowFn: true }));
    expect(p).toEqual({ role: "architect", agentId: "anonymous-architect" });
  });

  it("🔴 RAIL 1 — `anonymous-${role}` IS STILL PRESENT in caller-identity.ts", async () => {
    // Deleting :63 promotes :64 (HUB_SYSTEM_PROVENANCE) — a WIDER authority. This
    // asserts the guard was implemented as an ADDITION and pins it so nobody can
    // later "simplify" it into a deletion.
    const src = readFileSync(join(__dirname, "..", "caller-identity.ts"), "utf8");
    expect(src).toContain("agentId: `anonymous-${role}`");
    expect(src).toContain("return HUB_SYSTEM_PROVENANCE;");
  });

  it("the refusal carries the six properties, and promises NO verb that does not exist", async () => {
    const err = await resolveCreatedBy(ctxWith({ role: "engineer", elapsedMs: PAST })).catch((e) => e);
    const env = toErrorEnvelope(err);

    expect(env.errorKind).toBe("identity.unbound");
    // TRANSIENCE is load-bearing: the whole defect is a caller that could not tell
    // a transient from a permanent condition. Retrying binds nothing.
    expect(env.transience).toBe("permanent");
    expect(env.atomicity).toMatch(/Nothing has been changed/);
    expect(env.rationale).toMatch(/agentId/);
    // 🔴 The route must NOT name an in-band verb — `reset_session` was deferred
    // (idea-674). Naming a verb that does not exist sends the caller to a wall
    // while sounding helpful; that is bug-399's exact failure mode.
    expect(env.route).toMatch(/out-of-band/i);
    expect(env.route).toMatch(/idea-674/);
    expect(env.route).not.toMatch(/reset_session\(/);
  });

  it("the refusal states how long the window has been closed — not just that it is", async () => {
    const err = await resolveCreatedBy(ctxWith({ role: "engineer", elapsedMs: PAST })).catch((e) => e);
    expect(String(err.message)).toMatch(/handshake window closed/);
    expect(String(err.message)).toMatch(/\d+s ago/);
  });
});
