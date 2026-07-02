/**
 * Adapter build-identity reads — package version + build-info (commit SHA /
 * dirty / build time / branch), hoisted from the shims in idea-355 SLICE-1.
 *
 * `readPackageVersion` was duplicated verbatim in both shims (the mission-66 #40
 * version-source-of-truth fix). `readBuildInfo` + `BuildInfo` were claude-only
 * (the idea-256 build-identity wire). Single-home the READ mechanism here so it
 * can't drift; each shim still resolves its host-specific package.json /
 * build-info paths and derives its own version constants. (The
 * bundle-vs-node_modules path nuance + the report-both/auto-bump scheme are
 * SLICE-3's concern.)
 */

import { readFileSync } from "node:fs";

/** Read the `version` field from a package.json; fallback on any failure. */
export function readPackageVersion(pkgJsonPath: string, fallback: string): string {
  try {
    const raw = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    return typeof raw.version === "string" ? raw.version : fallback;
  } catch {
    return fallback;
  }
}

/** idea-256 build-identity: commit SHA / dirty / build time / branch. */
export interface BuildInfo {
  commitSha: string;
  dirty: boolean;
  buildTime: string | null;
  branch: string;
}

export const UNKNOWN_BUILD_INFO: BuildInfo = {
  commitSha: "unknown",
  dirty: false,
  buildTime: null,
  branch: "unknown",
};

/** Read a dist/build-info.json (written by scripts/build/write-build-info.js). */
export function readBuildInfo(buildInfoPath: string): BuildInfo {
  try {
    const raw = JSON.parse(readFileSync(buildInfoPath, "utf-8"));
    return {
      commitSha: typeof raw.commitSha === "string" ? raw.commitSha : "unknown",
      dirty: !!raw.dirty,
      buildTime: typeof raw.buildTime === "string" ? raw.buildTime : null,
      branch: typeof raw.branch === "string" ? raw.branch : "unknown",
    };
  } catch {
    return UNKNOWN_BUILD_INFO;
  }
}
