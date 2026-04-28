# Mission-52 M-Repo-Event-Bridge — Architect Retrospective

**Status:** complete. Preflight + 5 task waves shipped + merged. Mission-status flipped → completed. Architect-side dogfood deferred pending Director call on mission-53 sequencing or coordinated-restart path.
**Authored:** 2026-04-25 post-T5 landing during autonomous-operation window.
**Provenance:** mission-52 scoped via thread-312 design round (2 rounds; engineer audit produced T4 doc-only scope reduction + 4 refinements + 4 design-space captures; architect ratified all + 2 minor refinements). Tier 1 follow-on to mission-51 W1; activated 2026-04-25 ~21:20Z post-preflight GREEN. Sovereign-package #5 (sibling to network-adapter / cognitive-layer / storage-provider / message-primitive).

---

## 1. What shipped

**Preflight + 5 task waves**, single autonomous-operation calendar day:

| Wave | Scope | Outcome | Merge SHA | PR |
|---|---|---|---|---|
| Preflight | mission-52 preflight check (verdict GREEN; one E2 YELLOW-on-coherence-not-blocker) | Approved | `a5828b1` | #51 |
| T1 | @apnex/repo-event-bridge sovereign-package contract (EventSource async-iterator + capability flags + health() + 8-subkind translator + CreateMessageSink stub + 45-test conformance suite) | Approved | `906f6bf` | #52 |
| T2 | PollSource implementation (PAT auth + scope-validation; 30s cadence + soft-limit budget log; 3-layer 429 handling; per-repo cursor + bounded LRU dedupe via @apnex/storage-provider) | Approved | `2fc554d` | #53 |
| T3 | Hub integration (in-Hub component loading + start-hub.sh env-var + create_message wired + RepoEventBridge state machine; describe.skip + TODO(idea-186) on integration test) | Approved (Path 2 after 3-revision-arc) | `614211a` | #54 |
| T4 | WebhookSource design doc (doc-only per thread-312 round-2 scope reduction; replaces stub-skeleton) | Approved | `2b37a44` | #55 |
| T5 | Closing audit (304 lines per canonical 8-section shape) | Approved | `76836ed` | #56 |

**Cumulative outcomes:**
- Sovereign-package #5 contract ratified — async-iterator EventSource interface + capability flags + health()
- 8-subkind translator with unknown-fallback graceful-degrade
- PollSource concrete impl with 3-layer 429 handling (header-driven Retry-After / X-RateLimit-Reset; separate from generic exp-backoff for transient failures) + per-repo cursor + bounded LRU dedupe
- Hub-side integration (in-Hub component loading; conditional on env-var; SIGINT-aware shutdown; PAT failure isolation — Hub doesn't crash on under-scoped/auth-failure)
- WebhookSource design doc captures App-vs-PAT auth divergence + mode-parity invariant for future runtime
- 106 in-package tests; 919 hub vitest baseline preserved (T3 added 18 hub-side tests but skipped per Path 2)
- ADR-024 contract surface unchanged throughout
- Cross-package adapter failures match bug-32 pre-existing pattern across all PRs
- 3 idea-186 sunset surfaces clearly documented (test-skip; committed dist/; .gitignore-permitting-dist)

**Engineer-judgment scope choices (architect-ratified):**
- T4 doc-only (engineer audit at thread-312 round-2): saved ~1-2 days of stub-rot risk; T1's interface IS the source-pluggability proof
- T3 Path 2 (Director-directed): describe.skip + TODO(idea-186) instead of further resolution-mechanism gymnastics; ships today; idea-186 sunsets cleanly

---

## 2. What worked (architectural wins)

### 2.1 Engineer wave-cadence speed remained exceptional through T1+T2+T4

T1 (2650 LOC sovereign-package contract + 45 tests) shipped within minutes of issue. T2 (2392 LOC PollSource + 61 new tests = 106 in-package total) shipped similarly fast. T4 (184-line design doc) shipped quickly. The mission-51-validated pattern continues: thorough design round + W0-style spike-equivalent (here: thread-312 round-2 produced 1 scope reduction + 4 refinements + 4 design-space captures) means engineer starts each wave with high context-density, ships fast.

T3 was the exception (3 revision rounds + escalation + Director Path 2 directive). Not engineer-cadence problem — structural/architectural problem (next section).

### 2.2 ADR-024 boundary discipline held perfectly across mission-52 too

Like mission-51, mission-52 added zero new contract surface. EventSource interface is its own sovereign-package contract; doesn't widen StorageProvider. Cursor + dedupe persistence "eats own dogfood" using existing single-entity primitives (putIfMatch + createOnly). The five-sovereign-package-architecture pattern (network-adapter + cognitive-layer + storage-provider + message-primitive + repo-event-bridge) is now empirically validated as scaling cleanly without contract amendment.

### 2.3 3-layer 429 handling pattern is reusable beyond GH

Engineer's T2 implementation differentiates 429 (header-driven; Retry-After wins precedence over X-RateLimit-Reset) from generic exp-backoff (1s→2s→5s→10s→30s with pausedReason='network'). The architectural separation is correct (mission-52 audit emergent observation via thread-312): exp-backoff after 429 either undershoots → 429 storm OR overshoots → cursor lag.

This pattern generalizes to ANY rate-limited cloud API (GCS, Cloud Build, GH, Slack, etc.) where the API surfaces explicit retry-after info. Future cloud-API integrations can pattern-replicate. Methodology v1.x candidate.

### 2.4 Engineer audit produced material scope reduction (T4 doc-only)

Architect-initial T4 was "stub-skeleton WebhookSource" runtime code. Engineer audit at thread-312 round-2: stubs rot if not exercised; non-functional skeleton accumulates drift; signals false readiness. Architect ratified the scope reduction; T4 ships as design doc only. T1's interface declaration IS the source-pluggability proof.

This continues the pattern from mission-50 (engineer pushback on permanent-commit shape → transient-swap) and mission-51 (engineer pushback at multiple wave audits). Engineer audit on architect framing has consistently produced scope reductions or refinements that improve the mission. Methodology v1.0 §design-round-discipline reinforced again.

### 2.5 Director Path 2 directive resolved architectural gridlock cleanly

T3 ran 3 revision rounds chasing cross-package resolution mechanisms (round-1: dist/ committed; round-2: prepare-script with tsc; round-3: vitest preserveSymlinks). Each hit a different non-workspaces fragility. Director directive (Path 2: revert + describe.skip + TODO(idea-186)) cut the loop cleanly. Mission ships today; sunset is mechanical when workspaces land.

This is a **methodology calibration #20 candidate**: when architectural gridlock surfaces in mid-implementation revision rounds, escalate to Director-call rather than continuing rev-by-rev architect-driven resolution attempts. Architect-driven revision works when the resolution shape is knowable; when the resolution requires a structural prerequisite (here: workspaces) that hasn't shipped yet, revisions accumulate without converging.

---

## 3. What didn't work / lessons

### 3.1 T3's 3-revision-cascade was a methodology-application gap

Round 1: I rejected committed dist/ as anti-pattern (correct in workspaces world; wrong in this non-workspaces context). Round 2: prepare-script alternative hit cross-package resolution at install time (a deeper structural limit I didn't recognize until it failed). Round 3: vitest preserveSymlinks change cascaded to 58 tests (a side-effect I didn't predict).

Each revision-round I authored confidently as the right next step; each was wrong (or insufficient) at deeper architectural levels than I had loaded into context. The lesson: **when architect-driven mid-revision resolution attempts fail repeatedly, the revision-counting threshold (FSM revisionCount≥3) correctly signals "escalate" — the limit is doing its job.** I accepted the escalation cleanly when it arrived; the methodology worked. But the revision rounds before that did consume engineer time on attempts I should have escalated sooner.

**Methodology calibration #20 candidate:** when architect-driven revision rounds hit a structural prerequisite (workspaces-or-die territory; no-clean-resolution-without-X), recognize it explicitly + escalate to Director immediately — don't continue rev-by-rev attempts hoping resolution emerges.

### 3.2 Cross-package install-order fragility surfaced 3 distinct mechanisms; all 3 sunset on idea-186

mission-50 papered over the storage-provider cross-package issue with tarball-staging in build-hub.sh (consumed only by hub). mission-52 hit the issue twice as deep (repo-event-bridge depends on storage-provider AND is consumed by hub — two-hop chain). The 3 mechanisms tried in T3:
- **Prepare-script with tsc** — fails because @apnex/storage-provider not yet installed in package's local node_modules at install time
- **Committed dist/** — works for install-time resolution but fails at runtime because resolution from packages/repo-event-bridge/dist/ doesn't reach hub/node_modules where @apnex/storage-provider lives
- **Vitest preserveSymlinks** — would solve runtime resolution but cascaded to 58 tests because it broke storage-provider/dist/gcs.js's resolution of @google-cloud/storage

Each mechanism has a different failure mode; all three sunset cleanly when idea-186 (npm workspaces) lands and the hoisted node_modules layout makes cross-package resolution natural.

**Lesson:** without npm workspaces, ANY new sovereign-package with cross-package internal deps will hit this same class of issues. Mission-52 is the second instance; future missions consuming repo-event-bridge OR adding new packages with internal deps will hit a third, fourth, etc. **idea-186 prioritization is well-justified by this empirical accumulation.**

### 3.3 CI workflow npm ci → npm install gap was missed in mission-50 retrospective

Mission-50 T5 fixed the lockfile-incompatibility issue at the Dockerfile path by switching to `npm install`. The CI workflow path was not modified at the time because no PR since had touched hub/package-lock.json — the issue was latent. Mission-52 T3 was the first PR to touch hub/package-lock.json (because it added @apnex/repo-event-bridge as a dep); CI immediately failed.

**Methodology calibration #18 candidate (extends mission-50 §calibration #16):** deploy-pipeline + CI-pipeline are TWO independent install paths; lockfile-compatibility fixes need to apply to both. Mission-50's fix at the Dockerfile shipped; mission-52 T3 round-2 fix at the CI workflow ships now; lesson should be locked in for any future mission touching install-path config.

### 3.4 idea-202 (CI value-vs-friction) surfaced organically from this mission

Director-flagged 2026-04-25 ~22:35Z during T3 revision-3 escalation: "We need to revisit CI and what value its giving us. these checks and failings while we are trying to build is too-high friction." Filed as idea-202 for next strategic-review-cycle backlog visibility.

mission-52 surfaced the friction class clearly: 3 revision rounds + 1 escalation across CI workflow gates + cross-package install path gates + bug-32 pre-existing-failure mental load on every PR review. Each gate is individually defensible; cumulative friction is real.

**Lesson:** capture friction observations in idea form when they surface in-mission rather than waiting for retrospective. Next mission should pre-load idea-202 context if it touches CI.

---

## 4. Methodology calibrations to ratify

Three new candidates from mission-52 (extending the 7 already accumulating from missions 50/51):

### Calibration 18 (NEW): Lockfile-compatibility fixes apply to BOTH deploy-pipeline + CI-pipeline

**Rule:** when a missions fix surfaces lockfile-incompatibility / cross-package-install-path issues at any install-path (Dockerfile / CI workflow / build-hub.sh / etc.), audit ALL install paths during the same retrospective + apply the fix everywhere applicable.

**Why:** mission-50 T5 fixed the Dockerfile path (npm ci → npm install); CI workflow path remained `npm ci`; latent failure surfaced at mission-52 T3 round-2. Cost: ~3 architect-hours of rev-cycling that could have been preempted.

**How to apply:** at retrospective time, when a lockfile-pipeline fix lands, the closing-audit explicitly enumerates all install-paths in the codebase + verifies each is consistent. Bake into mission-50 + mission-52 cleanup pre-commit-checklist.

### Calibration 19 (NEW): 3-layer cloud-API resilience pattern (header-driven retry separate from generic exp-backoff)

**Rule:** for cloud-APIs that surface explicit retry-after metadata (HTTP 429 / 503 with Retry-After header; X-RateLimit-Reset; Retry-Ms hints), implement TWO retry paths:
1. **Header-driven:** honor the API's hint exactly; don't substitute self-driven backoff
2. **Generic exp-backoff:** for transient failures (network, 5xx without retry-hint), use 1s→2s→5s→10s→30s cap with jitter

Both paths set distinct health-state markers (e.g., `pausedReason: 'rate-limit'` vs `'network'`) for operator diagnostic clarity.

**Why:** exp-backoff after 429 either undershoots (storm) or overshoots (cursor lag). mission-52 T2 PollSource demonstrates the pattern; reusable for any future GCS / Cloud Run / Slack / etc. integration.

**How to apply:** future cloud-API integrations pattern-replicate the GhApiClient three-layer shape (single fetch → outcome enum → loop runner reads outcome + sleeps appropriately).

### Calibration 20 (NEW): Architect-driven revision rounds have a structural-prerequisite ceiling

**Rule:** when architect-driven mid-revision resolution attempts hit a structural prerequisite that hasn't shipped (workspaces-or-die territory; no-clean-resolution-without-X), recognize the gridlock explicitly + escalate to Director immediately rather than continuing rev-by-rev attempts.

**Indicators of gridlock:**
- Each revision-round attempts a different mechanism for the same structural problem
- Each mechanism reveals a deeper layer of the same root cause
- Engineer ships in good faith each time; CI keeps failing in different surface positions
- Architect-recommended-next-mechanism feels like "let me try another resolution shape" rather than "let me apply the known correct fix"

**Why:** mission-52 T3 demonstrated the pattern exactly. 3 revision rounds + 1 escalation produced a Path-2 (skip + TODO sunset) directive that should have been considered in round-1. Cost: ~3 architect-hours + 1 engineer-day of confidence-eroding rev-cycling.

**How to apply:** at revision-2, if the resolution attempts feel like "different mechanism, same problem", architect surfaces explicitly to Director rather than attempting revision-3. Director can directive Path-2 (skip + sunset) OR pause the mission OR pivot to the structural prerequisite (here: idea-186).

---

## 5. Open items / surface for Director

- **mission-53 M-Adapter-Reconnection** — proposed; awaiting your activation; potential clean Hub redeploy enabler for mission-52 dogfood
- **idea-186 (npm workspaces)** — Director-flagged as upcoming priority; sunsets 3 mission-52 idea-186-tagged surfaces (test-skip; committed dist/; .gitignore permission)
- **idea-199 M-Workflow-FSM-Completeness** — Tier 1 follow-on to mission-51; design round opens at next strategic-review
- **idea-202 (Revisit CI value vs friction)** — Director-flagged from mission-52 T3 escalation; bundle into upcoming strategic-review cycle alongside idea-186
- **idea-200 + idea-201** — mission-51 mechanical cleanup PRs; whenever convenient
- **mission-52 architect-side dogfood** — deferred pending Director-call: (a) activate mission-53 first → clean Hub redeploy without greg-restart; (b) Director-coordinated greg restart + redeploy now; (c) defer dogfood + close mission with skip-noted-coverage. Live-GH PAT provisioning needed for dogfood.
- **3 new methodology calibration candidates** (18/19/20) accruing for next-cycle bundle alongside the 7 from missions 50/51 (#11/12/13/14/15/16/17). **Total 10 calibration candidates.** Recommend bundling as methodology v1.1 update PR when convenient.

---

## 6. Closing reflection

Mission-52 was scoped as the **Tier 1 follow-on to mission-51**, sinking GitHub repository events into the message primitive via @apnex/repo-event-bridge sovereign package. It shipped the architectural deliverables cleanly: sovereign-package #5 contract; PollSource concrete with 3-layer 429 handling; Hub integration with PAT failure isolation; WebhookSource design doc; closing audit.

The mission demonstrated **multiple methodology v1.0 patterns in concert**:
- Thread-312 design round (engineer audit produced T4 doc-only scope reduction; architect ratified) ✓
- Pattern-replication speed (engineer cadence sub-hour-per-substantial-wave for T1/T2/T4) ✓
- Mission-51 calibrations 11-17 all reinforced or applied ✓
- ADR-024 boundary discipline held throughout ✓
- bug-31 bypass active throughout (last bypass-active mission since mission-51 W5 closed bug-31 structurally; technique formally sunsets here) ✓

T3's 3-revision-arc + escalation + Director Path 2 was the salient hard-edge — surfaced 3 mechanisms of cross-package install-order fragility (all sunset on idea-186); generated methodology calibration #20 candidate; surfaced Director-flagged CI concern as idea-202. The escalation worked: methodology v1.0's revisionCount≥3 threshold correctly identified that architect-driven resolution had run out of useful mechanisms; Director-call provided clean Path 2.

3 new calibrations (18/19/20) crystallized; combined with the 7 from missions 50/51, **10 methodology v1.x calibrations now accumulating** for the next-cycle bundle. Strong signal for a methodology v1.1 ratification PR when convenient.

The mission shipped engineer-side complete in a single autonomous-operation session — sub-day total engineer time across 5 waves of substantial feature surface (with the T3 revision-arc + Path 2 transition adding ~1 architect-hour + ~3 engineer-iterations of confidence-eroding rev-cycling). **The autonomous-operation cadence operated effectively even through the T3 architectural gridlock** — Director-directive resolved within minutes; greg's session resumed cleanly to execute Path 2.

mission-53 M-Adapter-Reconnection awaits Director activation; idea-186 (workspaces) is the structural prerequisite for sunsetting 3 mission-52 anti-pattern surfaces; idea-202 (CI revisit) is the operational prerequisite for reducing build-time friction. All three are downstream surfaces for upcoming sessions.

— lily / architect
