# M-Envelope-Substrate-Completion — Design v0.1

**Status:** v0.1 — engineer round-1 audit PENDING; **NOT ratified**. Phase 4 entry draft assembled from a 5-bundle design-research fan-out (1 of 5 bundles — `remigration-shadow` — failed to return structured output; the §3 migration plan is reconstructed from Survey Q3a/Q6a + F5 + the wave-decomp/validation bundles, with the harness-mechanism gap surfaced explicitly as audit-ask §9.A4 rather than papered over).
**Source idea:** idea-323 (M-Substrate-List-Filter-Envelope-Translation)
**Mission name:** M-Envelope-Substrate-Completion (rename candidate per Survey §4 — reflects the 318+320+324 fold; supersedes filed name M-Substrate-List-Filter-Envelope-Translation)
**Survey envelope:** `docs/surveys/m-substrate-list-filter-envelope-translation-survey.md` (Director-ratified 6 picks across 2 rounds, 2026-05-29)
**Branch:** `agent-lily/m-envelope-substrate-completion`
**Mission-class:** saga-substrate-completion (with structural-inflection character per the renameMap-runtime-contract primitive; F6 PROBE — engineer concur)
**Sizing:** L multi-wave (5 waves W1–W5 implementation + W6 post-cutover validation + W7 cleanup/ship)
**Author:** lily / 2026-05-29

---

## §1 Goal + intent (echo Survey envelope §3)

idea-323 is ratified not as the medium substrate-introduction it was filed as, but as the **completion of the envelope-substrate maturity saga** — a single, internally-gated, multi-wave mission that closes every remaining envelope-shape consumer-code seam network-wide. The six Director picks resolve to one coherent shape: *deliver a new runtime declarative primitive (`renameMap` promoted to a first-class `SchemaDef` field, consumed by the reconciler's existing watch-loop), make it the universal field-name-resolution authority across the full substrate read/write surface, sweep every consumer to it, then reversibly re-migrate residual legacy-shape rows and drop the dual-shape branch — all held in one mission identity, de-risked by per-wave release-gates and a shadow-validated re-migration rather than by scope-reduction.*

**Primary outcome (load-bearing for ship):** the substrate filter-translation silent-failure class (bug-138) is structurally eliminated network-wide — all 8 envelope-blind list tools (`list_bugs`, `list_turns`, `list_ideas`, `list_threads`, `list_proposals`, `list_tele` + the already-mitigated `list_missions` / `list_tasks`) + `get_pending_actions` + the sweeper / repo / task-internal-read surfaces become envelope-correct by consuming one declarative runtime contract, and the legacy-shape branch is retired (no perpetual dual-lookup debt).

**Secondary outcomes:**
1. A reusable runtime field-translation primitive that serves all future schema-evolution renames, not just the envelope migration.
2. Absorption of idea-318 (reconciler status-write-patch), idea-320 (substrate read-normalization), idea-324 (repository-envelope-native) — retiring three follow-on missions per Survey Round-2 Q5(a).
3. The Survey + ledger-reconciliation flows regain trustworthy list-tool results (substrate-self-dogfood); unblocks idea-325 (M-Ledger-Reconciliation-Idea+Bug).

**The six picks (echoed from Survey §1/§2):** Q1(a) maximal scope-fold · Q2(a) promote renameMap to runtime · Q3(a) re-migrate residual rows + envelope-only · Q4(a) one mission, gated waves · Q5(a) absorb 318+320+324 · Q6(a) reversible + shadow-validated re-migration.

**Key design constraints surfaced (carried from Survey §3 into this Design):**
- **Runtime-contract promotion is the load-bearing W1 primitive** — `renameMap` must move from migration-only (`MigrationSchemaRef.renameMap`) to the runtime `SchemaDef` interface + be built into a query-time translation table the reconciler maintains. Everything downstream consumes it; it gates all other waves.
- **Two independent root-cause layers** (substrate `jsonbField` + policy `FieldAccessor`) must BOTH be swept; fixing only the substrate chokepoint leaves the in-memory-filter tools (list_ideas/list_threads) broken (F1 CRITICAL).
- **Per-wave release-gates** are a hard requirement (Q4a) — each wave ships + proves before the next; the W5 re-migration gate cannot pass without shadow-read old-vs-new parity evidence (Q6a).
- **Field-collision renames** (e.g. `Message.kind → metadata.messageKind`) must be covered by the generic contract, not just `status → status.phase` (Q2a generality; F3).

Tele alignment (whole-mission primary): **structural-elimination + substrate-fidelity** *(placeholder short-names; pin exact tele-N IDs against `docs/methodology/tele-glossary.md` in §4 before finalize-gate — Survey tele-alignment bundle returned null)*. Secondary: **anti-silent-failure + operator-DX/trust + substrate-self-dogfood** *(placeholder)*.

---

## §2 Architecture

### §2.1 renameMap promotion to a first-class runtime `SchemaDef` field (the W1 primitive)

The runtime `SchemaDef` interface at `hub/src/storage-substrate/types.ts:14` currently carries `kind` / `version` / `fields[]` / `indexes[]` / `watchable` (Design v1.3 §2.3) plus `indexOwnershipPattern?` (mission-88 W7 bug-123 fix at :35). **It does NOT carry `renameMap`** (code-verified at Survey prep + re-verified at Design assembly). The per-kind field-translation table exists ONLY inside the one-time v2-envelope MIGRATION modules' `MigrationSchemaRef.renameMap` (`hub/src/storage-substrate/migrations/v2-envelope/kinds/<Kind>.ts`; `RenameMap` type declared at `_contract.ts:39` — *bundle cited :29; minor line-drift, see §9.A3*). The reconciler never reads it. So the idea's literal premise ("substrate.list reads SchemaDef renameMap") requires **promoting a migration-only artifact to a runtime contract**.

Per Survey Q2(a), add an optional first-class field to the runtime interface:

```typescript
export interface SchemaDef {
  kind: string;
  version: number;
  fields: FieldDef[];
  indexes: IndexDef[];
  watchable: boolean;
  indexOwnershipPattern?: string;

  /**
   * W1: runtime field-translation contract (promoted from migration-only
   * MigrationSchemaRef.renameMap). Mapping: bare legacy filter-key ("status")
   * → envelope JSONB path ("status.phase"). Generic for ANY key / ANY kind —
   * field-collision renames (e.g. Message.kind → metadata.messageKind) and
   * opaque-state renames (RepoEventBridgeCursor.body → status.cursor) fully
   * covered per Q2(a) generality. Optional; kinds without renames omit it.
   */
  renameMap?: RenameMap;
}

/** Bare legacy field-name → envelope JSONB dotted-path. Shape identical to the
 *  migration-only MigrationSchemaRef.renameMap (_contract.ts:39). */
export type RenameMap = Record<string, string>;
```

**Rationale.** Promotion centralizes field-translation authority and eliminates the dual-source problem: migration modules define the renames (encode-only) while the runtime is decode/filter-blind. The `SchemaReconciler` already watches `SchemaDef` changes via the substrate watch primitive — adding `renameMap` as a field requires **no new infrastructure**, only a pure additive field-population step. *(Architect-flag F2 CRITICAL: this must NOT trigger index-churn — see §2.2 + §9.A2.)*

### §2.2 SchemaReconciler integration — build + cache a per-kind reverse-translation table

The `SchemaReconciler` (`hub/src/storage-substrate/schema-reconciler.ts`) has an existing runtime watch-loop (`runtimeLoop`) that subscribes to `watch('SchemaDef')` and re-reconciles indexes on SchemaDef puts. Promotion adds a **private reverse-map cache** populated as a side-effect of `applySchemaIndexes` — NOT a new watch, NOT a new reconcile trigger:

```typescript
export class SchemaReconciler {
  // Per-kind: Map<bare-filter-key, envelope-JSONB-path>
  private readonly fieldTranslationMap = new Map<string, Map<string, string>>();

  /** Built during applySchemaIndexes (boot-time + runtime SchemaDef put).
   *  Pure additive field-population; no index-emission side-effect. */
  private buildFieldTranslationMap(def: SchemaDef): void { /* invert def.renameMap into the cache */ }

  /** Public accessor consumed by BOTH the substrate layer (§2.3) and the
   *  policy layer (§2.5). Single API surface — no signature drift (§9.A6). */
  public getFieldTranslation(kind: string, bareKey: string): string | undefined {
    return this.fieldTranslationMap.get(kind)?.get(bareKey);
  }
}
```

**Integration point.** `applySchemaIndexes` calls `buildFieldTranslationMap(def)` AFTER the index-emission loop. This runs once per SchemaDef at boot, and once per future SchemaDef version-bump via the runtime watch-loop. Index reconciliation proceeds normally; cache-refresh is a non-interacting side-effect. **No TTL / no invalidation** — the cache is exact to the current SchemaDef inventory; Hub restart rebuilds all caches at boot.

**Failure-coupling (intentional).** Cache population shares the reconciler's STRICT-ALL-OR-NOTHING boot semantic (mission-84 W2). If `SchemaReconciler.start()` fails, the cache is unpopulated and the Hub does not start — no silent degradation; operator sees the same clear failure path as a missing index.

### §2.3 Query-time translation in `substrate.list` (Layer A chokepoint)

`substrate.list` (`postgres-substrate.ts`) calls `translateFilterClause` (:436) per filter clause, which calls `jsonbField` (:482) to emit JSONB-extraction SQL. Today `jsonbField` maps bare `"status"` → `data->>'status'`, which is NULL for envelope rows shaped `{status:{phase:...}}` — the silent miss.

**Modification — a single pre-translation pass before the existing loop:**

```typescript
// W2: translate filter keys via renameMap BEFORE clause-translation / SQL-gen
const translatedFilter = this.translateFilterKeysToEnvelopePaths(kind, opts?.filter);
// translateFilterClause + jsonbField are UNCHANGED — they receive JSONB-path
// names (either translated, or untranslated bare names that have no rename).
// jsonbField already handles dotted paths: splits on "." → data->>'f' or data#>>'{a,b}'.
```

`translateFilterKeysToEnvelopePaths(kind, filter)` rewrites each bare key via `reconciler.getFieldTranslation(kind, key) ?? key` (no-op for keys without a rename, e.g. `threadId`). The **same translation is applied to `sort` field-names and to projection (SELECT) field-names** before SQL emission. This single chokepoint **automatically fixes the two Layer-A tools** with no per-tool code change (§2.4).

### §2.4 The two-layer consumer sweep (F1 CRITICAL — two-layer-fix-is-not-one-fix)

The bug-138 silent-failure class spans **8 list tools across two independent filter-execution layers**. Fixing the substrate chokepoint (§2.3) fixes ONLY Layer A; Layer B never reaches `substrate.list`.

**Layer A — substrate-delegating tools (automatic fix; no per-tool change):**

| Tool | Repository / list method | Filter path | Fix |
|---|---|---|---|
| `list_bugs` | `bug-repository-substrate.ts::listBugs` (:117–144) | `substrate.list(KIND, {filter})` (:131) | Automatic once §2.3 renameMap consumed at `translateFilterClause` |
| `list_turns` | `turn-repository-substrate.ts::listTurns` (:77–85) | `substrate.list(KIND, {filter})` (:80) | Automatic once §2.3 renameMap consumed at `translateFilterClause` |

**Layer B — policy in-memory-filter tools (per-tool refactor required):** these LOAD ALL entities then filter in-process via `list-filters.ts::applyQueryFilter` (:205) + `matchField` (:217) + per-policy FieldAccessors. The substrate translate-point never applies. When the filter asks `status: "open"` and the accessor returns `{phase:"open"}` (envelope row), `{phase:"open"} === "open"` → false — silent miss.

| Tool | Policy file / method | Current | Architect-recommendation (challenge at §9.A1) |
|---|---|---|---|
| `list_ideas` | `idea-policy.ts::listIdeas` (:107–149) | `applyQueryFilter(ideas, …, IDEA_ACCESSORS)` (:125) | **PUSH filters down to substrate.list** (hybrid pattern) |
| `list_threads` | `thread-policy.ts::listThreads` (:808+) | load-all then `matchField` | **PUSH filters down to substrate.list** |
| `list_proposals` | `proposal-policy.ts::listProposals` (:257–280) | inline `p.status === status` (:264) | **Upgrade to QueryShape + PUSH down** |
| `list_tele` | `tele-policy.ts::listTele` (:49–64) | inline `t.status` filter (:54–57) | **Preventative QueryShape Phase-C + push down** |

**Architect-recommendation (Option A per F1): PUSH FILTERS DOWN to `substrate.list` for all Layer-B tools**, unifying ALL filter-translation (legacy + envelope + future field-collisions) at the single substrate boundary, eliminating the dual-shape in-memory window, and composing with per-wave gates (W3 gates W4, each tool atomic). **Hybrid pattern** (per `bug-repository-substrate.ts::listBugs`): push scalar/JSONB-pathable fields to `substrate.list`; retain irreducibly client-side filters (array-contains tags, virtual-computed `createdBy.id = role:agentId`) in-memory post-fetch.

**Bundle-disagreement surfaced (NOT papered over):** the `renamemap-contract` bundle prescribes the *alternative* — make `matchField` envelope-aware in place (translate field-path before dotted-path navigation, keeping the load-all-then-filter shape). The `two-layer-sweep` + `validation-risks` bundles prescribe the push-down. These are mutually-exclusive Layer-B strategies. The Design carries **push-down as the architect-recommendation** but this is the explicit per-tool decision routed to engineer round-1 (§9.A1) — the engineer must code-verify each of the 8 tools' filter path and either concur with push-down or surface the in-place-matchField alternative as cheaper/safer per-tool.

**Already-mitigated / safe:** `list_missions` (UNION-based, envelope-aware per mission-89 Phase 5 — no change); `list_tasks` (returns all; caller filters — safe); `get_pending_actions` (uses `phaseFromEntity()` per bug-143 defect-3 — confirm alignment at W2 acceptance).

### §2.5 Policy-layer translation point (Layer B, if matchField-in-place is chosen over push-down)

If — and only if — the §9.A1 disposition selects the in-place alternative for any Layer-B tool, `matchField` translates the field-path via `reconciler.getFieldTranslation(kind, fieldPath) ?? fieldPath` before dotted-path navigation. Worked example: `list_ideas {filter:{status:"open"}}` → loaded entities are envelope-shaped `{status:{phase:"open"}}` → `matchField` receives `"status"` → translation returns `"status.phase"` → navigation extracts the phase → comparison proceeds. Both consumers (substrate §2.3 + policy §2.5) call the **same** `getFieldTranslation` API — no signature drift (§9.A6).

### §2.6 Complete renameMap inventory — 21 entries across 22 kinds (F3 MEDIUM)

Code-confirmed at Design assembly: 22 kind modules under `migrations/v2-envelope/kinds/` (23 files minus `_contract.ts`). The `renamemap-contract` bundle's enumeration (architect-authored, NOT yet engineer-verified — see §9.A3):

| Kind | renameMap entries | Pattern |
|---|---|---|
| Agent | status→status.phase, firstSeenAt→metadata.createdAt, lastSeenAt→metadata.updatedAt | FSM + timestamp |
| Audit | timestamp→metadata.createdAt | timestamp |
| Bug | status→status.phase | FSM |
| Counter | (none) | — |
| Document | (none) | — |
| Idea | status→status.phase, missionId→status.missionId | FSM + mutable-link |
| Message | **kind→metadata.messageKind**, status→status.phase | **field-collision** + FSM |
| Mission | status→status.phase | FSM |
| PendingAction | state→status.phase, enqueuedAt→metadata.createdAt | FSM + timestamp |
| Proposal | status→status.phase | FSM |
| Task | status→status.phase | FSM |
| Tele | status→status.phase, name→metadata.name | FSM + K8s-name |
| Thread | status→status.phase | FSM |
| Turn | status→status.phase, title→metadata.name | FSM + K8s-name |
| RepoEventBridgeCursor | **body→status.cursor** | opaque-state |
| RepoEventBridgeDedupe | body→status.dedupe | opaque-state |
| ArchitectDecision | timestamp→metadata.createdAt | timestamp |
| DirectorHistoryEntry | timestamp→metadata.createdAt | timestamp |
| ReviewHistoryEntry | timestamp→metadata.createdAt | timestamp |
| SchemaDef | kind→metadata.name | field-collision |
| ThreadHistoryEntry | timestamp→metadata.createdAt | timestamp |
| Notification | event→spec.eventType, timestamp→metadata.createdAt | rename + timestamp |

**Pattern grouping:** 16 FSM-phase (→`status.phase`/`status.X`) · 6+ timestamp (→`metadata.createdAt`) · 3 K8s-name (→`metadata.name`) · 2 field-collision (Message.kind, SchemaDef.kind) · 2 opaque-state (RepoEventBridge*). Spot-verified at assembly: Message (collision), RepoEventBridgeCursor (`body→status.cursor`), Notification all carry `renameMap` blocks in their migration modules. **The full per-entry table is architect-enumerated and is the FIRST round-1 audit deliverable (§9.A3)** — the engineer must regrep all 22 modules and reconcile against the final `all-schemas.ts` SchemaDef entries (no missing / no extra).

### §2.7 Canonical source-of-truth post-promotion

After W1, `renameMap` lives in TWO places kept in sync by design-discipline:
1. **Runtime `SchemaDef` entries in `all-schemas.ts` (AUTHORITATIVE):** the 22 SchemaDef constants each carry their `renameMap`; the reconciler builds its translation cache from these at boot. This is the single source-of-truth for the query-time contract.
2. **Migration modules `kinds/<Kind>.ts` (SECONDARY, reference):** each `MigrationSchemaRef` retains its `renameMap` for migration encapsulation + historical/rollback audit; an architect cross-reference comment points to the authoritative `all-schemas.ts` entry. No automated sync (one-time-per-migration event; complexity unjustified at v1) — flag for retrospective if a second migration wave occurs (see R1).

### §2.8 Absorbed-idea interaction (Q5a fold)

- **idea-318 (Reconciler Status-Write-Patch):** the reconciler already consumes `SchemaDef`; once `renameMap` is first-class (Q2a), the write-validation path can read it. Mechanically satisfied at W1+W2 — no separate wave.
- **idea-320 (Substrate Read-Normalization):** the substrate-chokepoint read-normalization lands at W2; the policy-layer remainder lands at W3.
- **idea-324 (Repository-Envelope-Native):** repo-wrapper internal-composition + sweeper-envelope-aware-filter + task-internal-read normalization land entirely at W4. Once Layer-B filters push down, idea-324's dual-lookup motivation is satisfied by the renameMap contract — it becomes a W4 code-organization refinement, not a blocking gap.

---

## §3 Migration plan — reversible re-migration + shadow-validation (Q3a + Q6a)

> **GAP DECLARATION.** The `remigration-shadow` research bundle FAILED to return structured output. This section is reconstructed from Survey Q3a (re-migrate residual rows + envelope-only), Q6a (reversible + shadow-validated), flag F5, and the wave-decomp/validation bundles. **The shadow-read harness MECHANISM and the rollback-rehearsal procedure are specified at intent-level only here** and are the most load-bearing round-1 audit deliverable (§9.A4). Do not treat §3.2/§3.3 as engineer-validated.

### §3.1 Posture (Q3a)

Production cutover to envelope-shape is COMPLETE (22 kinds @100% envelope, 2026-05-25 strict-flip). The straggler set is therefore expected near-empty — yet Q3a chose to actively re-migrate any residual legacy-shape rows to envelope-shape (driven through the SchemaDef-reconciler / migration pipeline) and then make `substrate.list` filter **envelope-only**, retiring the legacy-shape branch in `translateFilterClause` + the policy FieldAccessors' unmapped-shape guards. This is "redesign over perpetual-accommodation" (methodology #25 / Director-progressive-question lineage), not trust-the-cutover-passively. The data-touch is confined to W5; W1–W4 are pure read/write-path code with empty/synthetic substrate or live-but-additive contracts.

### §3.2 Reversible re-migration (architect-intent; engineer designs the mechanism — §9.A4)

W5 sequence (architect-illustrative; Phase 6 preflight measures + ratifies actual timings):
1. **W5-prep gate (pre Hub-stop):** W1–W4 integration green at HEAD; measured re-migration time on a prod snapshot within budget; shadow-read harness runs successfully; rollback runbook rehearsed.
2. **Hub stop + pre-cutover snapshot** — `pg_dump -Fc` (per `scripts/local/hub-snapshot.sh` posture) as the during-cutover-abort safety net.
3. **Reconciler-driven re-migration** — drive any residual legacy-shape rows through the reconciler → envelope-shape (`hub/scripts/migrate-envelope-re-migration.ts`). Idempotent / resumable per-kind.
4. **Shadow-read parity check (BLOCKING — see §3.3)** — must pass before the strict-flip.
5. **Envelope-only strict-flip** — remove the legacy-fallback branch in `translateFilterClause` + policy guards (W7 cleanup actually deletes; W5 flips the runtime mode).
6. **Verification** — count parity (all 22 kinds) + content-hash spot-check + zero legacy-shape rows.
7. **Restart + post-cutover smoke matrix** — sweeper end-to-end + all 8 list tools end-to-end + full API surface per kind.

**Reversibility:** pre-cutover `pg_dump` snapshot is the during-cutover-abort restore path (TRUNCATE partial state → `pg_restore` → restart). Post-cutover-success is fix-forward (consistent with the substrate-introduction precedent at mission-83 §3.2). The bundles disagree on the downtime budget: `wave-decomp` cites **<5min**; `validation-risks` cites **<60s TOTAL OBSERVED DOWNTIME**. The Design carries the tighter **<60s** as the target with **<5min as the hard ceiling**, and routes the reconciliation to §9.A7 — Phase 6 preflight measures actual wall-clock on a representative snapshot and ratifies the number.

### §3.3 Shadow-read parity harness (Q6a; mechanism UNSPECIFIED — §9.A4)

**Intent:** before the envelope-only strict-flip, run BOTH the old filter-path (legacy + dual-shape) and the new filter-path (renameMap-translated, envelope-only) against a `pg_dump`-restored prod snapshot, and diff result-sets per kind. **100% parity across all 22 kinds is the W5 gate release-criterion.** Open mechanism questions (all → §9.A4): what constitutes "100% parity" (count + content-hash + every renameMap translation exercised?); how the old-path is preserved transiently for the comparison (feature-flag both branches? snapshot-DB clone with both code paths?); how rollback is rehearsed on actual pre-cutover state; whether per-kind parallelism is needed to hit the downtime budget.

### §3.4 Dual-shape window discipline

During W3–W5 (dual-shape data may transiently exist) the renameMap contract must correctly resolve BOTH legacy and envelope paths. Q3a re-migrates all legacy rows BEFORE the envelope-only filter is flipped, so the dual-shape window is closed by data-convergence, not by a permanent dual-lookup branch (which is AG-4/Q3c, explicitly rejected). W5 verification confirms zero legacy-shape rows before the legacy branch is retired.

---

## §4 Wave decomposition (5 implementation waves + W6 validation + W7 ship; Q4a + F7 PROBE)

**Critical principle (Q4a):** one mission identity, internally gated. Each wave ships independently and gates the next. W1 (renameMap-runtime-contract) is the load-bearing primitive that blocks all downstream waves. No wave depends on a later wave for correctness (F8 fold-boundary revertibility).

**Absorbed-idea → wave mapping (Q5a; each independently shippable/revertible — F8):** idea-318 → W1+W2 · idea-320 → W2+W3 · idea-324 → W4.

| Wave | Scope | Owned surfaces | Release-gate criteria | Depends-on |
|---|---|---|---|---|
| **W1** | renameMap runtime-contract + reconciler translation-cache. Promote `renameMap` to `SchemaDef`; build the reverse-translation cache as a pure additive field in `applySchemaIndexes`; populate all 22 SchemaDef entries in `all-schemas.ts`. (Absorbs idea-318 foundational contract.) | `storage-substrate/types.ts` (SchemaDef + RenameMap); `schema-reconciler.ts` (cache + `getFieldTranslation`); `all-schemas.ts` (22 renameMap blocks) | CI green; reconciler watch-loop verification — **adding renameMap triggers ZERO index DDL churn / no reconcile-storm** (3× restart-cycle test); cache unit tests cover status→status.phase + collision (Message.kind→metadata.messageKind) + opaque (body→status.cursor) + no-op for unmapped keys; wire-flow: synthetic SchemaDef+filter through `getFieldTranslation` | — (gates all) |
| **W2** | Substrate filter-translation chokepoint. `substrate.list` pre-translates filter/sort/projection keys via `getFieldTranslation` before `translateFilterClause`/`jsonbField`. Fixes Layer-A tools (list_bugs, list_turns). (Absorbs idea-320 substrate read-normalization.) | `postgres-substrate.ts` (`translateFilterKeysToEnvelopePaths` + sort/projection translation) | CI green; **testcontainers postgres** integration: list_bugs/list_turns return envelope-shape rows when filtering on `status`; no regression on untranslated keys; dual-shape edge-case resolves envelope-only per Q3a; REAL MCP tool payloads (F4) | W1 |
| **W3** | Policy-layer Layer-B sweep. Per §2.4 architect-recommendation: push filters down to `substrate.list` for list_ideas/list_threads/list_proposals/list_tele (hybrid pattern; irreducible filters stay in-memory) — OR matchField-in-place per §9.A1 disposition. (Absorbs idea-320 remainder.) | `list-filters.ts::matchField` + per-policy handlers/FieldAccessors (idea/thread/proposal/tele) | CI green; per-tool unit tests (renamed + non-renamed + combined-filter cases); REAL MCP list_ideas/list_threads wire-flow (F4); confirm `get_pending_actions` alignment | W1, W2 |
| **W4** | Repository-envelope-native + sweeper/task-internal sweep (idea-324). Repositories internally compose substrate; sweepers read via `substrate.watch` with envelope-aware filters; task-internal entity-reads normalize envelope-shape. Handler surface UNCHANGED. (Absorbs idea-324 entirely.) | `hub/src/entities/*-repository*.ts`; `hub/src/sweepers/`; task-internal cross-entity reads | CI green; sweeper substrate.watch integration; repository CAS via substrate API; existing I*Store integration tests green; end-to-end task-create + message-filter-sweep | W1–W3 |
| **W5** | Reversible re-migration + shadow-validation + envelope-only strict-flip (§3). ONLY data-touching wave. | `hub/scripts/migrate-envelope-re-migration.ts`; shadow-read harness; `docs/operator/envelope-substrate-cutover-runbook.md`; runtime envelope-only flip | W5-prep gate (W1–W4 green; measured re-migration time; harness runs; rollback rehearsed); **shadow-read 100% parity all 22 kinds BEFORE strict-flip**; downtime within budget (§3.2 / §9.A7); verification PASS (count parity + content-hash + zero legacy rows); post-cutover smoke matrix PASS (all 8 tools envelope-correct) | W1–W4 |
| **W6** | Post-cutover validation + operator-DX finalize. Smoke on LIVE substrate; ledger-reconciliation list-tool parity (Survey/ledger flows regain trustworthy results); finalize runbook + psql cookbook. | `docs/operator/envelope-substrate-cutover-runbook.md`; ledger-reconciliation e2e; bug-138/bug-143 closure notes | CI green; ledger-reconciliation list-tool parity; runbook tested against actual post-cutover state | W5 |
| **W7** | Cleanup + ship. DELETE legacy-fallback branch in `translateFilterClause` + policy unmapped-shape guards; close bug-138 + bug-143; update CLAUDE.md substrate notes; mark idea-318/320/324 incorporated; Phase 7 release-gate. | `postgres-substrate.ts`; `list-filters.ts`; CLAUDE.md; idea status updates | All W1–W6 gates final; Phase 7 Director-approval; 3 absorbed ideas linked + incorporated; Phase 10 retrospective verifies substrate-self-dogfood restored | W1–W6 |

**F7 PROBE disposition (5-wave spine is the architect straw-man, NOT a commitment):** the spine reflects load-bearing dependencies — W1 contract → W2 substrate-translate → W3 policy-sweep → W4 repo/sweeper → W5 re-migration+flip. Alternatives considered: (A) 3-wave merge (contract+substrate+policy) loses per-layer validation granularity and risks F1's two-layer-fix-is-not-one-fix; (B) 6-wave split of W1 (reconciler-watch vs filter-translation) adds gate overhead without isolation benefit. **Recommendation: 5-wave spine.** Engineer proposes an alternative only if dependency-reordering evidence surfaces (§9.A8).

**Per-wave Hub-source PR cadence:** each wave is a `hub/src/` PR REQUIRING build-hub.sh + start-hub.sh + the Adapter-Restart-Protocol-includes-Hub-container discipline. Branch `agent-lily/m-envelope-substrate-completion-wN` (architect) ↔ `agent-greg/...` (engineer), cross-approval per `multi-agent-pr-workflow.md`; wave-per-PR cumulative-fold (mission-68 M6 pattern). Watchtower auto-deploy (bug-140) picks up each merged Hub image within ~5min — post-merge production dispositive available per wave.

---

## §5 Substrate location + package shape

This mission is **substrate-INTERNAL** (read/write-path + reconciler + policy-filter); it adds NO new module and NO new package — it extends existing surfaces.

```
hub/src/storage-substrate/
├── types.ts                 # W1: SchemaDef + RenameMap (renameMap field promotion)
├── schema-reconciler.ts     # W1: fieldTranslationMap cache + getFieldTranslation()
├── all-schemas.ts           # W1: 22 SchemaDef entries carry renameMap (AUTHORITATIVE source-of-truth)
├── postgres-substrate.ts    # W2: translateFilterKeysToEnvelopePaths (filter/sort/projection) + W7 legacy-branch deletion
└── migrations/v2-envelope/kinds/<Kind>.ts   # SECONDARY renameMap (reference/rollback; cross-ref comment to all-schemas.ts)

hub/src/policy/
├── list-filters.ts          # W3: matchField translation OR push-down (per §9.A1) + W7 unmapped-shape-guard deletion
├── idea-policy.ts / thread-policy.ts / proposal-policy.ts / tele-policy.ts   # W3: Layer-B per-tool refactor

hub/src/entities/            # W4: repository internal-composition (idea-324)
hub/src/sweepers/            # W4: substrate.watch + envelope-aware filter (idea-324)
hub/scripts/migrate-envelope-re-migration.ts   # W5: reversible re-migration (NEW)
docs/operator/envelope-substrate-cutover-runbook.md   # W5/W6 (NEW)
```

**Package shape:** no `packages/` change. The 22-kind inventory is LOCKED (`hub/scripts/entity-kinds.json` v1.1) — this mission adds NO kinds (AG-5). CODEOWNERS unchanged (all touched dirs already owned).

---

## §6 Anti-goals (locked from Survey §5)

Per Survey §5 — idea-318/320/324 are now IN-SCOPE (Q5a fold); the table below is what remains genuinely out. **LOCKED at this Design; Phase 6 preflight audits for scope-creep.**

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | Hub-API v2.0 wire-level envelope-shape exposure — this mission is substrate-INTERNAL filter-translation, NOT the wire-API/tool-surface verbs+envelopes | idea-121 (API v2.0); standing defer-tool-surface guidance |
| AG-2 | Diagnosing/fixing the `list_missions` -32000 error — origin is downstream of substrate.list (mission-repo already has the UNION fix); a separate defect | separate Bug filing if it recurs post-mission |
| AG-3 | Notification↔Audit consolidation | idea-321 (unrelated cluster) |
| AG-4 | Re-opening mission-89 OCC primitive / advisory-lock / counter work — settled; AND a permanent dual-lookup defense-in-depth branch (Q3c rejected — Q3a retires the legacy branch) | n/a (mission-89 closed) |
| AG-5 | Adding new entity KINDS — operates on the existing 22-kind locked inventory only | `hub/scripts/entity-kinds.json` v1.1 |
| AG-6 | Methodology-doc rewrites beyond any §15 spec-enrichment carve-out (e.g. the Task-FSM 3-vocabulary alignment) | idea-326 (M-Task-FSM-Vocabulary-Alignment) |

**Phase 10 retrospective responsibility (architect TODO):** mark idea-318 / idea-320 / idea-324 `incorporated` against this mission at Manifest-bind; link missionId; file any genuinely-new follow-on surfaced during waves.

---

## §7 Risks + open questions

### §7.1 Risks (integrated with per-wave mitigation gates)

| ID | Risk | Mitigation |
|---|---|---|
| R1 | **Dual-source maintenance burden** — post-promotion, both `all-schemas.ts` AND migration modules carry renameMap; future renames must be hand-synced | Architect cross-ref comment naming `all-schemas.ts` as authoritative; no automated sync at v1 (one-time-per-migration event); flag for retrospective if a 2nd migration wave occurs |
| R2 (CRITICAL, F2) | **renameMap→SchemaDef promotion triggers reconcile-storm / index-churn** | W1 gate: pure additive field; 3× restart-cycle test → zero index DDL churn; cache build is a non-interacting side-effect of `applySchemaIndexes` (§2.2) |
| R3 (CRITICAL, F1) | **Incomplete two-layer sweep leaves tools broken** — substrate fix (W2) does NOT auto-fix Layer-B (W3) | Per-wave gates mandate both layers; engineer code-verify per-tool filter path (§9.A1); W5 smoke-matrix exercises all 8 tools |
| R4 (MEDIUM, F3) | **Field-collision renames missed** — generic contract (Q2a) falsified if only status→status.phase covered | W1 audit enumerates ALL 21 entries across 22 kinds (§9.A3); tests cover collision + opaque + timestamp + K8s-name patterns |
| R5 (MAJOR, F5) | **Shadow-read parity harness design gap** — the failed `remigration-shadow` bundle left the mechanism unspecified | §9.A4 is the load-bearing round-1 deliverable; W1–W4 must complete by Phase 5 so Phase 6 can validate the harness on a prod snapshot |
| R6 (CRITICAL, Q3a+Q6a) | **Re-migration data-touch corrupts state** | Reversible (`pg_dump` snapshot) + shadow-read 100% parity BEFORE strict-flip; verification: count parity + content-hash + zero legacy rows |
| R7 (MAJOR, F8) | **Absorbed ideas not independently revertible** — if idea-318 (W1-W2) depends on idea-324 (W4) for correctness, fold-boundary independence is lost | Each absorbed idea in a distinct wave with independent gate; W1–W4 suite confirms W1–W3 correctness WITHOUT W4 present |
| R8 (MEDIUM) | **Cache staleness on SchemaDef hot-updates** | Cache rebuilt on every SchemaDef put via runtime watch-loop; boot-time full rebuild guarantees restart-safety; immutable per kind at a given version |
| R9 (MEDIUM) | **Translation transparency gap** — code paths querying by bare-key NOT via substrate.list or matchField miss translation | F1 sweep must cover ALL 8 tools + get_pending_actions + any repo-direct lookups; engineer round-1 verifies coverage |
| R10 (MEDIUM) | **Silent translation miss for misspelled keys** — unmapped key passes through unchanged; a typo matches a non-existent field silently | Schema validation + per-kind tests exercise 3+ keys (renamed + non-renamed + intentional-miss) |
| R11 (MEDIUM) | **Downtime budget unresolved** — bundles disagree (<60s vs <5min); re-migration + verification + restart may exceed | <60s target / <5min ceiling (§3.2); Phase 6 preflight measures actual on prod snapshot; parallel per-kind re-migration as the optimization lever (§9.A7) |
| R12 (MEDIUM) | **Multi-wave PR coordination overhead** — 5+ sequential Hub-source PRs in quick succession → merge-conflict / deploy pressure | Wave-per-PR cumulative-fold; branch-naming discipline; W5-prep gate blocks outstanding W1–W4 regressions before Hub-stop |
| R13 (MEDIUM) | **list_tele has no v2-envelope migration path today** — if tele becomes envelope-mediated later, contract must extend | Preventative: add QueryShape Phase-C infra to list_tele at W3 (§2.4) |

### §7.2 Open questions for engineer round-1 audit

Carried to §9 as the round-1 audit-asks (Survey F1–F8 + bundle gaps). See §9.A1–A8.

---

## §8 Mission-class declaration + ADR

**Mission-class:** **saga-substrate-completion** (per Survey §4) — completes the envelope-substrate maturity arc begun mission-88 (K8s-envelope) + continued mission-89 (OCC) by closing every remaining envelope-shape consumer-code seam network-wide and retiring three follow-on missions (318/320/324).
**Class-secondary characteristic:** structural-inflection — the renameMap-runtime-contract is a NEW runtime declarative primitive (field-name-resolution authority), not merely a defect-sweep. **F6 PROBE: engineer concur on class; it drives pulse-cadence template per mission-lifecycle.md §3** (§9.A5).

**ADR-TBD-renameMap-runtime-contract** (to be authored at W1 ship): captures the choice to promote `renameMap` from migration-only `MigrationSchemaRef` to a first-class runtime `SchemaDef` field consumed by the reconciler's existing watch-loop as a per-kind reverse-translation cache, with the substrate `list` chokepoint + policy push-down as the universal translation surface, and the legacy-shape branch retired post-shadow-validated re-migration. Rationale per Survey §3 composite intent envelope; alternative-rejected: read renameMap from migration modules at runtime (Q2b) / hardcode envelope convention (Q2c). Lifetime: substrate generation lifetime.

---

## §9 Engineer audit ask (round-1 questions for separate audit thread)

When this Design v0.1 is committed + pushed to `agent-lily/m-envelope-substrate-completion`, the architect opens a NEW thread for the round-1 audit (separate from any Phase 4 coord thread, per `multi-agent-pr-workflow.md`). Each ask carries the architect-recommendation **to challenge**; engineer round-1 classifications expected: CRITICAL / MEDIUM / MINOR / PROBE (mission-67/68 precedent). The 8 Survey architect-flags F1–F8 map directly to A1–A8 below.

**Audit ask shape (for new thread):**
> Phase 4 round-1 audit on Design v0.1 of M-Envelope-Substrate-Completion. Design at `docs/designs/m-envelope-substrate-completion-design.md`. Survey envelope context at `docs/surveys/m-substrate-list-filter-envelope-translation-survey.md`. Round-1 asks: classify each of {A1–A8} + recommend disposition. Two items are load-bearing-with-known-gaps: A4 (shadow-read harness — research bundle FAILED, mechanism unspecified) + A1 (Layer-B strategy — bundles DISAGREE push-down vs matchField-in-place). Flag architect-blind spots in §2–§5.

- **A1 [F1 CRITICAL] — Two-layer fix is NOT one fix; bundles disagree on the Layer-B strategy.** Substrate-delegating tools (list_bugs/list_turns) auto-fix at the §2.3 chokepoint, but the policy in-memory tools (list_ideas/list_threads/list_proposals/list_tele) never reach substrate.list. *Architect-recommendation to challenge:* PUSH filters down to substrate.list for all Layer-B tools (hybrid pattern; irreducible filters in-memory). The `renamemap-contract` bundle prescribes the alternative (matchField-in-place envelope-aware translation). **Code-verify each of the 8 tools' filter path; classify Layer A vs B; recommend per-tool push-down OR matchField-in-place; identify which fields are irreducibly client-side (array-contains, virtual-computed createdBy.id) vs pushable.**
- **A2 [F2 CRITICAL] — renameMap→runtime reconciler interaction.** *Recommendation to challenge:* the cache builds as a pure additive side-effect of `applySchemaIndexes` with zero index-churn. **Confirm `buildFieldTranslationMap` triggers no re-entrant watch event / no index re-emission / no reconcile-storm; verify via 3× restart-cycle integration test at boot with N=22 kinds; measure boot time.**
- **A3 [F3 MEDIUM] — Field-collision enumeration completeness + line-ref precision.** *Recommendation to challenge:* the §2.6 table (21 entries / 22 kinds) is complete. **Regrep all 22 `migrations/v2-envelope/kinds/*.ts` modules; reconcile against the final `all-schemas.ts` SchemaDef entries (no missing / no extra); confirm coverage of collision (Message.kind→metadata.messageKind, SchemaDef.kind→metadata.name) + opaque (body→status.cursor) + K8s-name + timestamp patterns. Also confirm `RenameMap` type location — bundle cited `_contract.ts:29`, assembly found `:39`.**
- **A4 [F5 MEDIUM→load-bearing; RESEARCH BUNDLE FAILED] — Shadow-read parity harness mechanism + rollback rehearsal.** The `remigration-shadow` bundle returned no structured output; §3.2/§3.3 are intent-level only. *Recommendation to challenge:* run both filter-paths against a `pg_dump`-restored snapshot, diff per kind, require 100% parity before strict-flip. **Design the harness mechanism: how is the old-path preserved transiently for comparison (feature-flag both branches? snapshot-clone?); what constitutes 100% parity (count + content-hash + every renameMap translation exercised?); how is rollback rehearsed on actual pre-cutover state? This is the highest-priority round-1 deliverable.**
- **A5 [F6 PROBE] — Mission-class.** *Recommendation to challenge:* saga-substrate-completion (closes the envelope arc) with structural-inflection character (new runtime primitive). **Concur or surface alternative; drives pulse-cadence template.**
- **A6 — `getFieldTranslation` API-surface consistency.** *Recommendation to challenge:* both substrate (§2.3) and policy (§2.5) call the identical public method. **Verify no signature drift / consistent null-coalesce (`?? bareKey`) at both consumers; confirm sort-key + projection translation are wired, not just filter-keys.**
- **A7 [F4 CRITICAL] — Wire-flow integration test matrix + downtime-budget reconciliation.** *Recommendation to challenge:* each wave gate exercises REAL envelope payloads through REAL substrate.list/watch (not synthetic), and the W5 downtime target is <60s / <5min ceiling. **Design the integration matrix for 3+ kinds with BOTH renamed + non-renamed keys (Message [collision], Idea [missionId non-FSM], PendingAction [state→phase]); verify postgres-side SQL uses correct JSONB paths; reconcile the bundle downtime disagreement (<60s vs <5min) and confirm achievability on representative Hub-scale.**
- **A8 [F7 PROBE + F8 MEDIUM] — Wave-spine + fold-boundary revertibility.** *Recommendation to challenge:* the 5-wave spine (contract→substrate→policy→repo→re-migration) is right, and each absorbed idea (318→W1-W2, 320→W2-W3, 324→W4) is independently shippable/revertible at its gate. **Propose an alternative decomposition only if dependency-reordering evidence surfaces; confirm W1–W4 test suite proves W1–W3 correctness WITHOUT W4 present (no wave requires a later wave to be correct).**

---

## §10 Cross-references

- **Survey envelope:** `docs/surveys/m-substrate-list-filter-envelope-translation-survey.md` (Director-ratified 2026-05-29)
- **Source idea:** idea-323 (M-Substrate-List-Filter-Envelope-Translation)
- **Absorbed ideas (Q5a fold):** idea-318 (SchemaDef-Reconciler-Status-Write-Patch) · idea-320 (substrate read-normalization) · idea-324 (M-Repository-Envelope-Native)
- **Unblocked:** idea-325 (M-Ledger-Reconciliation-Idea+Bug — needs trustworthy list_ideas/list_bugs)
- **Deferred-to:** idea-121 (Hub-API v2.0; AG-1)
- **Bugs:** bug-138 (substrate.list filter envelope-blind — systemically closed) · bug-143 (Task FSM read-side envelope-blind; PR #309 — this mission generalizes the targeted `phaseFromEntity` patch)
- **Predecessor saga arc:** mission-88 (K8s-envelope) · mission-89 (OCC)
- **Lineage:** `docs/audits/m-substrate-occ-primitive-closing-audit.md` §4 (idea-323/324 origin)
- **House-style precedent:** `docs/designs/m-hub-storage-substrate-design.md` (Design v1.4)
- **Code surfaces:** `hub/src/storage-substrate/types.ts:14` (SchemaDef) · `schema-reconciler.ts` (runtime watch-loop) · `postgres-substrate.ts:436,482` (translateFilterClause/jsonbField) · `hub/src/policy/list-filters.ts:217` (matchField) · `migrations/v2-envelope/kinds/*.ts` (22 modules; `_contract.ts:39` RenameMap) · `hub/scripts/entity-kinds.json` v1.1 (22-kind LOCKED inventory)
- **Methodology:** `docs/methodology/mission-lifecycle.md`; `docs/methodology/multi-agent-pr-workflow.md`; `docs/methodology/entity-mechanics.md`; `docs/methodology/idea-survey.md` v1.0
- **Tele references:** `docs/methodology/tele-glossary.md` (pin exact tele-N IDs before finalize-gate — Survey tele-alignment bundle returned null placeholders)
- **Calibrations:** `docs/calibrations.yaml` — #62 (substrate-extension-needs-end-to-end-wire-flow-integration-test; drives A7/F4); #59 (Survey-branch-push pre-bilateral)

---

— Architect: lily / 2026-05-29 (Phase 4 Design v0.1; engineer round-1 audit PENDING — NOT ratified; assembled from a 5-bundle research fan-out with the `remigration-shadow` bundle failed and surfaced as audit-ask A4; branch `agent-lily/m-envelope-substrate-completion`)
