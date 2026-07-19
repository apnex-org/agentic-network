# PR reviewer eligibility behavior (v0)

## Boundary

This document describes the v0 reviewer-eligibility behavior for `bug-292` / `pr_reviewer_eligibility0`.

The shipped surface is the existing repository-event → static rule → WorkGraph review-obligation path. It is **not** a broad PR lifecycle/FSM and does not infer binding intent from raw PR text markers. Hub-owned PR/WorkGraph binding rows remain the authority seam.

## Inputs

The reviewer eligibility evaluator consumes:

- repo and PR number;
- PR author GitHub login;
- optional last-pusher GitHub login when supplied by a caller;
- requested reviewer or requested team from the repo event;
- changed paths or compact path classes from the Hub-owned PR binding row;
- audited static repo review policy fixture, including path classes, CODEOWNERS/ruleset constraints, team membership, and provenance;
- machine-readable Hub agent → GitHub identity projection, including audited fallback entries.

v0 intentionally avoids mandatory live GitHub API lookups. Static fixture provenance and drift caveats are surfaced in eligibility output.

## Positive materialization behavior

For a safe requested-reviewer event, the handler:

1. resolves the Hub-owned PR/WorkGraph binding row by repo and PR number;
2. preserves existing binding authority, head/base, target phase, and idempotency guards;
3. evaluates reviewer eligibility from binding path data and identity/policy fixtures;
4. materializes a review WorkItem only when the requested reviewer is eligible;
5. writes compact eligibility metadata into the review WorkItem payload.

The review WorkItem payload can include:

- `eligibility.ok`;
- `eligibility.requiredTeams`;
- `eligibility.pathClasses`;
- `eligibility.selectedReviewers`;
- `eligibility.requestedReviewerStatus`;
- `eligibility.disqualified`;
- `eligibility.policyVersion` and `eligibility.policySourceRef`;
- `changedPathSource` with changed paths/path classes/provenance when present.

## Denial/fallback behavior

Unsafe or under-proven cases produce fallback metadata and do **not** create a misleading review WorkItem. Examples include:

- missing changed paths/path classes;
- unknown path class;
- requested team requiring a resolver;
- no eligible reviewer;
- requested reviewer insufficient or ambiguous;
- binding missing/ambiguous/not Hub-authored;
- target phase unsafe;
- head/base mismatch.

Denials are surfaced through rule/projection/materialization metadata such as:

- `ruleDecision.eligibility.ok=false`;
- `ruleDecision.eligibility.reason`;
- `ruleDecision.fallback.reason`;
- `projectionDecision.action="fallback_only"`;
- `materialization.materialized=false`.

## Shared-login and self-review semantics

The identity projection is cardinality-explicit. Greg and Ruby can both map to `apnex-greg`; the evaluator must not silently pick the first Hub agent for a shared GitHub login. Requested shared-login cases are marked ambiguous unless a later resolver explicitly disambiguates.

Author self-review and last-pusher self-review are disqualifications. A GitHub login, not merely a Hub agent id, is the review-authority identity.

## Anti-scope and proof boundary

This v0 does not claim:

- deploy or live replay behavior;
- live GitHub API reconciliation;
- a full PR lifecycle or merge FSM;
- branch protection bypass;
- that raw PR markers are authoritative binding evidence;
- active-seat prompt or skill availability.

Current proof is source-level tests and simulated handler/rule/projection behavior. Runtime claims require separate deployment/replay/live-seat evidence.
