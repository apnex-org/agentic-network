/**
 * diff-engine.ts — U2 DiffEngine (HCAP-on-PI, seam-arch §1/§3).
 *
 * Single concern (Law-of-One): a PURE, total, deterministic `declared →
 * ConvergencePlan`. Zero I/O, zero pi types (isolated-deferred-to-slice2) — the
 * sharpest speculative pull, kept pure so Slice-2 is a file-move not a rewrite.
 *
 * KF2 — definition drift: `toRegister` = EVERY declared tool's definition every
 * pass (NOT a name-only diff). `registerTool` is idempotent-by-name and REFRESHES
 * the in-session definition (tool-bridge.ts:117-118), so re-registering all
 * guarantees running-def == declared-def (A2). A name-only diff would miss
 * schema/description drift on an existing name = an A2 violation.
 *
 * The plan is derived PURELY from the declared spec; the built-in-preserving union
 * with the running snapshot is U3's concern (it holds the port). The §4 deregister
 * upgrade (if pi ever ships native remove) adds a `running` argument + a
 * `toDeregister` field here — a one-field extension, blast-radius isolated.
 */
import type { ToolSpec, ConvergencePlan } from "./contracts.js";

export class DiffEngine {
  plan(declared: readonly ToolSpec[]): ConvergencePlan {
    return {
      // KF2: re-register EVERY declared def each pass → definition drift reconciled.
      toRegister: declared.map((s) => s.definition),
      // the desired ENABLED subset (level-2). Absent-from-spec AND enabled:false are
      // both omitted here → not served; they are distinguished ONLY by U1 records.
      desiredActiveNames: declared.filter((s) => s.enabled).map((s) => s.name),
    };
  }
}
