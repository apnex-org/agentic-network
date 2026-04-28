/**
 * TeleRepository — StorageProvider-backed Tele persistence.
 *
 * Mission-47 W1. Replaces the legacy `MemoryTeleStore` + `GcsTeleStore`
 * pair with a single class that composes any `StorageProvider`.
 * Implements the `ITeleStore` interface unchanged — policy-layer
 * callers (`hub/src/policy/tele-policy.ts`) continue to use
 * `ctx.stores.tele.defineTele(...)` without edits.
 *
 * Layout matches the historical GCS object keyspace:
 *   tele/<teleId>.json   — per-tele blob
 *   meta/counter.json    — shared counter blob (teleCounter field)
 *
 * Structural refactor only. No behavioral regression:
 *   - Read-side normalization (mission-43 `normalizeTele`) preserved.
 *   - Supersede / retire CAS semantics preserved via `putIfMatch`
 *     retry loop (replaces the GCS-specific `updateExisting`).
 *   - Zero-backfill discipline preserved — `normalizeTele` never
 *     writes the normalized object back.
 *
 * First consumer of the mission-47 StorageProvider contract. If the
 * contract is wrong, this migration surfaces it cheaply — tele is
 * 13 entities, 2 CAS sites, mission-43-fresh code.
 */

import type { StorageProvider } from "@apnex/storage-provider";
import {
  hasGetWithToken,
  StoragePathNotFoundError,
} from "@apnex/storage-provider";

import type { EntityProvenance } from "../state.js";
import type { ITeleStore, Tele } from "./tele.js";
import { normalizeTele } from "./tele.js";
import { StorageBackedCounter } from "./counter.js";

const MAX_CAS_RETRIES = 50;

function telePath(teleId: string): string {
  return `tele/${teleId}.json`;
}

function encodeTele(tele: Tele): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(tele, null, 2));
}

function decodeTele(bytes: Uint8Array): Tele {
  return JSON.parse(new TextDecoder().decode(bytes)) as Tele;
}

export class TeleRepository implements ITeleStore {
  constructor(
    private readonly provider: StorageProvider,
    private readonly counter: StorageBackedCounter,
  ) {
    if (!hasGetWithToken(provider)) {
      throw new Error(
        "TeleRepository requires a StorageProvider with atomic read-with-token support (supersede/retire CAS)",
      );
    }
  }

  async defineTele(
    name: string,
    description: string,
    successCriteria: string,
    createdBy?: EntityProvenance,
  ): Promise<Tele> {
    const num = await this.counter.next("teleCounter");
    const id = `tele-${num}`;
    const now = new Date().toISOString();
    const tele: Tele = {
      id,
      name,
      description,
      successCriteria,
      status: "active",
      createdBy,
      createdAt: now,
    };
    const result = await this.provider.createOnly(telePath(id), encodeTele(tele));
    if (!result.ok) {
      // Counter desync or external write beat us — surface loudly
      // rather than silently clobber.
      throw new Error(
        `[TeleRepository] defineTele: counter issued existing ID ${id}; refusing to clobber`,
      );
    }
    console.log(`[TeleRepository] Tele defined: ${id} — ${name}`);
    return { ...tele };
  }

  async getTele(teleId: string): Promise<Tele | null> {
    const raw = await this.provider.get(telePath(teleId));
    if (!raw) return null;
    return normalizeTele(decodeTele(raw));
  }

  async listTele(): Promise<Tele[]> {
    const keys = await this.provider.list("tele/");
    const teles: Tele[] = [];
    for (const key of keys) {
      if (!key.endsWith(".json")) continue;
      const raw = await this.provider.get(key);
      if (raw) teles.push(normalizeTele(decodeTele(raw)));
    }
    return teles;
  }

  async supersedeTele(teleId: string, successorId: string): Promise<Tele> {
    // Verify successor exists before we mutate the source — avoids a
    // partial state where we've marked teleId superseded but the
    // successor never existed.
    const successor = await this.getTele(successorId);
    if (!successor) {
      throw new Error(`Successor tele not found: ${successorId}`);
    }
    return this.casUpdate(teleId, (tele) => {
      if (tele.status === "retired") {
        throw new Error(`Tele ${teleId} is retired; cannot be superseded`);
      }
      return { ...tele, status: "superseded", supersededBy: successorId };
    }, `supersede ${teleId} → ${successorId}`);
  }

  async retireTele(teleId: string): Promise<Tele> {
    return this.casUpdate(teleId, (tele) => ({
      ...tele,
      status: "retired",
      retiredAt: new Date().toISOString(),
    }), `retire ${teleId}`);
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * Read → transform → putIfMatch with retry. Equivalent to the
   * GCS-specific `updateExisting` helper but composed over the
   * StorageProvider contract. Retry budget of 50 matches
   * `MAX_CAS_RETRIES`; exceeded retries surface loudly rather than
   * silently returning stale state.
   */
  private async casUpdate(
    teleId: string,
    transform: (current: Tele) => Tele,
    description: string,
  ): Promise<Tele> {
    const path = telePath(teleId);
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const read = await (this.provider as unknown as {
        getWithToken(path: string): Promise<{ data: Uint8Array; token: string } | null>;
      }).getWithToken(path);
      if (read === null) throw new Error(`Tele not found: ${teleId}`);
      const current = normalizeTele(decodeTele(read.data));
      const next = transform(current);
      try {
        const result = await this.provider.putIfMatch(
          path,
          encodeTele(next),
          read.token,
        );
        if (result.ok) {
          console.log(`[TeleRepository] ${description}`);
          return next;
        }
        // Token stale — retry with fresh read.
      } catch (err) {
        if (err instanceof StoragePathNotFoundError) {
          throw new Error(`Tele not found: ${teleId}`);
        }
        throw err;
      }
    }
    throw new Error(
      `[TeleRepository] casUpdate exhausted ${MAX_CAS_RETRIES} retries on ${teleId}`,
    );
  }
}
