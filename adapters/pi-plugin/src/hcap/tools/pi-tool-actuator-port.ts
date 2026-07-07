/**
 * pi-tool-actuator-port.ts — U5 PiToolActuatorPort (HCAP-on-PI, seam-arch §1/§4).
 *
 * THE sole crossing of the pi `ExtensionAPI` air-gap (A3 Air-Gap): the ONLY unit
 * that imports pi SDK types. MUST NOT reach `AgentHarness.setTools` /
 * `AgentSession.setActiveToolsByName` / any shim internal — only the injected
 * `ExtensionAPI`. It is the SOLE caller of `registerTool`. Its `managedNames` ledger
 * feeds KF5 status + idempotent registration; the built-in preserve-set is the
 * separate `builtinNames` baseline captured at construction (ruling R1).
 *
 * Structurally exposes NO remove verb (implements ToolActuatorPort) — REMOVE is
 * set-subtraction (§4), mirroring the pi ground-truth (ExtensionAPI has
 * registerTool/getActiveTools/getAllTools/setActiveTools and NO tool-remove;
 * confirmed deliberate — provider-unregister exists, tool-deregister does not). If
 * pi ever ships native remove, the §4 upgrade binds it HERE only.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ToolDispatchContext } from "@apnex/network-adapter";
import { buildPiToolDefinition } from "../../tool-bridge.js";
import type {
  RunningSnapshot,
  ToolActuatorPort,
  ToolDefinitionNeutral,
} from "./contracts.js";

export class PiToolActuatorPort implements ToolActuatorPort {
  /**
   * The managedNames ledger — every tool THIS control plane has registered.
   * Accumulates across reconciles (reset only on reconnect); feeds KF5 status (the
   * `managed` flag / absent-but-managed) + the idempotent-register set. It is NO
   * LONGER the preserve-set (ruling R1 dropped the managedNames-subtraction).
   */
  private readonly managed = new Set<string>();

  /**
   * R1 (ruling v0.2.1) — the built-in preserve BASELINE, captured ONCE at
   * construction BEFORE the plane registers/activates anything: pi's active tools
   * here are exactly the built-ins (+ any pre-existing foreign actives). U3 unions
   * this into every desiredActive, so built-ins survive the authoritative REPLACE
   * (T5) BY CONSTRUCTION, while out-of-band ROGUE drift — active but NOT in
   * baseline ∪ enabled — is reverted (T4/A2). Reset only on reconnect.
   *
   * Reconnect caveat (accepted Slice-1 limitation, ruling R1): a process RESTART
   * captures pristine built-ins (correct); a LIVE-process reconnect that retains
   * prior-session Hub actives would over-capture them into baseline (bounded
   * stale-preserve until restart/re-declare). Follow-up tied to the KF4 persistence
   * seam: baseline = getActiveTools()@ctor − persisted managedNames.
   */
  private readonly builtinNames: string[];

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly dispatchCtx: ToolDispatchContext,
  ) {
    // Capture the preserve baseline BEFORE any register()/setActive() by this plane.
    this.builtinNames = [...pi.getActiveTools()];
  }

  register(def: ToolDefinitionNeutral): void {
    // idempotent-by-name refresh; the tool-bridge render is the pi last mile.
    this.pi.registerTool(buildPiToolDefinition(def, this.dispatchCtx));
    this.managed.add(def.name);
  }

  setActive(names: string[]): void {
    // AUTHORITATIVE REPLACE of the whole active set (never union — the removal-bug fix).
    this.pi.setActiveTools(names);
  }

  snapshot(): RunningSnapshot {
    return {
      activeNames: [...this.pi.getActiveTools()],
      managedNames: [...this.managed],
      builtinNames: [...this.builtinNames],
    };
  }
}
