# D-1 R1 — REST Read-Binding + Derived Contract — Design-of-Record (rung refinement)

**Status:** DRAFT — architect design-of-record for D-1 R1; refines the ratified arc-design R1 section into a build-ready rung spec.
**Author:** lily (architect)  ·  **Date:** 2026-06-27
**Rung:** D-1 R1 (size M, banked) — *M-REST-Read-Binding-And-Derived-Contract*.
**Grounds on:** `docs/designs/d1-sovereign-rest-control-plane-arc-design.md` §R1 + Spec · charter `docs/specs/ois-control-plane-charter.md` §1–§6 · conventions `docs/specs/ois-api-conventions.md` §1–§5. **Resolves** the conventions doc's R1-flagged open questions (isError→status read-subset, pagination/ordering, discovery shape) + defines the R1-scoped read-identity mechanism.
**Dogfood note:** this is **WI-1** of the C1-adoption dogfood (D-1 R1 construction coordinated through the work-queue, DR-S2-024). This doc is the architect-design deliverable WI-1 closes on as evidence; greg's construction-design (WI-2) builds against it.

---

## 1. Scope — what R1 IS (and deliberately is NOT)

R1 ships the **apiserver read skeleton**: a read-only REST binding projecting the existing read verbs over an idiomatic, runtime-derived contract — fail-closed, reversible, additive on the existing Express app. It is honestly a **"REST read surface" / status page**, NOT a control plane (charter §3 naming gate — actuation + agentic-drive are unmet until R3).

**IN scope (R1):**
- `bindRouterToRest(app, router, ctxFactory)` in `hub/src/rest/` — the structural twin of `bindRouterToMcp` (mcp-binding.ts), mounted on the existing Express app (already serving `/mcp` + `/health`); **no new deployment surface** on the VM/watchtower container.
- `deriveContract(router, schemaDefs)` — generalizes `computeToolSurfaceRevision` (tool-surface-revision.ts:62) to emit the resource/verb/field contract.
- **Read-only route projection:** `GET /apis/core.ois/v1/<resource>/<id>` (get-one) + `GET /apis/core.ois/v1/<resource>` (list/filter collection), for read verbs ONLY.
- **Discovery:** `GET /apis/core.ois/v1` (api-resources) + per-resource explain — generated from the derived contract.
- **Fail-closed read identity:** every read resolves a CONCRETE role; `unknown` never reaches `router.handle()` (§3).
- **`PolicyResult`→HTTP unwrap** for the read path + the **isError→status read-subset** map (§5).
- **Pagination/ordering** projected from the existing list-verb `limit/offset/sort` + `_ois_pagination` (§6).
- `api/` root: the conventions doc (exists) + a **CI-diffed generated OpenAPI snapshot** (`api/openapi.core.ois.v1.json`) + the R1 conformance suite.
- **Reversibility:** all `/apis` routes behind `REST_API_ENABLED` (default OFF until roll-confirmed); `/mcp` + `/health` untouched; code-only watchtower redeploy.

**OUT of scope (deferred, named — no silent gaps, tele-4):**
- **All mutation + action verbs** (create/update/delete/claim/lease/...) → **R3**. R1 projects read verbs ONLY.
- **The full identity-seam consolidation** (thread `{role, agentId}` onto `IPolicyContext`; RBAC + `resolveCreatedBy` ctx-first) → **R2**. R1 uses the minimal interim read-identity mechanism (§3) that works with TODAY's `getRole(sessionId)` RBAC source.
- **Token→agentId+role credential model** (mission-86 TokenStore extension) → **R2**. R1 reuses the existing mission-86 fail-closed bearer gate + a bounded role resolution (§3).
- **WATCH (SSE)** → **R5** (conventions §2.2 places it there). R1 is get/list only — no `?watch=true`.
- **bug-168/169 ↔ #346 reconciliation** → **R2**. R1 neither asserts nor depends on that fix; it only seeds the existing session-role map the current RBAC already reads.
- **Write-path status codes (409 CAS-conflict, write-422), PATCH merge semantics** → **R3**.

## 2. The derived contract — `deriveContract(router, schemaDefs)`

The resource set is **DERIVED at runtime**, never hand-listed (conventions §1; tele-10):
- **Resources = kinds with ≥1 registered policy verb** ∩ the SchemaDef inventory. Auto-EXCLUDES the 5 infra kinds (Counter / MigrationCursor / RepoEventBridgeCursor / RepoEventBridgeDedupe / SchemaDef) and auto-CORRECTS the verified 20/22/23 kind-count drift — the count is whatever the live registry ∩ inventory yields.
- **Per resource:** derived resource-name (exact STRING defers to idea-121), `kind`, `fields` + `renameMap` + `watchable` from the SchemaDef, and the **read verbs** (get/list) it exposes.
- **ETag = `computeToolSurfaceRevision`** (the bug-114 primitive) — drift detection.
- **The checked-in `api/openapi.core.ois.v1.json` is a CI-diffed SNAPSHOT of this derivation, never a source of truth** (drift = test failure).

**Read-verb classification (the load-bearing R1 contract decision).** R1 projects ONLY verbs that are pure reads, and the classification is **fail-closed**: a verb is GET-projectable iff it is *positively* classified read/idempotent; anything not provably a pure read is NOT exposed in R1 (a future mutating verb cannot accidentally surface as a GET). Candidate source-of-truth, in preference order: (a) an explicit `sideEffectClass: read|write|action` on the verb registration (cleanest, additive); (b) the existing idempotency/cache surface markers on read tools (`[ID]` / `[C30s]` — e.g. list/get tools carry `[C30s][ID][PAR]`) as the interim signal. greg's construction-design selects the source against the live registration metadata; the **default for any unclassified verb is NOT-projected** (tele-4).

## 3. Fail-closed read identity (the R1-scoped mechanism)

Charter §4 facts in play: (1) unknown role FAILS OPEN at `router.ts:150`; (2) RBAC reads `getRole(ctx.sessionId)`, not `ctx.role`; (3) the `resolveCreatedBy` → `anonymous-<role>` provenance gap — **moot for R1** because reads create no entities.

**R1 requirement:** every read resolves a CONCRETE role, so (a) `unknown` never reaches `router.handle()` (the `router.ts:150` fail-open hole is structurally unreachable on the REST read path), and (b) the read-AUDIT row attributes the read to a concrete role (parity with MCP).

**R1 mechanism (minimal, forward-compatible with R2):**
1. Authenticate via the **existing mission-86 fail-closed bearer gate** (`bearer-auth.ts`) — no synthetic unauthenticated session.
2. Resolve a **concrete role** for the credential (R1 role source: the bearer's associated identity / a configured role for the grandfathered `HUB_API_TOKEN`; **fail-closed** — no resolvable role → `401`, never `unknown`→handle).
3. **Seed `setSessionRole(syntheticSessionId, role)` WITHOUT `claimSession`** (charter §4.3 seam — writes the `sessionRoles` map independent of `currentSessionId`, so the existing `getRole(sessionId)` RBAC fires with the concrete role, and there is **no ADR-021 displacement** of any live MCP session).
4. Call `router.handle(readVerb, args, ctx)` on that synthetic session.

**Synthetic-session bounding (resolves the charter's GC open-question for the READ path):** `syntheticSessionId` is a **deterministic function of the credential** (e.g. `rest:<tokenId>`), so the in-memory `sessionRoles` map holds **one entry per credential** (bounded by the credential set), NOT one per request — no per-request leak, no GC machinery needed for R1. (The write-path GC concern the charter flags for R2 does not arise here.)

**R2 supersedes this:** when R2 threads `{role, agentId}` onto `ctx` and makes RBAC ctx-first, the `setSessionRole`-seed becomes the fallback path. R1's mechanism is the honest interim that works with today's RBAC source — **not throwaway, but explicitly interim**.

## 4. Route shapes + the read unwrap

Every route is a **thin projection** — parse path+query → `router.handle(readVerb, args, ctx)` → unwrap. NO route reads a repository or the substrate directly (charter §2).

| Route | Maps to |
|---|---|
| `GET /apis/core.ois/v1` | discovery (api-resources) from `deriveContract` (§7) |
| `GET /apis/core.ois/v1/<resource>` | the kind's **list** verb (collection; filter/paginate per §6) |
| `GET /apis/core.ois/v1/<resource>/<id>` | the kind's **get** verb (get-one) |
| `GET /apis/core.ois/v1/<resource>?explain` | per-resource explain (§7) |

**`PolicyResult`→HTTP unwrap (conventions §3):** `content[0].text` → `JSON.parse` → response body; `isError` → status (§5); non-JSON prose → `{ message }` (flagged for idea-121). A binding-layer shim; handlers + authority unchanged.

## 5. `isError` → HTTP status — R1 read-subset (resolves a conventions open-question)

| Authority outcome | HTTP |
|---|---|
| ok | `200` |
| not-found (get-one / resolve) | `404` |
| RBAC-deny (any role-scoped read verb) | `403` |
| missing/unresolvable credential | `401` |
| bad query / unknown filter op / malformed param | `400` |
| semantic validation failure | `422` |
| unmapped / internal | `500` (fail-safe default — never a misleading 2xx) |

Write-path codes (409 CAS-conflict, write-422) are R3. The `PolicyResult` shape does not discriminate these today; R1 maps via an error discriminator (an error-code/type on the result, or a binding-layer classifier over known error shapes) — greg's construction-design grounds the discriminator against the live error shapes.

## 6. Pagination + ordering (resolves a conventions open-question)

The existing list verbs already support `limit / offset / sort` and return an `_ois_pagination` block (verified on `list_missions` / `list_ideas` / `list_threads`). R1 projects what they already do — **no new pagination machinery**:
- Query params → list-verb args: `?limit=&offset=&sort=<field>:<order>&<flat-filter-key>=<value>`.
- **Flat filter keys → envelope paths via `renameMap`** (conventions §2.1; the single field-path authority).
- Response surfaces `{ items: [...], pagination: <_ois_pagination> }` (total / count / next_offset).
- Default ordering = the list-verb's deterministic `id:asc` tie-break; max result-set = the existing limit ceiling (500).
- **Cursor / continue-token deferred** (offset-pagination suffices for R1; cursor → R5/idea-121 if a watch-consistent cursor is needed).

## 7. Discovery (api-resources / explain) — R1 deliverable

- `GET /apis/core.ois/v1` → `{ groupVersion: "core.ois/v1", resources: [{ name, kind, namespaced: false, verbs: ["get","list"], watchable }] }` (the k8s api-resources analog, derived from §2).
- per-resource **explain** → `{ kind, fields: [{ name, path /*renameMap*/, type }], verbs, watchable }`.
- Both generated from `deriveContract`; the OpenAPI snapshot is the formal CI-diffed artifact.

## 8. Conformance at R1 (checkable now vs deferred)

The charter §5 gate is identity-driven; the full wrong-role / unknown-DENY teeth for **writes** land at R2. R1 CAN + MUST assert:
- **(R1-a) Surface-derivation:** every registry read-verb is projected as a GET route; every GET route is backed by a registry read-verb (no hand-listed routes; charter §2).
- **(R1-b) Unknown-never-reaches-handle:** a REST read with no/unresolvable credential → DENY (401/403), never an `unknown`-role `handle()` call (the R1 portion of charter §5(3) — the fail-open hole structurally unreachable on the read path).
- **(R1-c) Read-audit parity:** a REST read emits the same concrete-role read-audit attribution as the MCP equivalent.
- **(R1-d) Derived-contract drift:** the checked-in OpenAPI snapshot matches `deriveContract` (CI-diff); zero hand-listed kind counts.
- **(R1-e) Status map:** representative read errors return §5 codes (404/403/400).

Deferred: wrong-role→DENY + unknown→DENY for **write** verbs → R2 (identity-seam consolidation); actuation parity + the agentic-drive dogfood → R3.

## 9. Reversibility + deploy

All `/apis` routes behind `REST_API_ENABLED` (default **OFF**; flip ON only after roll-confirm). `/mcp` + `/health` untouched (diff-proof). Additive on the existing Express app → **code-only watchtower redeploy** (push `hub:latest` → watchtower roll; NOT Cloud Run). Reverse = flag OFF / redeploy prior image. **No substrate migration.** Standalone value: org-state readable over plain HTTP/curl via a self-correcting derived contract, **zero mutation hazard**.

## 10. Acceptance criteria (evidence-shaped — for the WI-3 verifier-gate)

- `bindRouterToRest` twin'd on the Express app behind `REST_API_ENABLED`; `/mcp` untouched (diff-proof).
- `deriveContract` emits resources = verb-backed kinds ∩ SchemaDef; infra kinds excluded; count derived not hand-listed (CI test).
- GET get-one + list/filter + discovery routes for all read verbs; each route registry-backed (R1-a).
- Fail-closed read identity: no/unresolvable credential → DENY; concrete role on every handled read; synthetic-session bounded per-credential (R1-b).
- `isError`→status read-subset (404/403/400/401/500); `PolicyResult` unwrap (clean JSON body, no MCP-envelope leak).
- Pagination/ordering projected from the list verbs (`_ois_pagination` surfaced); `renameMap` filter translation.
- OpenAPI snapshot CI-diffed against `deriveContract` (R1-d).
- R1 conformance suite (R1-a..e) green.
- Reversible code-only redeploy; flag default OFF.

## 11. Build handoff (greg's construction-design seeds — WI-2)

Open decisions greg's construction-design grounds against live code, each with a fail-closed default named here:
1. **Read-verb classification source** — explicit `sideEffectClass` vs the existing `[ID]`/`[C30s]` markers (§2). Default: not-projected if unclassified.
2. **R1 credential→role source** — `bearer-auth.ts` + mission-86 TokenStore, pre-R2 (§3). Default: no resolvable role → 401.
3. **Error discriminator** for the §5 status map. Default: unmapped → 500.
4. **Deterministic synthetic-session-id scheme** (`rest:<tokenId>`-shape; §3). Bounded per-credential.

## Tele alignment

tele-3 sovereign-composition (sibling binding; one authority; clean `hub/src/rest/` + `api/` boundaries) · tele-10 declarative-source-of-truth (derived contract; OpenAPI snapshot is an artifact) · tele-4 zero-loss/no-silent-failure (fail-closed reads; no silent un-projection; no MCP-envelope leak; unmapped error → 500) · tele-12 precision-context (`renameMap` filter translation; explain/api-resources) · tele-8/9 gated + deployment-validated (versioned `core.ois/v1`; conformance-checkable; additive + reversible behind `REST_API_ENABLED`; code-only redeploy) · tele-6 frictionless (org-state over plain HTTP/curl). **Honest naming:** REST read surface, not a control plane.

## Open questions → R2/R3

isError write-codes (409/422-write) → R3 · PATCH merge semantics → R3 · token rotation/revocation → R2 · admin-route identity threading → R2 · the full identity-driven wrong-role/unknown-DENY for **writes** → R2 · cursor pagination → R5/idea-121.
