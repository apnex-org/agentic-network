/**
 * clients.ts — sovereign role-typed micro-harnesses (idea-449 §1).
 *
 * A SimClient is a scripted, role-typed WorkGraph client — a stand-in for a seat
 * with NO LLM and NO adapter. It wraps `SimHarness.handle` with a fixed session +
 * seeded role, auto-threads the hoisted `claim_work` leaseToken through every
 * lease-bound verb, and exposes both the well-behaved verbs (claim/start/complete/
 * gate…) and deliberate MISBEHAVIOURS (wrong/absent lease, cross-role) — the
 * adversarial inputs the oracle catalog asserts the FSM rejects.
 */
import type { SimHarness, VerbOutcome } from "./harness.js";
import type { AgentRole, SessionRole } from "hub/dist/state.js";

export class SimClient {
  /** workId → the leaseToken this client holds (captured on claim, cleared on release). */
  private readonly leases = new Map<string, string>();

  private constructor(
    readonly harness: SimHarness,
    readonly sessionId: string,
    readonly role: SessionRole,
    /** distinct agentId when created via a real registerAgent; else the shared anonymous-<role>. */
    readonly agentId: string | undefined,
  ) {}

  /** Create a client bound to a REAL Agent (distinct agentId → holder/WIP isolation). */
  static async create(
    harness: SimHarness,
    sessionId: string,
    role: AgentRole,
    name: string,
  ): Promise<SimClient> {
    const r = await harness.seedAgent(sessionId, role, name);
    const agentId = r.ok ? r.agentId : undefined;
    return new SimClient(harness, sessionId, role, agentId);
  }

  /** Create a role-only client (RBAC satisfied; shares the anonymous-<role> agentId). */
  static roleOnly(harness: SimHarness, sessionId: string, role: SessionRole): SimClient {
    harness.seedRole(sessionId, role);
    return new SimClient(harness, sessionId, role, undefined);
  }

  /** The held leaseToken for a workId (for relocation/attestation assertions). */
  leaseFor(workId: string): string | undefined {
    return this.leases.get(workId);
  }

  /** Raw verb — auto-injects the held leaseToken for `workId` unless the caller set one. */
  async call(verb: string, args: Record<string, unknown> = {}): Promise<VerbOutcome> {
    const workId = args.workId as string | undefined;
    const withLease =
      workId && this.leases.has(workId) && args.leaseToken === undefined
        ? { ...args, leaseToken: this.leases.get(workId) }
        : args;
    return this.harness.handle(this.sessionId, verb, withLease);
  }

  // ── well-behaved verbs ────────────────────────────────────────────────
  async claim(workId: string): Promise<VerbOutcome> {
    const r = await this.call("claim_work", { workId });
    const token = (r.data as Record<string, unknown>)?.leaseToken;
    if (r.ok && typeof token === "string") this.leases.set(workId, token);
    return r;
  }
  start(workId: string): Promise<VerbOutcome> {
    return this.call("start_work", { workId });
  }
  block(workId: string, reason = "sim-block"): Promise<VerbOutcome> {
    return this.call("block_work", { workId, blockedOn: { blockerKind: "external", reason } });
  }
  resume(workId: string): Promise<VerbOutcome> {
    return this.call("resume_work", { workId });
  }
  async release(workId: string): Promise<VerbOutcome> {
    const r = await this.call("release_work", { workId });
    if (r.ok) this.leases.delete(workId);
    return r;
  }
  renew(workId: string): Promise<VerbOutcome> {
    return this.call("renew_lease", { workId });
  }
  complete(workId: string, evidence: readonly unknown[]): Promise<VerbOutcome> {
    return this.call("complete_work", { workId, evidence, frictionReflection: { observed: false, summary: "no friction observed" } });
  }
  abandon(workId: string): Promise<VerbOutcome> {
    return this.call("abandon_work", { workId });
  }
  createWork(args: Record<string, unknown>): Promise<VerbOutcome> {
    return this.call("create_work", args);
  }
  /** verifier gate: attest a work item's evidence (only a [Verifier] client is authorized). */
  attest(workId: string, verdict: "valid" | "invalid" = "valid", reason?: string): Promise<VerbOutcome> {
    return this.harness.handle(this.sessionId, "attest_evidence", {
      workId,
      verdict,
      ...(reason ? { reason } : {}),
    });
  }

  // ── MISBEHAVIOURS (adversarial; the FSM must reject these) ─────────────
  /** A stolen/zombie lease: a lease-fenced verb with a deliberately wrong token. */
  misbehaveWrongLease(verb: string, workId: string, args: Record<string, unknown> = {}): Promise<VerbOutcome> {
    return this.harness.handle(this.sessionId, verb, { workId, leaseToken: "WRONG-LEASE-TOKEN", ...args });
  }
  /** A lease-fenced verb with NO leaseToken (unfenced attempt). */
  misbehaveNoLease(verb: string, workId: string, args: Record<string, unknown> = {}): Promise<VerbOutcome> {
    return this.harness.handle(this.sessionId, verb, { workId, ...args });
  }
  /** Steal another client's held token (relocation-laundering attempt). */
  misbehaveStolenLease(verb: string, workId: string, stolenFrom: SimClient, args: Record<string, unknown> = {}): Promise<VerbOutcome> {
    return this.harness.handle(this.sessionId, verb, {
      workId,
      leaseToken: stolenFrom.leaseFor(workId),
      ...args,
    });
  }
}
