# M-Constitutional-Transition (mission-103) — Intent Brief

**Version:** v1.0 — staged for G0 ratification (rail decision, director-direct)
**Arc:** idea-420 · full mission-102 process (Director-ratified 2026-07-05: intent → survey → design council → gated build; co-design at survey+design; gates ride the decision rail)
**Provenance:** Intent Session 1 with the Director, 2026-07-05 ~11:50–12:03Z, five structured single-topic queries (idea-416 discipline), all decisions Director-made live
**Authority note:** every decision in §2 is Director-made; this brief is their assembly, not interpretation.

---

## 1. Purpose and problem

The Tele set (tele-0..15) is the org's constitutional layer today: 16 Hub entities served by five MCP verbs (`list/get/create/retire/supersede_tele`), decoded by a glossary doc, cited inline across the methodology corpus and CLAUDE.md Tier-0 cold-pickup surfaces. The Director has directed its replacement (axiom-first primacy, 2026-07-05, A14 provenance): **mission-kit axioms** (github.com/apnex/mission-kit) become the constitutional layer, served through a **new, carefully designed tool surface**. The A14/tele-15 dual-record was the proven pilot; this arc completes the transition and retires the Tele surface entirely.

## 2. Ratified intent decisions (Session 1, 2026-07-05)

| # | Topic | Director decision |
|---|---|---|
| T1 | Constitutional stack | **Two layers**: mission-kit axioms = universal, project-agnostic law (adoptable by any org); a **Hub-native org charter** = this org's specific mandates (ex tele-0 vision, ex tele-13) + its axiom bindings with provenance. Every tele maps to: axiom \| charter \| retired. |
| T2 | Write path | **Git-canonical, Hub read-serve**: axioms author/amend ONLY via mission-kit PRs (the PR gauntlet is the ratification act; git history is constitutional history). Hub syncs and serves read-only axiom verbs; charter mutations are Hub verbs governed by the decision rail. No Hub→git write-back machinery. |
| T3 | Migration ratification | **Split by contestedness**: survey produces the full 16-tele disposition map; mechanical mappings ratify as ONE batch decision; contested dispositions (vision distillation, tele-13, any retirement) come to the Director as individual rail decisions. Expected Director cost ≈5–7 decisions. |
| T4 | Cutover | **HARD CUT at arc close**: all five tele verbs removed, glossary tombstoned, every doc/CLAUDE.md reference migrated — in one cut, inside the arc. No half-states; the consumer sweep is in-arc build scope and any straggler blocks close. Tele entities remain in substrate history (zero-loss; unserved ≠ deleted). |
| T5 | Scope boundary | **Axioms + charter only.** Methodology (M1–M6 serving, MREQ-1 application methodology) is OUT — its own follow-on arc. This arc stays ~mission-102 sized. |

## 3. Constitutional constraints

1. **Due-diligence gate** — survey + council design complete and Director-ratified before ANY build (inherited; verifier holds it).
2. **Director co-designs** — survey and design run as interactive sessions, structured single-topic queries, one decision at a time.
3. **Axiom-first primacy** — mission-kit is the first-class record; the Hub serves, never owns. Axiom bodies stay project-agnostic (M6/A14 authoring discipline); org detail lives in charter or provenance only.
4. **Tele set frozen at G0** — no create/retire/supersede_tele calls from ratification forward (verb removal lands with the T4 cut; the freeze is effective immediately by fence).
5. **Gates ride the rail** — G0–G3 are rail decisions, director-direct, resolved via `ois confirm` (now round-tripping silently post bug-229/230).
6. **Recall-proofness is the bar** — a cold-start agent must recall the constitutional layer from the new surface alone; the transition fails if the dead layer remains recallable as live truth (this killed the read-only-freeze option at T4).

## 4. Survey scope (P1 — the six axes, now framed by §2)

1. Sync/serve mechanics: mission-kit → Hub (snapshot cadence, drift detection, version pinning).
2. The 16-tele disposition map with contested/mechanical tagging (feeds T3's split ratification).
3. Charter entity design: shape, binding records, provenance, rail governance verbs.
4. New tool surface: read verbs (axioms + charter), naming, payload shapes — **council center of gravity**.
5. Consumer inventory for the T4 hard cut: every tele-N citation (docs, CLAUDE.md Tier-0, glossary, agent memory surfaces) with its migration target.
6. Constitutional-PR review model: who reviews mission-kit axiom PRs (flagged at T2 — the gauntlet is the ratification act, so its reviewer set is a constitutional question).

## 5. Success criteria (draft — hardened at G0)

1. Zero live tele-N references at arc close: verbs gone, glossary tombstoned, docs/CLAUDE.md migrated (verifier-audited hard cut).
2. All 16 teles carry a ratified disposition (axiom / charter / retired) with provenance chain to the ratifying decision.
3. Cold-start recall-proof: a zero-knowledge agent reconstructs the constitutional layer solely from the new surface.
4. mission-kit remains project-agnostic — no org detail in any axiom body (verifier-checked against M6 discipline).
5. Every charter binding/amendment traces to a rail decision.
6. The arc's own gates rode the rail (inherited meta-dogfood).

## 6. Fences

No new teles (constraint 4). No methodology scope (T5). No Hub write-back to git (T2). No build before G2. Event-scoping generalization stays idea-355; skill dissolution stays idea-418; MREQ-1 stays mission-kit backlog.

## 7. Deferred (named)

Methodology serving + MREQ-1 arc; standing live-verify probe fixture (idea-421 — may land as rail infra independently); dual-home doc mirroring mechanism (observed friction, unfiled as arc scope).
