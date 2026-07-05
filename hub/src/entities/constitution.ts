/**
 * constitution.ts — mission-103 P3-S1: the constitutional serve-substrate
 * entities (design v1.0 §1, RATIFIED at G2 via decision-17).
 *
 * ConstitutionSnapshot — the Hub's read-serve mirror of the git-canonical
 * axiom set (T2: mission-kit is canonical; the PR gauntlet IS ratification;
 * the Hub never writes back). A SINGLETON row (id `current`) holding the
 * WHOLE corpus: atomicity by construction — the substrate's CAS unit is the
 * row, so the swap is the commit point and a reader can never observe a
 * mixed-version constitution. Axiom content is OPAQUE VERBATIM MARKDOWN:
 * validation is a sync-time parse gate, never a schema at rest (a hub-side
 * content schema would be a second authority over what the gauntlet
 * ratified). Prior snapshots are retained as history rows (id `snap-<sha>`).
 *
 * OrgCharter — the Hub-native org layer (T1: two-layer stack — universal
 * axioms in mission-kit, org charter in the Hub). Versioned APPEND-ONLY:
 * every amendment is a new row (id `ocharter-<n>` via counter; createOnly IS
 * the append-only primitive — no update path exists). Charter mutation has
 * NO free-form verbs: it exists only as decision-rail registry actions
 * (bind_axiom / amend_charter), so every change structurally carries
 * {ratifiedBy: decision-N, proofRef} — SC5 is structural, not procedural.
 */

export interface AxiomManifestEntry {
  /** Axiom id from the filename (e.g. "A7"). */
  id: string;
  /** First markdown heading of the file (parse-gate-required). */
  title: string;
  /** Repo-relative path (e.g. "axioms/A7.md"). */
  path: string;
  /** sha256 of the verbatim file content. */
  contentHash: string;
}

export interface ConstitutionSnapshot {
  /** `current` for the singleton; `snap-<sha>` for history rows. */
  id: string;
  /** The mission-kit commit this snapshot mirrors (B1: HEAD-of-main). */
  sha: string;
  syncedAt: string;
  /** sha256 over the canonical JSON of `manifest` — cheap corpus identity. */
  manifestHash: string;
  /** path → verbatim markdown. */
  files: Record<string, string>;
  manifest: AxiomManifestEntry[];
  status: "active" | "superseded";
  createdAt: string;
  updatedAt: string;
}

/** The provenance block every serve response carries BESIDE content (the
 *  payload law, design §2; provenance omission is a contract-test failure). */
export interface ConstitutionProvenance {
  sourceRepo: string;
  sha: string;
  syncedAt: string;
  manifestHash: string;
  /** True when the last successful sync is older than the staleness
   *  threshold (10× cadence class). Content still serves — fail-open with
   *  honesty, never blanking (C7 recall-proofness). */
  stale: boolean;
  ageSeconds: number;
}

export interface CharterBinding {
  /** mission-kit axiom id (referential-gated against the synced set). */
  axiom: string;
  /** Historical predecessor (e.g. "tele-7") — provenance only. */
  predecessor?: string | null;
  /** The rail proof pair: the executing decision + its authority proof. */
  ratifiedBy: string;
  proofRef: string;
  ratifiedAt: string;
  status: "bound" | "superseded" | "unbound";
  supersedes?: string | null;
}

export interface CharterSection {
  text: string;
  ratificationRef: string;
  amendedAt: string;
}

export interface OrgCharter {
  /** `ocharter-<n>` via counter. */
  id: string;
  charterVersion: number;
  /** The prior version's id (append-only lineage); null for v1. */
  supersedes: string | null;
  bindings: CharterBinding[];
  vision: CharterSection | null;
  directorProfile: CharterSection | null;
  createdAt: string;
  updatedAt: string;
}

export interface IConstitutionStore {
  /** The served snapshot, or null before the first successful sync (the
   *  serve verbs map null to the loud `not_synced` error — structurally
   *  distinct from an empty corpus; no unlabeled bootstrap content ever). */
  getCurrent(): Promise<ConstitutionSnapshot | null>;
  /** CAS-swap the singleton to `candidate` (sync-loop-only writer). Retains
   *  the prior snapshot as a history row best-effort. Returns the committed
   *  snapshot. */
  swapSnapshot(candidate: Omit<ConstitutionSnapshot, "id" | "status" | "createdAt" | "updatedAt">): Promise<ConstitutionSnapshot>;
  /** Provenance beside content, computed against the staleness threshold. */
  buildProvenance(snapshot: ConstitutionSnapshot): ConstitutionProvenance;
}

export interface IOrgCharterStore {
  /** The highest-version charter row, or null before the first amendment. */
  getCurrentCharter(): Promise<OrgCharter | null>;
  /** Append a new version binding `axiom` with the rail proof pair. Rejects
   *  (throws) on: duplicate live binding for the axiom (unless superseding),
   *  self-referential predecessor/supersedes. NO other mutation path exists. */
  bindAxiom(input: {
    axiom: string;
    predecessor?: string | null;
    status?: CharterBinding["status"];
    supersedes?: string | null;
    ratifiedBy: string;
    proofRef: string;
  }): Promise<OrgCharter>;
  /** Append a new version amending one charter section with the rail proof. */
  amendCharter(input: {
    section: "vision" | "directorProfile";
    text: string;
    ratifiedBy: string;
    proofRef: string;
  }): Promise<OrgCharter>;
}
