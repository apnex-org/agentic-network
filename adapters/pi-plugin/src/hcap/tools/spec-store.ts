/**
 * spec-store.ts — U1 SpecStore (HCAP-on-PI, seam-arch §1).
 *
 * Single concern (Law-of-One): custody of the DECLARED spec `ToolSpec[]`. The
 * SOLE writer, via authoritative REPLACE + incremental create/destroy. The SOLE
 * authority for enabled-vs-removed truth — pi's `getAllTools()` cannot distinguish
 * `enabled:false` from *removed* (both render inactive), so only U1's records can.
 * Imports ZERO pi types (neutral; isolated-deferred-to-slice2).
 *
 * KF4 — owns a persistence SEAM (`SpecPersistencePort`). Slice-1 uses the injected
 * in-memory no-op impl; the disk-backed impl is deferred (Earned-Exposure). The
 * seam lives HERE so the HCAP cold-start / no-controller story (the held spec
 * surviving independent of the adapter) has a home in U1, not buried in U6 later.
 */
import type { ToolSpec, SpecPersistencePort } from "./contracts.js";

/** The Slice-1 in-memory no-op impl behind the KF4 persistence seam. */
export class InMemorySpecPersistence implements SpecPersistencePort {
  load(): ToolSpec[] | null {
    return null;
  }
  save(_spec: readonly ToolSpec[]): void {
    /* no-op — the disk-backed impl is a deferred Earned-Exposure item. */
  }
}

export class SpecStore {
  /** the declared spec, keyed by name; the array view preserves insertion order. */
  private byName = new Map<string, ToolSpec>();

  constructor(
    private readonly persistence: SpecPersistencePort = new InMemorySpecPersistence(),
  ) {
    // Cold-start: rehydrate the held spec from persistence before any controller
    // reconnects (the no-controller story). In-memory Slice-1 → null → empty.
    const loaded = this.persistence.load();
    if (loaded) for (const s of loaded) this.byName.set(s.name, s);
  }

  /** the declared spec (read-only snapshot). */
  list(): readonly ToolSpec[] {
    return [...this.byName.values()];
  }

  /** AUTHORITATIVE REPLACE of the whole declared set — absent names ⇒ removed. */
  apply(spec: readonly ToolSpec[]): void {
    this.byName = new Map(spec.map((s) => [s.name, s]));
    this.persistence.save(this.list());
  }

  /** incremental add/update of one declared tool. */
  create(spec: ToolSpec): void {
    this.byName.set(spec.name, spec);
    this.persistence.save(this.list());
  }

  /** incremental REMOVE — drop one tool from the declared spec. */
  destroy(name: string): void {
    this.byName.delete(name);
    this.persistence.save(this.list());
  }

  /** U1's enabled-vs-removed record for a name (undefined ⇒ not declared = removed). */
  get(name: string): ToolSpec | undefined {
    return this.byName.get(name);
  }
}
