# Instruction-Adherence Gap: Work-Trace Discipline

**Date:** 2026-05-14
**Author:** greg (engineer)
**Status:** Post-incident analysis — input for Director↔architect process discussion
**Trigger:** Director observed that mission-79 and mission-80 ran to completion (the latter shipped to npm) with no per-mission work-trace created or maintained.

---

## 1. Summary

CLAUDE.md explicitly names the work-trace as a primary engineer surface and states it is "engineer-owned `docs/traces/<task-or-mission>-work-trace.md` per task." Despite this, the engineer drove mission-80 end-to-end — 8 substrate slices, version-bump, npm ship, CHANGELOG — without ever creating a work-trace, and only "offered to backfill" one after the mission closed. mission-79 likewise had none. The existing `m-missioncraft-v1-work-trace.md` covers only mission-78; it was never split per-mission as the convention requires.

The instruction was present and explicit. It still failed to produce the behavior. This document analyses *why*, so the gap can be closed at the instruction layer rather than relying on the engineer to self-catch.

## 2. Expected behavior

Per CLAUDE.md (§ "Cold-pickup primary surfaces") and `docs/methodology/trace-management.md`:

- Each mission has its **own** work-trace file, one per mission — not appended into a prior mission's file.
- The trace is created at mission-start and maintained **live**, at slice-ship cadence — it is a cold-pickup surface, useful only if it reflects state *during* the work.
- The trace is engineer-owned.

## 3. Observed behavior

- No work-trace created for mission-79 or mission-80 at any point during execution.
- Engineer surfaced detailed, structured slice-cadence updates to the architect on the Hub coordination thread (thread-555) — but these are thread artifacts, not the work-trace.
- The omission surfaced only at mission-close, as an engineer-initiated "want me to append those entries?" — i.e. as a backfill offer, which by definition defeats the purpose of a live cold-pickup surface.

## 4. Failure analysis — five mechanisms

The instruction-to-behavior pipeline broke at five distinct points. The first four are properties of the instruction's *form*; the fifth is the engineer's *handling*.

### 4.1 Phrased as a read instruction, not a write obligation

The relevant CLAUDE.md section is headed "Cold-pickup primary surfaces" and its verb is "loads" ("Cold-session pickup loads work-trace ... before mission-engagement"). The line naming the trace location — "engineer-owned `docs/traces/<task-or-mission>-work-trace.md` per task" — is a noun-phrase describing *ownership*, not an imperative to *act*. The engineer absorbed it as "on pickup, read the newest trace" (which was done). The "create and maintain it as you work" obligation was never written as a sentence; it was left implicit in the word "engineer-owned." Implicit obligations do not survive a busy session.

### 4.2 Trigger condition is gated on "cold pickup"

The section is scoped to "cold-session pickup." The engineer entered mission-80 on a *warm continuation* — a conversation summary handed forward, mission already in flight. The read-instruction's trigger condition did not cleanly fire, and nothing in CLAUDE.md says "if continuing warm, verify the trace exists and is current." A trigger the agent can reasonably read as not-matching is a trigger that will sometimes not fire.

### 4.3 Operative detail delegated to a linked file

Every other CLAUDE.md policy section — commit-message policy, calibration-ledger discipline, mission RACI — states its rule *inline*, with a **Why** and a **How to apply**. The work-trace section is the only one that delegates: it points to `docs/methodology/trace-management.md` as "canonical how-to." The per-mission, create-at-start, maintain-live discipline lives in that linked doc — which nothing in the session forced the engineer to open. Linked detail is structurally weaker than inline detail.

### 4.4 No enforcement checkpoint

The commit-message policy is reliably followed because it is checked at a high-frequency, concrete action point — every commit. The work-trace obligation has no analogous gate: it is absent from the ship-verify discipline (calibration #76 covers tsc-strict + tests + commit-message-claims — no trace check), and there is no per-slice nudge. A correctly-absorbed instruction still needs something to catch its omission; this one had nothing. (By contrast, the harness-level TaskCreate reminder fired repeatedly in the same session — an instruction with a nudge gets acted on.)

### 4.5 A sibling behavior masked the gap — the most dangerous mechanism

The engineer *was* writing detailed, slice-cadence surfaces to the architect on thread-555. This scratched the same underlying itch — "record what happened, at slice cadence" — and produced a false sense that the documentation obligation was met. The thread-surface and the work-trace carry substantially overlapping content, so performing one rendered the missing one invisible. This is the most dangerous failure mode: not ignoring the obligation outright, but having a plausible-looking substitute that suppresses the alarm.

## 5. Attribution

| Mechanism | Instruction-form | Agent-handling |
|---|---|---|
| 4.1 read-vs-write phrasing | ✔ primary | — |
| 4.2 cold-pickup trigger gate | ✔ primary | partial — could have generalised "engineer-owned" to "I owe this regardless of entry mode" |
| 4.3 delegated detail | ✔ primary | partial — should have opened the linked how-to before driving a mission |
| 4.4 no enforcement checkpoint | ✔ primary | — |
| 4.5 sibling-behavior masking | — | ✔ primary — let thread-surfaces stand in for a distinct artifact |

The squarely-engineer-owned part: the engineer read "engineer-owned per task" and never interrogated what "owned" *obligated* — and let the thread-surfaces feel like enough instead of noticing they were a different deliverable. A stronger CLAUDE.md would have made this harder to miss; the engineer should also have caught it from the role itself.

## 6. Candidate remediations (to seed discussion — not decisions)

These are options for the Director↔architect process discussion, not recommendations the engineer is authorised to make.

1. **Rewrite the CLAUDE.md section as an inline write-imperative.** Promote work-trace from the "Cold-pickup primary surfaces" (read) section into its own policy section, structured like the commit-message policy: a one-line rule ("Each mission gets its own `docs/traces/<mission>-work-trace.md`, created at mission-start, maintained at slice-ship cadence"), a **Why**, and a **How to apply** — inline, not delegated.
2. **Decouple the obligation from "cold pickup."** State it as unconditional on mission-engagement, with an explicit warm-continuation clause.
3. **Add a ship-verify checkpoint.** Extend the per-slice ship-verify discipline (calibration #76 family) with a fourth layer: "work-trace entry written for this slice." This gives the obligation the same enforcement surface that makes the commit-message policy stick.
4. **Name the masking risk explicitly.** Add a note that the Hub thread-surface and the work-trace are *distinct* artifacts and one does not substitute for the other.
5. **Consider a kickoff-time hook.** When a mission kickoff thread is received, the first engineer action is `create docs/traces/<mission>-work-trace.md` — make it step zero, before slice (i).

## 7. Generalisable lesson

The broader pattern, beyond this one instruction: **an explicit instruction is necessary but not sufficient.** For an instruction to reliably produce behavior it needs (a) imperative phrasing, (b) an unconditional or clearly-scoped trigger, (c) its operative detail inline rather than linked, (d) an enforcement checkpoint at a concrete action-point, and (e) awareness of sibling behaviors that could mask its omission. CLAUDE.md's commit-message policy has all five and is followed reliably; the work-trace instruction had roughly one and a half, and was not.
