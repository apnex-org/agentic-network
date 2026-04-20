/**
 * GCS-backed DirectorNotification Store (ADR-017, Phase 2x P0-1).
 *
 * Ships with GcsPendingActionStore — Director escalations are as
 * important as the queue items that spawn them; both need to survive
 * Hub restart.
 *
 * Layout:
 *   gs://{bucket}/director-notifications/{id}.json
 */

import {
  readJson,
  listFiles,
  getAndIncrementCounter,
  createOnly,
  updateExisting,
  GcsPathNotFound,
} from "../../gcs-state.js";
import type {
  IDirectorNotificationStore,
  DirectorNotification,
  NotificationSeverity,
  NotificationSource,
  CreateNotificationOptions,
} from "../director-notification.js";

export class GcsDirectorNotificationStore implements IDirectorNotificationStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsDirectorNotificationStore] Using bucket: gs://${bucket}`);
  }

  async create(opts: CreateNotificationOptions): Promise<DirectorNotification> {
    const num = await getAndIncrementCounter(this.bucket, "directorNotificationCounter");
    const now = new Date();
    const id = `dn-${now.toISOString().slice(0, 10)}-${num.toString().padStart(3, "0")}`;
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
      createdBy: opts.createdBy,
    };
    await createOnly<DirectorNotification>(this.bucket, `director-notifications/${id}.json`, n);
    return n;
  }

  async getById(id: string): Promise<DirectorNotification | null> {
    return await readJson<DirectorNotification>(this.bucket, `director-notifications/${id}.json`);
  }

  async list(filter?: {
    severity?: NotificationSeverity;
    source?: NotificationSource;
    acknowledged?: boolean;
  }): Promise<DirectorNotification[]> {
    const files = await listFiles(this.bucket, "director-notifications/");
    const out: DirectorNotification[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const n = await readJson<DirectorNotification>(this.bucket, file);
      if (!n) continue;
      if (filter?.severity && n.severity !== filter.severity) continue;
      if (filter?.source && n.source !== filter.source) continue;
      if (filter?.acknowledged !== undefined) {
        if (filter.acknowledged && !n.acknowledgedAt) continue;
        if (!filter.acknowledged && n.acknowledgedAt) continue;
      }
      out.push(n);
    }
    return out;
  }

  async acknowledge(id: string, acknowledgedBy: string): Promise<DirectorNotification | null> {
    try {
      return await updateExisting<DirectorNotification>(
        this.bucket,
        `director-notifications/${id}.json`,
        (n) => {
          if (n.acknowledgedAt) return n; // idempotent
          n.acknowledgedAt = new Date().toISOString();
          n.acknowledgedBy = acknowledgedBy;
          return n;
        },
      );
    } catch (err) {
      if (err instanceof GcsPathNotFound) return null;
      throw err;
    }
  }
}
