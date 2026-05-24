# M-K8s-Envelope — Mission Closing Audit (WORKING DRAFT)

**Mission:** mission-88 (M-K8s-Envelope; idea-126 anchor)
**Phase:** 9 Close (post-cutover; pre-retrospective) — IN PROGRESS via TOLERANT-bridge arc
**Status:** WORKING DRAFT — architect-fill in progress; pending W11 Phase B redo for final cutover-state metrics
**Author:** architect (lily) — substantive content added 2026-05-24; engineer-review at PR
**Date:** 2026-05-24 (initial substantive fold); TBD final post-W11 cutover

---

## §1 Phase 8 Execution summary (W0-W6 + W7-W10/ext substrate-hardening + W11 cutover-redo)

### W0-W6 (original Phase 8 ship; merged pre-Phase-B-halt)

| Wave | PR | Merge SHA | Files | Lines | Tests Added |
|---|---|---|---|---|---|
| W0 substrate-prep | #275 | e665de3 | 10 | +1195 | 27 W0 tests |
| W1 cluster-1 | #276 | f84de18 | 15 | +1457 | 50 unit + 3 wire-flow |
| W2 cluster-2 | #277 | 5eca435 | 12 | +1700+ | 38 unit + 5 wire-flow + 10 in-flight |
| W3 cluster-3 | #278 | 6b07ee2 | 13 | +1900+ | 44 unit + 6 wire-flow + 4 race |
| W4 cluster-4 | #279 | 2099e08 | 13 | +1500+ | 36 unit + 5 wire-flow + 22 adapter |
| W5 cluster-5 | #280 | b36cda4 | 12 | +1500+ | 41 unit + 4 wire-flow |
| W6 cutover+close | #281 | 4085d63 | TBD | TBD | TBD |
| W6.1 MigrationRunner CLI hotfix (bug-119) | #282 | 4eb8258 | TBD | TBD | TBD |
| W6.2 CLI compiled-path hotfix (bug-120) | #283 | 33bb8f6 | TBD | TBD | TBD |

**Original Phase 8 total:** 9 ship PRs (W0-W6 + W6.1 + W6.2); ~10,500+ lines added; 280+ tests added.

### Phase B halt 2026-05-24 — substantive findings

W6 cutover Phase B Step 7 ran 7.25min CLI (BREACHES 5min halt-trigger) + exit=0 BUT visible row-write failures. Engineer halt-discipline preserved disposition window without proceeding to Step 8 strict-flag-flip. Findings:

**~25% legacy-flat remaining per kind:**

| kind | total | envelope | legacy | %legacy |
|---|---|---|---|---|
| Thread | 651 | 160 | **491** | 75% LEGACY |
| PendingAction | 1917 | 1000 | 917 | 48% LEGACY |
| Audit | 3229 | 1727 | 1502 | 47% LEGACY |
| Task | 413 | 275 | 138 | 33% LEGACY |
| Message | 15721 | 11810 | 3911 | 25% LEGACY |
| Proposal | 32 | 30 | 2 | 6% LEGACY |
| Notification | 555 | 0 | **555** | 100% LEGACY (cartography gap) |
| Idea/Mission/Bug/Document/Tele/SchemaDef/Agent/etc. | — | 100% envelope | 0 | ✓ |

**Two sub-findings exposed:**
- **Thread btree-index inflation** — envelope-shape `data->>'status'` returns stringified status object (5827-byte max); collides with postgres 8191-byte btree-row limit
- **Notification cartography gap** — kind not in 21-kind locked inventory; no migration module; 555 rows untouched

### Stage 2 — W7-W10/ext substrate-hardening Design-pass + ratification arc (2026-05-24)

Bilateral round-1+2 across 5 Design PRs completed within ~15min wall-clock (engineer audits 10:47-10:53; architect ratifies ~10:48-10:57):

| Wave | PR | Design v1.0 | Anchor bug |
|---|---|---|---|
| W7 | #284 | RATIFIED | bug-123 (critical — Thread btree inflation) |
| W8 | #285 | RATIFIED | bug-124 (Notification cartography gap) |
| W9 | #286 | RATIFIED | bug-125 (Hub list-handler tags-iteration crash) |
| W10 | #287 | RATIFIED | bug-126 (Adapter callToolGate wedge) |
| W10-ext | #288 | RATIFIED | bug-127 (Hub M18 assertIdentity OCC contention) |

### Stage 3 — implementation cycle (in progress 2026-05-24)

| Wave | impl PR | Merge SHA | Status |
|---|---|---|---|
| W9 (bug-125) | #289 | 7b088ba | MERGED |
| W9.1 hot-fix (bug-134) | #290 | 30486f0 | MERGED (architect admin-merge) |
| W7 (bug-123) | TBD | TBD | pending |
| W8 (bug-124) | TBD | TBD | pending |
| W10 (bug-126) | TBD | TBD | pending (cross-repo coord via adapter monorepo) |
| W10-ext (bug-127) | TBD | TBD | pending (bundle with W10) |

### Stage 4 — W11 Phase B redo + Mission close + Phase 10 retrospective

TBD post-W7+W8+W10+W10-ext-merge + adapter-rebuild + Hub-rebuild + composite integration test (W10-ext A7).

## §2 bug-118 coverage closure state

bug-118 IN-clause FINAL at 8 kinds (cluster-1 5 + cluster-2 3); cluster-3+4+5 contribute zero new sourceThreadId-carrying kinds. Coverage closed across all 5 cluster waves at W6 ship.

Pre-W11-cutover-redo state: partial coverage on Idea (66 of 318 flat), Mission (15 of 88), Task (30 of 413) — to be migrated cleanly at W11 cutover-redo per W7 + W8 fixes landing first.

Post-W11 final query result: TBD (architect-fill from W11 cutover-script Step 4-5 output).

## §3 7 substrate-currency catches + 4 zero-drift ratifications (Phase 8 original)

| # | Surface | Direction | Substrate-truth |
|---|---------|-----------|-----------------|
| 1 | thread-635 R1 | architect → engineer | cluster-4 v0.2 Notification drop (engineer spec-recall stale) |
| 2 | thread-635 R2 | engineer → architect | A5 entity-kinds.json v1.2/20 → v1.3/21 (engineer worktree stale) |
| 3 | thread-637 R1 | engineer → architect | bug-97 STALE-OPEN (architect dispatch-premise stale; fix landed at e109000) |
| 4 | thread-639 R2 precision-pin | bilateral | Q2 "SchemaDef reconciler tolerance" → "write-validation envelope tolerance" doc-side framing |
| 5 | thread-640 R2 Q2 | engineer proactive | substrate-current shape verify BEFORE baking W1 partition rules (5th = proactive, not reactive) |
| 6 | thread-643 R1 W1 | engineer proactive | cluster-1 Design v0.2 partition rules SUBSTANTIAL drift vs substrate-current truth |
| 7 | thread-646 R1 W4 Q9 | engineer proactive | architect Q9 spec-recall drift (Message has threadId/authorAgentId/authorRole NOT sourceThreadId; cluster-4 §3.9 had correct answer) |

**4 zero-drift ratifications:** W2 cluster-2 (Task/PendingAction/Turn); W3 cluster-3 (Agent/Tele/SchemaDef/Counter mostly-zero + 2 deliberate-extensions); W4 cluster-4 (Message/Audit/RepoEventBridge*); W5 cluster-5 (Document/ArchitectDecision/3 HistoryEntry kinds production-substrate-verified at Phase 4 closure).

### Stage 3 substrate-currency catches (2026-05-24 W7-W10 bilateral)

| # | Surface | Direction | Substrate-truth |
|---|---|---|---|
| 8 | W7 R1 Q1 | engineer add | `# Renamed in W7 mission-88` lineage comment on each renamed index — defensive-archeology for future bisecting |
| 9 | W7 R1 Q3 | engineer refinement | INDEX_OWNERSHIP_PREFIX 3-state model (owned-current + owned-deprecated + foreign-leave) — operator-DX preserved |
| 10 | W7 R1 A5 | engineer surface | CLI exit=0 on partial-success — bug-133 filed; halt-criteria-companion class |
| 11 | W9 R1 Q4 | engineer refinement | KEEP legacy branch indefinitely vs architect-lean strip-post-W11 — defense-in-depth |
| 12 | W10 R1 Q1 | engineer correction | "cross-repo" architect framing wrong; actually monorepo (adapters/claude-plugin + packages/network-adapter) |
| 13 | W10-ext (γ) verify | engineer audit | displacement-safe IS implemented at policy layer; bug-127 is the putIfMatch OCC race during normal displacement — (α) correct fix |
| 14 | W9 post-merge smoke-test | architect → engineer | W9 audit-grep scope-narrow; missed sibling-fields linkedTaskIds/fixCommits → bug-134; greg owned bilateral catch + W9.1 hot-fix within ~10min |

## §4 Cumulative methodology refinements (1-17)

### 7 envelope-methodology patterns (Phase 8 original)

1. **metadata.name handle-classified vs content-classified** (cluster-2 §1.5)
2. **Declared-with-controlled-mutation** (cluster-2 PodSpec.nodeName / LeaseSpec.acquireTime precedents)
3. **Derived-scalar-field discipline** (cluster-2 PendingAction.naturalKey)
4. **Default-to-status for FSM-mutated fields** (cluster-2 inverse of cluster-1 default-to-spec)
5. **Virtual-view envelope-exclusion** (cluster-1 Mission.tasks/ideas; cluster-2 Turn.missionIds/taskIds)
6. **Declared-routing-intent vs declared-content-classification axis** (cluster-3 §5 — materially bilateral at W5)
7. **Atomic-primitive-rewrite-with-wave-migration** (cluster-4 W4 A1 — W3 SubstrateCounter + W4 RepoEventBridge adapter instances)

Plus 4 K8s-convention sub-disciplines: §1.5 handle vs content + §1.6 multi-FSM-in-status + §1.7 field-name collision with envelope `kind` + append-only-constant `status.phase`.

### Stage 2 + Stage 3 substrate-engineering refinements (8-17)

8. **Runbook-shape-matches-operation-shape** (W6 thread-648 R2): bootstrap=prose; data-migration=script; cutover=script-with-gates
9. **Substrate-shape changes are not "data-only" — they're data + every consumer + every index + every reader-side normalization** (W9 root-cause framing; W7 stealth-broken-index parallel; W9.1 sibling-pattern extension). Three independent surfaces of one underlying pattern.
10. **Index-row-size budgeting at SchemaDef-authoring time** (W7 finding): envelope-shape adds ~50-100 bytes structural overhead per indexed expression; future SchemaDef declarations should model worst-case indexed-value-length per index BEFORE declaring
11. **CLI exit-code semantics for partial-success** (W7 A5 / bug-133): CLI exit-code MUST treat partial row-write failures as non-zero exit; halt-criteria-companion class to prevent silent-degradation masking
12. **Pre-W2 production-state kind-inventory grep** (W8 A5 / bug-124): substrate-introduction-class missions need `SELECT DISTINCT kind FROM entities` grep against production-state, not just architect spec-recall. Notification missed at <5s discoverable depth.
13. **Hub iterate-tags defensive coercion pattern** (W9 root-cause framing): repository code reading entities must handle envelope→legacy normalization defensively at call-site OR via substrate-layer normalization (idea-320 systemic option)
14. **Adapter dispatcher post-condition-logging discipline** (W10 Q4): every CallTool entry MUST emit exactly one terminal log line; missing-terminal-log = test-fail catches silent-hang failure-mode at boundary
15. **OCC-class-substrate-defect pattern** (W10-ext A5): substrate primitives that rely on per-callsite retry-loops for strong-CAS semantics under contention compose into pathology class. Counter + assertIdentity instances both extant. (β) `withAdvisoryLock` systemic answer.
16. **Multi-defect composite substrate-pathologies require designed-together fix-bundle, not sequential per-defect hotfixes** (W10 A7): when 3+ substrate-defects compose to wedge bilateral coord (W9 + W10 + W10-ext "architect-comms-amplification-loop"), single-defect fixes leak; composite-fix discipline required.
17. **Scope-narrow audit-grep for symptom-class misses sibling-pattern same-class cases** (W9.1 hot-fix / bug-134): W9 grep was `*.tags`-named; better grep targets ALL unguarded `[...X.Y]` array spreads. Bilateral catch — architect post-deploy smoke-test surfaced what engineer pre-PR grep should have caught.

## §5 Post-mission Idea filings + composition

### Pre-Stage-3 filings (Phase 8 era)

- **idea-317 M-Multi-Agent-Persistence-Context-Engineering Initiative** — composes post-mission-88 substrate extension
- **M-SchemaDef-Reconciler-Status-Write-Patch** — substrate-extension class; OQ10 deferred reconciler-side WRITES from cluster-3 A2
- **idea-200 M-Thread-Substrate-Carve-Out** — Thread.status.messages carve-out post-cluster-1 cutover
- **idea-121 M-API-v2.0** — `get_resource_shape` consumer of SchemaDef envelope partition
- **idea-151 M-Graph-Relationships** — Relationship-kind extraction post-envelope

### Stage 3 follow-on filings (2026-05-24)

- **idea-319 M-Thread-Content-Storage-Reshape** — W7 Q2 (β) alternative; cluster-1 redesign to extract Thread.status.messages into separate substrate (composes with idea-299 BlobBody-Substrate)
- **idea-320 M-Substrate-TOLERANT-Read-Normalization** — W9 Q1 (γ) alternative; centralized substrate-boundary read normalization vs per-call-site shape-helper
- **idea-321 M-Notification-Audit-Consolidation** — W8 Q4 (β) alternative; subsume Notification into Audit kind (composes with idea-316)
- **idea-322 M-Substrate-OCC-Primitive** — W10-ext A5; systemic `withAdvisoryLock` substrate-layer primitive composing bug-97 + bug-127 (OCC-class-substrate-defect pattern systemic fix)

### Stage 3 bug filings (2026-05-24)

- **bug-123** Thread btree inflation (critical; W7 anchor; resolved by W7 impl pending)
- **bug-124** Notification cartography gap (major; W8 anchor; resolved by W8 impl pending)
- **bug-125** Hub iterate-tags crash (major; W9 anchor; RESOLVED by W9 impl PR #289)
- **bug-126** Adapter callToolGate wedge (major; W10 anchor; resolved by W10 impl pending)
- **bug-127** Hub M18 assertIdentity OCC contention (major; W10-ext anchor; resolved by W10-ext impl pending)
- **bug-133** MigrationRunner CLI exit=0 on partial-success (major; halt-criteria-companion; separate hot-fix candidate)
- **bug-134** W9 scope-extension — bug.linkedTaskIds + bug.fixCommits + turn.tele (major; RESOLVED by W9.1 hot-fix PR #290)

## §6 Methodology calibration capstone

### Phase 8 capstones (W1-W6 original)

**5 clusters in a row self-prompting at engineer-proactive R1 verify-before-bake.** Discipline mature + load-bearing across ALL 5 cluster-Designs. Pattern reliably catches drift + ratifies no-drift + catches architect spec-recall drift at dispatch (7th catch at W4).

**LOAD-BEARING discipline per architect framing (thread-643 R2 v2.1 methodology candidate):** "engineer-proactive verify-before-bake at Q-class disposition is the LOAD-BEARING discipline that prevents Design-stale defects from amplifying into migration-code defects."

**runbook-shape-matches-operation-shape methodology refinement (W6 thread-648 R2):** bootstrap=prose; data-migration=script; cutover=script-with-gates. Engineer-correct divergence from mission-83 W5.4 prose-runbook precedent when operation-shape differs.

### Stage 2 + Stage 3 capstones (W7-W10/ext substrate-hardening arc)

**Halt-criteria-honored = mission-asset, not setback.** Engineer halt at Phase B Step 7 (5min trigger breach + visible row-failures + ~25% legacy-flat) preserved disposition window without data loss; enabled architecturally-correct TOLERANT-bridge path (W7-W10 substrate-hardening + W11 clean re-cutover) instead of forced rollback or pressure-shaped forward-fix.

**Bilateral pace was extraordinary despite comms-wedge.** 5 Design PRs round-1 audited + round-2 ratified within ~15min total wall-clock (greg shipped all 5 round-1 audits 10:47-10:53; lily shipped all 5 round-2 ratifies 10:48-10:57) — all via PR-direct + note-channel + Phase-4-substitute coordination because thread-reply was wedged by bug-126/127 composite. PR-direct + note-channel demonstrated as **viable Phase-4-substitute coordination mechanism** during substrate-incident windows.

**Comms-broken-architect-perspective = composite-substrate-pathology:**
- bug-125 (Hub iterate-tags crash on partial-shape entities) — broke architect entity-read tools
- bug-126 (Adapter callToolGate doesn't release on isError responses) — wedged the entity-tool surface from the host
- bug-127 (Hub M18 assertIdentity OCC contention exceeded retry budget) — prevented bypass-tool from acquiring identity for turn-bound writes

Three independent substrate-defects composed into "architect comms appears broken" experience. Direct MCP curl bypass + note-kind coordination + PR-direct workaround sustained mission progress until W9 (Hub-side) + W10 + W10-ext (adapter-side) implementations land + adapter rebuild + shim restart.

**Memory artifacts saved 2026-05-24** for future incident recovery:
- `reference_mcp_curl_bypass.md` — direct MCP curl bypass procedure
- `reference_note_kind_escape_hatch.md` — note-kind as escape-hatch coordination channel when thread-reply blocked

## §7 Phase B halt narrative (substantive)

### Sequence

1. **Phase B Steps 1-6:** snapshot ✓ / Cloud Build prod image ✓ / pre-pull on hub-vm ✓ / rollback image hash captured ✓ / Watchtower stopped ✓ / Hub deploy with SUBSTRATE_ENVELOPE_TOLERANT=true ✓
2. **Step 7 CLI migration:** 7.25min elapsed (BREACHES 5min halt-trigger); exit=0 BUT visible row-write failures
3. **Step 8 strict-flag-flip:** NOT executed — engineer halt-criteria honored

### Engineer halt-discipline analysis

Per architect-R3 5min halt-trigger discipline + engineer-side independent judgment, engineer did NOT proceed past Step 7 despite exit=0 because:
- 5min wall-time budget breached (~7.25min actual)
- Visible Thread btree-index errors in CLI output (despite exit=0)
- Post-migration verify-via-psql showed ~25% legacy-flat remaining per kind

This is the load-bearing safety net that prevented strict-flag-flip on partial-migration state (which would have crashed Hub on unmigrated rows).

### Disposition selection (Director-ratified TOLERANT-bridge)

Three options surfaced (engineer thread-653 v1.0):
- (A) ROLLBACK — pre-cutover image hash; resume Watchtower; pg_restore from snapshot (would lose ~1hr writes including thread-653 itself)
- (B) STAY in TOLERANT + investigate — production functional; no rush; designed-together hotfix cycle (engineer-lean)
- (C) PARTIAL forward-fix in-window — extend migration + re-run (pressure-shaped; risks new defects layered on partial state)

**Architect refined to (D) TOLERANT-bridge:**
- Preserve TOLERANT-mode production (avoid (A) data-loss + (Ab) pre-cutover-image-crash-on-envelope-rows)
- W7-W10 substrate-engineering waves to fix the root-cause defects (4 substrate-bugs filed as anchors)
- W11 clean re-cutover on top
- Same target-state reached without pressure-shaped fix-cycle

Director ratified (D) — Stage 2 Design-pass cycle followed.

### Production state during Stage 2/3 (unchanged)

- Hub container running on TOLERANT-mode image (Cloud Build sha256:8898a703... initial; sha256:2779ecd680... post-W9-rebuild)
- Watchtower stopped (no auto-pickup)
- Pre-cutover snapshot preserved (rollback safety net)
- No data loss
- Hub-API consumer-code DEGRADED during W9-pending window (resolved post-W9-merge for Idea/Mission; W9.1 needed for Bug.linkedTaskIds/fixCommits + Turn.tele)

## §8 Phase 10 retrospective scope (architect prep for Director-ratification)

Walkthrough mode for substrate-introduction class per thread-648 Q9.

**Topics for Director engagement:**

1. **17 cumulative methodology refinements** (§4 above) — bank into project-level memory + companion-policy updates per Director judgment
2. **Halt-criteria-honored = mission-asset** pattern — promote to standing discipline beyond mission-88 (general substrate-introduction class)
3. **Bilateral-pace finding** — PR-direct + note-channel as viable Phase-4-substitute coordination during substrate-incident windows
4. **OCC-class-substrate-defect pattern** (bug-97 + bug-127 sibling) — idea-322 M-Substrate-OCC-Primitive Strategic Review consideration
5. **Substrate-shape-changes-are-not-data-only** pattern — fold into substrate-introduction-class mission preflight checklist
6. **Engineer-side post-PR test-fixture grep-pattern discipline** — sibling to architect-side spec-recall-verify-before-bake; W9.1 hot-fix demonstrates closure pattern
7. **Phase B halt-then-stage-2/3-engineering arc** — successful pattern for substrate-introduction missions that surface root-cause defects during Phase 8 execution

---

**Architect to finalize post-W11-cutover-execution per W7+W8+W10+W10-ext-merge + composite integration test (W10-ext A7).** Engineer review at PR per A3.
