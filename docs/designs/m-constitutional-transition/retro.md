# M-Constitutional-Transition (mission-103) — Arc Retrospective

**Status:** final (work-155 close sweep, 2026-07-06)
**Arc span:** 2026-07-05 (intent, riding straight off mission-102's close) → 2026-07-06 (G3)
**Record chain:** G0 decision-14 · G1 decision-15 · G2 decision-17 (design v1.0) · S2 batch decision-18 (charter v1 bound) · SC1 static audit-10997 · SC1 live gates catalog-negative + cold-start recall (steve) · SC1 clean hub-doc closure audit-11060 (work-155 — no carve-out) · G3

---

## 1. What shipped

The org's constitutional layer transitioned from the **Tele** primitive to **mission-kit axioms**, end to end:

- **S1** — constitution serve substrate: `ConstitutionSnapshot` singleton + `OrgCharter` kinds, the git-canonical sync loop (poll mission-kit HEAD, atomic swap, fail-open-stale / fail-closed-malformed), four read verbs (`get_constitution`/`list_axioms`/`get_axiom`/`get_charter`), charter mutation as rail-executed registry actions only.
- **S2** — the 15-pair fidelity suite (107 assertions, all green) + **charter v1 bound**: 15 axioms (A0←tele-14 … A14←tele-15), each stamped `{ratifiedBy: decision-18, proofRef: dconf-17, status: bound}`, plus the vision and Director-profile summary — ratified by a single silent Director confirm.
- **S3** — mechanized doc rewrite (tele-N→A-N across the live corpus; charter-refs repointed at the read surface; calibrations.yaml `tele_alignment`→`axiom_alignment`).
- **S4a/b** — **the hard cut**: 5 tele verbs, TelePolicy, TeleRepositorySubstrate, the Tele entity/kind/schema, and `Turn.tele` deleted; docs tombstoned. **Verified live on prod: the tele verbs are gone from the catalog (111 tools, down from 116); the constitution serves its 15 axioms.** ~2,000 lines removed net.
- **S5** — SC1 live gates, memory sweep, retro, G3.

The constitution is now **bound and sole** — the axiom surface is the only constitutional surface an agent can reach.

## 2. SC1–6 assessment (vs intent-brief §5)

| SC | Verdict | Evidence |
|---|---|---|
| SC1 Zero live tele refs | **MET** | Hard cut complete; SC1 static gate green (audit-10997). steve's SC1 **live gates**: catalog-negative confirmed (tele verbs unknown-tool on prod) + cold-start recall probe passed (both recorded). The **final clean closure** — exhaustive 68/68 hub-doc re-sweep with the two legacy bare-path residues (`teles`, `policy-network-v1`) tombstoned within-arc by the bug-237 fix (work-159 / PR #517: `create_document` overwrites existing docs at any path) — is **audit-11060**, no carve-out. So Option A closed with zero live residue. Scoped `tele_`-identifier gate honored; historical dirs preserved (A4). |
| SC2 All 15 teles dispositioned | **MET** | 1:1 bijection ratified as one clean batch (decision-18), each binding carrying its proof chain; tele-0 correctly historical (superseded by tele-14→A0). Zero split-outs. |
| SC3 Cold-start recall-proof | **MET (probe) / gap named** | steve's cold-start recall probe (fresh agent recalls the constitution from the new surface, refuses tele as live authority). Honest gap surfaced: the constitution is *served* but not yet *auto-hydrated* at startup → idea-428 (cold-start hydration), the future-arc line. |
| SC4 mission-kit project-agnostic | **MET (live) / pen follow** | Axiom bodies agnostic (M6 discipline). Residual normative `tele` in axiom bodies (idea-426, generalized to Option A) purges via the constitutional pen post-arc — does not gate close. |
| SC5 Charter changes trace to rail | **MET** | charter v1's 15 bindings + vision + profile all trace to decision-18/dconf-17; charter mutation has no free verb — only rail-executed registry actions. |
| SC6 Gates rode the rail | **MET** | G0 (decision-14), G1 (decision-15), G2 (decision-17), S2 batch (decision-18), G3 — all rail decisions, director-direct. The arc gated itself on the machinery mission-102 built. |

## 3. Experiment ledger

1. **Silent-wake production gates** — the answered→resolved leg with zero human relay. G0 (decision-14) *lost its wake to a coinciding deploy roll* (bug-231) → the arrival backstop shipped (work-144) → G1/G2/S2-batch/G3 all resolved silently, executor-stamped with real identity. The flagship loop, hardened by its own first failure.
2. **Stranded-specimen recovery** — decision-16, a deliberately-unresolved confirmation, recovered by steve via the backstop (`recoveredWakes:1`), proving the correctness path.
3. **Fidelity-suite dogfood** — 107 mechanical assertions made the 15-pair batch a clean one-shot ratification; the suite is itself a live instance of rule-generated quality assurance (idea-433).
4. **S4-stall + doctrine correction** — the arc stalled one slice short when the engineer self-certified "fatigue" (falsified: 50% context; and the org is compaction-native). Root-caused, corrected, and banked as doctrine (idea-427); the fix produced the right behavior + a clean cut within the same session. The strongest A14 payback of the arc.
5. **Option A purge scope — closed within-arc, zero residue** — Director-ratified fuller purge (audit-10913): no live/normative tele anywhere; preserve only immutable history + a per-axiom lineage line (A4 zero-loss). Its one uncleanable class — two legacy bare-path hub-docs `create_document` could neither overwrite nor tombstone (bug-237) — was first taken as a Director-approved carve-out, then **cleared inside the same arc**: work-159 shipped the smallest-sufficient write-path fix (overwrite-existing regardless of prefix, PR #517), both docs tombstoned, steve re-swept clean (audit-11060). Option A closed with no carry-forward.
6. **Close-sequencing churn (architect process failure, owned)** — on the *immaterial* ordering of the carve-out close vs the clean fast-follow (both reach the same fully-purged end-state; G3 waits for the Director regardless), I broadcast each intermediate lean to the verifier as an instruction. Message latency turned it into ~5 re-minted audit ledger entries chasing my reversals. Root-caused and banked as idea-443 (decide once, instruct once; find the dominant tiebreak first; executors are commitments, not a thinking surface). It also exposed the audit primitive's missing write-discipline → the **mission-104 audit-retirement** candidate (idea-444), now in design.

## 4. Banked lessons (durable, not prose)

- **Defects**: bug-229 (wake emit), bug-230 (identity stamp), bug-231 (wake roll-durability), bug-234 (Director-status projection — FSM vs DirectorConfirmation lifecycle), bug-235 (ois up -c passthrough), bug-236 (unauth public-repo constitution fetch), bug-237 (legacy bare-path hub-doc write/delete — **fixed**, work-159 / PR #517). Fixes shipped (bug-237 via work-159) or queued (work-157/158).
- **Doctrine**: idea-427 (compaction-native + no-self-certified-stops, axiom-candidate), banked recall-proof in both agents' memory.
- **Design cluster (idea-424–441)**: the software-defined workgraph → knowledge-as-graph-actuation → cold-start hydration → thin-shim universality → knowledge walks / JIT projections → layered interpretation → axiom health metrics → hybrid pull/push delivery. One coherent architecture; a strong candidate for the arc after this. To be consolidated into a design-brief at arc-open.
- **Profile refinement**: axiom-first ranking + the two-mode application (tie-break lean for Director decisions; internalized-value guidance for delegated architect jurisdiction).

## 5. Post-arc graph

work-158 (unauth constitution fetch, Director-directed) · the constitutional pen track (idea-426 generalized — axiom normative-body purge, completes Option A) · **mission-104 (idea-444) audit-entity retirement** (in design) · work-160 (ultracode-on-always in ois) · bug-234/235 fixes · the idea-424–443 constitutional/knowledge-substrate arc (adds idea-442 divergence-flagging, idea-443 orchestrator conduct).
