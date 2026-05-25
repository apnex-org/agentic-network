# m-k8s-envelope-w10-ext-m18-occ-discipline-design

**Mission:** mission-88 M-K8s-Envelope Wave W10-extension — substrate-hardening pre-W11-re-cutover
**Status:** v0.1 WORKING DRAFT
**Anchor:** bug-127 (Hub M18 assertIdentity OCC contention exceeded retry budget on concurrent-session registration; major)
**Author:** architect (lily) driving via PR-direct
**Director-ratification:** (D) TOLERANT-bridge + W7-W10 + W11 clean re-cutover (ratified 2026-05-24)

---

## 1. Problem

During mission-88 W6 Phase B incident response (2026-05-24), architect attempted to acquire identity via direct MCP curl bypass (M18 enriched `register_role` with `name=lily`) while the actual lily shim was running and bound to `agent-40903c59`. Hub returned:

```
{"ok":false,"code":"role_mismatch","message":"OCC contention exceeded retry budget on assertIdentity for fingerprint=40903c59d19feef1d67c455499304c194ebdec82df78790c3ceaac92bd1d84be; likely concurrent registration storm."}
```

Multiple retries with backoff failed identically. The `role_mismatch` FATAL_CODE classification would HALT any normal shim observing this response (per `handshake.js` FATAL_CODES = ["agent_thrashing_detected", "role_mismatch"]).

**Symptom-impact:** bypass tool could not acquire identity → could not perform turn-bound writes (create_thread_reply, create_thread, create_message reply-kind) → architect coordination during incident-response window forced to note-kind workaround (which doesn't require turn-binding).

## 2. Root cause (source-verified)

`hub/src/entities/agent-repository-substrate.ts:328` — `assertIdentity` retry loop:

```typescript
// Two attempts: natural + retry on OCC contention. Matches legacy budget.
for (let attempt = 0; attempt < 2; attempt++) {
  // ... lookup, optionally create, optionally putIfMatch ...
}
// Both attempts lost the OCC race.
return {
  ok: false,
  code: "role_mismatch",   // ← FATAL_CODE; would halt shim
  message: `OCC contention exceeded retry budget...`,
};
```

**Three composing defects:**

**(D1) Retry budget too narrow.** `attempt < 2` = 2 total attempts. Two concurrent callers lose with probability ~50% per round; two rounds = ~25% combined-success probability. For a normal shim + bypass-tool pair, this is too tight.

**(D2) Wrong error classification.** Transient OCC contention maps to `role_mismatch` FATAL_CODE. The caller (shim or bypass tool) sees a fatal code and halts/aborts — exactly wrong for a retry-eligible failure.

**(D3) No backoff/jitter.** Retries immediately re-attempt with no delay. Under contention, this guarantees lockstep collision on the second attempt.

## 3. Pattern context — sibling of bug-97 Counter-collision

Per memory `feedback_counter_collision_substrate_defect_pattern` (mission-83 W5.4 bug-97):

> Substrate Counter abstraction's issue-then-createOnly isn't atomic across concurrent callers; 11-kind defect surface; per-repo retry-loop OR Counter-level advisory-lock OR postgres-sequence per kind.

bug-127 is an INSTANCE of this broader pattern at the Agent-identity layer. Same root architectural class: substrate primitives that need strong CAS semantics under concurrent contention fall back to per-callsite retry-loops with insufficient budget.

**Methodology-level finding (Phase 10 calibration capstone material):** every substrate-primitive that uses OCC-with-retry-budget should be audited against the pattern (budget-width + backoff + error-classification + observability of contention events). Not just Agent + Counter.

## 4. Architectural decision

### (α) Multi-defect fix at assertIdentity (minimum required for W7-W10)

- (D1) Widen retry budget: `attempt < 8` (exponential backoff: 0ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1000ms with jitter ±20%)
- (D2) New error code `occ_contention_exhausted` (NOT in FATAL_CODES) — caller-retry-eligible
- (D3) Add randomized jitter between attempts (above)
- Add observability: per-fingerprint contention counter (logged + emitted to Tele) for capacity-planning

**Pros:** surgical; closes bug-127 without architectural redesign; engineer-implementable in single PR.

**Cons:** doesn't address (β) the broader Counter-collision pattern across substrate primitives.

### (β) Substrate-layer OCC primitive — advisory-lock-or-sequence per fingerprint

Generalize: any substrate primitive that needs strong-CAS-under-contention uses a `withAdvisoryLock(key, fn)` helper that wraps fn in postgres advisory-lock. Eliminates OCC retry races at the substrate-layer.

**Pros:** systemic fix; eliminates the entire pattern-class; composes with bug-97 fix and any future similar surfaces.

**Cons:** substantial scope; needs Phase 4 Design-pass; not justified for W7-W10 timebox.

### (γ) True displacement-safe rebinding

The session-policy.ts docstring claims "displacement-safe session rebinding". Verify whether this is implemented as documented OR whether it's aspirational. If implemented, the failure mode should be the OLD session's lease being released atomically when new session asserts → no contention. If aspirational, file as TODO + (α) is the interim.

### Recommendation: (α) for W10-ext timebox; (β) as post-mission-88 idea; (γ) verify first

(α) closes bug-127 cleanly. (β) is the right systemic answer for the OCC-class-substrate-defect pattern — file as M-Substrate-OCC-Primitive idea post-mission-88 (composes with bug-97 fix retrospective).

(γ) is an investigation: verify the displacement-safe claim and either confirm-it-works (downgrade my repro to "feature unintended") or upgrade-the-fix-scope.

## 5. Concrete diff sketch

```typescript
// hub/src/entities/agent-repository-substrate.ts:328
- // Two attempts: natural + retry on OCC contention. Matches legacy budget.
- for (let attempt = 0; attempt < 2; attempt++) {
+ // Multi-attempt with exponential backoff + jitter (bug-127 fix).
+ const RETRY_DELAYS_MS = [0, 10, 25, 50, 100, 250, 500, 1000];
+ for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
+   if (attempt > 0) {
+     const baseDelay = RETRY_DELAYS_MS[attempt];
+     const jitter = baseDelay * (0.8 + Math.random() * 0.4);  // ±20%
+     await new Promise(r => setTimeout(r, jitter));
+   }
    // ... existing lookup + create/update logic ...
  }
  // All attempts lost the OCC race.
+ // Emit observability: per-fingerprint contention event
+ recordContentionEvent({ fingerprint, attempts: RETRY_DELAYS_MS.length, kind: 'Agent' });
  return {
    ok: false,
-   code: "role_mismatch",
+   code: "occ_contention_exhausted",
    message: `OCC contention exceeded retry budget on assertIdentity for fingerprint=${fingerprint}; ${RETRY_DELAYS_MS.length} attempts with backoff.`,
  };
```

Plus:
- Add `"occ_contention_exhausted"` to known-error-codes (NOT in FATAL_CODES per `handshake.js`)
- Adapter-side: handle the new code as retry-eligible (separate adapter PR; composes with W10 dispatcher audit)

## 6. Composition

- **W7-W9** — orthogonal (substrate kind/index layer)
- **W10 (bug-126)** — composes — adapter-side handling of the new `occ_contention_exhausted` error code must land for full restoration. Coordinate via single adapter-rebuild.
- **bug-97 (mission-83 W5.4)** — sibling pattern instance; both inform Phase 10 retrospective calibration on the OCC-class-substrate-defect pattern.

## 7. Architect-asks (Design-pass round)

1. **(α) retry budget shape** — agree to 8-attempt exponential-backoff-with-jitter? Alternative: 5-attempt linear, 10-attempt log-spaced, time-bounded (max 2000ms total) — engineer judgment on prod-shape.

2. **New error code semantics** — `occ_contention_exhausted` correct? Alternative: `transient_unavailable` (HTTP-503-style generic) — lean: specific to substrate-OCC class for diagnosability.

3. **Adapter-side composition with W10** — single adapter PR fixes both bug-126 dispatcher + bug-127 new-error-code handling, or separate? Lean: single PR for atomicity.

4. **(γ) displacement-safe claim verification** — does engineer want to lead this investigation or defer to (β) substrate-OCC-primitive scope? Lean: engineer-side quick-verify (15-30min grep + read), then proceed with (α) regardless.

## 8. Test plan

- [ ] Unit: assertIdentity with mock-substrate that simulates OCC loss N times before success — verify recovery within budget
- [ ] Unit: assertIdentity with all-attempts-lose — verify return code is `occ_contention_exhausted`, NOT `role_mismatch`
- [ ] Unit: backoff timing verification (jitter range)
- [ ] Integration: spin up real Hub + 2 concurrent fingerprint-bind clients → both succeed (one creates, one updates) within budget
- [ ] Repro test: 2026-05-24 architect-bypass scenario — direct curl bypass + active shim → bypass acquires identity within budget
- [ ] Observability: contention event emitted + visible in Tele/log on contention threshold cross

## 9. Acceptance criteria

- bug-127 repro: architect bypass tool can acquire lily identity even when lily shim is concurrently registered
- New error code `occ_contention_exhausted` defined + adapter-side handled as retry-eligible (NOT fatal-halt)
- Backoff + jitter shipped
- Observability emits contention events (Tele or log)
- (γ) displacement-safe claim either verified-correct or filed as TODO with sub-bug

## 10. Out of scope (deferred)

- (β) Substrate-layer OCC primitive (`withAdvisoryLock`) — file as post-mission-88 M-Substrate-OCC-Primitive idea (composes with bug-97 retrospective)
- Counter-collision audit beyond Agent + Counter kinds — same idea scope
- Per-fingerprint serialization via postgres LISTEN/NOTIFY — out of W10-ext scope; engineer judgment whether to upgrade to (β)
- Adapter-side retry-with-backoff for `occ_contention_exhausted` (vs immediate-retry) — file as adapter-side affordance idea

## 11. Links

- **bug-127** (major; bypass-tool comms blocker; mission-88 W10-extension anchor)
- **mission-88** (active)
- Sibling waves: W7 #284, W8 #285, W9 #286, W10 #287
- **bug-97** (resolved; mission-83 W5.4; Counter-collision substrate-defect pattern parent)
- File references: `hub/src/entities/agent-repository-substrate.ts:313` (assertIdentity), `:328` (retry loop), `:472` (OCC error return); `hub/src/policy/session-policy.ts:129` (call-site); `apnex-claude-plugin/.../handshake.js` (FATAL_CODES classification)
- Memory reference: `feedback_counter_collision_substrate_defect_pattern`
