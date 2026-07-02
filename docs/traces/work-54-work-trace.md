# work-54 work-trace — Bank-the-Base R4: push-events (idea-357 pts 1-2) — SIZING

**Owner:** greg (engineer, agent-0d2c690e) · **Claimed:** 2026-06-28T02:58 · **Focus:** stint-4 Bank-the-Base · **Rung:** idea-357-pts1-2 · **Gate:** verifier-gate (hub/**)

## MANDATE: sizing-guard FIRST (anchor-specified)
Path-enumerate + size BEFORE building. S/M → build; L → surface for focused-effort/defer (don't cram).

## Scope (idea-357 pts 1-2 = the PUSH half; part 3 list_work ALREADY SHIPPED as #401)
1a. CI-completion / merge-ready events (gating agent passively told CI-green on PR#N).
1b. deploy-rolled / roll-confirm events (prod-rolled-at-sha → resume verification).
2.  WorkItem-FSM transition events (claimed/started/completed/blocked/unblocked/lease-expiry/abandoned) → push-native wake (keep idea-353 digest as interval fallback).

## cal #88 ground-truth (net-new vs exists) — DONE
Emission primitive REUSABLE: `emitAndPush` (message-policy.ts:629-645) = createMessage + dispatch("message_arrived") via pushSelector; system-emitter pattern in triggers.ts:276-287; repo-event dispatch inlines it (message-policy.ts:311-366).

- **1a CI/workflow-run — PARTIALLY WIRED.** workflow-run-completed handler (repo-event-workflow-run-handler.ts:170-200) ALREADY emits an external-injection push-immediate ("<event> succeeded ... head_sha=..."). NET-NEW (small): role/agent targeting (today target:null broadcast) + head_sha→PR# correlation + merge-ready (required-checks) gating. **≈ S.**
- **1b deploy-rolled — ENTIRELY NET-NEW (Hub-side).** Hub has ZERO deploy observation (only passively serves /health gitSha). roll-confirm = an external CI poller (deploy-hub.yml:65-97 curls /health) that posts NOTHING back. Need a new SIGNAL SOURCE (CI POST-back OR Hub /health self-poll) + a new event kind. Infrastructure, not a handler tweak. **+ ENTANGLED with lily's live bug-107 deploy-spine rewrite — building deploy-events on mechanics being changed = shifting ground.**
- **2 WI-FSM transitions — ENTIRELY NET-NEW.** work-item-repository-substrate.ts emits NOTHING (grep: no dispatch/createMessage/emitAndPush); policy layer silent; "work" absent from the TRIGGERS entityType union. NO single choke-point → ~8-9 scattered verb-site hooks (or a new post-CAS wrapper) + extend TRIGGERS + the "dependency-unblocked → wake eligible agent" REVERSE-DEP lookup + eligible-role targeting. **≈ M (biggest driver).**
- **5 idea-353 digest** (the interval-wake to interleave): adapter-side kernel-tick poll (dispatcher.ts:491-567, ~30s) of list_ready_work scopeToCaller; level-triggered ID-keyed dedup in claimable-digest-tracker.ts. **Cross-channel dedup cost**: the dedup baseline lives in the ADAPTER; a Hub SSE push arrives on a DIFFERENT channel → push + next digest tick can double-wake the same id unless they share dedup state. Real design cost.

## SIZE VERDICT: **L** (full parts 1-2)
3 event classes; **2 of 3 net-new at the SOURCE** (deploy has no observation substrate; WI has no emit hook); + cross-channel dedup concurrency + PR-correlation. The Explore gut-size was "M leaning M-L"; the full set leans **L**. Per the sizing-guard → SURFACE, don't cram.

## RECOMMENDED DECOMPOSITION (surfaced to lily 2026-06-28)
- **Part 2 (WI-FSM push-native wake) = the M keystone slice** — highest tele-13 value (queue becomes push-native), one subsystem. The buildable focused slice. Careful bits: the ~8-site emission + reverse-dep-unblock + cross-channel dedup (a concurrency concern — cal #79/#82-class, wants careful context).
- **Part 1b (deploy-rolled) = DEFER** — net-new signal-source infra AND entangled with lily's active bug-107 deploy-spine rewrite. Defer until the spine is hardened (build deploy-events on the hardened mechanics, not shifting ground).
- **Part 1a (CI-targeting) = S refinement** (already broadcast-pushed) — fold into the part-2 slice or defer.

**LEAN:** R4 as a focused effort (part-2 keystone first; 1b post-spine-hardening), given L size + session depth + the cross-channel-dedup subtlety + the 1b deploy-entanglement. Offer to build the part-2 slice now if lily prefers. Her call per the sizing-guard.
