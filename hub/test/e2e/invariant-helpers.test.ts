/**
 * Self-tests for invariant-helpers.ts (Mission-41 Wave 1 T2).
 *
 * Each `assertInv*` helper has a smoke-test here proving the helper
 * itself runs without crashing in its positive-mode path. These are not
 * invariant tests (those are Wave 2's job — consumers of the helpers);
 * they're helper-correctness tests.
 *
 * TH18/TH19 self-tests assert `InvariantNotYetTestable` is thrown, which
 * proves the stub-scaffold is in place so Wave 2 authors can find the
 * graduation point by grep.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import {
  InvariantNotYetTestable,
  assertInvT4,
  assertInvP1,
  assertInvP2,
  assertInvP4,
  assertInvTH6,
  assertInvTH7,
  assertInvI2,
  assertInvM4,
  assertInvTH18,
  assertInvTH19,
} from "./invariant-helpers.js";

describe("invariant-helpers", () => {
  let orch: TestOrchestrator;

  beforeEach(() => {
    orch = TestOrchestrator.create();
  });

  it("assertInvT4 (task terminal states) runs positive mode without throwing", async () => {
    await expect(assertInvT4(orch, "positive")).resolves.toBeUndefined();
  });

  it("assertInvP1 (architect-only proposal review) runs positive mode", async () => {
    await expect(assertInvP1(orch, "positive")).resolves.toBeUndefined();
  });

  it("assertInvP2 (only-submitted-reviewable) runs positive mode", async () => {
    // negativeReject mode is the gap-surfacing ratchet — not run here.
    await expect(assertInvP2(orch, "positive")).resolves.toBeUndefined();
  });

  it("assertInvP4 (implemented terminal) runs positive mode", async () => {
    await expect(assertInvP4(orch, "positive")).resolves.toBeUndefined();
  });

  it("assertInvTH6 (reply to non-active rejected) runs positive mode", async () => {
    await expect(assertInvTH6(orch, "positive")).resolves.toBeUndefined();
  });

  it("assertInvTH7 (close_thread architect-only) runs positive mode", async () => {
    await expect(assertInvTH7(orch, "positive")).resolves.toBeUndefined();
  });

  it("assertInvI2 (auto-linkage failure non-fatal) runs positive mode", async () => {
    await expect(assertInvI2(orch, "positive")).resolves.toBeUndefined();
  });

  it("assertInvM4 (mission terminal states) runs positive mode", async () => {
    await expect(assertInvM4(orch, "positive")).resolves.toBeUndefined();
  });

  it("assertInvTH18 graduated (positive mode runs without throwing)", async () => {
    // Graduated from stub by Mission-41 Wave 2 task-337.
    await expect(assertInvTH18(orch, "positive")).resolves.toBeUndefined();
  });

  it("assertInvTH19 graduated (positive mode runs without throwing)", async () => {
    // Graduated from stub by Mission-41 Wave 2 task-338.
    await expect(assertInvTH19(orch, "positive")).resolves.toBeUndefined();
  });
});
