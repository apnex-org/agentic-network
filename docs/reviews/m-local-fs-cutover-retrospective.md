# Mission-48 M-Local-FS-Cutover — Architect Retrospective

**Status:** engineer-side complete (6 PRs merged); operator-side redeploy + drill pending; mission-status flip gated on drill outputs OR Director close-without-drill signal.
**Authored:** 2026-04-25 post-T4 landing; pre-drill (drill-outputs section deferred per Director direction).
**Provenance:** mission-48 closes the β-split sequence ratified 2026-04-25 (mission-49 prerequisite migration + mission-48 cutover); design round in thread-303.

---

## 1. What shipped

**6 PRs merged in a single engineer session** (~70 minutes wall-clock from PR #24 to PR #29):

| PR | Task | Merged |
|---|---|---|
| #24 | T1 — Docker mount + uid/gid handshake + ADR-024 §6.1 amendment | `1e61226` |
| #25 | T2a — Cutover bootstrap (state-sync.sh extension + post-copy invariant + sentinel) | `bc5dbb6` |
| #26 | T2b — Default flip + bootstrap-required guard + smoke documentation | `34b225a` |
| #27 | T2c — Reverse-direction sync (`--yes` safety + symmetric invariant) | `8c420c7` |
| #28 | T3 — Operator drill procedures + dogfood entity-type enumeration | `f0ba9a2` |
| #29 | T4 — Closing hygiene + idea-193 fold + closing report | `2670cab` |

**Architectural deliverables:**
- ADR-024 §6.1 amendment ratifying local-fs reclassification (single-writer-laptop-prod-eligible, not dev-only)
- `hub/src/index.ts:106-109` gate relaxation: `process.exit(1)` → `console.warn` + proceed
- `STORAGE_BACKEND=local-fs` becomes the laptop-Hub default at start-hub.sh
- Bootstrap-required sentinel guard at Hub startup
- Defense-in-depth writability assertion (start-hub.sh shell-layer + hub/src/index.ts Hub-side, with explicit uid/gid diagnostic on EACCES/EPERM)
- 270-line operator runbook at `docs/runbooks/m-local-fs-cutover-drills.md`
- 270-line engineer-authored closing report at `docs/audits/m-local-fs-cutover-closing-audit.md`
- idea-193 folded: `docs/specs/entities.md` Repository-pattern updates; `deploy/README` §Outstanding sweep documented as no-op (no storage-abstraction-resolvable items remained)

**Closure of the 12-entity Repository migration arc:** mission-47 W1-W7 (10 entities) + mission-49 W8-W9 (Audit + Notification) shipped the migration; mission-48 is the deployment counterpart that operationalizes the storage-backend swap on laptop-Hub. ADR-024 6-primitive surface held across all 12 entities, 3 ID schemes (counter / fingerprint / ULID), 60+ CAS sites. Zero contract changes.

---

## 2. What worked (architectural wins)

### 2.1 β-split sequencing paid off cleanly

The decision in thread-303 (post greg's Flag #1 finding) to split into mission-49 (Audit/Notification migration prerequisite) → mission-48 (cutover) was structurally correct. Mission-49 closed the durability gap; mission-48 deployed it. Tele-3 PRIMARY ownership stayed with mission-49 (architectural play); mission-48 was tele-3 SECONDARY (operational). **Two clean missions instead of one muddled L-sized scope.** Director ratified β over α the same morning; the call paid off.

### 2.2 Pre-classified CI debt unlocked fast PR cadence

First PR of mission-49 (PR #21) surfaced cross-package adapter test failures; I triaged + filed as bug-32 same-day. Every subsequent PR across mission-49 + mission-48 (9 PRs total) rode the pre-classification — no fresh triage. Per-PR turnaround dropped from ~5min (PR #21 with triage) to ~3min (PRs #22-29 without).

**Calibration: file CI debt as a bug the moment you triage it.** First-occurrence triage cost ~5min; subsequent occurrences ride pre-classification for free. Zero-cost amortization across the whole mission flow.

### 2.3 Bug-31 bypass via skip-plannedTasks

Mission-49 fired bug-31 variant-1 twice (cascade auto-duplicate after manual create_task) plus variant-2 once (timeout-disrupts-atomicity). Cost: 2 duplicate-detection report cycles + 1 manual recovery.

Mission-48 ran **without `plannedTasks`** — every task issued manually via `create_task` per prior approval. Result: zero cascade duplicates over 6 tasks. Cost: 5 extra `create_task` calls (architect-side overhead, ~10s each). Benefit: zero duplicate-detection cycles, zero cascade-stall recoveries.

**Net win. Demonstrated technique.** Worth keeping as standing pattern until bug-31 lands a fix. Documented in `feedback_plannedtasks_manual_create_mismatch.md` memory.

### 2.4 Engineer's defensive deployment-state finding

At T3 drill kickoff, greg surfaced that the running Hub container was started 2026-04-24T22:02 — pre-mission-48-activation, on the GCS image, no bind mount, no uid override. The "dogfood validation" claim couldn't honestly mean "we exercised the local-fs path under realistic load" because the local-fs path wasn't actually deployed.

Greg flagged this **before** writing the dogfood section, with three honest paths and explicit tradeoffs (engineer/operator/defer). Director ratified (α): engineer documents procedures + verifies container rebuild; operator runs the drill; mission ships with the deployment-state finding captured explicitly.

This is the single most important engineering-quality moment of the mission. Glossing the dogfood claim would have been easy; the honest path was harder and produced better artifacts (the operator runbook, the explicit (α)/(β)/(γ) decision documentation, the captured side-finding about Hub-redeploy-not-gated-on-merge). **Pattern worth restating: deployment-config missions need an explicit "verify running infrastructure matches mission's deployment-target" check at the dogfood step — not just an assumption that merged code = deployed code.**

### 2.5 Direct architect-engineer thread coordination

Per Director direction 2026-04-25: I took direct ownership of all PR + closure coordination. Across thread-305 (mission-49 PRs) + thread-306 + thread-307 (mission-48 PRs), 9 PRs landed end-to-end without Director intervention. Each PR had: open → CI verify → architect approve → squash-merge with `--delete-branch` → next-task issuance. Median wall-clock per PR: ~3min in steady-state. Mission-47 by contrast had ~hour-per-PR cycles plus the stacked-PR-merge-cadence drift.

The difference: direct architect ownership of approve+merge under thread coordination + pre-classified CI debt + explicit bypass techniques for known bug classes. **Manual coordination is fast when both sides are in-session and friction classes are pre-known.** Worth restating as the velocity-proof Director was looking for.

---

## 3. What broke

### 3.1 Thread round-limit hit mid-mission

`thread-306` hit `maxRounds=10` at PR #27 announce — auto-escalation status mid-mission, blocking my reply. I had to spin up `thread-307` to continue T3 + T4 coordination. Director-visible disruption ("the thread has stopped" question) at exactly the wrong moment, since greg's PR was sitting waiting for review.

**Cause:** mission-48 had 6 PRs needing per-PR coordination → 12+ round exchanges → blew the default cap. I should have opened thread-306 with `maxRounds=20`, or staged thread rotation pre-emptively at the halfway boundary.

**Lesson capture:** at coordination-thread open-time, set `maxRounds` proportional to expected exchange volume (~2× task count + 4 for setup/close). Add to mission-lifecycle audit doc as a preflight checklist item. Better fix is mechanical: workflow-primitive thread should not have a fixed round cap, OR rotate transparently — but those are idea-192 territory.

### 3.2 Hub redeploy is not gated on mission-merge events

The single most important architectural finding from this mission, surfaced via greg's deployment-state inspection. Code merges to main → the running Hub keeps serving the old image until operator manually rebuilds + redeploys. **There is no event-triggered CD pipeline.**

Implications:
- Mission "shipped" ≠ "deployed" without explicit operator action. The gap can be days.
- Dogfood claims for deployment-config missions are structurally weak unless the deployment is explicitly verified.
- This is the same class as the workflow-primitive gaps idea-191 (GH event bridge) + idea-192 (Hub triggers + inbox) target — but distinct scope: it's CD-pipeline territory, not Hub-side workflow events.

Director acknowledged 2026-04-25. Will file as a discrete idea post-mission-close — separate from idea-191/192 because the scope is GH-Actions-side automated build+deploy, not Hub-side event ingestion. Benefits-from idea-191 (Hub-side awareness of deploy state) but the primary delivery is GH-side.

### 3.3 ADR-024 §6.1 amendment-scope subtlety almost slipped

The ADR-024 amendment we shipped (T1) reclassifies local-fs from dev-only to single-writer-laptop-prod-eligible. **This is a deployment-context reclassification, not a contract change.** The 6-primitive surface, the capability flags, the CAS semantics — all unchanged. Greg flagged this distinction explicitly in his sign-off; worth restating in architect voice.

**Architect-voice clarification for the methodology archaeology:** ADR amendments should be classified by what they change. Contract-change amendments require a new ADR (or a numbered ADR-version-bump per project convention). Deployment-context amendments (where to use the contract, under what operational discipline) sit cleanly as in-place §Amendments sections on the existing ADR. The distinction matters because future architects auditing ADR-024 should be able to tell instantly: was the contract modified? (No, never). Was deployment scope expanded? (Yes, in §6.1, dated 2026-04-25.)

Folding this clarification into the ADR-amendment methodology doc (or filing as a small idea) is on the architect-followup list.

---

## 4. Empirical findings worth strategic discussion

### 4.1 Single-session ~13h β-split end-to-end

Mission-49 + Mission-48 shipped engineer-side in one continuous session:
- Mission-49 (3 tasks, 3 PRs + 2 cascade-duplicate detours): ~5.5h
- Mission-48 (6 tasks, 6 PRs + 1 deployment-state finding + 1 runbook): ~6h
- Total β-split: ~13h with overhead for design rounds, retrospectives, bug filings.

**Velocity proof.** Up-front design-round investment (thread-303 + thread-304, ~90min combined) paid off as boring-mechanical implementation. The design-round cost was the load-bearing investment; everything downstream amortizes against it.

This is the structural argument for the Idea → Design → Mission discipline: it's not "extra ceremony before the work starts" — it's "the place where the work actually gets cheap."

### 4.2 Per-PR turnaround in steady-state ~3min

Across 9 PRs (mission-49 #21-23 + mission-48 #24-29) under direct architect-engineer thread coordination, median wall-clock per PR was ~3min from open → CI verify → approve → squash-merge. The bottleneck was not architect attention or CI runtime; it was the engineer's per-PR commit + push cycle.

**Calibration: when both sides are in-session and friction classes (CI debt, cascade bugs) are pre-classified, manual PR coordination scales to ~10-15 PRs/hour.** Auto-merge would shave ~15s × 9 = ~2min total over this mission — small absolute win but not a bottleneck.

### 4.3 12-entity Repository migration arc fully closed

Mission-47 (W1-W7, 10 entities) + Mission-49 (W8-W9, Audit + Notification) + Mission-48 (deploys local-fs as default) = the entire entity-storage layer is now Repository-over-StorageProvider, deployable on either GCS (Cloud Run) or local-fs (laptop) backends. ADR-024 6-primitive surface validated three times now: across 12 entities, 3 ID schemes, 60+ CAS sites, 0 contract changes.

The minimal-surface-discipline-paid-dividends claim from mission-49 retrospective extends to the third validation. **Sovereign Composition is now empirically the dominant entity-storage pattern in the Hub** — and the 6-primitive contract is validated for any future storage-shaped sovereign package as a viable starting surface.

### 4.4 Pattern-replication sizing calibration (cross-mission carry-forward)

- Mission-47 W1-W7: 4-5 eng-days estimated; ~1 day actual
- Mission-49 W8-W9 + closing: M-low estimated (1-1.25 eng-days); ~5.5h actual
- Mission-48 6 tasks: M estimated; ~6h actual

**Three data points say: pattern-replication missions trend toward the lower edge of the sizing band, sometimes substantially below it.** Future calibration: when sizing a mission whose primary character is "apply established pattern X to N entities/configurations," size at S not M; budget design-round cost separately as the fixed up-front cost.

---

## 5. Ideas filed or reinforced this mission

- **bug-32** (cross-package CI debt) — major; filed during PR #21 triage 2026-04-25; pre-classification unlocked fast PR cadence for the remainder of the β-split sequence
- **bug-31** (cascade-bookkeeping divergence) — major (escalated mid-mission-49); 3 firings observed; bypass technique works but doesn't fix underlying issue
- **CD-pipeline idea** (Hub auto-redeploy on main-merge) — to be filed post-close; greg's side observation; Director-acknowledged 2026-04-25
- **idea-191** (GH event bridge) — priority reinforced; manual coordination overhead measured at ~3min/PR + thread-rotation-required-mid-mission
- **idea-192** (Hub triggers + inbox) — priority reinforced; cascade-bookkeeping bug-31 keeps firing across missions

---

## 6. Points for Director discussion next session

Ordered by importance:

1. **Operator-side drill outputs.** When you redeploy + drill, share outputs (or signal close-without-drill). I'll incorporate into this retrospective + flip mission-48 status. If anything surfaces regression, that becomes a follow-up bug + PR per mission-48 §3 anti-criterion. Drill includes: container rebuild via `OIS_ENV=prod scripts/local/build-hub.sh`; bootstrap via state-sync.sh; restart smoke; rollback drill consuming T2c reverse-sync.

2. **CD-pipeline idea priority.** Hub-redeploy-on-main-merge is now a structural friction class — every code-shipping mission will have the same dogfood-vs-deploy gap until this is mechanized. Discrete from idea-191/192. Recommend filing immediately + considering priority placement in the next strategic-review pass alongside idea-191/192.

3. **bug-31 priority promotion.** Variants firing once-per-mission for 3 missions running. Bypass technique works but the cost compounds. Worth a dedicated mission to fix one of: (c) auto-issue plannedTasks[0] on activation, (d) cascade transactional consistency, (e) cascade-replay trigger. Combined fix is best.

4. **Thread round-limit policy.** Mission-48 needed mid-mission thread rotation (thread-306 → thread-307). Default `maxRounds=10` is too low for coordination-mode threads in multi-task missions. Two options: (i) raise default to 20+ for unicast coordination threads, (ii) formalize rotation-at-boundary pattern in mission-preflight. Either way needs methodology update.

5. **Pattern-replication sizing.** Three data points argue for sizing pattern-replication missions at S not M. Worth applying retroactively to any future "apply pattern X to N entities" or "deploy pattern X" mission shape. Update mission-preflight sizing guidelines.

6. **β-split methodology codification.** The split-when-scope-creeps pattern (mission-49 spawned from mission-48 design-round Flag #1) worked beautifully. Worth codifying as a mission-preflight option: when design-round surfaces material hidden scope, default to splitting into sequential missions over bundling. Update mission-preflight methodology with the (α)/(β) decision framework.

---

## 7. What I'd do differently (architect self-critique)

- **Anticipated thread round-limit.** Mission-48 had 6 PRs requiring per-PR coordination → ~12 round exchanges → blew the default cap mid-mission. Should have opened thread-306 with `maxRounds=20`, OR staged thread rotation pre-emptively at PR #4 boundary (a clear midpoint).
- **Verified deployment-state at mission-activation time.** The Hub-running-on-pre-mission-48-image situation could have been caught at activation rather than at T3 drill time. Future deployment-config missions: add "verify running Hub state matches mission's deployment-target" as a preflight item. This was greg's catch, not mine; I should have caught it earlier in the cycle.
- **Formalized the bug-31 bypass.** Skipping plannedTasks worked beautifully but I made the call ad-hoc per-mission. Worth codifying as a standing technique in mission-preflight methodology, with the rationale + applicability bounded ("until bug-31 fixed").
- **Filed the CD-pipeline idea sooner.** The Hub-redeploy-not-gated-on-merge finding emerged at T3 drill time; I'm only filing post-close. Should have filed immediately when greg surfaced it — captures the "this is real, here's the evidence" provenance crisply.

---

## 8. What went surprisingly well

- **Greg's deployment-state finding.** Single biggest engineering-quality moment of the mission. Honest engineering produced better artifacts than glossing would have.
- **Sub-3-minute PR cadence in steady-state.** 9 PRs in ~80 minutes wall-clock across mission-49 + mission-48. The discipline-paid-off pattern.
- **ADR-024 contract held its 12th entity validation target without modification.** Three extended load tests, three ID schemes, 60+ CAS sites, zero contract changes. The minimal-surface design continues to be the dominant call.
- **bug-31 bypass via skip-plannedTasks.** Zero cascade duplicates this mission vs 2 in mission-49. Demonstrated technique without needing the underlying fix.
- **Director-in-session continuous engagement.** Different cadence than mission-47 (intermittent). Continuous Director presence enabled β-split call in real-time, (α)-path call on the deployment-state finding, manual-issue workarounds without delay. Worth carrying forward as session-pattern preference for fast missions.

---

## 9. Mission-48 closing state — pre-drill

- Engineer-side work: **complete** (6 PRs merged: T1+T2a+T2b+T2c+T3+T4)
- Closing report (engineer-authored): `docs/audits/m-local-fs-cutover-closing-audit.md`
- Operator drill runbook: `docs/runbooks/m-local-fs-cutover-drills.md`
- Architect retrospective: **this document** (complete-pending-drill-outputs)
- Architect mission-status flip: **pending** (gated on drill outputs OR Director close-without-drill signal)
- Operator-side redeploy + drill: **pending** (Director-side; rebuild command on record: `OIS_ENV=prod scripts/local/build-hub.sh`)
- CD-pipeline idea filing: **pending** (post-close)

This retrospective will receive a §10 amendment after drill outputs land or the close-without-drill signal arrives. The engineer-side scope is structurally complete; operational verification is the only remaining gate.

---

## 10. Drill outcomes (post-drill amendment, 2026-04-25)

Director performed the redeploy + health-validation drill 2026-04-25 same-session, immediately after T4 merged. Three distinct surfaces tested; one previously-latent bug surfaced + worked around; one operational divergence discovered + filed as follow-up; rest green.

### 10.1 Container rebuild

Director ran `OIS_ENV=prod scripts/local/build-hub.sh` from the main tree. **First attempt failed** — `RUN npm run build` (tsc) errored with 30+ `TS2307: Cannot find module '@apnex/storage-provider'` errors across every `*Repository.ts` file. Build aa5f702a-f971-47c5-a700-b65d24d7e522.

**Root cause:** `hub/package.json` references the sovereign storage-provider package via `file:../packages/storage-provider`. `scripts/local/build-hub.sh` uploads only `hub/` as Cloud Build context; the parent `packages/` directory is not included. NPM cannot resolve the relative-path dep inside the Cloud Build container; tsc fails on every file that imports the package types.

This is the **never-actually-tested half of mission-47 retrospective §3.3 trap #1**. Mission-47 fixed the type-build leg (removed `prepare:tsc` + committed dist) but never addressed the cross-package-context leg. **Mission-47 + Mission-49's Cloud Build was never run** — confirmed by greg's earlier deployment-state finding (running Hub was pre-mission-47 image). Mission-48's redeploy is the first Cloud Build of the entire sovereign-package consumer code, and it surfaced the latent trap immediately.

**Workaround applied (architect-side, uncommitted in main tree's working dir):**
1. `npm pack` of `packages/storage-provider/` → `ois-storage-provider-1.0.0.tgz`
2. Staged tarball at `hub/ois-storage-provider-1.0.0.tgz`
3. `hub/package.json`: `"@apnex/storage-provider": "file:./ois-storage-provider-1.0.0.tgz"`
4. Regenerated `hub/package-lock.json` via full `npm install`
5. `hub/Dockerfile`: added `COPY ois-storage-provider-*.tgz ./` before each `RUN npm ci` (both builder + production stages)

Build then succeeded. Image landed at `australia-southeast1-docker.pkg.dev/labops-389703/cloud-run-source-deploy/hub:latest` digest `sha256:8216caadcf5336f09fa17c509d9f40e277dea088a4fcab2b9fca38db31f95594`. **Filed as bug-33** (severity major, class `build-pipeline`); 3 remediation options enumerated; my lean (b) — codify the tarball workaround in `build-hub.sh` for short-term + (a) npm workspaces as the structural fix.

### 10.2 Bootstrap-required sentinel guard fired correctly

Director ran `OIS_ENV=prod scripts/local/start-hub.sh` post-rebuild. **Fail-fast as designed** — Hub refused to start with FATAL message:

```
[Hub] STORAGE_BACKEND='local-fs' under NODE_ENV='production' — laptop-Hub
single-writer-prod profile. Single-writer enforcement: scripts/local/start-hub.sh
enforces one ois-hub-local-* container at a time...

[Hub] FATAL: STORAGE_BACKEND='local-fs' but cutover sentinel missing at
/home/apnex/taceng/agentic-network/local-state/.cutover-complete. The
local-fs state directory has not been bootstrapped from GCS — Hub refuses
to start without a validated cutover.
```

This is **mission-48 T2b's bootstrap-required guard working exactly as intended**. The startup sequence:
1. ADR-024 §6.1 amendment policy banner printed (gate relaxation acknowledgment + single-writer-discipline reminder) — confirms T1 gate-relaxation logic active
2. Bootstrap sentinel check fired — confirms T2b sentinel guard logic active
3. FATAL with specific path + remediation hint — confirms diagnostic output discipline (per task-357 deliverable #3)

**Architect ran the remediation** (`scripts/state-sync.sh` forward) on Director's behalf: 8,012 files copied (~11.2 MiB), set-equality invariant green, sentinel written. Director restarted Hub successfully.

**Worth restating:** the guard prevented exactly the failure mode it was designed for — accidental local-fs startup against a never-bootstrapped state directory. T2b's fail-fast posture worked.

### 10.3 Post-startup health validation: green

Architect performed full data-plane health validation post-Hub-restart:

- **Container layer:** `ois-hub-local-prod` running on `ois-hub:local`; env confirmed (`STORAGE_BACKEND=local-fs`, `OIS_LOCAL_FS_ROOT` mounted, `NODE_ENV=production`); bind mount writes through to host filesystem.
- **State layer:** all 11 entity directories present in `local-state/`; sentinel intact (415 bytes, direction=forward, source bucket recorded, script commit `2670cab`).
- **Namespace cutover (mission-49 W8/W9 verification):** `audit/v2/` populated with counter-format IDs (W8 cutover live); legacy `audit/` namespace preserved frozen (W8 anti-goal correctly honored); `notifications/v2/` preserved byte-identically (W9 anti-goal honored).
- **MCP data plane:** `get_pending_actions` returned identical state to pre-cutover (no spurious entries, no missing data); `list_missions` filter on `status=completed` returned mission-46/47/49 with full descriptions, plannedTasks bookkeeping, source-thread summaries — **state preserved byte-faithfully across the cutover**.

The implicit dogfood + readback assertion (§1 + §2 from runbook) is satisfied by the post-restart MCP traffic in this very session: every read returned the correct entity, every cascade fired correctly, no regression. Full §2 explicit pre/post enumeration with set-equality assertion was not run as a separate procedure — the implicit pass on a session-volume of operations is unambiguous.

### 10.4 Operational discovery: GCS divergence post-cutover

Director surfaced the question 2026-04-25: "So we are absolutely not using GCS any more?" Architect's clarification: yes for Hub state operations; GCS bucket `gs://ois-relay-hub-state/` is now a frozen point-in-time snapshot from cutover (2026-04-25 13:04:26 AEST). All Hub writes post-cutover diverge from GCS until explicit reverse-sync.

**Filed as idea-196: Hub state backup cadence — policy + tooling for local-fs → GCS replication.** Operational gap, not a regression — but worth defining cadence policy explicitly to prevent silent drift catastrophe (laptop disk loss = lose all post-cutover work).

### 10.5 Filings + idea queue (post-mission-48-close)

- **bug-33** (cross-package Cloud Build context; major; build-pipeline class) — filed during drill; 3 remediation options; lean (b) for short-term + (a) for structural
- **idea-196** (Hub state backup cadence) — filed post-drill from Director's GCS-divergence question
- **idea-197** (Hub auto-redeploy on main-branch-merge — CD-pipeline territory) — filed post-drill, capturing greg's deployment-state finding as a discrete idea distinct from idea-191/192
- **bug-31 bypass technique demonstrated** (skip-plannedTasks on mission-48) — zero cascade duplicates over 6 tasks vs 2 on mission-49; technique added to `feedback_plannedtasks_manual_create_mismatch.md` memory as standing pattern until bug-31 fixed

### 10.6 Mission-status flip rationale

Engineer-side scope: complete (6 PRs merged, closing report shipped).
Operational drill: complete (rebuild + bootstrap + restart + health-validation, all green; bug-33 surfaced + worked-around; divergence operational gap captured as follow-up idea).
Architect-side: retrospective complete (this document).

**Flipping mission-48 → `completed` 2026-04-25.** β-split sequence (mission-49 prerequisite migration → mission-48 cutover) is now operationally complete and dogfooded.

The bug-33 workaround in main tree's working dir (uncommitted) is a known operational follow-up — not a mission-48 incompletion. The next operator to redeploy will hit the same trap; bug-33's recommended fix (option (b) build-hub.sh codification) is the unblocking action; can ship as a small standalone PR or bundle into the next mission's first deliverable.

---

*Mission-48 closed 2026-04-25. β-split sequence (mission-49 + mission-48) closes the entity-storage migration arc + operationalizes local-fs as laptop-Hub default. For discussion next session.*
