/**
 * decision-cli.ts — mission-102 P3-B7: the SC5 CLI compatibility spike (design
 * §5-SC5; work-121).
 *
 * A contract PROOF, not a product surface: a dumb terminal lists routed
 * decisions, renders ONE decision payload, accepts a pick or free text, and
 * lands the resolution through the SAME substrate verbs the inline path uses
 * (render_arrival_surface → mint_director_confirmation → get_director_
 * confirmation → capture_director_signal → resolve_as_director).
 *
 * ZERO PAYLOAD TRANSFORMATION anywhere: every render is JSON.stringify of the
 * verb output VERBATIM (no reshaping, no field-mapping, no rewording), and the
 * answer travels back as the raw utterance. The B4 hash chain then proves the
 * round trip: the confirmation's promptHash derives canonically from the
 * decision row this CLI displayed, so WHAT was shown is WHAT was authorized.
 *
 * The core is transport-agnostic (a VerbCaller + line IO), so the CI contract
 * test drives it against the real PolicyRouter in-process while the bin
 * wrapper (decision-cli-main.ts) drives it against a live Hub over MCP/HTTP.
 */

/** Call a Hub verb; resolves the parsed JSON body, throws on isError. */
export type VerbCaller = (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** The production two-identity topology (bug-224): the Director's utterance is
 *  captured at the registered DIRECTOR ingress; every other verb runs as the
 *  architect-proxy SURFACE (resolve_as_director is architect-RBAC). Exported +
 *  unit-covered so the live wrapper and the CI test share ONE dispatch rule. */
export const DIRECTOR_INGRESS_VERBS: ReadonlySet<string> = new Set(["capture_director_signal"]);

export function twoIdentityCaller(surface: VerbCaller, director: VerbCaller): VerbCaller {
  return (tool, args) => (DIRECTOR_INGRESS_VERBS.has(tool) ? director(tool, args) : surface(tool, args));
}

export interface CliIO {
  prompt(question: string): Promise<string>;
  print(line: string): void;
}

export interface CliRunResult {
  queue: Array<Record<string, unknown>>;
  rendered: Record<string, unknown> | null;
  confirmationEcho: Record<string, unknown> | null;
  signal: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
}

export async function runDecisionCli(call: VerbCaller, io: CliIO, surface = "ois-cli"): Promise<CliRunResult> {
  // 1. The routed queue — the B6 pure pull. Printed verbatim.
  const arrival = await call("render_arrival_surface", { surface });
  const queue = arrival.queue as Array<Record<string, unknown>>;
  io.print(JSON.stringify(queue));
  if (queue.length === 0) {
    io.print("queue empty");
    return { queue, rendered: null, confirmationEcho: null, signal: null, decision: null };
  }

  // 2. Pick ONE decision; render its payload (options + previews + free-answer) verbatim.
  const decisionId = (await io.prompt("decision id> ")).trim();
  const rendered = queue.find((d) => d.id === decisionId);
  if (!rendered) throw new Error(`decision ${decisionId} is not in the rendered queue`);
  io.print(JSON.stringify(rendered));
  io.print("free answer: always accepted — type an option id or any text");

  // 3. The answer: an option id or free text — RAW, byte-verbatim, no trim
  // (audit-10168: trimming is a payload transformation; " opt-a " is a FREE
  // answer, not a pick — verbatim wins over convenience by contract).
  const answer = await io.prompt("answer> ");
  const options = (rendered.options ?? []) as Array<{ id: string }>;
  const pick = options.some((o) => o.id === answer)
    ? { chosenOptionId: answer }
    : { customAnswer: answer };

  // 4. The inline proof chain, same verbs, same order:
  //    render token → Hub-side echo (the Director never confirms blind) →
  //    Director utterance → proof-gated resolve.
  const minted = await call("mint_director_confirmation", { decisionId, ...pick });
  const confirmationId = (minted.confirmation as { id: string }).id;
  const confirmationEcho = await call("get_director_confirmation", { confirmationId });
  io.print(JSON.stringify(confirmationEcho.binds));
  const captured = await call("capture_director_signal", {
    channel: "ois-cli",
    answer,
    capturedBySurface: surface,
    confidence: "session-bound",
    decisionId,
  });
  const resolved = await call("resolve_as_director", { decisionId, proofRef: confirmationId, ...pick });
  io.print(JSON.stringify(resolved.decision));

  return {
    queue,
    rendered,
    confirmationEcho,
    signal: captured.signal as Record<string, unknown>,
    decision: resolved.decision as Record<string, unknown>,
  };
}
