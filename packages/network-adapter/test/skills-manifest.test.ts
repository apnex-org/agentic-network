/**
 * skills-manifest.test.ts — wanted-bundles.yaml subset parsing + mechanical
 * bundle-expand (hcapskills0 build_claude). The role-map derivation is only as sound
 * as this parse, so pin the exact shape of the real ois manifest (design §5).
 */
import { describe, it, expect } from "vitest";
import {
  parseWantedBundles,
  parseBundleSkills,
  expandWantedBundles,
} from "../src/skills/index.js";

// mirrors ois/manifests/skill-sync/wanted-bundles.yaml (comments + block bundle + inline []).
const REAL = `# wanted-bundles.yaml — claude/ois skill-sync manifest.
source_repo: https://github.com/apnex/mission-kit.git
source_ref: ed67e9946bb12500948a1e23e07eb5a0d65ac2b0

bundles:
  - workgraph-arc

extra_skills: []
`;

const WORKGRAPH_ARC_SKILLS = [
  "arc-lifecycle",
  "survey",
  "workgraph-arc-closeout",
  "workgraph-arc-operator",
  "workgraph-arc-participant",
];

describe("parseWantedBundles", () => {
  it("parses the real manifest shape (scalars, block bundle list, inline empty extra_skills, comments)", () => {
    const m = parseWantedBundles(REAL);
    expect(m.sourceRepo).toBe("https://github.com/apnex/mission-kit.git");
    expect(m.sourceRef).toBe("ed67e9946bb12500948a1e23e07eb5a0d65ac2b0");
    expect(m.bundles).toEqual(["workgraph-arc"]);
    expect(m.extraSkills).toEqual([]);
  });

  it("parses a non-empty bundles block list", () => {
    const m = parseWantedBundles(
      `source_repo: r\nsource_ref: s\nbundles:\n  - base\n  - operator\nextra_skills:\n  - x\n`,
    );
    expect(m.bundles).toEqual(["base", "operator"]);
    expect(m.extraSkills).toEqual(["x"]);
  });
});

describe("parseBundleSkills", () => {
  it("parses a bundle's skills list", () => {
    expect(parseBundleSkills(`skills:\n  - c\n  - d\n`)).toEqual(["c", "d"]);
  });
});

describe("expandWantedBundles — mechanical bundle-expand", () => {
  it("unions bundle skills with extra_skills, deduped + sorted", () => {
    const m = {
      sourceRepo: "r",
      sourceRef: "s",
      bundles: ["base"],
      extraSkills: ["x", "c"], // 'c' also comes from the bundle → dedup
    };
    const got = expandWantedBundles(m, (b) => (b === "base" ? ["c", "d"] : []));
    expect(got).toEqual(["c", "d", "x"]);
  });

  it("expands the real manifest through the workgraph-arc bundle", () => {
    const m = parseWantedBundles(REAL);
    const got = expandWantedBundles(m, (bundle) => {
      expect(bundle).toBe("workgraph-arc");
      return WORKGRAPH_ARC_SKILLS;
    });
    expect(got).toEqual(WORKGRAPH_ARC_SKILLS.slice().sort());
    expect(got).toContain("workgraph-arc-participant");
    expect(got).toContain("workgraph-arc-operator");
    expect(got).toContain("workgraph-arc-closeout");
  });
});
