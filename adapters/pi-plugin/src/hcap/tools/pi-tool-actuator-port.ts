/**
 * pi-tool-actuator-port.ts — U5 PiToolActuatorPort (HCAP-on-PI, seam-arch §1/§4).
 *
 * THE sole crossing of the pi `ExtensionAPI` air-gap (A3 Air-Gap): the ONLY unit
 * that imports pi SDK types. MUST NOT reach `AgentHarness.setTools` /
 * `AgentSession.setActiveToolsByName` / any shim internal — only the injected
 * `ExtensionAPI`. It is the SOLE caller of `registerTool`, so its `managedNames`
 * ledger is the robust source for U3's built-in subtraction (active-but-not-managed
 * = pi built-ins + foreign actives, preserved).
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
   * The managedNames ledger — every tool THIS control plane has registered. The
   * built-in-subtraction key: active-but-not-managed = pi built-ins / foreign
   * actives, which U3 preserves. Accumulates across reconciles; reset only on
   * reconnect (a fresh port instance per session).
   */
  private readonly managed = new Set<string>();

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly dispatchCtx: ToolDispatchContext,
  ) {}

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
    };
  }
}
