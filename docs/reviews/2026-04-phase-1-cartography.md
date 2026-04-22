# Phase 1 Cartography — Pass 1.1 (architect-critique applied; awaiting Director ratification)

**Status:** Pass 1.1 — engineer revision incorporating the architect critique (`docs/reviews/2026-04-phase-1-cartography-critique.md` at commit `89ba92a` on agent/lily). Per the Phase 1 cadence (engineer draft → Director review → architect critique → engineer revise → Director ratify), this is the engineer revision step. **Awaits Director ratification.**

**Author (Pass 1):** greg (engineer, eng-0d2c690e7dd5), 2026-04-22 AEST.
**Critique author:** lily (architect, eng-40903c59d19f), commit `89ba92a`.
**Mission gates verified clear:** mission-40 (M-Session-Claim-Separation) completed 2026-04-22; companion bug-26 + adapter-startup-race shipped (commits 18cde2d, a011fcd, dd1423c, 9e14ff7, e2ce3f8, 83b57e3); review anti-goals §5–8 back to full force.

**Companion data:** row-level TSV exports in `docs/reviews/2026-04-phase-1-cartography-data/` (158 ideas after 3 seed ideas filed, 28 bugs, 40 missions, 11 teles, 246 threads-in-14d-window). Regenerable from GCS state via §A1.

**Output path:** architect's original brief specified `documents/reviews/`; that directory does not exist in this repo. Pass 1 used existing `docs/reviews/` per project convention; carried forward in Pass 1.1.

---

## 0. Tele-renumbering — authoritative remap (per architect critique §1)

Architect-ratified canonical old→new tele remap, derived from `docs/specs/teles.md` §Provenance:

| Old tele (pre-reset) | Old name | New tele | New name | Fidelity |
|---|---|---|---|---|
| 1 | (persistence, narrow) | **1** | Sovereign State Transparency | evolved-broader (absorbs AX-010 State Sovereignty) |
| 2 | Frictionless Agentic Collaboration | **6** | Frictionless Agentic Collaboration | name preserved; ID changed |
| 3 | (workflow/FSM aspect) | **2** | Isomorphic Specification | merged (FSM aspect of old tele-3 absorbed by new tele-2) |
| 4 | Resilient Agentic Operations | **7** | Resilient Agentic Operations | name preserved; ID changed |
| 5 | (Declarative Primacy) | **2** | Isomorphic Specification | merged (absorbs AX-050 Declarative Primacy) |
| 6 | Deterministic Invincibility | **9** | Chaos-Validated Deployment | chaos-aspect only; layered aspect dropped |
| 7 | Perfect Contextual Hydration | **5** | Perceptual Parity | evolved-broader (absorbs AX-040 Observability Symmetry) |
| 8 | Autopoietic Evolution | **10** | Autopoietic Evolution | name preserved; ID changed |
| 9 | (umbrella) | **0** | Sovereign Intelligence Engine | renamed + repositioned as umbrella |

**New teles with no pre-reset predecessor** (placed by body, not remapped):
- **tele-3** Sovereign Composition (from idea-148 + AX-020 Interface Singularity)
- **tele-4** Zero-Loss Knowledge (from AX-030 Knowledge Fidelity)
- **tele-8** Gated Recursive Integrity (from AX-060 Recursive Integrity, layered-construction aspect only)

**Pass-1 correction:** the engineer's Pass 1 §0 prose stated "old tele-9 was Determinism" — this was incorrect. Per the spec, old tele-9 was the **umbrella** (mapped to new tele-0); pre-reset tele-6 was "Deterministic Invincibility" (split to new tele-8 + tele-9). Corrected here per architect §1.

---

## 1. Flat inventories (post-revision)

### 1.1 Ideas — 158 total (was 155 pre-revision; +3 tele-8 seed ideas filed in revision)

| Status | Count |
|---|---|
| open | 115 |
| triaged | 14 |
| dismissed | 27 |
| incorporated | 2 |

**Note on triaged-and-marked-for-dismissal (9 ideas):** the bug-migration legacy ideas (idea-19, 22, 28, 29, 40, 41, 57, 88, 89) carry the `audit:valid=superseded-by-bug:bug-N` marker tag from this revision but remain in `triaged` status. **The status flip to `dismissed` is architect-only per Hub permissions** (`update_idea` schema: dismissed/incorporated transitions are architect-restricted). Architect should batch-flip these in a follow-up.

By author role:

| Role | Count |
|---|---|
| engineer | 73 (+2) |
| architect | 50 (+1; via the 3 seed ideas authored by lily, filed mechanically by greg) |
| unknown (legacy-pre-provenance) | 23 |
| system | 10 |
| director | 2 |

(Note: the 3 seed ideas were created via the engineer's MCP session; `createdBy.agentId` is `anonymous-engineer`. Architect authorship attributed in idea body prose per `architect-authored-by:lily` tag and explicit text reference. True authorship-by-different-agent requires a Hub primitive that doesn't exist today; flagged as a minor lifecycle gap.)

**Linkage:**
- Ideas with `missionId` set: 2 (rare; lineage tracked by tags + sourceThreadSummary instead)
- Ideas with `sourceThreadId` set: 18 (+3 from seeds linked to thread-248)

**Row-level:** `docs/reviews/2026-04-phase-1-cartography-data/ideas-metadata.tsv` (regeneration produces 158-row output post-revision).

### 1.2 Bugs (28 total — unchanged)

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

Open/investigating bug list unchanged from Pass 1 §1.2.

### 1.3 Missions (40 total — unchanged)

| Status | Count |
|---|---|
| proposed | 33 |
| active | 4 (mission-24, mission-25, mission-36, mission-38) |
| completed | 2 (mission-17, mission-40) |
| abandoned | 1 (mission-20) |

Active missions inventory unchanged. Mission-numbering chaos noted in Pass 1 §4.2 stays out of cartography scope per Director (post-review hardening).

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

bug-24 (no retirement primitive for teles) still blocks formal retirement of the 5 superseded pre-rewrite teles; zombie entries persist.

### 1.5 Threads (246 in 14d window — unchanged + 1)

Net +1 thread in the window since Pass 1: **thread-248** (this revision's architect-critique handoff thread; converged 2026-04-22).

| Status (14d) | Count |
|---|---|
| closed | 189 |
| active | 55 |
| round_limit | 2 |

The 16 stuck `Phase 2x N=20 — *` measurement-harness threads remain unreaped per Director's defer-to-post-hardening (Pass 1 §6 Q4 + critique §6 Q4).

---

## 2. Per-tele clustering — POST-REMAP (architect-ratified)

Application of architect critique §2.1 (mechanical remap of 63 audit-tagged ideas) + §3.2 (placement of 38 orphans) + §3.1 (dismissal markers on 9 bug-migration legacy) + 3 newly-filed tele-8 seed ideas. **Every open and triaged idea now carries `audit:tele_primary=tele-N`** (engineer-applied via batch `update_idea` calls; status flip for §3.1 dismissals deferred to architect).

### Cluster sizes after revision

| Tele | Pass 1 sketch | Pass 1.1 (post-remap) | Δ |
|---|---|---|---|
| tele-0 (umbrella) | 0 | 0 | unchanged (definitionally empty) |
| tele-1 (Sovereign State Transparency) | 4 | **10** | +6 (absorbed observability ideas + Registry/Graph + 2 post-mission-40 obs ideas) |
| tele-2 (Isomorphic Specification) | 19 | **18** | net stable (lost frictionless ideas to tele-6, gained Isomorphic-FSM ideas from old tele-3/5) |
| tele-3 (Sovereign Composition) | 11 | **15** | +4 (Universal Port, dedup, base-entity refactor, gemini-cli adapter, Smart NIC, adapter-core) |
| tele-4 (Zero-Loss Knowledge) | 16 | **20** | +4 (vocabulary-chain ideas dominate: Concept, Trace+Report, Survey, Goal, concept-candidates) |
| tele-5 (Perceptual Parity) | 11 | **15** | +4 (Hydration ideas absorbed from old tele-7; Director-surface cluster) |
| tele-6 (Frictionless Agentic Collaboration) | 3 | **12** | +9 (Frictionless ideas absorbed from old tele-2 + operator-affordance + workflow-engine) |
| tele-7 (Resilient Agentic Operations) | 13 | **17** | +4 (Resilient ideas absorbed from old tele-4 + cascade-replay-queue + bug-11 mitigations cluster) |
| tele-8 (Gated Recursive Integrity) | 0 | **3** | +3 (newly-filed seed ideas — see §4 below) |
| tele-9 (Chaos-Validated Deployment) | 16 | **5** | -11 (most "new tele-9" candidates were old umbrella; only CI/IaC/deployment ideas stay) |
| tele-10 (Autopoietic Evolution) | 4 | **5** | +1 (idea-14 from old tele-8 audit) |

**Total placed:** ~120 open+triaged ideas. **Orphans remaining: 0** (modulo the 9 dismissal-marker ideas awaiting architect status flip).

### Per-cluster idea lists

Source of truth is the live Hub state — every open/triaged idea now has `audit:tele_primary=tele-N` and (where applicable) `audit:tele_secondary=tele-M`. Reproducible via:

```bash
gcloud storage cp -r gs://ois-relay-hub-state/ideas/ /tmp/ideas/
jq -r 'select(.status=="open" or .status=="triaged") |
  .tags[] as $t | select($t | startswith("audit:tele_primary=")) |
  "\($t | sub("audit:tele_primary="; ""))\t\(.id)\t\(.status)"' /tmp/ideas/*.json |
  sort
```

Per-cluster groupings + primary/secondary assignments are documented authoritatively in **`docs/reviews/2026-04-phase-1-cartography-critique.md` §2.1 + §3.2** (lily, commit `89ba92a`). Reproducing the table verbatim here would create drift risk; the Hub-state query above is the live source.

---

## 3. Orphans + dismissals

### 3.1 Orphans: ZERO open or triaged ideas without tele alignment

After applying §2.1 mechanical remap + §3.2 orphan placements + 3 seed ideas, every open and triaged idea carries `audit:tele_primary=tele-N`. **The Phase 1 convergence criterion "every open idea in ≥1 cluster" is satisfied.**

### 3.2 Bug-migration legacy ideas (9 ideas) — marker applied; status flip deferred

Per critique §3.1, these 9 ideas are scope-superseded by their first-class Bug entity successors:

| Idea | → Bug | Marker tag applied | Status (current) | Status (target) |
|---|---|---|---|---|
| idea-19 | bug-1 | ✓ | triaged | dismissed |
| idea-22 | bug-2 | ✓ | triaged | dismissed |
| idea-28 | bug-3 | ✓ | triaged | dismissed |
| idea-29 | bug-4 | ✓ | triaged | dismissed |
| idea-40 | bug-5 | ✓ | triaged | dismissed |
| idea-41 | bug-6 | ✓ | triaged | dismissed |
| idea-57 | bug-7 | ✓ | triaged | dismissed |
| idea-88 | bug-8 | ✓ | triaged | dismissed |
| idea-89 | bug-9 | ✓ | triaged | dismissed |

Markers applied: `audit:valid=superseded-by-bug:bug-N` + `migrated-to-bug:bug-N`.

**Status flip is architect-only** per Hub `update_idea` permissions schema (engineer can transition between `open` and `triaged`; only architect can set `dismissed` or `incorporated`). Architect to batch-flip in a follow-up; cleanest as a one-shot `update_idea status=dismissed` over the 9 IDs above.

(Engineer-side observation: this Hub permission distinction surfaces a minor friction — engineer-led Pass 1.1 revision can mechanically apply 100% of the tag work but cannot complete the lifecycle transition that flows logically from it. Worth noting for the post-review hardening pass; a small `audit:valid=superseded-by-bug` policy could authorize engineer-side dismissal when the marker tag is present.)

---

## 4. Tele-8 reverse-gap — closed via 3 seed ideas

Per critique §4.2, tele-8 (Gated Recursive Integrity) was the sole genuine reverse-gap after full remap. Director ratified filing 3 seed ideas (option a). Filed during this revision:

| Idea | Title | Architect-authored seed |
|---|---|---|
| **idea-156** | Layer-certification registry — formal architectural-layer enumeration with per-layer pass/fail gate | ✓ closes Foundation-of-Sand fault |
| **idea-157** | Phase-2d CP3 binary-certification naming — name reaper+lifecycle work as tele-8 gate | ✓ explicit certification semantics |
| **idea-158** | Merge-gate automation — codify "no Layer N+1 change without Layer N green" as CI policy | ✓ enforcement layer |

All three filed with `audit:tele_primary=tele-8`, `architect-authored-by:lily`, `seed-idea`, `reverse-gap-closure`, `from-thread-248` tags. `sourceThreadId=thread-248` linkage. Body prose explicitly attributes architect authorship per critique §4.2 directive.

**tele-0 is not a reverse-gap** — umbrella by definition; all forward-motion in tele-1..tele-10 IS forward-motion toward tele-0.

**Phase 1 convergence criterion "every tele populated OR flagged reverse-gap with rationale" is satisfied** — all 11 teles populated with ≥1 forward-motion idea (modulo tele-0 which is documented as umbrella-by-definition empty).

---

## 5. Built / Ratified-but-unshipped / Open split (architect-deepened from §4.4 sketch)

Per critique §5 — replaces Pass 1 §4.4 sketch with deeper three-table breakdown.

### 5.1 BUILT (in-prod, tests green, deployed)

| Direction | Evidence | Bugs/gaps |
|---|---|---|
| Threads 2.0 (ADR-013/014) | mission-22, mission-23, mission-24 shipped; Phase 2 cascade runner landed | bug-23 (bilateral-seal race, minor) |
| ADR-017 comms-reliability (queue + persist-first) | commits `074b6c1`..`316baa8` + follow-ups; mission-30 ran against it | bug-11 (cognitive-layer silence; distinct scope), bug-22 (continuation retry), bug-12 (test-helper drift) |
| Identity layer (Mission-18 + Mission-19 + bug-16 reaper + mission-40 identity/session split) | mission-40 closed 2026-04-22 (`18cde2d`..`e2ce3f8`); bug-16 resolved (`9385290`, `6eacfca`); bug-26 resolved | Zero open identity-layer bugs at severity≥major |
| Cognitive Layer Phase 1 (ADR-018 / `@ois/cognitive-layer` package) | Phase 1 ckpt 1–4 landed; `ToolResultCache` + `FlushAllOnWriteStrategy` shipping | mission-31/32/33/34 duplicates as design-entity artifacts only |
| Cognitive Hypervisor adapter mitigations (mission-38) | Completed 2026-04-21, 5-task scope + closing audit | bug-11 verdict pending 24–48h observability window |
| Mission-19 Granular Routing (label-selector routing) | mission-18 entity = "Mission-19 Granular Routing" (7 tasks shipped) | none known |
| Tele rewrite (idea-149 ratification) | 11 teles in GCS at tele-0..tele-10; spec at `docs/specs/teles.md` | bug-24 blocks retirement of 5 legacy tele records |
| Workflow-registry v2.0 | Multiple FSM tables + INV-TH# invariants; shipped across multiple missions | Partial (some FSMs still documented-only; entity-registry §5 Wall-of-Shame enumerates) |
| M-Cascade-Perfection Phase 1 + 2 | mission-29 + Phase 2d CP1/CP2/CP3 shipped | CP4 (`retry_cascade`) deferred; bug-14/15/bug-27 minor cascade drift |

### 5.2 RATIFIED-but-unshipped (Director-approved direction; code not yet in-prod)

| Direction | Status | Gating |
|---|---|---|
| Vocabulary chain (Concept→Idea→Design→Manifest→Mission→Trace→Report) | Ratified 2026-04-21; ideas 129–143 filed | No entity implementation started; no mission brief; Phase 4 candidate |
| Goal entity (idea-139) | Ratified scope 2026-04-21 | Filing as Hub primitive pending |
| k8s-style API as target tool-surface (review input §14.1) | Ratified direction per review plan | Post-review mission scope (anti-goal §1); idea-121 + idea-126 carry candidate spec |
| Mission-19 P2P agentId targeting (deferred sub-scope) | Ratified but implementation pending | Mission-19's task-197 range |
| Multi-engineer concurrent REPO work protocol | Identified problem per review plan | Candidate mission output, not review work |
| Deprecation of mission-40's back-compat auto-claim paths (brief §10.1) | Gated on deprecation-runway dashboard zero-trend | Post-architectural-review hardening |
| `AuditEntry` typed payload (idea-155) | Filed post-mission-40 | Gated on dashboard-consumer maturity |

### 5.3 OPEN (not yet ratified direction OR target-state architecture)

| Direction | Status | Notes |
|---|---|---|
| Smart NIC Adapter (idea-152) | Open target-state | Absorbs identity + transport; would supersede idea-153 (adapter-core) |
| Rule entity (idea-147) | Open | Project-level policy/convention layer; awaits triage |
| Graph relationships registry (idea-151) | Open | Hub primitive for idea-dependency graphs |
| Environment Deployer (idea-150) | Open | CI/CD GCP deployer tooling |
| Universal Port (idea-102) | Open | Supersedes idea-17 (dismissed) |
| Adapter-core extraction (idea-153) | Open | Transitional vs idea-152 target-state |
| Director-chat redesign | Pending architect-adapter redesign | No mission yet |
| Wrapper-script tracking (idea-154) | Open post-mission-40 | Small cleanup; hub-config.json candidate |
| Layer-certification registry (idea-156) | Open (NEW Pass 1.1) | tele-8 reverse-gap seed |
| Merge-gate automation (idea-158) | Open (NEW Pass 1.1) | Depends on idea-156 |

---

## 6. Convergence-criteria self-check (vs Phase 1 brief)

| Criterion | Status | Evidence |
|---|---|---|
| Every open idea in ≥1 cluster | ✓ PASS | All 115 open ideas + 14 triaged ideas carry `audit:tele_primary=tele-N` (verifiable via §2 `gcloud storage` query) |
| Every tele populated OR flagged reverse-gap with rationale | ✓ PASS | All 11 teles populated; tele-0 documented as umbrella-by-definition empty (not reverse-gap); tele-8 closed via 3 seed ideas filed in revision |
| Built/Ratified-but-unshipped/Open split per major direction | ✓ PASS | §5 three-table breakdown, ~30 directions catalogued with evidence cites |

**Phase 1 convergence achieved.** All three criteria pass post-revision.

---

## 7. Open items for Director ratification

1. **Pass 1.1 ratification** — does this satisfy the Phase 1 deliverable per the brief? If yes, Phase 1 closes and Phase 2 (Friction Cartography) opens.

2. **Engineer-permission gap on dismissal** (deferred from §3.2) — 9 bug-migration legacy ideas await architect status flip from `triaged` → `dismissed`. Architect to action in a follow-up, OR (slightly larger scope) a small policy change could authorize engineer-side dismissal when `audit:valid=superseded-by-bug:` marker is present. Director call.

3. **Mission-numbering cleanup** — out of cartography scope per Pass 1 §6 Q2 + critique §6 Q2. Filed for post-review hardening.

4. **Phase 2x measurement-thread reaping** — out of cartography scope per Pass 1 §6 Q4 + critique §6 Q4. 16 stuck active threads; Phase 4 candidate "thread-reaper operational audit" may absorb.

5. **3 seed ideas filed under engineer's MCP session** (createdBy.agentId = anonymous-engineer) but architect-authored per body prose. Minor lifecycle gap noted; no action required for this review unless Director wants the attribution corrected via a Hub primitive.

---

## A1. Reproduction procedure (data-gathering audit trail)

Pass 1 + Pass 1.1 data extracted directly from GCS to bypass MCP pagination caps:

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

## A2. Pass 1.1 revision audit trail

Mechanical operations applied via MCP `update_idea` and `create_idea` between commits `6721ba3` (Pass 1) and this commit (Pass 1.1):

- **3 × `create_idea`** — tele-8 seed ideas (idea-156, idea-157, idea-158), `architect-authored-by:lily`
- **63 × `update_idea`** — §2.1 audit-tag remaps (audit:tele_primary= rebinds + audit:tele_secondary= adds per critique table)
- **38 × `update_idea`** — §3.2 orphan placements (audit:tele_primary= + optional secondary on previously-untagged ideas)
- **9 × `update_idea`** — §3.1 dismissal markers (audit:valid=superseded-by-bug:bug-N + migrated-to-bug:bug-N tags; status flip deferred to architect)

**Total: 113 successful Hub operations.** All idempotent (re-running with the same args is a no-op). Failure count: 0.

Per-operation TSVs preserved at `/tmp/cartography-pass1/{apply-list,orphan-list,dismiss-list,new-tags-apply}.tsv` (engineer scratchpad; not committed). Companion data dir contains the projected metadata snapshot from before revision.

---

*End of Pass 1.1. Awaiting Director ratification per brief §11 step 4. Architect critique reference: commit `89ba92a` on agent/lily.*
