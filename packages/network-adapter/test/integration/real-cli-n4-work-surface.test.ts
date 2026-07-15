/**
 * M-Real-CLI-Harness n4 — work-surface faithfulness proof (in-process, no LLM).
 *
 * Rehearses the EXACT policy-router path the real claude-code CLI will drive in Seam 1/2,
 * minus the LLM + the MCP transport + the self-wake digest: register_role(engineer) ->
 * claim_session -> get_agents -> list_ready_work -> claim_work -> start_work -> renew_lease
 * -> complete_work, asserting the seeded item reaches `done`.
 *
 * Why this matters (de-risks the marquee node before any VM run):
 *  - proves the n4 test-Hub-WITH-WORK construction (helpers/n4-work-hub.ts) actually serves
 *    a claimable -> completable WorkItem through the REAL production PolicyRouter over the
 *    MEMORY substrate (the WorkItem repo + bindRouterToMcp surface + the envelope encoder);
 *  - proves (a) get_agents shows a role=engineer agent after the real register_role handshake;
 *  - validates the SEEDED runbook's evidence shape (the same freeform item the runbook tells
 *    the LLM to send satisfies the >=1-freeform-evidence completion floor).
 * If this is RED, the real LLM would fail too — so it gates the VM acting-confirm.
 *
 * NOT the behavioral test (does the CLI ACT on the digest) — that is Seam 1/2 with the real
 * CLI. This is the substrate proof; the digest is constructed by the real kernel, never here.
 */
import { describe, it, expect } from "vitest";
import { buildN4Stores, buildN4Router, seedSelfTestWorkItem } from "../helpers/n4-work-hub.js";
import type { AllStores, IPolicyContext } from "../../../../hub/src/policy/types.js";
import { createMetricsCounter } from "../../../../hub/src/observability/metrics.js";

interface PolicyResultLike {
  content: Array<{ text: string }>;
  isError?: boolean;
}

function parse(r: PolicyResultLike): any {
  return JSON.parse(r.content[0].text);
}

describe("real-cli n4 — test-Hub-with-work serves a claimable -> completable item via the real router", () => {
  it("drives register_role -> claim_session -> get_agents -> list_ready_work -> claim -> start -> renew -> complete -> done", async () => {
    const { stores, workItem } = buildN4Stores();
    const router = buildN4Router();
    const SESSION = "n4-sess-engineer";
    const PROOF = "/work/n4-proof.txt";

    const ctx = (): IPolicyContext => {
      const sts: AllStores = stores;
      return {
        stores: sts,
        emit: async () => {},
        dispatch: async () => {},
        sessionId: SESSION,
        clientIp: "127.0.0.1",
        role: sts.engineerRegistry.getRole(SESSION),
        internalEvents: [],
        metrics: createMetricsCounter(),
      };
    };

    const workId = await seedSelfTestWorkItem(workItem, PROOF);

    // (a) connect-as-engineer — the M18 enriched handshake (name + clientMetadata) creates a
    // real Agent; claim_session binds this session active (SSE-eligible, as the real shim does).
    const reg = (await router.handle("register_role", {
      role: "engineer",
      name: "greg-n4",
      clientMetadata: { clientName: "claude-code", clientVersion: "2.1.196", proxyName: "agent-adapter", proxyVersion: "0.1.10" },
    }, ctx())) as PolicyResultLike;
    expect(reg.isError, `register_role: ${reg.content?.[0]?.text}`).toBeFalsy();

    const claimSession = (await router.handle("claim_session", {}, ctx())) as PolicyResultLike;
    expect(claimSession.isError, `claim_session: ${claimSession.content?.[0]?.text}`).toBeFalsy();

    // get_agents must show a role=engineer agent (proof a, in-process).
    const agentsRes = (await router.handle("get_agents", {}, ctx())) as PolicyResultLike;
    expect(agentsRes.isError, `get_agents: ${agentsRes.content?.[0]?.text}`).toBeFalsy();
    const agentsBody = parse(agentsRes);
    const agentList: any[] = agentsBody.agents ?? agentsBody.items ?? agentsBody;
    expect(Array.isArray(agentList)).toBe(true);
    expect(agentList.some((a) => a.role === "engineer"), `agents: ${JSON.stringify(agentList)}`).toBe(true);

    // (b) ready-for-work — the WORK surface the self-wake loop queries + the FSM the CLI drives.
    const listRes = (await router.handle("list_ready_work", { role: "engineer", scopeToCaller: true }, ctx())) as PolicyResultLike;
    expect(listRes.isError, `list_ready_work: ${listRes.content?.[0]?.text}`).toBeFalsy();
    const listBody = parse(listRes);
    const readyItems: any[] = listBody.items ?? [];
    expect(readyItems.some((i) => i.id === workId), `ready items: ${JSON.stringify(readyItems.map((i) => i.id))}`).toBe(true);

    const claimRes = (await router.handle("claim_work", { workId }, ctx())) as PolicyResultLike;
    expect(claimRes.isError, `claim_work: ${claimRes.content?.[0]?.text}`).toBeFalsy();
    const leaseToken: string = parse(claimRes).leaseToken;
    expect(leaseToken).toBeTruthy();

    const startRes = (await router.handle("start_work", { workId, leaseToken }, ctx())) as PolicyResultLike;
    expect(startRes.isError, `start_work: ${startRes.content?.[0]?.text}`).toBeFalsy();

    const renewRes = (await router.handle("renew_lease", { workId, leaseToken }, ctx())) as PolicyResultLike;
    expect(renewRes.isError, `renew_lease: ${renewRes.content?.[0]?.text}`).toBeFalsy();

    // complete_work with ONE freeform evidence item — the exact shape the seeded runbook
    // instructs the LLM to send (validates the runbook against the evidence floor).
    const completeRes = (await router.handle("complete_work", {
      workId,
      leaseToken,
      evidence: [{ requirementId: "self-test", kind: "freeform", producedAt: new Date().toISOString(), note: `wrote ${PROOF}` }],
      frictionReflection: { observed: false, summary: "no friction observed", suggestedFollowUp: { kind: "none" } },
    }, ctx())) as PolicyResultLike;
    expect(completeRes.isError, `complete_work: ${completeRes.content?.[0]?.text}`).toBeFalsy();

    const final = await workItem.getWorkItem(workId);
    expect(final?.status).toBe("done");
    expect(final?.evidence.length).toBe(1);
    expect(final?.evidence[0]?.kind).toBe("freeform");
  });
});
