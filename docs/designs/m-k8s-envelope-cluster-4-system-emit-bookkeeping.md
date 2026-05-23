# M-K8s-Envelope — Cluster 4 System-Emit/Bookkeeping Partition (Design Working Draft)

**Status:** v0.2 — engineer review-integrated · Director-ratified scope reduction · awaiting approval
**Mission:** idea-126 (M-K8s-Envelope)
**Phase:** Phase 4 Design — cluster-4 partition pass (4 of 5 clusters per substrate-grounded decomposition)
**Coordination:** per-PR review (per refined `feedback_pr_opened_notification_is_review_signal` memory rule v2). v0.1 review via `pr_opened_bilateral`; **this v0.2 push includes explicit `create_message` ping to greg** per refined memory rule (post-push surfacing pending idea-315 substrate-build).
**Date:** 2026-05-23 AEST (v0.2: engineer PR #271 v0.1 review integrated + Director-ratified scope reduction)
**Sibling Designs:**
- Cluster 1 — substantive-content (Idea / Bug / Thread / Mission / Proposal) — **MERGED** at `d8ea695`
- Cluster 2 — queue/FSM-active (Task / PendingAction / Turn) — **MERGED** at `59c3a70`
- Cluster 3 — metadata/config/projection (Agent / Tele / SchemaDef / Counter) — **MERGED** at `ddf7bb1`
- Cluster 5 — content-archive (forthcoming; Document / ArchitectDecision / 3 HistoryEntry kinds)

**v0.1 → v0.2 changelog (engineer PR #271 review + Director-ratified scope reduction):**

**LOAD-BEARING — Notification dropped from cluster-4 scope** (engineer code-trace contradicted v0.1 framing; Director-ratified disposition (i)):
- §2.3 Notification (v0.1) — **REMOVED**. Engineer code-trace showed mission-56 W5 IS fully complete: notifications ARE first-class Message entities with `kind: "external-injection"`; no INotificationStore-gap to close; `entity-kinds.json:149` was STALE
- Cluster-4 scope reduces 5 kinds → 4 kinds (Message + Audit + RepoEventBridgeCursor + RepoEventBridgeDedupe)
- Substrate inventory re-locks 22 kinds → 21 kinds; `hub/scripts/entity-kinds.json` updated to v1.2 with Notification moved from `kinds[]` to `kinds-explicitly-not-included`
- mission-83 OQ8 framing was based on stale evidence; will re-file as separate Idea post-cluster-4 with corrected framing (semantic-separation question, not mediation-gap closure)
- §3.3 mission-56 composition checkpoint reframed

**Substantive cluster-currency catch:** substrate-currency discipline (engineer code-trace > architect spec-recall) applied at cluster-4 mirror cluster-1 Round 7 precedent. v2.1 methodology candidate **R** captured.

**Engineer dispositions integrated (OQ1-8 + OQ13-15):**
- §1.7 NEW sub-discipline — Field-name collision with envelope `kind`: rename current top-level discriminator to `metadata.<kind>Specific`. Demonstrated Message.messageKind. (Engineer cross-cutting observation #1)
- §2.1 Message — OQ1-OQ5 applied (rename + opaque payload + intent/converged split + escalation in spec + idea-200 W2 target confirmed)
- §2.2 Audit — OQ6-OQ8 applied (constant 1-state status.phase; relatedEntity in spec; name OMITTED)
- §2.3 RepoEventBridgeCursor (renumbered from §2.4) — OQ13-OQ15 applied (status.cursor; opaque encoded; name OMITTED)
- §2.4 RepoEventBridgeDedupe (renumbered from §2.5) — sibling dispositions same as §2.3

**Survey input:** `docs/reviews/2026-05-23-survey-idea-126.md` (Director-ratified R1 A/A/A + R2 A/A/A). Same Survey applies to all clusters.

**Cluster-1 + 2 + 3 patterns inherited:**
- Strict K8s `metadata`/`spec`/`status` partition; no top-level fields beyond `{id, name, kind, apiVersion, metadata, spec, status}`
- `metadata.labels` for content-classification; `spec.labels` for declared-routing-intent (§5 cluster-3 6th cumulative-pattern axis)
- `metadata.annotations["ois.io/..."]` for free-form vendor extension
- `metadata.name` USED for handle-classified kinds; OMITTED for content-classified
- `<Kind>.status` (flat FSM) → `<Kind>.status.phase` (primary FSM per cluster-3 §1.6 multi-FSM rule)
- Additional FSMs use semantically-named status fields (multi-FSM-in-status per cluster-3 §1.6)
- `FilterableField.path` per-kind; nested-path via dot-notation; map-type via `selector: "k8s-map"`
- Virtual-view fields ENVELOPE-EXCLUDED
- Derived-scalar fields declared via SchemaDef `"derived": true` flag (cluster-2 pattern)
- `apiVersion: "core.ois/v1"` (minimal 2-group taxonomy)
- Substrate strict K8s; LLM-ergonomic flat projection deferred to idea-121

---

## §1 Cluster-4 design scope — system-emit/bookkeeping kinds

| Kind | Mediation | Notes |
|---|---|---|
| Message | IMessageStore | **canonical worked example**; sovereign Message store (mission-51 W1 + mission-56 W3.2 extensions); ULID id; multi-membership (thread + inbox + outbox); multi-FSM (status + scheduledState) |
| Audit | IAuditStore | append-only structured log; createOnly-write pattern; id `audit-N`; no FSM (immutable post-create) |
| RepoEventBridgeCursor | RepoEventBridgeSubstrateAdapter (bookkeeping-only) | NEW per mission-84 W3; per-`<owner>__<repo>` id-keyed; opaque cursor-store-encoded body; `watchable: false` |
| RepoEventBridgeDedupe | RepoEventBridgeSubstrateAdapter (bookkeeping-only) | NEW per mission-84 W3; per-`<owner>__<repo>` id-keyed; opaque dedupe-LRU body; sibling of Cursor; `watchable: false` |

**Notification (v0.1) — DROPPED at v0.2 per Director-ratified disposition (i):** engineer code-trace (`grep -nE "writeFile|writeFileSync|notifications/" hub/src/hub-networking.ts` = 0 matches; `notification-helpers.ts:112` `emitLegacyNotification()` body = `messageStore.createMessage({kind: "external-injection", ...})`) contradicted v0.1 framing. mission-56 W5 IS fully complete; notifications ARE first-class Message entities. `entity-kinds.json:149` STALE. mission-83 OQ8 will re-file as separate Idea post-cluster-4 with corrected framing.

**Shared property:** these kinds are **Hub-side write paths** — not user/agent-authored cognitive content. Partition pattern is **status-skewed** for active kinds (Message) and **spec-with-empty-status** for createOnly kinds (Audit). Bookkeeping kinds (RepoEventBridge*) carry opaque bodies in status.

**Methodology note (cluster-4-specific):** unlike cluster-1 (default-to-spec on substantive content), cluster-2 (default-to-status on FSM-mutated), cluster-3 (per-kind heterogeneous), cluster-4 is mostly **Hub-emit-time-determined** — fields are populated by the Hub at write time + may mutate via Hub-side FSM transitions. Default partition: identity → metadata; declared dispatch-config → spec; FSM phase + Hub-derived observed fields → status.

---

## §1.7 K8s-convention sub-discipline — field-name collision with envelope `kind`

**Surfaced at v0.2 (engineer cross-cutting observation #1 + OQ1 disposition).** Cluster-4 Message has a current top-level discriminator field `Message.kind` (`reply | note | external-injection | amendment | urgency-flag`) that collides with envelope `kind: "Message"`.

**Methodology rule:** when a current kind has a top-level field that collides with envelope `kind`, rename the discriminator to `metadata.<kindName>Specific` (or similar disambiguating path). The current field name was chosen pre-envelope; envelope `kind` slot is reserved for entity-kind discrimination across the substrate.

**Demonstrated:** `Message.kind` → `Message.metadata.messageKind` at cluster-4 cutover.

**Forward signal for cluster-5:** if any cluster-5 kind surfaces a similar collision, follow Message's rename pattern. None expected at v0.1 scan (Document / ArchitectDecision / *HistoryEntry kinds don't appear to use `kind` as a top-level field).

This sub-discipline composes with §1.5 (handle vs content) and §1.6 (multi-FSM) as the three K8s-convention refinements articulated across clusters 2-4.

---

## §2 Per-kind partitions

### §2.1 Message — canonical reference

**Existing flat shape** (per `hub/src/entities/message.ts:170-278`):

Identity + multi-membership:
- `id` (ULID, fresh per message; monotonic per repository instance)
- `kind` (MessageKind: `reply | note | external-injection | amendment | urgency-flag`)
- `authorRole` (MessageAuthorRole: `architect | engineer | director | system`)
- `authorAgentId`
- `target` (`{role?, agentId?} | null` — null = broadcast)
- `threadId?` (multi-membership: belongs to thread inbox/outbox)
- `sequenceInThread?` (monotonic per-thread; atomic CAS allocation)

Dispatch config:
- `delivery` (MessageDelivery: `push-immediate | queued | scheduled`)
- `payload: unknown` (opaque per-kind payload)
- `escalation?` (timeoutMs + targetRole; mission-56 W3 trigger surface)

Scheduled-message fields (mission-51 W4; orthogonal):
- `fireAt?` (ISO-8601 firing time)
- `precondition?` (predicate registry shape — `{fn, args}`; opaque)
- `scheduledState?` (`pending | delivered | precondition-failed` — secondary FSM)
- `retryCount?` (failed-trigger retry interlock)
- `maxRetries?` (default 3)

FSM (mission-56 W3.2):
- `status` (`new → received → acked`; linear monotonic; atomic CAS via putIfMatch)
- `claimedBy?` (agent that won the `claimMessage` race; set on new → received)

Turn metadata (lifted from inline thread.messages[]):
- `intent?`, `semanticIntent?`, `converged?`

Migration:
- `migrationSourceId?` (`<source-namespace>:<source-id>`; idempotent re-projection)

Lifecycle:
- `createdAt`, `updatedAt`

**Partition (v0.1):**

```json
{
  "name": "Message",
  "apiVersion": "core.ois/v1",
  "envelope-v2": {
    "metadata-schema": {
      "type": "object",
      "required": ["id", "kind", "apiVersion", "createdAt"],
      "properties": {
        "id":               {
          "type": "string",
          "pattern": "^[0-9A-Z]{26}$",
          "description": "ULID, monotonic per repository instance. Substrate-derived chronological ordering preserved."
        },
        "kind":             { "const": "Message" },
        "apiVersion":       { "const": "core.ois/v1" },
        "createdAt":        { "type": "string", "format": "date-time" },
        "updatedAt":        { "type": "string", "format": "date-time", "description": "Bumps on status flip (new → received → acked) + scheduledState transition." },
        "messageKind":      {
          "enum": ["reply", "note", "external-injection", "amendment", "urgency-flag"],
          "description": "RENAMED from current flat `kind` field (which collides with envelope `kind: \"Message\"`). Discriminator for axis-matrix (requires_turn / shifts_turn / authorized_authors). Immutable post-create."
        },
        "authorRole":       { "enum": ["architect", "engineer", "director", "system"] },
        "authorAgentId":    { "type": "string", "minLength": 1 },
        "threadId":         {
          "type": ["string", "null"],
          "description": "Optional thread membership. Indexed for derived thread-view queries. Stays in metadata as identity-shape (which thread does this Message belong to)."
        },
        "sequenceInThread": {
          "type": ["integer", "null"],
          "minimum": 0,
          "description": "Monotonic per-thread sequence; atomic CAS allocation via createOnly at insert. Substrate-derived (idea-200 W2 read source-of-truth)."
        },
        "migrationSourceId":{
          "type": ["string", "null"],
          "pattern": "^[a-z-]+:.+$",
          "description": "Source-namespace pointer (e.g., `thread-message:thread-N/seq-K`, `notification:<ulid>`, `pending-action:<ulid>`). Idempotent re-projection key. Post-W6 sunset becomes historical/clearable."
        }
      }
    },
    "spec-schema": {
      "type": "object",
      "required": ["target", "delivery", "payload"],
      "properties": {
        "target": {
          "oneOf": [
            { "type": "null", "description": "broadcast — every subscriber to the relevant fanout" },
            {
              "type": "object",
              "properties": {
                "role":    { "enum": ["architect", "engineer", "director", "system"] },
                "agentId": { "type": "string" }
              },
              "description": "role-only fanout OR agentId-pinpoint"
            }
          ],
          "description": "Declared audience; immutable post-create."
        },
        "delivery": {
          "enum": ["push-immediate", "queued", "scheduled"],
          "description": "Declared delivery semantics; immutable post-create."
        },
        "payload": {
          "description": "Opaque per-kind payload — `unknown` type; cluster-2 PendingAction.spec.payload precedent. Per-kind schemas not locked at v0.1; W3 trigger surface may add per-kind validators."
        },
        "escalation": {
          "type": ["object", "null"],
          "properties": {
            "timeoutMs":  { "type": "integer", "minimum": 1 },
            "targetRole": { "type": "string" }
          },
          "description": "Future trigger-surface escalation policy (mission-56 W3)."
        },
        "fireAt":         { "type": ["string", "null"], "format": "date-time", "description": "Mission-51 W4 scheduled-message firing time." },
        "precondition":   {
          "description": "Predicate registry shape `{fn: string, args: object}`; opaque. Sweeper evaluates at fireAt."
        },
        "maxRetries":     { "type": ["integer", "null"], "minimum": 1, "description": "Failed-trigger retry interlock; default 3 (configurable via env at trigger-runner level)." },
        "intent":         { "type": ["string", "null"], "description": "Per-turn intent metadata (lifted from inline thread.messages[]; cluster-1 §3.3 Thread.status.messages reference)." },
        "semanticIntent": { "type": ["string", "null"] }
      }
    },
    "status-schema": {
      "type": "object",
      "required": ["phase"],
      "properties": {
        "phase": {
          "enum": ["new", "received", "acked"],
          "description": "Primary FSM (mission-56 W3.2): `new → received → acked`. Linear monotonic; atomic CAS via putIfMatch (winner-takes-all under concurrent claim). Renamed from current flat Message.status field per K8s convention."
        },
        "claimedBy": {
          "type": ["string", "null"],
          "description": "Agent that won the claimMessage race; set on `new → received`. Undefined while phase=new; never cleared once set."
        },
        "scheduledState": {
          "type": ["string", "null"],
          "enum": ["pending", "delivered", "precondition-failed", null],
          "description": "Secondary FSM (cluster-3 §1.6 multi-FSM rule): orthogonal to status.phase. Only set on delivery=scheduled. `pending → delivered` (sweeper fires) or `pending → precondition-failed` (precondition false; audit retains forensics)."
        },
        "retryCount":   { "type": ["integer", "null"], "minimum": 1, "description": "Current retry attempt number (mission-51 W4 failed-trigger retry interlock)." },
        "converged":    { "type": ["boolean", "null"], "description": "Per-turn convergence flag (lifted from inline thread.messages[])." }
      }
    },
    "filterable-fields": [
      { "shorthand": "phase",            "path": "status.phase" },
      { "shorthand": "messageKind",      "path": "metadata.messageKind" },
      { "shorthand": "authorAgentId",    "path": "metadata.authorAgentId" },
      { "shorthand": "authorRole",       "path": "metadata.authorRole" },
      { "shorthand": "threadId",         "path": "metadata.threadId" },
      { "shorthand": "targetRole",       "path": "spec.target.role" },
      { "shorthand": "targetAgentId",    "path": "spec.target.agentId" },
      { "shorthand": "delivery",         "path": "spec.delivery" },
      { "shorthand": "scheduledState",   "path": "status.scheduledState" },
      { "shorthand": "migrationSourceId","path": "metadata.migrationSourceId" }
    ]
  }
}
```

**Partition rationale (Message):**
- **`id` (ULID) → metadata.id** — substrate-derived chronological-ordering-by-id preserved (sibling of cluster-2 PendingAction.metadata.id `pa-YYYY-MM-DD...` load-bearing pattern).
- **`kind` (MessageKind) → `metadata.messageKind`** — **RENAMED from current flat `kind` field** because it collides with envelope `kind: "Message"`. Discriminator stays in metadata (identity-shape). **Field-rename surfaces post-cutover.**
- **`authorRole`/`authorAgentId` → metadata** — identity-shape (who authored); cascade-provenance class.
- **`threadId`/`sequenceInThread` → metadata** — identity-shape (thread membership pointer + substrate-derived sequence); substrate idempotency at insert.
- **`migrationSourceId` → metadata** — provenance lineage (W2 async-shadow projector idempotency).
- **`target` → spec** — declared audience; immutable post-create.
- **`delivery` → spec** — declared delivery semantics; immutable post-create.
- **`payload` (opaque per-kind) → spec** — sibling of cluster-2 PendingAction.spec.payload opaque-shape disposition.
- **`escalation`/`fireAt`/`precondition`/`maxRetries` → spec** — declared scheduling-and-trigger config; immutable post-create.
- **`intent`/`semanticIntent` → spec** — per-turn metadata declared at create-time.
- **`status` → `status.phase`** — primary FSM per K8s convention (mission-56 W3.2 monotonic 3-state).
- **`claimedBy` → status** — populated at FSM transition new → received; observed state.
- **`scheduledState` → status** — secondary FSM per §1.6 multi-FSM rule; orthogonal to primary phase; only set on scheduled-delivery.
- **`retryCount` → status** — observed retry attempt count.
- **`converged` → status** — observed per-turn convergence flag.
- **`name` OMITTED** — Message is system-emit (no human-facing handle; `spec.payload` body carries content).

**Field renames visible post-cutover (Message):**
- `Message.kind` (current flat field; clashes with envelope `kind: "Message"`) → `Message.metadata.messageKind`
- `Message.status` (FSM enum) → `Message.status.phase`
- All other top-level fields → spec.* or status.* per partition above

**Open questions (Message) — engineer audit:**
- **OQ1**: `Message.kind` rename to `metadata.messageKind` — confirm naming. Alternatives considered: (a) `metadata.messageKind` (v0.1 pick; explicit + namespaces against envelope `kind`); (b) `metadata.kindDiscriminator` (more generic); (c) keep `kind` in metadata via override convention. v0.1 picks (a) for clarity.
- **OQ2**: `payload` opaque-in-spec disposition — confirm cluster-2 PendingAction precedent applies (no per-kind schema lock at v0.1; W3 trigger surface may add validators).
- **OQ3**: `intent`/`semanticIntent`/`converged` placement — these are per-turn metadata lifted from inline thread.messages[] historically. spec (declared at create-time) vs status (observed at convergence)? v0.1 picks `intent`/`semanticIntent` → spec, `converged` → status. Engineer disposition welcome.
- **OQ4**: `escalation` placement — currently spec (declared trigger-surface config). Confirm vs status (future mission-56 W3 may surface escalation-fired-at observable).
- **OQ5**: idea-200 W2 carve-out composition — Thread.status.messages staged-inside-envelope (cluster-1 §3.3) carves out to Message store post idea-200 W2. Cluster-4 Message envelope IS the substrate target for that carve-out. Confirm: at cluster-4 cutover, Message envelope is ready to receive Thread.status.messages migration via `migrationSourceId: "thread-message:thread-N/seq-K"`.

**Composition checkpoints:**
- **idea-200 W2 Thread.status.messages carve-out** — cluster-4 Message envelope IS the substrate target. Cluster-1 §3.3 stages messages inside Thread envelope at cluster-1 cutover; idea-200 W2 follow-on Mission migrates them to Message store via `migrationSourceId`.
- **bug-93 sweeper-poll-pressure** — STRUCTURALLY ELIMINATED at mission-83 W5 substrate cutover (substrate-watch primitive replaces FS-walk poll-loop per Design v1.4 §2.4). Cluster-4 Message envelope preserves substrate-watch enablement.
- **mission-51 W4 scheduled-message lifecycle** — `scheduledState` secondary FSM preserved per §1.6 multi-FSM rule.

---

### §2.2 Audit — stub (v0.1; full at v0.2 per engineer dispositions)

**Existing flat shape** (per `hub/src/state.ts:1004`):
- `id` (pattern: `audit-N`), `timestamp`, `actor` (`architect | engineer | hub`), `action` (open string), `details` (open string), `relatedEntity` (id of related entity OR null)

**Stub partition (v0.1):**

| Field | Section | Rationale |
|---|---|---|
| `id` | metadata.id | identity (`audit-N` pattern; createOnly-write per audit-repository.ts:77) |
| `kind`, `apiVersion` | metadata | uniform |
| `timestamp` | metadata.createdAt | renamed for envelope uniformity (audit-entry creation IS the timestamp; no separate updatedAt — immutable) |
| `actor` | metadata.actor | identity-shape (who logged the audit entry); cascade-provenance class |
| `action` | spec.action | declared content (what happened) |
| `details` | spec.details | declared content (free-form description) |
| `relatedEntity` | spec.relatedEntity | declared pointer (which entity this audit relates to) |
| `phase` (constant `"logged"`) | status.phase | uniformity convention; Audit has no FSM (immutable post-create) |

**Open questions (Audit) — engineer audit:**
- **OQ6**: Audit FSM enum — `["logged"]` constant 1-state vs OMIT status block entirely. v0.1 picks constant 1-state for envelope-uniformity (sibling of cluster-3 Counter `status.phase: "active"` constant pattern).
- **OQ7**: `relatedEntity` placement — currently `spec.relatedEntity` (declared pointer at log-time). Alternative: `metadata.relatedEntity` (identity-shape pointer like Task.metadata.turnId). v0.1 picks spec (declared content); engineer audit.
- **OQ8**: `name` OMITTED for Audit — confirm. Audit is content-shaped (system-emit; no handle).

**Composition checkpoints:**
- createOnly-write pattern preserved (audit-repository.ts:77 idempotency at create-time).
- Append-only semantic — no updates after create.

---

### §2.3 RepoEventBridgeCursor — stub (v0.1; renumbered from v0.1 §2.4 after Notification drop)

**Existing flat shape** (per `hub/src/storage-substrate/repo-event-bridge-adapter.ts`; mission-84 W3 NEW kind):
- `id` (pattern: `<owner>__<repo>`)
- `body` (cursor-store-encoded-JSON; opaque per `cursor-store.ts` encoding)

Per entity-kinds.json v1.1 notes: `watchable: false` (bookkeeping writes; no consumer needs change-events; pre-resolves F5 future-target probe). No hot fields.

**Stub partition (v0.1):**

| Field | Section | Rationale |
|---|---|---|
| `id` (`<owner>__<repo>`) | metadata.id | identity (per-repo key) |
| `kind`, `apiVersion` | metadata | uniform |
| `createdAt`, `updatedAt` | metadata | uniform |
| `phase` (constant `"active"`) | status.phase | uniformity convention; bookkeeping kind; no FSM |
| `body` (cursor-store-encoded-JSON) | status.cursor | observed cursor position; mutates on every poll-source advance |

**Engineer dispositions applied (v0.2):**
- **OQ13 ✓** `body` → `status.cursor` (engineer concur — cursor mutates per poll-source advance; observed Hub-side state; sibling of Agent.status.lastHeartbeatAt pattern).
- **OQ14 ✓** opaque-encoded body shape preserved (engineer recommend keep opaque per `cursor-store.ts` encoding; `type: "string"`; substrate doesn't need to interpret cursor-state; sibling of cluster-2 PendingAction.status.continuationState opaque-JSON disposition).
- **OQ15 ✓** `name` OMITTED (engineer concur — per-repo bookkeeping; multi-instance (per `<owner>__<repo>`); not handle-classified). Engineer-note: NOT a singleton-meta-entity (cluster-3 §5 third class) — it's a per-repo plural meta-entity; §1.5 binary axis handles via OMITTED disposition.

---

### §2.4 RepoEventBridgeDedupe — stub (v0.1; renumbered from v0.1 §2.5 after Notification drop)

**Sibling of §2.3 RepoEventBridgeCursor.** Same shape; same partition rationale; same engineer-ratified dispositions.

**Stub partition (v0.1):**

Identical to §2.3 except:
- `id` represents the per-repo dedupe-LRU instance (still `<owner>__<repo>` per entity-kinds.json)
- `body` carries dedupe-LRU encoded state (different cursor-store.ts encoding; same opaque-to-substrate property)

**Engineer dispositions applied (v0.2):** same as §2.3 (OQ13-OQ15 apply equally; per-repo plural bookkeeping; opaque body in status; name OMITTED).

**Composition checkpoints:**
- mission-84 W3 NEW kind per Design v1.1 §2.3 Variant (ii) minimal-SchemaDef.
- Cluster #23 closure (repo-event-bridge cursor + dedupe substrate-persistence).
- Pre-resolves F5 future-target probe (watchable: false).

---

## §3 Composition checkpoints

### §3.1 idea-200 (M-Thread-Substrate-Carve-Out) — Message store IS the target

**Cluster-1 §3.3 + §4.5** stage Thread.status.messages[] inside Thread envelope at cluster-1 cutover. **idea-200 W2** follow-on Mission carves out `messages[]` to **cluster-4 Message store** via `migrationSourceId: "thread-message:thread-N/seq-K"`. Cluster-4 Message envelope IS the substrate target for that migration; cluster-4 cutover preserves migrationSourceId idempotent re-projection mechanism.

### §3.2 mission-51 (Message Primitive) — sovereign Message store

Cluster-4 Message envelope preserves mission-51 W1 sovereign Message store design (5 kinds × 3 axes; ULID id; multi-membership via derived queries from `threadId` + `target.{role,agentId}` + `authorAgentId`).

### §3.3 mission-56 (Notification → Message migration) — REFRAMED v0.2

mission-56 W5 removed legacy Notification entity; migrated to Message kind=external-injection. **Engineer code-trace confirmed at v0.2: mission-56 W5 IS fully complete** — notifications ARE first-class Message entities with `kind: "external-injection"` discriminator today; no direct-write path to re-mediate; no INotificationStore-gap to close. Previous v0.1 framing assumed mission-83 OQ8 re-introduction of INotificationStore; **engineer code-trace contradicted the premise** (zero grep matches for `notifications/notif-*` direct file-writes in production code; "notif-N" strings are log-prefixes referencing Message ids, not separate entity ids).

**Substrate-currency catch:** `hub/scripts/entity-kinds.json:149` Notification entry was STALE per engineer evidence. Substrate inventory re-locks 22 kinds → 21 kinds at v0.2; Notification moves from `kinds[]` to `kinds-explicitly-not-included` with engineer-code-trace disposition.

**Follow-on:** mission-83 OQ8 re-files as a separate Idea post-cluster-4 with corrected framing — semantic-separation question (are system-emit notifications semantically distinct from external-injection Messages?), NOT mediation-gap closure.

### §3.4 mission-83 (Hub Storage Substrate) — bug-93 elimination preserved

bug-93 sweeper-poll-pressure (74% sustained Hub CPU) STRUCTURALLY ELIMINATED at mission-83 W5 substrate cutover. Cluster-4 Message envelope preserves substrate-watch primitive enablement (per Design v1.4 §2.4); no FS-walk poll regressions introduced.

### §3.5 mission-84 (Repo-Event Bridge Substrate) — RepoEventBridge* persistence

mission-84 W3 introduced RepoEventBridgeCursor + RepoEventBridgeDedupe per Design v1.1 §2.3 Variant (ii) minimal-SchemaDef. Cluster-4 §2.4 + §2.5 envelope shape is the substrate-mediated form for these bookkeeping kinds; cluster #23 closure preserved.

### §3.6 idea-121 (M-API-v2.0) — `get_resource_shape` consumer

Same as cluster-1/2/3 pattern. SchemaDef cluster-4 partition feeds idea-121 projection layer.

### §3.7 idea-151 (M-Graph-Relationships)

**Cluster-4 has limited applicability for idea-151 Relationship-kind extraction.** Message has `threadId` (could be edge to Thread); Notification may have recipient (could be edge to Agent); RepoEventBridge* are id-keyed by per-repo (not FK-shaped). Cluster-4 envelope preserves inline pointers; idea-151 follow-on Mission disposition independent.

### §3.8 idea-315 (M-PR-Synchronize-Handler) — coordination methodology

This cluster-4 v0.2 push will continue to exercise the refined memory rule (explicit `create_message` ping post-push) until idea-315 substrate-fix lands.

### §3.9 bug-118 (substrate-wide bug-lineage gap)

**Cluster-4 has limited applicability** — Message + Audit + Notification + RepoEventBridge* are not cascade-spawn-shaped (these are Hub-side write-paths or system-emit). Cluster-4 envelope does NOT add cascade-backlink metadata fields per current cluster (composition note only). Exception: Message may carry cascade-provenance for `kind: "reply"` Messages via existing `authorRole` + `authorAgentId` fields; no envelope-level provenance changes needed.

---

## §4 Acceptance criteria (cluster-4-specific)

- All 4 cluster-4 kinds (Message / Audit / RepoEventBridgeCursor / RepoEventBridgeDedupe) carry valid envelope structure post-cutover (verified via psql JSON-shape inspection per kind). Notification dropped from cluster-4 v0.2 per Director-ratified disposition (i).
- Each kind's `apiVersion: "core.ois/v1"`
- Strict K8s partition (no top-level fields beyond `{id, name, kind, apiVersion, metadata, spec, status}`; `name` per-kind per OQ-dispositions)
- `FilterableField.path` declarations per-kind enable shorthand-filter translation at `list_*` runtime; composes with idea-121
- **Message-specific:** `kind` (current field) → `metadata.messageKind` rename (clashes with envelope kind); FSM primary at `status.phase`; scheduledState secondary FSM per §1.6 multi-FSM rule
- **Field path moves preserved 1:1** in migration:
  - Message: status flat-enum → `status.phase`; kind → metadata.messageKind; all other → spec/status per partition
  - Audit: timestamp → metadata.createdAt; actor → metadata.actor; action/details/relatedEntity → spec.*
  - RepoEventBridge*: body → status.cursor / status.dedupe (per OQ13 engineer ratification)
- **Substrate-inventory re-lock**: `hub/scripts/entity-kinds.json` updates v1.1 → v1.2; Notification removed from `kinds[]` + added to `kinds-explicitly-not-included` per engineer code-trace evidence; total locked count 22 → 21
- **Cross-Mission dependency surfaces (cluster-4):**
  - Message envelope MUST be ready to receive idea-200 W2 Thread.status.messages migration (via migrationSourceId)
  - mission-83 OQ8 Notification semantic-separation question re-files as separate Idea post-cluster-4 (corrected framing; not in cluster-4 v0.2 scope)
  - RepoEventBridge* are mission-84 W3 already-ratified; cluster-4 just adds envelope shape
- **bug-93 elimination preserved** — substrate-watch primitive enablement on Message envelope unchanged

---

## §5 Cumulative-pattern reuse + cluster-4 additions

Cluster-4 inherits all six patterns surfaced cumulatively:

1. `metadata.name` for handle-classified kinds (NOT used in cluster-4 — all system-emit kinds OMIT name)
2. Declared-with-controlled-mutation pattern (NOT used in cluster-4 — all FSM-mutated fields are status-side, not spec-mutated)
3. Derived-scalar-field discipline (NOT used in cluster-4 — no derived scalars; `sequenceInThread` is substrate-allocated at insert via createOnly CAS but stays in metadata as identity-shape)
4. Default-to-status for FSM-mutated fields (Message ✓; Notification ✓ likely; RepoEventBridge* ✓)
5. Virtual-view envelope-exclusion (NOT used in cluster-4 — no virtual views per kind)
6. Declared-routing-intent (spec.labels) vs declared-content-classification (metadata.labels) axis (NOT used in cluster-4 — no label-maps on these kinds)
- Multi-FSM-in-status per cluster-3 §1.6 (Message ✓ — primary phase + secondary scheduledState)

**Cluster-4 introduces no NEW envelope-methodology patterns.** This is the most pattern-consolidation-heavy cluster — system-emit/bookkeeping kinds reuse existing patterns without new abstractions.

**Cluster-4-specific observation: field-name collision with envelope `kind`.** Message.kind (discriminator field) collides with envelope `kind: "Message"`. v0.1 picks rename to `metadata.messageKind`. **No other cluster-4 kinds have this collision** (Audit.action, Notification field-set TBD, RepoEventBridge*.body — none use a top-level `kind` field).

---

## §6 Status

**v0.2** — engineer PR #271 v0.1 review integrated · Director-ratified scope reduction (drop Notification per disposition (i)) · awaiting v0.2 approval.

**Substantive cluster-4 contributions to envelope methodology** (signal for cluster-5):

1. **§1.7 NEW sub-discipline — field-name collision with envelope `kind`** — when a current kind has a top-level discriminator field colliding with envelope `kind`, rename to `metadata.<kindName>Specific`. Demonstrated `Message.kind → metadata.messageKind`.
2. **Substrate-currency catch** — engineer code-trace contradicting `entity-kinds.json:149` STALE Notification framing. Substrate inventory re-locks 22 → 21 kinds. Cluster-1 Round 7 precedent (substrate-currency wins over architect spec-recall) applied at cluster-4. **v2.1 methodology candidate R captured.**

**Engineer approval posture (v0.1 → v0.2 transition):**
- v0.1 approved by greg (PR #271 review APPROVED 2026-05-23T11:57Z at commit `89e28bd`)
- v0.2 integrates 11 disposition-confirms (OQ1-8 + OQ13-15) + drops 4 OQs (OQ9-12) per Director-ratified Notification removal
- **Architect-side explicit `create_message` ping to greg follows v0.2 push** per refined memory rule (cluster-4 v0.2 continues to exercise post-push surfacing)

**v2.1 methodology candidate R** captured: substrate-currency catch on inventory-locked source-of-truth — entity-kinds.json + production code as SSOT, not architect-spec-recall, across mission-83-style inventory-locks.

**Next architect action post-approval:** cluster-5 Design (Document / ArchitectDecision / DirectorHistoryEntry / ReviewHistoryEntry / ThreadHistoryEntry per cluster-2 §6 ratified scope).
