/**
 * DirectorNotification Entity (ADR-017).
 *
 * Terminal escalation surface. When the watchdog escalates a
 * PendingActionItem (agent unresponsive or stuck), a notification is
 * persisted here. Director-chat layer consumes from this store via a
 * future surface; v1 exposes list + acknowledge tools directly.
 */

import type { EntityProvenance } from "../state.js";

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationSource =
  | "queue_item_escalated"
  | "agent_unresponsive"
  | "agent_stuck"
  | "cascade_failed"
  | "manual";

export interface DirectorNotification {
  id: string;
  severity: NotificationSeverity;
  source: NotificationSource;
  sourceRef: string | null;
  title: string;
  details: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  /** Mission-24 idea-120: uniform direct-create provenance (task-305).
   *  Most notifications are created by the Hub itself (watchdog,
   *  escalator); `createdBy.role` will typically be "system". */
  createdBy?: EntityProvenance;
}

export interface CreateNotificationOptions {
  severity: NotificationSeverity;
  source: NotificationSource;
  sourceRef?: string;
  title: string;
  details: string;
}

export interface IDirectorNotificationStore {
  create(opts: CreateNotificationOptions): Promise<DirectorNotification>;
  getById(id: string): Promise<DirectorNotification | null>;
  list(filter?: {
    severity?: NotificationSeverity;
    source?: NotificationSource;
    acknowledged?: boolean;
  }): Promise<DirectorNotification[]>;
  acknowledge(id: string, acknowledgedBy: string): Promise<DirectorNotification | null>;
}

function clone(n: DirectorNotification): DirectorNotification {
  return { ...n };
}

export class MemoryDirectorNotificationStore implements IDirectorNotificationStore {
  private notifications = new Map<string, DirectorNotification>();
  private counter = 0;

  async create(opts: CreateNotificationOptions): Promise<DirectorNotification> {
    this.counter++;
    const now = new Date();
    const id = `dn-${now.toISOString().slice(0, 10)}-${this.counter.toString().padStart(3, "0")}`;
    const n: DirectorNotification = {
      id,
      severity: opts.severity,
      source: opts.source,
      sourceRef: opts.sourceRef ?? null,
      title: opts.title,
      details: opts.details,
      createdAt: now.toISOString(),
      acknowledgedAt: null,
      acknowledgedBy: null,
    };
    this.notifications.set(id, n);
    return clone(n);
  }

  async getById(id: string): Promise<DirectorNotification | null> {
    const n = this.notifications.get(id);
    return n ? clone(n) : null;
  }

  async list(filter?: {
    severity?: NotificationSeverity;
    source?: NotificationSource;
    acknowledged?: boolean;
  }): Promise<DirectorNotification[]> {
    let out = Array.from(this.notifications.values());
    if (filter?.severity) out = out.filter((n) => n.severity === filter.severity);
    if (filter?.source) out = out.filter((n) => n.source === filter.source);
    if (filter?.acknowledged !== undefined) {
      out = out.filter((n) => (filter.acknowledged ? !!n.acknowledgedAt : !n.acknowledgedAt));
    }
    return out.map(clone);
  }

  async acknowledge(id: string, acknowledgedBy: string): Promise<DirectorNotification | null> {
    const n = this.notifications.get(id);
    if (!n) return null;
    if (n.acknowledgedAt) return clone(n); // idempotent (INV-DN2)
    n.acknowledgedAt = new Date().toISOString();
    n.acknowledgedBy = acknowledgedBy;
    return clone(n);
  }
}
