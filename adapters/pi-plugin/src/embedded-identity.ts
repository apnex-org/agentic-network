import type { BuildInfo } from "@apnex/network-adapter";

declare const __OIS_EMBEDDED_IDENTITY__: string;

export interface EmbeddedPluginIdentity {
  packageName: string;
  packageVersion: string;
  sourceCommit: string;
  sourceTree: string;
  dirty: false;
  sourceEpoch: string;
  buildTime: string;
  nodeVersion: string;
  npmVersion: string;
  bundlerVersion: string;
  bundlerSha256: string;
}

const fallback: EmbeddedPluginIdentity = {
  packageName: "@apnex/pi-plugin",
  packageVersion: "unknown",
  sourceCommit: "unknown",
  sourceTree: "unknown",
  dirty: false,
  sourceEpoch: "0",
  buildTime: "1970-01-01T00:00:00.000Z",
  nodeVersion: "unknown",
  npmVersion: "unknown",
  bundlerVersion: "unknown",
  bundlerSha256: "unknown",
};

export const EMBEDDED_IDENTITY: EmbeddedPluginIdentity = (() => {
  try {
    return typeof __OIS_EMBEDDED_IDENTITY__ === "string"
      ? JSON.parse(__OIS_EMBEDDED_IDENTITY__) as EmbeddedPluginIdentity
      : fallback;
  } catch {
    return fallback;
  }
})();

export const EMBEDDED_BUILD_INFO: BuildInfo = {
  commitSha: EMBEDDED_IDENTITY.sourceCommit,
  dirty: EMBEDDED_IDENTITY.dirty,
  buildTime: EMBEDDED_IDENTITY.buildTime,
  branch: "canonical",
};
