/**
 * nodestate0 — FALSIFIER for the `isSuspended` split (work-bp-nodestate0-impl_seal_mint).
 *
 * THE CONTRACT UNDER TEST: one predicate was serving two opposite purposes.
 *   PROTECTION (`isParkedFromExecution`)  — must own BOTH populations.
 *   DISPOSAL   (`isActivelyWithdrawn`)    — must own ONLY the live attribute.
 *
 * THIS FILE IS WRITTEN TO FAIL if the disposal path starts matching rows the
 * protection path should own, or vice versa. The discriminator case is the LEGACY
 * row, which is the ONLY input on which the two predicates are required to disagree
 * — a test that never exercises it would pass against the unsplit predicate and
 * prove nothing.
 */
import { describe, it, expect } from "vitest";
import {
  isParkedFromExecution,
  isActivelyWithdrawn,
} from "../work-item-repository-substrate.js";

// The three populations. `legacy` is the one bug-424 stranded.
const legacy = { suspended: false, status: "paused" } as const; // phase only — unpause cleared the attribute
const attribute = { suspended: true, status: "ready" } as const; // the current model
const live = { suspended: false, status: "ready" } as const; // not parked at all

describe("nodestate0: isSuspended split by INTENT", () => {
  describe("PROTECTION — isParkedFromExecution owns BOTH populations", () => {
    it("matches a row parked by the ATTRIBUTE", () => {
      expect(isParkedFromExecution(attribute)).toBe(true);
    });

    it("matches a row parked by the LEGACY PHASE", () => {
      // Covering both here is CORRECT: a parked row must not be executed, and which
      // representation it wears is irrelevant to that question.
      expect(isParkedFromExecution(legacy)).toBe(true);
    });

    it("does NOT match a live row", () => {
      expect(isParkedFromExecution(live)).toBe(false);
    });
  });

  describe("DISPOSAL — isActivelyWithdrawn owns ONLY the live attribute", () => {
    it("matches a row someone is CURRENTLY withdrawing", () => {
      expect(isActivelyWithdrawn(attribute)).toBe(true);
    });

    it("🔴 does NOT match the LEGACY row — this is bug-424's deadlock", () => {
      // `unpause` clears the ATTRIBUTE and nothing ever clears the PHASE. If disposal
      // read the phase, this row would be refused abandon FOREVER while nobody is
      // withdrawing it. THIS ASSERTION IS THE ENTIRE POINT OF THE SPLIT.
      expect(isActivelyWithdrawn(legacy)).toBe(false);
    });

    it("does NOT match a live row", () => {
      expect(isActivelyWithdrawn(live)).toBe(false);
    });
  });

  describe("🔴 THE DISCRIMINATOR — the two predicates MUST disagree on the legacy row", () => {
    it("protection says parked, disposal says not-withdrawn, on the SAME input", () => {
      // If a future edit re-conflates them, this is the assertion that reddens.
      // Any predicate pair that agrees on every input has not been split.
      expect(isParkedFromExecution(legacy)).toBe(true);
      expect(isActivelyWithdrawn(legacy)).toBe(false);
      expect(isParkedFromExecution(legacy)).not.toBe(isActivelyWithdrawn(legacy));
    });

    it("and they AGREE everywhere else — the split is surgical, not a rewrite", () => {
      for (const row of [attribute, live]) {
        expect(isParkedFromExecution(row)).toBe(isActivelyWithdrawn(row));
      }
    });
  });

  describe("CONTROL — the fixtures are real and the assertions can fail", () => {
    it("the two populations are genuinely different shapes", () => {
      // Without this, every assertion above could pass vacuously against typos.
      expect(legacy.status).toBe("paused");
      expect(legacy.suspended).toBe(false);
      expect(attribute.status).not.toBe("paused");
      expect(attribute.suspended).toBe(true);
    });
  });
});
