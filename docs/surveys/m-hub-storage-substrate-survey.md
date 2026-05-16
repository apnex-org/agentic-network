---
mission-name: M-Hub-Storage-Substrate
source-idea: idea-294
methodology-source: docs/methodology/idea-survey.md v1.0
director-picks:
  round-1:
    Q1: abcd
    Q1-rationale: all-4-tele-primary — substrate-introduction touches all 4 teles simultaneously (parallels mission-65/66 all-4-load-bearing pattern)
    Q2: d
    Q2-rationale: full migration — substrate + all handlers + LocalFsStorageProvider retired; rejects half-measures
    Q3: a
    Q3-rationale: single bundled mission — atomic substrate-replacement, one mission lifecycle
  round-2:
    Q4: a
    Q4-rationale: hard-cut state-migration script; risk-managed via mechanism simplicity not via complex orchestration
    Q5: d
    Q5-rationale: defer all companion features (resourceVersion + audit + FK); minimal substrate only; follow-on missions for each
    Q6: a
    Q6-rationale: local-only in v1; cloud-deployment deferred to follow-on mission; cloud-portability verified by interface-shape not actual deployment
mission-class: substrate-introduction
tele-alignment:
  primary: [tele-1, tele-3, tele-7, tele-2, tele-6]
  secondary: [tele-11]
  round-1:
    primary: [tele-1, tele-3, tele-7, tele-2, tele-6]
    secondary: [tele-11]
  round-2:
    primary: [tele-7, tele-3]
    secondary: [tele-11, tele-9]
anti-goals-count: 7
architect-flags-count: 4
skill-meta:
  skill-version: survey-v1.0
  tier-1-status: implemented
  tier-2-status: stubbed
  tier-3-status: stubbed
calibration-data:
  director-time-cost-minutes: 40
  comparison-baseline: m-shim-observability-phase-2-survey.md (all-4-tele-primary Round-1 pattern parallels foundational-substrate-mission shape)
  notes: |
    First Survey to follow a substantive pre-Survey architect-Director directional-outcome-shaping phase (9 outcomes ratified in chat before Q1-Q6). This dramatically narrowed Round-1 question-space — Q1-Q3 didn't re-litigate substrate shape (which a typical substrate-Survey would have to), instead anchoring WHY/WHO/HOW-cadence at higher level. Methodology-evolution candidate: should `idea-survey.md` formally recognize a "pre-Survey directional-outcome capture" phase as load-bearing context for sharper Q1-Q3 framing? Round-1 all-4-tele-primary parallels mission-65/66 pattern (foundational structural missions tend to load all primaries). Round-2 picks dramatically simplified mechanism-scope (a + d + a all = simplest-available-mechanism) — clean "substrate IS the mission" signal that complemented Round-1's max-architectural-scope; risk-managed via mechanism-simplicity rather than mission-decomposition.
contradictory-constraints:
  # No contradictory multi-pick detected. Q1 multi-pick all 4 was orthogonal (each tele adds a primary, not mutually exclusive). Q5 single pick of (d) without co-selection of a/b/c — clean defer-all signal, not contradictory.
calibration-cross-refs:
  closures-applied:
    - "#59 closure mechanism (a) — branch-push pre-bilateral round-1 audit (applied to §7.1 branch + PR strategy)"
  candidates-surfaced:
    - "pre-Survey directional-outcome capture phase recognition (methodology-evolution candidate; observed first-canonical instance)"
---

# M-Hub-Storage-Substrate — Phase 3 Survey envelope

**Methodology:** `docs/methodology/idea-survey.md` v1.0 (3+3 Director-intent pick-list)
**Source idea:** idea-294
**Mission-class candidate:** substrate-introduction (with structural-inflection + saga-substrate-completion characteristics — multi-substrate-seam shift + consolidates two providers into one)
**Branch:** `agent-lily/m-hub-storage-substrate` (push pre-bilateral round-1 audit per calibration #59 closure mechanism (a))

---

## §0 Context

idea-294 surfaced Director-direct 2026-05-16 after diagnosing the Hub CPU spike (74% idle from sweeper full-scans against ~9.5k messages + ~1k threads). Pre-Survey discussion 2026-05-16 produced 9 directional outcomes that lock substrate shape: single substrate (not two-providers); container-deployable locally; data-portability via artifact; ~1.5MB per-value cap; watch must-have; substrate-native indexing; CRD-equivalent programmability; HubStorageSubstrate as discrete module with standard interface; uniform single-entities-table + JSONB + per-kind expression indexes (Flavor A). Leading candidate: postgres + LISTEN/NOTIFY + JSONB + SchemaDef reconciler. See idea-294 text §"Pre-Survey directional outcomes" for full context.

Cross-mission context: bug-93 (sweeper poll-throttle band-aid; PR #203) is the symptom this idea structurally fixes. `LocalFsStorageProvider` + `GcsStorageProvider` siblings both retired by this mission (outcome 1 — one substrate). idea-121 (API v2.0) explicitly out-of-scope per `feedback_defer_tool_surface_to_idea_121.md`. Methodology anchor: `docs/methodology/idea-survey.md` v1.0; mission-class taxonomy `docs/methodology/mission-lifecycle.md` §3.

---

## §1 Round 1 picks

### §1.questions — Round 1 question definitions

**Q1 — tele primaries (WHY):** Which teles primarily drive M-Hub-Storage-Substrate? Multiple plausibly load-bearing per pre-Survey discussion; pick the dominant primaries. (multi-pick natural; orthogonal)

- (a) tele-3 Sovereign Composition — substrate as discrete sovereign module with bit-perfect CRUD/list/watch/schema interface; substrate-internals (SQL, JSONB, indexes) contained below the boundary
- (b) tele-7 Resilient Agentic Operations — watch primitive eliminates the sweeper-poll anti-pattern at root; handlers become event-driven; linear-cost-per-entity scaling problem broken
- (c) tele-2 + tele-6 combined — SchemaDef-as-spec (declarative entity-kind authoring, not DDL-migrations); CRD-programmability lowers friction for adding/modifying entity-kinds
- (d) tele-1 Sovereign State Transparency — substrate IS the uniform state-backplane; substrate-native filtered queries replace per-handler in-memory filter logic

**Q2 — subsystem-coverage scope (WHO/WHAT):** How much consumer-side migration is in v1? Cumulative levels; pick the v1 ship-boundary. (single-pick)

- (a) Substrate-only behind boundary — module ships; rest of Hub continues using LocalFsStorageProvider
- (b) Substrate + ScheduledMessageSweeper — substrate ships AND the highest-pain consumer refactored
- (c) Substrate + all sweepers — substrate ships AND every sweeper-class consumer migrated
- (d) Substrate + all handlers + LocalFsStorageProvider retired — full Hub migration; FS-provider deleted at mission-end

**Q3 — wave-cadence (HOW):** How does the chosen Q2 scope ship? (single-pick)

- (a) Single bundled mission — Q2 scope ships as ONE mission with a coherent wave-arc; atomic substrate-introduction
- (b) Phased within one mission — substrate-introduction (W1) then incremental consumer-migration (W2/W3); same mission
- (c) Phased across two missions — substrate-introduction = mission A; consumer-migration = mission B (follow-on)
- (d) Trickle across N missions — substrate-intro mission + per-consumer migration as separate follow-on missions

### §1.picks — Round 1 Director picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q1 — tele primaries (WHY) | **a + b + c + d** (all 4 teles) | All 4 teles primary; structural substrate-mission touching composition + resilience + spec-as-system + state-transparency simultaneously |
| Q2 — subsystem-coverage scope (WHO/WHAT) | **d** (substrate + all handlers + LocalFsStorageProvider retired) | Maximum scope; rejects half-measures; full Hub migration to substrate within mission |
| Q3 — wave-cadence (HOW) | **a** (single bundled mission) | Atomic substrate-replacement; one mission lifecycle |

### §1.Q1 — Per-question interpretation

Director's pick of all 4 teles (a + b + c + d) parallels the mission-65/66 all-4-load-bearing pattern and signals this is a **foundational substrate mission** — not an optimization or tactical fix. Each tele anchors a distinct pre-Survey outcome: tele-3 → outcome (8) discrete-module + outcome (9) substrate-internals-contained; tele-7 → outcome (5) watch primitive; tele-2 + tele-6 → outcome (7) CRD-programmability; tele-1 → outcome (6) substrate-native indexing + uniform query model. These compose into the mission's coherent architectural surface — none is reducible to a downstream-consequence of the others.

Matrix-solve hypothesis: M-Hub-Storage-Substrate is **structural substrate-replacement that simultaneously establishes a sovereign-composition module (tele-3), restores state-transparency at the substrate boundary (tele-1), eliminates the poll-anti-pattern at root (tele-7), and operationalizes CRD-equivalent programmability (tele-2 + tele-6).** Design v0.1 must demonstrate all 4 substrate properties explicitly; dropping any reduces Director-intent fidelity.

### §1.Q2 — Per-question interpretation

Director's pick of (d) — full migration including LocalFsStorageProvider retirement — is the **maximum-scope answer that rejects the "ship the substrate but don't use it" path**. Read directly against Q1: tele-1 (uniform state-backplane) would be violated by any mixed-substrate end-state (partial migration = substrate is not THE backplane); tele-3 (substrate-as-discrete-module) is undermined if half the Hub bypasses the boundary via FS. Q2(d) is implied by Q1's (a) + (d) picks — the picks are coherent.

Implications: (i) all sweepers + handlers migrate to substrate-API within mission; (ii) `LocalFsStorageProvider` deleted at mission-end; (iii) `GcsStorageProvider` also retired (same-shape sibling per pre-Survey outcome 1); (iv) on-disk-state migration is in-scope (cannot ignore ~9.5k messages if FS is going away); (v) mission scope is large — risk-management is load-bearing for Round-2.

### §1.Q3 — Per-question interpretation

Director's pick of (a) — single bundled mission — combined with Q2(d) means **one large atomic mission, not phased across multiple lifecycles**. The composite signal: "ship the substrate AND complete the migration AND retire the legacy providers as ONE coherent architectural arc." Phased-across-missions (c) or trickle (d) would dilute the atomicity that the substrate-introduction warrants.

Architect-flag candidate for §6: Q2(d) + Q3(a) compose to a HIGH-RISK substrate-introduction. Mission-class is substrate-introduction with structural-inflection + saga-substrate-completion characteristics (multi-substrate-seam shift; consolidates two providers into one). Sizing pre-Round-2 lean: XL (substantially larger than the canonical substrate-introduction). Wave-decomposition discipline within the single mission becomes critical — likely W0 spike / W1 substrate-shell / W2 reconciler+SchemaDef / W3 sweeper-migration / W4 handler-migration / W5 FS-retirement / W6 GCS-retirement / W7 ship. Round-2 should probe migration shape + companion-features + risk-de-scoping options.

**Round-1 composite read** (1-2 sentences): M-Hub-Storage-Substrate is a **foundational state-backplane substrate-introduction mission** that simultaneously establishes the HubStorageSubstrate as the sovereign-composition module AND migrates the entire Hub off LocalFs/GcsStorageProvider in ONE atomic bundled mission lifecycle. All 4 teles are load-bearing primary; scope is large (XL); cadence is atomic; risk-management + migration-shape + companion-features are the load-bearing Round-2 dimensions.

---

## §2 Round 2 picks

### §2.questions — Round 2 question definitions

**Q4 — migration shape (WHAT-mechanism):** How does existing FS-state (~9.5k messages, ~1k threads) move into the substrate during the mission? Determines risk-profile of the FS→substrate cutover. (single-pick)

- (a) Hard-cut with state-migration script — one-shot dump→transform→load→restart-on-substrate; brief downtime; simplest mission; highest single-cutover risk
- (b) Strangler with dual-write — write to BOTH for transition window; read from substrate; validate parity; eventually retire FS; zero-downtime; complex; reversible
- (c) Greenfield + boot-time replay — substrate starts empty; Hub boot scans FS and idempotently replays entities; FS legacy-read-only; downtime = replay-time
- (d) Greenfield + archive-existing — substrate starts empty; existing FS archived as snapshot; Hub starts fresh; loses operational continuity of historical entities

**Q5 — companion features in v1 (WHAT-mechanism):** Which companion features ship in v1? Each is an independent constraint. Pick all that are in-scope; defer the rest to follow-on missions. (multi-pick natural; (d) co-picked with a/b/c is contradictory §7 signal)

- (a) Optimistic concurrency (k8s-style `resourceVersion`) — compare-and-swap writes; safe concurrent writes; enables future multi-Hub topologies
- (b) Audit / history-table — per-entity history populated by trigger; time-machine queries + change-attribution
- (c) FK-enforcement — postgres foreign keys (e.g., `message.thread_id → threads.id`); integrity at substrate boundary
- (d) Defer all companion features — minimal substrate only (CRUD + list-filter + watch + SchemaDef + reconciler + snapshot); resourceVersion + audit + FK → follow-on missions

**Q6 — cloud-deployment horizon (WHEN-mechanism):** How far does cloud-deployment go in v1? Pre-Survey outcome (1) committed "one substrate runs both local and cloud"; this picks when cloud actually lands. (single-pick; cumulative)

- (a) Local-only in v1 — cloud deferred to follow-on mission; substrate is cloud-deployable by design but not deployed within mission
- (b) Local + cloud-staging — CloudSQL or equivalent provisioned within mission; testing only; not authoritative; validates cloud-portability
- (c) Local + cloud-deployed-non-prod — cloud substrate fully deployed within mission; non-authoritative shadow of local; cutover scheduled post-mission
- (d) Local + cloud-deployed + cutover-to-cloud-authoritative — full cloud migration within mission; cloud is authoritative at mission-end

### §2.picks — Round 2 Director picks

| Q | Pick | Director-intent reading (1-line summary) |
|---|---|---|
| Q4 — migration shape (WHAT-mechanism) | **a** hard-cut with state-migration script | Simplest mechanism; risk-managed via thorough script testing + brief downtime, not via complex live-coordination |
| Q5 — companion features in v1 (WHAT-mechanism) | **d** defer all companion features (minimal substrate only) | Clean "ship the substrate, NOTHING more"; resourceVersion + audit + FK → follow-on missions |
| Q6 — cloud-deployment horizon (WHEN-mechanism) | **a** local-only in v1 | Cloud-deployment deferred entirely; substrate is cloud-portable by interface-shape, not by deployment |

### §2.Q4 — Per-question interpretation

Director's pick of (a) — hard-cut with state-migration script — is the **simplest mechanism with highest single-cutover risk**. Against Round-1: Q2(d) full migration + Q3(a) atomic mission already creates a large mission; choosing (b) strangler or (c) replay would add complexity (dual-write coordination, replay-idempotence verification) that compounds risk in the OPPOSITE direction. Director's hard-cut pick signals: **keep the migration mechanism as simple as possible; risk-manage via thorough state-migration-script testing + Phase 6 preflight + brief downtime window, NOT via complex live-coordination machinery**.

Implication: state-migration script becomes a load-bearing artifact — must be exhaustively tested, handle ALL entity types, idempotent on re-run, reversible by re-running against pre-cutover FS snapshot. Downtime window is bounded and acceptable. (d) greenfield+archive was rejected — Director wants operational continuity of existing entities, not a fresh start with archive.

### §2.Q5 — Per-question interpretation

Director's pick of (d) — defer all companion features — is the **cleanest "ship the substrate, NOTHING more" answer**. No contradictory multi-pick (a/b/c not co-picked with d). resourceVersion + audit-history + FK-enforcement explicitly become follow-on missions. Against Round-1: Q2(d) max-scope at the architectural axis + Q5(d) min-scope at the feature axis is a coherent risk-management posture — make the SUBSTRATE-REPLACEMENT the whole mission; don't add feature-creep on top.

Implication: substrate v1 surface = CRUD + list-filter + watch + SchemaDef + reconciler + snapshot. Companion features carved into idea-level follow-ons (architect TODO at mission-close: file ideas for resourceVersion + audit-history + FK-enforcement). Phase 6 preflight must verify no companion-feature scope creep.

### §2.Q6 — Per-question interpretation

Director's pick of (a) — local-only in v1 — defers cloud-deployment entirely. Substrate is designed cloud-portable (pre-Survey outcomes 1 + 2) but cloud-deployment is follow-on. Combined with Q4(a) hard-cut + Q5(d) minimal: **v1 is "ship the substrate locally; prove it works in production for the local Hub; cloud comes later"**.

Implication: postgres-container-locally is the v1 deployment target (docker-compose or equivalent); cloud-deployment plumbing (CloudSQL connection strings, IAM, VPC, network config) is explicitly out-of-scope; cloud-portability is verified by INTERFACE-shape (postgres-compatible substrate, no GCP-specific SDKs) not by ACTUAL deployment. Follow-on mission carries substrate to cloud.

**Round-2 composite read** (1-2 sentences): Round-2 dramatically simplifies the mission's mechanism scope while preserving Round-1's architectural scope — M-Hub-Storage-Substrate v1 = **substrate-replacement (Round-1 max-scope) via simplest-available mechanism in each open dimension (Round-2 min-scope on Q4 + Q5 + Q6)**. Hard-cut migration + minimal-features-substrate + local-only deployment = a coherent "the substrate IS the mission; nothing else gets in" intent; risk-managed via mechanism-simplicity, not via mission-decomposition.

---

## §3 Composite intent envelope

M-Hub-Storage-Substrate is a **foundational substrate-introduction mission** that establishes `HubStorageSubstrate` as the sovereign-composition state-backplane for the Hub (Round-1 primary outcomes) via the simplest-available mechanism in each open dimension (Round-2 picks). The substrate replaces both `LocalFsStorageProvider` AND `GcsStorageProvider` (full migration per Q2=d). Companion features (resourceVersion, audit-history, FK-enforcement) carved into follow-on missions per Q5=d. Cloud-deployment carved into follow-on mission per Q6=a. Migration uses hard-cut state-migration script with brief downtime window per Q4=a. Single bundled mission lifecycle per Q3=a.

**Primary outcomes (load-bearing for Design v0.1):**
1. `HubStorageSubstrate` module ships with standard CRUD + list-filter + watch + SchemaDef + reconciler + snapshot interface (per pre-Survey outcome 8 + Q5=d minimal-substrate)
2. `LocalFsStorageProvider` + `GcsStorageProvider` retired at mission-end (per Q2=d full migration)
3. All sweepers + handlers migrated to substrate-API; bug-93 structurally closed (per Q2=d + Round-1 tele-7)
4. Hard-cut state-migration script tested + executed; existing Hub state preserved in substrate (per Q4=a)
5. CRD-equivalent programmability operationalized — SchemaDef-as-entity + reconciler-via-watch (per pre-Survey outcome 7 + Round-1 tele-2 + tele-6)
6. Substrate runs in postgres container locally; cloud-portability verified by interface-shape only (per Q6=a)

**Key design constraints surfaced (Phase 4 Design v0.1 anchors):**
- Substrate layout: single `entities` table + JSONB body + per-kind expression indexes (Flavor A; pre-Survey outcome 9)
- Per-value soft cap ~1.5MB (pre-Survey outcome 4)
- Watch primitive: postgres LISTEN/NOTIFY or logical replication — Design picks (mechanism deferred)
- Postgres flavor: vanilla/AlloyDB/Cockroach/Yugabyte — Design picks (mechanism deferred)
- State-migration script: load-bearing single-point-of-failure; chaos-path testing required; reversibility via pre-cutover FS snapshot
- Wave-decomposition within single mission: substrate-shell → reconciler+SchemaDef → sweeper-migration → handler-migration → state-migration-cutover → FS+GCS retirement → ship

---

## §4 Mission scope summary

| Axis | Bound |
|---|---|
| Mission name | M-Hub-Storage-Substrate |
| Mission class | **substrate-introduction** (with structural-inflection + saga-substrate-completion characteristics — multi-substrate-seam shift; consolidates two providers into one) |
| Substrate location | `hub/src/storage-substrate/` (new module) + downstream consumer refactors across `hub/src/handlers/` + `hub/src/sweepers/` |
| Primary outcome | `HubStorageSubstrate` module ships as sovereign state-backplane; LocalFs + Gcs providers retired; entire Hub on substrate within one mission |
| Secondary outcomes | bug-93 structurally closed; CRD-equivalent programmability operationalized; sweepers event-driven; substrate cloud-portable by interface-shape |
| Tele alignment (primary, whole-mission) | tele-1, tele-2, tele-3, tele-6, tele-7 |
| Tele alignment (secondary, whole-mission) | tele-9, tele-11 |
| Tele alignment (Round-1) | primary: tele-1, tele-2, tele-3, tele-6, tele-7; secondary: tele-11 |
| Tele alignment (Round-2) | primary: tele-3, tele-7; secondary: tele-9, tele-11 |
| Sizing pre-Design lean | **XL** (Round-1 max-architectural-scope); mechanism-scope kept M via Round-2 simplicity picks; net L-XL |

---

## §5 Anti-goals (out-of-scope; deferred)

| AG | Description | Composes-with target |
|---|---|---|
| AG-1 | Optimistic concurrency / `resourceVersion` / compare-and-swap writes | follow-on mission M-Hub-Storage-ResourceVersion (file at mission-close) |
| AG-2 | Audit / history-table — per-entity history populated by trigger | follow-on mission M-Hub-Storage-Audit-History (file at mission-close) |
| AG-3 | Foreign-key enforcement — postgres FKs across entity references | follow-on mission M-Hub-Storage-FK-Enforcement (file at mission-close) |
| AG-4 | Cloud-deployment — CloudSQL/AlloyDB provisioning + IAM + VPC + cutover | follow-on mission M-Hub-Storage-Cloud-Deploy (file at mission-close) |
| AG-5 | API verb / envelope redesign (MCP tool surface for new substrate operations) | deferred to idea-121 API v2.0 per `feedback_defer_tool_surface_to_idea_121.md` |
| AG-6 | Per-kind dedicated tables (Flavor B); per-kind storage-layout opt-in | not engineering for hypothetical (pre-Survey outcome 9); follow-on idea if specific kind demands it |
| AG-7 | Methodology document changes (mission-lifecycle.md, etc.) | substrate-only mission; no methodology-doc updates in scope |

---

## §6 Architect-flags / open questions for Phase 4 Design round-1 audit

Architect-flags batched for engineer's round-1 content-level audit (per mission-67 + mission-68 audit-rubric precedent: CRITICAL / MEDIUM / MINOR / PROBE classifications). Each flag carries an architect-recommendation to challenge.

| # | Class | Flag | Architect-recommendation |
|---|---|---|---|
| F1 | **CRITICAL** | State-migration script is load-bearing single-point-of-failure (Q4=a hard-cut); failure mid-cutover blocks the mission ship | Design v0.1 must include: (i) explicit chaos-path test plan (script-failure modes + recovery); (ii) reversibility mechanism (pre-cutover FS snapshot kept until N days post-cutover); (iii) idempotent re-run capability; (iv) full-entity-type coverage matrix |
| F2 | **MEDIUM** | XL mission sizing (Q2=d + Q3=a + substrate-introduction class); risk of scope creep within the single bundled mission | Design v0.1 must propose explicit wave-decomposition (W0 spike → W1 substrate-shell → W2 reconciler+SchemaDef → W3 sweeper-migration → W4 handler-migration → W5 state-migration-cutover → W6 FS+GCS retirement → W7 ship); Phase 6 preflight must audit for AG-1..AG-4 scope creep |
| F3 | **MEDIUM** | All 4 teles primary (Q1 = a+b+c+d); no axis can be dropped without losing Director-intent fidelity | Design v0.1 must demonstrate ALL 4 substrate properties explicitly (sovereign-composition module, watch-driven resilience, CRD-programmability via SchemaDef+reconciler, uniform state-backplane); audit-rubric checks each |
| F4 | **PROBE** | Companion features carved out — architect TODO at mission-close to file 4 follow-on ideas (resourceVersion + audit + FK + cloud-deploy) | Phase 10 Retrospective gate: verify follow-on ideas filed before mission-close per `mission-lifecycle.md` |

---

## §7 Sequencing / cross-mission considerations

### §7.1 Branch + PR strategy

- **Branch:** `agent-lily/m-hub-storage-substrate` (architect-side branch; engineer counterpart `agent-greg/m-hub-storage-substrate` per peer cross-approval pattern in `multi-agent-pr-workflow.md`)
- **PR cadence:** wave-per-PR cumulative-fold per mission-68 M6 pattern (W0 spike PR → W1 substrate-shell PR → W2 reconciler PR → ...); each PR cumulatively folds prior waves; final ship PR includes all waves
- **Push pre-bilateral round-1 audit** per calibration #59 closure mechanism (a)

### §7.2 Composability with concurrent / pending work

- **bug-93** — structurally closed by this mission (sweeper poll-throttle band-aid made obsolete by watch-driven sweepers); mission-close should close bug-93 with reference to substrate ship-commit
- **idea-121 (API v2.0)** — out-of-scope per AG-5; substrate's new operations may surface as `wrap`/`augment` candidates for idea-121 during downstream Design phase
- **Follow-on missions to file at mission-close** — M-Hub-Storage-ResourceVersion (AG-1), M-Hub-Storage-Audit-History (AG-2), M-Hub-Storage-FK-Enforcement (AG-3), M-Hub-Storage-Cloud-Deploy (AG-4)
- **No concurrent mission conflicts** — mission-78 (M-Missioncraft-v4-Design) is pre-v1.2.0 ship; M-Hub-Storage-Substrate does not touch missioncraft code path; can proceed in parallel
- **CODEOWNERS impact** — `hub/src/storage-substrate/` is a new directory; CODEOWNERS update in scope (substrate-architect ownership)

### §7.3 Same-day compressed-lifecycle candidate?

**NO.** XL mission; substrate-introduction class; multi-wave decomposition (W0-W7); state-migration cutover is dispositive-risk surface. Full Phase 4-7 bilateral audit cycle required per `mission-lifecycle.md` §1; compressed-lifecycle (ratify-direct) is anti-pattern here.

---

## §calibration — Calibration data point

Per `idea-survey.md` §5 (Survey output element) + §15 schema. Captures empirical baseline for methodology-evolution loop per §13 Forward Implications.

- **Director time-cost (minutes):** <integer> (across both Survey rounds)
- **Comparison baseline:** <prior methodology reference OR prior Survey reference>
- **Notes:** <free text — methodology-evolution candidates; novel constraint surfaces; multi-pick observations>

---

## §contradictory — Contradictory multi-pick carry-forward

(Required per `idea-survey.md` §7 + §15 schema **only when contradictory multi-pick detected during architect interpretation**. Otherwise omit this section entirely.)

| Round | Question(s) | Picks | Constraint envelope description |
|---|---|---|---|
| <1\|2> | <Q-N, Q-M> | <letter, letter> | <description of common-satisfiable constraint Director is signaling per §7> |

---

## §8 Cross-references

- **`docs/methodology/idea-survey.md`** v1.0 — canonical Survey methodology (NOT modified by this mission per AG-7; substrate-only scope)
- **`docs/methodology/strategic-review.md`** — Idea Triage Protocol (route-(a) skip-direct applied: Director-direct surfacing + clear scope + no bilateral negotiation needed per `feedback_idea_triage_protocol_skip_criteria.md`)
- **`docs/methodology/mission-lifecycle.md`** §3 — mission-class taxonomy source (substrate-introduction selected)
- **`docs/calibrations.yaml`** — calibration ledger cross-refs (closures-applied + candidates-surfaced; see frontmatter `calibration-cross-refs`)
- **idea-294** — source idea (pre-Survey directional outcomes appended 2026-05-16 ratified bilateral architect-Director discussion)
- **idea-121** (API v2.0) — out-of-scope per AG-5; downstream consumer of substrate's new operations
- **bug-93** — structurally closed by this mission (sweeper poll-throttle band-aid → watch-driven sweepers)
- **`feedback_defer_tool_surface_to_idea_121.md`** — tool-surface scope deferral discipline (anchors AG-5)
- **`feedback_idea_triage_protocol_skip_criteria.md`** — route-(a) skip-direct rationale
- **`feedback_tele_alignment_over_speed.md`** — tele-alignment-over-speed evaluation discipline (applied across pre-Survey + Round-1)
- **`reference_pending_action_queue_disk_inspection.md`** — sibling precedent for on-disk substrate inspection (informs operator-DX expectations carried into Design)

---

— Architect: lily / 2026-05-16 (Phase 3 Survey envelope; Director-ratified 6 picks across 2 rounds; branch-push pre-bilateral round-1 audit per calibration #59 closure mechanism (a))
