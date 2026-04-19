# Hub Test Suite — Patterns & Gotchas

This directory covers the Hub policy layer, entity stores, and E2E workflows. This README captures patterns that are **easy to get wrong** and cost real debugging time. For the Threads 2.0 subsystem design the tests exercise, see `docs/architecture/threads-2.md`.

---

## Layout

- `wave3b-policies.test.ts` — broad policy-layer coverage (tasks, proposals, threads, labels).
- `mission-19/` — M19 label inheritance + P2P dispatch + participant selector.
- `e2e/` — full MCP-over-transport orchestrator tests (foundation, chaos, cascade).
- Per-feature files (`bug-*.test.ts`, `cascade-*.test.ts`) — scoped invariant tests.

Run via `npm test` from `hub/`. All tests use `vitest` and the in-memory stores from `state.ts` / `entities/`.

---

## Pattern 1 — Unique sessionId per `createTestContext`

`createTestContext` defaults `sessionId` to `test-session-${randomUUID().slice(0,8)}` per call. **Do not hard-code a shared sessionId** unless you deliberately want two actors to share an M18 fingerprint (rare; currently no test case wants this).

**Why:** M18 derives `globalInstanceId` partly from `sessionId`. Two `createTestContext` calls with the same sessionId produce colliding fingerprints; the second `registerAgent` call fails with `role_mismatch` or the first Agent record is silently overwritten. This bit us hard before the fix — symptoms were "participant upserted but dispatch still empty" errors that looked like thread-layer bugs.

**If you need a deterministic sessionId** (e.g., cross-test assertions on session state), pass it explicitly: `createTestContext({ sessionId: "sess-arch-001" })`. Just make sure each actor in a multi-agent test has a **distinct** one.

---

## Pattern 2 — M18 enriched handshake for thread participants

Thread dispatches target resolved `agentId`s only (INV-TH27). If a test registers an agent via a bare `register_role({role: "architect"})` without the enriched payload, the thread's participant record won't carry an `agentId`, and reply-dispatch will throw `INV-TH27 violation`.

**Correct pattern:**

```ts
// Helper already in labels.test.ts and wave3b-policies.test.ts:
async function registerCallerAgent(ctx, role, labels) {
  await ctx.stores.engineerRegistry.registerAgent(
    ctx.sessionId,
    role,
    { globalInstanceId: `inst-${ctx.sessionId}`, role, clientMetadata: CLIENT, labels },
  );
}

// Then pair with register_role:
await registerCallerAgent(ctx, "architect", { team: "platform" });
await router.handle("register_role", { role: "architect" }, ctx);
```

`setSessionRole` **alone** is not enough — it populates the session→role map but not the Agent registry. Pair it with `registerAgent` if you're bypassing the MCP handshake.

---

## Pattern 3 — `routingMode: "broadcast"` for tests without a pinned recipient

Post-ADR-016, `create_thread({title, message})` with no `recipientAgentId` **rejects** at the Zod validator (INV-TH28). Tests that just want the thread to persist (e.g., label-inheritance tests) don't have a counterparty yet and must explicitly opt into broadcast:

```ts
await router.handle("create_thread", {
  title: "T",
  message: "M",
  routingMode: "broadcast",
}, ctx);
```

For tests that *do* have a counterparty, pass `routingMode: "unicast"` (default) with `recipientAgentId`. Choosing broadcast when you have a specific target hides dispatch bugs.

---

## Pattern 4 — Reuse `ctx` for same-role actors

If two test steps act as the "same" agent (e.g., architect opens, architect later converges), reuse the same `ctx`. Creating a second architect context with a second `registerAgent` call produces **two Agent records**, and thread turn-resolution by `currentTurnAgentId` won't match the second one.

**Wrong:**
```ts
const archCtx1 = createTestContext({ role: "architect" });
await registerCallerAgent(archCtx1, "architect", {...});
// ...later:
const archCtx2 = createTestContext({ role: "architect" });  // NEW agentId!
await registerCallerAgent(archCtx2, "architect", {...});
await router.handle("create_thread_reply", { threadId, ... }, archCtx2);  // turn-mismatch
```

**Right:** reuse `archCtx1` throughout.

---

## Pattern 5 — E2E orchestrator conveniences

`hub/test/e2e/orchestrator.ts`:

- **`ensureRegistered(role)`** performs M18 enriched handshake automatically. Tests that use the orchestrator don't need to reproduce Pattern 2.
- **`createThread(opts)`** auto-defaults `routingMode: "broadcast"` when `opts.routingMode` is absent. This keeps older tests green without explicit migration; new tests should still be explicit for clarity.
- **Event capture** resolves `engineerIds[]` (plural) and `engineerId` (singular) back to role via the Agent registry, so role-based assertions keep working after the INV-TH27 agentId-first switch.

---

## Pattern 6 — What to assert vs. what not to

**Do assert:**
- Entity state (`task.status`, `thread.convergenceActions`, `bug.status`) via direct store reads.
- Selector shape in `ctx.dispatchedEvents[n].selector` (especially `engineerIds`, `roles`, `matchLabels`).
- Error codes / types on rejected operations (validator errors, gate errors).

**Don't assert:**
- **Role-fallback behavior** — it's gone (ADR-016). Tests asserting the old fallback were deleted; don't re-introduce them.
- **Legacy routingMode names** (`"targeted"`, `"context_bound"`) — GCS read normalizes to new names; in-memory stores never produce them.
- **Implicit pool-broadcast on bare `create_thread`** — that default is now a validator reject; any test expecting silent success is wrong.

---

## Pattern 7 — Deferred / skipped tests

Some blocks are `describe.skip` because they assert Phase 2 cascade behavior under the **old** singular `convergenceAction` shape. They're preserved (not deleted) because the Phase 2 cascade rewrite pending full rollout will resurrect them as `stagedActions: [{kind: "stage", type: "...", payload: {...}}]`. See the in-file `PHASE 2 REWRITE PENDING` comments.

Do not delete these without checking whether the pending work has landed.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `INV-TH27 violation` at reply-dispatch | Participant has no agentId | Use Pattern 2 (enriched handshake) |
| `role_mismatch` at second registerAgent | Shared sessionId collision | Use Pattern 1 (unique sessionIds) |
| `routingMode` Zod reject on bare `create_thread` | Post-ADR-016 validator | Use Pattern 3 (explicit broadcast or pin recipient) |
| Turn-mismatch on second architect reply | Two architect Agent records | Use Pattern 4 (reuse ctx) |
| Dispatch selector has `roles` but not `engineerIds` | Pre-M18 test path | Migrate to enriched handshake |
