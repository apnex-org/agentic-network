# @ois/repo-event-bridge

Sovereign repo-event bridge — pluggable `EventSource` contract + GH-event translator + `create_message` sink for the OIS agentic network.

Sovereign-package #5, sibling to `@ois/network-adapter`, `@ois/cognitive-layer`, `@ois/storage-provider` (and the in-Hub sovereign `@ois/message-primitive`). Mission-52 deliverable; design ratified at thread-312 round 2 (2026-04-25).

## Surface (T1 contract)

Three pure surfaces. Implementations and runtime wiring are layered on top in subsequent tasks (T2 PollSource, T3 Hub integration, T4 WebhookSource design).

### EventSource — async-iterator pluggability

```ts
interface EventSource {
  readonly capabilities: EventSourceCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): EventSourceHealth;
  [Symbol.asyncIterator](): AsyncIterator<RepoEvent>;
}
```

| Field | Meaning |
|---|---|
| `capabilities.transport` | `'webhook'` (HTTP receiver) or `'poll'` (upstream-API poller) |
| `capabilities.latency` | `'realtime'` or `'periodic'` |
| `capabilities.mode` | `'push'` (upstream initiates) or `'pull'` (source initiates) |
| `capabilities.dedupe` | Consumer is guaranteed at-most-once per upstream event |
| `capabilities.persistedCursor` | Cursor survives process restart |

Production-grade sources MUST advertise `dedupe: true` and `persistedCursor: true`. Dev/in-memory sources may opt out of `persistedCursor`.

`health()` returns a sync snapshot for operator self-service:

```ts
interface EventSourceHealth {
  paused: boolean;
  pausedReason?: 'rate-limit' | 'network' | 'auth-failure';
  lastSuccessfulPoll: string;  // ISO-8601
}
```

### Translator — GH event-shape → message-shape

Pure, total, transport-agnostic. Never throws; unrecognized inputs degrade to `subkind: "unknown"` with the raw payload preserved.

```ts
const event: RepoEvent = translateGhEvent(ghEvent);
// → { kind: 'repo-event', subkind: <RepoEventSubkind>, payload: <normalized> }
```

#### v1 subkind taxonomy

| Subkind | When emitted |
|---|---|
| `pr-opened` | `pull_request` event, `action='opened'` |
| `pr-closed` | `pull_request` event, `action='closed'`, `merged=false` |
| `pr-merged` | `pull_request` event, `action='closed'`, `merged=true` |
| `pr-review-submitted` | `pull_request_review` event, `action='submitted'`, residual review states (`changes_requested`, etc.) |
| `pr-review-approved` | `pull_request_review` event, `action='submitted'`, `state='approved'` |
| `pr-review-comment` | `pull_request_review_comment` event OR review with `state='commented'` |
| `commit-pushed` | `push` event |
| `unknown` | Unrecognized event type or malformed shape (graceful-degrade fallback) |

`kind` stays fixed at `"repo-event"` so sink-side dispatch can route on `kind`; per-type semantics live in `subkind`. `unknown` is the load-bearing fallback that keeps the surface forward-compatible — a new GH event type doesn't break ingestion, it lands as `unknown` until the translator is extended (Hub can log + alert on rising unknown-rate).

v1 payload normalization is deliberately minimal — enough to drive Hub-side dispatch (T3) without locking schemas downstream. Translator-schema-evolution is a tracked future-mission seed (mission-52 T5 closing audit).

### MessageSink — create_message delivery

```ts
interface MessageSink {
  emit(event: RepoEvent): Promise<void>;
}
```

T1 ships a `CreateMessageSink` stub that maps `RepoEvent` → mission-51 W6's `create_message` MCP verb. The full `RepoEvent` envelope (`{kind, subkind, payload}`) nests under the Hub Message's `payload` field — Hub-side dispatch reads `payload.kind === "repo-event"` to route, then `payload.subkind` for per-type semantics.

```ts
const sink = new CreateMessageSink({
  invoke: async (args) => callHubMcp("create_message", args),
  // Optional overrides:
  messageKind: "external-injection",  // default
  target: null,                        // null = broadcast (default)
  intent: "repo-event-replay",
});
await sink.emit(event);
```

T3 wires the concrete `invoke` callable (in-process / MCP-stdio / MCP-HTTP). T1 leaves the choice abstract — the contract stands without binding to a transport.

## Building

```bash
npm run build    # compiles src/ → dist/
```

**TODO(idea-186):** This package commits its built `dist/` to git as a workaround for the cross-package `file:` ref limitation in non-workspaces monorepos. Hub depends on `@ois/repo-event-bridge` via `file:../packages/repo-event-bridge`; CI runs `npm install` (not `npm ci`) per the mission-50 T5 + T3-revision-v3 fix, but a `prepare: tsc` hook on this package fails because cross-package file: refs are install-order-dependent (tsc runs before `@ois/storage-provider` is reachable in the package's local `node_modules`). Committed `dist/` is the lesser evil. **Sunset when idea-186 (npm workspaces migration) lands** — workspaces resolve internal package refs natively, dist/ becomes regenerable per environment, and the `dist/` exception in root `.gitignore` + this section can be removed.

When making source changes:

```bash
npm run build && git add dist/    # commit the regenerated dist/ alongside src/
```

The same precedent applies to `@ois/storage-provider` — see root `.gitignore` for the parallel exception.

## Testing

```bash
npm test
```

| Suite | Coverage |
|---|---|
| `test/translator.test.ts` | Per-subkind dispatch + unknown-fallback graceful degrade + payload-shape unit tests |
| `test/conformance/` | Fixture replay (canonical GH events × every v1 subkind) + end-to-end `CreateMessageSink` capture |

The conformance fixture (`test/conformance/gh-events.fixture.json`) is the canonical corpus — T2's PollSource-conformance suite replays the same fixture through source → translator → sink for end-to-end coverage.

## Mission-52 task ladder

| Task | Scope | Status |
|---|---|---|
| T1 | This contract — `EventSource` interface + translator + sink stub + conformance fixture | This package |
| T2 | `PollSource` impl — PAT auth, cadence, cursor + dedupe via StorageProvider, Retry-After-honoring 429 path | Future |
| T3 | Hub integration — in-Hub component loading, `start-hub.sh` env-var wiring, per-PR/per-review/per-merge handling | Future |
| T4 | `WebhookSource` design doc (no runtime stub — T1 contract IS the proof of source-pluggability) | [docs/webhook-source-design.md](./docs/webhook-source-design.md) |
| T5 | Closing audit — sovereign-package #5 empirical proof; future-mission seeds (PII / multi-tenancy / adaptive-cadence / translator-schema-evolution) | Future |

## Provenance

- thread-312 design round (2026-04-25, 2 rounds; engineer audit produced 1 scope reduction + 4 refinements + 4 design-space captures; architect ratified all + 2 minor refinements)
- Mission-52 cascade-fired from thread-312 round-3 convergence
- Director-approved activation 2026-04-25 ~21:20Z post-preflight GREEN
