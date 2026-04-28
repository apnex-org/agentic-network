/**
 * ProposalRepository — StorageProvider-backed Proposal persistence.
 *
 * Mission-47 W5. Replaces `MemoryProposalStore` (state.ts) +
 * `GcsProposalStore` (gcs-state.ts). Implements `IProposalStore`
 * unchanged — all policy callers (proposal-policy, thread cascade)
 * keep working against the same surface.
 *
 * Layout:
 *   proposals/<id>.json   — per-proposal metadata
 *   proposals/<id>.md     — proposal body as Markdown (matches legacy)
 *   meta/counter.json     — shared counter (proposalCounter field)
 */

import type { StorageProvider } from "@apnex/storage-provider";
import { hasGetWithToken, StoragePathNotFoundError } from "@apnex/storage-provider";

import type {
  IProposalStore,
  Proposal,
  ProposalStatus,
  EntityProvenance,
  ProposedExecutionPlan,
  ScaffoldResult,
} from "../state.js";
import type { CascadeBacklink } from "./idea.js";
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function proposalJsonPath(id: string): string {
  return `proposals/${id}.json`;
}

function encodeProposal(p: Proposal): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(p, null, 2));
}

function decodeProposal(bytes: Uint8Array): Proposal {
  return JSON.parse(new TextDecoder().decode(bytes)) as Proposal;
}

class TransitionRejected extends Error {
  constructor(reason: string) {
    super(`transition rejected: ${reason}`);
    this.name = "TransitionRejected";
  }
}

export class ProposalRepository implements IProposalStore {
  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
  ) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "ProposalRepository requires a StorageProvider with atomic read-with-token support",
      );
    }
  }

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
    const proposalRef = `proposals/${id}.md`;

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

    // Metadata blob
    const result = await this.provider.createOnly(
      proposalJsonPath(id),
      encodeProposal(proposal),
    );
    if (!result.ok) {
      throw new Error(
        `[ProposalRepository] submitProposal: counter issued existing ID ${id}; refusing to clobber`,
      );
    }

    // Proposal body as separate Markdown blob — matches legacy layout.
    const md = [
      `# Proposal: ${title}`,
      "",
      `**ID:** ${id}`,
      `**Status:** submitted`,
      `**Summary:** ${summary}`,
      `**Submitted:** ${now}`,
      "",
      "---",
      "",
      body,
    ].join("\n");
    await this.provider.put(proposalRef, new TextEncoder().encode(md));

    console.log(`[ProposalRepository] Proposal submitted: ${id} — ${title}`);
    return { ...proposal };
  }

  async getProposals(status?: ProposalStatus): Promise<Proposal[]> {
    const keys = await this.provider.list("proposals/");
    const out: Proposal[] = [];
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const p = decodeProposal(raw);
      if (status && p.status !== status) continue;
      out.push(p);
    }
    return out;
  }

  async getProposal(proposalId: string): Promise<Proposal | null> {
    const raw = await this.provider.get(proposalJsonPath(proposalId));
    return raw ? decodeProposal(raw) : null;
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
    if (ok) console.log(`[ProposalRepository] Proposal ${proposalId} reviewed: ${decision}`);
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
    if (ok) console.log(`[ProposalRepository] Proposal ${proposalId} closed as implemented`);
    return ok;
  }

  async findByCascadeKey(
    key: Pick<CascadeBacklink, "sourceThreadId" | "sourceActionId">,
  ): Promise<Proposal | null> {
    const keys = await this.provider.list("proposals/");
    for (const path of keys) {
      if (!path.endsWith(".json")) continue;
      const raw = await this.provider.get(path);
      if (!raw) continue;
      const p = decodeProposal(raw);
      if (p.sourceThreadId === key.sourceThreadId && p.sourceActionId === key.sourceActionId) {
        return p;
      }
    }
    return null;
  }

  async setScaffoldResult(proposalId: string, result: ScaffoldResult): Promise<boolean> {
    return this.tryCasUpdate(proposalId, (p) => {
      p.scaffoldResult = result;
      p.updatedAt = new Date().toISOString();
      return p;
    });
  }

  // ── Internal ─────────────────────────────────────────────────────

  private async tryCasUpdate(
    proposalId: string,
    transform: (current: Proposal) => Proposal,
  ): Promise<boolean> {
    const path = proposalJsonPath(proposalId);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const read = await (this.provider as unknown as {
        getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
      }).getWithToken(path);
      if (read === null) return false;
      let next: Proposal;
      try {
        next = transform(decodeProposal(read.data));
      } catch (err) {
        if (err instanceof TransitionRejected) return false;
        throw err;
      }
      try {
        const result = await this.provider.putIfMatch(path, encodeProposal(next), read.token);
        if (result.ok) return true;
      } catch (err) {
        if (err instanceof StoragePathNotFoundError) return false;
        throw err;
      }
    }
    throw new Error(
      `[ProposalRepository] tryCasUpdate exhausted ${MAX_CAS_RETRIES} retries on ${proposalId}`,
    );
  }
}
