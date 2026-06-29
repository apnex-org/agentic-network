# Ledger Reconciliation — 2026-06-29 — stint-6 Strategic Review (reconcile_anchor)

**Node:** `work-bp-stint6_strategic_review_20260629-reconcile_anchor` (engineer: greg / agent-0d2c690e)
**Methodology:** `docs/methodology/ledger-reconciliation.md` v1.1 (pinned @2f89016) — 5-step process + terminal-ledger BACKWARD cross-ref.
**Purpose:** produce a clean, reconciled live backlog as the ground-truth SR input (FM-5: a stale backlog is not a valid SR input). Reconciliation is **intake-neutral** — NO ranking/clustering/value-judgement (that is downstream SR work).

> **v2 cosmetic correction (count-consistency):** the bug counts below are corrected to the psql-confirmed authority — non-terminal bug universe = **41 = 40 open + 1 investigating** (matches the SR evidence-pack manifest). An earlier label said "43 open"; that conflated the pre-flip non-terminal total (42 open + 1 investigating = 43) with "open". The 2 flips (bug-190/195) are unchanged + correct; zero candidate/disposition impact.

## Reconciliation anchor (byte-stable baseline)

| Field | Value |
|---|---|
| **Wall-clock** | `2026-06-29T03:48:46Z` |
| **Repo HEAD sha** | `3cff84e` |
| **Reconciler** | greg (engineer) |
| **Method** | exhaustive read-only inventory + backward cross-ref via a 41-agent workflow; flips executed by the parent |

Every downstream gather query stamps this anchor (run `status:any` as-of this baseline) for byte-stable reproducibility.

## Per-ledger reconciliation

| Ledger | Before | After | Flips | Notes |
|---|---|---|---|---|
| **Ideas** | 277 open | 277 open | **0** | Backward cross-ref over 55 completed missions: NO open idea's id explicitly appears in any completed mission's linked source-ideas — mission-incorporated ideas were already flipped to `incorporated` at mission completion. Zero incorporated-not-flipped rot. (`idea → incorporated/dismissed` is architect-only; moot here — no flips warranted.) |
| **Bugs** | 42 open + 1 investigating (43 non-terminal) | 40 open + 1 investigating (41 non-terminal) | **2 → resolved** | bug-190 + bug-195 — both MAJOR, both with main-merged fixes left marked open. The main rot this pass. 3 low-confidence held for Director (below). |
| **Missions** | 55 completed, 1 active | unchanged | **0** | mission-94 is the sole active mission; ledger clean. Observation: mission-91 appears in neither completed nor active/proposed (gap) — terminal/abandoned or never-materialised; flagged for Director confirmation, no unilateral flip. |
| **Teles** | 14 active | unchanged | **0** | tele-0..tele-13 all active; clean. (Note: per audit-5088, Teles is a CANDIDATE family for the downstream SR — 14/14 psql-confirmed.) |
| **Proposals (Designs)** | 33 | unchanged | **0** | Predominantly legacy pre-provenance `approved` Designs (April); proposal-status reconciliation out of scope this pass (statuses approved/implemented — terminal-ish). |

## Status flips EXECUTED (2)

| Entity | Bucket | Disposition | Verified rationale |
|---|---|---|---|
| **bug-190** (major — "repo-event-handler drainer fails DARK") | fixed-not-flipped | `open` → `resolved` | Closed by work-44 PR-2 / **PR #430** ((A)+(d) repo-event-bridge poll+deliver coupling), merged to main as **db2e64e** ("...closes bug-190 (#430)"); PR-1 #429 = 17b54b2. fixCommits stamped `[17b54b2, db2e64e]`. |
| **bug-195** (major — "deploy-hub CD-hardening") | fixed-not-flipped | `open` → `resolved` | Shipped by **PR #413**, squash **0491e2e** on main ("bug-195 — deploy-hub CD hardening: concurrency-cancel + roll-coalesce + roll-confirm gitSha>=expected"). Both named halves ship. fixCommits stamped `[0491e2e]`. |

Both flips: the fix commit was verified an ancestor of `origin/main` before flipping; tagged `reconciled-2026-06-29-stint6-sr`.

**Count note (authoritative):** the live non-terminal bug universe at the anchor = **41 = 40 open + 1 investigating** — psql-confirmed via `get-entities.sh Bug` and identical to the SR evidence-pack coverage manifest (candidate family, audit-5088). Pre-flip it was 42 open + 1 investigating (43 non-terminal); the 2 flips reduced it to 41.

## Low-confidence — FLAGGED for Director review (NOT flipped)

Conservative per methodology (a guess that closes an entity hides a live problem):

| Entity | Suspicion | Why held |
|---|---|---|
| **bug-183** (adapter-version misreport) | partially fixed | idea-355 SLICE-0/#377 inlined the kernel version for the OPENCODE bundle (the "reported-half"), but bug-183 is greg-owned re: `advisoryTags.adapterVersion` (network-adapter version, not sdkVersion); follow-on idea-360 is bug-183-adjacent. Adapter-version half likely still live. |
| **bug-146** (task-dispatch identity/claim gap) | possibly superseded | mission-90 W1 references a bug-146 completion-equivalence record, but the dispatch ROOT is still being designed (idea-336 M-Task-Dispatch-Repair). No shipped main-merge fix found. |
| **bug-25** (thread delivery truncation) | parked/superseded | only a `[test]` commit found (06704fd), no fix on main; tagged `supersedes-by-idea-152` (Smart NIC Adapter, still open). Suspect parked rather than fixed. |

## Residual TRUE live-backlog (the SR-input ground truth)

- **Ideas: 277 open** — genuinely-live (no mission-incorporation rot found).
- **Bugs: 40 open + 1 investigating (bug-23) = 41 non-terminal** — incl. a large genuinely-live **missioncraft CLI-UX cluster** (~22 bugs: bug-64/65/66/67/74/76/77/78/79/80/81/82/83/84/85/86/87/88/89/90/91/92 — roadmap-candidate work, not stale) + **bug-203** (confirmed UPSTREAM claude-code host limitation; workaround-only, fix-by-construction deferred to idea-391/392 — MUST stay open).
- **Missions: 1 active (mission-94)**, 55 completed.
- **Teles: 14 active.**
- **Proposals: 33.**

This clean set — and only this — is the valid input to the downstream SR gather (assemble_pack et seq.).

## Method note

Exhaustive inventory + backward cross-ref executed via a read-only analysis workflow (41 sub-agents, ~590s, 133 Hub tool-calls): exhaustive paginated open-Idea inventory + non-terminal-Bug inventory + per-completed-mission `get_mission` link-extraction → synthesized disposition list. The parent (greg) verified each fix commit against `origin/main`, executed the 2 bug flips, held the 3 low-confidence items, and authored this report. Conservative throughout: only main-merged "closes/fix" commits drove flips; partial/test/design-only references were held for Director review.
