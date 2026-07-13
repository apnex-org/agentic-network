/**
 * control-plane/spec-store.ts — U1 SpecStore (resource-generic; hcapskills0
 * build_core). Custody of the declared `ResourceSpec[]`: the SOLE writer + the SOLE
 * authority for enabled-vs-removed truth (a host's introspection cannot distinguish
 * declared-inactive from removed). Neutral — imports zero host types. A verbatim
 * generalization (tool→resource) of the mission-107 pi SpecStore.
 *
 * KF4 — owns the persistence SEAM. Slice-1 uses the in-memory no-op; the disk impl
 * is deferred (Earned-Exposure). The cold-start rehydrate lives here so the held
 * spec surviving independent of any controller has a home in U1.
 */
import type {
  ResourceSpec,
  ResourceSpecStorePort,
  SpecPersistencePort,
} from "./contracts.js";

/** The Slice-1 in-memory no-op impl behind the KF4 persistence seam. */
export class InMemorySpecPersistence implements SpecPersistencePort {
  load(): ResourceSpec[] | null {
    return null;
  }
  save(_spec: readonly ResourceSpec[]): void {
    /* no-op — the disk-backed impl is a deferred Earned-Exposure item. */
  }
}

export class SpecStore implements ResourceSpecStorePort {
  /** the declared spec, keyed by name; the array view preserves insertion order. */
  private byName = new Map<string, ResourceSpec>();

  constructor(
    private readonly persistence: SpecPersistencePort = new InMemorySpecPersistence(),
  ) {
    const loaded = this.persistence.load();
    if (loaded) for (const s of loaded) this.byName.set(s.name, s);
  }

  list(): readonly ResourceSpec[] {
    return [...this.byName.values()];
  }

  get(name: string): ResourceSpec | undefined {
    return this.byName.get(name);
  }

  /** AUTHORITATIVE REPLACE of the whole declared set — absent names ⇒ removed. */
  apply(spec: readonly ResourceSpec[]): void {
    this.byName = new Map(spec.map((s) => [s.name, s]));
    this.persistence.save(this.list());
  }

  create(spec: ResourceSpec): void {
    this.byName.set(spec.name, spec);
    this.persistence.save(this.list());
  }

  destroy(name: string): void {
    this.byName.delete(name);
    this.persistence.save(this.list());
  }
}
