/**
 * mission-83 W4.x.7 — ProposalRepositorySubstrate
 *
 * Substrate-API version of ProposalRepository (mission-47 W5 origin). Per Design
 * v1.3 §5.1 Option Y disposition (B) sibling-pattern. Implements IProposalStore
 * interface UNCHANGED (handler call-sites unchanged).
 *
 * Body-storage carve-out: legacy ProposalRepository writes proposal body MD to
 * proposals/<id>.md as separate file (consumed by document-policy read-tool via
 * proposalRef). Substrate-API is kind+id+JSON (no blob primitive); body MD write
 * is DROPPED in substrate-version. proposalRef field preserved as vestigial
 * (still set on entity for backward-compat surface; reads via document-policy
 * will fail for substrate-stored proposals post-cutover). Body-storage
 * resolution deferred to W5 cutover OR substrate-API extension (kind=
 * "ProposalBody" with proposalId index OR substrate.putBlob primitive).
 *
 * Per-entity logic preserved:
 *   - ID allocation via SubstrateCounter.next("proposalCounter") ("prop-N" shape)
 *   - submitProposal → substrate.createOnly (conflict-on-existing)
 *   - reviewProposal / closeProposal / setScaffoldResult — CAS retry loop via
 *     Design v1.4 getWithRevision + putIfMatch
 *   - closeProposal TransitionRejected gate (not-in-closeable-state → returns false)
 *   - findByCascadeKey — substrate.list with cascade-key filter (proposal_cascade_idx
 *     hot-path per Proposal SchemaDef v2)
 *
 * W4.x.7 — eighth-slice of W4.x sweep after W4.x.6 PendingActionRepositorySubstrate.
 */

import type { HubStorageSubstrate } from "../storage-substrate/index.js";
import type {
  IProposalStore,
  Proposal,
  ProposalStatus,
  EntityProvenance,
  ProposedExecutionPlan,
  ScaffoldResult,
} from "../state.js";
import type { CascadeBacklink } from "./idea.js";
import { SubstrateCounter } from "./substrate-counter.js";

const KIND = "Proposal";
const MAX_CAS_RETRIES = 50;

class TransitionRejected extends Error {
  constructor(reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = "TransitionRejected";
  }
}

export class ProposalRepositorySubstrate implements IProposalStore {
  constructor(
    private readonly substrate: HubStorageSubstrate,
    private readonly counter: SubstrateCounter,
  ) {}

  async submitProposal(
    title: string,
    summary: string,
    body: string,
    correlationId?: string,
    executionPlan?: ProposedExecutionPlan,
    labels?: Record<string, string>,
    backlink?: CascadeBacklink,
    createdBy?: EntityProvenance,
  ): Promise<Proposal> {
    const num = await this.counter.next("proposalCounter");
    const id = `prop-${num}`;
    const now = new Date().toISOString();
    const proposalRef = `proposals/${id}.md`;  // vestigial; substrate-version doesn't write body

    const proposal: Proposal = {
      id,
      title,
      summary,
      proposalRef,
      status: "submitted",
      decision: null,
      feedback: null,
      correlationId: correlationId || null,
      executionPlan: executionPlan || null,
      scaffoldResult: null,
      labels: labels || {},
      sourceThreadId: backlink?.sourceThreadId ?? null,
      sourceActionId: backlink?.sourceActionId ?? null,
      sourceThreadSummary: backlink?.sourceThreadSummary ?? null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    const result = await this.substrate.createOnly(KIND, proposal);
    if (!result.ok) {
      throw new Error(
        `[ProposalRepositorySubstrate] submitProposal: counter issued existing ID ${id}; refusing to clobber`,
      );
    }

    // Body MD write DROPPED — substrate-API has no blob primitive. document-policy
    // proposalRef read-path requires W5 cutover-side update OR substrate-API
    // extension. Reference unused-but-stored: `body` param length tracked for
    // operator-DX/observability (no-op silenced).
    void body;

    console.log(`[ProposalRepositorySubstrate] Proposal submitted: ${id} — ${title}`);
    return { ...proposal };
  }

  async getProposals(status?: ProposalStatus): Promise<Proposal[]> {
    const substrateFilter: Record<string, string> = {};
    if (status) substrateFilter.status = status;
    const { items } = await this.substrate.list<Proposal>(KIND, {
      filter: Object.keys(substrateFilter).length > 0 ? substrateFilter : undefined,
      limit: 500,
    });
    return items;
  }

  async getProposal(proposalId: string): Promise<Proposal | null> {
    return this.substrate.get<Proposal>(KIND, proposalId);
  }

  async reviewProposal(
    proposalId: string,
    decision: ProposalStatus,
    feedback: string,
  ): Promise<boolean> {
    const ok = await this.tryCasUpdate(proposalId, (p) => {
      p.status = decision;
      p.decision = decision;
      p.feedback = feedback;
      p.updatedAt = new Date().toISOString();
      return p;
    });
    if (ok) console.log(`[ProposalRepositorySubstrate] Proposal ${proposalId} reviewed: ${decision}`);
    return ok;
  }

  async closeProposal(proposalId: string): Promise<boolean> {
    const ok = await this.tryCasUpdate(proposalId, (p) => {
      if (p.status !== "approved" && p.status !== "rejected" && p.status !== "changes_requested") {
        throw new TransitionRejected("not in a closeable state");
      }
      p.status = "implemented";
      p.updatedAt = new Date().toISOString();
      return p;
    });
    if (ok) console.log(`[ProposalRepositorySubstrate] Proposal ${proposalId} closed as implemented`);
    return ok;
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Proposal | null> {
    const { items } = await this.substrate.list<Proposal>(KIND, {
      filter: {
        sourceThreadId: key.sourceThreadId,
        sourceActionId: key.sourceActionId,
      },
      limit: 1,
    });
    return items[0] ?? null;
  }

  async setScaffoldResult(proposalId: string, result: ScaffoldResult): Promise<boolean> {
    return this.tryCasUpdate(proposalId, (p) => {
      p.scaffoldResult = result;
      p.updatedAt = new Date().toISOString();
      return p;
    });
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * CAS-update via Design v1.4 getWithRevision + putIfMatch. Returns false on
   * absent OR TransitionRejected. Matches legacy boolean-return contract.
   */
  private async tryCasUpdate(
    proposalId: string,
    transform: (current: Proposal) => Proposal,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const existing = await this.substrate.getWithRevision<Proposal>(KIND, proposalId);
      if (!existing) return false;
      let next: Proposal;
      try {
        next = transform({ ...existing.entity });
      } catch (err) {
        if (err instanceof TransitionRejected) return false;
        throw err;
      }
      const result = await this.substrate.putIfMatch(KIND, next, existing.resourceVersion);
      if (result.ok) return true;
      // revision-mismatch → retry from re-read
    }
    throw new Error(
      `[ProposalRepositorySubstrate] tryCasUpdate exhausted ${MAX_CAS_RETRIES} retries on ${proposalId}`,
    );
  }
}
