# OIS Control-Plane Charter — the dual-binding authority contract

**Status:** DRAFT
**Author:** lily (architect)  ·  **Date:** 2026-06-21
**Origin:** D-1-R0 (ratified D-1 arc; design `wf_514a4e05`) — M-Control-Plane-Charter-And-Identity-Seam-Spike. Companion: `docs/specs/ois-api-conventions.md` (the projection convention).

This is a **zero-production-code** charter rung. It governs the D-1 arc (Sovereign REST Control-Plane API + modular agent-drivable CLI) and binds every later rung (R1 read binding → R6 convergence register). It names the single authority, the binding invariant, the naming gate that the surface must EARN, the verified identity-seam facts + the approved bounded fix, the identity-driven conformance gate, and the D-1 root layout. No production code ships at this rung.

Ratified framing it encodes (Director, 2026-06-21 stint-2 gate): **REST-sovereign with MCP as one CO-EQUAL live binding** — both project from the same `router.handle()`; the in-harness MCP dataplane stays unchanged; the authority-seam change is **APPROVED**.

---

## §1 The single authority — `PolicyRouter.handle()` as the apiserver core

The Hub already separates **authority** from **binding**. There is exactly ONE authority, and it is not a protocol surface:

- **`PolicyRouter.handle(toolName, args, ctx)`** is the apiserver core — the single point where the verb registry, RBAC, the ADR-021 auto-claim path, audit emission, and cascade/FSM/CAS dispatch all live. This is the OIS analog of the kube-apiserver request pipeline.
- **A binding is a thin, policy-free projection** onto that core. `bindRouterToMcp` is the existing reference binding: it iterates `router.getAllToolNames()` / `getToolRegistration()` and forwards each call to `router.handle()`. It implements **no** RBAC, **no** audit, **no** dispatch, and **no** hand-listed route table of its own.
- **REST is a sibling binding** — `bindRouterToRest`, mounted on the SAME Express app already serving `/mcp` and `/health`, terminating in the SAME `router.handle()`. It is the structural twin of the MCP binding, not a parallel authority.

The Kubernetes analogy, made literal: **Hub = kube-apiserver** (the authority), **MCP and REST = two protocol bindings** onto it, **`oisctl` = kubectl** (a thin REST client), **agents = controllers** driving through the API.

**One authority, two bindings — not a control/data split.** The ratified relationship is REST-sovereign-with-MCP-as-one-binding. It is explicitly NOT a strict control-plane(REST) / data-plane(MCP) split (that risks forking authority) and explicitly NOT a "demote MCP now" cutover (that breaks the in-harness adapters lily/greg/steve depend on). MCP remains a co-equal live binding indefinitely.

## §2 The binding invariant (the load-bearing charter rule)

The strongest structural guarantee of this arc. It is the rule every binding — present and future — MUST satisfy:

1. **Every binding terminates in `router.handle()`.** No binding reads a repository directly; no binding talks to the storage substrate directly.
2. **No binding re-implements authority.** No RBAC check, no audit emission, no cascade/dispatch, no FSM/CAS transform lives in a binding. Those exist once, in the authority.
3. **No binding hand-lists routes or a tool table.** The set of resources/verbs a binding exposes is DERIVED from one walk of the verb registry + SchemaDef inventory (see `ois-api-conventions.md` §1). A new kind, a relocated field, or a new verb appears on BOTH bindings by construction, from the one walk — never by editing a per-binding route list.
4. **Forking authority is a charter violation.** A raw-substrate REST endpoint, a REST route that re-derives RBAC, a parallel role-decision, or any second handler set is a violation of this charter — even if it "works." The bug-137/138 class (consumer code reading relocated fields off a raw row) becomes cross-binding drift if authority forks; the invariant is what structurally prevents that.

**The only sanctioned authority-bypass** is `get-entities.sh` direct-psql, named as a BREAK-GLASS: psql bypasses RBAC + audit and must NEVER be presented or folded as a sovereign verb. It is the explicitly un-sovereign forensic escape hatch (see `ois-api-conventions.md` and the D-1 CLI rung).

## §3 The 4-property naming gate + the over-claim guard

A REST surface does not get to call itself a "control plane" by existing. The label is **EARNED** when — and only when — all four properties hold:

| # | Property | What it requires |
|---|---|---|
| **1** | **ACTUATION** | REST exposes mutating + ACTION verbs (create/update/delete + claim/lease/ack/actuate/...), not just reads. |
| **2** | **SINGLE-AUTHORITY** | Every REST route terminates in the shared `router.handle()` (§1–§2); no forked authority. |
| **3** | **PARITY** | RBAC + AUDIT are **byte-for-byte** equivalent to MCP for the same identity + verb. REST is **never more-privileged than MCP** (tighten-only). |
| **4** | **AGENTIC-DRIVE** | An agent dogfoods a real lifecycle actuation through REST end-to-end (read → claim → actuate → evidence), as fluently as via MCP. |

**The status-page-vs-control-plane over-claim guard.** Until property 1 AND property 4 are discharged (the write/actuate rung + the agentic-drive dogfood), the surface is a **STATUS PAGE / "REST read surface"**, NOT a control plane, and MUST NOT be named one. Concretely:

- R1 (read-only binding) ships a **"REST read surface"** — reads still flow through `router.handle()` so read-RBAC + read-audit match MCP, but it has no actuation verbs. It is a status page.
- R2 (identity/RBAC/audit parity) ships an **"authenticated REST surface"** — still zero verbs beyond MCP; it unlocks safe mutation but does not itself actuate.
- R3 (write/actuate) is the **first rung at which the "control plane" label is legitimate**, because it is the first rung at which all four properties hold (and it carries the agentic-drive dogfood that discharges property 4).

This guard is a deliverable of the charter: it forbids the org from over-claiming a read surface as the sovereign control plane.

## §4 The identity-seam verdict

The naive de-risking claim — *"both bindings call `router.handle()`, so REST inherits RBAC/audit for free"* — is **FALSE as written**. It is the load-bearing trap of the whole arc. Three verified code facts (confirmed in the D-1 design's adversarial verify pass) show why, and one bounded seam change resolves all three.

### §4.1 The three verified code facts

1. **Unknown role FAILS OPEN (`router.ts:150`).** RBAC is enforced only when the resolved role `!= 'unknown'` — an unknown caller BYPASSES the RBAC check entirely (documented back-compat for pre-`register_role` callers). A naive REST binding that synthesizes a fresh session not in the in-memory `sessionRoles` map resolves `'unknown'` → every role-scoped verb becomes callable → the REST request is **strictly MORE privileged than the same call over MCP**. This directly violates the hard "no-more-privileged-than-MCP" + tighten-only constraints. The hole fails OPEN, not closed.

2. **RBAC reads `getRole(sessionId)`, NOT `ctx.role` (`router.ts:149`).** The RBAC decision reads `engineerRegistry.getRole(ctx.sessionId)` — a session-keyed in-memory side-table — not `ctx.role` (which today is used only for logging). So a token→role binding does **not** gate RBAC unless the seam is changed: presenting a credential that resolves a role on `ctx` would be ignored by the router.

3. **`resolveCreatedBy` reads `getAgentForSession(sessionId)` → `anonymous-<role>` fallback (`caller-identity.ts:53,63`).** Provenance stamps `agentId` from `getAgentForSession(ctx.sessionId)`. For a session-less / agent-unbound REST request this returns null → `agentId` falls back to the placeholder `anonymous-<role>`. REST-created entities would be attributed to `anonymous-architect`, not `lily` — an audit/provenance gap (A4 no-silent-failure, A12 precision-context). **The three-way conflict:** getting a real `agentId` via `getAgentForSession` requires the agent record bound to the session — but binding it is exactly what triggers the **ADR-021 auto-claim displacement** (`router.ts:177`) that would corrupt a live MCP session. Full RBAC + full provenance + no session-displacement cannot all hold under the current code without a seam change.

### §4.2 The approved bounded fix (Director-APPROVED, 2026-06-21)

**Thread a resolved `{role, agentId}` onto `IPolicyContext`; have `router.handle()`'s RBAC + `resolveCreatedBy` consume ctx-first, with the `engineerRegistry` session-lookup as fallback.** This is ONE bounded **consolidation** of the authority seam — additive at the binding layer, but honestly a single change at the identity seam (NOT "zero authority code"). It is not a fork; it is the one place authority reads identity.

Why it works:

- **Fails CLOSED.** REST resolves a CONCRETE role from a token-bound credential and never reaches `router.handle()` as `'unknown'` — so the `router.ts:150` fail-open hole is structurally unreachable on the REST path. Unknown / no-identity → DENY.
- **Makes the token→role binding actually gate RBAC.** With RBAC consuming `ctx.role` first, a presented bearer's role gates the verb. It is **tighten-only**: a token can never grant more than its role.
- **Gives real provenance.** `agentId` is threaded via `ctx` directly — no `getAgentForSession` call is needed for REST — so a REST-created entity is attributed to the real `agentId` (e.g. `lily`), not `anonymous-<role>`.
- **bug-168/169 — RECONCILE WITH #346 AT R2 (do NOT assert as a clean fix; greg #348 review).** The merged **#346 already shipped a bug-168/169 fix that is registry-first.** So this charter's ctx-first precedence must be reconciled against #346 at R2: verify bug-168/169's actual closed-state, and determine whether ctx-first supersedes, layers cleanly over, or is mooted by the merged registry-first fix. The earlier framing ("incidentally fixes bug-168/169") is RETRACTED pending that reconciliation — #346 may already own it. Tracked: DR-S2-006.
- **MCP path behavior is unchanged.** MCP continues to populate `ctx` (or fall back to the registry lookup) exactly as today; the consolidation is read-compatible.

### §4.3 The `setSessionRole`-without-`claimSession` mechanism (avoids ADR-021 displacement)

The seam that makes "RBAC parity WITHOUT session split-brain" achievable: **`setSessionRole` (`agent-repo-substrate.ts:284`) writes a `sessionRoles` map INDEPENDENT of `currentSessionId`** (the field `getAgentForSession` and the ADR-021 auto-claim key on). Therefore REST can seed correct RBAC for a synthetic session via `setSessionRole(syntheticSessionId, role)` **WITHOUT** calling `claimSession` / `assertIdentity` → **no ADR-021 displacement of any live MCP session.** Combined with §4.2 (agentId threaded via `ctx`, not via `getAgentForSession`), this resolves the three-way conflict: full RBAC + real-agentId provenance + no displacement all hold.

This identity-seam verdict is a **recommendation/spec at this rung** — the consolidation itself is built at R2 (M-REST-Identity-RBAC-Audit-Parity). The token→agentId+role credential model extends the mission-86 TokenStore (`bearer_tokens`) as a nullable additive binding (legacy `HUB_API_TOKEN` grandfathered); that is flagged as a **cross-mission coordination dependency**, resolved at R2, not folded incidentally.

## §5 The identity-driven conformance-gate spec

A surface-equality test ("both bindings project the same tools") is **tautological** for RBAC — if both call `router.handle()` they expose the same surface by construction, proving nothing about privilege. It is rejected as the sole gate. The conformance gate has teeth only when it is **identity-driven**: it injects real, differing identities and asserts the decision. For representative role-scoped verbs:

1. **Correct role → ALLOW + audit row matching the MCP equivalent** (parity, not just success).
2. **Wrong role → DENY.**
3. **Unknown / no-identity → DENY** — this is the regression test that **pins the `router.ts:150` fail-open hole shut**.
4. **Every registered tool is projected** (none silently dropped — A4).
5. **Every REST route is backed by a registry tool** (no route un-backed by an authority verb — proves no forked route table).

This gate is specified here at R0; it is implemented as the CI teeth at R2 (write-capable parity) and re-asserted at R3. (5) is partly checkable from R1 as surface-derivation; (1)–(3) require the identity seam and so land at R2.

## §6 The D-1 root-layout decision

The D-1 directive is literal about a sovereign root surface. The layout, ratified at the gate:

- **`api/`** — the sovereign contract root: the projection **conventions** doc, the **generated OpenAPI snapshot** (CI-diffed; drift = test failure; never a source of truth), and the **conformance suite** (§5).
- **`cli/`** — `oisctl` source (the kubectl analog; thin REST client; built at R4).
- **`hub/src/rest/`** — the runtime REST **binding** (`bindRouterToRest`, the twin of `mcp-binding.ts`). It needs the in-process router, and it READS the `api/` conventions; it does not own the contract.

The contract lives in `api/`; the binding in `hub/src/rest/` projects it. This keeps the sovereign contract decoupled from any one runtime.

---

## Open questions (design is silent — flagged, not invented)

- **Synthetic-session lifecycle / GC.** The `setSessionRole`-without-`claimSession` mechanism seeds a synthetic session id into the in-memory `sessionRoles` map per REST request (a write to a shared singleton — a leak/concurrency surface the adversarial pass noted). The design does not specify synthetic-session id generation, reuse, or cleanup. **Resolve at R2** before write-capable REST ships.
- **Token credential rotation / revocation.** R2 binds token→agentId+role on the mission-86 TokenStore, but the design does not specify rotation, revocation, or scope-narrowing semantics for those credentials. Flag for the R2 cross-mission coordination with mission-86.
- **Admin-route guard interaction.** The design notes admin routes keep the separate `HUB_ADMIN_TOKEN` guard alongside the bearer gate; how admin-token identity threads `{role, agentId}` onto `ctx` (or whether it bypasses §4.2) is unspecified. Flag for R2.

## Cross-references

- `docs/specs/ois-api-conventions.md` — the projection convention (resources, methods, actions, watch, unwrap, versioning).
- `docs/designs/d1-sovereign-rest-control-plane-arc-design.md` — the ratified arc design (R0–R6, spec, risks, adversarial verdict).
- `docs/reviews/autonomous-stint-arc-shortlist.md` §"D-1" + §"RATIFIED" — the Director directive + gate ratification.
- idea-121 (API v2.0) — exact tool/verb NAME STRINGS (the convention is decided here; the strings defer there).
