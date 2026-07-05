# M-Constitutional-Transition — Design v1.0 (THE BUILD CONTRACT)

**Status:** staged for G2 ratification (rail, director-direct)
**Synthesis of:** three independent council positions + clash-divergence-map (5 divergences: 3 resolved by argument with recorded movement, 1 by ratified constraint T1, 1 by adoption) · sealed G1 survey · consumer inventory · sync memo
**Ratified lineage honored:** T1 two-layer stack · T2 git-canonical/read-serve · T3 one-batch + contested singles (none needed) · T4 hard cut · T5 tight scope · S1 charter contents · S3 constitutional pen

---

## 1. Storage

**`ConstitutionSnapshot`** — singleton row, id `current` (engineer E-1 + verifier manifestHash):
`{sha, syncedAt, manifestHash, files{path→verbatim md}, manifest[{id,title,path,contentHash}], status}`. Written ONLY by the sync loop via single-row CAS (the swap IS the commit point; roll-durable by construction). Prior snapshots retained as history rows. Axiom content is opaque verbatim markdown — validation is a sync-time parse gate, never a schema at rest (git is canonical; a hub schema would be a second authority).

**`OrgCharter`** — Hub-native versioned entity (T1-ratified home): `{bindings[], vision{text, ratificationRef, amendedAt}, directorProfile{summary, profileDocRef, ratificationRef, amendedAt}, charterVersion, supersedes}`. Append-only versions. Binding record = engineer's E-3 schema verbatim: `{axiom, predecessor?, ratifiedBy: decision-N, proofRef: dconf-N, ratifiedAt, status: bound|superseded|unbound, supersedes}`.

Both kinds via the 6-step new-kind checklist (~1h each, priced).

## 2. Tool surface (RBAC [Any] — the constitution is for everyone)

| Verb | Returns |
|---|---|
| `get_constitution` | THE COLD-START VERB: manifest + every axiom body + charter + provenance, one call (recall-proofness = one round trip) |
| `list_axioms` | manifest rows + snapshot provenance |
| `get_axiom {axiomId}` | one verbatim body + provenance |
| `get_charter` | current charter version + binding provenance |

**Payload law:** every response carries `provenance {sourceRepo, sha, syncedAt, manifestHash, stale?, ageSeconds?}`; charter responses add per-binding `{ratifiedBy, proofRef}`. Responses omitting provenance are contract-test failures.
**Zero axiom write verbs (enforcement by absence). Zero free-form charter verbs:** charter mutation exists only as registry actions (`bind_axiom`, `amend_charter` — B5 atomic resolve+execute), so every charter change structurally carries a decision id + authority proof (SC5 structural). Steve's authority tests (no-raw-writes, rail-required, binding exactness, append-only, self-reference guard) are binding.
**First boot:** loud `not_synced` error (distinct from empty); a sync-on-start tick makes the window seconds. No unlabeled bootstrap content ever.

## 3. Sync

A1 poll on the RepoEventBridge pattern (60s-class, existing PAT/rate-budget/cursor kinds) + B1 HEAD-of-main. Pipeline per tick: HEAD-sha check (1 call) → on change: fetch-all → parse gate (fail-closed whole-snapshot) → referential gate (binding `axiom:` ids resolve in-snapshot; fail-closed) → build candidate → single-row CAS swap → post-commit best-effort `constitution-updated-notification` (role-targeted; loss costs latency never correctness — the bug-231 lesson applied at birth). Post-sync drift probe verifies `ratifiedBy`/`proofRef` resolve to live hub entities (loud, never blanking). Fail-open-stale on repo/API failure (`stale:true` + age; serving never blanks). Webhook deferred; A3 dead.

## 4. The batch migration (T3)

ONE rail decision ratifies all 15 pairs (tele-1..13→A1..13, tele-14→A0, tele-15→A14; tele-0 historical). Its required evidence: the verifier's mechanical fidelity suite over every pair — cardinality/isomorphism, mandate parity, mechanics parity, fault-boundary parity (the anti-laundering scar check), success-criteria parity, org-detail confinement (grep-enforced: org strings only in provenance), provenance echo. Executing the decision stamps one `{ratifiedBy, proofRef}` across all 15 binding rows via `bind_axiom`.

## 5. Build slices (each verifier-gated, additive-before-destructive)

- **S0** preconditions: PR #487 landed/closed (tombstone-surface conflict).
- **S1** serve substrate: both kinds + sync loop + 4 verbs + contract tests (atomic swap · fail-open-stale · fail-closed-malformed · not_synced · referential gate · provenance echo · rate budget). Live-verify: served sha == mission-kit HEAD on a real tick.
- **S2** charter + THE BATCH: charter authored (vision distilled from tele-14 org voice; profile summary), batch decision executed with fidelity audit, bindings ×15, drift probe live.
- **S3** mechanized rewrite (both surfaces still resolve): mapping-table script — calibrations.yaml first (176 refs), then 28 axiom-ref + 3 charter-ref surfaces. One PR; reviewers check the mapping once.
- **S4a** code cut: 5 verbs + TelePolicy + repository + Tele kind/schema/tests deleted; 48 modify surfaces; `Turn.tele` dropped via kind-migration checklist (old envelopes tolerated on read); 11 test probes re-pointed to `get_agents`; bug-25 fixture re-point rides the same commit as teles.md work.
- **S4b** tombstones: teles.md, tele-glossary.md, vision-synthesis.md, entities.md row, hub `teles` doc → tombstone notes (steve's boundary: no live semantics, no verb exposure). SC1 STATIC GATE runs green in this slice's evidence.
- **S5** close: SC1 LIVE GATES — tool-catalog negative proof (tele verbs = unknown-tool; new verbs discoverable), hub-doc sweep (exhaustive-partition until bug-232 fixed), the POST-DEPLOY COLD-START PROBE (steve's §3 rubric verbatim: fresh session, new surface only, cites provenance, refuses tele as live authority, negative control included) — then memory-owner notifications (5 files), retro, G3.

## 6. Binding contract-test floor

Verifier position §1 adopted in full (fidelity ×7, sync ×6, provenance/read-surface, charter authority ×5) + engineer's not_synced structural distinctness + the gameability defenses (§4: rename-laundering, historical-leave overuse, catalog shadowing, stale-pretending-fresh, partial snapshot, provenance omission, charter bypass, fixture hiding, memory residue, org contamination) each traced to at least one test or gate.

## 7. Deferred (named)

Methodology serving + MREQ-1 (T5); webhook accelerator; bug-232 fix (only gates the hub-doc sweep method); standing probe fixture (idea-421); org-repo split for charter source (revisit only if charter-in-Hub friction is ever observed).
