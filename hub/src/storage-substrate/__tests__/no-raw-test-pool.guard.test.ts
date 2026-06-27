/**
 * bug-178 re-introduction guard.
 *
 * Every substrate test pool MUST be created via `createTestPool` (from
 * `_pg-test-pool.ts`), which attaches the canonical bug-110 `'error'` handler.
 * A raw `new Pool(...)` in a test has NO handler, so a testcontainer
 * `container.stop()` admin-shutdown (`57P01`) racing its teardown surfaces as an
 * UNHANDLED uncaught exception that fails the whole `vitest (hub)` job — and,
 * because vitest shares workers across files, fails whichever file is running
 * (the cross-file flake that gated merges). This guard fails CI if any
 * substrate test re-introduces a raw `new Pool(`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const HERE = resolve(SELF, "..");
const HUB_ROOT = resolve(HERE, "../../.."); // hub/  (from hub/src/storage-substrate/__tests__)

// bug-178 completion (work-25): scan the WHOLE test tree, not a hand-listed set
// of dirs. A guard whose scan-scope is NARROWER than the defect-class scope
// gives false-green confidence — the partial #381 guard scanned only the 2
// migrated dirs while ~23 other testcontainer test files still held raw pools,
// so it passed while the flake class was wide open (the same false-confidence
// class as a vacuous test). Scanning hub/src + hub/test recursively means ANY
// raw `new Pool(` in ANY test — current or future, in any dir — fails here.
const SCAN_DIRS = [resolve(HUB_ROOT, "src"), resolve(HUB_ROOT, "test")];

function listTestFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // dir may not exist in some checkouts
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out = out.concat(listTestFiles(full));
    } else if (name.endsWith(".test.ts") && full !== SELF) {
      out.push(full); // exclude this guard file (its own text mentions `new Pool(`)
    }
  }
  return out;
}

describe("bug-178 guard — no raw `new Pool` in substrate tests", () => {
  it("every substrate test pool goes through createTestPool (no un-handled raw `new Pool`)", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTestFiles(dir)) {
        const text = readFileSync(file, "utf-8");
        if (/\bnew Pool\s*\(/.test(text)) offenders.push(file);
      }
    }
    expect(
      offenders,
      `Use createTestPool(connStr, label) from _pg-test-pool.ts instead of a raw \`new Pool(\` ` +
        `(it attaches the bug-110 error handler; a raw pool re-introduces the bug-178 57P01 ` +
        `teardown flake). Offending file(s):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
