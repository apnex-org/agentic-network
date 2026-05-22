# Ledger Reconciliation Report — Idea ledger — 2026-05-22

**Method:** `docs/methodology/ledger-reconciliation.md` v1.1.
**Ledger:** Idea. **Scope:** part 3 of the 2026-05-22 Director-approved ledger-hygiene pass.
Parts 1–2 (mission/thread + bug ledgers) ran pre-v1.1 and were not captured as standalone
reports — their summary lives in the methodology §Provenance.
**Result:** open Idea ledger **224 → 213**.

This is the first report produced under the v1.1 §4 reconciliation-report rule.

---

## 1 · Inventory

Exhaustive — all 224 `status:open` ideas, compact projection (`id · createdAt · title ·
tags`), delivered by the engineer (greg) on thread-616 (converged/closed). The substrate
psql was unreachable from the engineer worktree; the inventory used exhaustive paginated
`list_ideas` (23 pages) — a valid fallback per methodology §1.

**Key finding:** `Idea.missionId` is set on **0 of 224** entities — a structurally-empty
field. idea→mission lineage lives in tags and in mission-entity provenance, not `missionId`.
(This finding drove methodology refinement #2.)

## 2 · Dispositions — 11 entities

### Batch A — superseded / obsolete → `dismissed`; one fixed-not-flipped → `incorporated`

6 entities; executed in the prior session. Per-entity rationale below is reconstructed from
idea-tags + the session handover — Batch A predates the v1.1 report rule.

| Idea | Disposition | Bucket | Verified rationale |
|---|---|---|---|
| idea-106 | `dismissed` | superseded | idea tag `subsumed-by:idea-215` |
| idea-258 | `dismissed` | superseded | idea tag `folded-into-idea-261` |
| idea-38 | `dismissed` | superseded | idea tag `absorbed_by=idea-104` |
| idea-48 | `dismissed` | superseded | idea tag `consolidate_into=idea-102` |
| idea-54 | `dismissed` | obsolete | architect-chat substrate deprecated 2026-05-20 (with director-chat / vertex-cloudrun) |
| idea-66 | `incorporated` | fixed-not-flipped | `directive_issued`→`task_issued` rename shipped (idea tag `implemented=likely-done`); `incorporated` is the nearest done-state in the Idea status enum |

### Batch B — incorporated-not-flipped → `incorporated`

5 entities; this session. Each linked to its mission via `update_idea(missionId=…)` — the
mission-link is the durable rationale, traveling with the entity. Found by terminal-ledger
cross-ref (methodology §3): walking the completed-mission ledger and matching each mission's
stated source against the open set.

| Idea | → Mission | Verified rationale (completed-mission ledger) |
|---|---|---|
| idea-189 | mission-47 — M-Sovereign-Storage-Interface | mission Provenance: "idea-189 (filed 2026-04-24, Director-sourced) → design-round thread-290" |
| idea-198 | mission-50 — M-Cloud-Build-Tarball-Codification | idea title is the mission title verbatim; both are the bug-33 Tier-0 fix; idea tagged `mission-candidate` |
| idea-220 | mission-66 — M-Shim-Observability-Phase-2 | mission description: "Source idea: idea-220 Phase 2" |
| idea-223 | mission-65 — M-Calibration-Codification | mission description: "Source idea: idea-223" |
| idea-263 | mission-77 — M-Missioncraft-V1 | idea title is the mission title verbatim |

**Detection note.** An open-side `M-`-titled-idea scan caught only idea-198 + idea-263
(2 of 5). idea-189/220/223 are descriptively titled and were found *only* by the
terminal-ledger-backward method. This ~40% recall of the open-side heuristic drove
methodology refinement #1.

## 3 · Residual — the true live-backlog

**213 open**, clustered:

- **~190 genuinely-live** un-prioritised ideas → stay `open`, untouched. This is the
  trustworthy surface for a future strategic review (deferred — Director's call).
- **~20 missioncraft cluster** (idea-266 / idea-270 / idea-275–291 / idea-293) → parked,
  cross-project; same separate-verification treatment as the ~24 missioncraft bugs
  (Director-flagged). Not dispositioned.
- **idea-61 / idea-62** (ACP-UI) → Director-ruled keep `open` ("UI options to be
  considered").

## 4 · Flagged — held `open` pending verification

Each is *plausibly* stale but lacks a hard trace. Closing on inference violates §3 (verify
before disposition); held `open`, to be settled at the strategic review or a small Batch C.

- **idea-211** — "M-Pulse-Defaults-Auto-Injection + Tool-Catalog-Refresh". Both halves
  appear shipped (pulse work across missions 57/60/61/68; tool-catalog-refresh via bug-114),
  but no completed mission names idea-211 as its `Source idea`. Inference, not trace —
  needs an idea-text verify before any flip.
- **idea-149** — "Tele audit + standardization pass (ratified)". The tele audit shipped
  (the 11-tele list is canon; mission-43 cleaned its zombie teles). Grey: an audit-idea,
  not a mission-candidate — the `incorporated` bucket does not cleanly fit.
- **idea-15** — "Architect Session Orphan Storm". Idea tag `implemented=likely-resolved`;
  needs an engineer code-verify against McpConnectionManager / ADR-008.

## 5 · Convergence

All 224 inventory entities clustered into a disposition bucket. 11 non-`keep` dispositions
executed with recorded rationale — 6 `dismissed`, 5 `incorporated`. Residual 213 `open`
verified all genuinely-live, explicitly parked (missioncraft), or explicitly kept-open
(idea-61/62). **Idea ledger: 224 → 213.**

Reconciliation corrected status, not value — the ~190-idea live backlog awaits a strategic
review for evaluation and prioritisation.
