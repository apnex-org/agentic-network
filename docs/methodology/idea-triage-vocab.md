# Idea Triage Vocabulary + Disposition Buckets

**Source:** idea-363 (M-Idea-Funnel-Triage-Cadence) · stint-4 Bank-the-Base (selection substrate)
**Companion to:** `idea-survey.md` (Director-intent Survey) · `strategic-review.md` (Idea Triage Protocol) · `ledger-reconciliation.md`

The org's binding generative-health constraint is **incorporation, not generation** (~14 ideas/stint generated vs ~1/stint incorporated; 248 open ideas; best arcs age out ~2.5mo). This doc defines the tag vocabulary + disposition buckets the standing post-stint triage cadence stamps, so idea-cohort hygiene is mechanized rather than held in Director memory.

The instrument is `get_backlog_health` (the incorporation-constraint readout, read at gate-points) + `update_idea addTags` (additive tag stamping — never clobbers prior tags).

## Triage tags (stamped via `update_idea addTags`)

Each idea triaged in a post-stint pass gets four `audit:*` tags. `addTags` is additive (union, deduped), so stamping never wipes the idea's existing component/discovery tags.

| Tag family | Values | Meaning |
|---|---|---|
| `audit:value:*` | `high` / `med` / `low` | Strategic value if incorporated (tele-leverage, constraint-relief). |
| `audit:effort:*` | `S` / `M` / `L` / `XL` | Rough build size (the Idea-altitude size estimate; slice decomposition stays in Design). |
| `audit:action:*` | one of the disposition buckets below | What happens to the idea now. |
| `audit:tele_primary:*` | `tele-N` | The single tele the idea most serves (the primary leverage axis). |

Stamp example (additive — preserves existing tags):
`update_idea(ideaId, addTags: ["audit:value:high", "audit:effort:M", "audit:action:design-next", "audit:tele_primary:A13"])`

## Disposition buckets (`audit:action:*`)

Every triaged idea lands in exactly one bucket. Parked items carry a **resurfacing trigger** (recorded as a tag/annotation) so they re-enter the funnel on a condition, not on Director recall.

| Bucket | `audit:action:` value | Meaning + follow-through |
|---|---|---|
| Incorporate now | `incorporate-now` | High-value, ready — promote to Design/Mission this cycle (Architect links via `update_idea missionId`). |
| Design next | `design-next` | Worth doing; queue for the next Design pass (Survey-then-Design). |
| Park with trigger | `park-with-trigger` | Good arc, not now — record a **resurfacing trigger** (e.g. `trigger:after-mission-95`, `trigger:when-substrate-FK-lands`) so it auto-resurfaces. Active-resurface mechanism is a follow-on; MVP records the trigger as a tag/annotation. |
| Fold | `fold` | Subsumed by another idea/mission — link to the parent (`addTags: ["folded-into:idea-NNN"]`); status → dismissed with a pointer. |
| Drop | `drop` | No longer relevant — status → dismissed. |

## Reading the funnel (`get_backlog_health`)

`get_backlog_health` computes server-side over the full Idea collection (accurate counts + tiny payload; not a fat capped `list_ideas` survey). Read it at gate-points:

- `funnel` — open / triaged / dismissed / incorporated / total counts.
- `openAgeHistogram` (lt1w / 1to4w / 1to3mo / gt3mo) + `oldestOpenAgeDays` — the "best arcs age out" signal.
- `stuckInTriage` — triaged + mission-unlinked + age > `staleWeeks` (default 3): the ready-but-unactioned backlog. These are the highest-leverage triage targets (already vetted, just not promoted).
- `incorporation` — `inFlight : incorporated` ratio. > 1 means the backlog is outpacing incorporation (the binding constraint widening).
- `truncated` — honest flag if any status bucket hit the 500-row scan cap.

**Scope note:** `get_backlog_health` is IDEAS-ONLY. Bug-ledger hygiene is `reconcile.py`'s domain (don't duplicate → drift). Mission-funnel health is a noted future extension.

## RACI (process — Architect/Director-owned, not engineer-built)

The standing post-stint triage **cadence** (when it runs, who runs it), the actual **disposition judgments** on each idea cohort, and the **park-with-trigger** discipline are Architect/Director-altitude process — they *use* the tools above. The engineer-built substrate is the `get_backlog_health` verb + the `addTags` mode + this vocabulary.
