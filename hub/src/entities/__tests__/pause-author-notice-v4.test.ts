// work-540 — THE AUTHOR IS NOTIFIED ON PAUSE, AND ONE AGENT NEVER GETS TWO NOTICES.
//
// Director-ratified: pause = set suspended + stop both clocks + notify the holder AND the author.
// The holder half already existed. This is the other half, and the reason it matters is the
// no-holder case: A ROW SUSPENDED FROM `ready` HAS NO HOLDER, so the holder channel notified NOBODY
// and nothing said so. The author is the only party who can be told.
//
// 🔴 THESE TESTS EXECUTE THE PRODUCTION PATH. They call the real `pauseWork` and then drive the real
// `projectPendingRecallNotices`, asserting on MESSAGES ACTUALLY DELIVERED — not on the intent array
// alone, and not by reproducing the fan-out logic in the test. A test that recomputes the rule it is
// checking agrees with itself by construction; the whole point is to observe what a recipient
// would receive. (The stub-shaped version of this mistake cost a fleet-wide outage earlier today.)
import { describe, expect, it } from "vitest";
import { createMemoryStorageSubstrate } from "../../storage-substrate/index.js";
import { SubstrateCounter } from "../substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../work-item-repository-substrate.js";
import { MessageRepositorySubstrate } from "../message-repository-substrate.js";
import { projectPendingRecallNotices } from "../../policy/recall-notice-projector.js";


const ARCHITECT = { agentId: "arch-1", role: "architect" };
const AUTHOR = "author-1";
const HOLDER = "holder-1";

function ctx(messages: MessageRepositorySubstrate) {
  return {
    stores: { message: messages },
    emit: async () => undefined,
  } as never;
}

async function harness(authorAgentId: string) {
  const substrate = createMemoryStorageSubstrate();
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));
  const item = await repo.createWorkItem({
    type: "task", roleEligibility: ["engineer"], evidenceRequirements: [],
    createdBy: { role: "engineer", agentId: authorAgentId } as never,
  });
  return { substrate, repo, id: item.id, messages: new MessageRepositorySubstrate(substrate) };
}

const pause = (repo: WorkItemRepositorySubstrate, id: string) =>
  repo.pauseWork({ workId: id, operationId: `op-${id}`, reason: "work-540 author notice" } as never, ARCHITECT);

/** Deliver every pending notice through the REAL projector and return recipients actually messaged. */
async function deliveredTo(repo: WorkItemRepositorySubstrate, messages: MessageRepositorySubstrate, id: string) {
  await projectPendingRecallNotices(ctx(messages), repo, { workId: id });
  const recipients: string[] = [];
  for (const agentId of [AUTHOR, HOLDER]) {
    const got = await messages.listMessages({ targetAgentId: agentId });
    for (let i = 0; i < got.length; i++) recipients.push(agentId);
  }
  return recipients;
}

describe("work-540 — pause notifies the author, de-duped against the holder", () => {
  it("🔴 NO HOLDER: a row suspended from `ready` still notifies the AUTHOR", async () => {
    // THE CASE THE DIRECTOR ASKED FOR. Before this, the holder channel produced no notice at all
    // and `recallNoticePending` stayed false — a pause nobody was told about, silently.
    const { repo, messages, id } = await harness(AUTHOR);
    const paused = await pause(repo, id);
    expect(paused!.lease, "armed: a ready row has no holder").toBeNull();
    expect(paused!.recallNoticePending, "an unprojected notice must flag as pending").toBe(true);

    expect(await deliveredTo(repo, messages, id), "the author is messaged").toEqual([AUTHOR]);
  });

  it("🔴 HOLDER != AUTHOR: both are notified, exactly once each", async () => {
    const { repo, messages, id } = await harness(AUTHOR);
    const claimed = await repo.claimWorkItem(id, HOLDER, "engineer");
    await repo.startWork(id, HOLDER, claimed!.lease!.token);
    await pause(repo, id);

    const recipients = await deliveredTo(repo, messages, id);
    expect(recipients.sort(), "both parties, one message each").toEqual([AUTHOR, HOLDER].sort());
  });

  it("🔴 HOLDER == AUTHOR: ONE notice, not two — de-duped on agentId", async () => {
    // The common case in this fleet: an engineer authors a row and then claims it. A naive second
    // notice would double-send, and two notices for one pause read as two pauses to anyone counting.
    const { repo, messages, id } = await harness(HOLDER);
    const claimed = await repo.claimWorkItem(id, HOLDER, "engineer");
    await repo.startWork(id, HOLDER, claimed!.lease!.token);
    const paused = await pause(repo, id);

    expect(paused!.pendingRecallIntents, "ONE intent, not two").toHaveLength(1);
    expect(await deliveredTo(repo, messages, id), "ONE message, not two").toEqual([HOLDER]);
  });

  it("the notices are distinct records: separate intentIds, and the holder's shape is unchanged", async () => {
    // The intentId is hashed over the RECIPIENT as well as the operation, so holder and author
    // notices cannot collide — a shared id would make one overwrite the other's projection state.
    const { repo, id } = await harness(AUTHOR);
    const claimed = await repo.claimWorkItem(id, HOLDER, "engineer");
    await repo.startWork(id, HOLDER, claimed!.lease!.token);
    const paused = await pause(repo, id);

    const intents = paused!.pendingRecallIntents!;
    expect(new Set(intents.map((i) => i.intentId)).size, "distinct intentIds").toBe(2);
    expect(intents.find((i) => i.exactHolderAgentId === HOLDER)!.recipientKind).toBe("holder");
    expect(intents.find((i) => i.exactHolderAgentId === AUTHOR)!.recipientKind).toBe("author");
  });
});
