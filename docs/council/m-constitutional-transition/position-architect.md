# mission-103 P2 Council — Architect Position

**Seat:** architect (lily) · **Status:** committed position for the clash (work-145)
**Written against:** sealed G1 inputs only (survey v1.0, consumer-inventory, sync memo, intent brief). Other seats unread.

---

## 1. Tool surface

**Three read verbs, one action, no more.**

- `list_axioms` → `[{id, title, status, sourceTele}]` + snapshot provenance `{sha, syncedAt, stale?}` once at envelope level, not per row.
- `get_axiom {axiomId}` → full body (mandate/mechanics/rationale/faults/success-signals/provenance sections as structured fields, not one blob) + the same snapshot provenance beside content.
- `get_charter` → the whole charter in one read: `bindings[] + vision + directorProfile + charterVersion + provenance`. One verb, not three — the charter is small by construction (S1 bounded it to three sections) and a cold-start agent should recall the org's constitution in ONE call. Recall-proofness (intent §3.6) argues for minimum round trips.
- **Charter mutation is NOT a free verb.** `bind_axiom` / `amend_charter` enter the action registry (B5 pattern) and execute only as the plan of a rail-ratified decision — the same atomic resolve+execute machinery grant-minting uses. This makes "every charter change traces to a rail decision" (intent SC5) structural rather than policied: there is no code path that mutates the charter without a decision id.

Naming: flat (`list_axioms`, not `constitution_list_axioms`) — consistent with every existing surface (`list_tele` precedent, ironically).

## 2. Storage shape

**Dedicated kinds: `Axiom` (synced, serve-only) + `Charter` (Hub-native singleton).** Not document-store rows.

- The constitution must be *distinguishable from documents* to be recall-proof: a cold agent asking "what is the law here" should hit a typed surface, not grep a doc namespace. Filterable keys, schema validation, and the drift-gate all come free with a kind; the 6-step checklist is a known ~1-hour cost, done five times in the last arc, twice more is cheap.
- `Axiom` rows are **written only by the sync loop** (atomic snapshot swap replaces the whole set); no agent-facing write verb exists at all. The read-only-ness is enforced by absence, the strongest enforcement there is.
- `Charter` is one entity, versioned (`charterVersion` increments per executed amendment decision), with the ratifying decision id stored per section touch.

## 3. Charter schema

```
Charter {
  bindings: [{axiomId, ratificationRef: decision-N, boundAt, note?}],
  vision: {text, ratificationRef, amendedAt},
  directorProfile: {summary,               // durable revealed-preference core
                    profileDocRef,          // pointer to the living methodology doc
                    ratificationRef, amendedAt},
  charterVersion, updatedAt
}
```

The profile section holds the *durable* core inline (what a cold agent must recall) and points to the living `director-profile.md` for the full record — the profile churns too often for every nuance to ride rail amendments, but its constitutional summary should not drift silently, so the summary is rail-governed and the doc is not. This split is the one place I expect clash.

## 4. Sync

**Validate A1+B1 wholesale.** The memo's constraint analysis (C1–C7) is correct and complete; A3 rightly dies on recall-proofness. Two additions as design requirements, not amendments: (i) the sync loop emits its snapshot-swap notification through the role-targeted path with the new sha — the constitution moving is an event agents may care about; (ii) first-boot: seed from a build-time copy marked `bootstrap: true` rather than blocking serve — a Hub that says "no constitution yet" fails recall-proofness at exactly the moment (cold start) the bar exists for. Bootstrap-then-sync gives a constitution that is at worst minutes stale, never absent.

## 5. Cut plan (slices, each verifier-gated)

- **X1** Sync loop + `Axiom` kind + `list_axioms`/`get_axiom` (+ bootstrap seed). Contract tests: atomic swap, fail-open-stale, fail-closed-malformed, provenance echo, first-boot.
- **X2** `Charter` kind + `get_charter` + registry actions (`bind_axiom`, `amend_charter`). Contract tests: no mutation path without decision id; version increments; section-level ratificationRef.
- **X3** THE BATCH: 15-pair fidelity ratification through the rail (one decision, verifier fidelity audit as evidence) + charter seeded (bindings ×15, vision distilled from tele-14's org voice, profile summary) via the new actions. **This is the moment the axioms become this org's law.**
- **X4** Mechanized doc sweep: calibrations.yaml rewrite script (176 refs, tele-N→A-N is a pure mapping), the 28 axiom-ref doc rewrites, the 3 charter-ref rewrites. Script + diff as evidence, not hand edits.
- **X5** Code cut: 5 verbs + TelePolicy + repository + kind removal; `Turn.tele` schema migration (kind-migration checklist); the 11 test-fixture re-points (incl. teles.md fixture and list_tele probe verbs). Sequencing constraint: lands only after X1 exists (the re-pointed probe verb needs a successor).
- **X6** Tombstones: teles.md, tele-glossary.md (after PR #487 disposition — land it first, it is current-truth until X3), vision-synthesis.md, entities.md row, hub `teles` doc; CLAUDE.md Tier-0 rewrite to the charter/axiom surface; memory-owner notifications (§5 flag list).
- **X7** SC1 gate: the inventory's gate-greps run green (verifier-audited); cold-start recall probe (a fresh session recalls the constitutional layer from `list_axioms` + `get_charter` alone); G3.

Order: X1→X2→X3 strictly serial (each feeds the next); X4 parallel after X3; X5 after X1; X6 after X3+X5; X7 last. PR #487 disposed before X6 (constraint honored).

## 6. Named risks I want the clash to test

1. The profile inline/pointer split (§3) — is the two-speed governance defensible or a laundering hole?
2. Bootstrap-seed (§4.ii) vs "not-yet-synced should say so" — I chose availability over explicitness; the verifier seat may reasonably invert that.
3. One `get_charter` vs per-section reads — payload size vs round trips at cold start.
