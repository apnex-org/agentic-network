/**
 * M-Build-Identity-AdvisoryTag (idea-256) — deriveAdvisoryTags projection
 * for proxy + sdk commit-sha + dirty fields.
 *
 * Design v1.0 §1.5 + §2.3 (F1.d wire-pattern + F6 layer-disambig). Asserts:
 *   - clientMetadata.{proxy,sdk}{CommitSha,Dirty} project into the
 *     persisted Agent's advisoryTags via deriveAdvisoryTags
 *   - F6 internal-stored regex: /^[a-f0-9]{7}$|^unknown$/ on commit-sha
 *     fields (NO "-dirty" suffix at this layer; suffix is render-only)
 *   - dirty=false (boolean) is preserved (not coerced to undefined)
 *   - Absent clientMetadata fields → no spurious advisoryTags entries
 *   - Caller-explicit advisoryTags fields are preserved (defensive — same
 *     pattern as adapterVersion in mission-66 #40 closure)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  type AgentClientMetadata,
  type RegisterAgentPayload,
} from "../../src/state.js";
import { AgentRepositorySubstrate as AgentRepository } from "../../src/entities/agent-repository-substrate.js";
import { createMemoryStorageSubstrate } from "../../src/storage-substrate/index.js";

const COMMIT_SHA_REGEX_INTERNAL = /^[a-f0-9]{7}$|^unknown$/;

const BASE_CLIENT: AgentClientMetadata = {
  clientName: "claude-code",
  clientVersion: "0.1.0",
  proxyName: "@apnex/claude-plugin",
  proxyVersion: "0.1.4",
  transport: "stdio-mcp-proxy",
  sdkVersion: "@apnex/network-adapter@0.1.2",
};

function payload(name: string, clientOverrides: Partial<AgentClientMetadata> = {}): RegisterAgentPayload {
  return {
    name,
    role: "engineer",
    clientMetadata: { ...BASE_CLIENT, ...clientOverrides },
    advisoryTags: { llmModel: "claude-opus-4-7" },
  };
}

describe("M-Build-Identity-AdvisoryTag — deriveAdvisoryTags projection", () => {
  let reg: AgentRepository;

  beforeEach(() => {
    reg = new AgentRepository(createMemoryStorageSubstrate());
  });

  it("projects clientMetadata.{proxy,sdk}{CommitSha,Dirty} into advisoryTags", async () => {
    const result = await reg.registerAgent(
      "sess-1",
      "engineer",
      payload("agent-test-1", {
        proxyCommitSha: "ecc20e7",
        proxyDirty: false,
        sdkCommitSha: "9295769",
        sdkDirty: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.advisoryTags.proxyCommitSha).toBe("ecc20e7");
    expect(result.advisoryTags.proxyDirty).toBe(false);
    expect(result.advisoryTags.sdkCommitSha).toBe("9295769");
    expect(result.advisoryTags.sdkDirty).toBe(true);
  });

  it("internal-stored commit-sha matches /^[a-f0-9]{7}$|^unknown$/ (F6 internal contract)", async () => {
    const result = await reg.registerAgent(
      "sess-1",
      "engineer",
      payload("agent-test-2", {
        proxyCommitSha: "ecc20e7",
        proxyDirty: true,
        sdkCommitSha: "unknown",
        sdkDirty: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Critical: even when dirty=true, commitSha field is hex-only (no "-dirty"
    // suffix at this layer). The "-dirty" suffix is concatenated at the
    // get-agents jq render layer per Design v1.0 §1.6 + §2.3.
    expect(result.advisoryTags.proxyCommitSha as string).toMatch(COMMIT_SHA_REGEX_INTERNAL);
    expect(result.advisoryTags.sdkCommitSha as string).toMatch(COMMIT_SHA_REGEX_INTERNAL);
    expect(result.advisoryTags.proxyCommitSha).not.toContain("-dirty");
  });

  it("dirty=false (boolean) is preserved through projection (not coerced to undefined)", async () => {
    const result = await reg.registerAgent(
      "sess-1",
      "engineer",
      payload("agent-test-3", {
        proxyCommitSha: "abc1234",
        proxyDirty: false,
        sdkCommitSha: "abc1234",
        sdkDirty: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Use `in` operator to distinguish "field present and false" from
    // "field absent (undefined)".
    expect("proxyDirty" in result.advisoryTags).toBe(true);
    expect("sdkDirty" in result.advisoryTags).toBe(true);
    expect(result.advisoryTags.proxyDirty).toBe(false);
    expect(result.advisoryTags.sdkDirty).toBe(false);
  });

  it("absent clientMetadata fields → no spurious advisoryTags entries (back-compat)", async () => {
    // Older shims that don't emit build-info fields must not trigger
    // spurious advisoryTags keys.
    const result = await reg.registerAgent(
      "sess-1",
      "engineer",
      payload("agent-test-4"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("proxyCommitSha" in result.advisoryTags).toBe(false);
    expect("proxyDirty" in result.advisoryTags).toBe(false);
    expect("sdkCommitSha" in result.advisoryTags).toBe(false);
    expect("sdkDirty" in result.advisoryTags).toBe(false);
    // Existing fields still flow as expected.
    expect(result.advisoryTags.llmModel).toBe("claude-opus-4-7");
  });

  it("caller-explicit advisoryTags fields are preserved (mission-66 #40 defensive pattern)", async () => {
    // If the shim sets advisoryTags directly (e.g., for testing or a
    // forward-compat code path), the explicit value must NOT be overwritten
    // by clientMetadata projection.
    const explicit: RegisterAgentPayload = {
      name: "agent-test-5",
      role: "engineer",
      clientMetadata: {
        ...BASE_CLIENT,
        proxyCommitSha: "fffffff",
        sdkCommitSha: "fffffff",
      },
      advisoryTags: {
        llmModel: "claude-opus-4-7",
        proxyCommitSha: "1111111",
        sdkCommitSha: "2222222",
      },
    };
    const result = await reg.registerAgent("sess-1", "engineer", explicit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.advisoryTags.proxyCommitSha).toBe("1111111");
    expect(result.advisoryTags.sdkCommitSha).toBe("2222222");
  });

  it("report-both (idea-355 SLICE-3 / bug-183): emits sdkVersion + shimVersion from clientMetadata", async () => {
    // The legacy `adapterVersion` field is mislabeled — it carries the SHIM
    // version (clientMetadata.proxyVersion), NOT the SDK. The report-both fix
    // ADDITIVELY surfaces both versions under intent-aligned keys while leaving
    // adapterVersion untouched (back-compat; AG-8 retire is a later slice).
    const result = await reg.registerAgent(
      "sess-1",
      "engineer",
      // BASE_CLIENT: proxyVersion "0.1.4", sdkVersion "@apnex/network-adapter@0.1.2"
      payload("agent-report-both"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // sdkVersion = clientMetadata.sdkVersion (the KERNEL / network-adapter)
    expect(result.advisoryTags.sdkVersion).toBe("@apnex/network-adapter@0.1.2");
    // shimVersion = clientMetadata.proxyVersion (the SHIM / plugin)
    expect(result.advisoryTags.shimVersion).toBe("0.1.4");
    // Legacy adapterVersion preserved, still mirrors proxyVersion (the SHIM).
    expect(result.advisoryTags.adapterVersion).toBe("0.1.4");
  });

  it("report-both: absent clientMetadata.{sdk,proxy}Version → no spurious sdk/shim keys", async () => {
    const result = await reg.registerAgent(
      "sess-1",
      "engineer",
      // Strip both version fields from the client metadata.
      {
        name: "agent-report-both-absent",
        role: "engineer",
        clientMetadata: {
          clientName: "claude-code",
          clientVersion: "0.1.0",
          proxyName: "@apnex/claude-plugin",
          proxyVersion: "",
          transport: "stdio-mcp-proxy",
        },
        advisoryTags: { llmModel: "claude-opus-4-7" },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("sdkVersion" in result.advisoryTags).toBe(false);
    expect("shimVersion" in result.advisoryTags).toBe(false);
  });

  it("report-both: caller-explicit sdk/shim version fields are preserved", async () => {
    const explicit: RegisterAgentPayload = {
      name: "agent-report-both-explicit",
      role: "engineer",
      clientMetadata: { ...BASE_CLIENT },
      advisoryTags: {
        llmModel: "claude-opus-4-7",
        sdkVersion: "@apnex/network-adapter@9.9.9",
        shimVersion: "9.9.9",
      },
    };
    const result = await reg.registerAgent("sess-1", "engineer", explicit);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.advisoryTags.sdkVersion).toBe("@apnex/network-adapter@9.9.9");
    expect(result.advisoryTags.shimVersion).toBe("9.9.9");
  });

  it("supports the 'unknown' fallback shape from non-git extracted-tarball consumers", async () => {
    // When prepack runs without git context (npm-installed consumer rebuilding
    // from source), build-info.json fields fall back to "unknown" / false.
    // Hub must accept these verbatim.
    const result = await reg.registerAgent(
      "sess-1",
      "engineer",
      payload("agent-test-6", {
        proxyCommitSha: "unknown",
        proxyDirty: false,
        sdkCommitSha: "unknown",
        sdkDirty: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.advisoryTags.proxyCommitSha).toBe("unknown");
    expect(result.advisoryTags.sdkCommitSha).toBe("unknown");
    expect(result.advisoryTags.proxyCommitSha as string).toMatch(COMMIT_SHA_REGEX_INTERNAL);
  });
});
