# Programmable Event Policy Substrate Slice 0

Status: implementation slice 0
Mission: mission-112 / evpolicy0

## Scope delivered

Slice 0 introduces a static, code-reviewed EventPolicy boundary for the existing WorkItem notification projection behavior. It does not add runtime mutable policy, arbitrary action emission, digest batching, or a first-class Notification entity.

The production rule is:

- `ruleId`: `workitem-notification-projection-v1`
- `version`: `1`
- `eventFamily`: `workitem-notification`
- matched message kind: `external-injection`
- matched notification events:
  - `work-transition-notification`
  - `work-unblocked-notification`
  - `work-updated-notification`
- output/effect: `message-projection` only
- authority: code-review-only mutation, `runtimeActions: none`

## Code boundary

Primary implementation:

- `hub/src/policy/message-consumption-projection.ts`

The module now separates the policy path into:

1. static `EventPolicyRule` registry;
2. deterministic rule selection;
3. WorkItem/recipient context collection;
4. pure WorkItem notification decision evaluation;
5. projection-envelope adaptation preserving the existing `MessageConsumptionProjection` shape.

Existing production seams continue to call the shared projection API:

- `projectMessageForConsumption`
- `projectMessagesForConsumption`
- `projectMessageArrivalData`
- `messageArrivalData`

Thus list, claim, live egress, and SSE replay retain the same external interface while routing through the registry/evaluator internals.

## Authority boundary

Slice 0 policy output is presentation guidance only. It cannot:

- claim/release/complete WorkItems;
- mutate Messages;
- auto-ack raw Messages;
- resolve Decisions;
- reply to or close Threads;
- emit arbitrary actions.

Mutating tools remain authoritative and revalidate on call.

The `bypassClasses` field is future-facing metadata only in this slice. Broad critical/Director/verifier/lease bypass enforcement is not claimed here.

## Preserved stale_fyi0 invariants

- Raw Message payload identity is preserved (`projected.payload === raw.payload`).
- Projection metadata is additive.
- Specific WorkItem actionability uses item-local `getLegalMoves(workId, {agentId, role})`.
- Capped global ready-list scans are not used for specific `work_id` actionability.
- Registry quarantine is overlaid before `your-turn`.
- Missing caller context and read failures degrade visibly to manual inspect.
- Unknown event families pass through without projection, rather than disappearing.
- Adapters remain renderers of Hub-provided projection/body fields.

## Dry-run / fixture support

`dryRunEventPolicy` exposes a deterministic fixture helper for synthetic raw Message + current-state context cases. It uses the same selector and pure decision function as production projection, but does not read stores, dispatch, mutate state, or attach timestamps.

Covered fixture classes include:

- terminal stale transition;
- claimable unblocked WorkItem;
- missing concrete agent context;
- quarantined recipient;
- unknown event family no-match;
- degraded context/read failures;
- disabled-rule production exclusion;
- deterministic conflict detection;
- prior capped-list verifier repro via no `listReadyForRole` call.

## Residuals / non-goals

Not delivered in Slice 0:

- runtime mutable EventPolicy rules;
- persisted rule versions / rollback;
- recorded production Message-window replay;
- digest / hold-down batching;
- auto-ack of raw Messages;
- broad bypass enforcement across Director/verifier/critical/lease events;
- projected inbox filters by rule/actionability/degraded reason;
- telemetry counters for projection decisions.

Those require separate design, authority, and verifier work.
