# WebhookSource design

Mission-52 T4. Doc-only design for the `WebhookSource` implementation that future-mission consumes (post-MVP; cloud-Hub mode). Captures the design space without runtime risk per thread-312 round-2 scope reduction (engineer audit pushback accepted: stubs rot if unexercised; non-functional skeleton accumulates drift relative to the EventSource contract; signals false readiness).

T1's `EventSource` interface declaration (PR #52 / `906f6bf`) IS the proof of source-pluggability — no second runtime implementation needed at the contract layer. T4 captures what a real `WebhookSource` looks like so the future mission lands without rediscovering the design space.

## Purpose

`WebhookSource` matters when:

- **Cloud-Hub mode is provisioned.** Webhooks require a publicly reachable HTTPS endpoint; laptop-Hub (the current mission-48 deployment target) doesn't qualify. Cloud Run-hosted Hub provides the reachable endpoint.
- **Realtime latency is the operability target.** PollSource (T2) is `latency: periodic` (30s default cadence; tunable). WebhookSource is `latency: realtime` — events land sub-second from upstream.
- **Push-not-pull semantics align with operator volume.** A high-frequency repo would either burn rate-limit headroom on PollSource cadence floor or accept stale-cursor risk; WebhookSource side-steps both.

`WebhookSource` is NOT a replacement for `PollSource` — they coexist. Local-Hub developers stay on `PollSource` (no public endpoint required). Cloud-Hub deployments can choose either source per environment + per repo via the Hub-side env-var registration (extension of mission-52 T3's `OIS_REPO_EVENT_BRIDGE_REPOS` config surface).

## EventSource contract compliance

`WebhookSource` implements the same `EventSource` interface as `PollSource`. The capability flags differ:

| Field | `PollSource` | `WebhookSource` |
|---|---|---|
| `transport` | `'poll'` | `'webhook'` |
| `latency` | `'periodic'` | `'realtime'` |
| `mode` | `'pull'` | `'push'` |
| `dedupe` | `true` | `true` |
| `persistedCursor` | `true` | `true` |

Same async-iterator semantics. Same `start()` / `stop()` / `health()` surface. Same `RepoEvent` envelope shape. The translator (`translateGhEvent`, mission-52 T1) and sink (`CreateMessageSink`, mission-52 T1+T3) are reused unchanged — `WebhookSource` produces the same envelope shape on the same iterator surface, so downstream code (drainer + Hub `create_message` invoker + MessageRepository) is untouched.

This is the load-bearing invariant. The translator is a pure function; both sources feed it the same GH event-shape JSON; the resulting `RepoEvent` stream is indistinguishable.

## Architecture sketch

### HTTP webhook receiver

Wired into Hub's existing express surface. Single route:

```
POST /webhooks/repo-events
```

Handled by a new request handler that delegates to `WebhookSource`'s incoming-event channel. Path is fixed (no per-repo route — GH delivery shape carries the repo identity in the payload, so route fan-out happens after signature verification + parsing, not at route-match).

Hub configuration adds:

```
OIS_REPO_EVENT_BRIDGE_WEBHOOK_SECRET=<shared-secret-with-GH>
```

Per-repo secrets land later if the use case demands it (registration table; T3-style env-var config probably can't carry a secret-per-repo cleanly).

### Per-repo webhook secret validation

Per GH webhook security: HMAC SHA-256 of the raw request body, with the shared secret as key. GH sends `X-Hub-Signature-256: sha256=<hex>`. The receiver computes the HMAC over the raw body bytes (not the parsed JSON — bytes), constant-time-compares against the header, rejects with 401 on mismatch.

```
const sig = req.headers['x-hub-signature-256'] || '';
const expected = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(rawBody)
  .digest('hex');
if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
  return res.status(401).end();
}
```

Constant-time comparison is non-negotiable — timing oracle on signature validation is a known attack surface.

### Event de-duplication

GH stamps every webhook delivery with `X-GitHub-Delivery: <UUID>`. The same UUID is sent on retries (5xx responses trigger GH-side retry up to 8 times with exponential backoff). `WebhookSource` reuses the same bounded LRU dedupe pattern as `PollSource` (mission-52 T2 `CursorStore.markSeen` / `filterUnseen`):

- Per-source dedupe set (not per-repo — webhook deliveries are global at the source level)
- Storage path: `repo-event-bridge/dedupe/webhook-deliveries.json`
- Capacity: 1000 delivery IDs (same default as PollSource)
- Touch-on-access LRU; eldest evicted on overrun

Cursor concept doesn't directly apply (webhook is push, no pagination), so the cursor surface from `CursorStore` stays unused for this source. The dedupe surface is reused as-is.

### State machine

```
receiving → translating → sinking → ack
```

- `receiving`: HTTP request received; signature verified; raw body parsed as JSON.
- `translating`: parsed body wrapped into the GH events-API shape (`{type: <X-GitHub-Event header>, payload: <body>}`) and fed through `translateGhEvent`. Note: webhook delivery shape places `repository` directly under the body, while the events-API shape places it under `payload.repository`. The translator's existing `extractRepo` helper already handles both — no translator changes required.
- `sinking`: emit through the same `CreateMessageSink`-backed drainer that PollSource uses. Sink is shared infrastructure.
- `ack`: respond to GitHub with 200. Triggers GH delivery success state; no retry.

### Failure modes

| Condition | HTTP response | GH retry behavior |
|---|---|---|
| Invalid HMAC signature | 401 | No retry (4xx terminal) |
| Body unparsable | 400 | No retry |
| Translator returns `subkind: unknown` | 200 | Success — Hub logs the unknown event type for later taxonomy expansion (same path as PollSource) |
| Sink failure (e.g., `create_message` returned `isError`) | 500 | GH retries with exp-backoff up to 8 times — caller-side idempotency (the dedupe LRU + Hub message-side idempotency) makes retries safe |
| Receiver overload (queue full; not yet specified) | 503 | GH retries — per backpressure design below |

Critical: NEVER 500 on payload-not-translatable. Translator's `unknown` fallback exists precisely so unfamiliar event types don't trigger retry storms — log + 200 + treat as a forward-compat signal.

## Auth model

`WebhookSource` uses **GitHub Apps**, NOT PATs. The contract divergence from `PollSource`:

| Aspect | `PollSource` (PAT) | `WebhookSource` (App) |
|---|---|---|
| Identity | Single user's PAT | Per-installation App credentials |
| Scope grant | User-grants `repo`, `read:org`, `read:user` | Org/owner-grants per-repository or org-wide install |
| Rotation | Operator rotates token | Installer regenerates webhook secret + JWT signing key |
| Audit | All actions attributed to PAT-owner user | Actions attributed to `github-actions[bot]`-style App identity |
| Multi-tenancy | One PAT per Hub deployment (or accept all-org access) | One App; per-installation per-org/repo |

App provisioning is operational, not architectural — see operational concerns below for the runbook outline. The architectural commitment T4 captures: **`WebhookSource` is App-centric, never PAT-centric.** Mixing the two on a single source destroys the audit story.

## Operational concerns

### Webhook URL provisioning

```
https://<cloudrun-hub-url>/webhooks/repo-events
```

Cloud Run service URL is operator-known per env (already managed via `deploy/cloudrun/env/<env>.tfvars`). Per-env rollout: provision the GitHub App with the env-specific webhook URL.

### Webhook secret rotation

Three-step rotation (zero-downtime):
1. Operator generates new secret in GH App settings
2. Operator updates `OIS_REPO_EVENT_BRIDGE_WEBHOOK_SECRET` in cloudrun env + redeploys Hub. Hub now validates against the new secret.
3. Operator confirms GH deliveries succeed; revokes old secret.

For the brief overlap window where in-flight retries may still carry signatures from the old secret: accept-both during rotation via comma-separated `OIS_REPO_EVENT_BRIDGE_WEBHOOK_SECRETS` (plural) — receiver iterates, accepts on any match. Defer this enhancement to the implementing mission unless rotation pain emerges first.

### Backpressure on burst

GH bursts deliveries during heavy activity (e.g., a force-push touching 200 commits triggers ~200 `commit-pushed` events in seconds). Receiver design must absorb burst without dropping events:

- Drainer-side queue is bounded (in-memory; size tunable via env var). When full, receiver returns 503 → GH retries with exp-backoff. Backpressure propagates upstream cleanly.
- Sink throughput is the load-bearing rate limit. If `create_message` MCP verb can sustain N/s and burst exceeds, queue fills, 503-then-retry kicks in.
- Alternative (post-MVP): persistent receiver queue (StorageProvider-backed). Decouples receiver lifetime from sink throughput. Premature for v1.

### Replay / failure recovery

GH auto-retries on 5xx (up to 8 attempts; exp-backoff). Design must be idempotent end-to-end:

- Dedupe LRU rejects re-delivery of same `X-GitHub-Delivery` UUID (catches mid-retry duplicates).
- Sink `create_message` is non-idempotent at the Hub Message-store level (every call creates a new Message). The CreateMessageSink stub from T1 doesn't add dedupe; the Hub's downstream consumers should expect duplicates if the receiver acks late + GH retries land before the dedupe LRU update.
- Practical mitigation: only ACK (200) to GH AFTER the sink commit succeeds. The drainer is awaited before response is sent. This is the inverse of PollSource's "fire-and-forget into the iterator" pattern; webhook receivers must synchronously confirm sink success before responding.

## Mode-parity invariant

Given the same fixture (canonical GH event payloads), `PollSource` and `WebhookSource` MUST produce identical `RepoEvent` streams + identical Hub Message effects.

Test surface (when `WebhookSource` ships):
- Replay `packages/repo-event-bridge/test/conformance/gh-events.fixture.json` through both sources
- Assert per-event subkind correctness (translator-level invariant — already proven in T1 conformance suite)
- Assert per-event Hub Message kind/target/payload shape (sink-level invariant — already proven in T3's end-to-end test)
- Assert same fixture replayed through both produces identical Message-store post-condition

The translator + sink are shared code, so the parity invariant is structurally guaranteed at construction time. The conformance test is a regression detector, not a discovery mechanism.

T1's fixture was authored to be source-agnostic; T2's PollSource conformance suite already replays it; T4's design preserves the invariant — when WebhookSource lands, its conformance suite extends T2's pattern unchanged.

## Cross-references

- **PollSource (T2 / PR #53 / `2fc554d`)** — sibling EventSource implementation. Differs in transport (poll vs. webhook), latency (periodic vs. realtime), mode (pull vs. push). Same translator + sink. This doc's design re-uses the dedupe + state-machine + failure-isolation patterns; only the front-end (HTTP receiver vs. GH API client) differs.
- **mission-52 W1 EventSource contract (PR #52 / `906f6bf`)** — universal interface that both sources implement. The capability flag matrix above describes both implementations against this contract.
- **mission-52 T3 Hub integration (PR #54 / `614211a`)** — Hub-side composition pattern (RepoEventBridge class + drainer + in-process invoker via PolicyRouter). WebhookSource integration follows the same pattern: a single `RepoEventBridge` wraps either source; downstream is unchanged.
- **GitHub Webhooks documentation** — https://docs.github.com/en/webhooks/webhook-events-and-payloads
- **GitHub Apps documentation** — https://docs.github.com/en/apps/creating-github-apps
- **idea-191** — source idea ratifying repo-event ingestion as a sovereign capability.
- **Future-mission seed: M-Cloud-Hub-Webhook-Source** — activates when cloud-Hub mode is provisioned. T4 (this doc) is the design input; the implementing mission ships HTTP receiver + GH App provisioning runbook + extending the conformance suite.

## Out of scope (deferred to future mission)

- **Runtime implementation.** No HTTP receiver, no signature-validation code, no integration with Hub's existing express surface. T4 is design; implementation follows when cloud-Hub mode lands.
- **GitHub App provisioning runbook.** Operational, not architectural. Lives in `deploy/README.md` (or a dedicated runbook) once the implementing mission is active.
- **Subkind taxonomy expansion.** v1 taxonomy from T1 (8 subkinds) is the floor. Expansion lands in the implementing mission only if a new event type warrants — `unknown` fallback handles novel types until then.
- **Mode-parity conformance test.** Gates on real `WebhookSource` existing. Captured as an invariant in the design; un-test-enforced until the implementing mission ships.
- **Per-repo webhook secret support.** v1 uses a single shared secret across all repos delivering to this Hub. Per-repo secrets land later if the security model demands.
- **Persistent receiver queue.** v1 uses in-memory drainer queue with 503-backpressure on overrun. Persistent queue (StorageProvider-backed) is post-MVP enhancement.
