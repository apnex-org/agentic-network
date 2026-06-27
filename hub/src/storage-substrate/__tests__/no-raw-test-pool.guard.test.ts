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

// Dirs that contain testcontainer-backed substrate tests creating pg pools.
const SCAN_DIRS = [
  HERE, // hub/src/storage-substrate/__tests__ (recursive — incl. conformance/)
  resolve(HERE, "../../../test/integration"), // hub/test/integration
];

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
