/**
 * Architect-side cognitive telemetry singleton.
 *
 * Phase 2a ckpt-C bridge (thread-160): surfaces Gemini per-round usage
 * as first-class `llm_usage` events through the shared
 * CognitiveTelemetry sink, so architect-side LLM accounting lands in
 * the same pipe as tool-call telemetry.
 *
 * Used by:
 *   - sandwich.ts  (thread-reply REASON loop)
 *   - director-chat.ts  (session REASON loop)
 *
 * Sink strategy (Phase 2a):
 *   - One structured-JSON console.log per event, prefix `[ArchitectTelemetry]`.
 *   - Cloud Run ingests console output as structured log entries; easy
 *     to grep + eventually route to BigQuery / Cloud Trace without
 *     touching shim code.
 *
 * Follow-ups:
 *   - Persist Virtual Tokens Saved aggregates to GCS / Hub once we
 *     build a cross-session dashboard.
 *   - Optionally expose a sink-override so tests and local dev can
 *     replace the default logger with an in-memory collector.
 */

import { CognitiveTelemetry, type TelemetryEvent } from "@ois/network-adapter";

/**
 * Default sink — structured log line. Cloud Run-friendly.
 *
 * Exported as `architectTelemetrySink` so the architect-side cognitive
 * pipeline (hub-adapter.ts, Phase 2b ckpt-C) can attach its own
 * CognitiveTelemetry middleware to the same log pipe — tool-call
 * telemetry and llm_usage events both land under the `[ArchitectTelemetry]`
 * prefix in Cloud Run logs without touching this module.
 */
export function architectTelemetrySink(event: TelemetryEvent): void {
  try {
    console.log(`[ArchitectTelemetry] ${JSON.stringify(event)}`);
  } catch {
    /* never disturb the LLM loop */
  }
}

/** Internal alias preserving the prior private name for the singleton below. */
const defaultSink = architectTelemetrySink;

/**
 * Singleton — all architect callers share this instance so aggregate
 * counts are consistent and the sink is uniform.
 */
export const architectTelemetry = new CognitiveTelemetry({ sink: defaultSink });

/**
 * Test-only override. Swaps the sink for the current process.
 * Returns a reset function that restores the default sink.
 */
export function _setArchitectTelemetrySink(
  sink: (event: TelemetryEvent) => void,
): () => void {
  // Internal: Object.defineProperty-ish hack since `sink` is readonly.
  // Safer approach: export a factory instead. For Phase 2a we only use
  // this in tests; if a stable test API is needed later, promote it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (architectTelemetry as unknown as { sink: typeof sink }).sink = sink;
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (architectTelemetry as unknown as { sink: typeof defaultSink }).sink = defaultSink;
  };
}
