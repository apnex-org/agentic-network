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
  scoreResolved,
  qualityVerdict,
  DEFAULT_FLOORS,
  computeFileCommitment,
  verifyProvenance,
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

test("classify: same verdict via CONTRADICTORY evidence (spec-recognized) => DISAGREE", () => {
  assert.equal(
    classifyCell(
      { verdict: "PASS", evidenceSig: "spec-cited", contradictory: true },
      { verdict: "PASS", evidenceSig: "code-reproduced" }
    ),
    CELL.DISAGREE
  );
});

test("classify: CONTRADICTORY recognized by CODE-only also demotes (two-sided, concern A)", () => {
  assert.equal(
    classifyCell(
      { verdict: "PASS", evidenceSig: "spec-cited" },
      { verdict: "PASS", evidenceSig: "code-reproduced", contradictory: true }
    ),
    CELL.DISAGREE
  );
});

test("classify: same verdict, same evidence, no contradiction => AGREE-PASS (no false demote)", () => {
  assert.equal(
    classifyCell(
      { verdict: "PASS", evidenceSig: "same" },
      { verdict: "PASS", evidenceSig: "same" }
    ),
    CELL.AGREE_PASS
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

test("scoreCanary: flag on a HOLDER-HELD known-clean cell lowers precision (concern C)", () => {
  const plants = [{ id: "r1", kind: "real", site: "a.ts:10" }];
  const s = scoreCanary(
    plants,
    [
      { site: "a.ts:10", flagged: true }, // TP
      { site: "z.ts:99", flagged: true }, // FP on a known-clean cell
    ],
    { knownCleanCells: ["z.ts:99"] }
  );
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 0.5); // TP=1, FP=1
  assert.equal(s.precisionProvisional, false);
  assert.deepEqual(s.cleanCellsFlagged, ["z.ts:99"]);
});

test("scoreCanary: flag on an UN-adjudicated cell is reported, not scored (precision provisional)", () => {
  const plants = [{ id: "r1", kind: "real", site: "a.ts:10" }];
  const s = scoreCanary(plants, [
    { site: "a.ts:10", flagged: true }, // TP
    { site: "q.ts:7", flagged: true }, // neither plant nor known-clean
  ]);
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1); // un-adjudicated flag NOT counted as FP
  assert.equal(s.precisionProvisional, true);
  assert.deepEqual(s.unadjudicatedFlags, ["q.ts:7"]);
});

// ── resolution scoring (P7) ─────────────────────────────────────────────────
test("scoreResolved: resolved/(resolved+forwarded) over contested cells", () => {
  const r = scoreResolved([
    { disposition: "reconciled" },
    { disposition: "reconciled" },
    { disposition: "dual-truth" },
    { disposition: "tie-break" },
    { disposition: "escalated" },
  ]);
  assert.equal(r, 0.8); // 4 resolved / 5 contested
});

test("scoreResolved: all escalated => 0 (faked convergence by punting)", () => {
  assert.equal(scoreResolved([{ disposition: "escalated" }, { disposition: "escalated" }]), 0);
});

test("scoreResolved: no contested cells => null", () => {
  assert.equal(scoreResolved([]), null);
  assert.equal(scoreResolved([{ disposition: "not-a-disposition" }]), null);
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

// ── hash-then-publish + provenance (run-2 #86) ──────────────────────────────
test("computeFileCommitment: binds to the published-artifact bytes (== computeCommitment)", () => {
  const published = '{"altitude":"code","verdictVector":"[...]","nonce":"n"}';
  const nonce = "noncewith8plus";
  assert.equal(
    computeFileCommitment(published, nonce),
    computeCommitment(published, nonce)
  );
  // the run-1 defect: a re-serialized in-memory projection has a DIFFERENT hash
  const reSerialized = published.replace(/\s/g, " ") + " ";
  assert.notEqual(
    computeFileCommitment(published, nonce),
    computeFileCommitment(reSerialized, nonce)
  );
});

test("verifyProvenance: happy path — commits before reveals + blobs pinned => ok", () => {
  const r = verifyProvenance({
    commits: { code: { registeredAt: "2026-06-20T06:20:21Z" }, spec: { registeredAt: "2026-06-20T06:50:32Z" } },
    reveals: { code: { blobSha: "aaa", publishedAt: "2026-06-20T07:27:54Z" }, spec: { blobSha: "bbb", publishedAt: "2026-06-20T07:00:11Z" } },
    pinned: { code: { blobSha: "aaa" }, spec: { blobSha: "bbb" } },
  });
  assert.ok(r.ok && r.blobIntegrity && r.noPeek);
});

test("verifyProvenance: run-1 actuals — provenance seal HOLDS (validates the path-b ruling)", () => {
  // commit-spec 06:50 < reveal-spec 07:00 < reveal-code 07:27; both commits content-free + before both reveals
  const r = verifyProvenance({
    commits: { code: { registeredAt: "2026-06-20T06:20:21.901Z" }, spec: { registeredAt: "2026-06-20T06:50:32.770Z" } },
    reveals: { code: { blobSha: "c1", publishedAt: "2026-06-20T07:27:54Z" }, spec: { blobSha: "2163eee8", publishedAt: "2026-06-20T07:00:11Z" } },
    pinned: { code: { blobSha: "c1" }, spec: { blobSha: "2163eee8" } },
  });
  assert.ok(r.ok, "run-1 provenance must hold by timestamp even though the hash binding failed");
});

test("verifyProvenance: blob edited post-pin => blobIntegrity false => NOT ok", () => {
  const r = verifyProvenance({
    commits: { code: { registeredAt: "2026-06-20T06:20:00Z" }, spec: { registeredAt: "2026-06-20T06:50:00Z" } },
    reveals: { code: { blobSha: "aaa", publishedAt: "2026-06-20T07:27:00Z" }, spec: { blobSha: "TAMPERED", publishedAt: "2026-06-20T07:00:00Z" } },
    pinned: { code: { blobSha: "aaa" }, spec: { blobSha: "bbb" } },
  });
  assert.ok(!r.ok && !r.blobIntegrity);
});

test("verifyProvenance: a reveal published BEFORE a commit registered => peek => NOT ok", () => {
  const r = verifyProvenance({
    commits: { code: { registeredAt: "2026-06-20T06:20:00Z" }, spec: { registeredAt: "2026-06-20T07:10:00Z" } }, // spec commit AFTER code reveal
    reveals: { code: { blobSha: "aaa", publishedAt: "2026-06-20T07:00:00Z" }, spec: { blobSha: "bbb", publishedAt: "2026-06-20T07:20:00Z" } },
    pinned: { code: { blobSha: "aaa" }, spec: { blobSha: "bbb" } },
  });
  assert.ok(!r.ok && !r.noPeek);
});
