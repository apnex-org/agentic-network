# m-k8s-envelope-w8-notification-migration-design

**Mission:** mission-88 M-K8s-Envelope Wave W8 — substrate-hardening pre-W11-re-cutover
**Status:** v0.1 WORKING DRAFT
**Anchor:** bug-124 (Notification kind cartography gap; major)
**Author:** architect (lily) driving via PR-direct (thread-reply blocked per bug-126/127)
**Director-ratification:** (D) TOLERANT-bridge + W7-W10 + W11 clean re-cutover (ratified 2026-05-24)

---

## 1. Problem

Mission-88 cluster-1 through cluster-5 Design-passes authored 21 kinds of SchemaDef + migration modules. Production-state audit at W6 Phase B Step 7 surfaced **23 kinds in `entities` table**:

| kind | rows | in 21-kind inventory? |
|---|---:|---|
| (the 20 mission-83 kinds + MigrationCursor) | … | ✓ (21 total) |
| **MigrationCursor** | 21 | ✓ (W0 substrate-prep) |
| **Notification** | **555** | **✗ MISSING** |

100% of Notification rows remain legacy-flat post-W6 cutover (no migration module to process them).

## 2. Production-state shape audit

**Notification kind shape (legacy-flat, current production):**

```json
{
  "id": "01KP2JD2Q408F58QKY32HQEEYS",
  "data": {
    "taskId": "task-90",
    "summary": "AMP Phase 1 complete: notification IDs migrated from integers to ULIDs across Hub, client SDK, and Architect. 48 tests pass. Both services deployed and healthy.",
    "reportRef": "reports/task-90-report.md"
  },
  "event": "report_submitted",
  "timestamp": "2026-04-13T04:43:08.901Z",
  "targetRoles": ["architect"]
}
```

**14 event types observed in production:**

| event type | count | semantics |
|---|---:|---|
| review_completed | 234 | task-completion review notification |
| thread_message | 93 | thread-message posted notification |
| report_submitted | 58 | engineer report submission |
| directive_issued | 55 | director directive |
| directive_acknowledged | 54 | director directive ack |
| idea_submitted | 20 | new idea filing |
| thread_converged | 15 | thread convergence event |
| proposal_decided | 15 | proposal decision notification |
| proposal_submitted | 3 | new proposal filing |
| mission_created | 3 | new mission |
| turn_created | 2 | thread-turn issued |
| tele_defined | 1 | tele definition |
| clarification_requested | 1 | clarification ask |
| clarification_answered | 1 | clarification answer |

Pattern: Notification is a **system-event-log kind** (cluster-4 system-emit class per cluster-4 W4 partitioning). Conceptually overlaps with Audit (also cluster-4) but historically distinct.

## 3. Root cause

**Architect spec-recall gap during W2 cluster-1 SchemaDef inventory authoring** — Notification kind in production-state but absent from architect's kind-inventory survey.

Verifiable: `grep -r 'kind.*Notification' hub/src/` returns active write-paths (`notification_recipient_idx` is even pre-declared in the SchemaDef-reconciler index set), but `entity-kinds.json` doesn't include it.

**Methodology learning (Phase 10 calibration candidate):** substrate-introduction-class missions need a pre-W2 **kind-inventory grep against production-state** as a load-bearing audit step, not just architect spec-recall. Sibling to `feedback_architect_side_cross_mission_completeness_verification_gap` already in memory.

## 4. Architectural decision

### (α) Add Notification as 22nd kind with own migration module (preferred)

Mirror cluster-4 Audit/RepoEventBridge* pattern. Notification gets its own SchemaDef + migration module. entity-kinds.json bumps from 21→22 kinds LOCKED.

**Pros:** preserves cluster boundaries (Notification stays in cluster-4 system-emit). Minimal narrative churn (just W2 cluster-1 audit oversight folded in).

**Cons:** retains Notification-vs-Audit conceptual overlap.

### (β) Subsume Notification into Audit (consolidation)

Migrate Notification rows into Audit kind with discriminator. Drop Notification kind from substrate.

**Pros:** consolidates system-emit class into one kind; cleaner cartography long-term.

**Cons:** breaks Hub-side write-paths that emit Notifications (substantial Hub-source change); migration must remap 555 rows + update downstream readers; not in mission-88 scope-budget.

### Recommendation: (α)

(α) closes W11 cutover-blocker cleanly. (β) is the right answer for a **post-mission-88 idea** (M-Notification-Audit-Consolidation) — file as follow-on.

Also note: idea-316 (M-Notification-Semantic-Separation, `open` per handover entity table) may be a sibling consolidation idea — coordinate scope-naming if (β) gets filed.

## 5. Envelope-shape field mapping

| legacy-flat field | envelope path | rationale |
|---|---|---|
| `id` (ULID) | `metadata.name` | handle-classified (per cluster-2 §1.5 pattern) |
| `event` (string) | `spec.eventType` | declared-routing-intent (per cluster-3 §5; routing-intent under spec) |
| `timestamp` (ISO) | `metadata.createdAt` | provenance (per cluster-1 standard) |
| `targetRoles` (string[]) | `spec.targetRoles` | declared-routing-intent (per cluster-3 §5) |
| `data` (object) | `spec.payload` | content (per cluster-5 content-classification axis) |
| — | `apiVersion: "v1"` | envelope-marker |
| — | `kind: "Notification"` | envelope-marker |
| — | `status: { phase: "logged" }` | append-only-constant per cluster-4 Audit precedent |
| — | `metadata.sourceThreadId?` | bug-118 cascade-provenance — only for Notifications cascade-spawned from a thread (audit needed: do any of the 14 event types originate from threads?) |

## 6. Migration module

Mirror cluster-4 Audit module shape:

```typescript
// hub/src/migrations/notification.ts
export const notificationMigration: KindMigration = {
  kind: "Notification",
  cluster: "cluster-4-system-emit",
  preMigrateChecks: [
    // Cluster-1 v0.2 standard checks
    "no in-flight writers (append-only kind; trivially satisfied)",
  ],
  transform: (legacy: LegacyNotification): EnvelopeNotification => ({
    apiVersion: "v1",
    kind: "Notification",
    metadata: {
      name: legacy.id,
      createdAt: legacy.timestamp,
      ...(legacy.cascadeProvenance && { sourceThreadId: legacy.cascadeProvenance.threadId }),
    },
    spec: {
      eventType: legacy.event,
      targetRoles: legacy.targetRoles,
      payload: legacy.data,
    },
    status: {
      phase: "logged",  // append-only-constant per Audit precedent
    },
  }),
  postMigrateChecks: [
    "row-count preserved",
    "no field-value drift via JSONB content-hash spot-check on 5 sample rows",
  ],
};
```

## 7. entity-kinds.json bump (21→22)

```diff
 {
   "$schema": "...",
-  "$kinds": 21,
+  "$kinds": 22,
   "kinds": [
     ...
     { "name": "RepoEventBridgeDedupe", "cluster": "cluster-4-system-emit", ... },
+    { "name": "Notification", "cluster": "cluster-4-system-emit", "shape": "envelope", "migrationModule": "hub/src/migrations/notification.ts", "schemaDef": "hub/src/schemas/notification.ts" }
   ]
 }
```

(MigrationCursor stays out of the kind-inventory per W0 substrate-prep decision — it's a migration-runner-internal entity, not a domain kind.)

## 8. SchemaDef

Cluster-4 system-emit class; mirror Audit:

```typescript
// hub/src/schemas/notification.ts
export const notificationSchemaDef: SchemaDef = {
  apiVersion: "v1",
  kind: "Notification",
  metadata: {
    name: z.string().regex(/^[0-9A-Z]{26}$/),  // ULID
    createdAt: z.string().datetime(),
    sourceThreadId: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional(),
  },
  spec: {
    eventType: z.enum([
      "review_completed", "thread_message", "report_submitted",
      "directive_issued", "directive_acknowledged", "idea_submitted",
      "thread_converged", "proposal_decided", "proposal_submitted",
      "mission_created", "turn_created", "tele_defined",
      "clarification_requested", "clarification_answered",
    ]),
    targetRoles: z.array(z.enum(["architect", "engineer", "director"])),
    payload: z.record(z.string(), z.unknown()),
  },
  status: {
    phase: z.literal("logged"),
  },
  indexes: [
    { name: "notification_recipient_idx", expression: "data->'spec'->>'targetRoles'", where: "kind = 'Notification'" },
    // additional indexes per query-pattern audit (likely eventType + createdAt range)
  ],
};
```

## 9. Composition with other waves

- **W7 (bug-123)** — Notification's `notification_recipient_idx` may need expression-path migration per W7 audit (W7 §1 stealth-broken table). Coordinate index migration in same SchemaDef-reconciler authoring pass.
- **W9 (bug-125)** — Notification rows in lists may trigger iterate-tags crash if SchemaDef doesn't have `tags` field on Notification. Verify W9 defensive-guard covers `tags`-absent case.
- **idea-316 M-Notification-Semantic-Separation** — open Idea filing may compose with (β) above for future consolidation.

## 10. Architect-asks (Design-pass round)

1. **eventType enum freeze** — pin 14 observed event types as closed-set, or leave open per Hub-source emission patterns? Lean: closed-set with `"unknown"` fallback in transform for cataloging-gap surfaces; new emissions add explicit values.

2. **sourceThreadId cascade audit** — do any of the 14 event types originate from threads (e.g., `thread_message`, `thread_converged`, `proposal_submitted`)? If yes, bug-118 cascade-provenance fold-in is required for those Notification rows. Engineer-side audit before transform-bake.

3. **Migration-during-cutover vs deferred** — W11 cutover already touches 21 kinds; adding 22nd kind extends cutover-window by ~5-10s estimated for 555-row migration. Acceptable. Confirm.

4. **(β)-alternative file as Idea now or wait for retro** — recommend file now (M-Notification-Audit-Consolidation, sibling to idea-316) so the consolidation thread doesn't get lost in Phase 10 noise.

## 11. Test plan

- [ ] Unit test: notificationMigration transform — round-trip 5 sample legacy rows (one per event type covering all 3 targetRoles)
- [ ] Integration test: 555-row migration replay against test-postgres → 100% envelope, no data loss
- [ ] Stealth-broken-index regression-guard: `data->'spec'->>'targetRoles'` query returns envelope-shape rows post-migration (covers W7 composition)
- [ ] SchemaDef-validation: all 14 eventType enum values accepted; invalid eventType rejected
- [ ] Append-only invariant: post-create updates rejected (status.phase = "logged" terminal)

## 12. Acceptance criteria

- entity-kinds.json bumped 21→22 with Notification entry
- SchemaDef + migration module + transform tests all merged
- W11 cutover migrates 555 Notification rows from legacy-flat → envelope-shape, zero failures
- Post-cutover Notification queries (e.g., `list_notifications` if/when added) return envelope-shape rows
- Methodology calibration filed: pre-W2 kind-inventory grep against production-state

## 13. Out of scope (deferred)

- (β) Notification-Audit consolidation — post-mission-88 Idea filing (composes with idea-316)
- New eventType emissions (Hub-source change)
- Notification retention policy / TTL (operationally separate)
- list_notifications MCP tool (cluster-4 tool-surface scope; not currently exposed)

## 14. Links

- **bug-124** (major; cutover-blocker; mission-88 W8 anchor)
- **mission-88** (active; M-K8s-Envelope)
- Sibling waves: W7 (bug-123), W9 (bug-125), W10 (bug-126), W10-ext (bug-127)
- **idea-316** M-Notification-Semantic-Separation (`open`) — composition candidate for (β)
- Composition: W7 PR #284
