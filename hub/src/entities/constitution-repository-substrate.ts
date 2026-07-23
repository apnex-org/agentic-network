/**
 * constitution-repository-substrate.ts — mission-103 P3-S1: the
 * ConstitutionSnapshot + OrgCharter stores (design v1.0 §1).
 *
 * ConstitutionSnapshot: singleton-row CAS. The swap IS the commit point —
 * a deploy roll at any moment mid-sync leaves the prior good snapshot
 * serving (roll-durable by construction, not by recovery). History rows are
 * best-effort (createOnly `snap-<sha>`; their loss never blocks the swap).
 *
 * OrgCharter: append-only versions. createOnly on the counter-issued next id
 * is the atomicity primitive (the GrantRatification precedent) — there is no
 * update path, so "append-only" is enforced by the absence of code, and the
 * charter-authority contract tests pin it.
 */
import { createHash } from "node:crypto";
import type {
  AxiomManifestEntry,
  CharterBinding,
  ConstitutionProvenance,
  ConstitutionSnapshot,
  IConstitutionStore,
  IOrgCharterStore,
  OrgCharter,
} from "./constitution.js";
import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import { SubstrateCounter } from "./substrate-counter.js";
import { decodeEnvelopeToFlat } from "./shape-helpers.js";
import { DecisionTransitionRejected } from "./decision-repository-substrate.js";

const SNAPSHOT_KIND = "ConstitutionSnapshot";
const CHARTER_KIND = "OrgCharter";
const CURRENT_ID = "current";
const MAX_CAS_RETRIES = 20;

export function manifestHashOf(manifest: AxiomManifestEntry[]): string {
  return createHash("sha256").update(JSON.stringify(manifest), "utf8").digest("hex");
}

function cloneFlat<T>(row: T, kind: string): T {
  return decodeEnvelopeToFlat(row as unknown as Record<string, unknown>, kind) as unknown as T;
}

export class ConstitutionRepositorySubstrate implements IConstitutionStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    /** Staleness threshold for provenance honesty (10× cadence class). */
    private readonly opts: { sourceRepo: string; staleAfterMs: number } = { sourceRepo: "unknown", staleAfterMs: 600_000 },
  ) {}

  async getCurrent(): Promise<ConstitutionSnapshot | null> {
    const row = await this.substrate.get<ConstitutionSnapshot>(SNAPSHOT_KIND, CURRENT_ID);
    return row ? cloneFlat(row, SNAPSHOT_KIND) : null;
  }

  async swapSnapshot(
    candidate: Omit<ConstitutionSnapshot, "id" | "status" | "createdAt" | "updatedAt">,
    expectedCurrentSha?: string | null,
  ): Promise<ConstitutionSnapshot> {
    const nowISO = new Date().toISOString();
    const normalized = { ...candidate, lastVerifiedAt: candidate.lastVerifiedAt ?? candidate.syncedAt };
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<ConstitutionSnapshot>(SNAPSHOT_KIND, CURRENT_ID);
      if (!existing) {
        if (expectedCurrentSha !== undefined && expectedCurrentSha !== null) {
          throw new Error(`[ConstitutionRepository] swapSnapshot expected current sha ${expectedCurrentSha}, but no snapshot exists`);
        }
        const next: ConstitutionSnapshot = {
          ...normalized,
          id: CURRENT_ID,
          status: "active",
          createdAt: nowISO,
          updatedAt: nowISO,
        };
        const created = await this.substrate.createOnly(SNAPSHOT_KIND, next);
        if (created.ok) {
          await this.retainHistory(next);
          console.log(`[ConstitutionRepository] first snapshot committed: sha=${next.sha} (${next.manifest.length} axioms)`);
          return next;
        }
        continue; // lost the create race → re-read and validate the winner
      }

      const prior = cloneFlat(existing.entity, SNAPSHOT_KIND);
      // Concurrent instances may fetch the SAME changed candidate. The first swap
      // wins; the loser observes the byte-identical committed snapshot and returns
      // it idempotently — no second history row or content rewrite.
      if (prior.sha === normalized.sha) {
        if (prior.manifestHash !== normalized.manifestHash) {
          throw new Error(`[ConstitutionRepository] sha ${normalized.sha} already serves with a different manifestHash`);
        }
        return prior;
      }
      // A candidate is valid only against the current snapshot observed before
      // fetch-all. If another instance advances the singleton, never overwrite it
      // with bytes fetched from an older HEAD/current pair.
      if (expectedCurrentSha !== undefined && prior.sha !== expectedCurrentSha) {
        throw new Error(`[ConstitutionRepository] swapSnapshot current sha changed: expected ${expectedCurrentSha ?? "none"}, actual ${prior.sha}`);
      }
      const next: ConstitutionSnapshot = {
        ...normalized,
        id: CURRENT_ID,
        status: "active",
        createdAt: prior.createdAt,
        updatedAt: nowISO,
      };
      const result = await this.substrate.putIfMatch(SNAPSHOT_KIND, next, existing.resourceVersion);
      if (result.ok) {
        await this.retainHistory(prior, "superseded");
        console.log(`[ConstitutionRepository] snapshot swapped: ${prior.sha} → ${next.sha} (${next.manifest.length} axioms)`);
        return next;
      }
    }
    throw new Error(`[ConstitutionRepository] swapSnapshot exhausted ${MAX_CAS_RETRIES} CAS retries`);
  }

  /**
   * Verification-only health update. The successful HEAD observation is bound
   * to `expectedSha` on every CAS attempt. It cannot refresh a concurrently
   * swapped snapshot, cannot change content identity, and creates no history.
   */
  async markVerified(expectedSha: string, verifiedAt: string): Promise<"verified" | "sha_mismatch" | "not_synced"> {
    const verifiedMs = Date.parse(verifiedAt);
    if (!Number.isFinite(verifiedMs)) throw new Error(`[ConstitutionRepository] invalid verifiedAt: ${verifiedAt}`);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<ConstitutionSnapshot>(SNAPSHOT_KIND, CURRENT_ID);
      if (!existing) return "not_synced";
      const prior = cloneFlat(existing.entity, SNAPSHOT_KIND);
      if (prior.sha !== expectedSha) return "sha_mismatch";
      const priorVerifiedMs = Date.parse(prior.lastVerifiedAt ?? prior.syncedAt);
      if (Number.isFinite(priorVerifiedMs) && priorVerifiedMs >= verifiedMs) return "verified";
      const next: ConstitutionSnapshot = {
        ...prior,
        lastVerifiedAt: verifiedAt,
        updatedAt: verifiedAt,
      };
      const result = await this.substrate.putIfMatch(SNAPSHOT_KIND, next, existing.resourceVersion);
      if (result.ok) return "verified";
    }
    throw new Error(`[ConstitutionRepository] markVerified exhausted ${MAX_CAS_RETRIES} CAS retries for sha ${expectedSha}`);
  }

  /** Best-effort history retention — never blocks or fails the swap. */
  private async retainHistory(snapshot: ConstitutionSnapshot, status: "active" | "superseded" = "active"): Promise<void> {
    try {
      await this.substrate.createOnly(SNAPSHOT_KIND, { ...snapshot, id: `snap-${snapshot.sha}`, status });
    } catch (e) {
      console.warn(`[ConstitutionRepository] history retention failed for snap-${snapshot.sha} (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
  }

  buildProvenance(snapshot: ConstitutionSnapshot): ConstitutionProvenance {
    // Legacy rows have no lastVerifiedAt. Falling back to syncedAt preserves the
    // old stale-honest behavior until a successful unchanged HEAD check upgrades
    // health; it never fabricates freshness on read.
    const lastVerifiedAt = snapshot.lastVerifiedAt ?? snapshot.syncedAt;
    const ageMs = Math.max(0, Date.now() - Date.parse(lastVerifiedAt));
    return {
      sourceRepo: this.opts.sourceRepo,
      sha: snapshot.sha,
      syncedAt: snapshot.syncedAt,
      lastVerifiedAt,
      manifestHash: snapshot.manifestHash,
      stale: ageMs > this.opts.staleAfterMs,
      ageSeconds: Math.round(ageMs / 1000),
    };
  }
}

export class OrgCharterRepositorySubstrate implements IOrgCharterStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async getCurrentCharter(): Promise<OrgCharter | null> {
    // Full-kind scan with loud truncation (the audit-10069 completeness rule):
    // charter versions accrete at amendment pace — hundreds would themselves
    // be an anomaly worth loud failure over silent wrong-version serving.
    const { items } = await this.substrate.list<OrgCharter>(CHARTER_KIND, { limit: 500 });
    if (items.length >= 500) {
      throw new DecisionTransitionRejected("OrgCharter scan truncated at 500 rows — cannot guarantee the current version (investigate the version pileup)");
    }
    if (items.length === 0) return null;
    const flat = items.map((c) => cloneFlat(c, CHARTER_KIND));
    return flat.reduce((a, b) => (b.charterVersion > a.charterVersion ? b : a));
  }

  async bindAxiom(input: {
    axiom: string;
    predecessor?: string | null;
    status?: CharterBinding["status"];
    supersedes?: string | null;
    ratifiedBy: string;
    proofRef: string;
  }): Promise<OrgCharter> {
    // Self-reference guard: a binding cannot be its own lineage.
    if (input.predecessor === input.axiom || input.supersedes === input.axiom) {
      throw new DecisionTransitionRejected(`bind_axiom rejected: ${input.axiom} cannot reference itself as predecessor/supersedes (self-reference guard)`);
    }
    return this.appendVersion((current) => {
      const bindings = [...(current?.bindings ?? [])];
      const liveIdx = bindings.findIndex((b) => b.axiom === input.axiom && b.status === "bound");
      const status = input.status ?? "bound";
      if (liveIdx >= 0 && status === "bound" && !input.supersedes) {
        throw new DecisionTransitionRejected(`bind_axiom rejected: ${input.axiom} already has a live binding (ratified by ${bindings[liveIdx].ratifiedBy}) — supersede it explicitly or unbind first`);
      }
      if (liveIdx >= 0 && input.supersedes) {
        bindings[liveIdx] = { ...bindings[liveIdx], status: "superseded" };
      }
      bindings.push({
        axiom: input.axiom,
        predecessor: input.predecessor ?? null,
        ratifiedBy: input.ratifiedBy,
        proofRef: input.proofRef,
        ratifiedAt: new Date().toISOString(),
        status,
        supersedes: input.supersedes ?? null,
      });
      return { bindings };
    });
  }

  async amendCharter(input: {
    section: "vision" | "directorProfile";
    text: string;
    ratifiedBy: string;
    proofRef: string;
  }): Promise<OrgCharter> {
    return this.appendVersion(() => ({
      [input.section]: {
        text: input.text,
        ratificationRef: `${input.ratifiedBy}:${input.proofRef}`,
        amendedAt: new Date().toISOString(),
      },
    }));
  }

  /** The single append primitive: read current → apply patch → createOnly a
   *  counter-issued version row. charterVersion IS the counter value — unique
   *  and monotonic by construction, so `getCurrentCharter` (max version) is
   *  always well-defined. Writers are rail-serialized in practice (charter
   *  mutation exists ONLY as decision-plan effects, executed sequentially per
   *  resolve); the counter keeps even a pathological concurrent resolve from
   *  ever producing two rows claiming the same version. Old rows are never
   *  written again by any code path — append-only by absence of code. */
  private async appendVersion(patch: (current: OrgCharter | null) => Partial<OrgCharter>): Promise<OrgCharter> {
    const current = await this.getCurrentCharter();
    const num = await this.counter.next("orgCharterCounter");
    const nowISO = new Date().toISOString();
    const next: OrgCharter = {
      id: `ocharter-${num}`,
      charterVersion: num,
      supersedes: current?.id ?? null,
      bindings: current?.bindings ?? [],
      vision: current?.vision ?? null,
      directorProfile: current?.directorProfile ?? null,
      createdAt: nowISO,
      updatedAt: nowISO,
      ...patch(current),
    };
    const result = await this.substrate.createOnly(CHARTER_KIND, next);
    if (!result.ok) {
      throw new Error(`[OrgCharterRepository] appendVersion: counter issued existing id ${next.id}`);
    }
    console.log(`[OrgCharterRepository] charter v${next.charterVersion} appended (${next.id}, supersedes ${next.supersedes ?? "none"})`);
    return next;
  }
}
