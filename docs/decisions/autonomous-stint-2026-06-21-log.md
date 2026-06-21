# Autonomous Stint — Decision Log (2026-06-21)

**Authority:** the Director granted lily (architect) **temporary Director authority** to drive the organisation (lily + greg + steve) autonomously — advancing current arcs and improving the system per the Teles — until the Director returns from an extended absence. This log is the durable record of every decision made under that grant, for Director review on return.

**Operating principle:** lily does **not halt**. When gated on a team deliverable or a deferred decision, lily parks the block and progresses other non-blocked work (the move-on queue). A cron heartbeat + event-driven peer wakes keep the stint moving.

---

## Framework

### Decision protocol (any decision that would normally be flagged "Director input")
1. **Triangulate** against ALL relevant Teles (cite which + how each bears).
2. **Lean:** pick the best option; if the Tele review reveals a better-shaped option, adjust the option set.
3. **Record** here as DR-NNN (context · tele-triangulation · options · lean · disposition).
4. **Sufficiency:** is there enough information for lily to make + execute?
5. **If yes →** decide + execute; mark `lily-executed`.
6. **If it absolutely must be Director (a hard line) →** mark `director-deferred` and **MOVE ON** — do not halt.

### Hard lines (always Director — record + defer + move on; never autonomous)
- **Editing Tele content** — constitutional; immutable without Director ratification. (May *propose* via a DR.)
- **Irreversible / destructive / data-loss-risking prod actions** — data migrations, deletions, anything not cleanly reversible.
- **Merging the constitutional ledgers to main** (teles, calibrations) without strong cause — prepare as a PR + defer.
- **New outward-facing / published surfaces beyond the established pattern** — new external repos, public releases, sending to new external services.

### Within authority (decide + execute; record)
- **Arc + submission lifecycle** per current RACI — PRs, merges (via peer cross-approval), mission/idea/bug lifecycle, task issuance, thread coordination.
- **Prod Hub deploy** of changes that are **TESTED** (suite-green) **+ REVERSIBLE** (redeploy/rollback) **+ VERIFIER-GATED** (Steve / R3 post-roll verification). [DR-002]
- **Tasking + coordinating greg + steve**; convening councils; brainstorms; reviews.
- **Audits, bug-resolution design (vs Teles), documentation, mission-arc adjustments.**

### Move-on queue (when gated — never idle)
Strategic audits (bugs / ideas / mission-arcs); bug-resolution design + execution; parked-decision critique vs Teles (with greg/steve); doc review+update; councils w/ greg+steve to brainstorm new ideas + mission arcs; hardening; sovereign-duties / modularity / deduplication audit; interface/component improvements. Keep greg + steve on valuable work; never let them idle.

### Continuation
Cron heartbeat (~15 min, session-scoped) + event-driven wakes from peer responses. The stint never halts on a block; it parks + progresses elsewhere.

---

## Decision Records

### DR-001 — Adopt the autonomous-stint framework · `lily-executed`
- **Context:** Director away (extended); granted lily temporary Director authority + asked lily to design + run this framework.
- **Tele-triangulation:** tele-13 (Director-intent amplification — economise the non-scalable Director-attention resource; this grant *is* tele-13 in action); tele-3 (sovereign composition — lily owns arc/merge per RACI); tele-6 (frictionless collaboration — keep the org moving); tele-8/9 (integrity — bounded by the hard lines + verifier-gating). No tele conflict; the guardrails ARE the tele-8/9 integrity backstop on the authority.
- **Disposition:** ADOPT. The log + the memory anchor + the Hub ledger are the Director's review trail.

### DR-002 — Prod Hub deploy authority under the grant · `lily-executed` (standing policy)
- **Context:** the verifier-cutover-fixes deploy (+ future Hub/shim deploys) would normally need per-occasion Director auth; Director is away.
- **Tele-triangulation:** tele-8/9 (gated/validated deployment — *supports* deploying WITH verification; this is exactly R3's thesis); tele-4 (no silent failure — requires reversibility + post-deploy verification); tele-13 (don't make the Director the deploy bottleneck); tele-10 (deploy is mechanised/watchtower — first-class + observable). The risk (an unverified/irreversible prod change with no human oversight) is mitigated because the org now HAS a verifier (Steve) + an acceptance-gate contract (R3).
- **Options (tele-adjusted):** (a) defer all prod deploys → stalls every arc, violates the grant's intent; (b) deploy freely → integrity risk (tele-8); (c) **deploy TESTED + REVERSIBLE + VERIFIER-GATED changes; defer irreversible/destructive ones.**
- **Disposition:** **(c)**, standing policy. Each actual deploy is recorded as its own DR with suite-status + post-roll verification result. Irreversible/destructive prod actions remain a hard line (director-deferred).

---

### DR-003 — Deploy verifier-cutover-fixes (mission-93 conformance cluster) · `lily-executed`
- **Context:** greg delivered the verifier-conformance cluster @ `882c113` on agent-greg/verifier-cutover-fixes (bug-166 turn-holder, bug-167 audit-reads, bug-169 attribution, bug-170 discovery, H20 + role-change guard). 171 LOC / 7 src + 2 test files. Suite 1946 green, tsc clean. First prod deploy under the grant.
- **Tele-triangulation:** per DR-002 — TESTED (1946 green + new e2e-verifier-rbac/verifier-role-rbac), REVERSIBLE (watchtower redeploy), VERIFIER-GATED (Steve verifies post-roll). tele-6 (unblocks verifier participation), tele-8/9 (validated deployment).
- **Review:** architect-reviewed the diff — verifier added to MESSAGE_AUTHOR_ROLES + ThreadAuthor; turn-holder + recipient-participant seeding + author-attribution all preserve verifier WITHOUT altering the engineer/architect paths; scoped + commented. Clean, no regression surface.
- **Disposition:** `lily-executed` — PR opened + architect-approved → merge to main → deploy-hub.yml → watchtower roll → verify toolSurfaceRevision + Steve post-roll verification. (Roll result recorded on completion.)

### DR-004 — Verifier get_task scope (not a gap) · `lily-executed`
- **Context:** greg asked whether get_task being denied to the verifier is a gap (bug-167 sub-item).
- **Tele-triangulation:** tele-3 (clean role-semantics) — get_task is parameterless engineer **work-pickup** ("give me my next directive"), a distinct semantic from audit read-by-id. The verifier's broad-READ is satisfied by list_tasks ([Any]) + the read-by-id surfaces (get_proposal/get_clarification, now [Engineer|Verifier]).
- **Options:** (a) widen get_task to [Verifier] — conflates work-pickup with audit-read; (b) new read-task-by-id primitive — YAGNI; (c) keep get_task [Engineer]; verifier reads tasks via list_tasks.
- **Disposition:** **(c)**, `lily-executed`. get_task denial for the verifier is CORRECT, not a gap — bug-167's get_task sub-item closed as not-a-gap. Revisit (b) only if a real verifier task-by-id need arises.

### DR-005 — Open-bug ledger strategic triage + dispositions · `lily-executed`
- **Context:** autonomous-stint move-on work — strategic triage of the 72 open bugs (subagent-assisted, read-only). Buckets: 16 resolvable-now · 10 stale · 29 clustered (incl. a 22-bug missioncraft cluster) · 6 mission-sized · 11 in-flight.
- **Tele:** tele-2/tele-10 (accurate ledger = source-of-truth hygiene); tele-6/tele-13 (stop a foreign backlog draining Hub triage bandwidth).
- **Dispositions:**
  1. **CLOSED (resolved) 5 confirmed-stale** — bug-134 + bug-158 (live-proven: list_bugs/list_missions return clean post-mission-90 decode-to-flat), bug-57 (PR #200 / e0fad4f4), bug-123 (critical; resolved by mission-90 W6 strict-cutover success), bug-125 (PR #289). `lily-executed`.
  2. **missioncraft cluster (~22 bugs, bug-64..92)** — a DIFFERENT product's CLI/SDK backlog filed vs superseded npm versions, polluting the Hub-substrate ledger. RECOMMEND Director migrate to missioncraft's own tracker + re-validate vs current npm head. Actual external migration = HARD LINE (new external surface) → **director-deferred**; parked pending Director return.
  3. **C1 task-dispatch cluster (bug-146 root + bug-94 + bug-159)** = highest structural leverage (breaks the formal Task FSM for architect-driven missions; masked only by the thread-dispatch workaround) → **queued as the next substrate mission-design** (lily, autonomous).
  4. **A-wins → greg wave-2** (after current hardening + shim batch): bug-117 (list cap=10), bug-48 (round_limit vs converged), bug-96 (thread-reply silent-degrade), bug-100 (reconciler reconnect), bug-162 (pulse forgive-miss).
  5. **verify-then-close (deferred):** bug-121, bug-126, bug-40, bug-62, bug-63.
- **Disposition:** triage adopted; (1) executed; (3) next mission-design; (4) greg wave-2; (2)+(5) deferred/parked.

### DR-006 — Defer #342 (R5 calibration ledger) merge to Director bilateral-confirm · `director-deferred`
- **Context:** greg cross-approved #339/#340/#341/#342 (real reviews). #342 edits `docs/calibrations.yaml` — the constitutional calibration ledger.
- **Hard line:** merging the constitutional ledgers (teles, calibrations) without strong cause = director-deferred (CLAUDE.md: calibration filings/IDs are Director-direct or architect-Director-bilateral). greg independently flagged a courtesy bilateral-confirm-when-back — aligned.
- **Disposition:** MERGE #339 (audit) + #340 (R3 spec) + #341 (1b design) now (ratified, non-constitutional, greg-approved). **HOLD #342** — PR stays ready + approved; Director confirms the #88 ID + content on return (bilateral), then merge. `director-deferred`.

### DR-007 — Design M-Task-Dispatch-Repair (C1) as a queued mission · `lily-executed`
- **Context:** bug-triage DR-005 named C1 (bug-146 root + bug-159 + bug-94) the top structural-leverage cluster. Designed as M-Task-Dispatch-Repair.
- **Tele:** tele-6/13/4/3/2 (frictionless dispatch / Director-amplification / no-silent-failure / identity≠routing / FSM spec==reality).
- **Decision:** fix-shape = separate identity (login-label/provenance) from claim-routing — first-class assignee on create_task (label the EXECUTOR not the caller); stop using creator-login as a claim-selector; optional global-pool fallback + update_task re-dispatch. **Survey SKIPPED** (narrow fix space + confirmed root; recorded here in lieu of a Survey per the architect-Director-bilateral norm).
- **Disposition:** `lily-executed` (design) — idea-336 + docs/designs/m-task-dispatch-repair-design.md (PR #344). Mission **chartering deferred** until engineer bandwidth frees (after mission-93 hardening + mission-92 shim batch) — NOT creating a competing active mission now.

### DR-008 — #343 roll completion via the sanctioned watchtower-refresher (bug-107 live) · `lily-executed`
- **Context:** #343 built+pushed (02:27) but watchtower-prod 401'd on the AR pull (token expired) → roll stalled ~20min → ois-hub-prod stuck on the 4h-old #338 image.
- **Investigation (read-only):** watchtower 401 logs; the refresher is systemd `refresh-docker-token.service` (metadata-minted token; 30-min timer; `/var/lib/docker-creds/refresh.sh`) with an intermittent token-TTL-vs-interval race → bug-107 (now root-diagnosed, updated major/investigating).
- **Safe nudges:** (1) restart watchtower-prod → no effect (re-reads the stale file); (2) **trigger the SANCTIONED refresher `sudo systemctl start refresh-docker-token.service`** → minted a fresh metadata token → watchtower's 02:45 poll authed + rolled #343 via its OWN safe recreate. The Hub container was NEVER hand-recreated (hard line held).
- **Tele:** tele-8/9 (completed the deploy through the sanctioned mechanism, not a risky improvisation); tele-4 (surfaced the silent CD failure → bug-107).
- **Disposition:** `lily-executed`. **#343 LIVE** — toolSurfaceRevision ebc5a0→a11543f8; the verifier conformance cluster (bug-166/167/169/170 + H20) is deployed. **Closes DR-003.** Verifier-gate IN PROGRESS: thread-678 opened currentTurn=**verifier** (bug-166/170 fix confirmed live + correct) → Steve confirms behaviorally by replying. bug-107 stays open (refresher race needs a proper fix; workaround documented above + in the bug).

### DR-009 — DR-002 verifier-gate PASSED (#343 verified live) · `lily-executed`
- **Context:** post-#343-roll behavioral verification (the DR-002 gate). Steve (verifier) verified live on thread-678 — and his reply *posting* (with convergence + a staged action) is itself the proof the participation fix works. Thread converged + finalized.
- **Result:** FIXED + verified → **CLOSED**: bug-166 (turn-holder reply, b07d4df), bug-169 (verifier attribution, 882c113), bug-167 (get_proposal, 882c113), bug-165 (audit readback/list), get_clarification. **REMAINING → greg's next Hub batch:** bug-168 (verifier create_idea still stamps createdBy=system/hub-system — CONFIRMED REAL, a separate provenance site from 169), bug-170 (list_threads recipientAgentId/currentTurnAgentId filters still miss verifier-directed threads — PARTIAL; participants[]+delivery fixed).
- **Tele:** tele-8/9 (validated deployment — verifier-gated + independently confirmed); tele-6 (verifier participation now first-class).
- **Disposition:** `lily-executed`. The verifier cutover's core goal — first-class participation + attribution + reads — is ACHIEVED + independently verified by the cross-lineage verifier. The DR-002 verifier-gated-deploy model worked end-to-end (deploy → verifier confirms → close). Remaining tail (bug-168 + bug-170) routed to greg behind R1.

### DR-010 — Verifier integrity-audit of the architect's autonomous bug-closes · `lily-executed`
- **Context:** the verifier (Steve) independently audited the architect's autonomous stale-bug closes (audit-3875) — the integrity check on the architect-with-temporary-Director-authority.
- **Outcome:** bug-134 VERIFIED live; bug-123/125 SUPPORTED; **bug-158 architect-RE-CONFIRMED clean** (list_missions({status:active}) returns 92/93 envelope-decoded — the clean call Steve's client couldn't make); bug-57 stays resolved (empirically dispatch works) + a formal architect→engineer dispatch→drain regression fixture folded into C1; **NO reopens**. bug-171 (transport fragility) CONFIRMED RECURRING → R3-G.
- **Tele:** tele-8/9 — the verifier integrity-check on autonomous authority is the safety mechanism that makes the stint sound.
- **Disposition:** `lily-executed`. The backstop functioned — flagged 2 thin-evidence closes (158/57), both held. The autonomous-stint verifier-as-integrity-loop is proven.

### DR-011 — Hub-tail #346 deployed + verified; verifier-first-class CORE arc COMPLETE · `lily-executed`
- **Context:** greg's bug-168/170 Hub-tail deployed via DR-002 (2nd autonomous deploy). His verifier-cutover-fixes branch had forked pre-#339/340/341, so a direct merge would have DELETED those docs → I cherry-picked 3eef8d7 onto a fresh branch off main (#346, net = the 7 bug-168/170 files only).
- **Deploy:** #346 merged 04:19 → build → the deploy-roll-script **proactively triggered refresh-docker-token.service (pre-empting bug-107)** → watchtower rolled 04:25:22 (image 5a424eda; container-restart + Updated=1). **LESSON: toolSurfaceRevision reflects only tool-SURFACE changes — for internal-only deploys it does NOT change; use container-restart/Updated=1 as the roll-signal.**
- **Verification:** Steve re-verified live (audit-3886) — bug-168 PASS (idea-339 createdBy.role=verifier), bug-170 PASS (list_threads finds 3 directed threads via both filters). **bug-168 + bug-170 CLOSED.**
- **MILESTONE:** the verifier-first-class CORE arc is COMPLETE + independently verified — participation (bug-166), attribution (169/168), discovery (170), reads (167), audit-readback (165), deny-surface (security) all fixed + live. The full loop executed end-to-end autonomously: verifier sweep → architect contract → engineer fixes → verifier re-verify.
- **Tele:** tele-6 (verifier participation first-class); tele-8/9 (verifier-gated validated deployment).
- **Remaining tail:** bug-164 (shim-side, Director-restart-gated), bug-171 (R3-G backpressure, queued), bug-172 (write-scope-determinism). R3 harness (greg building Leg-A) is the durable systemic gate.
- **Disposition:** `lily-executed`.

*(Subsequent decisions appended as DR-012, … during the stint.)*
