/**
 * file-skill-ledger.ts — FileSkillLedger (hcapskills0 build_claude, invariant 1): the
 * DURABLE backing for the managed-skill ledger. A JSON sidecar the seed bin points at
 * (kept OUTSIDE skillsDir so it never confuses claude's `<name>/SKILL.md` scanner).
 * A fresh headless process each launch reconstructs its managed set from this file.
 *
 * Cold seat: the file is absent → `read()` returns `[]` (created empty on first write).
 * Corrupt ledger: reads as EMPTY (fail-safe) — the actuator re-materializes its desired
 * set + rewrites a clean ledger, and unlinks NOTHING (removal is managed-scoped and the
 * managed set starts empty on an unreadable ledger; orphans are safe, missing skills are
 * not). This is the deliberately-safe failure direction for the coexist firebreak.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SkillLedgerPort } from "./contracts.js";

export class FileSkillLedger implements SkillLedgerPort {
  constructor(private readonly path: string) {}

  read(): string[] {
    if (!existsSync(this.path)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as { managed?: unknown };
      if (!Array.isArray(raw?.managed)) return [];
      return raw.managed.filter((n): n is string => typeof n === "string");
    } catch {
      return [];
    }
  }

  write(names: readonly string[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      `${JSON.stringify({ managed: [...names].sort() }, null, 2)}\n`,
    );
  }
}
