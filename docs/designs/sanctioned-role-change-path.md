# Sanctioned Role-Change Path (1b)

**Status:** v0.1 DRAFT — for Director ratification (security-sensitive, cf. #338) · **Author:** lily (architect) · **Date:** 2026-06-21
**Origin:** mission-93 verifier cutover. The architect→verifier flip was blocked by `assertIdentity`'s anti-spoofing role-change refusal and had to be done by hand-SQL on the prod substrate (Director-authorized, one-off). 1b makes that path durable, audited, and first-class.
**Auth model:** **architect-executable with per-occasion Director authorization** (Director-ratified 2026-06-21) — mirrors the existing prod-write / prod-deploy pattern (Director authorizes the occasion; architect executes; audited).
**Tele anchor:** tele-8/9 (integrity — the sanctioned-vs-spoofed distinction is *preserved*, not weakened); tele-10 (declarative source of truth — role change becomes a first-class audited Hub op, not raw SQL); tele-4 (no silent change); tele-13 (Director-intent amplification — Director authorizes, architect executes, minimal Director operational load).

---

## 1. The boundary we must NOT weaken

`assertIdentity` (`hub/src/entities/agent-repository-substrate.ts` ~489) refuses to CHANGE an existing agent's persisted role on re-registration → `role_mismatch`. This is **correct anti-spoofing** and there is a green test enshrining it (`mission-40-session-claim-separation/t1-helpers.test.ts`). A compromised/confused adapter must not be able to escalate its own role just by re-registering under a different role.

**1b does not touch this.** `register_role` keeps refusing role changes. The sanctioned change happens through a **separate authorized op** — so the only way to change a role remains an explicit, architect-executed, Director-authorized, audited action.

## 2. The mechanism

A new first-class Hub operation:

```
change_agent_role(agentId, newRole, reason, directorAuthorizationRef)
```

- **RBAC:** `[Architect]` only. NOT engineer/verifier/unknown. (Fail-closed; consistent with bug-163 hardening.)
- **Mandatory arguments:** `reason` (why) + `directorAuthorizationRef` (where/when the Director authorized this occasion — e.g. a message ID or "Director chat 2026-06-21"). These make the per-occasion authorization **explicit and traceable**, not an honor-system bare call.
- **Effect:** updates the persisted `Agent.role` (substrate write, `resource_version` bump for OCC) and writes a **first-class audit entry** — `action=agent_role_changed`, actor=architect, details = {agentId, oldRole, newRole, authorizer=director, reason, directorAuthorizationRef}. No silent SQL.
- **assertIdentity interaction:** after `change_agent_role`, the persisted role is the new role. The agent's **next (re-)registration** with `newRole` now MATCHES persisted → no `role_mismatch` → online. The boundary in §1 is untouched: handshake still can't change role; the persisted role was changed only by the authorized op.

### Flow (replacing the cutover hand-SQL)
1. Director authorizes the occasion (out-of-band, as with prod-write/deploy).
2. Architect calls `change_agent_role(agent, newRole, reason, ref)` → persisted role updated + audited.
3. Agent restarts / re-registers as `newRole` → assertIdentity matches → online as `newRole`.

## 3. Take-effect semantics

The persisted change is authoritative; a currently-online session keeps its **already-bound** role until it re-registers (restart). No mid-session role mutation — the change lands cleanly on next registration. (Documented so operators expect a restart, exactly as at cutover.)

## 4. Decisions for ratification (architect leans noted)

1. **Authorization representation** — `directorAuthorizationRef` as a **mandatory free-text reference** for v1 (Hub records but does not cryptographically verify it), upgradeable later to a verified Director-approval primitive if the threat model warrants. *Lean: free-text + mandatory + audited for v1 (matches today's prod-write trust model; not over-built).*
2. **Online target** — allow the op while the target is online (take-effect-on-next-register per §3), vs require the target be offline first. *Lean: allow; take effect on next register (simpler, and the live session safely retains its bound role).*
3. **Naming / surface** — `change_agent_role` as a dedicated `[Architect]` MCP tool. *Lean: yes — first-class + audited beats an operator script; the script path stays as a break-glass fallback.*

## 5. Build + verification (engineer)

- Add the `change_agent_role` op + RBAC tag + mandatory-args validation + the `agent_role_changed` audit action.
- **Positive-path role-change e2e** (the one greg is already adding): sanctioned change → re-register matches → online. With 1b this tests the *real primitive* end-to-end, not just a fixture-set persisted state.
- The existing **rejection** e2e (unsanctioned handshake role-change → `role_mismatch`) stays green — proving §1 is intact.
- Ties into the R3 acceptance gate, invariant **A4** (sanctioned persisted-role change → online).

## 6. Scope guard

Role only. No general "sanctioned agent-field-change" surface (YAGNI). If other governance-controlled agent fields need a sanctioned-change path later, generalise then — with its own ratification.

---

**One-line:** *the anti-spoofing handshake boundary stays absolute; role changes move from one-off hand-SQL to a first-class, architect-executed, Director-authorized, audited `change_agent_role` op — so the only way a role ever changes is an explicit sanctioned action.*
