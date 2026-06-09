# M-Envelope-Substrate-Completion — Design v1.0

**Status:** v1.0 — engineer round-1 audit integrated (thread-657 converged); Director scope-in override for idea-318 (2026-06-10); ready for Phase 5 Manifest.
**Source idea:** idea-323 (M-Substrate-List-Filter-Envelope-Translation)
**Mission name:** M-Envelope-Substrate-Completion (rename candidate per Survey §4 — reflects the 318+320+324 fold; supersedes filed name M-Substrate-List-Filter-Envelope-Translation)
**Survey envelope:** `docs/surveys/m-substrate-list-filter-envelope-translation-survey.md` (Director-ratified 6 picks across 2 rounds, 2026-05-29)
**Branch:** `agent-lily/m-envelope-substrate-completion`
**Mission-class:** saga-substrate-completion PRIMARY (structural-inflection WEIGHT noted in the §8 ADR for retro-mode + portfolio-scoring; A5 RESOLVED at thread-657)
**Sizing:** L multi-wave (8 waves: W1–W5 implementation + W6 re-migration/cutover + W7 post-cutover validation + W8 cleanup/ship)
**Author:** lily / 2026-05-29 (v0.1) · revised 2026-06-10 (v1.0, thread-657 integration + Director override)

---

## §1 Goal + intent (echo Survey envelope §3)

idea-323 is ratified not as the medium substrate-introduction it was filed as, but as the **completion of the envelope-substrate maturity saga** — a single, internally-gated, multi-wave mission that closes every remaining envelope-shape consumer-code seam network-wide. The six Director picks resolve to one coherent shape: *deliver a new runtime declarative primitive (`renameMap` promoted to a first-class `SchemaDef` field, consumed by the reconciler's existing watch-loop), make it the universal field-name-resolution authority across the full substrate read/write surface, sweep every consumer to it, then reversibly re-migrate residual legacy-shape rows and drop the dual-shape accommodation (the `SUBSTRATE_ENVELOPE_TOLERANT` tolerant reader-parse) — all held in one mission identity, de-risked by per-wave release-gates and a shadow-validated re-migration rather than by scope-reduction.*

**Primary outcome (load-bearing for ship):** the substrate filter-translation silent-failure class (bug-138) is structurally eliminated network-wide — all **9** tools in the class (`list_bugs`, `list_turns`, `list_ideas`, `list_threads`, `list_tasks`, `list_proposals`, `list_tele` + the already-mitigated `list_missions` / `get_pending_actions`; the v0.1 "`list_tasks` safe / 8 tools" claim is CORRECTED — `list_tasks` IS the 9th broken tool, §2.4) + the sweeper / repo / task-internal-read / watch-path surfaces become envelope-correct by consuming one declarative runtime contract, and the legacy accommodation (the `SUBSTRATE_ENVELOPE_TOLERANT` reader-parse) is retired (no perpetual dual-shape debt).

**Secondary outcomes:**
1. A reusable runtime field-translation primitive that serves all future schema-evolution renames, not just the envelope migration.
2. Absorption of idea-318 (reconciler status-write loop → W5, Director scope-in override 2026-06-10), idea-320 (substrate read-normalization → W8 tolerant-parse retirement), idea-324 (repository-envelope-native → W4) — retiring three follow-on missions per Survey Round-2 Q5(a); each absorbed idea has a wave-home (§2.8).
3. The Survey + ledger-reconciliation flows regain trustworthy list-tool results (substrate-self-dogfood); unblocks idea-325 (M-Ledger-Reconciliation-Idea+Bug).

**The six picks (echoed from Survey §1/§2):** Q1(a) maximal scope-fold · Q2(a) promote renameMap to runtime · Q3(a) re-migrate residual rows + envelope-only · Q4(a) one mission, gated waves · Q5(a) absorb 318+320+324 · Q6(a) reversible + shadow-validated re-migration.

**Key design constraints surfaced (carried from Survey §3 into this Design):**
- **Runtime-contract promotion is the load-bearing W1 primitive** — `renameMap` must move from migration-only (`MigrationSchemaRef.renameMap`) to the runtime `SchemaDef` interface + be built into a query-time translation table the reconciler maintains. Everything downstream consumes it; it gates all other waves.
- **Two independent root-cause layers** (substrate `jsonbField` + policy `FieldAccessor`) must BOTH be swept; fixing only the substrate chokepoint leaves the in-memory-filter tools (list_ideas/list_threads) broken (F1 CRITICAL).
- **Per-wave release-gates** are a hard requirement (Q4a) — each wave ships + proves before the next; the W6 re-migration gate cannot pass without shadow-read parity evidence (translated-path vs psql-oracle, §3.3) (Q6a).
- **Field-collision renames** (e.g. `Message.kind → metadata.messageKind`) must be covered by the generic contract, not just `status → status.phase` (Q2a generality; F3).

Tele alignment (whole-mission primary): **structural-elimination + substrate-fidelity** *(placeholder short-names; pin exact tele-N IDs against `docs/methodology/tele-glossary.md` at Phase 5 Manifest — genuinely-open item per §9; Survey tele-alignment bundle returned null)*. Secondary: **anti-silent-failure + operator-DX/trust + substrate-self-dogfood** *(placeholder)*.

---

## §2 Architecture

### §2.1 renameMap promotion to a first-class runtime `SchemaDef` field (the W1 primitive)

The runtime `SchemaDef` interface at `hub/src/storage-substrate/types.ts:14` currently carries `kind` / `version` / `fields[]` / `indexes[]` / `watchable` (Design v1.3 §2.3) plus `indexOwnershipPattern?` (mission-88 W7 bug-123 fix at :35). **It does NOT carry `renameMap`** (code-verified at Survey prep + re-verified at Design assembly). The per-kind field-translation table exists ONLY inside the one-time v2-envelope MIGRATION modules' `MigrationSchemaRef.renameMap` (`hub/src/storage-substrate/migrations/v2-envelope/kinds/<Kind>.ts`; `RenameMap` TYPE declared at `_contract.ts:29`, the `readonly renameMap?` FIELD at `:39` — the v0.1 draft had these inverted; corrected per thread-657 N4 / §9.A3). The reconciler never reads it. So the idea's literal premise ("substrate.list reads SchemaDef renameMap") requires **promoting a migration-only artifact to a runtime contract**.

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
 *  migration-only MigrationSchemaRef.renameMap (type _contract.ts:29; field :39). */
export type RenameMap = Record<string, string>;
```

**Rationale.** Promotion centralizes field-translation authority and eliminates the dual-source problem: migration modules define the renames (encode-only) while the runtime is decode/filter-blind. The `SchemaReconciler` already watches `SchemaDef` changes via the substrate watch primitive — adding `renameMap` as a field requires **no new infrastructure**, only a pure additive field-population step. *(Architect-flag F2 CRITICAL: this must NOT trigger index-churn — RESOLVED by construction, see §2.2 + §9.A2.)*

### §2.2 SchemaReconciler integration — build + cache a per-kind reverse-translation table

The `SchemaReconciler` (`hub/src/storage-substrate/schema-reconciler.ts`; boot/wiring at `hub/src/index.ts:159-169` — `storage-substrate/index.ts` is a barrel, not the wiring point) has an existing runtime watch-loop (`runtimeLoop`) that subscribes to `watch('SchemaDef')` and re-reconciles indexes on SchemaDef puts. Promotion adds a **private reverse-map cache** populated in `start()`'s per-def boot loop alongside (NOT inside) `applySchemaIndexes` — NOT a new watch, NOT a new reconcile trigger:

```typescript
export class SchemaReconciler {
  // Per-kind: Map<bare-filter-key, envelope-JSONB-path>
  private readonly fieldTranslationMap = new Map<string, Map<string, string>>();

  /** Built in start()'s per-def boot loop (+ on runtime SchemaDef put).
   *  Positioned OUTSIDE applySchemaIndexes so a malformed-renameMap throw
   *  PROPAGATES to the boot failure collector (see failure-coupling below). */
  private buildFieldTranslationMap(def: SchemaDef): void { /* invert def.renameMap into the cache */ }

  /** Public accessor consumed by the SUBSTRATE layer ONLY (§2.3: filter +
   *  sort keys). The policy layer does NOT consume it — IPolicyContext /
   *  AllStores carry no reconciler handle (policy/types.ts:27-76, CRUD-only);
   *  Layer B fixes FieldAccessor BODIES instead (§2.4/§2.5). */
  public getFieldTranslation(kind: string, bareKey: string): string | undefined {
    return this.fieldTranslationMap.get(kind)?.get(bareKey);
  }
}
```

**Zero-index-churn is CODE-PROVEN, not test-asserted (A2 RESOLVED).** `applySchemaIndexes` (`schema-reconciler.ts:151-190`) reads ONLY `def.kind` / `def.indexes` / `def.indexOwnershipPattern` — never `renameMap` (nor `fields`) — so the new field is invisible to DDL-generation **by construction**. Boot-time SchemaDef-put NOTIFYs are dropped: the `runtimeLoop` LISTEN (`:137`) starts AFTER the boot reconcile loop, and the watch subscription (`:261`) passes no `sinceRevision` — no reconcile-storm pathway exists. The backstop is postgres itself: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` is a no-op for existing indexes. The §8 ADR states this ACTUAL mechanism (field-read-set + DDL no-op), NOT an application-level index-diff (none exists). The 3× restart-cycle test at the W1 gate is a **regression-guard**, not the proof.

**Cache lifecycle.** Built once per SchemaDef at boot, and once per future SchemaDef version-bump via the runtime watch-loop. **No TTL / no invalidation** — the cache is exact to the current SchemaDef inventory; Hub restart rebuilds all caches at boot.

**Failure-coupling (intentional; positioned for propagation).** `buildFieldTranslationMap` sits in `start()`'s per-def loop so a malformed-renameMap throw PROPAGATES to `start()`'s failure collector (`schema-reconciler.ts:113-117` → surfaced at `hub/src/index.ts:168`) — it must NOT sit inside the index-application path, where errors are swallowed (`:159-161`, `:183-187`). This preserves the reconciler's STRICT-ALL-OR-NOTHING boot semantic (mission-84 W2): if `start()` fails, the cache is unpopulated and the Hub does not start — no silent degradation; operator sees the same clear failure path as a missing index.

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

`translateFilterKeysToEnvelopePaths(kind, filter)` rewrites each bare key via `reconciler.getFieldTranslation(kind, key) ?? key` (no-op for keys without a rename, e.g. `threadId`). The **same translation is applied to `sort` field-names** (`jsonbField` at `postgres-substrate.ts:126` — the only legitimate non-filter wiring). There is **NO projection (SELECT) field-name translation** — the v0.1 reference is STRUCK (A6 RESOLVED): `ListOptions` (`types.ts:58-65`) carries filter/sort/limit/offset only, and `substrate.list` hardcodes `SELECT data, resource_version` (`postgres-substrate.ts:140`); no projection surface exists to translate. This single chokepoint **automatically fixes the two Layer-A tools** with no per-tool code change (§2.4).

### §2.4 The two-layer consumer sweep — per-tool fix matrix (F1 CRITICAL; A1 RESOLVED at thread-657)

The bug-138 silent-failure class spans **9 tools across two independent filter-execution layers** (the v0.1 "8 tools / `list_tasks` safe" count is CORRECTED — `list_tasks` IS the 9th broken tool, below). Fixing the substrate chokepoint (§2.3) fixes ONLY Layer A; Layer B never reaches `substrate.list`.

**Layer A — substrate-delegating tools (automatic fix; no per-tool change):**

| Tool | Repository / list method | Filter path | Fix |
|---|---|---|---|
| `list_bugs` | `bug-repository-substrate.ts::listBugs` (:117–144) | `substrate.list(KIND, {filter})` (:131) | Automatic once §2.3 renameMap consumed at `translateFilterClause` |
| `list_turns` | `turn-repository-substrate.ts::listTurns` (:77–85) | `substrate.list(KIND, {filter})` (:80) | Automatic once §2.3 renameMap consumed at `translateFilterClause` |

**Layer B — policy in-memory-filter tools (per-tool fix matrix; A1 RESOLVED — replaces the v0.1 blanket push-down recommendation):** these LOAD ALL entities then filter in-process via `list-filters.ts::applyQueryFilter` (:205) + `matchField` (:217) + per-policy FieldAccessors. The substrate translate-point never applies. When the filter asks `status: "open"` and the accessor returns `{phase:"open"}` (envelope row), `{phase:"open"} === "open"` → false — silent miss.

| Tool | Surface (code-verified at thread-657) | Converged fix (W3) |
|---|---|---|
| `list_proposals` | `proposal-policy.ts::listProposals` (:257–280); inline `p.status === status` (:264) | **PUSH-DOWN** to `substrate.list` — scalar-status only; the repo already accepts a status arg |
| `list_tele` | `tele-policy.ts::listTele` (:49–64); inline include-flags guard (:54–57) | **`phaseFromEntity` replacement of the inline guard.** N3: its filter is `includeSuperseded`/`includeRetired` BOOLEANS, NOT status-eq — neither push-down nor accessor-translation applies; the guard itself must read the envelope phase. The v0.1/R13 "preventative" framing is STRUCK: `Tele.ts:30-32` HAS a renameMap — `list_tele` is broken NOW |
| `list_ideas` | `idea-policy.ts::listIdeas` (:107–149); `applyQueryFilter(ideas, …, IDEA_ACCESSORS)` (:125) | **Envelope-aware FieldAccessor BODIES** via the existing `phaseFromEntity`. ADDITIONALLY: the non-FSM renamed field `missionId→status.missionId` accessor ALSO needs envelope-awareness — fix EVERY renamed field a tool filters on, not just `status` (greg closing note) |
| `list_threads` | `thread-policy.ts::listThreads` (:808+); load-all then `matchField` | **Envelope-aware FieldAccessor BODIES** via `phaseFromEntity` |
| `list_tasks` | `task-policy.ts` (:345–364) runs `applyQueryFilter`; `TASK_ACCESSORS.status = (t) => t.status` (:332) is envelope-blind | **Envelope-aware FieldAccessor BODIES.** `list_tasks` IS the **9th broken tool** — the v0.1 "returns all; caller filters — safe" claim is CORRECTED |

**Why accessor BODIES — the two rejected Layer-B shapes (thread-657 converged):**
- **NOT reconciler-injection:** the policy layer has no reconciler handle — `IPolicyContext`/`AllStores` (`policy/types.ts:27-76`) are CRUD-only; threading the reconciler through would widen the policy contract for no gain.
- **NOT bare-key translation:** `matchField` looks up FieldAccessors **by bare key** (`list-filters.ts:222`), so translating the key first (`status`→`status.phase`) produces a MISSING-ACCESSOR no-match — key-translation breaks the very lookup it feeds. The fix is the accessor BODY (return `phaseFromEntity(e)` instead of `e.status`), keeping the bare-key lookup intact.

**Irreducibly client-side fields stay client-side (NO `FilterValue` extension):** `createdBy.id` virtual-computed (`idea-policy.ts:101`), `tags` array-contains, `labels` match-all — none are renamed fields, so no translation is needed; `FilterValue` (`types.ts:101-106`) stays scalar-eq/`$in`/`$gt`–`$lt` only.

**Already-mitigated:** `list_missions` (UNION-based, envelope-aware per mission-89 Phase 5 — no change); `get_pending_actions` (uses `phaseFromEntity()` per bug-143 defect-3 — confirm alignment at the W3 gate).

### §2.5 Policy-layer fix shape (Layer B) — envelope-aware FieldAccessor bodies

The Layer-B fix lives in the accessor BODIES, not in `matchField` key-handling (§2.4). Worked example (CORRECTED from the v0.1 key-translation framing): `list_ideas {filter:{status:"open"}}` → loaded entities are envelope-shaped `{status:{phase:"open"}}` → `matchField` looks up `IDEA_ACCESSORS["status"]` by bare key (`list-filters.ts:222`, UNCHANGED) → the accessor body returns `phaseFromEntity(idea)` = `"open"` → `"open" === "open"` → match. The same pattern applies per renamed field (e.g. the `missionId` accessor reads `status.missionId` envelope-aware). `getFieldTranslation` has exactly ONE consumer — the substrate translate-point (§2.3); no policy-layer signature exists to drift (A6 RESOLVED).

### §2.6 Complete renameMap inventory — 28 entries across 20 kinds-with-renameMap (F3; A3 RESOLVED)

Engineer-verified at thread-657 (the v0.1 "21 entries / 22 kinds" headline is CORRECTED): 22 migration kind modules under `migrations/v2-envelope/kinds/` (23 files minus `_contract.ts`); the RUNTIME inventory is **23 SchemaDef consts** in `hub/src/storage-substrate/schemas/all-schemas.ts` (adds MigrationCursor — the lone runtime kind with NO migration module, correctly rename-free). **28 renameMap entries total; 20 kinds carry a renameMap (Counter + Document carry none):**

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

**Pattern grouping (28 entries):** 11 FSM-phase (→`status.phase`) · 3 status-substate (`missionId`/`cursor`/`dedupe` → `status.*`) · 9 timestamp (→`metadata.createdAt` / `metadata.updatedAt`) · 3 K8s-name (→`metadata.name`; incl. the SchemaDef.kind collision, which attaches to the `SchemaDefMeta` const at `all-schemas.ts:352`) · Message.kind→`metadata.messageKind` (collision) · Notification.event→`spec.eventType`. **The per-entry table above is engineer-verified ground truth (thread-657, A3 RESOLVED).** Test discipline: **wave-gate tests pin the per-kind EXACT entry-set from this table — NEVER a global count** (a count-pinned test goes stale silently on the next rename).

### §2.7 Canonical source-of-truth post-promotion

After W1, `renameMap` lives in TWO places kept in sync by design-discipline:
1. **Runtime `SchemaDef` consts in `hub/src/storage-substrate/schemas/all-schemas.ts` (AUTHORITATIVE):** 23 runtime SchemaDef constants; **20 carry `renameMap`** (Counter / Document / MigrationCursor carry none — MigrationCursor is the lone runtime kind with no migration module, correctly rename-free). The SchemaDef kind's own `kind→metadata.name` rename attaches to the `SchemaDefMeta` const (`all-schemas.ts:352`). The reconciler builds its translation cache from these at boot — the single source-of-truth for the query-time contract.
2. **Migration modules `kinds/<Kind>.ts` (SECONDARY, reference):** each `MigrationSchemaRef` retains its `renameMap` for migration encapsulation + historical/rollback audit; an architect cross-reference comment points to the authoritative `all-schemas.ts` entry. No automated sync (one-time-per-migration event; complexity unjustified at v1) — flag for retrospective if a second migration wave occurs (see R1).

### §2.8 Absorbed-idea interaction (Q5a fold) — wave-homes: 318→W5 · 320→W8 · 324→W4

- **idea-318 (Reconciler Status-Write loop) → W5 — DIRECTOR SCOPE-IN OVERRIDE (2026-06-10; supersedes the thread-657-converged demote).** idea-318 is the reconciler status-WRITE loop: per reconcile cycle, write `status.phase` / `appliedVersion` / `reconcileError` to the SchemaDef entities themselves. `schema-reconciler.ts` currently has NO write/validate/put-status path — this is **NET-NEW work, NOT satisfied by W1+W2** (the v0.1 "mechanically satisfied at W1+W2 — no separate wave" claim is CORRECTED). It gets its OWN wave (W5) with its own release-gate, depending on W1 only. *Provenance:* thread-657 converged on demoting idea-318 out of scope; the Director exercised gate-authority to scope it IN (2026-06-10), preserving the Survey Q5(a) maximal-fold.
- **idea-320 (Substrate Read-Normalization) → W8.** The idea-320 surface IS the `SUBSTRATE_ENVELOPE_TOLERANT` tolerant reader-parse (`hub/src/index.ts:126` + `shape-helpers.ts:4-13` + `agent-envelope-shape.ts`); W8 deletes it after the W6 strict-flip. (Filter-side normalization lands en route at W2/W3, but the idea's retirement artifact is the W8 deletion.)
- **idea-324 (Repository-Envelope-Native) → W4.** Repo-wrapper internal-composition + sweeper/watch envelope-aware filters + task-internal-read normalization land entirely at W4 — including the watch-path `matchesFilter` fix in BOTH substrates (§4 W4).

**All three absorbed ideas now have wave-homes**, each independently shippable/revertible at its own gate (F8/R7).

---

## §3 Migration plan — reversible re-migration + shadow-validation (Q3a + Q6a; W6)

> **PROVENANCE.** The v0.1 `remigration-shadow` research bundle failed to return structured output, leaving this section at intent-level. The CONCRETE harness mechanism in §3.2/§3.3 was supplied by the engineer round-1 audit (thread-657, A4 disposition) — it comes from the audit, NOT from the failed bundle. A4 is RESOLVED (§9).

### §3.1 Posture (Q3a)

Production cutover to envelope-shape is COMPLETE (22 migrated kinds @100% envelope, 2026-05-25 strict-flip) — the residual legacy-shape set is expected ≈0. Q3a nonetheless actively re-migrates any residual rows through the migration pipeline and then flips the reader strict (envelope-only), retiring the `SUBSTRATE_ENVELOPE_TOLERANT` tolerant reader-parse (`hub/src/index.ts:126` + `shape-helpers.ts:4-13` + `agent-envelope-shape.ts` — the idea-320 surface; W6 flips, W8 deletes). There is NO legacy OR-branch in `translateFilterClause` to delete — it is a single envelope-blind path (code-verified at thread-657). **Consequence for the harness:** with prod at 100% envelope and residual ≈0, re-migration CONVERGENCE is not the risk — silent translation-miss is; the shadow harness therefore validates **renameMap-translation CORRECTNESS** (§3.3). This is "redesign over perpetual-accommodation" (methodology #25 / Director-progressive-question lineage), not trust-the-cutover-passively. The data-touch is confined to W6; W1–W4 are pure read-path code, and W5 writes reconcile-status to SchemaDef entities only (no migrated-entity data-touch).

### §3.2 Reversible re-migration (W6) — REUSES the existing CLI

The v0.1-planned NEW migrate script (`hub/scripts/migrate-envelope-re-migration.ts`) is **DROPPED**. W6 REUSES `hub/src/scripts/run-envelope-migration.ts` (`npm run envelope-migrate`) — already idempotent/resumable per-kind and the empirical downtime anchor (`:252`: 22,557 entities in <60s concurrent). **Pre-reuse reconciliation (BLOCKING):** the cutover script's KINDS array (`scripts/operator/m-k8s-envelope-cutover.sh:54-66`) lists 21 kinds — missing Notification — and must be reconciled against the CLI `registeredKinds()` before reuse.

W6 sequence:
1. **W6-prep gate (pre Hub-stop):** W1–W5 integration green at HEAD; measured re-migration time on a prod snapshot within budget; shadow-read harness PASSED offline (§3.3); rollback rehearsed on the clone; KINDS-array reconciliation done.
2. **Hub stop + pre-cutover snapshot** — `pg_dump -Fc` via `scripts/local/hub-snapshot.sh` as the during-cutover-abort safety net.
3. **Re-migration of residual legacy-shape rows** via `run-envelope-migration.ts` (expected ≈0 rows).
4. **Verification** — per-kind count parity + content-hash spot-check + zero legacy-shape rows.
5. **Envelope-only strict-flip** — flip the `SUBSTRATE_ENVELOPE_TOLERANT` reader strict (W8 deletes the tolerant parse; W6 flips the runtime mode).
6. **Restart + post-cutover smoke matrix** — sweeper end-to-end + all 9 tools (§2.4) end-to-end + full API surface per kind.

**Downtime budget (A7 RESOLVED):** a single **<60s TOTAL OBSERVED DOWNTIME** target — the v0.1 <5min hard ceiling is **DROPPED**. Empirical anchors: `run-envelope-migration.ts:252` measured 22,557 entities in <60s concurrent; the prior cutover ran 1.83s/10k rows; methodology per `m-hub-storage-substrate-design.md` §3.5. Phase 6 preflight measures actual wall-clock on a representative snapshot and confirms the target (genuinely-open item, §9). The shadow-read runs OFFLINE on the clone (§3.3) — entirely off the downtime critical path.

**Reversibility:** the pre-cutover `pg_dump` snapshot is the during-cutover-abort restore path (`pg_restore` via `hub-snapshot.sh` → restart). Post-cutover-success is fix-forward (consistent with the substrate-introduction precedent at mission-83 §3.2). Rollback is REHEARSED on the clone before cutover day: `pg_restore` via `hub-snapshot.sh` + `MigrationCursorRepository.resetCheckpoint` (`:89`) (§3.3 step 5).

### §3.3 Shadow-read parity harness (Q6a) — CONCRETE mechanism (A4 RESOLVED; engineer-audit-supplied)

**Purpose: renameMap-translation CORRECTNESS** — NOT re-migration convergence (prod is 100% envelope; residual ≈0; §3.1). **Runs OFFLINE on a throwaway clone — off the downtime critical path.**

Mechanism:
1. **Snapshot** prod via `scripts/local/hub-snapshot.sh`.
2. **Restore** into a throwaway testcontainers-postgres clone (`harness/fixtures.ts` pattern).
3. **Query-corpus:** one filter per renameMap entry (all 28, §2.6) + one non-renamed control key per kind.
4. **Parity = ALL THREE criteria, per kind:** (a) per-kind COUNT vs a direct-psql `data#>>'{status,phase}'` oracle; (b) ordered content-hash of result-sets; (c) an every-renameMap-entry-exercised coverage assertion.
5. **Rollback rehearsal on the same clone:** `pg_restore` via `hub-snapshot.sh` + `MigrationCursorRepository.resetCheckpoint` (`:89`).

**100% parity (all three criteria, every kind) is the W6 release-gate criterion** — the strict-flip does not proceed without it. Note: there is NO "old-path vs new-path" dual-code comparison (the v0.1 open question is dissolved) — the oracle is direct psql JSONB extraction against the clone, not a transiently-preserved legacy branch.

### §3.4 Dual-shape window discipline

During the pre-flip window (W2 through W6 step 4; dual-shape data is theoretically possible though residual ≈0 — §3.1) the `SUBSTRATE_ENVELOPE_TOLERANT` reader-parse remains the accommodation. Q3a re-migrates all legacy rows BEFORE the envelope-only flip, so the dual-shape window is closed by data-convergence, not by a permanent dual-lookup branch (which is AG-4/Q3c, explicitly rejected). W6 verification confirms zero legacy-shape rows before the flip; W8 deletes the tolerant parse (idea-320 surface, §2.8).

---

## §4 Wave decomposition (8-wave spine; Q4a + A8 RESOLVED + Director W5 scope-in)

**Critical principle (Q4a):** one mission identity, internally gated. Each wave ships independently and gates the next. W1 (renameMap-runtime-contract) is the load-bearing primitive that gates everything. No wave depends on a later wave for correctness (F8 fold-boundary revertibility): **the W1–W4 test suites must prove W1–W3 correctness WITHOUT W4 present.**

**Absorbed-idea → wave mapping (Q5a; each independently shippable/revertible — F8):** idea-318 → W5 (Director scope-in, §2.8) · idea-320 → W8 · idea-324 → W4.

**Test-substrate pin (N2; binds EVERY wave-gate):** all wave-gate translation tests are PINNED to testcontainers postgres — the memory backend is reconciler-less + envelope-blind, a false-green risk. We pin AND fix the memory `matchesFilter` in W4.

| Wave | Scope | Owned surfaces | Release-gate criteria | Depends-on |
|---|---|---|---|---|
| **W1** | renameMap runtime contract: promote `renameMap` to `SchemaDef` + reconciler translation table (§2.1/§2.2). Populate all 23 runtime SchemaDef consts in `schemas/all-schemas.ts` — 20 carry renameMap; Counter / Document / MigrationCursor none (corrects the v0.1 "all 22"). | `storage-substrate/types.ts` (SchemaDef + RenameMap); `schema-reconciler.ts` (cache + `getFieldTranslation`; `buildFieldTranslationMap` positioned for failure-propagation §2.2); `schemas/all-schemas.ts` (20 renameMap blocks; `SchemaDefMeta` :352 carries `kind→metadata.name`) | CI green; **zero-index-churn CODE-PROVEN per §2.2** (field-read-set argument; 3× restart-cycle retained as regression-guard only); malformed-renameMap throw propagates to `start()`'s failure collector; cache unit tests pinned **per-kind-EXACT to the §2.6 inventory (never to a count)** — incl. collision (Message.kind→metadata.messageKind) + opaque (body→status.cursor) + no-op for unmapped keys | — (gates all) |
| **W2** | Substrate translate-point: `translateFilterClause`/`jsonbField` consume `getFieldTranslation`; + sort-key translation (`jsonbField` :126); **NO projection translation** (§2.3). Fixes Layer-A (list_bugs, list_turns). | `postgres-substrate.ts` (filter + sort pre-translation) | CI green; **NET-NEW white-box wire-flow test (calibration #62):** real envelope payloads through real `substrate.list` for Message (kind-collision) + Idea (missionId non-FSM) + PendingAction (state→phase), asserting BOTH result-set AND generated SQL path (`data#>>'{...}'`) — existing `postgres-substrate.test.ts` covers only synthetic keys; the bug-138 scenario is genuinely uncovered today; testcontainers postgres; no regression on untranslated keys | W1 |
| **W3** | Policy-layer sweep per the §2.4 per-tool matrix: list_proposals PUSH-DOWN; list_tele `phaseFromEntity` replacement of the include-flags guard; list_ideas + list_threads + list_tasks envelope-aware FieldAccessor BODIES (incl. ideas' `missionId→status.missionId` accessor); `get_pending_actions` alignment confirm. | `proposal-policy.ts`; `tele-policy.ts`; `idea-policy.ts`; `thread-policy.ts`; `task-policy.ts` (`matchField` bare-key lookup UNCHANGED — §2.4) | CI green; per-tool tests (renamed + non-renamed + combined-filter; per-kind-exact); REAL MCP wire-flow for list_ideas / list_threads / list_tasks (F4); `get_pending_actions` alignment confirmed; pinned testcontainers postgres | W1, W2 |
| **W4** | Repo / sweeper / watch sweep (idea-324 surface). MUST include the watch-path `matchesFilter` fix in **BOTH substrates**: `postgres-substrate.ts:496` (called :224, :304) + `memory-substrate.ts:496-542` — N1 load-bearing: sweepers consuming `substrate.watch` hit the SAME bug-138 silent-miss. Repositories internally compose substrate; task-internal entity-reads normalize envelope-shape. Handler surface UNCHANGED. | `hub/src/entities/*-repository*.ts`; `hub/src/sweepers/`; `postgres-substrate.ts:496`; `memory-substrate.ts:496-542` | CI green; sweeper `substrate.watch` e2e with renamed-key filters (BOTH substrates); repository CAS via substrate API; existing I*Store integration green; **W1–W4 suite proves W1–W3 correctness WITHOUT W4 present** (F8/R7) | W1–W3 |
| **W5** | idea-318 reconciler status-WRITE loop (**Director scope-in 2026-06-10**, §2.8): per reconcile cycle, write `status.phase` / `appliedVersion` / `reconcileError` to SchemaDef entities. NET-NEW — `schema-reconciler.ts` has NO write/validate/put-status path today; NOT satisfied by W1+W2. | `schema-reconciler.ts` (status-write path) | **OWN release-gate:** reconcile cycle observably writes `status.phase`/`appliedVersion` on success + `reconcileError` on the failure path; CI green; independently revertible without disturbing W2–W4 | W1 only |
| **W6** | Reversible re-migration + shadow-validation + envelope-only strict-flip (§3). **REUSES `hub/src/scripts/run-envelope-migration.ts` (`npm run envelope-migrate`)** — the v0.1-planned NEW migrate script is DROPPED. Pre-reuse: reconcile the cutover script's KINDS array (`scripts/operator/m-k8s-envelope-cutover.sh:54-66` — lists 21, missing Notification) against the CLI `registeredKinds()`. ONLY data-touching wave. | `run-envelope-migration.ts` (reuse); shadow harness (§3.3); `docs/operator/envelope-substrate-cutover-runbook.md`; `SUBSTRATE_ENVELOPE_TOLERANT` strict-flip | W6-prep gate (§3.2); **shadow-read 100% parity (psql-oracle count + content-hash + every-renameMap-entry coverage) BEFORE flip**; **<60s TOTAL OBSERVED DOWNTIME** (§3.2); verification PASS (count parity + content-hash + zero legacy rows); rollback rehearsed on the clone | W1–W5 |
| **W7** | Post-cutover validation + operator-DX finalize. Smoke on LIVE substrate; ledger-reconciliation list-tool parity (Survey/ledger flows regain trustworthy results); finalize runbook + psql cookbook. | `docs/operator/envelope-substrate-cutover-runbook.md`; ledger-reconciliation e2e; bug-138/bug-143 closure notes | CI green; ledger-reconciliation list-tool parity; **all 9 tools (§2.4) envelope-correct on the LIVE substrate**; runbook tested against actual post-cutover state | W6 |
| **W8** | Cleanup + ship. Legacy-accommodation deletion **RETARGETED to the `SUBSTRATE_ENVELOPE_TOLERANT` reader-parse** (`hub/src/index.ts:126` + `shape-helpers.ts:4-13` + `agent-envelope-shape.ts`) — this IS the idea-320 surface; there is **NO legacy OR-branch in `translateFilterClause` to delete** (single envelope-blind path, code-verified). Close bug-138 + bug-143; update CLAUDE.md substrate notes; mark idea-318/320/324 incorporated; Phase 7 release-gate. | `hub/src/index.ts`; `shape-helpers.ts`; `agent-envelope-shape.ts`; CLAUDE.md; idea status updates | All W1–W7 gates final; Phase 7 Director-approval; 3 absorbed ideas linked + incorporated (318→W5, 320→W8, 324→W4); Phase 10 retrospective (Walkthrough, §8) verifies substrate-self-dogfood restored | W1–W7 |

**A8 disposition (8-wave spine RATIFIED; supersedes the v0.1 5+2 straw-man):** thread-657 added the W4 watch-path scope (N1) and split validation/cleanup into W7/W8; the Director's scope-in override inserted the dedicated W5 (idea-318). W5 depends on W1 only — it can land in parallel with W2–W4 without reordering the gate-chain. Fold-boundary revertibility holds at every absorbed-idea gate (318→W5, 320→W8, 324→W4).

**Per-wave Hub-source PR cadence:** each wave is a `hub/src/` PR REQUIRING build-hub.sh + start-hub.sh + the Adapter-Restart-Protocol-includes-Hub-container discipline. Branch `agent-lily/m-envelope-substrate-completion-wN` (architect) ↔ `agent-greg/...` (engineer), cross-approval per `multi-agent-pr-workflow.md`; wave-per-PR cumulative-fold (mission-68 M6 pattern). Watchtower auto-deploy (bug-140) picks up each merged Hub image within ~5min — post-merge production dispositive available per wave.

---

## §5 Substrate location + package shape

This mission is **substrate-INTERNAL** (read/write-path + reconciler + policy-filter); it adds NO new module and NO new package — it extends existing surfaces.

```
hub/src/storage-substrate/
├── types.ts                 # W1: SchemaDef + RenameMap (renameMap field promotion)
├── schema-reconciler.ts     # W1: fieldTranslationMap cache + getFieldTranslation() · W5: idea-318 status-write loop
├── schemas/all-schemas.ts   # W1 AUTHORITATIVE: 23 runtime SchemaDef consts; 20 carry renameMap (Counter/Document/MigrationCursor none); SchemaDefMeta :352 carries kind→metadata.name
├── postgres-substrate.ts    # W2: filter + sort-key translation (NO projection — §2.3) · W4: watch-path matchesFilter fix (:496; called :224,:304)
├── memory-substrate.ts      # W4: matchesFilter fix (:496-542) — closes the N2 false-green risk
└── migrations/v2-envelope/kinds/<Kind>.ts   # SECONDARY renameMap (reference/rollback; cross-ref comment to schemas/all-schemas.ts)

hub/src/policy/
├── list-filters.ts          # UNCHANGED at matchField (bare-key accessor lookup stays — §2.4)
├── idea-policy.ts / thread-policy.ts / task-policy.ts   # W3: envelope-aware FieldAccessor BODIES (phaseFromEntity; incl. ideas' missionId accessor)
├── proposal-policy.ts       # W3: push-down (scalar-status)
└── tele-policy.ts           # W3: phaseFromEntity replacement of the include-flags guard

hub/src/entities/            # W4: repository internal-composition (idea-324)
hub/src/sweepers/            # W4: substrate.watch + envelope-aware filter (idea-324)
hub/src/scripts/run-envelope-migration.ts   # W6: REUSED (npm run envelope-migrate) — the v0.1-planned NEW migrate script is DROPPED
hub/src/index.ts:126 + shape-helpers.ts:4-13 + agent-envelope-shape.ts   # W8: SUBSTRATE_ENVELOPE_TOLERANT tolerant-parse deletion (idea-320 surface)
docs/operator/envelope-substrate-cutover-runbook.md   # W6/W7 (NEW)
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
| AG-4 | Re-opening mission-89 OCC primitive / advisory-lock / counter work — settled; AND a permanent dual-lookup defense-in-depth branch (Q3c rejected — Q3a retires the legacy accommodation, i.e. the tolerant reader-parse, at W8) | n/a (mission-89 closed) |
| AG-5 | Adding new entity KINDS — operates on the existing 22-kind locked inventory only | `hub/scripts/entity-kinds.json` v1.1 |
| AG-6 | Methodology-doc rewrites beyond any §15 spec-enrichment carve-out (e.g. the Task-FSM 3-vocabulary alignment) | idea-326 (M-Task-FSM-Vocabulary-Alignment) |

**Phase 10 retrospective responsibility (architect TODO):** mark idea-318 / idea-320 / idea-324 `incorporated` against this mission at Manifest-bind; link missionId; file any genuinely-new follow-on surfaced during waves.

---

## §7 Risks + open questions

### §7.1 Risks (integrated with per-wave mitigation gates)

| ID | Risk | Mitigation |
|---|---|---|
| R1 | **Dual-source maintenance burden** — post-promotion, both `all-schemas.ts` AND migration modules carry renameMap; future renames must be hand-synced | Architect cross-ref comment naming `all-schemas.ts` as authoritative; no automated sync at v1 (one-time-per-migration event); flag for retrospective if a 2nd migration wave occurs |
| R2 (CRITICAL, F2) | **renameMap→SchemaDef promotion triggers reconcile-storm / index-churn** | RESOLVED-BY-CONSTRUCTION (A2, §2.2): `applySchemaIndexes` (:151-190) reads only `def.kind`/`def.indexes`/`def.indexOwnershipPattern` — renameMap invisible to DDL-gen; boot NOTIFYs dropped (LISTEN :137 after boot loop; watch :261 no sinceRevision); `CREATE INDEX CONCURRENTLY IF NOT EXISTS` no-op backstop; 3× restart-cycle test retained as regression-guard, not proof |
| R3 (CRITICAL, F1) | **Incomplete two-layer sweep leaves tools broken** — substrate fix (W2) does NOT auto-fix Layer-B (W3) | Per-wave gates mandate both layers; per-tool filter paths code-verified at thread-657 (§2.4 fix matrix); W6 smoke + W7 live matrix exercise all 9 tools |
| R4 (MEDIUM, F3) | **Field-collision renames missed** — generic contract (Q2a) falsified if only status→status.phase covered | Inventory engineer-verified: ALL 28 entries across 20 kinds-with-renameMap (§2.6); tests pinned per-kind-EXACT (never to a count), covering collision + opaque + timestamp + K8s-name patterns |
| R5 (MAJOR, F5) | **Shadow-read parity harness design gap** — the failed `remigration-shadow` bundle left the mechanism unspecified at v0.1 | CLOSED (A4 RESOLVED): concrete mechanism engineer-audit-supplied (§3.3) — snapshot → testcontainers clone → query-corpus → psql-oracle parity; runs OFFLINE, off the downtime critical path |
| R6 (CRITICAL, Q3a+Q6a) | **Re-migration data-touch corrupts state** | Reversible (`pg_dump` snapshot) + shadow-read 100% parity BEFORE strict-flip; verification: count parity + content-hash + zero legacy rows |
| R7 (MAJOR, F8) | **Absorbed ideas not independently revertible** — fold-boundary independence lost if one absorbed idea's correctness depends on another's wave | Each absorbed idea has its OWN wave + gate: 318→W5 (depends on W1 only), 320→W8, 324→W4; W1–W4 suite proves W1–W3 correctness WITHOUT W4 present |
| R8 (MEDIUM) | **Cache staleness on SchemaDef hot-updates** | Cache rebuilt on every SchemaDef put via runtime watch-loop; boot-time full rebuild guarantees restart-safety; immutable per kind at a given version |
| R9 (MEDIUM) | **Translation transparency gap** — code paths querying by bare-key NOT via substrate.list or accessor-mediated filters miss translation | Sweep covers ALL 9 tools (§2.4) + the watch-path matchesFilter in BOTH substrates (W4) + any repo-direct lookups; coverage verified at thread-657 |
| R10 (MEDIUM) | **Silent translation miss for misspelled keys** — unmapped key passes through unchanged; a typo matches a non-existent field silently | Schema validation + per-kind tests exercise 3+ keys (renamed + non-renamed + intentional-miss) |
| R11 (MEDIUM) | **Downtime budget overrun** — re-migration + verification + restart may exceed the target | Single **<60s TOTAL OBSERVED DOWNTIME** target — the <5min ceiling is DROPPED (A7 RESOLVED); empirical anchors: `run-envelope-migration.ts:252` (22,557 entities <60s concurrent) + prior cutover 1.83s/10k (m-hub-storage-substrate-design.md §3.5); shadow harness runs OFFLINE (off the critical path); Phase 6 preflight measures actual (open item, §9) |
| R12 (MEDIUM) | **Multi-wave PR coordination overhead** — 8 sequential Hub-source PRs in quick succession → merge-conflict / deploy pressure | Wave-per-PR cumulative-fold; branch-naming discipline; W6-prep gate blocks outstanding W1–W5 regressions before Hub-stop; W5 parallelizable (depends on W1 only) |
| R13 (CORRECTED at thread-657) | **v0.1 "preventative" framing STRUCK — list_tele is broken NOW, not prospectively at-risk:** `Tele.ts:30-32` HAS a renameMap; the inline include-flags guard (`tele-policy.ts:54-57`) filters `includeSuperseded`/`includeRetired` booleans envelope-blind (N3) | W3 fix: `phaseFromEntity` replacement of the inline guard (§2.4); no QueryShape Phase-C infra needed |

### §7.2 Round-1 audit status

The round-1 audit COMPLETED in thread-657 (converged 2026-06-10); **A1–A8 are RESOLVED** with dispositions recorded in §9 and integrated throughout §2–§6. Genuinely-open items (carried forward; none blocking Phase 5 entry): (1) tele-N pinning against `docs/methodology/tele-glossary.md` at Manifest; (2) mission-rename ratification at Manifest-bind; (3) W6 downtime preflight measurement at Phase 6. See §9.

---

## §8 Mission-class declaration + ADR

**Mission-class:** **saga-substrate-completion PRIMARY** (A5 RESOLVED at thread-657; per Survey §4) — arc-narrative: completes mission-88 (K8s-envelope) → mission-89 (OCC) → this, closing every remaining envelope-shape consumer-code seam network-wide and retiring three follow-on missions (318/320/324).
**Structural-inflection WEIGHT (ADR-noted; NOT class-primary):** the renameMap-runtime-contract is a NEW runtime declarative primitive, and the mission profile — new primitive + 9-tool/2-layer sweep + data-touch + multi-idea retirement — approximates the 5+ ops/3+ retire structural-inflection profile. This WEIGHT drives the Phase-10 retro-mode (**Walkthrough**) + portfolio-scoring. **No pulse-cadence consequence:** the class-drives-pulse-cadence binding was retired at mission-68 (`mission-lifecycle.md:241`); cadence is uniform per-role — the v0.1 claim is REMOVED.

**ADR-TBD-renameMap-runtime-contract** (to be authored at W1 ship): captures the choice to promote `renameMap` from migration-only `MigrationSchemaRef` to a first-class runtime `SchemaDef` field consumed by the reconciler as a per-kind reverse-translation cache, with the substrate `list` translate-point (filter + sort keys; no projection) as Layer A and envelope-aware FieldAccessor BODIES as Layer B, and the legacy accommodation (`SUBSTRATE_ENVELOPE_TOLERANT` tolerant reader-parse) retired post-shadow-validated re-migration. **The ADR states the ACTUAL zero-index-churn mechanism:** `applySchemaIndexes`' field-read-set (`def.kind`/`def.indexes`/`def.indexOwnershipPattern` — renameMap invisible to DDL-gen) + `CREATE INDEX CONCURRENTLY IF NOT EXISTS` postgres no-op — NOT an application-level diff (none exists; §2.2). The ADR also records the structural-inflection WEIGHT note (above) for Phase-10 retro-mode + portfolio-scoring. Rationale per Survey §3 composite intent envelope; alternatives-rejected: read renameMap from migration modules at runtime (Q2b) / hardcode envelope convention (Q2c). Lifetime: substrate generation lifetime.

---

## §9 Engineer round-1 audit — RESOLVED dispositions (thread-657 converged)

The round-1 audit ran on Design v0.1 in thread-657 and converged 2026-06-10; the Director additionally exercised gate-authority to scope idea-318 IN (D4 override, §2.8). The 8 Survey architect-flags F1–F8 mapped to A1–A8; all are **RESOLVED**, with dispositions integrated throughout §2–§8:

- **A1 RESOLVED — per-tool Layer-B cut-line replaces the blanket push-down (§2.4):** push-down ONLY for list_proposals (scalar-status); `phaseFromEntity` guard-replacement for list_tele; envelope-aware FieldAccessor BODIES for list_ideas/list_threads/list_tasks (+ ideas' `missionId` accessor); reconciler-injection AND bare-key translation both rejected; `list_tasks` recognized as the 9th broken tool.
- **A2 RESOLVED — zero-index-churn CODE-PROVEN (§2.2):** `applySchemaIndexes`' field-read-set never touches renameMap; boot NOTIFYs dropped; failure-coupling repositioned so malformed-renameMap throws reach `start()`'s collector (not the swallowing index path); 3× restart test demoted to regression-guard.
- **A3 RESOLVED — inventory corrected (§2.6):** 28 entries across 20 kinds-with-renameMap (Counter/Document none; MigrationCursor runtime-only, correctly rename-free); `RenameMap` TYPE at `_contract.ts:29`, FIELD at `:39` (v0.1 inverted); tests pinned per-kind-EXACT, never to a count.
- **A4 RESOLVED — concrete shadow harness, engineer-audit-supplied (§3.3):** purpose = translation correctness (not convergence); `hub-snapshot.sh` → testcontainers clone → per-renameMap-entry query-corpus → psql-oracle count + content-hash + coverage parity; rollback rehearsal via `pg_restore` + `resetCheckpoint` (`:89`); offline, off the downtime critical path.
- **A5 RESOLVED — saga-substrate-completion PRIMARY (§8):** structural-inflection retained as ADR-noted WEIGHT for retro-mode (Walkthrough) + portfolio-scoring only; the pulse-cadence claim removed (binding retired at mission-68; `mission-lifecycle.md:241`).
- **A6 RESOLVED — projection-translation STRUCK (§2.3):** `ListOptions` is filter/sort/limit/offset only (`types.ts:58-65`); `SELECT` hardcoded (`postgres-substrate.ts:140`); sort-key translation stays (`jsonbField` `:126`); `getFieldTranslation` has a single consumer (substrate); the policy layer fixes accessor bodies (§2.5).
- **A7 RESOLVED — downtime + wire-flow matrix (§3.2; §4 W2):** single <60s total-observed-downtime target, <5min ceiling dropped (anchor `run-envelope-migration.ts:252`); W2 gate = NET-NEW white-box wire-flow test (Message kind-collision + Idea missionId + PendingAction state→phase; result-set AND generated-SQL-path assertions); all wave-gate translation tests pinned to testcontainers postgres (memory backend false-green risk; memory `matchesFilter` fixed at W4).
- **A8 RESOLVED — 8-wave spine (§4):** W4 watch-path scope (N1) + dedicated W5 (Director scope-in) + W7/W8 validation/cleanup split; fold-boundaries 318→W5, 320→W8, 324→W4; W1–W4 suites prove W1–W3 correctness without W4.

**Genuinely-open items (the ONLY remaining open items; carried to Phase 5/6):**
1. **Tele-N pinning** against `docs/methodology/tele-glossary.md` — at Manifest (§1 placeholders).
2. **Mission-rename ratification** (M-Envelope-Substrate-Completion supersedes the filed name) — at Manifest-bind.
3. **W6 downtime preflight measurement** on a representative prod snapshot — at Phase 6 (§3.2).

---

## §10 Cross-references

- **Survey envelope:** `docs/surveys/m-substrate-list-filter-envelope-translation-survey.md` (Director-ratified 2026-05-29)
- **Round-1 audit:** thread-657 (converged 2026-06-10; A1–A8 dispositions at §9; Director idea-318 scope-in override 2026-06-10)
- **Source idea:** idea-323 (M-Substrate-List-Filter-Envelope-Translation)
- **Absorbed ideas (Q5a fold; wave-homes §2.8):** idea-318 (SchemaDef-Reconciler-Status-Write loop → W5, Director scope-in) · idea-320 (substrate read-normalization → W8 tolerant-parse retirement) · idea-324 (M-Repository-Envelope-Native → W4)
- **Unblocked:** idea-325 (M-Ledger-Reconciliation-Idea+Bug — needs trustworthy list_ideas/list_bugs)
- **Deferred-to:** idea-121 (Hub-API v2.0; AG-1)
- **Bugs:** bug-138 (substrate.list filter envelope-blind — systemically closed) · bug-143 (Task FSM read-side envelope-blind; PR #309 — this mission generalizes the targeted `phaseFromEntity` patch)
- **Predecessor saga arc:** mission-88 (K8s-envelope) · mission-89 (OCC)
- **Lineage:** `docs/audits/m-substrate-occ-primitive-closing-audit.md` §4 (idea-323/324 origin)
- **House-style precedent:** `docs/designs/m-hub-storage-substrate-design.md` (Design v1.4)
- **Code surfaces:** `hub/src/storage-substrate/types.ts:14` (SchemaDef) / `:58-65` (ListOptions) / `:101-106` (FilterValue) · `schema-reconciler.ts:113-117,137,151-190,261` (boot failure collector / runtimeLoop LISTEN / applySchemaIndexes / watch) · `postgres-substrate.ts:126,140,436,482,496` (sort jsonbField / hardcoded SELECT / translateFilterClause / jsonbField / watch-path matchesFilter, called :224,:304) · `memory-substrate.ts:496-542` (matchesFilter) · `hub/src/policy/list-filters.ts:217,222` (matchField; bare-key accessor lookup) · `policy/types.ts:27-76` (IPolicyContext/AllStores, CRUD-only) · `task-policy.ts:332,345-364` · `tele-policy.ts:54-57` · `idea-policy.ts:101,107-149` · `hub/src/index.ts:126` (SUBSTRATE_ENVELOPE_TOLERANT) / `:159-169` (reconciler boot/wiring; `storage-substrate/index.ts` is a barrel) + `shape-helpers.ts:4-13` + `agent-envelope-shape.ts` · `hub/src/storage-substrate/schemas/all-schemas.ts` (AUTHORITATIVE; 23 runtime consts, 20 renameMap, `SchemaDefMeta` :352) · `migrations/v2-envelope/kinds/*.ts` (22 modules; `_contract.ts:29` RenameMap type, `:39` field) · `hub/src/scripts/run-envelope-migration.ts:252` (re-migration CLI reuse; downtime anchor) · `scripts/operator/m-k8s-envelope-cutover.sh:54-66` (KINDS array — 21 listed, missing Notification) · `MigrationCursorRepository.resetCheckpoint` (`:89`) · `hub/scripts/entity-kinds.json` v1.1 (LOCKED inventory)
- **Methodology:** `docs/methodology/mission-lifecycle.md`; `docs/methodology/multi-agent-pr-workflow.md`; `docs/methodology/entity-mechanics.md`; `docs/methodology/idea-survey.md` v1.0
- **Tele references:** `docs/methodology/tele-glossary.md` (pin exact tele-N IDs at Phase 5 Manifest — genuinely-open item §9; Survey tele-alignment bundle returned null placeholders)
- **Calibrations:** `docs/calibrations.yaml` — #62 (substrate-extension-needs-end-to-end-wire-flow-integration-test; drives A7/F4); #59 (Survey-branch-push pre-bilateral)

---

— Architect: lily / 2026-06-10 (Phase 4 Design v1.0; engineer round-1 audit integrated — thread-657 converged, A1–A8 RESOLVED; Director scope-in override for idea-318; ready for Phase 5 Manifest; branch `agent-lily/m-envelope-substrate-completion`)
