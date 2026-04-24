/**
 * GCS-backed Tele Store.
 */

import {
  readJson,
  listFiles,
  getAndIncrementCounter,
  createOnly,
  updateExisting,
  GcsPathNotFound,
} from "../../gcs-state.js";
import { normalizeTele } from "../tele.js";
import type { Tele, ITeleStore } from "../tele.js";
import type { EntityProvenance } from "../../state.js";

export class GcsTeleStore implements ITeleStore {
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    console.log(`[GcsTeleStore] Using bucket: gs://${bucket}`);
  }

  async defineTele(
    name: string,
    description: string,
    successCriteria: string,
    createdBy?: EntityProvenance
  ): Promise<Tele> {
    const num = await getAndIncrementCounter(this.bucket, "teleCounter");
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

    await createOnly<Tele>(this.bucket, `tele/${id}.json`, tele);
    console.log(`[GcsTeleStore] Tele defined: ${id} — ${name}`);
    return { ...tele };
  }

  async getTele(teleId: string): Promise<Tele | null> {
    // Read-side normalization: legacy docs without `status` are treated
    // as `"active"`. The normalized object is NOT written back — zero
    // backfill per mission-43 Decision 2.
    const raw = await readJson<Tele>(this.bucket, `tele/${teleId}.json`);
    return raw ? normalizeTele(raw) : null;
  }

  async listTele(): Promise<Tele[]> {
    const files = await listFiles(this.bucket, "tele/");
    const teles: Tele[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const t = await readJson<Tele>(this.bucket, file);
      // Same read-side normalization as getTele; no write-back.
      if (t) teles.push(normalizeTele(t));
    }
    return teles;
  }

  async supersedeTele(teleId: string, successorId: string): Promise<Tele> {
    const successor = await this.getTele(successorId);
    if (!successor) throw new Error(`Successor tele not found: ${successorId}`);
    try {
      const next = await updateExisting<Tele>(
        this.bucket,
        `tele/${teleId}.json`,
        (current) => {
          const cur = normalizeTele(current);
          if (cur.status === "retired") {
            throw new Error(`Tele ${teleId} is retired; cannot be superseded`);
          }
          return { ...cur, status: "superseded", supersededBy: successorId };
        },
      );
      console.log(`[GcsTeleStore] Tele superseded: ${teleId} → ${successorId}`);
      return next;
    } catch (err) {
      if (err instanceof GcsPathNotFound) throw new Error(`Tele not found: ${teleId}`);
      throw err;
    }
  }

  async retireTele(teleId: string): Promise<Tele> {
    try {
      const next = await updateExisting<Tele>(
        this.bucket,
        `tele/${teleId}.json`,
        (current) => {
          const cur = normalizeTele(current);
          return { ...cur, status: "retired", retiredAt: new Date().toISOString() };
        },
      );
      console.log(`[GcsTeleStore] Tele retired: ${teleId}`);
      return next;
    } catch (err) {
      if (err instanceof GcsPathNotFound) throw new Error(`Tele not found: ${teleId}`);
      throw err;
    }
  }
}
