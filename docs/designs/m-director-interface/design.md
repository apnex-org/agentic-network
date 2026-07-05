# M-Director-Interface — Design v1.0 (council synthesis, staged for G2)

**Status:** SYNTHESIS — staged for G2 (Director design ratification). Produced by the P2 full-blueprint council: 3 independent positions → divergence map (4 clash items) → rebuttals with 8 recorded movements → 1 Director tie-break (CL-2). Provenance: docs/council/m-director-interface/* + audits 9650/9745/9750.
**Governing constraints:** intent-brief v1.0+SC4 (G0); p1-survey v1.0 (G1, 13 resolved directions); design-inputs register (26 rows). This design binds only v1 (fence F1: the decision-gate spine); deferred items are named, not implied.

---

## 1. Entities

### 1.1 Decision (the spine)
Sovereign entity owning ONLY authority-resolution (S1.1). No lease; **no timer moves state** (eng L1); no WIP-cap interaction. Fields per the engineer schema (position §1.3) with council amendments:
- identity: `id, schemaVersion, parentRef{kind,id}?, class` (S1.3 ontology; unclassified → fails closed to director-direct routing)
- content: `title, context, contextRefs[]` (reuses the WorkItem references[] shape; required refs resolve fail-closed at raise — eng L3), `options[{id,label,description,preview?,consequences?}]`, **`freeAnswerPolicy: "always"` as schema constant** (B2 — not an author-settable field)
- actors: `raisedBy/curatedBy/resolvedBy/executedBy` all `{agentId, sessionId?, role}` Hub-stamped (eng L2, R:A11; sessionId populated where the session substrate provides it, in-schema now to avoid regret)
- routing: `routedTo: director | {selfDisposal: {t5RuleRef | classGrantRef}}` — grant refs resolve at route or the route rejects
- resolution: `{authorityMode, authorityRef, executor, answer{chosenOptionId|customAnswer}, rationale?, resolvedAt}` — `authorityMode ∈ {director-direct, director-via-proxy, architect-t5, class-grant}` + reserved-but-rejected `verifier-mandate`; **Hub-DERIVED from the proof relation, never caller-supplied** (ver §1, eng L2/L4); no default, no "inferred" member
- execution: `executionPlan?[{action, targetRef, params}]` declared at ROUTE time, plan-hash included in any confirmation payload (ver CL-1 criteria)
- telemetry: `stateDurations` per state (the WorkItem pattern; curation SLO + SC3 numerators fall out structurally)

**FSM:** `raised → curated → routed → resolved → executed` + exits `merged(intoRef)` / `disposed(reason)` / `withdrawn` (terminal, verb-driven, audited, event-emitting; every raise terminates in exactly one of {resolved, merged, disposed, withdrawn} — SC2 becomes falsifiable). `curated` is a STATE (all seats): the raised→curated transition is the 24h-SLO accountability boundary (S3.2); breach = arrival-surface exception. Timers EMIT only (aging notifications, SLO exceptions) — never transition.

### 1.2 ClassGrant (delegation, CL-3 converged)
Typed-constraint-field entity on the evidenceRequirements precedent — not prose, not a predicate language: `{id, version(immutable), class(exact-match), allowedActions[registry refs], reversibleOnly, parentKinds?, excludedRefs[], excludedClasses[], maxBlastRadius, issuer=director, ratificationRef(decision), state{active|revoked|expired|superseded}, representationDue}`. Hub evaluates the resolution against the fields, then stamps `authorityMode=class-grant`. Grant authoring: architect drafts; **Director ratifies each grant as a decision through the rail** with a plain-language preview + in/out examples (ver CL-3); the ratified structured form is what the Hub enforces. Adding a grant class = schema + evaluator + negative tests, fail-closed (missing evaluator rejects at authoring). Revocation/expiry recheck in the authoritative CAS, not just preflight. **V1 ships exactly ONE live grant: approval-unblock** (arch D-A2, adopted by both seats) — its allowedActions are exactly the v1 registry (§3).

### 1.3 DirectorSignal + DirectorConfirmation (proxy proof, CL-2 — Director tie-break)
- **DirectorSignal** `{id, confirmationId?, channel, rawIngressRef, rawContentHash, answer, capturedAt, capturedBySurface, confidence{authenticated|session-bound|side-channel-low}, replyable}` — minted at INGRESS by registered capture (the ois-say side-channel gets a registered director messaging identity — the bug-224 fix; NOT a director seat: no claims, no lifecycle; S2.1 staging untouched).
- **DirectorConfirmation** `{id, decisionId, promptHash, proposedResolutionHash, executionPlanHash?, nonce, createdAt, expiresAt, consumedAt?}` — Hub-minted when a surface renders a concrete single-topic prompt; consumed exactly once by the resolving verb.
- **Proof rules (ratified):** REVERSIBLE resolutions flow on a DirectorSignal or a ClassGrant proof. IRREVERSIBLE executions and director-direct proxy resolutions additionally require a consumed DirectorConfirmation bound to the exact prompt+plan hashes. `resolve-as-director` with neither → REJECT (no park). Chat/audit assertion refs are NOT proof (architect concession on record). Side-channel-low signals are routable context, never authority for irreversibles. Hard-line preserved: absent proof, an architect disposition stamps `advisory-architect`, never `authority: director`.

### 1.4 ArrivalSnapshot + NudgeReceipt (delivery, CL-4 converged)
The routed queue is a **pure pull projection** (`list_decisions(target=director,status=routed)` complete with all pushes dead — the contract test). Delivery proof is observational, outside authority-state: **ArrivalSnapshot** `{id, surface/session, cursor/window, decisionIds+hashes, renderedAt, per-item ack/defer/act markers}` recorded by the Hub at the render verb; **NudgeReceipt** on the aging-nudge path only (the sole push-dependent component), with bounded retry + side-channel escalation for critical class (arch D-A1). **Delivered = PRESENTED (snapshot membership) for SC2; ACTED for resolution; EMITTED counts for nothing.** Away-mode suppresses nudge emission only — backlog existence/age are queue state and appear in the next snapshot. Cold-start = current queue + "not in last acknowledged snapshot": a week of downtime is a large snapshot, never silent loss (the bug-225 replay defense).

## 2. Curation (Q5 + R:C4/B9)
Append-only model (ver §3): `RawDecisionRaised` immutable; `CurationRecord` {act: frame|edit|classify|prioritize|merge|split|dispose|route, before→after, curator(session-stamped), basis (incl. compound-value rationale when ordering passes urgency — B9), source raw ids, grant citation on self-disposal}; the curated Decision is a derived view. Merge preserves ALL raw ids + minority claims expandable. **The anti-laundering query ships in v1** (arch L3, ver required-queries): raw-feed-vs-presented diff, per-grant classifications, class-changed-during-curation, merge lineage, SLO breaches — one Director verb each. Every self-disposal produces the Director-reviewable disposal packet (ver §2) and appears in the since-you-left digest (S1.4).

## 3. Execution (CL-1 converged)
V1 action registry: **`unblock(workId)` + `approve(proposalRef)`** — enumerated, thin wrappers over shipped verbs, reversible. `resolve` with a plan executes ATOMICALLY iff: authority proof validates (§1.3) → grant proof validates where applicable (§1.2) → plan-hash matches the routed/confirmed plan → all rechecked in the authoritative CAS. Any failure → whole-transition REJECT (never a half-executed park). Async/external-world plans park in `resolved` with explicit `executorBinding` + aging visibility. `mint_work`, `record_scope_change`, `retire` are post-v1 registry candidates (schema-ready, not shipped).

## 4. Events + surfaces
`decision-transition-notification` through the shipped work-54 emitter/envelope verbatim (A8); Director-gate class = filter on routedTo, not new transport (F4 holds). Arrival surface (S1.4): curated queue + since-you-left digest (incl. every self-disposal + disposal packets + suppressed-nudge accounting) + exceptions (SLO breaches, unconfirmed critical nudges); trends on-demand. Presence per S3.1 (declared + inferred-suppress-only). Aging per S2.4 (48h/24h critical) via one emit-only sweep.

## 5. SC operationalization
- SC1/SC2: mechanical — FSM exit totality + snapshot-based delivery proof + the standing invariant query `resolutions WHERE authorityMode != director-direct AND authorityRef !resolves → must be empty` (eng §2.3).
- SC3 (Q2, converged): typed attention-requests at presentation (decision-resolve | verification-answer | learning-exchange | toil-recovery — arch) + full-funnel denominators (raised/curated/routed/self-disposed/merged/stale/reversed + p50/p95 ages — ver). Toil trends to zero; learning-exchange excluded from minimization by construction (B9). One-tap session rating. No transcript surveillance. The gaming pattern (time-per-decision improves while self-disposal ratio/reversals rise) renders as a flagged anti-pattern, never unqualified success.
- SC5: the CLI spike (Q3) = list → render one payload → accept pick/free-text → resolution through the SAME verbs; zero payload transformation; becomes a CI contract test.
- SC6: the arc's own G3 gate rides a Decision entity (C2).

## 6. Contract tests (G2-binding; from ver §8 + eng invariants + tie-break)
1 class-spoof rejects at resolve · 2 curation-laundering visible via raw-feed queries · 3 revoked/expired grant rejects at CAS recheck; historical resolutions keep grant version · 4 bug-225 replay: pushes dead → arrival snapshot complete, ages shown, nothing requires a prior message claim · 5 verdict-spoof (wrong actor/relate/freshness) rejects · 6 SC3-gaming renders flagged · 7 proxy without proof rejects; assertion-ref rejects; confirmation consumed exactly once; irreversible-without-confirmation rejects · 8 raw-feed interval query returns disposed+merged complete · 9 no-timer-transitions invariant · 10 FSM exit totality · 11 atomic resolve+execute: any proof failure → zero effects · 12 plan-hash mismatch rejects.

## 7. V1 build scope (P3, on G2 ratify) — slices, each verifier-gated
B1 Decision entity + FSM + verbs + events (spine). B2 Curation model + raw-feed queries + SLO exception. B3 ClassGrant + evaluator + the live approval-unblock grant (ratified through the rail as its own first cargo). B4 DirectorSignal ingress (bug-224 fix + registered identity) + DirectorConfirmation + proxy verb with proof rules. B5 Action registry (2 actions) + atomic resolve+execute. B6 Arrival surface + snapshot/receipts + aging sweep + presence. B7 CLI compatibility spike → CI contract test. B8 Contract-test suite (§6) green. Composing floor (C-papercuts) runs alongside per audit-9271.

## 8. Deferred (named)
Director seat (arrives with the non-agent surface, S2.1); native verifier-mandate resolutions (enum reserved); registry expansion (mint_work etc.); DirectorSignal confidence tiers; BlueprintTemplate entity (doc-template first — eng Q4); base-node unification (candidate-D); general skill-system dissolution (idea-418); event-scoping generalization (idea-355).
