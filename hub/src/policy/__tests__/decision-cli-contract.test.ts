/**
 * mission-102 P3-B7 — the SC5 CLI-compatibility CONTRACT test (design §5-SC5,
 * work-121): the decision payload is presentation-agnostic. A dumb-terminal
 * CLI (src/cli/decision-cli.ts) lists the routed queue, renders one decision,
 * accepts a pick or free text, and resolves through the SAME substrate verbs
 * the inline path uses — with ZERO payload transformation anywhere:
 *
 *   - what the CLI prints is byte-identical JSON to what the verbs returned;
 *   - the stored option payload (previews, consequences, all of it) survives
 *     to the terminal byte-equal;
 *   - the answer lands verbatim (option id or free text, weird characters
 *     included);
 *   - the B4 hash chain closes the loop: the consumed confirmation's
 *     promptHash derives canonically from the decision row the CLI displayed
 *     — WHAT was shown is WHAT was authorized;
 *   - the ArrivalSnapshot receipt exists WITHOUT the CLI doing anything
 *     (recorded server-side by the render verb — no client trust).
 *
 * This suite runs in normal CI (vitest), making the presentation-agnostic
 * guarantee regression-checked, which is the second half of the B7 scope.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyRouter } from "../router.js";
import { registerArrivalSurfacePolicy } from "../arrival-surface-policy.js";
import { registerDirectorProofPolicy } from "../director-proof-policy.js";
import { createTestContext, type TestPolicyContext } from "../test-utils.js";
import { createMemoryStorageSubstrate } from "../../storage-substrate/memory-substrate.js";
import { buildEnvelopeWriteEncoder } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../../entities/substrate-counter.js";
import { DecisionRepositorySubstrate } from "../../entities/decision-repository-substrate.js";
import { ArrivalSurfaceRepositorySubstrate } from "../../entities/arrival-surface-repository-substrate.js";
import { DirectorProofRepositorySubstrate, canonicalPromptHash } from "../../entities/director-proof-repository-substrate.js";
import { runDecisionCli, twoIdentityCaller, type VerbCaller, type CliIO } from "../../cli/decision-cli.js";
import type { DecisionActor, DecisionOption } from "../../entities/decision.js";

const ARCHITECT: DecisionActor = { agentId: "agent-arch", role: "architect", sessionId: "s-a" };

/** Options with EVERY schema field populated — the transformation canaries. */
const OPTIONS: DecisionOption[] = [
  { id: "opt-a", label: "Ship it", description: "Merge now", preview: "```diff\n+ ship\n```", consequences: "deploys immediately" },
  { id: "opt-b", label: "Hold", description: "Wait for the audit", preview: "review window: 48h", consequences: "delays the arc" },
];

function scriptedIO(inputs: string[]): { io: CliIO; printed: string[] } {
  const printed: string[] = [];
  const remaining = [...inputs];
  return {
    printed,
    io: {
      prompt: async () => {
        const next = remaining.shift();
        if (next === undefined) throw new Error("CLI asked for more input than the script provides");
        return next;
      },
      print: (line) => printed.push(line),
    },
  };
}

describe("decision CLI contract (P3-B7 / SC5: same verbs, zero payload transformation)", () => {
  let router: PolicyRouter;
  let ctx: TestPolicyContext;
  let decisions: DecisionRepositorySubstrate;
  let arrival: ArrivalSurfaceRepositorySubstrate;
  let call: VerbCaller;

  beforeEach(async () => {
    const substrate = createMemoryStorageSubstrate();
    substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
    const counter = new SubstrateCounter(substrate);
    decisions = new DecisionRepositorySubstrate(substrate, counter);
    arrival = new ArrivalSurfaceRepositorySubstrate(substrate, counter);
    router = new PolicyRouter();
    registerArrivalSurfacePolicy(router);
    registerDirectorProofPolicy(router);
    const proofs = new DirectorProofRepositorySubstrate(substrate, counter);
    // TWO identities, the production topology (bug-224): the CLI surface runs
    // as the ARCHITECT proxy (render/mint/echo/resolve), while the Director's
    // answer rides the registered DIRECTOR ingress (capture_director_signal).
    ctx = createTestContext({ role: "architect" });
    const directorCtx = createTestContext({ role: "director" });
    for (const c of [ctx, directorCtx]) {
      c.stores.decision = decisions;
      c.stores.arrivalSurface = arrival;
      c.stores.directorProof = proofs;
    }
    // The CLI's only dependency: a verb caller — built with the SAME
    // twoIdentityCaller the live wrapper uses, so the dispatch rule
    // (capture → director ingress, everything else → surface) is CI-covered.
    const callerAs = (c: TestPolicyContext): VerbCaller => async (tool, args) => {
      const r = await router.handle(tool, args, c);
      const body = JSON.parse(r.content[0].text) as Record<string, unknown>;
      if (r.isError) throw new Error(`${tool} rejected: ${String(body.error)}`);
      return body;
    };
    call = twoIdentityCaller(callerAs(ctx), callerAs(directorCtx));
  });

  async function routedDecision(title: string): Promise<string> {
    const d = await decisions.raiseDecision({
      title, context: `ctx: ${title}`, class: "approval", options: OPTIONS, raisedBy: ARCHITECT,
    });
    await decisions.curateDecision(d.id, ARCHITECT);
    await decisions.routeDecision(d.id, ARCHITECT, { target: "director" });
    return d.id;
  }

  it("option pick: full round-trip through the inline verbs, payload byte-equal end to end, director-direct authority", async () => {
    const id = await routedDecision("cli option pick");
    const { io, printed } = scriptedIO([id, "opt-b"]);
    const result = await runDecisionCli(call, io, "ois-cli");

    // ZERO TRANSFORMATION (a): printed queue is exactly the verb output.
    const queue = JSON.parse(printed[0]) as Array<Record<string, unknown>>;
    expect(queue).toEqual(result.queue);
    // (b): the stored option payload — previews, consequences, every field —
    // reaches the terminal byte-equal.
    const row = (await decisions.getDecision(id))!;
    const shown = queue.find((d) => d.id === id)!;
    expect(JSON.stringify(shown.options)).toBe(JSON.stringify(row.options));
    // (c): the single-decision render is byte-identical to its queue entry.
    expect(printed[1]).toBe(JSON.stringify(shown));

    // The resolution landed through resolve_as_director with the answer VERBATIM.
    expect(result.decision!.status).toBe("executed"); // plan-less → markExecuted
    const resolution = result.decision!.resolution as { answer: { chosenOptionId: string }; authorityMode: string };
    expect(resolution.answer.chosenOptionId).toBe("opt-b");
    // Director-ANSWERED confirmation consumed → director-direct, the strongest mode.
    expect(resolution.authorityMode).toBe("director-direct");

    // The B4 hash chain: what the CLI displayed is what was authorized.
    const echo = result.confirmationEcho!.confirmation as { promptHash: string };
    expect(echo.promptHash).toBe(canonicalPromptHash(row));
    expect((result.confirmationEcho!.binds as { promptCurrent: boolean }).promptCurrent).toBe(true);

    // DELIVERED = PRESENTED with no client cooperation: the render verb wrote
    // the snapshot receipt; the CLI never touched it.
    const snap = await arrival.latestSnapshot("ois-cli");
    expect(snap!.entries.map((e) => e.decisionId)).toContain(id);
  });

  it("free text: an arbitrary utterance (unicode, quotes, newlines-escaped) lands verbatim as customAnswer", async () => {
    const id = await routedDecision("cli free answer");
    const utterance = `neither — do a canary at 5% first; see §2.1 ("blast radius") → then opt-a`;
    const { io } = scriptedIO([id, utterance]);
    const result = await runDecisionCli(call, io);

    const resolution = (result.decision as { resolution: { answer: { customAnswer: string } } }).resolution;
    expect(resolution.answer.customAnswer).toBe(utterance);
    // The signal stored the raw utterance too (verbatim at the proof layer).
    expect((result.signal as { answer: string }).answer).toBe(utterance);
  });

  it("audit-10168: leading/trailing whitespace is PAYLOAD — ' opt-a ' is a free answer landing byte-exact, never a pick", async () => {
    const id = await routedDecision("cli whitespace verbatim");
    const utterance = "  opt-a \t";
    const { io } = scriptedIO([id, utterance]);
    const result = await runDecisionCli(call, io);
    const resolution = (result.decision as { resolution: { answer: { customAnswer?: string; chosenOptionId?: string }; authorityMode: string } }).resolution;
    expect(resolution.answer.chosenOptionId).toBeUndefined(); // NOT coerced to a pick
    expect(resolution.answer.customAnswer).toBe(utterance);   // byte-exact incl. whitespace
    expect((result.signal as { answer: string }).answer).toBe(utterance);
  });

  it("empty queue: the CLI reports and exits without minting anything", async () => {
    const { io, printed } = scriptedIO([]);
    const result = await runDecisionCli(call, io);
    expect(result.decision).toBeNull();
    expect(printed).toContain("queue empty");
  });

  it("unknown decision id: loud failure, nothing consumed, decision untouched", async () => {
    const id = await routedDecision("cli guard");
    const { io } = scriptedIO(["decision-999", "opt-a"]);
    await expect(runDecisionCli(call, io)).rejects.toThrow(/not in the rendered queue/);
    expect((await decisions.getDecision(id))!.status).toBe("routed");
  });
});
