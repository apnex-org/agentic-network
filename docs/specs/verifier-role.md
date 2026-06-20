# Verifier role — definition + scope contract

**Status:** v0.1 DRAFT — awaiting Director ratification. Source: idea-330 (Director-ratified 2026-06-20) → mission-93 (M-Verifier-Role). Born from CDACC run-1's headline finding (the org is *precision-trustworthy but recall-blind* — it cannot see its own blind spots, and same-lineage agreement is a hedge, not corroboration). Serves tele-8 (Gated Recursive Integrity), tele-9 (Chaos-Validated Resilience), tele-13 (Director Intent Amplification). First holder: **Steve** (GPT-5.5 / OpenCode — a deliberately *cross-lineage* model so its blind spots decorrelate from the Anthropic-lineage producers).

This is the **architect deliverable that blocks the engineer Hub-enum work** on mission-93. §2 is the implementable contract; §4 is the Hub surface; §6 lists the points needing Director ratification before deploy.

---

## §1 The VERIFY leg

The org has three legs today and is adding a fourth:

| Leg | Role | Altitude | Produces |
|---|---|---|---|
| **INTEND** | Director | intent | what matters + the final decision |
| **SPECIFY** | Architect | map | the spec / design / methodology |
| **BUILD** | Engineer | territory | the code / artifact |
| **VERIFY** | **Verifier** | independent check | *evidence* that map matches territory matches intent |

The verifier is **orthogonal** to the other three: it does not intend, specify, or build — it **independently certifies or refutes** what the others claim. Its value is *decorrelation*: a cross-lineage verifier has blind spots that do not overlap the producers', so it catches the class the producers structurally cannot self-catch (the recall-blind class).

**Two load-bearing invariants:**

1. **Advisory, not gating.** The verifier surfaces independent evidence; it does **not** hold a veto. The Director decides (tele-13 authority-non-delegation). A verifier verdict is an input to a gate, never the gate itself. This keeps the verifier from becoming a bottleneck or an unaccountable authority.
2. **Refute-not-produce, by construction.** The verifier defaults to *checking*, not *building*. It has no produce surface (no `create_mission` / `create_task` / `propose_mission` / `create_proposal`). A party that produces what it later verifies is conflicted; removing the produce surface makes the independence structural rather than a matter of discipline.

---

## §2 Scope contract (the implementable core)

The verifier's surface separates **PUSH** (what wakes it) from **READ** (what it can see) from **WRITE** (how it surfaces findings). The cross-talk symptom observed during Steve's bring-up ("Steve sees non-directed architect traffic") is precisely a *blanket role-subscription* artifact — so the contract fixes it **by construction** by giving the verifier no broad push subscription at all.

### §2.1 PUSH scope — directed-only (own-scope; NARROW)

A verifier wakes **only** on events where it is an *explicit, resolved recipient*. It is **never** added to a role-broadcast / role-fan selector.

Verifier-directed pushes (the complete wake set):
- **`thread_message`** where the verifier is a resolved `thread.participants[]` member (it was invited into the thread, or replied into it) — i.e. someone *directed* a verification dialogue at it.
- **`review_requested`** / a verification or audit assignment explicitly targeted at the verifier.
- **`pulse`** whose target role is `verifier` (mission/coordination pulses addressed to it).
- **`director_notification`** addressed to the verifier.
- **`pending_action`** items owed *by* the verifier (so `drain_pending_actions` stays honest).

Explicitly **NOT** pushed to the verifier:
- role-broadcast / role-fan traffic scoped to `architect` or `engineer` (this is the cross-talk source — eliminated by never fanning to `roles=[verifier]` broadly and never co-subscribing the verifier to another role's scope);
- informational presence/lifecycle events (`agent_state_changed`, etc.) — same disposition as every other role: log-only, never a wake;
- producer-cascade events (`task_issued`, `mission_created`, `proposal_submitted`, …) for work the verifier is not a participant in.

**Net:** the verifier is *directed to verify* — it wakes when someone asks it to, and is otherwise quiet.

### §2.2 READ scope — broad (pull; architect-equivalent)

To audit anything, the verifier needs to *see* everything — but via **pull**, not push. The verifier has **architect-equivalent read visibility** across the full read surface:
- `get_*` (thread / mission / proposal / review / task / bug / idea / tele / turn / document / clarification)
- `list_*` (missions / threads / proposals / reviews / tasks / bugs / ideas / tele / audit_entries / documents)
- `get_metrics`, `list_audit_entries`, `get_engineer_status`

This is the asymmetry that makes the role work: **broad READ, narrow PUSH.** The verifier can reach into any entity it chooses to audit, but nothing floods it unbidden.

### §2.3 WRITE scope — finding-surfacing only (NO produce surface)

The verifier's output is *findings*. It may write **only** the primitives that surface findings or participate in verification dialogue:
- **`create_review`** — structured verdict on a reviewable artifact.
- **`create_audit_entry`** — durable record of an independent check.
- **`create_thread` / `create_thread_reply` / `leave_thread`** — participate in verification dialogue (raise a concern, red-team, converge a verification thread).
- **`drain_pending_actions` / `ack_message`** — settle its own owed actions / satisfy pulses (pulse = ACK, not note).
- **`create_bug`** — file a defect it discovers *(proposed addition — see §6).*
- **`create_idea`** — surface an improvement / risk it discovers *(proposed addition — see §6).*

**Denied (the produce surface):** `create_mission`, `create_task`, `propose_mission`, `create_proposal`, `update_mission`, `create_clarification`-as-producer, and any cascade-producing action. The verifier drives **no** work; it certifies or refutes the work others drive.

### §2.4 Independence / recusal discipline

Independence is structural (no produce surface), but one soft edge remains: a verifier may legitimately *participate* in a thread (e.g. red-team a design in flight). If a verifier materially shapes an artifact, it **recuses** from later certifying that same artifact — it defaults to checking, not co-authoring. Stated as discipline because the Hub cannot mechanically detect "materially shaped." The cross-lineage holder makes this rare in practice (Steve isn't in the producers' design loops).

---

## §3 RACI placement — the verifier engages at verification points

The verifier is **not** a per-phase R/A holder; it is an advisory leg that engages at *verification points* and surfaces evidence to the Accountable party (usually the Director, via the architect per the mediation invariant). Placement (added to `mission-lifecycle.md` §1.5.2):

| Verification point | Verifier engagement |
|---|---|
| **Phase 4 Design** | C — adversarial red-team of a design before ratification (optional; on request) |
| **Phase 6 Preflight** | C — independent check of structural-elimination claims (the calibration-#83 discipline) |
| **Phase 7 Release-gate** | C — independent pre-ship verification; evidence advisory to the Director's `status=active` ratification |
| **Phase 8 Execution** | C — convergence red-team; drift / normative audit (CDACC altitudes) |
| **Phase 10 Retrospective** | C — verifies the retrospective's claims rather than trusting the producer's self-report |

In every cell the verifier is **C (Consulted)** — never R or A. Findings route to the Director (and architect), never direct-to-engineer mechanics (mediation invariant §5.3 holds). The Director remains Accountable at every gate.

---

## §4 Hub mechanics (engineer — what to implement, once this contract is ratified)

Spec-level pointers (engineer holds the code ground-truth):
1. **Role enum** — add `verifier` to the accepted roles: `register_role` validation + the `Role` type (`state.ts`) + the adapter handshake accept-list (`hub-networking.ts:493`, currently `architect | engineer | director`).
2. **PUSH selector** — do **not** add `verifier` to any broadcast / role-fan selector. The verifier receives events only through *explicit participant/recipient resolution* (thread participant, review assignee, pulse target, directed notification). This is the whole of §2.1 — it is mostly an act of *omission* (never fan to `roles=[verifier]`), which is why it fixes the cross-talk cleanly.
3. **READ RBAC** — grant `verifier` the §2.2 read surface (architect-equivalent).
4. **WRITE RBAC** — grant `verifier` the §2.3 finding-surfacing primitives; **deny** the produce surface.

---

## §5 Deploy + first holder (Steve)

- This is **Hub code** → a manual Hub redeploy = **Director-gated prod-write** (hub-vm; watchtower non-functional). A separate deploy artifact from the OpenCode shim republish (mission-92).
- Path: greg PRs the enum + RBAC → testcontainer test → **Director authorizes the Hub deploy** → Steve's adapter-config `role` flips `architect` → `verifier` (a one-line config change that *rides* the Hub deploy).
- Until then, Steve stays on `architect`-scope interim — which is exactly why he currently sees non-directed architect traffic. The verifier scope is the structural fix for that symptom; the shim dedup (mission-92) is orthogonal (it fixes the informational *flood*, not the cross-talk).

---

## §6 Open ratification points (Director)

1. **Finding-surfacing additions** — idea-330's illustrative primitive list was `create_review` / `create_audit_entry` / thread-participate / `drain_pending_actions` / read surface. This contract adds **`create_bug`** and **`create_idea`** (§2.3): a verifier that finds a defect but cannot file it is hamstrung, and bug/idea are *surfacing*, not *producing* (they don't drive a work-cascade). Confirm these belong in the verifier set.
2. **Advisory-not-gating** — confirm the verifier holds no veto; its verdicts are evidence into Director-held gates (tele-13). (This contract assumes yes.)
3. **Own-push scope** — confirm the narrow directed-only PUSH + broad READ separation (§2.1/§2.2) as the standing verifier scope.

Once ratified, this contract unblocks greg's Hub-enum work on mission-93.

---

**Cross-refs:** idea-330; mission-93; CDACC run-1 drift-map (`docs/cdacc/run-672bd0f/drift-map.md`) §2 (recall-blind); calibration #87 (precision-trustworthy ≠ complete); tele-8 / tele-9 / tele-13; `mission-lifecycle.md` §1.5 (RACI) + §5.3 (mediation invariant); thread-672 (the charter convergence).
