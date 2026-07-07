/**
 * hub-spec-source.ts — U6 HubSpecSource (HCAP-on-PI, seam-arch §1/§5).
 *
 * The CONSUMER half: the spec-SOURCE (fetch the Hub catalog → ToolSpec[]) + the
 * TRIGGER binding. Owns WHEN to refresh the held spec; the control plane owns the
 * reconcile. Thin-shim/consumer forever (not extracted).
 *
 * `refreshFromHub()` replaces the additive `seedToolSurface`: fetch the live
 * catalog (`agent.listTools()` — already tier-filtered + cognitively-enriched by
 * core), map each descriptor → an ENABLED ToolSpec, and `applyConfig` the
 * authoritative set into U1.
 *
 * KF1(b) — the zero-tool POISON guard lives HERE (the source), NOT the converge
 * path: a Hub/catalog FETCH returning UNEXPECTEDLY empty (transport blip /
 * mid-deploy) is an ANOMALY, not an intent to remove every tool → KEEP the prior
 * declared spec + log/escalate; never `applyConfig([])` blindly. (An INTENTIONAL
 * empty spec via a direct `applyConfig([])` is a VALID controller action on a
 * different path — U3/U4 converge it to built-ins-only, no escalation; KF1(a).)
 */
import type { ToolDescriptor } from "@apnex/network-adapter";
import type { ToolControlPlane, ToolSpec } from "./contracts.js";

export interface HubSpecSourceDeps {
  /** fetch the live LLM-facing catalog (core-hydrated: tier-filtered + enriched). */
  fetchCatalog: () => Promise<ToolDescriptor[]>;
  /** the control plane whose declared spec this source refreshes. */
  controlPlane: Pick<ToolControlPlane, "applyConfig" | "listDeclaredConfig">;
  log?: (msg: string) => void;
}

export class HubSpecSource {
  private readonly log: (msg: string) => void;
  constructor(private readonly deps: HubSpecSourceDeps) {
    this.log = deps.log ?? (() => {});
  }

  /** Fetch the Hub catalog → authoritative ToolSpec[] (all enabled) → applyConfig. */
  async refreshFromHub(): Promise<void> {
    const held = () => this.deps.controlPlane.listDeclaredConfig().length;
    let descriptors: ToolDescriptor[];
    try {
      descriptors = await this.deps.fetchCatalog();
    } catch (err) {
      // Fetch fault → keep the prior spec, never wipe (KF1(b) anomaly, fail-closed).
      this.log(
        `[hcap-source] Hub catalog fetch FAILED (${(err as Error)?.message ?? err}) — keeping prior spec (${held()} tools)`,
      );
      return;
    }

    // KF1(b) POISON GUARD: an unexpectedly-empty fetch while we hold tools is a
    // source anomaly, NOT an intent to remove all → keep prior + escalate.
    if (descriptors.length === 0 && held() > 0) {
      this.log(
        `[hcap-source] POISON GUARD — Hub catalog fetch returned EMPTY while ${held()} tools are declared; treating as a fetch anomaly, keeping prior spec (NOT applyConfig([]))`,
      );
      return;
    }

    const spec: ToolSpec[] = descriptors.map((d) => ({
      name: d.name,
      definition: d,
      enabled: true,
    }));
    this.deps.controlPlane.applyConfig(spec);
    this.log(`[hcap-source] refreshed declared spec from Hub: ${spec.length} tools`);
  }
}
