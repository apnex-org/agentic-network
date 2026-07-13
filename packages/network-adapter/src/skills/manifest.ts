/**
 * manifest.ts — wanted-bundles.yaml parsing + MECHANICAL bundle-expand (hcapskills0
 * build_claude, design §5). Pure functions, NO fs/env/git (the seed bin reads files
 * and injects a bundle-reader). No yaml dependency — a focused subset parser for the
 * manifest shape we own (mirrors ois `_mk_yaml_scalar` / `_mk_yaml_list`), matching the
 * pinned-source contract so the derived role-map is exactly the set legacy delivers.
 *
 * Format (ois/manifests/skill-sync/wanted-bundles.yaml):
 *   source_repo: <git url>
 *   source_ref:  <sha>            # PINNED for reproducibility
 *   bundles:     [] | - <name>    # resolved via <clone>/bundles/<name>.yaml `skills:`
 *   extra_skills: - <name>        # individual skill via <clone>/skills/<name>/SKILL.md
 */

export interface WantedBundles {
  sourceRepo: string;
  sourceRef: string;
  bundles: string[];
  extraSkills: string[];
}

/** Parse the top-level manifest (pure). */
export function parseWantedBundles(text: string): WantedBundles {
  return {
    sourceRepo: scalar(text, "source_repo") ?? "",
    sourceRef: scalar(text, "source_ref") ?? "",
    bundles: list(text, "bundles"),
    extraSkills: list(text, "extra_skills"),
  };
}

/** Parse a bundle file's `skills:` list (pure). */
export function parseBundleSkills(text: string): string[] {
  return list(text, "skills");
}

/**
 * The MECHANICAL expansion: bundle skills (resolved via the injected reader) ∪
 * extra_skills, deduped + ordered. `readBundleSkills` reads `<clone>/bundles/<b>.yaml`
 * — injected by the bin so this stays fs-free. Slice-1 manifest has `bundles: []`, so
 * only extra_skills contribute today; the bundle path is implemented for the general case.
 */
export function expandWantedBundles(
  manifest: WantedBundles,
  readBundleSkills: (bundleName: string) => string[],
): string[] {
  const set = new Set<string>();
  for (const b of manifest.bundles) {
    for (const s of readBundleSkills(b)) set.add(s);
  }
  for (const s of manifest.extraSkills) set.add(s);
  return [...set].sort();
}

// ── subset YAML helpers ──────────────────────────────────────────────────────

function scalar(text: string, key: string): string | undefined {
  for (const rawLine of text.split("\n")) {
    const line = stripComment(rawLine);
    const m = line.match(new RegExp(`^${escapeKey(key)}:\\s*(.*)$`));
    if (m) return unquote(m[1].trim()) || undefined;
  }
  return undefined;
}

function list(text: string, key: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    if (!inList) {
      const m = line.match(new RegExp(`^${escapeKey(key)}:\\s*(.*)$`));
      if (!m) continue;
      const inline = m[1].trim();
      if (inline === "[]" || inline === "") {
        if (inline === "[]") return []; // explicit empty inline list
        inList = true; // block list follows on subsequent indented `- ` lines
        continue;
      }
      // inline non-empty list `[a, b]`
      if (inline.startsWith("[") && inline.endsWith("]")) {
        return inline
          .slice(1, -1)
          .split(",")
          .map((s) => unquote(s.trim()))
          .filter((s) => s.length > 0);
      }
      return [];
    }
    if (line.trim() === "") continue; // blank inside/after block — tolerate
    const item = line.match(/^\s+-\s*(.+)$/);
    if (item) {
      const v = unquote(item[1].trim());
      if (v.length > 0) out.push(v);
      continue;
    }
    break; // dedent / next top-level key → list ended
  }
  return out;
}

function stripComment(line: string): string {
  // drop a whole-line comment; leave inline `#` inside values alone (our values —
  // urls, shas, skill-ids — never contain `#`, and quoted values are unquoted below).
  if (/^\s*#/.test(line)) return "";
  return line.replace(/\s+#.*$/, "");
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function escapeKey(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
