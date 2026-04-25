/**
 * NotificationRepository — StorageProvider-backed persistence for
 * Notification.
 *
 * Mission-49 W9 (continuation of mission-47's entity-store wave pattern;
 * sibling of W8 AuditRepository). Replaces `MemoryNotificationStore` +
 * `GcsNotificationStore` with a single class that composes any
 * `StorageProvider`. Implements `INotificationStore` unchanged —
 * consumers in `hub-networking.ts` (persist / listSince / cleanup) keep
 * working without edits.
 *
 * GCS namespace: `notifications/v2/${ulid}.json`. The v2 cutover was
 * already established in legacy `GcsNotificationStore`; the repository
 * preserves it byte-identically (no second cutover, no migration
 * script). Pre-v2 integer-id notifications (legacy AMP envelope) are
 * frozen in the legacy keyspace; not in scope.
 *
 * ID shape: ULID via `monotonicFactory()` (one factory per repository
 * instance — matches Memory impl semantics). ULIDs are byte-key
 * lex-sortable on every backend the StorageProvider contract supports,
 * so `listSince` orders correctly without numeric parsing.
 *
 * O(N) cleanup characteristic preserved by design (per mission-49
 * thread-304 anti-goal); range-scan optimization filed as idea-195
 * follow-up.
 *
 * Read-side optimization: `listSince` filters keys by path-encoded
 * ULID before reading bodies — same set + same order as the legacy
 * GcsNotificationStore-which-read-every-file, fewer round-trips on the
 * common "fetch since recent cursor" path. Path-trust is safe because
 * the repository writes ULID into the path and the file content
 * identically.
 */

import type { StorageProvider } from "@ois/storage-provider";

import type { INotificationStore, Notification } from "../state.js";

const NAMESPACE = "notifications/v2/";
const KEY_SUFFIX = ".json";

function entryPath(id: string): string {
  return `${NAMESPACE}${id}${KEY_SUFFIX}`;
}

function encode(n: Notification): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(n, null, 2));
}

function decode(bytes: Uint8Array): Notification {
  return JSON.parse(new TextDecoder().decode(bytes)) as Notification;
}

/** Extract the ULID portion from a `notifications/v2/${ulid}.json` key.
 *  Returns the original key on shape-mismatch (defensive — sorts the
 *  malformed key into the lex-position the byte-string already implies).
 */
function ulidOfKey(key: string): string {
  if (key.startsWith(NAMESPACE) && key.endsWith(KEY_SUFFIX)) {
    return key.slice(NAMESPACE.length, key.length - KEY_SUFFIX.length);
  }
  return key;
}

export class NotificationRepository implements INotificationStore {
  private ulidGen: (() => string) | null = null;

  constructor(private readonly provider: StorageProvider) {}

  async persist(
    event: string,
    data: Record<string, unknown>,
    targetRoles: string[],
  ): Promise<Notification> {
    if (!this.ulidGen) {
      const { monotonicFactory } = await import("ulidx");
      this.ulidGen = monotonicFactory();
    }
    const id = this.ulidGen();
    const notification: Notification = {
      id,
      event,
      targetRoles,
      data,
      timestamp: new Date().toISOString(),
    };
    const result = await this.provider.createOnly(entryPath(id), encode(notification));
    if (!result.ok) {
      // ULID monotonicFactory guarantees uniqueness within an instance;
      // a collision means an external writer got there first or the
      // factory was somehow recreated mid-flight. Surface loudly per
      // mission-47 repository discipline rather than silently clobber.
      throw new Error(
        `[NotificationRepository] persist: ULID ${id} already exists; refusing to clobber`,
      );
    }
    return notification;
  }

  async listSince(
    afterId: number | string,
    role?: string,
  ): Promise<Notification[]> {
    const afterStr = String(afterId);
    const keys = await this.provider.list(NAMESPACE);
    const candidates = keys
      .filter((k) => k.endsWith(KEY_SUFFIX))
      .sort();
    const out: Notification[] = [];
    for (const key of candidates) {
      // Path-filter on ULID portion before read. Matches the legacy
      // GcsNotificationStore semantic `if (afterStr && nStr <= afterStr) continue`
      // exactly: empty afterStr means "since beginning"; otherwise strictly-greater.
      if (afterStr && ulidOfKey(key) <= afterStr) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const n = decode(raw);
      if (role && !n.targetRoles.includes(role)) continue;
      out.push(n);
    }
    return out;
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    const cutoffMs = Date.now() - maxAgeMs;
    const keys = await this.provider.list(NAMESPACE);
    let deleted = 0;
    for (const key of keys) {
      if (!key.endsWith(KEY_SUFFIX)) continue;
      const raw = await this.provider.get(key);
      if (!raw) continue;
      const n = decode(raw);
      // Match legacy semantic: delete strictly-older-than cutoff.
      // `< cutoff` means "older than maxAgeMs"; `>= cutoff` keeps it.
      if (new Date(n.timestamp).getTime() < cutoffMs) {
        await this.provider.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}
