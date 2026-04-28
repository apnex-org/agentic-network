# ADR-024 — Sovereign StorageProvider Contract

**Status:** Accepted — 2026-04-24. Ratified via mission-47 T1; landed via [PR TBD]. Authored during design round thread-290 (architect lily + engineer greg); released via thread-291 (Director approval).

**Context window:** mission-47 (M-Sovereign-Storage-Interface) — the first realization of the "sovereign package" pattern beyond `@apnex/network-adapter`. Parallels `@apnex/cognitive-layer` + `@apnex/network-adapter` as the third sovereign surface in the monorepo.

---

## 1. Context

As of mission-46, hub storage for the ~13 first-class entities (task, mission, idea, thread, proposal, turn, tele, audit, document, agent, bug, pending-action, director-notification) is implemented via two parallel class hierarchies:

- **In-memory**: `Memory*Store` classes in `hub/src/state.ts` + entity-specific files in `hub/src/entities/*.ts`.
- **GCS-backed**: `Gcs*Store` classes in `hub/src/gcs-state.ts` + entity-specific files in `hub/src/entities/gcs/*.ts`.

Each entity has two store implementations with duplicated business logic (serialization, ID generation, filtering). Switching backends (e.g., for a local-dev environment) requires coordinated changes across ~25 files per entity. CAS semantics are exposed via three gcs-specific helpers (`createOnly`, `updateExisting`, `upsert`) that live at the GCS layer; the memory backend reimplements them implicitly.

Director (2026-04-24) filed idea-189 to promote storage to a sovereign architectural surface — CSI-inspired pluggable provider interface, so entity repositories compose over the provider without backend-specific branches, and new backends (local-fs was the motivating case; SQLite / other cloud stores become possible follow-ons) can be added without touching entity code.

This ADR captures the design round between architect (lily) and engineer (greg) on thread-290, the contract v1.0 surface that emerged, and the mission-47 shape that ratifies it.

---

## 2. Decision

### 2.1 Sovereign package

A new package `@apnex/storage-provider` at `packages/storage-provider/`, sibling to `@apnex/network-adapter` and `@apnex/cognitive-layer`. Pattern-consistency with the existing sovereign surfaces.

### 2.2 Contract v1.0 — six primitives

```ts
interface ProviderCapabilities {
  readonly cas: boolean;         // createOnly + putIfMatch semantically correct
  readonly durable: boolean;     // put-completes-means-survivable
  readonly concurrent: boolean;  // safe under multiple writers
}

interface StorageProvider {
  readonly capabilities: ProviderCapabilities;
  get(path: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  put(path: string, data: Uint8Array): Promise<void>;
  createOnly(path: string, data: Uint8Array): Promise<CreateOnlyResult>;
  putIfMatch(path: string, data: Uint8Array, ifMatchToken: string): Promise<PutIfMatchResult>;
}

type CreateOnlyResult = { ok: true } | { ok: false };
type PutIfMatchResult =
  | { ok: true; newToken: string }
  | { ok: false; currentToken: string };
```

- `get / list / delete / put` are the unconditional primitives.
- `createOnly / putIfMatch` are the CAS family — capability-gated via `capabilities.cas`.
- **Tokens are opaque strings.** Callers compare equality only. Provider-internal representation (GCS generation / content-hash / monotonic counter) is not exposed.

### 2.3 Capabilities semantics

| Provider | cas | durable | concurrent | Use case |
|---|---|---|---|---|
| Memory | `true` | `false` | `false` | Tests, dev (single-process). State vanishes on process exit. |
| Local-fs | `true` | `true` | `false` | Local-dev hub against a GCS-mirror sync; single-writer. |
| GCS | `true` | `true` | `true` | Production backend. |

**`cas:false` is dev-only, not a supported deployment target.** The capability-gate stays in the type system to preserve design discipline + enable future single-file / ephemeral dev backends, but any provider backing a real hub must implement the CAS family. Enforced by contract: `createOnly` + `putIfMatch` are not optional; providers declaring `cas:false` would simply return `{ok:false}` from both, making them unusable for production paths.

### 2.4 Token opacity

Tokens from one provider are not portable to another — they are single-provider-lifetime handles. Implementations:

- **Memory**: monotonic counter stringified.
- **Local-fs**: SHA-256 content hash encoded as lowercase hex. Sidecar-free, deterministic.
- **GCS**: object generation number stringified.

### 2.5 Repository layer owns ID generation + retries

Per thread-290 convergence: the provider contract is storage-only. Counter management (e.g., `getAndIncrementCounter` on `meta/counter.json`) is a repository-layer concern, composed from `get` + `putIfMatch` + retry loop. Retry-with-backoff around CAS failures (currently in `updateExisting` in `gcs-state.ts`) moves to the repository layer, where the transform function lives.

This keeps the contract minimal + uniform across providers; storage-specific retry budgets don't leak into the type system.

### 2.6 Contract-conformance test suite

Shipped as `packages/storage-provider/test/conformance.ts` — a single CSI-style test suite exercised against every provider implementation. Ensures providers agree on observable behavior; divergence → one provider is wrong.

Suite runs against memory + local-fs on every CI push; GCS conformance is validated against a real bucket out-of-band (not in CI — too slow + requires real credentials).

### 2.7 Entity migration pattern (mission-47 T2)

Entity stores collapse from `{Memory*Store, Gcs*Store}` pairs into single `*Repository` classes that compose a `StorageProvider`:

```ts
class BugRepository {
  constructor(private readonly provider: StorageProvider) {}
  async get(id: string): Promise<Bug | null> {
    const raw = await this.provider.get(`bugs/${id}.json`);
    return raw ? JSON.parse(new TextDecoder().decode(raw)) as Bug : null;
  }
  async save(bug: Bug): Promise<void> {
    const encoded = new TextEncoder().encode(JSON.stringify(bug));
    await this.provider.put(`bugs/${bug.id}.json`, encoded);
  }
  // ... etc
}
```

The hub wires `new BugRepository(provider)` at startup based on `STORAGE_BACKEND=memory | local-fs | gcs`.

Migration is sequenced by concurrency risk: tele (lowest) first as contract-validation ground; turn/pending-action/agent (highest) last as contract stress-test. Agent is a pre-authorized L-escalation carve-out per thread-290.

### 2.8 Success anti-criterion

If any entity repository has `if (provider instanceof GcsStorageProvider)` or calls a non-contract method on the provider, the abstraction has leaked and we have failed the sovereign property.

---

## 3. Consequences

### 3.1 Positive

- **Second empirical proof of the sovereign-package pattern** (after network-adapter). Tele-3 Sovereign Composition promoted from one-off to repeatable architectural play.
- **Testing simplifies.** Entity-logic tests compose one `MemoryStorageProvider` instead of per-entity `Memory*Store` instances. Per-backend duplication collapses.
- **Local-dev parity with prod** via `STORAGE_BACKEND=local-fs` + `gsutil rsync` sync. Developers can run a hub against a frozen snapshot of production state without touching GCS.
- **Future backends become additive.** A SQLite provider, a test-only journaling provider, etc., can be added without touching entity code.
- **CAS semantics are explicit + uniform.** The capability-gate encodes a property that was previously implicit in the choice of `Memory*Store` vs `Gcs*Store`.

### 3.2 Negative

- **7-wave entity migration is non-trivial.** ~60 CAS sites spread across 8 entities; migration is the bulk of mission-47.
- **GCS prod behavior must stay byte-identical.** Structural refactor with behavioral-regression risk. Mitigated by the contract-conformance suite + per-wave ship-green discipline.
- **Repository retry-loop lifts responsibility out of the storage layer.** If repositories forget to wrap CAS in retry-on-conflict, correctness regresses relative to today's `updateExisting` helper. Discipline + code-review concern; addressable via a repository-layer helper if the pattern proves error-prone.
- **Third sovereign package in the monorepo.** Until idea-186 (npm workspaces) lands, the tarball-dependency architecture (see bug-30) adds one more package to maintain under the current tooling.

### 3.3 Neutral

- **Agent/EngineerRegistry may push to L-escalation.** Pre-authorized per thread-290; honest scope rather than forced M. Carve Agent out as a sibling mission if the contract resists; mission-47 ships with W7 Turn + PendingAction only.
- **Counter helper placement.** Repositories implement ID generation as a helper composed over the contract. Chosen deliberately over adding a `counterIncrement` primitive to the provider interface — keeps the contract storage-only at the cost of ~15 lines of helper code reused across repositories.

---

## 4. Alternatives considered

### 4.1 Keep the two-store pattern; add a shared interface

Rejected. Would preserve the duplication between `Memory*Store` and `Gcs*Store` classes and not address the backend-specific-branching problem. The interface-only refactor delivers none of the "add a new backend without touching entity code" value.

### 4.2 Expose GCS-generation type-directly

Rejected. Typed generation (number) is forward-incompatible with non-GCS backends (etcd revisions, SQLite rowversions, content-hashes). Opaque-string token is the portable choice.

### 4.3 Include `watch` / subscription primitive

Rejected for v1.0. No entity today uses change-notification; SSE notifications are a hub-layer concern, not a storage concern. Add if a repository genuinely needs it later; gate behind a fourth capability flag.

### 4.4 Include `transaction(operations[])` multi-blob atomicity

Rejected for v1.0. No entity today needs cross-blob transactional semantics — all CAS cases are per-blob FSM transitions (confirmed via the thread-290 audit of ~60 sites). If a future entity genuinely needs it, gate behind a fifth capability flag and add a provider method; most providers (memory, local-fs, GCS) do not support multi-blob atomicity natively.

### 4.5 Typed entity-specific providers (BugProvider, TaskProvider, ...)

Rejected. Breaks the sovereign property — each entity would pull its own provider implementation with per-entity methods. The CSI insight is that one uniform provider surface serves all repositories; diverging at the provider layer defeats the purpose.

---

## 5. Follow-ups

- **Mission-47 T2 (7 waves)** — migrate each entity to `*Repository(provider)` pattern. Ship-green discipline per wave; legacy `Memory*Store` + `Gcs*Store` classes deleted as each wave lands.
- **Mission-47 T3** — extend `scripts/state-backup.sh` to emit `gsutil rsync` output without tar. Wire `STORAGE_BACKEND=local-fs` branch in `hub/src/index.ts`.
- **Mission-47 T4** — comparative latency measurement (GCS vs local-fs) for a representative tool-call workload. Uses existing `CognitiveTelemetry` sink + `[EXEC]` router logs; no new instrumentation.
- **Mission-47 T5** — closing audit + hygiene; ADR-024 ratification confirmed; mission-status flip.

**Related entities:**
- **idea-189** — source idea for this mission.
- **idea-186** — npm workspaces migration (soft benefits-from; not blocking).
- **bug-30** — adapter tarball / cross-package imports (narrow-gate CI stopgap from mission-43/46).
- **bug-29** — GCS list latency. Moving list-ops through the provider contract surfaces the slowness more visibly; may accelerate the fix opportunistically but not a requirement.

**Ratification provenance:**
- idea-189 filed 2026-04-24 (Director-sourced).
- Design round thread-290 (architect lily + engineer greg) converged 2026-04-24.
- Mission-47 released by Director via thread-291 (2026-04-24).
- This ADR committed under mission-47 T1.

---

## 6. Amendments

### 6.1 Amendment 2026-04-25 — local-fs profile reclassification (mission-48 T1)

**Source:** thread-303 design round (mission-48 M-Local-FS-Cutover); engineer Flag #1b (`hub/src/index.ts:106-109` hard-refused `STORAGE_BACKEND=local-fs` under `NODE_ENV=production`); Director ratification 2026-04-25.

**Reclassification.** The `local-fs` `StorageProvider` profile, originally captured under §2.3 as **dev-only** (`cas:true, durable:true, concurrent:false`), is now also valid as a **single-writer-laptop-prod** profile.

**Rationale.** The `concurrent:false` capability flag (single-writer requirement) is operationally enforceable via deployment discipline rather than a runtime gate:

- `scripts/local/start-hub.sh:148-161` enforces one `ois-hub-local-*` container at a time per host. Switching envs is stop-prior-start-new.
- Bind-mounted state directory (host path `${REPO_ROOT}/local-state/` by default) means there is structurally only one writer per host.
- The laptop-Hub deployment pattern (mission-46 onward) has always been single-Director-single-machine; concurrent-writer scenarios do not arise.

The `concurrent:false` flag therefore remains accurate; what changes is the *deployment context* in which `local-fs` is acceptable — extended from purely-dev to also include single-writer-laptop-prod.

**Code change.** `hub/src/index.ts:106-109` previously fatal-exited (`process.exit(1)`) when `STORAGE_BACKEND=local-fs && NODE_ENV=production`. Mission-48 T1 relaxes to **warn-and-allow** — the warning still surfaces the single-writer constraint at startup, but the Hub now boots. Operators who run multiple hubs against the same `OIS_LOCAL_FS_ROOT` are responsible for the corruption that ensues; the warning + the start-hub.sh enforcement together make this hard to do accidentally.

**Multi-writer guard left intact for non-laptop targets.** Cloud Run / multi-instance deployments must continue to use `STORAGE_BACKEND=gcs`. There is no architectural endorsement of `local-fs` for any multi-writer profile; the `concurrent:false` flag still rules that out by contract. This amendment is scoped narrowly to single-writer-laptop-prod and does not widen `local-fs` semantics elsewhere.

**Related:** see `docs/traces/m-local-fs-cutover-work-trace.md` for in-flight execution tracking; `deploy/README.md` §Hub GCS state layout for state-file conventions across both backends.
