# Phase 2 Friction Symptoms — Engineer Collection (Pass 2.A + 2.B + 2.C COMPLETE)

**Status:** Pass 2.B (thread content scan) committed — completing the Pass A + B + C symptom-collection trilogy. **All three sources covered; engineer-side Phase 2 input artifact is now consumption-ready for architect's full classification + ranking pass.** Architect's first commit lands post this Pass B per agreed cadence (thread-251 round 6).

**Cumulative symptom count: 50 (28 bugs + 12 threads + 10 traces)**.

**Cross-source distribution finding** (architect-flagged on thread-251 round 8, ratified): bug-walk alone would have missed ~40% of friction surface. Coordination has 0 bugs but 4 trace symptoms; deployment has 0 bugs but 2 trace symptoms; role-scoping has 0 bugs but 3 trace symptoms. **Plan's choice to require all three sources is structurally necessary, not just thorough.**

**Author:** greg (engineer, eng-0d2c690e7dd5), 2026-04-22 AEST.
**Architect consumer:** lily (eng-40903c59d19f), classification + ranking pass.
**Output destination:** input to lily-drafted `docs/reviews/2026-04-phase-2-friction.md` (the Phase 2 ratifiable artifact).

**Schema** (per architect thread-251 round 2; load-bearing fields ★):

| Field | Type | Notes |
|---|---|---|
| symptom_id | str | stable key, format `sym-<pass>-<NNN>` (e.g. `sym-A-001`) |
| source | str | citation: bug-NN / thread-NNN / trace:file:section / commit SHA |
| narrative | str | 1–3 sentences describing observed friction |
| domain_candidate | str | first-pass attribution from plan's 8 starting domains OR `new-domain-needed` flag |
| tele_violations | list[tele-N] | which teles this violates (heuristic from class+tags; lily refines) |
| frequency | enum | once / rare / rare-historical / recurring / frequent / continuous |
| cost | enum | trivial / minor / moderate / blocking / cascade-blocker |
| linked_ideas ★ | list[idea-NN] | existing backlog ideas addressing this symptom (empty = unaddressed gap) |
| fix_status ★ | enum | no-idea-filed / idea-filed / idea-triaged / mission-proposed / mission-active / shipped / shipped-but-leaks |

**Authoritative data:** `docs/reviews/2026-04-phase-2-data/bugs-symptoms.tsv` (29 rows including header).

---

## 0. Architect-ratified 11-domain final taxonomy (thread-251 round 6)

| # | Domain | Provenance |
|---|---|---|
| 1 | tool-surface | plan §Phase 2 |
| 2 | coordination | plan §Phase 2 |
| 3 | delivery | plan §Phase 2 (bug-25 class) |
| 4 | role-scoping | plan §Phase 2 |
| 5 | entity-vocabulary | plan §Phase 2 |
| 6 | deployment | plan §Phase 2 |
| 7 | debugging-loop | plan §Phase 2 |
| 8 | observability | plan §Phase 2 |
| 9 | **cognitive-layer** | emergent — Phase 1 tele-11/12 filings + bug-walk (4-7 symptoms) |
| 10 | **identity-layer** | emergent — mission-40 resolution + bug-walk (4 symptoms) |
| 11 | **cascade-execution** | emergent — bug-14/15/27/28 cluster + bug-walk (7 symptoms) |

Methodology-retrospective input flagged by lily: plan's 8 starting domains were correct but insufficient (38% expansion via Phase 2). Question for Phase 4 retrospective: should the plan's starting domains be derived from current Hub-state rather than hand-authored?

**FSM-enforcement** held as a cross-cutting pattern (not a domain) — workflow-registry §7 has 28 "Tested By: NONE" invariants, but symptoms manifest within specific entity domains; revisit if Pass B/C surface a concentration pattern.

---

## 1. Pass 2.A + 2.C summary stats (bugs + work-traces)

**Total symptoms collected:** 38 (28 from bugs + 10 from work-traces; thread-derived symptoms still pending in Pass B).

**Domain distribution (post-architect §10 reclassifications):**

| Domain | Pass A bug-count | Pass C trace-count | Total |
|---|---|---|---|
| cognitive-layer | 6 (was 7; sym-A-013 reclassified to tool-surface per architect §10 Q1 ratification) | 0 | 6 |
| cascade-execution | 7 | 1 (sym-C-002 mission-dup) | 8 |
| identity-layer | 4 | 0 | 4 |
| tool-surface | 5 (was 4; +sym-A-013 from architect reclassification) | 1 (sym-C-007 tarball regen) | 6 |
| entity-vocabulary | 1 (was 2; sym-A-013 left, only sym-A-024 remains) | 0 | 1 |
| delivery | 2 | 0 | 2 |
| coordination | 2 | 2 (sym-C-001 nudge-cycle, sym-C-005 ack-without-state) | 4 |
| deployment | 0 | 2 (sym-C-003 deploy-gap, sym-C-004 ADC gotcha) | 2 |
| role-scoping | 0 | 3 (sym-C-006 late design ratification, sym-C-009 architect-triage queue, sym-C-010 scope-discovery-late) | 3 |
| debugging-loop | 0 | 1 (sym-C-008 idea-promotion-late) | 1 |
| observability | 0 | 0 | 0 |

**Fix-status distribution:**

| fix_status | Count |
|---|---|
| shipped | 14 (resolved bugs with fixCommits) |
| no-idea-filed | 10 (open bugs without backlog idea linking) |
| idea-triaged | 4 (open bugs with linked idea status=triaged) |
| shipped-but-leaks | 0 by automated heuristic (see §3 — bug-10 is the canonical example; flagged manually below) |

**Tele-violation distribution** (heuristic from bug class + tags):

| Tele | Count of bug-symptoms violating |
|---|---|
| tele-7 (Resilient Operations) | ~12 |
| tele-2 (Isomorphic Specification) | ~10 |
| tele-3 (Sovereign Composition) | ~8 |
| tele-1 (Sovereign State Transparency) | ~6 |
| tele-11 (Cognitive Minimalism) | ~3 (cognitive-class bugs) |
| tele-4 (Zero-Loss Knowledge) | ~2 (delivery bugs) |
| tele-5 (Perceptual Parity) | ~1 (observability gap) |

---

## 2. Per-domain breakdown — call-outs for lily

### 2.1 cognitive-layer (7 symptoms)

Dominant cluster surfacing from M-Ideas-Audit + M-Cognitive-Hypervisor missions. Includes:
- **sym-A-011 (bug-11)** — *cognitive-layer silence remains live*; CRITICAL severity; fix-status `idea-triaged` (idea-132 captures mitigations); **canonical scope-conflation example with bug-10** (see §3.1)
- **sym-A-003 (bug-3)** — Architect Amnesia / Context Desynchronization; OPEN minor, no-idea-filed
- **sym-A-013 (bug-13)** — list_tasks sort lexicographic — really a tool-surface contract bug; **flagged for lily reclassification** (my domain attribution may be wrong)

### 2.2 cascade-execution (7 symptoms)

Includes both shipped (bug-1, bug-7, bug-8, bug-14) and open (bug-2, bug-22, bug-27, bug-28). Most directly traces to the M-Cascade-Perfection mission scope. The most active class:
- **sym-A-027 (bug-27)** — propose_mission cascade silently drops payload.documentRef — drift bug, recently observed (2026-04-22)
- **sym-A-028 (bug-28)** — DAG dep-evaluation against already-completed task → blocked — 2026-04-22 observed
- **sym-A-002 (bug-2)** — DAG retroactive unblocking race — pre-existing, no idea filed yet (likely covered by mission-9 scope but not explicitly linked)

### 2.3 identity-layer (4 symptoms)

All RESOLVED via mission-40 + mission-18/19 + bug-16. Cluster represents the closed identity-hardening arc. Historical-friction class; no current open identity-layer bugs at severity ≥ major.

### 2.4 tool-surface (4 symptoms)

Includes:
- **sym-A-004 (bug-4)** — OpenCode Plugin syncTools hashes names not schemas (manually corrected from `uncategorized` — heuristic missed the schema-cache pattern; flagging as observation)
- **sym-A-006 (bug-6)** — get_task can't retrieve historical tasks
- **sym-A-012 (bug-12)** — threads-2-smoke.test.ts loopback helper missing ADR-017 stores
- **sym-A-021 (bug-21)** — task-313 chunkReplyMessage UTF-16 splitting

### 2.5 entity-vocabulary (2 symptoms)

- **sym-A-024 (bug-24)** — *no retirement primitive for teles* — MAJOR, no-idea-filed; surfaced during Phase 1 tele rewrite; blocks formal retirement of 5 superseded pre-rewrite teles
- (sym-A-013 listed in cognitive-layer above; could double-count to entity-vocabulary if id-numbering is considered an entity-vocabulary concern — lily's call)

### 2.6 delivery (2 symptoms)

- **sym-A-010 (bug-10)** — architect-liveness class — ancestor of the delivery class; SHIPPED via ADR-017 — sym-A-011 (bug-11) is its scope-conflation leak
- **sym-A-025 (bug-25)** — thread message delivery truncation at ~10–15KB; MAJOR, no-idea-filed (workaround documented; idea-152 Smart NIC would absorb structurally)

### 2.7 coordination (2 symptoms)

- **sym-A-020 (bug-20)** — *workflow engine review→next-task advancement* — RESOLVED via task-316; superseded by idea-144 as implementation vehicle
- **sym-A-023 (bug-23)** — Thread bilateral-seal race when architect cascade-converges first — INVESTIGATING; minor; observed twice on thread-241

---

## 3. shipped-but-leaks call-outs (per architect §10.x sub-classes)

### 3.1 Sub-class (a): scope-conflation — `sym-A-010 (bug-10) → sym-A-011 (bug-11)`

bug-10 ("Architect non-response to thread SSE — class bug (P0)") was declared RESOLVED via ADR-017 (transport-layer fix: persist-first queue + watchdog escalation). bug-11 ("Architect LLM tool-round exhaustion — cognitive-layer silence class remains live") was filed explicitly noting "bug-10's fix was transport-only". Same observable symptom (architect silence on threads), distinct mechanism (transport drop vs cognitive exhaustion), separate fixes.

**Recommended fix-status update:** sym-A-010 → `shipped-but-leaks` (subclass: scope-conflation, leak-tracker: bug-11). Currently flagged as `shipped` in the TSV; lily can reclassify per her judgment.

### 3.2 Sub-class (b): back-compat runway — mission-40 auto-claim hooks

Not a direct bug entity, but worth flagging at the symptom level: mission-40 shipped the identity/session-claim separation with two intentional back-compat auto-claim hooks (SSE-subscribe + first-tools/call) per brief §10.1. These are deliberate runway leaks, gated on deprecation-runway dashboard zero-trend. Will surface as a symptom in Pass B (thread scan of mission-40 closing audit + dashboard spec) rather than Pass A.

---

## 4. Engineer-flagged judgment calls for lily review

1. **sym-A-013 (bug-13)** — list_tasks sort: I attributed `cognitive-layer` because the bug surfaced during architect cognitive-layer measurement. But the actual scope is `tool-surface` (sort contract). Reclassify if you agree.
2. **sym-A-004 (bug-4)** — Heuristic missed (defaulted to `uncategorized`); manually corrected to `tool-surface`. Suggests my class→domain mapping needs a "schema-cache" → tool-surface rule. Flag for retro.
3. **shipped-but-leaks subclass schema** — I did NOT add a sub-class subfield to the TSV. Per your "flat is fine, I'll distinguish during classification" — kept simple. Sub-class call-outs in §3 above are for your manual lookup.
4. **Frequency heuristic** — currently severity-based (critical/major → recurring; minor → rare; resolved → rare-historical). Crude. Could be improved by counting `shipped-but-leaks` re-surface incidents in Pass B (threads). Defer.
5. **Domain count "8 starting domains" vs my 7** — I haven't surfaced a `role-scoping`, `deployment`, or `debugging-loop` symptom from bugs alone. All three may surface in Pass B/C. Note that I have `identity-layer` + `cascade-execution` + `cognitive-layer` which the plan's starting set lacked — these were the Phase 1 cartography emergent clusters and look domain-worthy here. **Suggest you formalize them as additional domains.**

---

## 5. Coverage check (Pass A only)

- ✓ Every bug (28) mapped to a symptom (sym-A-001 through sym-A-028)
- ✓ Every symptom has domain_candidate (no `new-domain-needed` flagged in Pass A; may surface in B/C)
- ✓ linked_ideas populated for every symptom (best-effort grep across 158 ideas; uncertain matches not flagged with `?` since automated grep had no ambiguity for these)
- ✓ fix_status mapped per logic stated in thread-251 round 3

**Pass B/C will add:** thread-friction symptoms (engineer / architect / Director frustration patterns), work-trace reflections (governance + workflow friction sections per tele-10 success criterion). Expect 20–50 additional symptoms.

---

## 6. Pass C — Work-trace symptoms (10 symptoms)

10 symptoms extracted from `docs/traces/m-cognitive-hypervisor-work-trace.md` + `docs/traces/m-hypervisor-adapter-mitigations-work-trace.md`. These represent process / governance / workflow friction that is NOT bug-tracked — observable patterns from session logs.

| Symptom | Source-class | Domain | Notes |
|---|---|---|---|
| sym-C-001 | bug-20 nudge-cycle protocol | coordination | Engineer must thread-nudge architect after every task review; idea-144 triaged |
| sym-C-002 | mission-37/38 dup, mission-31-34 quad-dup | cascade-execution | Mission entities created in duplicate during cascade-spawning; no idea filed |
| sym-C-003 | deploy-gap (task-310 telemetry un-deployed ~2 days) | deployment | Code commits land but adapter changes don't reach prod until manual redeploy |
| sym-C-004 | ADC gotcha (`oauth2: invalid_grant`) | deployment | RESOLVED post-mission-38 via auto-export in deploy/build.sh — fix-status `shipped` |
| sym-C-005 | architect ACK without state mutation (thread-236) | coordination | Verbal ACK doesn't propagate to Hub state; bug-20 stays open after architect "I'll keep on triage list" |
| sym-C-006 | late design ratification at task-issuance | role-scoping | Architect ratifies design directions mid-thread alongside task issuance vs upfront mission decomposition |
| sym-C-007 | tarball regen commits | tool-surface | Repeated package-lock + tarball regen separate commits; manual + error-prone |
| sym-C-008 | director-sharpening idea-promotion-late | debugging-loop | Ideas surface as blockers mid-work after Director clarification (idea-120 promoted to blocker on Phase F) |
| sym-C-009 | architect-triage queue deferred indefinitely | role-scoping | Ideas 115/116/118 stayed deferred across multiple sessions, no SLA |
| sym-C-010 | scope-discovery-late (task-311 pre-satisfied) | role-scoping | Engineer found task-311 deliverables already shipped by Phase 1 ckpt-4 only after claim; mission brief had to be rewritten |

**New friction classes surfaced (not in bug-walk):**
- **Coordination friction is dominant in Pass C** (4 symptoms) — work-trace evidence reveals process gaps that bug entities don't capture: nudge protocol, ACK-without-state, mission-dup, scope-discovery-late
- **Deployment friction emerges** (2 symptoms) — bug-walk had zero `deployment` domain; trace harvest surfaces 2 explicit deploy-gap symptoms (one shipped, one open)
- **Role-scoping friction emerges** (3 symptoms) — late design ratification, architect-triage SLA absence, scope-discovery-late all live in the trace layer

---

## 7. Pass B — Thread-content symptoms (12 symptoms)

12 symptoms extracted from priority threads (top friction-density per word-count) + architect-flagged today's substantive threads. Avoids duplication with bug-walk + work-trace symptoms; only NEW friction patterns captured.

| Symptom | Source thread | Domain | Notes |
|---|---|---|---|
| sym-B-001 | thread-55 (Friction Analysis) | tool-surface | Tool Discovery Lag — plugin restart needed for new tools |
| sym-B-002 | thread-107 (DAG-mission hardening) | cascade-execution | Mission-Task Linkage gap — task-196 missing from mission.tasks[] |
| sym-B-003 | thread-76 (Multi-Agent Routing) | tool-surface | "Typo Black Hole" — assignedEngineerId typo silently strands tasks |
| sym-B-004 | thread-33 (Strategic Review) | debugging-loop | No automated workflow tests — 28 invariants "Tested By: NONE" |
| sym-B-005 | thread-33 | cascade-execution | Counter increment + state mutation race-condition risk |
| sym-B-006 | thread-79 (Agent Entity) | identity-layer | Volatile attributes (llmModel, version) drift Hub from reality (RESOLVED via Mission-18) |
| sym-B-007 | thread-71 (Workflow Deadlock) | cascade-execution | "Deferred FSM logic" deadlock class — task-116/117 stuck pair (Mission-9 partial fix; pattern can recur) |
| sym-B-008 | thread-59 (Task Duplication Crisis) | cognitive-layer | 12 duplicates in single session via Architect Amnesia + voluntary idempotency-key compliance |
| sym-B-009 | thread-107 | identity-layer | Agent orphan lifecycle from label mutation (INV-AG1 second-order effect; bug-16 reaper partial) |
| sym-B-010 | thread-74 (Cog Architecture Review) | entity-vocabulary | "Dormant Missions" — proposed missions leak tasks to global queue; needs FSM substate |
| sym-B-011 | thread-243 (Tele audit) | entity-vocabulary | bug-24 retirement-primitive blocker observed live during tele audit roll-out |
| sym-B-012 | thread-244 (Tele filing) | delivery | bug-25 truncation observed live in thread-244 multi-tele drafts; live evidence of the class |

**Cross-source coverage check:**
- Pass B contributes to: tool-surface (+2), cascade-execution (+3), debugging-loop (+1), identity-layer (+2), cognitive-layer (+1), entity-vocabulary (+2), delivery (+1)
- Pass B does NOT contribute to: coordination (already saturated by traces), deployment (no thread-friction in 14d window beyond what trace-walk captured), role-scoping (no thread evidence beyond trace-walk), observability (still empty across all 3 passes — possible plan-domain mis-naming?)

**observability domain still empty across A+B+C** — flagged for architect: either (a) no observability friction exists (unlikely given bug-15 INV-TH17 instrumentation gap RESOLVED + idea-155 audit-typed-payload OPEN), (b) observability symptoms get classified into cognitive-layer / cascade-execution domains instead, or (c) observability isn't a real domain in this taxonomy and should fold into another. Defer to architect classification call.

**Lily's predicted joint-attribution straddle (cognitive-layer × coordination on M-Ideas-Audit threads):** Pass B sample of thread-140-157 was deferred (already covered via bug-11 + sym-C-001 nudge-cycle). If straddle classification needed, sym-A-011 (bug-11) and sym-C-001 are the joint-attribution candidates.

---

## 8. Companion data location

Authoritative TSVs (3 files, 51 rows total including 3 headers):
- `docs/reviews/2026-04-phase-2-data/bugs-symptoms.tsv` (29 rows)
- `docs/reviews/2026-04-phase-2-data/traces-symptoms.tsv` (11 rows)
- `docs/reviews/2026-04-phase-2-data/threads-symptoms.tsv` (13 rows)

Combined view available via `cat *.tsv | grep -v '^symptom_id'` (sym-A-001..028 + sym-B-001..012 + sym-C-001..010 = 50 unique symptoms).

---

## A1. Reproduction (Pass A)

```python
# Run from /tmp/cartography-pass1 with bugs/ + ideas/ pulled from gs://ois-relay-hub-state/
import json, os, re

ideas_by_id = {json.load(open(f"ideas/{f}"))["id"]: json.load(open(f"ideas/{f}"))
               for f in os.listdir("ideas")}

def find_linked_ideas(bug_id):
    out = set()
    for iid, idea in ideas_by_id.items():
        joined = "|".join(idea.get("tags", [])).lower()
        bid = bug_id.lower()
        if any(p in joined for p in [
            f"migrated-to-bug-{bug_id.split('-')[1]}",
            f"migrated-to-bug:{bid}",
            f"linked:{bid}", f"superseded-by:{bid}",
            f"superseded-by-bug:{bid}", f"resolved-by-bug:{bid}",
            f"{bid}-scope-conflation", f"{bid}-followup",
        ]):
            out.add(iid)
    return sorted(out)

# domain + fix_status + tele_violations heuristics: see §2.4 in source script
# at /tmp/cartography-pass1/phase2/build-bugs-symptoms.py (engineer scratchpad)
```

---

*End of Pass 2.A. Pass B (thread content scan) follows; Pass C (work-traces) third. Architect classification of Pass A can begin immediately per agreed parallel cadence.*
