/**
 * Mission-56 W4.1 — DirectorNotification → Message migration helper tests.
 *
 * Pins:
 *   - emitDirectorNotification produces a Message with the canonical
 *     wire shape (kind=note + system/hub author + target.role=director +
 *     delivery=push-immediate + payload-preserves-legacy-fields).
 *   - projectMessageToDirectorNotification round-trips emit; non-
 *     director-notification-shaped Messages are rejected (returns null).
 *   - listDirectorNotificationViews honors severity / source /
 *     acknowledged filters with legacy semantics (acknowledged=true →
 *     status=acked; acknowledged=false → status≠acked).
 *   - acknowledgeDirectorNotificationMessage maps `acknowledge(id, by)`
 *     to claimMessage + ackMessage atomically; idempotent on already-
 *     acked; preserves the original claimedBy on multi-acknowledge race.
 */

import { describe, expect, it } from "vitest";
import { MemoryStorageProvider } from "@apnex/storage-provider";

import { MessageRepository } from "../../src/entities/message-repository.js";
import {
  emitDirectorNotification,
  projectMessageToDirectorNotification,
  listDirectorNotificationViews,
  acknowledgeDirectorNotificationMessage,
} from "../../src/policy/director-notification-helpers.js";

function newRepo() {
  return new MessageRepository(new MemoryStorageProvider());
}

describe("emitDirectorNotification", () => {
  it("emits a Message with the canonical wire shape", async () => {
    const repo = newRepo();
    const m = await emitDirectorNotification(repo, {
      severity: "critical",
      source: "queue_item_escalated",
      sourceRef: "pa-123",
      title: "Agent unresponsive",
      details: "Escalated after 3 deadline misses.",
    });
    expect(m.kind).toBe("note");
    expect(m.authorRole).toBe("system");
    expect(m.authorAgentId).toBe("hub");
    expect(m.target).toEqual({ role: "director" });
    expect(m.delivery).toBe("push-immediate");
    expect(m.status).toBe("new");
    expect(m.payload).toEqual({
      severity: "critical",
      source: "queue_item_escalated",
      sourceRef: "pa-123",
      title: "Agent unresponsive",
      details: "Escalated after 3 deadline misses.",
    });
  });

  it("normalizes missing sourceRef to null", async () => {
    const repo = newRepo();
    const m = await emitDirectorNotification(repo, {
      severity: "warning",
      source: "manual",
      title: "t",
      details: "d",
    });
    const p = m.payload as { sourceRef: unknown };
    expect(p.sourceRef).toBeNull();
  });
});

describe("projectMessageToDirectorNotification", () => {
  it("round-trips an emitted Message into the legacy view shape", async () => {
    const repo = newRepo();
    const m = await emitDirectorNotification(repo, {
      severity: "warning",
      source: "cascade_failed",
      sourceRef: "task-9",
      title: "t",
      details: "d",
    });
    const view = projectMessageToDirectorNotification(m);
    expect(view).not.toBeNull();
    expect(view).toMatchObject({
      id: m.id,
      severity: "warning",
      source: "cascade_failed",
      sourceRef: "task-9",
      title: "t",
      details: "d",
      createdAt: m.createdAt,
      acknowledgedAt: null,
      acknowledgedBy: null,
    });
  });

  it("returns null for non-director-notification-shaped Messages", async () => {
    const repo = newRepo();
    // Other kind=note + target.role=director Messages (e.g. trigger
    // mission_completion notes) carry a different payload — projection
    // must reject them so list_director_notifications doesn't leak.
    const other = await repo.createMessage({
      kind: "note",
      authorRole: "system",
      authorAgentId: "hub",
      target: { role: "director" },
      delivery: "push-immediate",
      payload: { transition: "active→completed", missionId: "mission-1" },
    });
    expect(projectMessageToDirectorNotification(other)).toBeNull();
  });

  it("rejects Messages with non-director target", async () => {
    const repo = newRepo();
    const m = await repo.createMessage({
      kind: "note",
      authorRole: "system",
      authorAgentId: "hub",
      target: { role: "engineer" },
      delivery: "push-immediate",
      payload: {
        severity: "info",
        source: "manual",
        sourceRef: "x",
        title: "t",
        details: "d",
      },
    });
    expect(projectMessageToDirectorNotification(m)).toBeNull();
  });

  it("rejects Messages with non-note kind", async () => {
    const repo = newRepo();
    const m = await repo.createMessage({
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "hub",
      target: { role: "director" },
      delivery: "push-immediate",
      payload: {
        severity: "info",
        source: "manual",
        sourceRef: "x",
        title: "t",
        details: "d",
      },
    });
    expect(projectMessageToDirectorNotification(m)).toBeNull();
  });

  it("populates acknowledgedAt + acknowledgedBy when status is acked", async () => {
    const repo = newRepo();
    const m = await emitDirectorNotification(repo, {
      severity: "warning",
      source: "manual",
      title: "t",
      details: "d",
    });
    await repo.claimMessage(m.id, "director-agent-1");
    const acked = await repo.ackMessage(m.id);
    expect(acked).not.toBeNull();
    const view = projectMessageToDirectorNotification(acked!);
    expect(view?.acknowledgedAt).toBe(acked!.updatedAt);
    expect(view?.acknowledgedBy).toBe("director-agent-1");
  });
});

describe("listDirectorNotificationViews", () => {
  it("filters by severity, source, and acknowledged state with legacy semantics", async () => {
    const repo = newRepo();
    const a = await emitDirectorNotification(repo, {
      severity: "critical",
      source: "queue_item_escalated",
      title: "a",
      details: "d",
    });
    const b = await emitDirectorNotification(repo, {
      severity: "warning",
      source: "cascade_failed",
      title: "b",
      details: "d",
    });
    const c = await emitDirectorNotification(repo, {
      severity: "warning",
      source: "manual",
      title: "c",
      details: "d",
    });

    // Acknowledge `b` to exercise the acknowledged filter.
    await repo.claimMessage(b.id, "director-1");
    await repo.ackMessage(b.id);

    const all = await listDirectorNotificationViews(repo, {});
    expect(all.map((v) => v.id).sort()).toEqual([a.id, b.id, c.id].sort());

    const bySeverity = await listDirectorNotificationViews(repo, { severity: "warning" });
    expect(bySeverity.map((v) => v.id).sort()).toEqual([b.id, c.id].sort());

    const bySource = await listDirectorNotificationViews(repo, { source: "manual" });
    expect(bySource.map((v) => v.id)).toEqual([c.id]);

    const acked = await listDirectorNotificationViews(repo, { acknowledged: true });
    expect(acked.map((v) => v.id)).toEqual([b.id]);

    const unacked = await listDirectorNotificationViews(repo, { acknowledged: false });
    expect(unacked.map((v) => v.id).sort()).toEqual([a.id, c.id].sort());
  });

  it("excludes non-director-notification-shaped Messages from the result set", async () => {
    const repo = newRepo();
    const dn = await emitDirectorNotification(repo, {
      severity: "info",
      source: "manual",
      title: "t",
      details: "d",
    });
    // Other kind=note director-targeted Message (mission completion).
    await repo.createMessage({
      kind: "note",
      authorRole: "system",
      authorAgentId: "hub",
      target: { role: "director" },
      delivery: "push-immediate",
      payload: { transition: "active→completed", missionId: "mission-1" },
    });
    const out = await listDirectorNotificationViews(repo, {});
    expect(out.map((v) => v.id)).toEqual([dn.id]);
  });

  it("returns views in createdAt-ascending order", async () => {
    const repo = newRepo();
    const a = await emitDirectorNotification(repo, {
      severity: "info",
      source: "manual",
      title: "a",
      details: "d",
    });
    // Force a distinct createdAt by waiting a tick.
    await new Promise((r) => setTimeout(r, 5));
    const b = await emitDirectorNotification(repo, {
      severity: "info",
      source: "manual",
      title: "b",
      details: "d",
    });
    const out = await listDirectorNotificationViews(repo, {});
    expect(out.map((v) => v.id)).toEqual([a.id, b.id]);
  });
});

describe("acknowledgeDirectorNotificationMessage", () => {
  it("flips status to acked and stamps acknowledgedBy via claim+ack", async () => {
    const repo = newRepo();
    const m = await emitDirectorNotification(repo, {
      severity: "warning",
      source: "manual",
      title: "t",
      details: "d",
    });
    const view = await acknowledgeDirectorNotificationMessage(repo, m.id, "director-1");
    expect(view).not.toBeNull();
    expect(view?.acknowledgedAt).not.toBeNull();
    expect(view?.acknowledgedBy).toBe("director-1");

    const stored = await repo.getMessage(m.id);
    expect(stored?.status).toBe("acked");
    expect(stored?.claimedBy).toBe("director-1");
  });

  it("is idempotent — second acknowledge returns the existing view", async () => {
    const repo = newRepo();
    const m = await emitDirectorNotification(repo, {
      severity: "warning",
      source: "manual",
      title: "t",
      details: "d",
    });
    const first = await acknowledgeDirectorNotificationMessage(repo, m.id, "director-1");
    const second = await acknowledgeDirectorNotificationMessage(repo, m.id, "director-1");
    expect(first?.acknowledgedBy).toBe("director-1");
    expect(second?.acknowledgedBy).toBe("director-1");
    expect(second?.acknowledgedAt).toBe(first?.acknowledgedAt);
  });

  it("returns null when the Message doesn't exist", async () => {
    const repo = newRepo();
    const view = await acknowledgeDirectorNotificationMessage(repo, "no-such-id", "director-1");
    expect(view).toBeNull();
  });

  it("preserves the original acknowledgedBy under multi-agent race (W3.2 winner-takes-all)", async () => {
    const repo = newRepo();
    const m = await emitDirectorNotification(repo, {
      severity: "info",
      source: "manual",
      title: "t",
      details: "d",
    });
    // First acknowledger wins.
    const first = await acknowledgeDirectorNotificationMessage(repo, m.id, "director-1");
    // Second acknowledger is too late: claim is a no-op (already
    // received/acked); view reflects the original claimedBy.
    const second = await acknowledgeDirectorNotificationMessage(repo, m.id, "director-2");
    expect(first?.acknowledgedBy).toBe("director-1");
    expect(second?.acknowledgedBy).toBe("director-1");
  });
});
