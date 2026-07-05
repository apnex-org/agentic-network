# M-Director-Interface (mission-102) — Design-Inputs Register

**Purpose:** the single accretion point for every insight, live incident, and calibration that must be considered by the P1 survey and P2 design council. Nothing design-relevant lives only in a message thread. Maintained by the architect on capture (Director directive 2026-07-04: "durably gathering insights… so they are considered and not lost"). Each entry carries its source ref. Sealed alongside the P1 survey at G1 (2026-07-05); post-G1 additions append with a G1+ marker.

**Companion artifacts:** intent-brief.md v1.0+SC4 (ratified, G0 audit-9343 + 8bcc6e9) — decisions + constraints; p1-survey.md v1.0 (sealed, G1) — conclusions; this register — evidence + lessons.

---

## A. Substrate lessons from live incidents (all 2026-07-04 unless noted)

| # | Insight | Source |
|---|---|---|
| A1 | Director-gated items are FROZEN: no director seat exists; claims/completes/abandons impossible; Director decisions executed only via logged architect proxy (audit-9249/9270 pattern). Fix shapes (proxy-execution verb / director seat) are design inputs, not parallel work (fence F5). | bug-219, legal_moves probe, get_agents(director)=[] |
| A2 | Parked states are not lease-durable: items awaiting external disposition reap to ready when the holder's lease lapses (observed 3× on work-111). A Director decision pending for DAYS cannot depend on an agent renewing a 15-min lease — decision entities need durability WITHOUT a heartbeat-holder. | bug-185 + addendum; work-111 saga |
| A3 | Every demandable evidence kind must have a MINTABLE producer path: review-kind refResolvable requirements on WorkItems were unsatisfiable by ANY role (create_review = architect-only + task-entity-only). Authoring-time validation (fail-closed producer-path table) is the schema rule. | bug-220 (architect + verifier probes), fix (c) |
| A4 | Anti-gameability: caller-settable escape hatches (allowPreClaim) are holes; grandfather from SERVER-side persisted state instead. Norm observed: engineer DECLINED a dishonest workaround unprompted — the culture the contract wants to reinforce. | bug-222 + PR #483/#484 design notes |
| A5 | Reply-leg gap: messages from an unregistered sender identity are un-replyable (recipient.unknown). Council question: durable director-session identity at send time, vs Hub rewrites reply-target to a registered proxy. | bug-224; sanctioned anonymous-architect injection |
| A6 | Delivery-leg gap: push-only clients never drain pushes fired while down — steve's inbox held silent unclaimed coordination back to 06-28. SC2/SC3 degrade INVISIBLY. Decision-queue must not inherit: delivery confirmable, undelivered visible. | bug-225; steve's drain report |
| A7 | create_review is DEPRECATED (Director directive) — verdict evidence moves to verifier-authored audits anchored on Hub-stamped authorship, pending the decision-entity design owning verdicts natively. | audit-9429; idea-359; bug-220 fix (b) |
| A8 | Event vocabulary shipped + validated: work-transition / work-unblocked / deploy-completed (broadcast wire, receiver-side salience, suppress_peek_line noise control works). Director-gate ROUTING claimed by this arc; general scoping stays idea-355 (F4). | work-54/prop-34, audit-9164 |
| A9 | Review-requests are raise-able attention items: CODEOWNERS auto-requests fire (bug-221 fixed) but are agent-invisible (bridge lacks review_requested) — a class the queue model generalizes to. | idea-315 (absorbed idea-417); bug-221 |
| A10 | Identity substrate now real: per-agent git identities live (ois-0010 + worktree-scoped interim); steve has NO GitHub identity (PAT=apnex); director-session identity for messaging doesn't exist (A5). Unified per-actor identity = design dependency for attribution + audit honesty. | bug-218 record; bug-221; bug-224 |
| A11 | SESSION identity is invisible to the queue's actor model — and sessions can wear the WRONG agent id (stale ois-startup session claimed work-81 under lily's agentId; Director-corrected misdiagnosis). agentId is asserted by session config, not bound to the session. Attribution, wake-routing, WIP accounting all key on an assertable id → actor identity needs session-level grounding. | work-81 lease inspect + release; Director correction |
| A12 *(G1+)* | Phase orchestration MUST ride the work queue — turn-based cognition + message-based coordination stalls silently (P2 clash phase stalled after positions staged: commissions were messages, no work items, no wake drivers; Director had to ask "is anything happening?"). Every phase transition is a graph edge (dependsOn → unblock-wake), never a promise in a message; pipeline liveness must be Director-visible (awareness-class requirement). Remediation proven same-day: work-112/113/114 DAG self-convened the synthesis. | audit-9745; Director failure-assessment probe 2026-07-05 |

## B. Interaction calibrations (Director revealed preference — the SC3 evidence base)

| # | Insight | Source |
|---|---|---|
| B1 | Structured SINGLE-TOPIC queries, inline, validated repeatedly; stacked multi-question forms REJECTED. One-decision-at-a-time is constitutional (C3/idea-416). | audits 9280, 9343 |
| B2 | Custom/hybrid answers carry the highest signal (T4, C5a both arrived via "Other"). The option set must never trap; free-text escape is load-bearing. | audits 9285, 9343 |
| B3 | Director asks probing verification questions that repeatedly corrected the record — the interface must make verification CHEAP (show sources, checkable claims), not just decisions fast. | bug-218/A11/idea-417 corrections |
| B4 | Attention benchmarks: ~2.5 min/decision (S1); 15 decisions ≈ 15 min (G0); 6 C2 picks ≈ 6 min (S3). SC3 dual metric: time/decision + one-tap session rating, trended. | audits 9343, 9641 |
| B5 | "Go read PR #393 and answer 6 questions" was the canonical anti-pattern — resolved: work-37 re-presented through the pattern and closed (S3.3). Artifacts stay full-fidelity for the record; the Director interface is always the decomposed walkthrough. | idea-416; audit-9641 |
| B6 | Live delegation precedents seeding the class taxonomy: IN-boundary — PR identity approvals, stale-item retirement, bug-fix authorization, evidence-path disposition, stale-lease release. ALWAYS-Director — scope changes, deprecations, ratifications, preference-shaped anything. | audits 9249, 9270/9271, 9429 |
| B7 | Director side-channel injection is a real modality — the interface must ingest Director intent arriving OUTSIDE the primary chat (and fix its reply leg, A5). | Director confirmation in-session |
| B8 | Director situational-awareness asks are capability questions ("will it auto-reset?") — the awareness class answers mechanics declaratively (state + timer + what-happens-next). | work-81 exchange |
| B9 | OPERATING PHILOSOPHY (deepest profile entry): the Director engineers the PATH OF GREATEST LEARNING over the shortest path — learning invested as force multipliers; tangents legitimate and long-horizon-superior. Consequences: SC3 minimizes TOIL-attention while PROTECTING learning-attention; curation ranks by COMPOUND VALUE; tangent insights must be CAPTURED (this register is the mechanism); reasoned-tension deep-dive is the validated mode for meta framings. | Director statement 2026-07-05; work-111 saga as live proof |
| B10 *(G1+)* | CONFIRMING-BLIND incident (grant-1 live test, 2026-07-05): the Director was asked to confirm with NO terminal way to see what the confirmation bound — trusting the architect's chat rendering, against B3's verify-cheaply principle; the Director flagged it himself ("hard to tell what I'm confirming; can't show or list"). RESOLUTION: `ois decisions` + `ois show` added (the F2 non-agent surface's embryo); get_director_confirmation with a Hub-side echo of what the hashes bind follows. CONTRACT RULE for the arrival surface + all confirm flows: **render-before-confirm** — no confirmation is presented for consumption without a substrate-derived render of the decision + proposed resolution it binds. | Director UX finding 2026-07-05; greg 01KWRDKPX3 |

## C. Deliberation-pattern inputs (P2 council + council-blueprint extraction)

| # | Insight | Source |
|---|---|---|
| C1 | The scale-invariant deliberation primitive (sealed inputs → independent positions → adversarial clash w/ recorded movement → verified synthesis → authority ratification) is the arc-altitude pattern; extract from the idea-389 SR blueprint as a PARAMETERIZED council blueprint. | audit-9305 |
| C2 | The arc's gates are decision-entities riding the rail being designed (meta-dogfood); every session names its experiment and captures the Director's verdict. | audits 9272, 9343 |
| C3 | Seat evidence pre-accretes: greg holds the durability/evidence exhibits (A2–A4, A6); steve demonstrated verifier re-derivation discipline. Positions are commissioned AGAINST this register + the sealed survey, not from scratch. | session threads; audit-9438 |
| C4 | Cross-agent correction loops are design-relevant culture (greg↔architect↔steve↔Director corrections, all one day). Curation must not become a single-voice filter — raw feed auditable. | session record 2026-07-04/05 |
| C5 | Skill-mechanism dissolution (survey S1.6, idea-418): the council designs decision/blueprint machinery as the KNOWING SUCCESSOR to skill packages — node-contract assembly is a first-class substrate function (tele-12); host skill hooks become thin bridges. | Director 2026-07-05; idea-418 |

## D. Question ledger (disposition at G1)

| # | Question | G1 disposition |
|---|---|---|
| D1 | Decision entity shape + class ontology | RESOLVED S1.1/S1.3 (schema detail → council Q1) |
| D2 | Curation mechanics | SLO resolved S3.2; record schema → council Q5 |
| D3 | Elicitation payload schema | → council Q1 (presentation-agnostic superset) |
| D4 | Survey-skill disposition | RESOLVED S2.2 (+ S1.6 generalization) |
| D5 | Director identity | RESOLVED S2.1 (staged; session-grounded ids) |
| D6 | Durability + delivery | RESOLVED S1.1 (no lease) + S2.3/S2.4 (hybrid, 48/24h) |
| D7 | Awareness & presence | RESOLVED S1.4 + S3.1 (declared + inferred-suppress-only) |
| D8 | Non-agent compatibility proof | → council Q3 (CLI spike round-trip) |
| D9 | SC3 toil-vs-learning operationalization | → council Q2 |

---
**Maintenance protocol:** architect appends on capture with source refs; council items cite register rows; post-G1 rows append with a G1+ marker; Director may audit any row to its source.