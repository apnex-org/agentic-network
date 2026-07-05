# C1-R2 — WorkItem Work-Queue Substrate — Construction-Design (engineer-led)

**Mission:** mission-94 (`M-Work-Queue-Substrate`, structural-inflection) · **Rung:** C1-R2 (THE keystone)
**Author:** greg (engineer, construction-design lead) · **Date:** 2026-06-22
**Design-of-record:** PR #355 `docs/designs/c1-sovereign-work-control-plane-arc-design.md` (Phase-4 AGREED, thread-692)
**Status:** CONSTRUCTION-DESIGN — for mission-preflight→active. Architect owns the contract shape (operator/renameMap/verb-semantics/evidence-predicate); this doc is the engineer's build blueprint mapping each acceptance criterion to concrete substrate code, grounded against the live substrate.
**Contract:** MCP binding day-one (the idle-agents fix banks immediately); REST projection rides D-1 R3 (no extra C1 work — same registered tools on the second binding).

---

## 0. Acceptance-criteria traceability (the build IS these)

| Criterion (design-of-record) | Build items (this doc §) |
|---|---|
| 8 construction resolutions (thread-692) | §1–§5 throughout |
| **C1-R2-JSONB-CONTAINMENT** (full 6-surface `$contains`) | §2 (all 6 surfaces enumerated) |
| **C1-R2-WIP-LOCK-FLAVOR** (`pg_try_advisory_lock` wrapper, lock-class, count+CAS-inside, fail-closed timeout) | §3.2 |
| **C1-R2-EVIDENCE-GAMEABILITY** (req-id bind + relevance + producedAt≥claimedAt + no multi-satisfy) | §3.4 |
| born-under-the-live-C3-R4-governor | §1.4 + §5 |

---

## 1. The WorkItem kind (kind #26, reference-only, K8s envelope)

### 1.1 Domain (flat, above-membrane) shape
```
WorkItem {
  id: "work-N"; kind: "WorkItem";
  // spec (intent)
  type: "task"|"bug"|"review"|"verifier-gate"|"freeform";
  priority: "critical"|"high"|"normal"|"low";   // bounded ENUM (resolution #3 — eq/$in only, never numeric range; sidesteps bug-174)
  roleEligibility: string[];                      // e.g. ["engineer"], ["verifier"]
  dependsOn: string[];                            // readiness DAG (work-ids)
  evidenceRequirements: { id: string; kind: "commit"|"pr"|"audit"|"test-run"|"doc"|"freeform"; refResolvable?: boolean }[];
  targetRef?: { kind: string; id: string };       // reference-only; OR a freeform payload
  // status (lifecycle)
  status: "ready"|"claimed"|"in_progress"|"blocked"|"review"|"done"|"abandoned";
  lease: { holder: string; claimedAt: string; expiresAt: string; heartbeatAt: string } | null;
  evidence: { requirementId: string; kind: string; ref?: string; producedAt: string; note?: string }[];
  blockedOn?: string;                             // set by block_work
  leaseExpiryCount?: number;                      // per-ITEM poison counter (§3.5)
  // metadata: id, name, createdAt, createdBy, updatedAt
}
```

### 1.2 Envelope partition (below-membrane storage)
- `metadata`: id, name, createdAt, createdBy, updatedAt (DEFAULT_METADATA_KEYS — automatic)
- `spec`: type, priority, roleEligibility, dependsOn, evidenceRequirements, targetRef
- `status`: phase (← `status`), lease, evidence, blockedOn, leaseExpiryCount

### 1.3 renameMap (the single authority; lease nested-filter RESOLVED via the Message `target.*` precedent)
```
renameMap: {
  status:        "status.phase",
  lease:         "status.lease",          // cohesive object relocates whole (decode spreads it back; encode routes it)
  evidence:      "status.evidence",
  blockedOn:     "status.blockedOn",
  leaseExpiryCount: "status.leaseExpiryCount",
  priority:      "spec.priority",
  type:          "spec.type",
  roleEligibility:"spec.roleEligibility",
  dependsOn:     "spec.dependsOn",
  evidenceRequirements:"spec.evidenceRequirements",
  targetRef:     "spec.targetRef",
  // NO renameMap entry for the lease sub-fields. Per architect call (thread-694):
  // option (c) — the ~3 lease-filter call-sites query the BUCKET-PREFIXED dotted
  // envelope path directly (`status.lease.holder` / `status.lease.expiresAt`),
  // which the C3-R4 governor already sanctions as the renameMap-bypass.
}
```
**Early renameMap-mechanics Q RESOLVED (thread-694) → option (c).** `lease` relocates whole via the renameMap `lease:"status.lease"` (decode spreads it back, encode routes it); the two HOT sub-fields (holder, expiresAt) are filtered by querying the dotted envelope path DIRECTLY — no renameMap entry, no shadow. **Grounded against the R4a governor (I built it):** `isBucketPrefixed` (filterable-keys.ts ENVELOPE_BUCKET_PREFIXES = metadata./spec./status.) makes the drift-gate treat a `status.lease.*` derived filter key as ALREADY-translated/pre-translated, and `isReservedOrBucketKey` in filter-translation-error.ts means `translateKeyOrThrow` does NOT raise FilterTranslationGapError for it (bucket-prefixed → passes through to `data#>>'{status,lease,holder}'`). So (c) is governor-clean: no renameMap entry needed, the round-trip oracle does not expect one (it only exercises flat→translated keys; bucket-prefixed are verified-by-construction), the expression-index on the dotted path is independent of the renameMap. Architect's (c)-vs-(a) caveat resolves to (c) holds — no bad interaction. (Architect is filing the (a) filter-translate-only-renameMap-entry-class as a decoupled substrate-evolution idea — the clean-flat-alias payoff later; not R2.)

### 1.4 Indexes (btree + the GIN — §2 surface 6)
```
indexes: [
  { name: "workitem_status_phase_idx",       fields: ["status.phase"] },              // list_ready_work / sweeper
  { name: "workitem_status_lease_holder_idx", fields: ["status.lease.holder"] },       // WIP-count + quarantine
  { name: "workitem_status_lease_expiresat_idx", fields: ["status.lease.expiresAt"] }, // lease-expiry sweep (ISO-8601 range, lexicographic-safe)
  { name: "workitem_spec_roleeligibility_gin_idx", fields: ["spec.roleEligibility"], type: "gin" }, // $contains (NEW index-type, §2.6)
],
indexOwnershipPattern: "^workitem_",
```
SchemaDef + decode-to-flat decoder + repository-substrate + STRICT envelope + role-tagged RBAC + reconciler expression-index + FSM = the full per-kind substrate tax, born under the LIVE C3-R4 governor (call-site scanner + drift-gate + value-round-trip oracle) + the R4b fail-loud belts. `conformance/filterable-keys.ts` (SUBSTRATE_FILTERABLE_KEYS) gains the FLAT filterable keys only: `WorkItem: ["status", "priority", "type", "roleEligibility"]` (status→status.phase, the spec fields via renameMap). The lease sub-fields are NOT listed here — they are bucket-prefixed dotted-path queries (option (c)), which the drift-gate's `isBucketPrefixed` treats as pre-translated/verified-by-construction (no flat key, no renameMap entry, no oracle row). The round-trip oracle covers the flat keys (incl. roleEligibility via the new $contains case, §2.5).

### 1.5 id allocation
`work-N` via `SubstrateCounter.next("workItem")` (add a CounterDomain) — same monotonic, lock-serialized counter pattern as task/idea/mission.

---

## 2. The `$contains` operator — ALL 6 surfaces (C1-R2-JSONB-CONTAINMENT)

`list_ready_work({role})` needs `role ∈ spec.roleEligibility[]` — array-membership the current filter (scalar-eq/$in/range) cannot express. ONE general operator, NOT WorkItem-special-cased (A3), spanning:

1. **FilterValue type** (`storage-substrate/types.ts`): extend the union with `{ $contains: string | number | boolean }`.
2. **SQL translator** (`postgres-substrate.ts` `translateFilterClause`): new branch → `${jsonbExtractJson(field)} @> to_jsonb($n)` where the extract is `data#>'{path}'` (JSON `#>`, NOT text `#>>`) so the JSONB array containment operator `@>` applies.
3. **Watch-side `matchesFilter`** (`memory-substrate.ts:552`): add the `$contains` arm (in-JS array-membership) so WATCH + memory-mode parity holds (List-SQL-only ⇒ drift — explicit criterion).
4. **Filter whitelist / type-validation**: `$contains` is a valid operator only on declared array fields; the field must be in SUBSTRATE_FILTERABLE_KEYS (governor) — validated at the same point the other operators are.
5. **R4a value-round-trip oracle** (`__tests__/filter-roundtrip-oracle.test.ts`): add a `$contains` round-trip case (put rows with/without the role in roleEligibility[]; assert match returned + decoy excluded) so the governor behaviorally covers it.
6. **GIN index DDL** (`schema-reconciler.ts` `buildCreateIndexSQL`): currently btree-only (`->>` text-extract). Extend `IndexDef` with optional `type?: "btree"|"gin"`; emit `USING gin ((data#>'{spec,roleEligibility}') jsonb_path_ops)` for gin. (New jsonb-extract helper variant `#>` alongside the text `#>>`.)

---

## 3. Verbs + FSM (registered policy tools; OCC via `tryCasUpdate`; FSM-guarded)

### 3.1 FSM (every edge has a driver)
`ready →[claim_work]→ claimed →[start_work]→ in_progress →[block_work]↔[resume_work]→ blocked`, `in_progress →[complete_work]→ (review | done)`, `review →[complete_work]→ done`, `{claimed|in_progress|blocked} →[release_work]→ ready`, `{claimed|in_progress|blocked} →[abandon_work]→ abandoned`, and the sweeper edges `{claimed|in_progress} (heartbeat-gap) →ready` (re-queue) / `(poison N) →abandoned`. Every verb's `tryCasUpdate` transform throws `TransitionRejected` on an illegal source phase (the established repo pattern).

### 3.2 `claim_work` — WIP-cap via advisory-lock (C1-R2-WIP-LOCK-FLAVOR)
```
withAdvisoryLock(substrate, LOCK_CLASS.workItemWip, hashToInt32(agentId), async () => {   // reserve a new LOCK_CLASS.workItemWip
  const inFlight = await list({ "status.lease.holder": agentId, status: {$in:["claimed","in_progress"]} });  // count under lock (bucket-prefixed dotted path, option (c))
  if (inFlight.length >= wipCap(role)) throw new WipCapExceeded(...);                                   // REJECT at claim-time
  return tryCasUpdate(workId, w => { if (w.status!=="ready") throw TransitionRejected; w.status="claimed"; w.lease={holder:agentId,...}; return w; });
}, { timeoutMs: <fail-closed> });   // lock-acquire timeout → reject the claim (fail-closed), NOT proceed unlocked
```
Reuses the proven #352 primitive; count+CAS INSIDE the per-agent lock kills the TOCTOU. Also guards `Agent.status.quarantined` (§3.5) — reject if quarantined.

### 3.3 Other verbs
`list_ready_work({role})` (LISTEN/NOTIFY ready projection via `$contains` on roleEligibility, never poll-walk); `start_work`; `block_work({reason, blockedOn?})`; `resume_work`; `renew_lease` (heartbeat-extend ONLY — stays orthogonal to state-change, so crash-gap vs slow stays clean); `release_work` (→ ready); `abandon_work({reason})` (→ abandoned, terminal — authorized = item creator/owner or current lease-holder); `complete_work({evidence[]})` (§3.4).

### 3.4 `complete_work` evidence predicate (C1-R2-EVIDENCE-GAMEABILITY)
Passes iff, for **every** `evidenceRequirements[]` entry: ≥1 supplied evidence **binds to that requirement's `id`** AND **type-matches** its `kind`; a single evidence item may NOT satisfy multiple distinct requirements unless the requirement declares it; `refResolvable` requirements (OIS-INTERNAL only) additionally validate the referenced entity EXISTS (substrate get) **AND is RELEVANT** to the WorkItem/targetRef; `producedAt >= claimedAt` (unless the requirement explicitly allows older); empty `evidenceRequirements` ⇒ still require ≥1 freeform evidence (no silent close). External commit/pr/url refs are format-validated only (off the synchronous complete path — no GitHub call). in_progress→review when a review requirement is present + unmet; review→done when the linked verifier-gate work-item's verdict-evidence EXISTS (a verifier looked) — never requiring it to PASS (verifier stays advisory; no auto-cascade).

### 3.5 Lease-expiry sweeper + poison-guard + thrash-quarantine
- **Lease-expiry sweeper** (PulseSweeper/Watchdog pattern): lists `status ∈ {claimed,in_progress}` with `{ "status.lease.expiresAt": {$lt: nowISO} }` (bucket-prefixed dotted path, option (c); ISO-8601 lexicographic range — safe) + heartbeat-gap; CAS → ready (re-queue, no Director escalation). Inherits the R4b cal-84 escalation (a bare WorkItem row fails loud, not silent).
- **Per-ITEM poison-guard**: increment `status.leaseExpiryCount` on each re-queue; at N → `abandoned` + LOUD flag (A4). Orthogonal to:
- **Per-AGENT thrash-quarantine** (resolution #8): per-agent consecutive claim→expire-without-evidence counter on `Agent.status` (converges the D-3 Option-B telemetry gauge + the C1→C2 supervisor quarantine-read seam); at N → `Agent.status.quarantined=true` + LOUD; `claim_work` reads it as a claim-path guard.

---

## 4. Policy registration + RBAC
The 9 verbs register as policy tools (PolicyRouter) → MCP binding today, REST (`POST /apis/core.ois/v1/workitems/<id>/{claim,…}`) by construction once D-1 R3. State-changing verbs route the audited `router.handle()` under role-tagged RBAC. Exact tool/verb STRINGS + envelopes DEFER to idea-121 (working names here). `complete_work`/verdict recording NEVER requires a passing verifier outcome (verifier-role.md §1/§2.3 untouched).

---

## 5. Test plan (the deploy gate)
- **Unit:** FSM guards (every illegal edge → TransitionRejected); `$contains` FilterValue + matchesFilter; evidence-predicate (req-id bind, type-match, producedAt, no-multi-satisfy, empty⇒freeform, refResolvable internal-only); WIP-cap reject.
- **Real-pg (testcontainers, per cal-79/82):** `$contains` value-round-trip (R4a oracle extension — match returned, decoy excluded, via the GIN-indexed path); claim_work concurrency (advisory-lock → no over-cap under parallel claims); lease-expiry sweeper re-queue + poison→abandoned; the full per-kind round-trip (born-under-governor — every renameMap key, incl. lease.* dotted, round-trips).
- **Governor (R4a/R4b):** the drift-gate + round-trip oracle MUST pass for WorkItem at CI (born-conformant); the cal-84 0-bare detector arms for WorkItem.

## 6. Build sequencing (sub-PRs, off main)
1. **$contains operator** (general substrate primitive — all 6 surfaces + tests). Standalone, reusable, governor-covered. *(Could land first / independently.)*
2. **WorkItem kind** (SchemaDef + renameMap + filterable-keys + decode + repo + indexes incl. GIN + counter domain + born-under-governor tests).
3. **Verbs + FSM + WIP-lock + evidence predicate** (the actuation).
4. **Sweeper + poison-guard + thrash-quarantine** (+ Agent.status quarantine field).
Each green under the C3-R4 governor before the next.

## 7. Open contract-shape questions for the architect (Lily owns)
1. **`$contains` vs `$any` name** — I lean `$contains` (clearer; `@>` is containment). Confirm.
2. ~~renameMap lease aliases~~ **RESOLVED (architect, thread-694): option (c)** — bucket-prefixed dotted-path direct query + expression-indexes; grounded governor-clean (§1.3). (a) filed as a decoupled substrate-evolution idea. No open question.
3. **WIP-cap values** — per-role/per-agent cap numbers (or a default + per-role override map)? And the fail-closed `timeoutMs`.
4. **`IndexDef.type:"gin"`** extension — OK to extend the SchemaDef IndexDef + reconciler buildCreateIndexSQL for GIN (needed for the indexed `@>`), or prefer a different roleEligibility index strategy?
5. **Verb working-names** — confirm the 9 names are fine as placeholders pending idea-121, or you want specific ones now.
6. **`Agent.status` quarantine + thrash-counter fields** — confirm the field names land on the Agent SchemaDef (couples to the D-3/C2-L1 telemetry gauge — intentional per resolution #8).

## 8. As-shipped reconciliation (post-build + audit-4082/4085/4103/4120 hardening)

This blueprint is the pre-build design-of-record; the keystone shipped (#356) + hardened
(#358) with these deltas. Listed so the blueprint stays honest (doc-fidelity, audit-4103
LOW; no runtime change):

- **Verb count: 10, not 9** (§5/§6). `clear_work_quarantine` ([Architect|Director], the R2
  manual quarantine-escape) was added alongside the 9, per audit-4082's per-AGENT
  thrash-quarantine. C2 supervisor auto-recovery stays deferred.
- **WIP_PHASES = [claimed, in_progress, blocked, review]**, not the §3.2 two-phase
  `{claimed,in_progress}`. Steve's threat-model audit-4082 widened the WIP in-flight count
  to ALL non-terminal lease-held phases (blocked/review keep the lease → excluding them
  would let an agent hoard + claim past the cap). Strengthens backpressure.
- **Item-poison vs lease-sweep phases** (§3.5). The lease-expiry sweep LISTS all lease-held
  phases, but the per-ITEM poison counter (leaseExpiryCount++ → terminal abandon) accrues
  ONLY on claimed/in_progress lapses (audit-4103 #3) — review/blocked re-queue without
  incrementing (a parked, evidenced review item waiting on a slow verifier must not be
  poison-abandoned). Agent-thrash is the orthogonal counter.
- **SUBSTRATE_FILTERABLE_KEYS shipped as `["status", "roleEligibility"]`** — priority/type
  carry renameMap entries but were NOT added to the filterable set (§1.4 overstated). They
  remain enum-validated + re-addable when a priority-ordered-claim rung needs them.
- **Evidence predicate hardening** (audit-4103 #1/#2 + audit-4120): refResolvable now checks
  existence AND relevance (audit→Audit relatedEntity ∈ {workId,targetRef}; review→the
  resolved verifier-gate WorkItem's Hub-stamped targetRef === workId + phase=done +
  createdBy.role===verifier — non-spoofable, trusts the gate not the caller's payload). A
  non-refResolvable review falls back to the caller's producedBy claim (spoofable v1
  residual, idea-347). complete_work still never requires a passing verdict.
- **Pool sizing** (audit-4103 construction-HIGH): explicit POSTGRES_POOL_MAX (default 25 per
  the 2·expected+headroom formula) closes the withAdvisoryLock pin-1 + inner-needs-another
  starvation at the pg default-10; the structural inner-ops-reuse-pinned-connection fix is a
  wide-adoption follow-on.
