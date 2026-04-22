# Phase 1 Cartography — Engineer's Pass 1 (DRAFT for Director review)

**Status:** DRAFT. Per the Phase 1 cadence (engineer draft → Director review → engineer revise → architect tele-alignment critique → Director ratify), this artifact is the engineer's first-pass output awaiting Director feedback before architect critique.
**Author:** greg (engineer, eng-0d2c690e7dd5), 2026-04-22 AEST
**Mission gates verified clear:** mission-40 (M-Session-Claim-Separation) completed 2026-04-22; companion bug-26 + adapter-startup-race shipped (commits 18cde2d, a011fcd, dd1423c, 9e14ff7, e2ce3f8, 83b57e3); review anti-goals §5–8 back to full force.
**Pass-1 scope:** flat inventories (ideas/bugs/missions/teles/threads) + initial per-tele clustering proposal with explicit orphan list. NOT included in Pass 1 (deferred to Pass 2 or architect critique): tele-alignment scoring (1-3 most-aligned per idea), reverse-gap detection authority, deep Built/Ratified/Open audit per direction.
**Output path note:** architect's brief specified `documents/reviews/`; that directory does not exist in this repo. Used existing `docs/reviews/` per project convention (matches handover docs, bug candidates, and architectural-review plan that all live here).

**Companion data:** row-level TSV exports for each entity class are in `docs/reviews/2026-04-phase-1-cartography-data/` (155 ideas, 28 bugs, 40 missions, 11 teles, 246 threads-in-14d-window). Regenerable from GCS state via the procedure in §A1.

---

## ⚠ Major caveat — tele-renumbering invalidates ~50% of pre-existing tele-alignment metadata

The bulk of `audit:tele_primary=tele-N` tags on existing ideas were authored during the **M-Ideas-Audit** mission (mission-30, 2026-04-19) which referenced the **previous 9-tele numbering**. The 2026-04-21 ratification of **idea-149** (filed via thread-244) replaced that with the **current 11-tele set** (tele-0 umbrella + tele-1 through tele-10), with substantial renumbering AND re-scoping.

Examples of the disruption (informal mapping; architect should ratify the canonical map):

| Old tele | Old name | New tele | Notes |
|---|---|---|---|
| old tele-2 | Frictionless Agentic Collaboration | new tele-6 | name preserved, ID changed |
| old tele-4 | Resilient Agentic Operations | new tele-7 | name preserved, ID changed |
| old tele-7 | Perfect Contextual Hydration | new tele-5 | renamed to "Perceptual Parity", broader |
| old tele-8 | Autopoietic Evolution | new tele-10 | name preserved, ID changed |
| (none) | — | new tele-3 | Sovereign Composition (new) |
| (none) | — | new tele-4 | Zero-Loss Knowledge (new) |
| (none) | — | new tele-8 | Gated Recursive Integrity (new) |

For Pass 1 I treat audit-tagged alignments as **provisional signal pending architect remapping**. Ideas filed AFTER 2026-04-21 use the new numbering directly. Where the audit-tagged tele-N obviously misaligns with the new tele-N's scope, I flag it inline.

---

## 1. Flat inventories (summary; row-level in TSVs)

### 1.1 Ideas (155 total)

| Status | Count |
|---|---|
| open | 112 |
| triaged | 14 |
| dismissed | 27 |
| incorporated | 2 |

By author role:

| Role | Count |
|---|---|
| engineer | 71 |
| architect | 49 |
| unknown (legacy-pre-provenance) | 23 |
| system | 10 |
| director | 2 |

**Linkage observations:**
- Ideas with `missionId` set: **2** (the field is rarely populated; mission lineage flows via tags + `sourceThreadSummary` instead)
- Ideas with `sourceThreadId` set: **15** (cascade-spawned from converged threads)

**Row-level:** `docs/reviews/2026-04-phase-1-cartography-data/ideas-metadata.tsv` (id, status, tags, sourceThreadId, missionId, createdBy.role, createdAt[date]).

### 1.2 Bugs (28 total)

| Status | Count |
|---|---|
| resolved | 14 |
| open | 13 |
| investigating | 1 |

| Severity | Count |
|---|---|
| critical | 2 (bug-10 RESOLVED, bug-11 OPEN) |
| major | 7 |
| minor | 19 |

**Open/investigating bugs (architect should triage cluster vs immediate-fix):**

| ID | Severity | Class | Title (truncated) |
|---|---|---|---|
| bug-11 | critical | cognitive | Architect LLM tool-round exhaustion — cognitive-layer silence (bug-10 fix was transport-only) |
| bug-25 | major | delivery-truncation | Thread message delivery truncation reproducible at ~10–15KB |
| bug-24 | major | missing-feature | No retirement primitive for teles — `create_tele` immutable, no delete/supersede |
| bug-23 | minor | race | Thread bilateral-seal race — engineer reply rejected after architect cascade-converge |
| bug-12 | minor | drift | threads-2-smoke.test.ts — PolicyLoopbackHub missing ADR-017 stores |
| bug-13 | minor | (empty) | list_tasks sort on `id` is lexicographic, not numeric |
| bug-21 | minor | schema-validation-gap | task-313 chunkReplyMessage splits on UTF-16 code units (surrogate-pair corruption) |
| bug-22 | minor | missing-feature | task-314 continuation resume lacks retry limit / escalation |
| bug-27 | minor | drift | propose_mission cascade handler drops payload.documentRef |
| bug-28 | minor | dag-scheduling | Task DAG dep-eval: dependsOn against already-completed task → blocked |
| bug-2 | minor | (empty) | DAG Retroactive Unblocking |
| bug-3 | minor | architect-amnesia | Context Desynchronization |
| bug-4 | minor | (empty) | OpenCode Plugin syncTools hashes names not schemas |
| bug-6 | minor | (empty) | get_task cannot retrieve historical tasks |

**Resolution-tracking shape:** only **bug-26 → mission-40** has `linkedMissionId` set; the remaining 13 resolved bugs encode resolution via `fixCommits[]`. This makes mission-vs-bug-vs-commit linkage non-uniform — worth standardizing in a follow-up.

**Row-level:** `bugs-metadata.tsv`.

### 1.3 Missions (40 total)

| Status | Count |
|---|---|
| proposed | 33 |
| active | 4 |
| completed | 2 |
| abandoned | 1 |

**Active missions:**

| ID | Title | Tasks |
|---|---|---|
| mission-24 | M-Phase2-Impl: Implement Phase 2 Threads 2.0 | 21 |
| mission-25 | M-SandwichHardening: Architect resilience + sandwich harness | 7 |
| mission-36 | Mission Phase 2d: Threads 2.0 Robustness Audit | 0 |
| mission-38 | M-Hypervisor-Adapter-Mitigations | 2 (task-310, task-314) |

**Completed:** mission-17 (Claude Code Integration), mission-40 (M-Session-Claim-Separation, 2026-04-22).
**Abandoned:** mission-20 (Entity Registry SSOT — superseded by mission-21).

**Mission-numbering churn (see §4.2):** 9 of the 40 carry a `documentRef`; multiple share titles (4 different "M-Cognitive-Hypervisor Phase 1" entries, 2 different "M-Hypervisor-Adapter-Mitigations" entries). `Mission.ideas[]` is rarely populated (only mission-21 has 2 idea links).

**Row-level:** `missions-metadata.tsv`.

### 1.4 Teles (11 total — Director-ratified 2026-04-21)

| ID | Name |
|---|---|
| tele-0 | Sovereign Intelligence Engine (umbrella) |
| tele-1 | Sovereign State Transparency |
| tele-2 | Isomorphic Specification |
| tele-3 | Sovereign Composition |
| tele-4 | Zero-Loss Knowledge |
| tele-5 | Perceptual Parity |
| tele-6 | Frictionless Agentic Collaboration |
| tele-7 | Resilient Agentic Operations |
| tele-8 | Gated Recursive Integrity |
| tele-9 | Chaos-Validated Deployment |
| tele-10 | Autopoietic Evolution |

bug-24 (no retirement primitive for teles) currently blocks formal retirement of the 5 superseded pre-rewrite teles. GCS canonical set at `gs://ois-relay-hub-state/tele/` shows 11 entries — the rewrite was applied as an additive overwrite, not via a retirement primitive.

**Row-level:** `teles-metadata.tsv`.

### 1.5 Threads (246 in 14-day window; 381 total in collection)

| Status (14d) | Count |
|---|---|
| closed | 188 |
| active | 56 |
| round_limit | 2 |

**56 active threads — composition:**
- **16 × `Phase 2x N=20 — *`** measurement-harness threads stuck at roundCount=2, currentTurn=engineer (abandoned-by-design from 2026-04-20 measurement work; reaper hasn't claimed them — see §4.5)
- thread-228 "Unicast comms smoke test v2 — architect → kate/dev" (round 3)
- thread-243 "Ratified tele audit — file 7 new teles; 5 retirements blocked on bug-24" (round 6, currentTurn engineer eng-2c249473aa50 = kate)
- thread-137 "Threads 2.0 design doc + test README review" (round 2)
- the rest are scattered older bilateral-seal threads in various states

**Row-level:** `threads-14d-metadata.tsv`.

---

## 2. Per-tele clustering (initial; status=open OR triaged only; dismissed excluded)

For each tele, ideas are grouped by:
- **(a) Direct evidence** — post-2026-04-21 ideas tagged with new tele-N (trustworthy)
- **(b) Provisional from audit signal** — pre-rewrite ideas with `audit:tele_primary=tele-N` (numbering may have shifted; see §0 caveat)

### tele-0 — Sovereign Intelligence Engine (umbrella)
- **(a) direct:** none (umbrella by definition; aggregates the others)
- **(b) audit signal:** none
- **Cluster size:** 0 (expected — no idea targets the umbrella directly)

### tele-1 — Sovereign State Transparency
- **(a) direct:** idea-154, idea-155 (both tagged `tele-1-observability`)
- **(b) audit signal (legacy tele-1 was narrower persistence scope; semantic overlap):** idea-39, idea-97
- **Cluster size: 4**

### tele-2 — Isomorphic Specification
- **(a) direct:** idea-107, idea-108, idea-112, idea-129 (also tele-5), idea-132 (triaged), idea-134 (also tele-4/7/8), idea-135, idea-136, idea-138 (multi-tele)
- **(b) audit signal (LIKELY MISALIGNED — old tele-2 = "Frictionless"; should map to new tele-6):** idea-20, idea-25, idea-30, idea-50, idea-68, idea-73, idea-79, idea-90, idea-91, idea-92
- **Cluster size: 19** (10 likely belong in tele-6 instead — flagged for architect remap)

### tele-3 — Sovereign Composition
- **(a) direct:** idea-113, idea-114, idea-120 (triaged), idea-130 (also tele-5)
- **(b) audit signal (old tele-3 meaning unverified; remap suspect):** idea-103, idea-24, idea-46, idea-60, idea-63, idea-94, idea-95
- **Cluster size: 11**

### tele-4 — Zero-Loss Knowledge
- **(a) direct:** idea-109, idea-134 (also tele-2/7/8)
- **(b) audit signal (LIKELY MISALIGNED — old tele-4 = "Resilient"; should map to new tele-7):** idea-105, idea-106, idea-15, idea-18, idea-33, idea-54, idea-55, idea-6, idea-74, idea-78, idea-93, idea-96, idea-98, idea-99
- **Cluster size: 16** (14 likely belong in tele-7 instead — flagged for architect remap)

### tele-5 — Perceptual Parity (new name; absorbs old tele-7 Hydration concept)
- **(a) direct:** idea-130 (also tele-3), idea-131
- **(b) audit signal (old tele-5 meaning unverified):** idea-102, idea-48, idea-66, idea-69, idea-80, idea-81, idea-82, idea-83, idea-85
- **Cluster size: 11**

### tele-6 — Frictionless Agentic Collaboration (new ID for the old tele-2 concept)
- **(a) direct:** idea-110, idea-111, idea-137
- **(b) audit signal:** none directly (the audit's old tele-2 corresponds here; see tele-2 cluster which has 10 misaligned candidates that likely belong here)
- **Cluster size: 3 direct (UNDERESTIMATE — would jump to ~13 after remap from tele-2)**

### tele-7 — Resilient Agentic Operations (new ID for the old tele-4 concept)
- **(a) direct:** idea-133, idea-139 (tagged tele-outcome-axis with tele-7 secondary)
- **(b) audit signal (LIKELY MISALIGNED — old tele-7 was Hydration; should map to new tele-5):** idea-11, idea-13, idea-35, idea-45, idea-56, idea-58, idea-61, idea-64, idea-65, idea-70, idea-72
- **Cluster size: 13** (11 likely belong in tele-5 instead; tele-7 itself would absorb candidates flagged in tele-4 cluster — net direction is large rebalance)

### tele-8 — Gated Recursive Integrity (NEW; no semantic predecessor)
- **(a) direct:** none directly tagged
- **(b) audit signal:** none (audit's old tele-8 = old "Autopoietic", which maps to new tele-10 not tele-8)
- **Cluster size: 0** ⚠ **REVERSE-GAP CANDIDATE** — no forward-motion ideas attributable. Architect critique should confirm whether this is genuinely empty (and propose seed ideas) or whether unfiled/under-tagged candidates exist in the orphan list.

### tele-9 — Chaos-Validated Deployment
- **(a) direct:** idea-131, idea-133 (also tele-7/8), idea-135 (also tele-2/7), idea-136 (multi), idea-137 (also tele-6/8), idea-138 (multi), idea-139 (multi)
- **(b) audit signal (old tele-9 was "Determinism" — partial overlap):** idea-23, idea-27, idea-43, idea-5, idea-62, idea-67, idea-71, idea-84, idea-86
- **Cluster size: 16**

### tele-10 — Autopoietic Evolution (new ID for old tele-8)
- **(a) direct:** idea-116 (proposes tele-10 itself, predates the new numbering's ratification), idea-119 (`tele-10-adjacent`), idea-121 (tagged `tele-10`)
- **(b) audit signal (audit's old tele-8 maps here):** idea-14
- **Cluster size: 4**

---

## 3. Orphans — open/triaged ideas with no tele alignment signal of any form

The following 33 ideas carry no `audit:tele_primary` and no post-rewrite `tele-N` tag. Listed for architect critique. Several are recent vocabulary-cluster ideas where multi-tele applicability was deliberately deferred at filing time.

**Recent (post-mission-30, vocabulary/strategic cluster):**
- idea-115 — dynamic tool exposure design space
- idea-117 (triaged) — bounded-retry policy for Hub queue
- idea-118 — cross-item circuit breaker
- idea-122 — `reset_agent` operator affordance
- idea-123 (triaged), idea-124, idea-125, idea-126, idea-127, idea-128 — *not yet read in detail; scope inferred from filing pattern*
- idea-140, 141, 142, 143 — concept-candidate ideas (the Tele↔Concept↔Idea pattern triangle pieces)
- idea-144 (triaged) — workflow engine review→next-task advancement (supersedes bug-20)
- idea-145 — task-313 Chunked Reply v2
- idea-146 — task-314 continuationState v2
- idea-147 — first-class `rule` entity (project-level policy/convention layer)
- idea-148 — *inferred from idea-149's reference: source of new-tele-set proposal*
- idea-149 — tele audit ratification (the 2026-04-21 rewrite itself)
- idea-150, 151 — *not yet read*
- idea-152 — Smart NIC Adapter (target-state architecture; absorbs identity + transport layers)
- idea-153 — *not yet read*

**Pre-existing triaged ideas (bug-migration legacy):**
- idea-19, 22, 28, 29, 40, 41, 57, 88, 89 (all triaged) — the original "bug" Ideas migrated to first-class Bug entities; scope now lives in linked Bug record. Architect may want to dismiss these as fully-superseded.

---

## 4. Cross-cutting observations (engineer's draft notes — Director feedback solicited)

### 4.1 Tele-rewrite invalidated ~50% of pre-existing alignment metadata
86 of 155 ideas carry `audit:tele_primary` tags from the M-Ideas-Audit (2026-04-19), all using the pre-rewrite 9-tele numbering. The 2026-04-21 11-tele set ratified via idea-149 changed both IDs and scopes. This is the single largest cartography ambiguity. Options:
- (a) Engineer attempts heuristic remap based on idea text + new tele descriptions (risk: wrong; benefit: gives architect a starting point to critique)
- (b) Defer entirely to architect critique step; leave audit signal as "stale flag"
- (c) Re-run a focused mini-audit (subset: just tele-alignment refresh) before Pass 2

Question 1 in §6 below.

### 4.2 Mission-numbering chaos
40 mission entities exist; some observations:
- **mission-31, 32, 33, 34** are all titled "M-Cognitive-Hypervisor Phase 1" — duplicate proposals from different threads, none executed
- **mission-37 + 38** both "M-Hypervisor-Adapter-Mitigations" (38 active, 37 zombie proposed)
- **mission-27 + 28** are "(MissionN-Activation)" entries for missions 24/25 (cascade-staging artifacts that became their own entities)
- Hub-entity-id vs commit/document-id offsets are pervasive: mission-18 = "Mission-19 Granular Routing"; mission-21 = "Mission-22 Entity Registry"; mission-22 = "Mission-21 Multi-action Convergence"; etc.

Counting "missions" by entity ID overstates the number of distinct initiatives. Worth a deduplication sweep — but probably out of cartography scope; flag for post-review hardening.

### 4.3 Vocabulary-chain cluster (ideas 129–139, 154–155)
The post-2026-04-21 idea-flow has been heavily focused on building the Concept→Idea→Design→Manifest→Mission vocabulary chain entities:
- **idea-133** Concept entity
- **idea-134** Trace + Report entity
- **idea-135** Survey entity
- **idea-136** Routine entity
- **idea-137** Evaluation framework
- **idea-138** Cost-aware tier routing
- **idea-139** Goal entity (project-level objective)
- **idea-130** Manifest entity
- **idea-129** Design entity
- **idea-131** Registry entity
- **idea-140-143** concept-candidates harvested from idea-139 work

Plus observability/onboarding satellites idea-154 + idea-155.

These form a coherent multi-idea direction worth treating as a cluster regardless of per-idea tele alignment. Architect critique step can decide whether to flag this as a unified "vocabulary chain" cross-tele initiative.

### 4.4 Built / Ratified / Open per major architectural direction (initial sketch — needs Pass 2 deepening)

| Direction | Status | Evidence |
|---|---|---|
| Threads 2.0 (ADR-013/014) | **Built** | mission-22, mission-23, mission-24 shipped; bug-23 (bilateral-seal race) outstanding |
| ADR-017 comms-reliability (queue + persist-first) | **Built** | mission-30 ran on it; bugs 11/22/23 are post-hardening artifacts |
| Identity layer (Mission-18/19 + bug-16 + mission-40) | **Built** | mission-40 closed 2026-04-22; identity/session-claim separation now structural |
| Cognitive layer ADR-018 / @ois/cognitive-layer | **Built (Phase 1)** | mission-31/32/33/34 dups proposed; cognitive layer package exists |
| M-Cognitive-Hypervisor multi-phase (2a/2b/2c/2x/2d) | **Active** | Phase 2x N=20 measurement closed; mission-38 active for adapter mitigations |
| Tele rewrite (idea-149) | **Ratified, partially built** | 11 teles in GCS; 5 zombie pre-rewrite entries persist (bug-24 blocks retirement) |
| Vocabulary chain (Concept→Idea→Design→Manifest→Mission) | **Ratified, NOT built** | Ideas 129–139, 154–155 filed; no entity implementations yet |
| Smart NIC Adapter (idea-152) | **Open / target-state** | No implementation work; absorbs identity + transport layers |
| Rule entity (idea-147) | **Open** | Filed; awaiting triage |
| Goal entity (idea-139) | **Ratified scope, NOT built** | Project-level scope decided 2026-04-21; entity not yet implemented |

This table should grow significantly in Pass 2 after Director feedback on the cartography shape.

### 4.5 Active threads needing reaping
56 active threads in 14d window, but 16 are abandoned-by-design Phase 2x measurement-harness threads stuck at roundCount=2. The thread reaper appears to not be claiming them (possibly because they're under the idle-expiry threshold given their recent recreation, or because of an interaction with the 2026-04-20 measurement workflow's manual-close discipline).

Not in cartography scope; flag for post-hardening.

---

## 5. Convergence-criteria self-check (vs architect's Phase 1 brief)

| Criterion | Status |
|---|---|
| Every open idea in ≥1 cluster | ❌ 33 orphans (Section 3) — pending architect critique |
| Every tele populated (≥1 aligned idea) OR flagged reverse-gap | ⚠️ tele-0 (umbrella, expected empty) and tele-8 (Gated Recursive Integrity, candidate REVERSE-GAP) — others nominally populated but with significant audit-tag misalignment to remap |
| Built/Ratified/Open split per major direction | ⚠️ Sketch in §4.4; needs Pass 2 deepening |

**Bottom line:** Pass 1 deliverable provides the inventory + the clustering scaffolding + an explicit ambiguity register. The convergence criteria are NOT yet met; that's the work of the cadence loop (Director review → engineer revise → architect critique).

---

## 6. Open questions for Director

1. **Tele-rewrite remapping authority.** Should the engineer attempt heuristic remapping of audit-tagged ideas (old-tele-N → new-tele-M) based on idea text + new tele descriptions, or defer entirely to architect critique? My instinct: defer — the architect owns tele alignment authoritatively, and a heuristic remap risks anchoring biases.
2. **Mission-numbering cleanup scope.** Out-of-scope for cartography; do you want it filed as a separate post-review hardening item, or absorbed into the broader review's anti-goals exception list?
3. **Reverse-gap flag bar.** My read: a "reverse-gap tele" has zero forward-motion ideas attributable in the new numbering. tele-0 (umbrella, expected empty) and tele-8 (Gated Recursive Integrity, candidate) are the only zero-cluster teles by direct evidence; the others all have ≥1 candidate when audit-tag remapping is treated optimistically. Confirm this is the right bar.
4. **Phase 2x measurement-thread reaping (16 stuck threads).** Sweep them as part of cartography revision (would clean up the active-thread count for accuracy), or defer to post-hardening?
5. **Pass 1 sufficiency.** Is the inventory + clustering scaffolding + ambiguity register enough for Pass 1, or do you want me to attempt the heuristic remap (per Q1) before architect critique?

---

## A1. Reproduction procedure (data-gathering audit trail)

Pass 1 data was extracted directly from GCS to bypass MCP pagination caps (the proxy enforces ~10 items per `list_*` response regardless of `limit`):

```bash
mkdir -p /tmp/cartography-pass1 && cd /tmp/cartography-pass1
gcloud storage cp -r \
  gs://ois-relay-hub-state/{ideas,bugs,missions,tele,threads}/ ./

# Idea metadata projection
jq -r '[.id, .status, (.tags // [] | join("|")), (.sourceThreadId // ""), (.missionId // ""), (.createdBy.role // "unknown"), .createdAt[0:10]] | @tsv' \
  ideas/*.json | sort > ideas-metadata.tsv

# Bug projection
jq -r '[.id, .status, .severity, (.class // ""), (.tags // [] | join("|")), (.fixCommits // [] | length | tostring), (.linkedMissionId // ""), .createdAt[0:10]] | @tsv' \
  bugs/*.json | sort > bugs-metadata.tsv

# Mission projection
jq -r '[.id, .status, ((.tasks // []) | length | tostring), (.documentRef // ""), (.sourceThreadId // ""), (.correlationId // ""), .createdAt[0:10], (.title[0:80])] | @tsv' \
  missions/*.json | sort > missions-metadata.tsv

# Threads (filtered to 14d window)
jq -r 'select(.createdAt >= "2026-04-08T00:00:00Z") | [.id, .status, .routingMode, (.currentTurn // ""), ((.roundCount // 0) | tostring), (.outstandingIntent // ""), (.correlationId // ""), .createdAt[0:10], (.title[0:80])] | @tsv' \
  threads/*.json | sort > threads-14d-metadata.tsv
```

Outputs persisted to `docs/reviews/2026-04-phase-1-cartography-data/`. Regeneration is idempotent against current Hub GCS state.

---

*End of Pass 1 draft. Awaiting Director feedback before architect tele-alignment critique.*
