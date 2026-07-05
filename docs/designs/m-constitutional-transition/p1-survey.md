# M-Constitutional-Transition (mission-103) — P1 Survey

**Version:** v1.0 — staged for G1 seal (rail decision, director-direct)
**Inputs consumed:** intent-brief v1.0 (G0 = decision-14) · consumer-inventory (work-141) · sync-mechanics memo (work-142) · live entity census (`list_tele`, 15 active) · mission-kit axiom set (A0–A14, apnex/mission-kit @ HEAD 2026-07-05)
**Co-design provenance:** three Director-resolved contested calls this session (S1–S3 below), structured single-topic queries; mechanical findings architect-assembled.

---

## 1. The headline finding: the migration map is a verification table, not a design

The mission-kit axiom set **already is** the tele set, ported project-agnostic: A0 ↔ tele-14 (umbrella; tele-14 superseded tele-0 at the 2026-07-04 refresh), A1–A13 ↔ tele-1–13 one-to-one by name and substance, A14 ↔ tele-15 (the proven pilot pair). Fifteen live teles, fifteen axioms, zero orphans either direction.

### Disposition map (all 15: MECHANICAL)

| Tele | Axiom successor | Tag | Note |
|---|---|---|---|
| tele-1..tele-13 | A1..A13 (same ordinal) | mechanical | verifier checks per-pair fidelity (mandate/mechanics/faults/SC parity, org detail confined to provenance) |
| tele-14 (umbrella) | A0 | mechanical | org-voice remainder → charter vision (S2) |
| tele-15 | A14 | mechanical | the pilot pair; already dual-recorded |
| tele-0 | — (superseded by tele-14 pre-arc) | historical | no disposition needed; history immutable |

**T3 consequence:** ONE batch ratification covers the whole map (verifier fidelity audit as its evidence); the individual-decision track is not needed for mappings — the Director's contested attention went to S1–S3 instead. Retirements: none.

## 2. Director-resolved contested calls (this session)

| # | Question | Director decision |
|---|---|---|
| S1 | Charter content | **Bindings + vision + Director profile.** The charter carries: (1) the axiom bindings A0–A14, each with ratifying decision + date; (2) this org's north-star vision (the org-voice remainder of tele-0/14; roadmap anchor); (3) the Director profile — the org instance of the revealed-preference record A13 mandates. All three rail-governed. |
| S2 | (folded into S1 vision clause) | — |
| S3 | Constitutional pen | **Agent gauntlet + Director merge.** Any agent authors (M6 discipline); engineer+verifier adversarial gauntlet reviews; MERGE of `axioms/` + `methodology/` requires the Director — enforced via mission-kit CODEOWNERS = apnex. Agents sharpen the law; only the Director enacts it. |

## 3. Narrowed option space handed to the design council

1. **Sync/serve (axis 1):** engineer memo (work-142) narrows to **A1 poll on the existing RepoEventBridge pattern + B1 HEAD-of-main with per-sync sha provenance**, atomic snapshot swap, fail-open-stale serve, fail-closed malformed-sync, provenance-beside-content. Council validates or overturns with cause; A3 (read-through cache) is eliminated (fails recall-proofness).
2. **Tool surface (axis 4 — center of gravity):** council designs the verb set and payload shapes. Survey-narrowed envelope: read verbs for axioms (`list_axioms`/`get_axiom` naming TBD) + charter read verb(s) + charter mutation verbs (rail-governed per T2); storage shape choice (document-store rows vs dedicated `Axiom` kind via the 6-step checklist) is the council's first structural call; every serve response carries `{sha, syncedAt, stale?}`.
3. **Charter entity (axis 3):** shape per S1 (three sections); governance verbs ride the decision rail; council specifies the schema + binding-record fields.
4. **Cut sequencing (axis 5):** the inventory's 8 constraints are BINDING design inputs — headline: PR #487 lands/closes before the glossary tombstone; `docs/specs/teles.md` is a load-bearing test fixture (re-point in the same commit); `docs/calibrations.yaml` (176 refs) gets a mechanized rewrite; `Turn.tele` is a live schema change (kind-migration checklist). SC1's operational definition (inventory §6) is adopted verbatim as the cut's done-condition.

## 4. Design-inputs register

| # | Input | Source |
|---|---|---|
| R1 | Wake not roll-durable — G0's own confirm lost its notification to a deploy roll; backstop + outbox split (backstop = correctness) | bug-231; work-144; G0 evidence |
| R2 | 1:1 axiom↔tele isomorphism (the headline) — migration is verification, not design | this survey §1 |
| R3 | The 8 sequencing constraints + SC1 gate-greps | consumer-inventory §6–7 |
| R4 | Sync constraints C1–C7 (git-less Hub, existing bridge, bug-225 law, recall-proof bar) | sync memo §0 |
| R5 | `list_documents` pagination broken (offset ignored, total off-by-one) — completeness-critical sweeps must not trust it until fixed | bug-232 (found by work-141) |
| R6 | Standing live-verify probe fixture wanted (3 improvised probes in one night) | idea-421 |
| R7 | Mission pulse cadence should be phase-aware (build vs co-design pace) — retuned by hand this arc | mission-103 escalation 12:21Z |
| R8 | Dual-home doc (git+hub) divergence bit twice in one day — single-writer flow or substrate mirroring wanted; this survey authored git-first, hub-mirrored once | retro incident + G0 brief flow |

## 5. G1 seal scope

Sealing this survey commits: the disposition map (§1) as the batch-ratification payload for the design gate; S1/S3 as design constraints; §3 as the council's commissioned option space; §4 as accreted inputs. The council (P2) commissions on seal: three seats position against this survey + the two evidence docs, clash, synthesize; G2 ratifies the design; build follows per the ratified slices.
