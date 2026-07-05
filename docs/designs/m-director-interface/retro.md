# M-Director-Interface (mission-102) — Arc Retrospective

**Status:** final (work-134 completion sweep, 2026-07-05)
**Arc span:** 2026-07-04 (intent Session 1) → 2026-07-05 (G3 executed 10:08:27Z)
**Record chain:** G0 audit-9343 · G1 seal · G2 ratify (design.md v1.0, 64de1bf) · B8b VALID audit-10354 · dogfood audit-10365 · G3 = decision-10 (director-direct, dconf-8)

---

## 1. What shipped (v1, all live on prod, verifier-gated per slice)

All 8 build slices of the ratified contract: Decision entity + FSM + verbs + events (B1); curation model + raw-feed anti-laundering queries + 24h SLO (B2); ClassGrant with typed constraints, immutable versions, CAS revocation recheck, spec-hash binding (B3); DirectorSignal/DirectorConfirmation proof path — consume-exactly-once, first-answer-wins (B4); action registry + atomic resolve+execute (B5); arrival surface — snapshot/receipts/aging (B6); CLI compatibility spike → CI contract test (B7); 12-test binding contract suite green, including remediation-added verdict-spoof and SC3-gaming negatives (B8/B8b). Composing floor ran alongside per audit-9271 (ois decision verbs upstreamed to the first-class `ois/` home, work-131/132).

## 2. SC1–6 assessment

| SC | Verdict | Evidence |
|---|---|---|
| SC1 Zero frozen gates | **MET** | Decision FSM has total exits (contract #10); no lease/timer transitions (#9); ratify-by-audit retired — G3 itself resolved through the rail (decision-10), not by audit workaround. Legacy frozen items (work-38/39) queued for re-presentation through the rail post-arc. |
| SC2 Nothing dropped | **MET** | Raw-feed interval queries return disposed+merged complete (contract #8); every arc decision reached resolution or explicit exit (decision-2 withdrawn, decision-3 executed as moot/superseded-by-decision-5 via dconf-5, decision-9 withdrawn — all visible); bug-225 replay test (#4) proves arrival-snapshot completeness with pushes dead. |
| SC3 Attention efficiency | **MET (benchmark) / instrumented (trend)** | Dogfood: attributable decision-interaction ≈2–3 min vs ~2.5 min benchmark (audit-10365). Typed attention-requests + full-funnel denominators + gaming-flag shipped (B2/B8b contract #6); TREND data accrues from live use — first data point banked. Learning-attention protected by construction: the dogfood's "overrun" was two mined findings (bug-228/229), counted as investment per B9/tele-15. |
| SC4 Authority integrity | **MET** | All live resolutions carry Hub-derived authorityMode: decision-1/7/10 director-direct (answered confirmations), decision-3 executed-as-moot (director-direct via dconf-5), decision-5 class-grant under grant-1@v1; standing invariant query (resolutions where authorityMode≠director-direct and authorityRef unresolvable → empty) holds; grants revocable live (grant-2 mint→revoke specimen) and representation-dated (grant-1 due 2026-10-03). Zero lean-driven resolutions on record. |
| SC5 Presentation-agnostic | **MET (v1 bar)** | Same decision payload renders inline (agent session) and in the non-agent `ois` CLI (decisions/show/confirm) with zero payload transformation; CLI round-trip is a CI contract test (B7). Full standalone surface remains deferred (S2.1) as designed. |
| SC6 Gates rode the rail | **MET** | G3 ran as decision-10 (class=ratification, parentRef mission-102), routed director-direct, resolved via the Director's own `ois confirm` — the arc's exit gate consumed the machinery it built. Earlier gates (G0–G2) ran on the proto-rail (audits) before B1 existed; the design's C2 commitment is satisfied from B1-live onward. |

## 3. Experiment ledger (named dogfoods, with verdicts)

1. **Structured single-topic queries, inline** — VALIDATED repeatedly (Session 1, G0 walkthrough, S3, dogfood). Stacked forms REJECTED once, never repeated. Constitutional (idea-416, B1).
2. **Item-by-item ratification walkthrough** — VALIDATED (G0: 15 decisions ≈ 15 min).
3. **Reasoned-tension deep-dive** — VALIDATED as the engagement mode for Director meta-framings (T1 entity-shape tension; B9 philosophy capture).
4. **Arc gates as rail cargo** — VALIDATED (G3/decision-10; first cargo decision-1→grant-1; delegation live-fire decision-5).
5. **Dogfood-as-gate** — VALIDATED with yield: the G3 dogfood produced its own SC3 calibration + two substrate findings (bug-228 perf papercut; bug-229 MAJOR missing signal-captured event). Pattern: the gate that measures the surface also mines it.
6. **Live grant lifecycle** — VALIDATED end-to-end twice (grant-1 active + exercised; grant-2 mint→revoke specimen for the verifier's rejection probes).

## 4. What the arc taught the org (banked, not prose)

- **A12** (phases ride the queue) — register row; proven by the P2 stall + same-day DAG remediation; enforced in this sweep (work-134 node, Director-caught work-133 repair).
- **B10** (render-before-confirm) — register row; `ois show` born from the Director's confirming-blind flag.
- **tele-15/A14** (compounding learning) — ratified mid-arc; first-class mission-kit axiom (Director-directed primacy); M6 author-from-exemplar methodology minted from its own authoring failure.
- **bug-229** (answered→resolved leg unautomated) — the rail's last manual hand-carry, found by the Director's dogfood probe; work-133 cut, block-bound post-arc.
- **idea-419** (update_work) — third live demonstration during the sweep itself (work-133 dependsOn retrofit impossible); design slice work-135 cut with a real dependsOn edge.
- Executor-attribution papercut: bridge-session resolutions record `anonymous-architect` — identity carried by proof, not session; folds into the A10/A11 identity thread.

## 5. Deferred (unchanged from design §8)

Director seat (S2.1 standalone surface); native verifier-mandate resolutions; registry expansion; DirectorSignal confidence tiers; BlueprintTemplate entity; base-node unification; skill-system dissolution (idea-418); event-scoping generalization (idea-355).

## 6. Post-arc graph (all edges real at sweep close)

work-134 (this sweep) → unlocks work-135 (idea-419 design, dependsOn) · wakes work-133 (bug-229 signal-captured event, block edge) · C-floor follow-on bug-228 (soft, greg's pacing) · work-38/39 legacy gates re-present through the rail · idea-420 tele→axiom transition arc · PR #487 glossary v1.2 · plugin release cut (network-adapter 0.1.8 wake fix).
