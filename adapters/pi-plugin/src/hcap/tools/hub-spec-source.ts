/**
 * hub-spec-source.ts — U6 HubSpecSource (HCAP-on-PI, seam-arch §1/§5).
 *
 * The CONSUMER half: fetch the current Hub catalog, validate its authority,
 * and atomically replace the held declared spec. It never publishes an empty,
 * identity-less, or obsolete fetch. Reconnect cancellation is cooperative:
 * the network request may still unwind, but the final currentness check makes
 * every superseded result inert before applyConfig.
 */
import type { ToolDescriptor, ResourceSpec } from "@apnex/network-adapter";

export interface HubSpecSourceDeps {
  /** fetch the live LLM-facing catalog (core-hydrated: tier-filtered + enriched). */
  fetchCatalog: () => Promise<ToolDescriptor[]>;
  /** resolve the Hub's live tool-surface revision (/health ETag). */
  fetchLiveRevision: () => Promise<string | null>;
  /** the control plane whose declared spec this source refreshes. */
  controlPlane: {
    applyConfig(spec: readonly ResourceSpec[]): void;
    listDeclaredConfig(): readonly ResourceSpec[];
  };
  log?: (msg: string) => void;
}

export interface HubSpecRefreshGuard {
  /** Cancellation for a superseded identity/wire generation. */
  signal?: AbortSignal;
  /** Same-key predicate checked after every await and immediately before publish. */
  isCurrent?: () => boolean;
  /** Non-secret diagnostic identity (agent/session epoch/wire generation). */
  identityKey?: string;
}

export interface HubSpecRefreshResult {
  applied: boolean;
  count: number;
  revision: string | null;
  reason?: "cancelled" | "identityless" | "revision-unavailable" | "empty" | "invalid-descriptor" | "fetch-failed";
}

export class HubSpecSource {
  private readonly log: (msg: string) => void;
  /** Hub revision represented by the last successfully applied NONEMPTY spec. */
  private lastAppliedRevision: string | null = null;

  constructor(private readonly deps: HubSpecSourceDeps) {
    this.log = deps.log ?? (() => {});
  }

  getLastAppliedRevision(): string | null {
    return this.lastAppliedRevision;
  }

  /** Fetch, validate, and publish one authoritative NONEMPTY catalog. */
  async refreshFromHub(guard: HubSpecRefreshGuard = {}): Promise<HubSpecRefreshResult> {
    const held = () => this.deps.controlPlane.listDeclaredConfig().length;
    const identity = guard.identityKey?.trim() ?? "";
    const obsolete = () => guard.signal?.aborted === true || guard.isCurrent?.() === false;

    // A list_tools result without an exact claimed identity+wire key is not a
    // catalog. This directly rejects the observed sessionId="" startup poison.
    if (!identity) {
      this.log(
        `[hcap-source] CATALOG NOT READY — refusing identity-less hydration; keeping prior spec (${held()} tools)`,
      );
      return { applied: false, count: held(), revision: null, reason: "identityless" };
    }
    if (obsolete()) {
      return { applied: false, count: held(), revision: null, reason: "cancelled" };
    }

    let revision: string | null;
    try {
      revision = await this.deps.fetchLiveRevision();
    } catch {
      revision = null;
    }
    if (obsolete()) {
      this.log(`[hcap-source] obsolete hydration cancelled before catalog fetch (${identity})`);
      return { applied: false, count: held(), revision, reason: "cancelled" };
    }
    if (!revision?.trim()) {
      this.log(
        `[hcap-source] CATALOG NOT READY — live revision unavailable for ${identity}; keeping prior spec (${held()} tools)`,
      );
      return { applied: false, count: held(), revision: null, reason: "revision-unavailable" };
    }

    let descriptors: ToolDescriptor[];
    try {
      descriptors = await this.deps.fetchCatalog();
    } catch (err) {
      this.log(
        `[hcap-source] CATALOG NOT READY — Hub catalog fetch FAILED for ${identity} (${(err as Error)?.message ?? err}); keeping prior spec (${held()} tools)`,
      );
      return { applied: false, count: held(), revision, reason: "fetch-failed" };
    }

    if (obsolete()) {
      this.log(`[hcap-source] obsolete hydration cancelled after catalog fetch (${identity}); result is inert`);
      return { applied: false, count: held(), revision, reason: "cancelled" };
    }

    // Empty is never an authoritative remove-all signal on this ingestion path,
    // INCLUDING cold start (held=0). Intentional empty config remains available
    // only through the separate direct applyConfig controller path.
    if (descriptors.length === 0) {
      this.log(
        `[hcap-source] CATALOG NOT READY — rejected EMPTY Hub catalog for ${identity}; keeping prior spec (${held()} tools), revision NOT advanced`,
      );
      return { applied: false, count: held(), revision, reason: "empty" };
    }

    const names = new Set<string>();
    for (const descriptor of descriptors) {
      const name = typeof descriptor?.name === "string" ? descriptor.name.trim() : "";
      if (!name || name !== descriptor.name || names.has(name)) {
        this.log(
          `[hcap-source] CATALOG NOT READY — rejected identity-less/duplicate tool descriptor for ${identity}; keeping prior spec (${held()} tools), revision NOT advanced`,
        );
        return { applied: false, count: held(), revision, reason: "invalid-descriptor" };
      }
      names.add(name);
    }

    const spec: ResourceSpec[] = descriptors.map((definition) => ({
      name: definition.name,
      definition,
      enabled: true,
    }));

    // Last possible currentness fence. No await exists between this check and
    // applyConfig, so an obsolete generation cannot interleave a publication.
    if (obsolete()) {
      this.log(`[hcap-source] obsolete hydration cancelled at publish fence (${identity}); result is inert`);
      return { applied: false, count: held(), revision, reason: "cancelled" };
    }
    this.deps.controlPlane.applyConfig(spec);
    this.lastAppliedRevision = revision;
    this.log(
      `[hcap-source] refreshed authoritative declared spec from Hub: ${spec.length} tools (revision ${revision}, identity ${identity})`,
    );
    return { applied: true, count: spec.length, revision };
  }
}
