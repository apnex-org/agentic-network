/**
 * harness.ts — the sovereign verb-driver seam (idea-449 Phase A).
 *
 * SimHarness assembles the REAL WorkGraph engine — `PolicyRouter` over a
 * `WorkItemRepositorySubstrate` backed by an in-memory `HubStorageSubstrate`
 * (the same envelope write-path production uses) — and drives it through the
 * production seam `PolicyRouter.handle(verb, args, ctx)`. It NEVER touches the
 * substrate directly and NEVER re-implements the FSM (design-of-record §2.1/§2.2):
 * one FSM, exercised the way `mcp-binding.ts` exercises it in prod.
 *
 * Identity is SEEDED (§2.1): `ctx.role` is the literal "unknown" — the real role
 * is resolved in-handler from the engineer registry, so a session must be seeded
 * via `setSessionRole` (RBAC gate) and, for a distinct agentId, `registerAgent`.
 *
 * Denylist (§4): this REPLICATES `hub/src/policy/test-utils.ts::createTestContext`
 * against the real classes — it does not import it, nor TestOrchestrator, the
 * wave*-policies tests, or invariant-coverage.
 */
import { PolicyRouter } from "hub/dist/policy/router.js";
import { registerWorkItemPolicy } from "hub/dist/policy/work-item-policy.js";
import { registerSystemPolicy } from "hub/dist/policy/system-policy.js";
import { WorkItemRepositorySubstrate } from "hub/dist/entities/work-item-repository-substrate.js";
import { AgentRepositorySubstrate } from "hub/dist/entities/agent-repository-substrate.js";
import { SubstrateCounter } from "hub/dist/entities/substrate-counter.js";
import { type Clock, systemClock } from "hub/dist/entities/clock.js";
import {
  createMemoryStorageSubstrate,
  buildEnvelopeWriteEncoder,
} from "hub/dist/storage-substrate/index.js";
import { createMetricsCounter } from "hub/dist/observability/metrics.js";
import type { IPolicyContext, AllStores, PolicyResult } from "hub/dist/policy/types.js";
import type { AgentRole, RegisterAgentResult, SessionRole } from "hub/dist/state.js";

/** A verb result decoded from the MCP text envelope: `{ ok, data }`. */
export interface VerbOutcome {
  /** false when the router/handler returned `isError` (RBAC deny, transition reject, …). */
  readonly ok: boolean;
  /** the parsed JSON body of the single text content block (or the raw string). */
  readonly data: unknown;
  /** the raw PolicyResult, for assertions that need the envelope shape. */
  readonly raw: PolicyResult;
}

export interface SimHarnessOptions {
  /**
   * Deterministic time source injected into BOTH the substrate repositories and
   * ctx.clock (idea-449 VirtualClock). Defaults to real wall time; pass a
   * `VirtualClock` for byte-identical, reproducible timestamps across runs.
   */
  readonly clock?: Clock;
  readonly log?: (msg: string) => void;
}

/**
 * The real WorkGraph engine, assembled in-memory + headless, driven through the
 * production `PolicyRouter.handle` seam. One per simulation run (isolated store).
 */
export class SimHarness {
  readonly router: PolicyRouter;
  readonly workItem: WorkItemRepositorySubstrate;
  readonly registry: AgentRepositorySubstrate;
  /** The injected time source — shared by the repositories and ctx.clock. */
  readonly clock: Clock;
  private readonly stores: AllStores;
  private readonly metrics = createMetricsCounter();

  constructor(opts: SimHarnessOptions = {}) {
    const substrate = createMemoryStorageSubstrate();
    // The prod envelope write-path — WITHOUT it a write lands unpartitioned and
    // the read-side renameMap can't resolve `status.phase` (would silently break
    // the FSM). This is the single line every real substrate consumer sets.
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    // One clock, shared by both repositories AND ctx.clock (so get_now reports the same
    // source the substrate stamps with). A VirtualClock makes the whole run deterministic.
    this.clock = opts.clock ?? systemClock;
    this.workItem = new WorkItemRepositorySubstrate(substrate, counter, this.clock);
    this.registry = new AgentRepositorySubstrate(substrate, this.clock);
    // The work-item verbs + the router's RBAC/auto-claim only read `workItem` +
    // `engineerRegistry`; other stores are out of this plane. A verb that reaches
    // for an absent store throws at runtime (caught by the sim's oracle), which is
    // the honest signal that the store-set needs widening — never a silent stub.
    this.stores = {
      workItem: this.workItem,
      engineerRegistry: this.registry,
    } as unknown as AllStores;
    // Quiet by default (the hub logs verbosely); pass opts.log to observe.
    this.router = new PolicyRouter(opts.log ?? (() => {}));
    registerWorkItemPolicy(this.router);
    // System-domain reads — brings in the get_now read-verb (idea-525) that reports
    // from ctx.clock. The other cross-domain reads here touch stores the sim omits, but
    // they only fail if CALLED; the sim drives only get_now from this policy.
    registerSystemPolicy(this.router);
    // SIM BOUNDARY (design-of-record §1): the sim drives the real FSM + real event
    // EMISSION, but has NO message-router (delivery) and NO adapter. `emit`/`dispatch`
    // are no-op sinks; a transition that cascades an internal notification whose delivery
    // store is absent logs a benign "emit failed" — the TRANSITION still commits (the FSM
    // is what the sim exercises; delivery is out of boundary). Not an error condition.
  }

  /** Fresh ctx per call (mirrors `mcp-binding.ts`: one ctxFactory() per tool call). */
  private makeCtx(sessionId: string): IPolicyContext {
    return {
      stores: this.stores,
      sessionId,
      clientIp: "127.0.0.1",
      role: "unknown", // literal, as in prod; the handler re-resolves via the registry
      emit: async () => {},
      dispatch: async () => {},
      internalEvents: [],
      metrics: this.metrics,
      clock: this.clock,
    };
  }

  /** Drive one verb over the REAL router as `sessionId`. The load-bearing seam. */
  async handle(
    sessionId: string,
    verb: string,
    args: Record<string, unknown> = {},
  ): Promise<VerbOutcome> {
    const raw = await this.router.handle(verb, args, this.makeCtx(sessionId));
    return { ok: raw.isError !== true, data: decodeBody(raw), raw };
  }

  /** Seed a session's role (RBAC + role resolution). Minimal identity. */
  seedRole(sessionId: string, role: SessionRole): void {
    this.registry.setSessionRole(sessionId, role);
  }

  /** Bind a real Agent to a session → a distinct `agentId` (holder/WIP isolation). */
  async seedAgent(
    sessionId: string,
    role: AgentRole,
    name: string,
  ): Promise<RegisterAgentResult> {
    return this.registry.registerAgent(sessionId, role, {
      name,
      role,
      clientMetadata: {
        clientName: "workgraph-sim",
        clientVersion: "0.1.0",
        proxyName: "workgraph-sim",
        proxyVersion: "0.1.0",
      },
    });
  }
}

/** Decode the single text content block; parse JSON when possible, else raw text. */
function decodeBody(raw: PolicyResult): unknown {
  const text = raw?.content?.[0]?.text;
  if (typeof text !== "string") return raw;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
