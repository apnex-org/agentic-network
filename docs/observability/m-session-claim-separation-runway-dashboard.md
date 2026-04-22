# Mission-40 Deprecation-Runway Dashboard — Specification

**Mission:** M-Session-Claim-Separation (mission-40)
**ADR:** ADR-021 — Identity / Session Claim Separation
**Closing audit:** `docs/audits/m-session-claim-separation-closing-report.md`
**Status:** Spec (no dashboard config infrastructure exists at the Hub today; this document defines the panel queries + acceptance criteria for whoever builds it)
**Audience:** Hub operators + the post-architectural-review hardening pass that will retire the back-compat auto-claim hooks per brief §10.1

---

## Purpose

After mission-40 ships, the Hub serves three distinct session-claim paths through one `claimSession` helper:

1. **`trigger=explicit`** — modern adapter using the new `claim_session` MCP tool.
2. **`trigger=sse_subscribe`** — un-updated adapter that calls `register_role` then opens SSE; Hub's SSE-stream-open hook auto-claims.
3. **`trigger=first_tool_call`** — un-updated adapter that calls `register_role` then makes a tool call; Hub's PolicyRouter pre-dispatch hook auto-claims.

Paths 2 + 3 are back-compat hooks introduced in T2 to avoid forcing a Hub-and-all-adapters atomic deploy. They emit `agent_session_implicit_claim` audit actions with the trigger encoded in the `details` string. The §10.1 retirement criterion: when **both** sub-rates trend to zero (all adapters have migrated to explicit `claim_session`), the back-compat hooks can be retired.

This dashboard makes that signal observable.

---

## Panel queries

The Hub today does not have a dashboard configuration file (the existing `get_metrics` MCP tool from CP2 + the `agent_handshake_refreshed` audit etc. are all queried ad-hoc via `list_audit_entries`). Whoever builds the runway dashboard SHOULD use whatever observability infrastructure the Hub adopts in the meantime; the queries below are the panel specifications.

### Panel 1 — Explicit `claim_session` rate (target: GROWING)

```
Source:    Hub audit log (gs://ois-relay-hub-state/audit/*.json)
Filter:    action == "agent_session_claimed"
Bucket:    1-hour intervals
Y-axis:    count of audit entries per bucket
Title:     "Explicit claim_session rate (target: growing — adapter migration progress)"
```

### Panel 2 — Implicit-claim rate split by trigger (target: BOTH TRENDING TO ZERO)

```
Source:    Hub audit log
Filter:    action == "agent_session_implicit_claim"
Group:     extract `trigger` value from `details` string via regex /trigger=([a-z_]+)/
Bucket:    1-hour intervals
Series:    one line per distinct trigger value (expected: "sse_subscribe", "first_tool_call")
Y-axis:    count of audit entries per bucket per trigger
Title:     "Implicit-claim rate by trigger (target: BOTH lines → 0; retirement criterion §10.1)"
```

**This is the load-bearing panel.** Per T2 HC #4 + brief §10.1: the retirement criterion is "BOTH `trigger=sse_subscribe` AND `trigger=first_tool_call` rates trend to zero" — NOT the aggregate `agent_session_implicit_claim` rate. A combined metric silently hides which back-compat sub-path is still load-bearing. The dashboard MUST split.

### Panel 3 — `originatingTool` breakdown for `first_tool_call` trigger (correlation)

```
Source:    Hub audit log
Filter:    action == "agent_session_implicit_claim" AND details contains "trigger=first_tool_call"
Group:     extract `originatingTool` value from `details` string via regex /originatingTool=([a-z_]+)/
Bucket:    1-day intervals (slower-moving signal)
Series:    one bar per originatingTool, sorted by descending count
Title:     "First-tools/call back-compat: which tools are triggering implicit claims"
```

Use case: when the `first_tool_call` rate plateaus rather than trending to zero, this panel identifies WHICH adapter call sites are still hitting the back-compat path. The post-hardening pass can target those specific call sites (or specific adapter versions) for the explicit-claim migration.

### Panel 4 — Displacement rate (operational health, not a runway gate)

```
Source:    Hub audit log
Filter:    action == "agent_session_displaced"
Group:     extract `trigger` value from `details` string via regex /trigger=([a-z_]+)/
Bucket:    1-hour intervals
Series:    one line per trigger
Y-axis:    count of displacements per bucket per trigger
Title:     "Session displacements by trigger (operational; high rate may indicate adapter restart churn)"
```

Use case: spotting unexpected churn patterns (e.g., probe-induced displacement returning if a code regression breaks the bug-26 fix; rapid same-fingerprint claim-storms indicating a fork-bomb scenario).

---

## Dashboard parsing convention

Per T2 HC #4 + ADR-021 Consequences §3: the `trigger` field is encoded in the audit `details` string, NOT in a structured `AuditEntry.payload` field (the existing `AuditEntry` schema has only `details: string`; promoting trigger to a structured field is a deferred post-dashboard idea).

**Required regex parsers:**

```
/trigger=([a-z_]+)/                — Panel 2, Panel 4 (implicit-claim trigger split)
/originatingTool=([a-z_]+)/        — Panel 3 (first-tools/call breakdown)
/priorSessionId=([^,)\s]+)/        — optional; for displacement-target lineage
/priorEpoch=(\d+)/                 — optional; for displacement-detail
/newEpoch=(\d+)/                   — optional; for displacement-detail
/wasCreated=(true|false)/          — optional; first-contact-vs-reconnect identification on agent_identity_asserted
```

**Reference details-string formats** (mission-40 audit emission sites authoritative):

```
agent_identity_asserted:
  "Agent ${engineerId} identity asserted (wasCreated=${bool})"

agent_session_claimed:
  "Agent ${engineerId} session claimed (trigger=explicit, epoch=${N})"

agent_session_implicit_claim (SSE-subscribe path):
  "Agent ${engineerId} session implicitly claimed (trigger=sse_subscribe, epoch=${N})"

agent_session_implicit_claim (first-tools/call path):
  "Agent ${engineerId} session implicitly claimed (trigger=first_tool_call, epoch=${N}, originatingTool=${name})"

agent_session_displaced:
  "Agent ${engineerId} session displaced (priorSessionId=${id}, priorEpoch=${N}, newEpoch=${N+1}, trigger=${value})"
```

If any future schema evolution changes these formats, the dashboard parser MUST be updated in lockstep. ADR-021 commits the `trigger=...` substring as stable across format evolution; the surrounding prose is not.

---

## Acceptance criteria

The dashboard implementation is complete when:

1. **All four panels** populate correctly against a representative sample of Hub audit data.
2. **Panel 2 split is visible** — both `trigger=sse_subscribe` and `trigger=first_tool_call` lines render independently. A combined metric is NOT acceptable.
3. **Regex parser handles edge cases** — missing `trigger=` substring (legacy / pre-mission-40 audits) skip gracefully; multiple `trigger=` matches in the same `details` use the first match; whitespace + parens around the value handled.
4. **Panel 3 (originatingTool) is queryable** — operators can drill from "first_tool_call rate is high" to "which tools are triggering it" in one click (or one query refinement).
5. **Retirement-criterion documentation** — the dashboard prominently displays brief §10.1 retirement criterion: "Both `trigger=sse_subscribe` and `trigger=first_tool_call` sub-rates must trend to zero before the back-compat hooks can be retired. Operator-determined window for 'trended to zero' (suggest: 2 weeks of zero-rate post-deploy)."

---

## Mission-close baseline (2026-04-22 AEST)

At mission-close, all four signals are at zero entries in the Hub GCS audit log. This is because the Hub container (`ois-hub-local`) still runs pre-T1 code; the Hub-side T1-T4 changes haven't been deployed to the running container yet (closing audit §7.5).

Sampled latest 50 audit entries: zero of any new T1-T4 action. Total audit files in GCS: 4335 (all pre-mission emissions).

Post-deploy expected baseline:
- All sessions emit `agent_identity_asserted` on `register_role` (one per session start; high volume).
- Eager-mode adapters (greg + lily wrappers, both setting `OIS_EAGER_SESSION_CLAIM=1`) emit `agent_session_claimed` with `trigger=explicit`.
- All un-updated adapters (any pre-mission-40 client) emit `agent_session_implicit_claim`. The split between `trigger=sse_subscribe` and `trigger=first_tool_call` depends on whether the un-updated adapter opens SSE first (typical) or makes a tool call first (less common).

---

## Related work

- **Closing audit** §4 (audit-action inventory), §5 (observability surface), §8 (deprecation runway status) — deeper detail on emission sites + payload shapes.
- **ADR-021** Consequences §3 — the structural reason `trigger` is in the `details` string (and the migration trigger to promote it to a typed field).
- **brief §10.1** — the retirement criterion this dashboard makes observable.
- **brief §10.7** — PolicyLoopbackHub parity audit; if Hub and loopback claim/displace audit-emission semantics drift, the integration test guarantees + the dashboard's signal would also drift. Out of mission-40 scope; flagged for post-hardening.
- **idea-122** — `reset_agent` operator affordance. Future operator action; would emit a related family of `agent_session_*` audits that the dashboard could absorb into Panel 4's displacement tracking.

---

## Implementation notes (for whoever builds it)

The Hub doesn't have a dashboarding stack today. Ad-hoc query options:

1. **`gcloud storage` + jq** — quick scripts for one-shot baseline measurements. Slow at 4000+ files; not useful for live dashboards.
2. **`list_audit_entries` MCP tool** — paginated reads (max 500 per page). Useful for live one-off queries from an authenticated agent. Not a streaming dashboard.
3. **Future Hub dashboard infrastructure** — when the Hub adopts a real observability stack (Prometheus / Grafana / similar), this panel spec converts to that stack's query DSL. The regex parser approach maps cleanly to Grafana's `Loki` log-query LogQL or Prometheus relabeling rules.

For the immediate post-mission window (before any dashboard infrastructure exists), the recommendation is a small one-shot script (e.g. `scripts/runway-status.ts`) that runs the four panel queries against `gs://ois-relay-hub-state/audit/` and prints the counts. Not a dashboard but enough to track the deprecation runway by hand. Out of mission-40 scope to author.
