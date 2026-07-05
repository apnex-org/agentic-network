/**
 * mission-102 design §6 — CONTRACT TEST 5 (G2-BINDING): verdict-spoof rejects.
 * (B8-R2 / work-129, from steve's audit-10226: the guards existed — bug-204 /
 * bug-220(b) — but no EXPLICIT §6 contract suite named them. This file is that
 * suite: every spoof vector against the verifier-verdict evidence path, in one
 * greppable place, against the REAL predicate.)
 *
 * The vectors, per the design + the work-129 runbook:
 *   5a wrong Hub-stamped ACTOR — an engineer-authored audit bound as a verdict
 *      must reject (author-anchor: metadata.actor is Hub-derived from the
 *      registered session role; producedBy is caller-supplied and never trusted);
 *   5b wrong RELATED-ENTITY — a genuine verifier audit about a DIFFERENT entity
 *      must reject (relate: existence alone is theatre, audit-4103 #1);
 *   5c STALE producedAt — verdict evidence minted before the CURRENT lease's
 *      claimedAt must reject (freshness: a verdict from before the work was
 *      even claimed cannot vouch for it — the bug-219/220 re-claim discipline);
 *   5d ACTORLESS audit — no Hub-stamped actor fails closed;
 *   5e the CONTROL — a verifier-authored, item-related, post-claim verdict
 *      audit closes the requirement (the template every slice today used).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import type { EvidenceItem, EvidenceRequirement } from "../work-item.js";

const STALE = "2000-01-01T00:00:00.000Z";

describe("CONTRACT TEST 5 (G2-BINDING): verdict-spoof rejects — design §6, B8-R2", () => {
  let substrate: ReturnType<typeof createMemoryStorageSubstrate>;
  let repo: WorkItemRepositorySubstrate;

  beforeEach(() => {
    substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  });

  /** A raw envelope Audit row: relatedEntity in spec, Hub-stamped actor in
   *  metadata (exactly the shape audit-policy persists). */
  async function mkAudit(id: string, relatedEntity: string, actor?: string): Promise<void> {
    await substrate.createOnly("Audit", {
      apiVersion: "core.ois/v1", kind: "Audit", id,
      metadata: actor ? { actor } : {},
      spec: { action: "verifier_valid_verdict", details: "d", relatedEntity },
      status: {},
    });
  }

  /** create → claim → start an item with ONE refResolvable review requirement
   *  (the standard verifier-verdict shape every slice item carries). */
  async function started(agent: string) {
    const reqs: EvidenceRequirement[] = [{ id: "verdict", kind: "review", refResolvable: true, description: "verifier verdict audit" }];
    const w = await repo.createWorkItem({ type: "task", roleEligibility: [], evidenceRequirements: reqs });
    const claimed = await repo.claimWorkItem(w.id, agent);
    const token = claimed!.lease!.token;
    await repo.startWork(w.id, agent, token);
    return { id: w.id, token, claimedAt: claimed!.lease!.claimedAt };
  }

  function verdictEv(ref: string, producedAt?: string): EvidenceItem {
    return {
      requirementId: "verdict", kind: "audit", ref,
      producedAt: producedAt ?? new Date().toISOString(),
      producedBy: "agent-f148389d",
    } as EvidenceItem;
  }

  it("5a: an audit with the WRONG Hub-stamped actor (engineer self-verdict) REJECTS — producedBy claims count for nothing", async () => {
    const w = await started("agent-5a");
    await mkAudit("audit-5a", w.id, "engineer"); // related + fresh, but a worker self-close
    await expect(repo.completeWork(w.id, "agent-5a", w.token, [verdictEv("audit-5a")]))
      .rejects.toThrow(/was not authored by a verifier/);
    // ...and the caller-supplied producedBy naming a real verifier changed nothing
    // (the evidence above already claimed the verifier's agentId).
  });

  it("5b: a GENUINE verifier audit about a DIFFERENT entity REJECTS (relate — existence is not relevance)", async () => {
    const w = await started("agent-5b");
    await mkAudit("audit-5b", "work-99999", "verifier"); // verifier-authored, wrong subject
    await expect(repo.completeWork(w.id, "agent-5b", w.token, [verdictEv("audit-5b")]))
      .rejects.toThrow(/does not RELATE/);
  });

  it("5c: a verdict with STALE producedAt (before the current lease claimedAt) REJECTS (freshness)", async () => {
    const w = await started("agent-5c");
    await mkAudit("audit-5c", w.id, "verifier"); // perfectly valid audit row...
    await expect(repo.completeWork(w.id, "agent-5c", w.token, [verdictEv("audit-5c", STALE)])) // ...bound with a pre-claim stamp
      .rejects.toThrow(/failed freshness/);
  });

  it("5d: an ACTORLESS audit fails closed (no Hub stamp = no verdict)", async () => {
    const w = await started("agent-5d");
    await mkAudit("audit-5d", w.id); // no metadata.actor
    await expect(repo.completeWork(w.id, "agent-5d", w.token, [verdictEv("audit-5d")]))
      .rejects.toThrow(/was not authored by a verifier/);
  });

  it("5e CONTROL: a verifier-authored, item-related, post-claim verdict audit closes the requirement", async () => {
    const w = await started("agent-5e");
    await mkAudit("audit-5e", w.id, "verifier");
    const done = await repo.completeWork(w.id, "agent-5e", w.token, [verdictEv("audit-5e")]);
    expect(done!.status).toBe("done");
  });

  it("5f: every spoof attempt leaves the item UN-CLOSED (in_progress) — a failed verdict never partially binds", async () => {
    const w = await started("agent-5f");
    await mkAudit("audit-5f-eng", w.id, "engineer");
    await mkAudit("audit-5f-far", "work-88888", "verifier");
    for (const ev of [verdictEv("audit-5f-eng"), verdictEv("audit-5f-far"), verdictEv("audit-5f-eng", STALE)]) {
      await expect(repo.completeWork(w.id, "agent-5f", w.token, [ev])).rejects.toThrow();
    }
    const row = await repo.getWorkItem(w.id);
    expect(row!.status).toBe("in_progress");
    expect(row!.evidence).toHaveLength(0); // nothing persisted from the failed attempts
  });
});
