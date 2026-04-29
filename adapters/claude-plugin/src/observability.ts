/**
 * observability.ts — pure helpers for shim observability formalization.
 *
 * Mission-66 W1+W2 commit 4 (per Design §2.2 + ADR-031 §3, §5; spec
 * `docs/specs/shim-observability-events.md` §3 + §5).
 *
 * Extracted from `shim.ts` so tests can import without triggering the
 * module-init `loadConfig()` side effect (which calls `process.exit(1)`
 * if Hub credentials are absent — fine for runtime, fatal for unit tests).
 */
import type { LogFields } from "@apnex/network-adapter";

// ── Redaction discipline (ADR-031 §5) ────────────────────────────────
//
// Sensitive field names that MUST be redacted before persisting to the
// events file. Defensive — current callers don't pass these, but a future
// field rename could accidentally leak. Whole-key match (case-insensitive);
// any field whose name matches is replaced with `<redacted>`.
export const REDACT_KEYS = new Set([
  "hubtoken",
  "token",
  "authorization",
  "bearer",
  "apikey",
  "api_key",
  "secret",
  "password",
]);

export function redactFields(fields: LogFields): LogFields {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "<redacted>" : fields[k];
  }
  return out as LogFields;
}

// ── Log-level filter (ADR-031 §3; OIS_SHIM_LOG_LEVEL env var) ────────
//
// Levels: DEBUG < INFO < WARN < ERROR. Default INFO. Filter applied at
// FileBackedLogger emit boundary; events tagged with `fields.level` below
// threshold are suppressed (no-op). Events without `level` always emit
// (default INFO behavior — preserves Phase 1 emit semantics).
export const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
export type LogLevel = typeof LOG_LEVELS[number];

export function parseLogLevel(raw: string | undefined): LogLevel {
  const normalized = (raw ?? "").toUpperCase();
  return (LOG_LEVELS as readonly string[]).includes(normalized)
    ? (normalized as LogLevel)
    : "INFO";
}

/**
 * Decides whether an event with optional `level` field should be emitted
 * given the configured threshold. Pure function for unit-test
 * tractability; the shim runtime binds threshold via the
 * `OIS_SHIM_LOG_LEVEL` env var read at module init.
 */
export function shouldEmitLevel(
  eventLevel: string | undefined,
  threshold: LogLevel,
): boolean {
  if (!eventLevel) return true; // unlevelled events always emit (default INFO)
  const idx = LOG_LEVELS.indexOf(eventLevel.toUpperCase() as LogLevel);
  if (idx < 0) return true; // unknown level treated as unlevelled
  const thresholdIdx = LOG_LEVELS.indexOf(threshold);
  return idx >= thresholdIdx;
}
