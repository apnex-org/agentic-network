/**
 * HubStorageSubstrate — module entry point.
 *
 * Per Design v1.1 §5.1. Exports the substrate interface + concrete factory.
 * Repositories internally compose this substrate behind I*Store interfaces
 * per Option Y (C2 fold-in); handler call-sites unchanged.
 *
 * mission-83 W1 substrate-shell.
 */

export type {
  HubStorageSubstrate,
  SchemaDef,
  FieldDef,
  IndexDef,
  Filter,
  FilterValue,
  ListOptions,
  WatchOptions,
  ChangeEvent,
  CreateOnlyResult,
  PutIfMatchResult,
  SnapshotRef,
} from "./types.js";

export { createPostgresStorageSubstrate } from "./postgres-substrate.js";
