# OIS API Conventions — the projection convention (architecture altitude)

**Status:** DRAFT
**Author:** lily (architect)  ·  **Date:** 2026-06-21
**Origin:** D-1-R0 (ratified D-1 arc; design `wf_514a4e05`) — M-Control-Plane-Charter-And-Identity-Seam-Spike. Companion: `docs/specs/ois-control-plane-charter.md` (the authority charter).

This is a **zero-production-code** conventions rung. It defines, at **architecture altitude**, HOW the one authority (`PolicyRouter.handle()`) projects onto an idiomatic REST surface: how resources are derived, how kinds/CRUD/actions/list/watch map to HTTP, how a `PolicyResult` unwraps to an HTTP response, and how the API is versioned. It is the artifact the `api/` root and the `bindRouterToRest` binding READ; it does not implement them.

**Scope boundary (decided here vs deferred):** the projection CONVENTION is architecture-altitude and is decided HERE. Only the exact resource/verb **NAME STRINGS** defer to idea-121. A `POST /:verb` RPC tunnel would satisfy "decoupled from `/mcp`" literally but reads as MCP re-skinned — the Director's ask is idiomatic kube-apiserver REST, so the idiomatic projection is defined here, not deferred.

---

## §1 Resources are derived, never hand-listed

The set of REST resources is **DERIVED at runtime** from the live authority + substrate — never a hand-maintained list. This is the tele-10 (declarative-source-of-truth) property and it auto-corrects the verified kind-count drift.

- **`deriveContract(router, schemaDefs)`** generalizes the existing `computeToolSurfaceRevision(router)` walk (`tool-surface-revision.ts:62`).
- **Resources = the set of kinds that have at least one registered policy verb.** This is the load-bearing rule:
  - It auto-EXCLUDES the 5 infra SchemaDefs with no agent-facing verbs (Counter, MigrationCursor, RepoEventBridgeCursor, RepoEventBridgeDedupe, SchemaDef).
  - It auto-CORRECTS the verified three-way kind-count drift (`all-schemas.ts` has 23 `kind:` declarations, CLAUDE.md says 20, `entity-kinds.json` says 22) — because the contract is derived, the count is whatever the live registry ∩ inventory says, not a number anyone maintains.
- **Verbs = the verb registry.** Schema / fields / `watchable` / `renameMap` come from the live SchemaDef inventory (`all-schemas.ts`).
- **ETag = `computeToolSurfaceRevision`** (the bug-114 primitive) — drift-detection for the derived contract.
- **The checked-in OpenAPI snapshot is a CI-DIFFED SNAPSHOT of this derivation, never a source of truth.** `api/openapi.core.ois.v1.json` is regenerated from `deriveContract`; if it drifts from the live derivation, the CI test FAILS. It is an artifact, not an authority.

A CI test asserts **zero hand-listed kind counts** anywhere in the binding or contract. (Verb existence, not the kind taxonomy, is what makes a kind a resource — a kind with only infra/no verbs is not a resource.)

## §2 The projection map (kind → REST)

The idiomatic resource-noun projection. `<resource>` is the derived resource name; exact strings defer to idea-121 (§5).

| Domain concept | REST projection |
|---|---|
| **Kind** | a **resource** under the group/version path: `/apis/core.ois/v1/<resource>` |
| **Read one** (get) | `GET /apis/core.ois/v1/<resource>/<id>` |
| **List / filter** (list) | `GET /apis/core.ois/v1/<resource>` (collection) — see §2.1 |
| **Create** (create) | `POST /apis/core.ois/v1/<resource>` |
| **Update** (update) | `PUT` / `PATCH /apis/core.ois/v1/<resource>/<id>` |
| **Delete** (delete) | `DELETE /apis/core.ois/v1/<resource>/<id>` |
| **ACTION verb** (claim / lease / ack / actuate / ...) | `POST /apis/core.ois/v1/<resource>/<id>/<action>` — the **kubectl subresource** analog |
| **WATCH** | `GET /apis/core.ois/v1/<resource>?watch=true` as **SSE** — see §2.2 |
| **Discovery** | `GET /apis/core.ois/v1` (api-resources) + per-resource **explain**, generated from the derived contract (§1) |

Rationale: CRUD maps to HTTP methods on resource nouns (not RPC verbs); domain actions that are NOT CRUD (claim/lease/ack/...) map to `POST <id>/<action>` subresources rather than being forced into PUT/PATCH semantics — this is the kube-apiserver pattern (e.g. `pods/<id>/exec`, `deployments/<id>/scale`). Because every route is a thin projection onto `router.handle()`, the cascade / FSM / CAS transforms ride for free (charter §1–§2).

### §2.1 List / filter — flat filter keys → envelope paths via `renameMap`

The substrate stores K8s envelopes; the domain shape above the repo membrane is flat. REST filters are expressed in **flat** domain terms (what callers know), and translated to **envelope field-paths** via each kind's **`renameMap`** — the single field-path authority (tele-12). A `GET` collection with filter query params translates each flat filter key to its envelope path through `renameMap` before the query reaches the authority. `renameMap` is the one place a relocated field is declared (write-encode + filter-translate + read-decode all derive from it), so a filter never hard-codes an envelope path.

### §2.2 WATCH — SSE over LISTEN/NOTIFY (never a poll loop)

WATCH is `GET /apis/core.ois/v1/<resource>?watch=true` delivered as **SSE**, riding the proven `GET /mcp` SSE plumbing over the mission-83 **substrate-watch LISTEN/NOTIFY** primitive (`postgres-substrate.ts`). It is gated on `SchemaDef.watchable === true`. Long-poll is permitted ONLY as a NOTIFY-backed fallback. There is **NO FS-walk / DB poll loop** — this honors the bug-93 poll-pressure structural elimination (74% Hub CPU, eliminated at mission-83 W5); a naive poll-based WATCH is a regression and is forbidden.

## §3 The `PolicyResult` → HTTP unwrap contract

Handlers return the MCP-shaped envelope `{ content: [{ type: 'text', text: JSON.stringify(body) }], isError? }`. A naive forward leaks a double-encoded MCP envelope to an HTTP client — not clean REST. The unwrap is a **binding-layer shim, NOT a handler change** (handlers are unchanged; authority is untouched):

1. **Body:** `content[0].text` → `JSON.parse` → the HTTP response body (the clean JSON the resource represents).
2. **Status:** `isError` maps to a `4xx` / `5xx` HTTP status (the error path).
3. **Non-JSON prose:** a handler returning prose text (not JSON-parseable) degrades to a defined `{ message: <text> }` shape, **flagged for idea-121** typed-results.

This shim is what makes the surface read as idiomatic REST rather than an MCP envelope tunneled over HTTP.

## §4 Versioning — `core.ois/v1`

- **API group/version: `core.ois/v1`**, reusing the **k8s-envelope `apiVersion`** already stamped on every substrate row. The path is versioned from the first rung: `/apis/core.ois/v1/...`.
- **Intra-version drift detection** reuses the `computeToolSurfaceRevision` ETag (§1).
- **`v1 → v2` evolution machinery is DEFERRED** (D-1 R6 register) — not built in this arc.

**Coordination flag:** the group/version STRING is architecture-altitude (not an exact tool/verb name) and is reasonable reuse of the existing envelope `apiVersion`; the Director's gate leaned to `core.ois/v1`. It is recorded here as **decided-but-flagged as an idea-121 coordination point** — surfaced rather than unilaterally frozen, so idea-121 can confirm or revise it alongside the name strings.

## §5 Decided here vs deferred to idea-121

**Decided here (architecture altitude — the CONVENTION):**

- Resources are derived from verb-registered kinds ∩ SchemaDef inventory (§1).
- The kind → resource / CRUD → method-path / action → `POST <id>/<action>` subresource / list-filter → `GET` collection via `renameMap` / WATCH → SSE-over-LISTEN-NOTIFY projection map (§2).
- The `PolicyResult` → HTTP unwrap contract (§3).
- Versioned path shape `/apis/core.ois/v1/...` and ETag-based drift detection (§4).
- The OpenAPI artifact is a CI-diffed snapshot of the derivation, never a source of truth (§1).

**Deferred to idea-121 (exact NAME STRINGS, not the convention):**

- The exact `<resource>` name strings (the kind → resource-noun spelling).
- The exact `<action>` verb strings (claim / lease / ack / actuate / ... spellings + envelopes).
- The typed-results shape that supersedes the §3 prose-degradation `{ message }` fallback.
- (Coordination point, §4) confirmation of the `core.ois/v1` group/version string.

---

## Open questions (design is silent — flagged, not invented)

- **`isError` → exact status-code mapping.** The design specifies `isError → 4xx/5xx` but does not enumerate which authority error maps to which code (e.g. RBAC-deny → 403, not-found → 404, CAS-conflict → 409, validation → 422, internal → 5xx). The `PolicyResult` shape does not today discriminate these. The status-code mapping table is **unspecified — resolve at R1/R2** (R1 for read errors, R2 once denials/conflicts on writes appear).
- **Collection pagination / ordering.** §2.1 covers filter-key translation via `renameMap`, but pagination (limit/continue-token), default ordering, and result-set bounds for large `GET` collections are not specified. **Flag for R1.**
- **`PATCH` semantics.** §2 lists both `PUT` and `PATCH` for update; whether PATCH is merge-patch / JSON-patch / strategic-merge (the kube distinction) is unspecified and depends on the underlying CAS/update verb shape. **Flag for R3** (write/actuate rung).
- **Discovery (`api-resources` / explain) response shape.** §2 names the discovery endpoints; the exact discovery document shape is an R1 deliverable, not fixed here.

## Cross-references

- `docs/specs/ois-control-plane-charter.md` — the authority charter (single authority, binding invariant, naming gate, identity-seam verdict, conformance gate, root layout).
- `docs/designs/d1-sovereign-rest-control-plane-arc-design.md` — the ratified arc design (R0–R6, spec, risks, adversarial verdict).
- idea-121 (API v2.0) — exact tool/verb name strings + typed-results.
