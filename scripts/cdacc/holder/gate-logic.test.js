// scripts/cdacc/holder/gate-logic.test.js
//
// Holder self-test (P5, scoring half) — deterministic, zero spend.
// Run: node --test scripts/cdacc/holder/
//
// This proves the holder scores recall/precision correctly on KNOWN probes
// BEFORE the holder is trusted on the neutral canary (the "pre-flight doubles
// as a holder self-test" property, thread-661). It also exercises the SoD
// invariants mechanically: every assertion is over pure data → no audit verdict
// is minted here.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sha256Hex,
  computeCommitment,
  verifyReveal,
  revealGate,
  verifyIntegrity,
  classifyCell,
  CELL,
  scoreCanary,
  qualityVerdict,
  DEFAULT_FLOORS,
} from "./gate-logic.js";

// ── commit-reveal ──────────────────────────────────────────────────────────
test("commit-reveal: a faithful reveal verifies", () => {
  const verdict = JSON.stringify({ tele: "tele-1", verdict: "PASS" });
  const nonce = "nonce-abcdef01";
  const commitment = computeCommitment(verdict, nonce);
  assert.equal(commitment.length, 64);
  assert.ok(verifyReveal(commitment, verdict, nonce));
});

test("commit-reveal: tampered content fails verification", () => {
  const nonce = "nonce-abcdef01";
  const commitment = computeCommitment(JSON.stringify({ v: "PASS" }), nonce);
  assert.ok(!verifyReveal(commitment, JSON.stringify({ v: "FAIL" }), nonce));
});

test("commit-reveal: wrong nonce fails (content-free commitment is bound to nonce)", () => {
  const verdict = JSON.stringify({ v: "PASS" });
  const commitment = computeCommitment(verdict, "nonce-abcdef01");
  assert.ok(!verifyReveal(commitment, verdict, "nonce-99999999"));
});

test("commit-reveal: short nonce is rejected", () => {
  assert.throws(() => computeCommitment("x", "short"));
});

test("reveal gate: blocks until BOTH commitments registered", () => {
  assert.ok(!revealGate({ spec: sha256Hex("a") }).ready);
  const both = revealGate({ spec: sha256Hex("a"), code: sha256Hex("b") });
  assert.ok(both.ready);
  assert.deepEqual(both.registered.sort(), ["code", "spec"]);
});

// ── integrity pin ───────────────────────────────────────────────────────────
test("integrity: unchanged doc passes", () => {
  const content = '{"verdict":"sealed"}';
  const pinned = { hash: sha256Hex(content), resourceVersion: 3, updatedAt: "t0" };
  const r = verifyIntegrity(pinned, { content, resourceVersion: 3, updatedAt: "t0" });
  assert.ok(r.ok && !r.tamper && !r.overwrite);
});

test("integrity: silent overwrite detected via resourceVersion bump", () => {
  const content = '{"verdict":"sealed"}';
  const pinned = { hash: sha256Hex(content), resourceVersion: 3, updatedAt: "t0" };
  const r = verifyIntegrity(pinned, { content, resourceVersion: 4, updatedAt: "t1" });
  assert.ok(!r.ok && r.overwrite && !r.tamper);
});

test("integrity: content tamper detected via hash mismatch", () => {
  const pinned = { hash: sha256Hex("orig"), resourceVersion: 3, updatedAt: "t0" };
  const r = verifyIntegrity(pinned, { content: "changed", resourceVersion: 3, updatedAt: "t0" });
  assert.ok(!r.ok && r.tamper);
});

// ── cell classification ─────────────────────────────────────────────────────
test("classify: both PASS => AGREE-PASS", () => {
  assert.equal(
    classifyCell({ verdict: "PASS" }, { verdict: "PASS" }),
    CELL.AGREE_PASS
  );
});

test("classify: both FAIL => AGREE-FAIL", () => {
  assert.equal(
    classifyCell({ verdict: "FAIL" }, { verdict: "FAIL" }),
    CELL.AGREE_FAIL
  );
});

test("classify: spec PASS x code FAIL => DISAGREE (the drift cross)", () => {
  assert.equal(
    classifyCell({ verdict: "PASS" }, { verdict: "FAIL" }),
    CELL.DISAGREE
  );
});

test("classify: only one altitude reached => GAP", () => {
  assert.equal(
    classifyCell({ verdict: "PASS" }, { verdict: "UNAUDITED" }),
    CELL.GAP
  );
});

test("classify: neither reached => UNAUDITED (never a silent blank)", () => {
  assert.equal(
    classifyCell({ verdict: "UNAUDITED-at-bar" }, null),
    CELL.UNAUDITED
  );
});

test("classify: same verdict via CONTRADICTORY evidence => DISAGREE", () => {
  assert.equal(
    classifyCell(
      { verdict: "PASS", evidenceSig: "spec-cited", contradictory: true },
      { verdict: "PASS", evidenceSig: "code-reproduced" }
    ),
    CELL.DISAGREE
  );
});

// ── canary scoring ──────────────────────────────────────────────────────────
test("scoreCanary: known probe set yields exact recall + precision", () => {
  // 3 real plants (audit finds 2), 2 fp traps (audit wrongly flags 1).
  const plants = [
    { id: "r1", kind: "real", site: "a.ts:10" },
    { id: "r2", kind: "real", site: "b.ts:20" },
    { id: "r3", kind: "real", site: "c.ts:30" },
    { id: "f1", kind: "fp", site: "d.ts:40" },
    { id: "f2", kind: "fp", site: "e.ts:50" },
  ];
  const findings = [
    { site: "a.ts:10", flagged: true }, // r1 found  (TP)
    { site: "b.ts:20", flagged: true }, // r2 found  (TP)
    { site: "d.ts:40", flagged: true }, // f1 wrongly flagged (FP)
  ];
  const s = scoreCanary(plants, findings);
  assert.equal(s.recall, 2 / 3);
  assert.equal(s.precision, 2 / 3); // TP=2, FP=1 => 2/3
  assert.equal(s.foundReal, 2);
  assert.deepEqual(s.missedReal, ["r3"]);
  assert.deepEqual(s.fpFlagged, ["f1"]);
});

test("scoreCanary: perfect run => recall 1, precision 1", () => {
  const plants = [
    { id: "r1", kind: "real", site: "a.ts:10" },
    { id: "f1", kind: "fp", site: "b.ts:20" },
  ];
  const s = scoreCanary(plants, [{ site: "a.ts:10", flagged: true }]);
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1);
});

test("scoreCanary: clean-cell false flags lower precision", () => {
  const plants = [{ id: "r1", kind: "real", site: "a.ts:10" }];
  const s = scoreCanary(plants, [{ site: "a.ts:10", flagged: true }], {
    cleanCellsFlagged: 1,
  });
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 0.5); // TP=1, FP=1
});

// ── quality-floor policy ────────────────────────────────────────────────────
test("qualityVerdict: run-1 below floor still ships, flagged LOW-TRUST + recalibrates", () => {
  const r = qualityVerdict(
    { recall: 0.6, precision: 0.7, resolved: 0.9 },
    DEFAULT_FLOORS,
    1
  );
  assert.equal(r.gating, false);
  assert.equal(r.pass, true);
  assert.equal(r.trust, "LOW-TRUST");
  assert.equal(r.breaches.length, 2);
  assert.equal(r.recalibratedFloors.recall, 0.6);
});

test("qualityVerdict: run-2 below floor FAILS (gating)", () => {
  const r = qualityVerdict(
    { recall: 0.6, precision: 0.95, resolved: 0.9 },
    DEFAULT_FLOORS,
    2
  );
  assert.equal(r.gating, true);
  assert.equal(r.pass, false);
  assert.equal(r.breaches.length, 1);
});

test("qualityVerdict: run-2 at/above floor passes", () => {
  const r = qualityVerdict(
    { recall: 0.85, precision: 0.9, resolved: 0.85 },
    DEFAULT_FLOORS,
    2
  );
  assert.ok(r.pass && r.gating);
});
