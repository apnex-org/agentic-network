/**
 * mission-88 W2 cluster-2 — in-flight migration env-var flag (Q4(a) disposition).
 *
 * Per thread-644 R2 architect-ratified CONCUR engineer-lean (α): simple env-var
 * flag mechanism for in-flight migration signalling. Consumed by:
 *   - PendingAction sweeper PAUSE: checks isMigrationInProgress("PendingAction")
 *     at tick-start; skips tick when flag set
 *   - Task WRITE-FREEZE: writers (TaskRepositorySubstrate.submitDirective etc.)
 *     check isMigrationInProgress("Task") at write-boundary; throw
 *     MIGRATION_IN_PROGRESS marker error when flag set
 *
 * Mechanism rationale (thread-644 R2):
 *   - (α) env-var flag — scope-narrow for W2; matches W6 strict-flip env-var
 *     pattern (SUBSTRATE_ENVELOPE_TOLERANT precedent from W0); works for
 *     single-process Hub today
 *   - (β) substrate-level pause-lock SchemaDef — DEFERRED to distributed-Hub
 *     substrate-refactor cycle (idea-200/idea-129 follow-on); outside mission-88 scope
 *   - (γ) LISTEN/NOTIFY events — DEFERRED for same reason
 *
 * Test discipline (architect): "Test isolates flag-mechanism, not runtime
 * cutover behavior" — W2 verifies the helper + runner integration; sweeper
 * and writer integration is W6 strict-flip prep concern.
 */

/**
 * Env-var name for per-kind migration-in-progress flag. Example for kind="Task":
 * `MIGRATION_IN_PROGRESS_Task=true`.
 */
function flagEnvVar(kind: string): string {
  return `MIGRATION_IN_PROGRESS_${kind}`;
}

/**
 * Set the in-flight migration flag for a kind. Called by MigrationRunner.runKind
 * at entry. Idempotent; safe to call multiple times.
 */
export function setMigrationFlag(kind: string): void {
  process.env[flagEnvVar(kind)] = "true";
}

/**
 * Clear the in-flight migration flag for a kind. Called by MigrationRunner.runKind
 * in finally. Idempotent.
 */
export function clearMigrationFlag(kind: string): void {
  delete process.env[flagEnvVar(kind)];
}

/**
 * Check whether a migration is in-flight for a kind. Consumed by:
 *   - PendingAction sweeper (tick-start check; skip tick if true)
 *   - Task writers (write-boundary check; throw MIGRATION_IN_PROGRESS error if true)
 *   - Operator-DX scripts (forensic visibility; not gated)
 *
 * Returns true when the env-var is set to the string "true".
 */
export function isMigrationInProgress(kind: string): boolean {
  return process.env[flagEnvVar(kind)] === "true";
}

/**
 * Marker error class thrown by writers when WRITE-FREEZE is active for a kind.
 * Consumers can detect via `err.name === "MigrationInProgressError"` OR
 * `err instanceof MigrationInProgressError`.
 */
export class MigrationInProgressError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`[MIGRATION_IN_PROGRESS] write to kind=${kind} is frozen during in-flight envelope migration`);
    this.name = "MigrationInProgressError";
    this.kind = kind;
  }
}
