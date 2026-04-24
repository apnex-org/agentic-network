# M-Sovereign-Storage-Interface — Work Trace (live state)

**Mission scope.** Mission-47 — harden hub storage into a sovereign architectural surface. CSI-inspired `StorageProvider` contract packaged as `@ois/storage-provider/`, parallel to `@ois/network-adapter` + `@ois/cognitive-layer`. Entity repositories compose the provider without backend-specific branches.

**Mission brief:** `get_mission(mission-47)` (Hub entity; cascade-spawned from thread-290 action-1).
**Design round:** thread-290 (architect lily + engineer greg, converged 2026-04-24).
**Release-gate:** thread-291 (Director approval, 2026-04-24).
**ADR:** [`docs/decisions/024-sovereign-storage-provider.md`](../decisions/024-sovereign-storage-provider.md).
**Coordination model:** Option C hybrid — DAG-driven serialization + 4 architect-gated checkpoint threads (post-T1, post-W1, pre-W7, T5) + routine waves via normal PR-review.
**How to read + update this file:** `docs/traces/trace-management.md`.

**Status legend:** ▶ in-flight · ✅ done this session · ○ queued / filed · ⏸ blocked

---

## Resumption pointer (cold-session brief)

If you're picking up cold on mission-47:

1. **Read this file first**, then the ADR (`docs/decisions/024-sovereign-storage-provider.md`), then thread-290 + thread-291 for convergence context.
2. **DAG:** T1 → T2 (W1..W7) → T3 → T4 → T5. Sequenced; next wave unblocks on prior merge.
3. **Current state:** T1 complete + PR up (see In-flight below). Awaiting architect post-T1 acceptance thread before W1 unblocks.
4. **Pre-authorized carve-outs:** Agent (W7) to sibling mission if contract gaps surface in W1-W5; L-escalation honest-flag.
5. **Ship-green discipline:** each wave adds conformance + repository tests + removes legacy per-backend entity tests in its own PR. Tests are first-class scope per Director direction.

---

## In-flight

- ▶ **T2-W1 — tele repository migration.** Shipped locally; PR pending push. Thread-290 §3 contract-validation ground. Hub suite 725/730 pass (baseline preserved); no regressions. Next: push branch, open PR, ping lily for post-W1 contract-validation checkpoint thread per Option C.

## Queued / filed

- ○ **T2-W2 bug + idea** — blocked on W1 post-checkpoint acceptance.
- ○ **T2-W3 director-notification** — blocked on W2.
- ○ **T2-W4 mission** — blocked on W3.
- ○ **T2-W5 task + proposal** — blocked on W4.
- ○ **T2-W6 thread** — blocked on W5.
- ○ **T2-W7 turn + pending-action + agent** — blocked on W6; L-escalation candidate.
- ○ **T3 sync script + STORAGE_BACKEND=local-fs wiring** — blocked on W7.
- ○ **T4 comparative latency measurement** — blocked on T3.
- ○ **T5 closing audit + hygiene** — blocked on T4; mission-status flip architect-gated.

---

## Done this session

### T2-W1 (tele repository migration) — shipped 2026-04-24

- ✅ **`hub/src/entities/counter.ts` — `StorageBackedCounter`.** Provider-agnostic CAS counter (replaces GCS-specific `getAndIncrementCounter` at the repository layer per ADR-024 §2.5). Uses `getWithToken` + `createOnly` bootstrap + `putIfMatch` retry loop. MAX_CAS_RETRIES=50; in-process Mutex preserves the serialized-counter guarantee from the historical `counterLock`. Full `Counters` interface preserved (`taskCounter`, `teleCounter`, ...) so wave-by-wave rollout doesn't require counter-file renumbering.
- ✅ **`hub/src/entities/tele-repository.ts` — `TeleRepository implements ITeleStore`.** Composes any `StorageProvider` + `StorageBackedCounter`. Layout `tele/<teleId>.json` matches historical GCS keyspace exactly. Read-side `normalizeTele` preserved (mission-43 zero-backfill). `supersedeTele` + `retireTele` via internal `casUpdate` method (read-with-token → transform → putIfMatch with retry; surfaces loudly on exhausted retries rather than silent stale state).
- ✅ **Legacy classes deleted.** `MemoryTeleStore` removed from `hub/src/entities/tele.ts`. `hub/src/entities/gcs/gcs-tele.ts` deleted entirely. `hub/src/entities/index.ts` barrel replaces `{Memory,Gcs}TeleStore` exports with `{TeleRepository, StorageBackedCounter, normalizeTele, Counters, CounterField, TeleStatus}`.
- ✅ **`hub/src/index.ts` startup.** Builds `StorageProvider` (MemoryStorageProvider for memory-mode, GcsStorageProvider for gcs-mode); shares it with `StorageBackedCounter`; instantiates `TeleRepository`. `let teleStore: ITeleStore` declaration unchanged — policy layer untouched.
- ✅ **Test scaffolds updated.** `hub/src/policy/test-utils.ts` + `hub/test/e2e/orchestrator.ts` — both now build MemoryStorageProvider + StorageBackedCounter + TeleRepository instead of MemoryTeleStore. Fresh provider per test-context (no state leakage).
- ✅ **Hub dependency added.** `hub/package.json` gains `"@ois/storage-provider": "file:../packages/storage-provider"`. `prepare: tsc` script on storage-provider triggers automatic build during `npm install`; no tarball ceremony (distinct class from bug-30 adapter tarball issue).
- ✅ **Verification.** tsc strict-mode clean. Full hub suite 725 passing / 5 skipped / 0 failing — identical to pre-W1 baseline. No regressions; structural refactor only.

### T1 (contract + 3 providers + conformance suite + ADR-024) — shipped 2026-04-24

- ✅ **Design round thread-290 convergence.** Architect (lily) + engineer (greg) converged on revised brief. Key engineer-driven refinements: contract surface expanded to 6 primitives (added `createOnly` as first-class); CAS-is-prod-floor reframing (`cas:false` dev-only); counter-primitives-as-repository-helpers. 7-wave migration sequencing accepted as engineer-authored. Agent W7 pre-authorized carve-out with L-escalation honest-flag.
- ✅ **Release-gate thread-291 convergence.** Director approved via architect; Option C hybrid coordination model accepted; DAG + checkpoint gates agreed.
- ✅ **T1 — packages/storage-provider/ sovereign package scaffolded.**
  - `package.json` + `tsconfig.json` + `vitest.config.ts` (matches existing network-adapter + cognitive-layer conventions).
  - `src/contract.ts` — `StorageProvider` interface + `ProviderCapabilities` + `CreateOnlyResult` + `PutIfMatchResult` + `StoragePathNotFoundError` + `StorageProviderError` + optional `StorageProviderWithTokenRead` interface augmentation for read-with-token.
  - `src/memory.ts` — `MemoryStorageProvider` (cas:true, durable:false, concurrent:false). Monotonic-counter tokens; defensive copies on get/put.
  - `src/local-fs.ts` — `LocalFsStorageProvider` (cas:true, durable:true, concurrent:false). SHA-256 content-hash tokens (sidecar-free, deterministic). CAS via O_EXCL on createOnly + atomic rename-swap on put/putIfMatch. Path-traversal defense (rejects `..`). Tmp files filtered from list output.
  - `src/gcs.ts` — `GcsStorageProvider` (cas:true, durable:true, concurrent:true). Wraps `@google-cloud/storage` SDK directly at blob level; uses `ifGenerationMatch` for CAS primitives. Post-write metadata fetch to surface new generation as the next token. Precondition-failure recovery fetches current generation for retry.
  - `src/index.ts` — barrel export.
  - `test/conformance.ts` — CSI-style 20-case suite covering capabilities, get/put, list (empty/prefixed/nested/after-delete), delete (present/absent), createOnly (first/conflict/clobber-by-put), putIfMatch (not-found/match/stale/chained), path handling (nested/traversal), sequential consistency. Factory pattern: fresh provider per test, no state leakage.
  - `test/memory.test.ts` + `test/local-fs.test.ts` — per-provider test runners invoking the shared conformance suite. GCS intentionally not in CI (needs real bucket + auth; validated out-of-band).
  - `README.md` — contract summary, provider comparison table, testing + usage snippets.
- ✅ **ADR-024 Sovereign StorageProvider.** `docs/decisions/024-sovereign-storage-provider.md` — context, 6-primitive contract, capability semantics, token opacity, repository-owns-ID-gen decision, conformance suite, migration pattern, success anti-criterion, 5 alternatives considered + rejected, follow-ups.
- ✅ **Verification (T1 local ship-green).** 40/40 conformance tests pass (2 providers × 20 cases). TypeScript strict-mode clean. No CI run yet (awaiting PR push).

## Edges (dependency chains)

- T1 → W1 → W2 → W3 → W4 → W5 → W6 → W7 → T3 → T4 → T5 (linear DAG per architect thread-291).
- T1 → architect post-T1 acceptance thread → W1 unblock (first checkpoint gate).
- W1 → architect post-W1 contract-validation thread → W2 unblock (second checkpoint gate).
- W6 → architect pre-W7 Agent go/no-go thread → W7 unblock + L-escalation decision (third checkpoint gate).
- T5 → architect mission-close thread + mission-status flip (fourth checkpoint gate).

## Session log (append-only)

- **2026-04-24 07:50Z (AEST late evening)** — Architect opened thread-290 with design-round prompt for idea-189. Engineer engaged with code audit (60 CAS sites across 8 entities confirmed load-bearing) + 8-question response + contract pushback (must-have: `createOnly` as first-class primitive).
- **2026-04-24 07:59Z** — Architect accepted all engineer refinements; staged `propose_mission` with revised brief. Engineer bilateral-sealed thread-290; mission-47 files as `proposed`.
- **2026-04-24 08:00Z** — Director approved release-gate via architect (thread-291).
- **2026-04-24 08:07Z** — Engineer acknowledged Option C hybrid coordination model; accepted 11-task DAG without refinements. Bilateral-sealed thread-291; execution underway.
- **2026-04-24 ~08:10-08:20Z** — T1 scaffolding: `packages/storage-provider/` created; `package.json`, `tsconfig.json`, `vitest.config.ts` match existing-package conventions.
- **2026-04-24 ~08:20-08:25Z** — T1 core: `contract.ts` authored (6 primitives, capability flags, token opacity, errors).
- **2026-04-24 ~08:25-08:30Z** — T1 memory provider: `MemoryStorageProvider` with monotonic-counter tokens.
- **2026-04-24 ~08:30-08:40Z** — T1 local-fs provider: CAS via O_EXCL + atomic rename; SHA-256 content-hash tokens; path-traversal defense.
- **2026-04-24 ~08:40-08:50Z** — T1 GCS provider: wraps `@google-cloud/storage` SDK directly; generation-as-token; precondition-failure recovery.
- **2026-04-24 ~08:50-09:00Z** — T1 conformance suite: 20 CSI-style cases; factory pattern; skippable concurrency section.
- **2026-04-24 ~09:00Z** — `npm install` + `npx tsc --noEmit` clean + `npx vitest run` green (40/40 tests across memory + local-fs).
- **2026-04-24 ~09:00-09:15Z** — ADR-024 authored (full ratification document; 5 alternatives considered).
- **2026-04-24 ~09:15Z** — README + work trace (this file).

## Canonical references

- **Mission entity:** `mission-47` (`get_mission` for live state).
- **ADR:** `docs/decisions/024-sovereign-storage-provider.md`.
- **Design round:** thread-290.
- **Release-gate:** thread-291.
- **Package root:** `packages/storage-provider/`.
- **Conformance test entry:** `packages/storage-provider/test/conformance.ts`.
- **Related:**
  - idea-189 (source idea).
  - idea-186 (npm workspaces; soft benefits-from).
  - bug-30 (adapter tarball / cross-package-imports; narrow-gate stopgap).
  - bug-29 (GCS list latency; adjacent, not coupling).
