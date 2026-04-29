/**
 * Canonical kind=note payload schema — mission-66 #41 STRUCTURAL ANCHOR closure.
 *
 * Defines the canonical wire shape for `kind=note` Message payloads + a
 * validate function that lands at the canonical repository write-path
 * (`messageRepository.createMessage`) per Design §2.1.4 v0.2 fold (engineer
 * round-1 audit Q8 STRUCTURAL ANCHOR fold; thread-422). Reject-mode default
 * canonical (Director ratification 2026-04-29; Calibration #48 coordinated-
 * upgrade discipline).
 *
 * ## Why anchor at the write-path (not MCP entry-point)
 *
 * Per thread-422 round-1 audit Q8 finding: schema-validate at MCP-entry-only
 * catches LLM-callers but NOT Hub-internal emit paths (director-notification-
 * helpers + triggers.ts trigger-mediated emissions); reject-mode at MCP entry
 * leaves bilateral-blind class persistent for Hub-internal emitters — exactly
 * the surface Director sees most (trigger-fired notifications). Repository-
 * write-path anchor catches BOTH classes at the same canonical substrate gate.
 *
 * ## Failure modes
 *
 * - **LLM-caller** (via `create_message` MCP): validation error propagates
 *   through MCP layer with diagnostic message; caller sees error nack
 * - **Hub-internal emitter** (via direct `messageRepository.createMessage`):
 *   throws `NoteSchemaValidationError` at the write-path; defective emitter
 *   loudly fails (correct invincibility-class behavior — no silent degradation)
 *
 * ## Canonical shape (architect-ratified 2026-04-29 thread-428)
 *
 * - `body: string` — REQUIRED; human/LLM-readable rendered text
 * - All other fields optional + permissive (consumers ignore unknown);
 *   in-namespace evolution preserved per ADR-031 §6.1
 *
 * Producers compose `body` inline at emit-site from their structured fields;
 * structured metadata (severity, source, sourceRef, title, details, missionId,
 * reviewId, transition, directive) rides along as optional context.
 */

export interface NoteSchemaValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validate a payload against the canonical kind=note schema.
 *
 * Returns `{ valid: true }` if the payload is shape-valid; otherwise
 * `{ valid: false, errors: string[] }` with diagnostic messages. Pure
 * function; safe to call from LLM-MCP-entry handlers, Hub-internal helpers,
 * or repository write-path code paths.
 */
export function validateNotePayload(payload: unknown): NoteSchemaValidationResult {
  const errors: string[] = [];

  if (payload === null || payload === undefined) {
    errors.push("payload is required for kind=note (got null/undefined)");
    return { valid: false, errors };
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    errors.push(`payload must be a plain object for kind=note (got ${Array.isArray(payload) ? "array" : typeof payload})`);
    return { valid: false, errors };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.body !== "string") {
    if (p.body === undefined) {
      errors.push("payload.body is required (string) for kind=note — emitters compose body from structured fields per architect-ratified canonical shape (mission-66 #41 STRUCTURAL ANCHOR)");
    } else {
      errors.push(`payload.body must be string (got ${typeof p.body})`);
    }
  } else if (p.body.length === 0) {
    errors.push("payload.body must be non-empty string");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}

/**
 * Thrown by repository-write-path schema-validate when a kind=note payload
 * fails canonical-shape validation. Hub-internal emitters that pass invalid
 * payloads see this thrown synchronously; LLM-callers see the error message
 * nacked back through the MCP entry-point.
 */
export class NoteSchemaValidationError extends Error {
  constructor(
    public readonly errors: readonly string[],
    public readonly payloadPreview?: unknown,
  ) {
    super(`kind=note payload validation failed: ${errors.join("; ")}`);
    this.name = "NoteSchemaValidationError";
  }
}

/**
 * Repository-write-path entry-point — throws `NoteSchemaValidationError` if
 * payload is invalid. Called from `messageRepository.createMessage` per the
 * STRUCTURAL ANCHOR closure path. Reject-mode default canonical (Director
 * ratification 2026-04-29; no warn-grace).
 */
export function assertValidNotePayload(payload: unknown): void {
  const result = validateNotePayload(payload);
  if (!result.valid) {
    throw new NoteSchemaValidationError(result.errors ?? ["unknown validation error"], payload);
  }
}
