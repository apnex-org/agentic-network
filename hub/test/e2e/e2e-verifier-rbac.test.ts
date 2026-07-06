/**
 * E2E Verifier RBAC — mission-93 pre-deploy gate (#338).
 *
 * The last pre-prod-flip confidence for the verifier role: drive the REAL
 * register_role(verifier) handshake end-to-end through the full router (all
 * policies registered, memory substrate w/ envelope write-encoder — the prod
 * read path), then assert the LIVE allow/deny surface against the REAL tool
 * registry:
 *
 *   ALLOW  [Architect|Verifier]  create_audit_entry, get_metrics
 *   ALLOW  [Any]                 list_tasks, list_missions, get_agents,
 *                                list_audit_entries
 *   DENY   [Architect]           create_mission, create_task, create_review,
 *                                update_mission, get_pending_actions
 *
 * Why this complements verifier-role-rbac.test.ts (unit): that test drives the
 * handshake + a single deny against a STUB produce tool on a bare router. This
 * drives the same handshake against the REAL tool surface through the full
 * orchestrator. The #338 review gap was structural — the role could not BIND
 * (registration-enum reject → getRole='unknown' → router fail-OPEN → full
 * produce surface), so the load-bearing property is end-to-end:
 *   a register_role(verifier)-BOUND session is permitted EXACTLY its
 *   verdict/observe surface and denied the produce/gating surface.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { TestOrchestrator } from "./orchestrator.js";
import type { ActorFacade } from "./orchestrator.js";

describe("E2E Verifier RBAC (mission-93 #338 pre-deploy gate)", () => {
  let orch: TestOrchestrator;
  let arch: ActorFacade;
  let verifier: ActorFacade;

  beforeEach(() => {
    orch = TestOrchestrator.create();
    arch = orch.asArchitect();
    verifier = orch.asVerifier();
  });

  // ── Bind ──────────────────────────────────────────────────────────

  it("register_role(verifier) really BINDS the session (getRole === 'verifier')", async () => {
    // .call() triggers ensureRegistered → the real register_role(verifier)
    // handshake (schema-validate → coerceAgentRole → bind). A [Any]-tagged
    // tool drives the handshake without itself being RBAC-gated. Pre-#338-fix
    // the registration enum rejected 'verifier' and this stayed 'unknown'.
    await verifier.call("list_tasks", {});
    expect(orch.stores.engineerRegistry.getRole("session-verifier-default")).toBe("verifier");
  });

  // ── ALLOW: verdict + observe surface ([Architect|Verifier]) ───────

  it("ALLOWS create_audit_entry (the verifier's durable verdict surface)", async () => {
    const r = await verifier.call("create_audit_entry", {
      action: "auto_review",
      details: "verifier verdict: PR #338 escalation chain independently verified closed",
      relatedEntity: "task-424",
    });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text).success).toBe(true);
  });

  it("attributes the verifier's audit entry to actor='verifier' (not silently 'architect')", async () => {
    // mis-attributing the verdict to 'architect' would defeat the
    // independent-verifier point (audit-policy.ts derives actor from role).
    await verifier.call("create_audit_entry", { action: "auto_review", details: "verdict record" });
    const list = await verifier.call("list_audit_entries", { actor: "verifier" });
    const parsed = JSON.parse(list.content[0].text);
    expect(parsed.count).toBeGreaterThanOrEqual(1);
    expect(parsed.entries.every((e: { actor: string }) => e.actor === "verifier")).toBe(true);
  });

  it("ALLOWS get_metrics (read-only observability counters)", async () => {
    const r = await verifier.call("get_metrics", {});
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0].text)).toHaveProperty("snapshot");
  });

  // ── ALLOW: read surface ([Any]) ───────────────────────────────────

  it.each(["list_tasks", "list_missions", "get_agents", "list_audit_entries"])(
    "ALLOWS read tool %s ([Any])",
    async (tool) => {
      const r = await verifier.call(tool, {});
      expect(r.isError).toBeUndefined();
    },
  );

  // ── DENY: produce + gating surface ([Architect]) ──────────────────

  // work-162 (A1): create_task + create_review removed from the DENY set — the
  // verbs are retired (now unknown-tool, not RBAC-denied).
  it.each([
    ["create_mission", { title: "M", description: "D" }],
    ["update_mission", { missionId: "mission-1", status: "active" }],
    ["get_pending_actions", {}],
  ] as Array<[string, Record<string, unknown>]>)(
    "DENIES produce/gating tool %s ([Architect])",
    async (tool, args) => {
      const r = await verifier.call(tool, args);
      expect(r.isError).toBe(true);
      // RBAC rejects at the router gate BEFORE the handler — so missing/bogus
      // args (task-1, mission-1) never matter; the denial is role-based.
      expect(JSON.parse(r.content[0].text).error).toMatch(/Authorization denied|architect/i);
    },
  );

  // ── Cross-check: architect retains the produce surface (no over-restriction) ──

  it("architect (NOT verifier) is still ALLOWED create_mission", async () => {
    const r = await arch.call("create_mission", { title: "M", description: "D" });
    expect(r.isError).toBeUndefined();
  });
});

describe("E2E verifier thread participation (mission-93 — thread-674 turn-role bug)", () => {
  // Live cutover (2026-06-20): a directed unicast thread to the verifier got
  // currentTurn='engineer' (the recipient-role resolution excluded verifier →
  // fell back to the architect-counterpart formula), so the verifier's reply
  // was rejected 'not your turn' and it had to work around via kind=note. This
  // proves a verifier is a first-class thread turn-holder: directed thread →
  // currentTurn=verifier → the verifier can reply (the role's CORE interaction).
  it("a verifier can reply to a directed unicast verification thread", async () => {
    const orch = TestOrchestrator.create();
    const arch = orch.asArchitect();
    const verifier = orch.asVerifier();

    // Register the verifier so it has an agent record + resolvable agentId.
    await verifier.call("list_tasks", {});
    const vAgent = await orch.stores.engineerRegistry.getAgentForSession("session-verifier-default");
    expect(vAgent?.role).toBe("verifier");

    // Architect opens a UNICAST verification thread DIRECTED at the verifier.
    const opened = await arch.createThread("Verify claim X", "Please verify claim X.", {
      recipientAgentId: vAgent!.id,
      routingMode: "unicast",
    });
    const threadId = (opened.threadId ?? opened.id) as string;
    expect(threadId).toBeTruthy();

    // FIX: the thread turn must be the VERIFIER's (was 'engineer' → reply blocked).
    const t = await orch.stores.thread.getThread(threadId);
    expect(t?.currentTurn).toBe("verifier");
    expect(t?.currentTurnAgentId).toBe(vAgent!.id);
    // bug-170: the addressed verifier is seeded as a PARTICIPANT (drives the
    // recipient's list_threads discovery — it could not FIND its threads).
    expect((t?.participants ?? []).some(
      (p: { role: string; agentId: string | null }) => p.agentId === vAgent!.id && p.role === "verifier",
    )).toBe(true);

    // The verifier replies — must SUCCEED (turn-check: currentTurn===author
    // AND currentTurnAgentId===authorAgentId both pass for the verifier).
    const reply = await verifier.call("create_thread_reply", {
      threadId,
      message: "Verdict: claim X holds — verified.",
    });
    expect(reply.isError).toBeUndefined();
    expect(JSON.parse(reply.content[0].text).success).not.toBe(false);

    // bug-170: the verifier can DISCOVER its directed thread via list_threads
    // (recipientAgentId filter, substrate-pushed — not limited to the unordered
    // prefetch window). recipientAgentId is stable across the turn-flip; the
    // verifier could not find its directed threads before this.
    const listed = await verifier.call("list_threads", { filter: { recipientAgentId: vAgent!.id } });
    const listedThreads = (JSON.parse(listed.content[0].text).threads ?? []) as Array<{ id: string }>;
    expect(listedThreads.some((th) => th.id === threadId)).toBe(true);
  });
});
