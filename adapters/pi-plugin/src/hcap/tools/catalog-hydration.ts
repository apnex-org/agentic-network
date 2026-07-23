/**
 * catalog-hydration.ts — bug-340 P0 authoritative catalog lifecycle.
 *
 * One hydration may run per exact claimed identity + wire generation. A new
 * identity/wire aborts the prior attempt and, independently of whether the
 * underlying request can be physically cancelled, makes its completion inert
 * through HubSpecSource's final currentness fence.
 */
import type { HubSpecSource } from "./hub-spec-source.js";
import type { PiToolControlPlane } from "./tool-control-plane.js";

export interface CatalogHydrationIdentity {
  agentId: string;
  sessionId: string;
  sessionEpoch: number;
  wireGeneration: number;
}

export interface CatalogReadiness {
  ready: boolean;
  reason: string;
  identityKey?: string;
  toolCount: number;
  revision: string | null;
}

export interface CatalogHydrationDeps {
  getCurrentIdentity: () => CatalogHydrationIdentity | null;
  source: HubSpecSource;
  controlPlane: Pick<PiToolControlPlane, "sync">;
  log?: (msg: string) => void;
}

interface ActiveHydration {
  key: string;
  controller: AbortController;
  promise: Promise<boolean>;
}

export class CatalogHydrationController {
  private readonly log: (msg: string) => void;
  private active: ActiveHydration | null = null;
  private readiness: CatalogReadiness = {
    ready: false,
    reason: "no current claimed identity and ready wire",
    toolCount: 0,
    revision: null,
  };

  constructor(private readonly deps: CatalogHydrationDeps) {
    this.log = deps.log ?? (() => {});
  }

  getReadiness(): CatalogReadiness {
    return { ...this.readiness };
  }

  /** Cancel the active generation and make the dispatch surface fail loud. */
  invalidate(reason: string): void {
    if (this.active) {
      this.active.controller.abort(reason);
      this.log(`[catalog-hydration] cancelled obsolete hydration ${this.active.key}: ${reason}`);
      this.active = null;
    }
    this.setNotReady(reason);
  }

  /**
   * Rehydrate the current authority. Concurrent calls for the same key join the
   * one in-flight promise; a different key cancels/replaces it.
   */
  rehydrateCurrent(reason: string): Promise<boolean> {
    const identity = this.deps.getCurrentIdentity();
    if (!isCompleteIdentity(identity)) {
      this.setNotReady(`cannot hydrate (${reason}): current identity is unclaimed or wire is not ready`);
      return Promise.resolve(false);
    }
    const key = identityKey(identity);
    if (this.active?.key === key) {
      this.log(`[catalog-hydration] joining in-flight hydration ${key} (${reason})`);
      return this.active.promise;
    }
    if (this.active) {
      this.active.controller.abort(`superseded by ${key}`);
      this.log(`[catalog-hydration] superseded hydration ${this.active.key} → ${key}`);
    }

    const controller = new AbortController();
    this.setNotReady(`hydrating authoritative catalog (${reason})`, key);
    const promise = this.run(identity, key, reason, controller.signal).finally(() => {
      if (this.active?.promise === promise) this.active = null;
    });
    this.active = { key, controller, promise };
    return promise;
  }

  private async run(
    identity: CatalogHydrationIdentity,
    key: string,
    reason: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const isCurrent = () => {
      const current = this.deps.getCurrentIdentity();
      return !signal.aborted && isCompleteIdentity(current) && identityKey(current) === key;
    };

    const refreshed = await this.deps.source.refreshFromHub({
      signal,
      isCurrent,
      identityKey: key,
    });
    if (!refreshed.applied || !isCurrent()) {
      if (!signal.aborted) {
        this.setNotReady(
          `authoritative catalog unavailable (${refreshed.reason ?? "obsolete"}; trigger=${reason})`,
          key,
        );
      }
      return false;
    }

    // applyConfig above only mutates the declared spec. Re-check identity before
    // the sole pi actuation boundary, then install the nonempty catalog.
    if (!isCurrent()) return false;
    const outcome = this.deps.controlPlane.sync(`authoritative-${reason}`);
    if (!isCurrent()) return false;
    if (!outcome.converged && !outcome.pending) {
      this.setNotReady(
        `catalog actuation failed (${outcome.klass ?? "unknown"}${outcome.detail ? `: ${outcome.detail}` : ""})`,
        key,
      );
      return false;
    }

    this.readiness = {
      ready: true,
      reason: outcome.pending
        ? "nonempty authoritative catalog installed; host activation observation pending"
        : "nonempty authoritative catalog installed",
      identityKey: key,
      toolCount: refreshed.count,
      revision: refreshed.revision,
    };
    this.log(
      `[catalog-hydration] READY — ${refreshed.count} tools, revision=${refreshed.revision}, identity=${key}`,
    );
    return true;
  }

  private setNotReady(reason: string, identityKeyValue?: string): void {
    this.readiness = {
      ready: false,
      reason,
      ...(identityKeyValue ? { identityKey: identityKeyValue } : {}),
      toolCount: 0,
      revision: null,
    };
    this.log(
      `[catalog-hydration] NOT READY — ${reason}${identityKeyValue ? `; identity=${identityKeyValue}` : ""}`,
    );
  }
}

function isCompleteIdentity(
  value: CatalogHydrationIdentity | null,
): value is CatalogHydrationIdentity {
  return !!value
    && value.agentId.trim().length > 0
    && value.sessionId.trim().length > 0
    && Number.isInteger(value.sessionEpoch)
    && value.sessionEpoch > 0
    && Number.isInteger(value.wireGeneration)
    && value.wireGeneration > 0;
}

export function identityKey(identity: CatalogHydrationIdentity): string {
  return `${identity.agentId}:epoch-${identity.sessionEpoch}:wire-${identity.wireGeneration}:session-${identity.sessionId}`;
}
