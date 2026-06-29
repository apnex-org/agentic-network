# Strategic Review - Verifier Scorecard (score_ver) - 2026-06-29

Node: `work-bp-stint6_strategic_review_20260629-score_ver`
Authoring seat: verifier `steve` / `agent-f148389d`
Scope: D7, D8, D9 only. D1-D6 are intentionally not scored here.

> Dual-persistence note (durability, Director directive 2026-06-29): this verifier-authored doc was originally Hub-only; committed to git verbatim by greg (engineer) so the whole stint-6 SR report is dual-persisted (git + Hub), not postgres-only. Content unchanged from the Hub rev.

## Seal And Input Hygiene

- Sealed slate source: `docs/reviews/2026-06-29-sr-candidate-slate.md`
- Seal git anchor: `31edcb2:docs/reviews/2026-06-29-sr-candidate-slate.md`
- Expected `ev_seal_hash`: `111487fb13d70165bac8e348d170f3225dbcb17954117a19f855e00eabe68902`
- Verified command: `git show 31edcb2:docs/reviews/2026-06-29-sr-candidate-slate.md | sha256sum`
- Verified output: `111487fb13d70165bac8e348d170f3225dbcb17954117a19f855e00eabe68902  -`
- Sealed hygiene: I did not read `score_arch`, `score_eng`, or the de-blind provenance sidecar.
- Rubric source: design `2f89016427f4aed50b50c8f71859165d95e53b2d:docs/designs/m-autonomous-strategic-review-design.DRAFT.md` section 4.2.
- Calibration source: `2f89016427f4aed50b50c8f71859165d95e53b2d:docs/calibrations.yaml`.

## Score Semantics

- D7 reversibility / blast-radius, weight 3: `5` = config-only, flagged, instant-revert, or narrow blast; `1` = irreversible migration or wide blast.
- D8 verification cost / testability, weight 2: `5` = cheap deterministic verification; `1` = expensive, prod-like, cross-surface, or hard-to-falsify verification.
- D9 risk-of-NOT-doing, weight 2: `5` = absence leaves a severe named fault-class live; `1` = absence leaves little direct defect risk.
- `Verifier weighted points` is only the native verifier contribution: `3*D7 + 2*D8 + 2*D9`, max 35. Candidate order remains sealed A-G order, not a verifier ranking.

## Summary Scores

| Candidate | Theme | D7 | D8 | D9 | Verifier weighted points |
|---|---|---:|---:|---:|---:|
| candidate_A | Adapter / integration surface | 2 | 2 | 4 | 18 |
| candidate_B | Task-dispatch + identity-resolution correctness | 1 | 2 | 5 | 17 |
| candidate_C | Operator-DX / missioncraft CLI-UX debt | 4 | 3 | 2 | 22 |
| candidate_D | Keystone architectural backbone | 1 | 1 | 3 | 11 |
| candidate_E | Self-instrumentation / agent telemetry / observability | 3 | 3 | 5 | 25 |
| candidate_F | Hub storage-substrate maturation | 1 | 2 | 5 | 17 |
| candidate_G | Self-determination / governance / autopoietic process-substrate | 4 | 3 | 4 | 26 |

(score_ver INITIAL scores; candidate_E D8 was later revised 3→2 at deliberate_ver — see that doc for the final verifier cells.)

## Bound Rationales

| Candidate | Dimension | Score | Bound rationale | Triangulate-against ref |
|---|---|---:|---|---|
| candidate_A | D7 | 2 | Adapter/tool-membrane work touches every agent-host boundary. Rollback is usually package or bundle redeploy rather than data migration, but stale host/tool catalog behavior and cross-runtime divergence make the practical blast broad. | calibration #91 `REDEPLOY does not invalidate a running host's tool-surface cache`; calibration #95 `Cross-lineage cutover without a runtime acceptance gate` |
| candidate_A | D8 | 2 | Correctness needs hub + adapter + real-runtime acceptance, not only package/unit tests; same-lineage harnesses can miss behavioral-contract defects. | calibration #95 `Cross-lineage cutover without a runtime acceptance gate` |
| candidate_A | D9 | 4 | Not doing this keeps adapter-membrane conformance and stale-capability faults live at the surface every agent uses, including host-conformance/workaround-only defects. | calibration #91 `REDEPLOY does not invalidate a running host's tool-surface cache`; calibration #95 `Cross-lineage cutover without a runtime acceptance gate` |
| candidate_B | D7 | 1 | Dispatch and identity are the core claim/message/thread routing hot path. Breakage can strand targeted dispatch or orphan references across higher-layer entities, so blast is system-wide and rollback is not a simple local toggle. | calibration #64 `Stale-agentId architectural-trap`; calibration #62 bug-56 note: affected all agentId-targeted Hub-internal dispatches |
| candidate_B | D8 | 2 | Verification requires multi-agent concurrency, stale-identity negatives, queue delivery checks, and producer/consumer end-to-end assertions; producer-side success can be false if delivery is fire-and-forget. | calibration #90 `SILENT-FAILURE in fire-and-forget async seams`; calibration #64 `Stale-agentId architectural-trap` |
| candidate_B | D9 | 5 | Absence leaves the active dispatch/identity fault-class live: the slate includes the sole investigating bug plus two identity-resolution bugs and queue-semantics defects on the substrate hot path. | calibration #90 `SILENT-FAILURE in fire-and-forget async seams`; calibration #64 `Stale-agentId architectural-trap` |
| candidate_C | D7 | 4 | Most items are operator-facing CLI/UX fixes with narrow command-level blast and normal release rollback. The count of fixes adds coordination risk, but this is not a persistent-state or dispatch-hot-path migration. | calibration #62 `Deferred-runtime-gate-becomes-silent-defect-surface`, including operator-path runtime-gate examples |
| candidate_C | D8 | 3 | Many small fixes are directly testable, but operator-path and cold-start workflow behavior must be exercised, because script/unit-green has repeatedly missed the real operator boundary. | calibration #62 `Deferred-runtime-gate-becomes-silent-defect-surface`; calibration #85 `GROUND-TRUTH-OVER-ASSUMPTION` generalization |
| candidate_C | D9 | 2 | Not doing the papercut batch leaves friction and delayed operator discovery, but it does not by itself keep a single severe substrate fault-class live in the same way dispatch/storage/observability do. | calibration #62 `Deferred-runtime-gate-becomes-silent-defect-surface`, operator-discovers-via-prod-audit pattern |
| candidate_D | D7 | 1 | XL keystone/backbone architecture has high forward-dependency count and broad architectural surface. Reversibility is unclear because decisions become fabric for later work rather than a narrow deployable change. | calibration #86 `Deferred divergence becomes drift`; calibration #81 `PREMATURE structural-closure claim from partial verification` |
| candidate_D | D8 | 1 | The slate says mostly needs-proposal/needs-research. Verification would be architectural full-surface and adversarial-audit heavy, not local deterministic testing. | calibration #83 `DEEP-ADVERSARIAL-AUDIT value at structural-elimination gates`; calibration #81 `PREMATURE structural-closure claim from partial verification` |
| candidate_D | D9 | 3 | Absence keeps broad architectural drift/asymmetry risk alive, but the sealed evidence is mainly forward-investment and keystone dependency rather than a currently recurring concrete defect swarm. | calibration #86 `Deferred divergence becomes drift` |
| candidate_E | D7 | 3 | Instrumentation can often be additive, flagged, or observed before enforcement, but central telemetry/liveness/quota/push-event surfaces touch all agents and can create false-positive routing or escalation noise. | calibration #16 `Shim observability invisibility-at-P0`; calibration #10 `Engineer pulse-miss escalation false-positive` |
| candidate_E | D8 | 3 | Observability can be dogfooded via logs/events and liveness state, but correctness of quiet/liveness/health semantics must avoid false-positive escalations and consumerless-health theatre. | calibration #10 `Engineer pulse-miss escalation false-positive`; calibration #90 `consumerless-health-surface` sub-pattern |
| candidate_E | D9 | 5 | Absence leaves org-blindness live: quota/liveness failures, silent delivery failures, and health surfaces that report success while delivering nothing remain hard to detect. | calibration #16 `Shim observability invisibility-at-P0`; calibration #90 `SILENT-FAILURE in fire-and-forget async seams` |
| candidate_F | D7 | 1 | Storage backplane maturation changes optimistic concurrency, audit history, FK enforcement, BlobBody, and production state shape. These are persistent-state surfaces with hard rollback and wide blast. | calibration #19 `Schema-rename PR without state migration`; calibration #79 `FALSE-GREEN-AT-SCALE via unfaithful test fixtures` |
| candidate_F | D8 | 2 | It is testable only with faithful harnesses, real storage paths, mutation/non-vacuity checks, and full-surface scan-scope. The named history shows green tests can lie on this class. | calibration #82 `FAITHFUL-HARNESS-as-EXPOSURE`; calibration #83 `DEEP-ADVERSARIAL-AUDIT`; calibration #88 `Re-introduction guard scan-scope` |
| candidate_F | D9 | 5 | Absence keeps production-backplane integrity classes live: silent degrade, stale/cache invalidation, projection shape inconsistency, and concurrency/audit/FK gaps. | calibration #84 `SILENT-DEGRADE try/catch hides the defect it sits on`; calibration #92 `EMIT-NULL-NOT-OMIT in projections`; calibration #91 stale tool-surface/cache recurrence note |
| candidate_G | D7 | 4 | Governance/process-substrate changes are mostly artifacts, protocols, and blueprint mechanics that can be superseded or revised; blast is primarily decision-process influence rather than immediate runtime mutation. | calibration #43 `Architect drift from strict multi-round Survey methodology`; calibration #85 `GROUND-TRUTH-OVER-ASSUMPTION` generalization |
| candidate_G | D8 | 3 | Verification can use sealed artifacts, recompute checks, non-vacuity/agreement pins, and dogfood, but strategic-outcome quality is not a cheap unit-test target. | calibration #96 `AGREEMENT-PIN every load-bearing invariant`; calibration #85 `GROUND-TRUTH-OVER-ASSUMPTION` generalization |
| candidate_G | D9 | 4 | Not doing the process substrate keeps assumption-driven prioritization, stale-ledger near-misses, and methodology-drift faults live across future stints, though less as an immediate runtime hot-path bug than B/E/F. | calibration #85 `GROUND-TRUTH-OVER-ASSUMPTION` generalization; calibration #43 `Architect drift from strict multi-round Survey methodology` |

## Notes For Deliberation

- Highest D9 risk-of-not-doing cells from this verifier lens are B, E, and F because their absence preserves active or recurring fault-classes.
- Highest D7 safety cells are C and G because their likely blast is narrower or process-level reversible.
- Lowest D8 cells are D and the hot substrate surfaces because their correctness requires full-surface or runtime acceptance, not isolated unit tests.
