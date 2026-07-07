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
  /**
   * idea-465 — resolve the Hub's live tool-surface revision (the /health
   * `toolSurfaceRevision` ETag). Captured before each ingest so the CONSUMER-owned
   * applied-revision latch advances ONLY after a successful applyConfig; a
   * failed/kept-prior refresh leaves it behind so the reconciler re-drifts + retries.
   */
  fetchLiveRevision: () => Promise<string | null>;
  /** the control plane whose declared spec this source refreshes. */
  controlPlane: Pick<ToolControlPlane, "applyConfig" | "listDeclaredConfig">;
  log?: (msg: string) => void;
}

export class HubSpecSource {
  private readonly log: (msg: string) => void;
  /**
   * idea-465 — the CONSUMER-owned applied-revision latch: the Hub revision the
   * DECLARED SPEC currently reflects, advanced ONLY after a successful applyConfig
   * (see refreshFromHub). The reconciler reads this via readServedRevision as its
   * level (a pure trigger): live !== lastApplied ⇒ re-emit ⇒ retry, so a failed
   * refresh can never mask a stale surface as converged. null until the first
   * successful ingest (bootstrap).
   */
  private lastAppliedRevision: string | null = null;

  constructor(private readonly deps: HubSpecSourceDeps) {
    this.log = deps.log ?? (() => {});
  }

  /** The Hub revision the declared spec currently reflects (idea-465 level; null pre-bootstrap). */
  getLastAppliedRevision(): string | null {
    return this.lastAppliedRevision;
  }

  /** Fetch the Hub catalog → authoritative ToolSpec[] (all enabled) → applyConfig. */
  async refreshFromHub(): Promise<void> {
    const held = () => this.deps.controlPlane.listDeclaredConfig().length;

    // idea-465: capture the Hub revision we're about to ingest, BEFORE the catalog
    // fetch. lastAppliedRevision is advanced to it ONLY after applyConfig succeeds
    // below — so a failed/kept-prior refresh leaves the latch behind (reconciler
    // re-drifts → retry). Capturing pre-ingest also self-corrects a mid-refresh Hub
    // move: the recorded revision lags the new live → next reconcile re-drifts.
    let revBefore: string | null = null;
    try {
      revBefore = await this.deps.fetchLiveRevision();
    } catch {
      revBefore = null; // no revision resolved → don't advance the latch even on apply-success; retry next tick.
    }

    let descriptors: ToolDescriptor[];
    try {
      descriptors = await this.deps.fetchCatalog();
    } catch (err) {
      // Fetch fault → keep the prior spec, never wipe (KF1(b) anomaly, fail-closed).
      // idea-465: do NOT advance lastAppliedRevision → the reconciler retries next tick.
      this.log(
        `[hcap-source] Hub catalog fetch FAILED (${(err as Error)?.message ?? err}) — keeping prior spec (${held()} tools); applied revision NOT advanced (idea-465 retry)`,
      );
      return;
    }

    // KF1(b) POISON GUARD: an unexpectedly-empty fetch while we hold tools is a
    // source anomaly, NOT an intent to remove all → keep prior + escalate.
    // idea-465: also NOT applied → latch stays behind → the reconciler retries.
    if (descriptors.length === 0 && held() > 0) {
      this.log(
        `[hcap-source] POISON GUARD — Hub catalog fetch returned EMPTY while ${held()} tools are declared; treating as a fetch anomaly, keeping prior spec (NOT applyConfig([])); applied revision NOT advanced (idea-465 retry)`,
      );
      return;
    }

    const spec: ToolSpec[] = descriptors.map((d) => ({
      name: d.name,
      definition: d,
      enabled: true,
    }));
    this.deps.controlPlane.applyConfig(spec);
    // idea-465 advance-on-success: the declared spec now reflects revBefore's Hub
    // surface. If the revision fetch failed (revBefore null) leave the latch behind
    // so the reconciler re-drifts + re-tries the revision next tick.
    if (revBefore !== null) this.lastAppliedRevision = revBefore;
    this.log(
      `[hcap-source] refreshed declared spec from Hub: ${spec.length} tools (revision ${revBefore ?? "unknown"})`,
    );
  }
}
