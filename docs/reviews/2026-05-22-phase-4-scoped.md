# Strategic Review — 2026-05-22 — Phase 4 (Scoped)

**Status:** Phase-4 investment-prioritisation record. Partial-scope review.
**Director-ratified:** 2026-05-22.
**Companion methodology:** `docs/methodology/strategic-review.md`.

## 1. Scope declaration

Per the strategic-review.md partial-scope guardrail, this review ran **Phase 4
(Investment Prioritisation) only** — a focused next-version prioritisation over
the post-mission-83/86 follow-on candidate cluster.

| Phase | Status |
|---|---|
| Phase 1 — Inventory & Cartography | not run (see inheritance) |
| Phase 2 — Friction Cartography | not run |
| Phase 3 — Concept Extraction / Defect Classes | not run |
| Phase 4 — Investment Prioritisation | **ran** |

- **Inherited baseline:** `docs/reviews/2026-04-phase-1-cartography.md` (~30 days
  old) for the legacy backlog. The candidate cluster (§2) was assembled directly
  from the live ledger (`list_ideas`, 2026-05-22).
- **Out of scope:** the 226-idea legacy backlog. It has not been cartographied
  since April — past the methodology's own backlog-rot trigger (>10 queued /
  >90 days). Flagged for a separate Phase-1 cartography + ledger-hygiene pass
  (§5).
- **Scope creep:** none observed.

## 2. Candidate cluster — tele triage

The live mission-candidate surface — the post-mission-83/86 follow-on cluster:

| Idea | Candidate | Teles | Phase-4 group | Effort |
|---|---|---|---|---|
| 306 | Rocky VM re-platform (COS→Rocky) | tele-7 · tele-9 | blocker — gates root/kernel work | M |
| 295 | Hub-Storage ResourceVersion | tele-1 · tele-8 · tele-7 | structural — integrity | M |
| 299 | Hub-Storage BlobBody-Substrate | tele-1 · tele-7 | structural — live degradation | M |
| 296 | Hub-Storage Audit-History | tele-1 · tele-4 · tele-7 | structural — enhancement | M–L |
| 297 | Hub-Storage FK-Enforcement | tele-1 · tele-3 · tele-8 | structural — enhancement | M |
| 302 | Task-entity engineerId→agentId completion | tele-1 · tele-3 · tele-8 | quick-win | S–M |
| 308 | Remove deploy/base + deploy/cloudrun | tele-2 · tele-3 | quick-win | S |
| 309 | Docs-currency pass | tele-2 · tele-4 · tele-5 | quick-win | S |
| 307 | Fully-native plugin install | tele-6 · tele-3 · tele-2 | velocity-multiplier | L |
| 304 | Commit-Push mission-broadcast | tele-6 | blocked | — |

Ranking heuristic (per strategic-review.md Phase 4): tele leverage × execution
cost × unblocking power.

## 3. Ratified output

**One mission ratified: mission-87 — M-Currency-Cleanup-Wave**
(`substrate-cleanup-wave`).

The Phase-4 draft surfaced three prioritised mission briefs — Rocky ·
ResourceVersion · the cleanup-wave. The Director narrowed the cycle to the
**cleanup focus**: mission-87 bundles the three quick-win cleanup candidates —
idea-308 + idea-309 + idea-302 — as a three-slice cleanup-wave (compressed
lifecycle; Survey waived per Idea-Triage route-a). Full plan on the mission-87
entity.

Rationale: discharges accumulated post-mission-62/83/86 currency + cleanup debt
(tele-2 primary) at low risk and high value-per-cost before the next structural
mission.

## 4. Anti-goals — deliberately deferred this cycle

| Deferred | Rationale |
|---|---|
| idea-306 Rocky VM re-platform | Director-approved, blocker-class — held to a dedicated next-cycle mission so its root/kernel-change Survey input gets proper rigour. |
| idea-295 ResourceVersion | Substrate integrity-hardening; next-cycle structural lead. |
| idea-299 BlobBody-Substrate | Live degradation, but Director consciously accepted it at mission-83 (recoverable from audit-trail). The strongest challenger to the cleanup focus. |
| idea-296 Audit-History | Pure enhancement; builds cleaner atop 295. |
| idea-297 FK-Enforcement | Self-deferred — wants entity-shape stabilised first. |
| idea-307 native plugin install | L-cost; full Survey+Design + import-cycle resolution; too heavy for this cycle. |
| idea-304 Commit-Push-Broadcast | Hard-blocked on missioncraft v1.2.0 (mission-78). |

## 5. Carry-forward

- **Full Phase-1 cartography + ledger-hygiene pass** over the 226-idea legacy
  backlog — overdue; next strategic-review event.
- idea-306 (Rocky) + idea-295 (ResourceVersion) — the deferred Phase-4
  candidates; lead the next cycle.
- Calibration candidate (surfaced 2026-05-22): *architect-side mission-lifecycle
  artifacts (Design / Survey / Preflight / trace) must be verified merged to
  main at mission-close.* Exposed when mission-86's architect docs were found
  branch-only during the 2026-05-22 worktree-sync (salvaged via PR #250).
  Director disposition pending.
