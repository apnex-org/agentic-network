/**
 * Local-filesystem StorageProvider — mission-47 T1.
 *
 * Persistent, single-writer. Root directory corresponds to the bucket;
 * blob paths become relative filesystem paths under that root.
 * Matches the GCS layout 1:1 so scripts/state-backup.sh's rsync output
 * is directly consumable.
 *
 * Capabilities: {cas:true, durable:true, concurrent:false}.
 *
 * CAS implementation:
 *   - createOnly: O_WRONLY | O_CREAT | O_EXCL on a tmp file, then
 *     atomic rename into place. If the destination already exists,
 *     O_EXCL fails → {ok:false}.
 *   - putIfMatch: read current content, compute content-hash as token,
 *     compare against caller's token, write-via-tmp-rename on match.
 *     Single-writer assumption: no other process is racing; the
 *     read-check-write sequence is atomic from this process's view.
 *
 * Token derivation: SHA-256 content hash encoded as lowercase hex.
 * Deterministic, sidecar-free. Two writers producing identical data
 * produce identical tokens — which is semantically correct (same
 * content = same version from a client's perspective).
 *
 * Why not flock? Portability varies across platforms + bind mounts;
 * mission-46 local-Docker-testing memory confirms local-fs is only
 * expected to host a single writer (one hub container at a time).
 * Adding flock would be over-engineering for the current deployment
 * profile. If multi-writer local-fs ever becomes a real case, add
 * `concurrent:true` gate + flock in a follow-on mission.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type {
  ProviderCapabilities,
  StorageProvider,
  StorageProviderWithTokenRead,
  CreateOnlyResult,
  PutIfMatchResult,
} from "./contract.js";
import {
  StoragePathNotFoundError,
  StorageProviderError,
} from "./contract.js";

function tokenOf(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Generate a short random suffix for tmp files. Avoids collisions
 * when multiple writes on the same path overlap (rare in single-
 * writer mode but cheap insurance).
 */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36);
}

export class LocalFsStorageProvider implements StorageProviderWithTokenRead {
  readonly capabilities: ProviderCapabilities = {
    cas: true,
    durable: true,
    concurrent: false,
  };

  constructor(private readonly root: string) {
    if (!root || root.trim() === "") {
      throw new StorageProviderError(
        "[local-fs] root path is required; empty root would write to CWD",
      );
    }
  }

  private resolve(blobPath: string): string {
    // Reject paths with `..` traversal; the contract assumes caller-
    // supplied paths are storage keys, not filesystem paths. Defensive.
    if (blobPath.includes("..")) {
      throw new StorageProviderError(
        `[local-fs] blob path must not contain '..' segments: ${blobPath}`,
      );
    }
    return path.resolve(this.root, blobPath);
  }

  private async ensureParentDir(fullPath: string): Promise<void> {
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
  }

  async get(blobPath: string): Promise<Uint8Array | null> {
    const full = this.resolve(blobPath);
    try {
      const data = await fs.readFile(full);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new StorageProviderError(
        `[local-fs] get failed for ${blobPath}`,
        err,
      );
    }
  }

  async getWithToken(
    blobPath: string,
  ): Promise<{ data: Uint8Array; token: string } | null> {
    const data = await this.get(blobPath);
    if (data === null) return null;
    return { data, token: tokenOf(data) };
  }

  async list(prefix: string): Promise<string[]> {
    // Walk the tree rooted at prefix's directory; filter to prefix.
    // Handles empty-prefix by walking the entire root.
    const out: string[] = [];
    const walkRoot = prefix === ""
      ? this.root
      : path.resolve(this.root, prefix);

    const walk = async (dir: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new StorageProviderError(
          `[local-fs] list failed under ${dir}`,
          err,
        );
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          // Skip tmp files — implementation detail, not part of the
          // logical keyspace.
          if (entry.name.includes(".tmp.")) continue;
          const relative = path.relative(this.root, full);
          // Normalize to forward slashes so paths match GCS object-key
          // conventions regardless of host OS.
          const key = relative.split(path.sep).join("/");
          if (key.startsWith(prefix)) out.push(key);
        }
      }
    };

    // If prefix targets a file directly, emit that one key only.
    try {
      const stat = await fs.stat(walkRoot);
      if (stat.isFile()) {
        out.push(prefix);
        return out;
      }
    } catch {
      // ENOENT / not-a-dir — fall through to walk which handles.
    }

    await walk(walkRoot);
    return out;
  }

  async delete(blobPath: string): Promise<void> {
    const full = this.resolve(blobPath);
    try {
      await fs.unlink(full);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return; // idempotent
      throw new StorageProviderError(
        `[local-fs] delete failed for ${blobPath}`,
        err,
      );
    }
  }

  async put(blobPath: string, data: Uint8Array): Promise<void> {
    const full = this.resolve(blobPath);
    await this.ensureParentDir(full);
    const tmp = `${full}.tmp.${randomSuffix()}`;
    try {
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, full);
    } catch (err: unknown) {
      // Best-effort tmp cleanup; swallow if the tmp was never created.
      try { await fs.unlink(tmp); } catch { /* noop */ }
      throw new StorageProviderError(
        `[local-fs] put failed for ${blobPath}`,
        err,
      );
    }
  }

  async createOnly(
    blobPath: string,
    data: Uint8Array,
  ): Promise<CreateOnlyResult> {
    const full = this.resolve(blobPath);
    await this.ensureParentDir(full);
    // Use open + O_EXCL on the final path. If the path exists, this
    // fails with EEXIST — return {ok:false}. Otherwise, write + close.
    let handle: import("node:fs").promises.FileHandle | null = null;
    try {
      handle = await fs.open(full, "wx");
      await handle.writeFile(data);
      return { ok: true };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return { ok: false };
      throw new StorageProviderError(
        `[local-fs] createOnly failed for ${blobPath}`,
        err,
      );
    } finally {
      if (handle) {
        try { await handle.close(); } catch { /* noop */ }
      }
    }
  }

  async putIfMatch(
    blobPath: string,
    data: Uint8Array,
    ifMatchToken: string,
  ): Promise<PutIfMatchResult> {
    const full = this.resolve(blobPath);
    let current: Uint8Array;
    try {
      const buf = await fs.readFile(full);
      current = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StoragePathNotFoundError(blobPath);
      }
      throw new StorageProviderError(
        `[local-fs] putIfMatch read failed for ${blobPath}`,
        err,
      );
    }
    const currentToken = tokenOf(current);
    if (currentToken !== ifMatchToken) {
      return { ok: false, currentToken };
    }
    // Tokens match — write via tmp + rename (atomic-on-same-filesystem).
    const tmp = `${full}.tmp.${randomSuffix()}`;
    try {
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, full);
    } catch (err: unknown) {
      try { await fs.unlink(tmp); } catch { /* noop */ }
      throw new StorageProviderError(
        `[local-fs] putIfMatch write failed for ${blobPath}`,
        err,
      );
    }
    return { ok: true, newToken: tokenOf(data) };
  }
}

// Structural-subtype sanity.
const _satisfiesBase: StorageProvider = new LocalFsStorageProvider("/tmp/_ois_ignored");
void _satisfiesBase;
