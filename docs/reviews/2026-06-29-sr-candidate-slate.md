# Strategic Review — Candidate Slate (SEALED) — 2026-06-29 — stint-6 (seal_candidates)

**Node:** `work-bp-stint6_strategic_review_20260629-seal_candidates` (engineer: greg / agent-0d2c690e)
**Method:** strategic-review.md sub-step-4 (FOLD/COMPOSE/DEFER/EXCLUDE) + design §1 C5 + §6.1 A1/A2 (pinned @2f89016).
**Input:** the verified, id-sorted evidence pack (318 candidates: 277 ideas + 41 bugs), frozen at git `82bc035` (`docs/reviews/2026-06-29-sr-evidence-pack.md` + `.json`), reconciliation anchor `2026-06-29T03:48:46Z` @ `3cff84e`.

This is the council's **first judgement act**: clustering the full universe into summit candidates. It is **sealed** (ev_seal_hash) before any scoring — FM-10 (no post-hoc set manipulation).

## Neutrality construction (how anchoring is denied a slot)

- **A1 — symmetric schema.** Every candidate is `{candidate_id, theme, representative_members, value_evidence[], readiness_evidence[], tele_alignment[], cost_estimate, source_class}`. There is **NO** `recommended` / `default` / `baseline` / `anchor` / `rank` / `score` field — anchoring (FM-1) has no slot to live in.
- **A2 — provenance blinding (R-D5, blind ALL known priors).** Every known standing prior enters as a neutral `candidate_*` peer, competing on its evidence. Which candidate is whose prior lives ONLY in the sealed `ev_provenance_sidecar`, recoverable at audit. **Blinding is SOFT** (N1 — no Hub primitive hides authorship; the construction guard is this symmetric schema + the no-anchor-slot rule; `deliberate_eng` re-scores tele-fit/D1 blind as the cross-check).
- **Ordering is NEUTRAL** — candidates are ordered by the **lowest candidate-id among each theme's listed representative members** (a reproducible rule uncorrelated with authorship or any ranking). The letters A–G carry no priority.
- **Clustering input = the 6 mechanical signals + tele-alignment + M-N parentage** (neutral facts; signal ≠ judgement). No rank/score entered the clustering.

## The slate — 7 summit candidates (symmetric records)

### candidate_A
- **theme:** Adapter / integration surface (the agent↔tool membrane)
- **representative_members:** idea-6, idea-15, idea-18, idea-93, idea-94, idea-95, idea-96, idea-98, idea-99, idea-105, idea-152 (Smart-NIC-Adapter), idea-185, idea-195, idea-360, idea-362, idea-376, idea-377, idea-381; bug-183 (adapter-version misreport), bug-203 (host-conformance, upstream)
- **value_evidence:** tele-7 is the most-served tele in the universe (35 candidates touch it); idea-152 carries in-degree 3 (forward-investment); bug-203 in-degree 2; this is the connective surface every agent depends on.
- **readiness_evidence:** many members `ready` (idea-6/18/93/94/95/96/99/105); shared-adapter consolidation (dogfood-3) already shipped; bug-203 is a confirmed UPSTREAM host limitation (workaround-only, fix-by-construction deferred to idea-391/392).
- **tele_alignment:** t7 (dominant), t3
- **cost_estimate:** M
- **source_class:** mixed idea+bug cluster

### candidate_B
- **theme:** Task-dispatch + identity-resolution correctness (the core claim/dispatch loop)
- **representative_members:** idea-336 (M-Task-Dispatch-Repair); bug-23 (race, the sole `investigating` bug), bug-146 (identity-resolution), bug-185 (queue-semantics), bug-189 (identity-resolution)
- **value_evidence:** load-bearing for multi-agent reliability — dispatch + identity is the substrate's hot path; bug-23 is the only candidate under active `investigating` status; two distinct identity-resolution bugs (bug-146/189) signal a recurring class.
- **readiness_evidence:** idea-336 is the design root (dispatch ROOT still being designed → not shovel-ready); the bugs are open/triaged with no shipped main-merge fix.
- **tele_alignment:** t6, t7
- **cost_estimate:** M–L
- **source_class:** mixed (idea-root + bug-cluster)

### candidate_C
- **theme:** Operator-DX / missioncraft CLI-UX debt (the papercut cluster)
- **representative_members:** bug-60, bug-64, bug-65, bug-66, bug-67, bug-74, bug-76, bug-77, bug-78, bug-79, bug-80, bug-81, bug-82, bug-83, bug-84, bug-85, bug-86, bug-87, bug-88, bug-89, bug-90, bug-91, bug-92 (~23 contiguous operator-facing bugs)
- **value_evidence:** the single largest coherent cluster in the universe (~23 bugs); pains 1–2 individually but dense; tags span operator-dx / missing-feature / schema-validation-gap / cognitive — a sustained operator-experience friction surface, roadmap-candidate (not stale).
- **readiness_evidence:** all `open`; individually small/shovel-ready fixes; no single design blocker — a batchable rung.
- **tele_alignment:** — (largely untagged; operator-facing)
- **cost_estimate:** M (a cluster of small fixes; high count)
- **source_class:** bug-cluster

### candidate_D
- **theme:** Keystone architectural backbone (high forward-investment fabric)
- **representative_members:** idea-102 (XL), idea-129, idea-133 (in-degree **5** — the universe keystone), idea-134, idea-135, idea-136, idea-137, idea-138, idea-139 (in-degree 3), idea-152, idea-364 (in-degree 4)
- **value_evidence:** contains the highest-forward-investment nodes — idea-133 keystone (in-degree 5, teles t4/t7/t8/t9/t10), idea-364 (in-degree 4), idea-102 (in-degree 3, XL value), idea-139 (in-degree 3); these are the most-referenced architectural ideas (others depend on them).
- **readiness_evidence:** mostly `needs-proposal` / `needs-research` (early-stage); high forward-investment but low shovel-readiness — investment-now-pays-later profile.
- **tele_alignment:** t4, t7, t8, t9, t10 (broad architectural spread)
- **cost_estimate:** XL
- **source_class:** idea-cluster (forward-investment keystones)

### candidate_E
- **theme:** Self-instrumentation / agent-telemetry / observability (the org sees its own runtime state)
- **representative_members:** idea-343 (D-3 first-class centralised agent telemetry — the theme lead), idea-353, idea-356, idea-357 (push CI/deploy/WI-transition events), idea-363, idea-367, idea-368, idea-369, idea-370, idea-382; bug-162 (liveness-signal-omission), bug-194 (silent-failure)
- **value_evidence:** the tele-13 north-star cluster — 8 ideas tag t13 (idea-353/356/357/363/367/368/369/382), idea-370 tags t0 NS; idea-343 is the D-3 agent-telemetry lead (tags `observability`/`agent-telemetry`/`quota`/`verifier-availability`; teles 13/4/12) with a worked Option-B standardisation verdict, motivated by a real org-blindness incident (a verifier lost mid-stint to LLM-quota exhaustion with **zero org visibility**); bug-194 is the **highest bug-pain in the universe** (pain=4, silent-failure); idea-353/357/369 each carry in-degree 2. Self-knowledge of runtime health is the precondition for the org to manage + self-direct.
- **readiness_evidence:** idea-343 carries a captured Option-B verdict + Director co-design (Survey-DEFAULT, gated on the C2-W0 execution-model spike); push-events (idea-357) is scoped + sizing-guarded (work-54 queued); idea-353/357/369 referenced (in-degree 2); several members still ideation.
- **tele_alignment:** t13 (north-star), t4, t12, t0, t7, t11
- **cost_estimate:** M–L
- **source_class:** idea-cluster (north-star observability / D-3 telemetry)

### candidate_F
- **theme:** Hub storage-substrate maturation (the sovereign backplane, post-mission-83)
- **representative_members:** idea-295 (ResourceVersion / optimistic-concurrency), idea-296 (Audit-History), idea-297 (FK-Enforcement), idea-299 (BlobBody-Substrate); bug-174 (silent-degrade), bug-199 (cache-invalidation)
- **value_evidence:** integrity of the production state-backplane (substrate is the only prod cloud-path post-W5 cutover); mission-83 explicitly filed these as the named follow-on missions; idea-296/299 carry in-degree 1.
- **readiness_evidence:** design-scaffolded (mission-83 filed each follow-on with scope); k8s-pattern precedents (ResourceVersion/FK) lower research-risk.
- **tele_alignment:** t6 (substrate)
- **cost_estimate:** L (per follow-on mission)
- **source_class:** idea-cluster (mission-83 follow-ons)

### candidate_G
- **theme:** Self-determination / governance / autopoietic process-substrate
- **representative_members:** idea-388, idea-389 (the self-determination / strategic-review mechanism — live this very run), idea-390, idea-359, idea-361
- **value_evidence:** the org's capacity to self-direct + self-record (compounding meta-value across every future stint); idea-389 is the live dogfood proving the mechanism (this SR run is its first execution); the process-substrate work it anchors is the leverage that makes all other themes cheaper to prioritise.
- **readiness_evidence:** idea-389 is mid-execution (the mechanism is being proven now); the surrounding governance/process ideas are mostly ideation/proposal-stage.
- **tele_alignment:** varies (process-substrate; t-spread)
- **cost_estimate:** M
- **source_class:** idea-cluster (governance / process-substrate)

## DEFER / EXCLUDE residual (not summit candidates)

The clustering FOLDs/COMPOSEs the signal-bearing mass into the 7 summits above. The long tail of zero-signal, untagged ideas (the `idea-159..idea-394` band with no tele/value/in-degree signal in the pack) and the umbrella-Ideas used as Initiative proxies (idea-50/107/229/234/235/236/240/242/244/250/312) are **DEFERred** to the per-Idea triage routing (SR sub-step-11) — they are not excluded from the backlog, only from the summit slate. No candidate is EXCLUDEd as out-of-scope at this stage.

## Seal

- **candidate count:** 7 (within the 5–8 band)
- **frozen input:** evidence pack @ git `82bc035`
- **ev_seal_hash:** see `ev_seal_hash` evidence (sha256 over this document's bytes) — the reveal line; freezes the set before scoring.
- **provenance:** authorship of any standing prior is in the sealed `ev_provenance_sidecar` only (not this slate).
