/**
 * GCS-backed Tele Store.
 */

import {
  readJson,
  listFiles,
  getAndIncrementCounter,
  createOnly,
} from "../../gcs-state.js";
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
      createdBy,
      createdAt: now,
    };

    await createOnly<Tele>(this.bucket, `tele/${id}.json`, tele);
    console.log(`[GcsTeleStore] Tele defined: ${id} — ${name}`);
    return { ...tele };
  }

  async getTele(teleId: string): Promise<Tele | null> {
    return await readJson<Tele>(this.bucket, `tele/${teleId}.json`);
  }

  async listTele(): Promise<Tele[]> {
    const files = await listFiles(this.bucket, "tele/");
    const teles: Tele[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const t = await readJson<Tele>(this.bucket, file);
      if (t) teles.push(t);
    }
    return teles;
  }
}
