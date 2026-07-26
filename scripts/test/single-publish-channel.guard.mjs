#!/usr/bin/env node
// idea-645 — SINGLE PUBLISH CHANNEL GUARD.
//
// WHY THIS EXISTS: idea-492 delivered ONE npm channel and retired Channel-2. That constraint then
// lived only in an idea entity and a Director sentence — not in CI, not in a test. Nothing
// mechanical consulted it, so `publish-claude-plugin.yml` reappeared on main without anyone
// deciding to re-fork: individual PRs each landed something locally reasonable and the aggregate
// crossed a line NO SINGLE PR WAS MEASURED AGAINST.
//
//   A NORTH-STAR NOBODY RE-CHECKS IS ABANDONED BY INCREMENTS.
//
// DESIGNED ON THE PROPERTY, NOT THE INSTANCE. A guard that grepped for the literal string
// "publish-claude-plugin" would be the `hub/**` defect pre-installed — a rule named after its
// example, which permits the next instance under a different name. The property is:
//
//   A WORKFLOW IS A PUBLISH CHANNEL IF IT IS GRANTED NPM PUBLISH CREDENTIALS *AND* IT CAN REACH
//   AN `npm publish` — DIRECTLY, OR THROUGH A REPO SCRIPT IT INVOKES.
//
// BOTH CONJUNCTS ARE LOAD-BEARING AND EACH WAS MEASURED, NOT ASSUMED:
//   - credentials alone is TOO BROAD: `deprecate-claude-plugin.yml` holds NPM_TOKEN and only
//     deprecates. It must NOT trip this guard, and the negative control below asserts that.
//   - a direct `npm publish` grep is TOO NARROW *and wrong on the unified channel itself*:
//     every `npm publish` in `publish-npm.yml` is inside a COMMENT; it publishes via
//     `scripts/publish-packages.sh`. Grepping the workflow alone scores the one legitimate
//     channel as zero. Script invocations MUST be followed.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowDir = join(repo, ".github/workflows");

/** The ONE sanctioned channel. */
const UNIFIED = "publish-npm.yml";

/**
 * Dated, ticketed exemption — NOT a permanent carve-out.
 * `publish-claude-plugin.yml` is live drift, Director-ruled 2026-07-26. Its retirement is
 * `work-547`, which is BLOCKED behind PR #650 because the unified channel currently re-packs
 * (`npm publish --workspace=…`) while this workflow publishes the exact verified tgz. Retiring it
 * before #650 lands would regress byte-exactness.
 * Recording the known violation EXPLICITLY so the guard can be live NOW and the exemption is
 * visible, rather than leaving the constraint unenforced until the retirement happens.
 * REMOVE THIS ENTRY WHEN work-547 LANDS. The guard then enforces the constraint absolutely.
 */
const EXEMPT = new Map([
  ["publish-claude-plugin.yml", "work-547 (blocked behind PR #650); Director-ruled drift, retirement pending"],
]);

/** A workflow that holds credentials but must NOT be classed a channel — proves discrimination. */
const NEGATIVE_CONTROL = "deprecate-claude-plugin.yml";

const stripComments = (text) =>
  text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

const grantsNpmCredentials = (text) => /NPM_TOKEN|NODE_AUTH_TOKEN/.test(stripComments(text));

/** Repo-relative script paths referenced anywhere in the workflow body. */
const scriptRefs = (text) => [...stripComments(text).matchAll(/\b(scripts\/[\w./-]+\.(?:sh|mjs|cjs|js))/g)].map((m) => m[1]);

/** Direct or transitive reach to an `npm publish`. Depth-limited BFS over repo scripts. */
function reachesPublish(text, seen = new Set(), depth = 0) {
  if (/\bnpm\s+publish\b/.test(stripComments(text))) return true;
  if (depth >= 2) return false;
  for (const ref of scriptRefs(text)) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const p = join(repo, ref);
    if (!existsSync(p)) continue;
    if (reachesPublish(readFileSync(p, "utf8"), seen, depth + 1)) return true;
  }
  return false;
}

const files = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f)).sort();
const channels = [];
for (const f of files) {
  const text = readFileSync(join(workflowDir, f), "utf8");
  if (grantsNpmCredentials(text) && reachesPublish(text)) channels.push(f);
}

const fail = [];

// --- NEGATIVE CONTROL: the guard must DISCRIMINATE, not flag every credentialed workflow. ---
// If this ever trips, the guard has become "holds a token", which would make its verdicts
// meaningless — an over-broad detector reports the same shape as a correct one.
if (existsSync(join(workflowDir, NEGATIVE_CONTROL))) {
  const text = readFileSync(join(workflowDir, NEGATIVE_CONTROL), "utf8");
  if (!grantsNpmCredentials(text)) {
    fail.push(`NEGATIVE CONTROL INVALID: ${NEGATIVE_CONTROL} no longer holds npm credentials, so it no longer tests discrimination. Pick another control or delete this check knowingly.`);
  } else if (channels.includes(NEGATIVE_CONTROL)) {
    fail.push(`NEGATIVE CONTROL FAILED: ${NEGATIVE_CONTROL} holds npm credentials but does NOT publish, yet the guard classed it a publish channel. The guard is over-broad and its other verdicts cannot be trusted.`);
  }
}

// --- THE CONSTRAINT ---
const unexpected = channels.filter((f) => f !== UNIFIED && !EXEMPT.has(f));
if (unexpected.length) {
  fail.push(
    `SECOND PUBLISH CHANNEL DETECTED: ${unexpected.join(", ")}\n` +
    `  idea-492 delivered ONE npm channel (${UNIFIED}) and retired Channel-2.\n` +
    `  A workflow is a publish channel when it is GRANTED npm credentials AND can reach an\n` +
    `  \`npm publish\` directly or through a repo script it invokes.\n` +
    `  If a second channel is genuinely intended, that is a DECISION: change idea-645 and add a\n` +
    `  dated, ticketed entry to EXEMPT here. Do not delete this guard to make CI green.`,
  );
}
if (!channels.includes(UNIFIED)) {
  fail.push(`THE UNIFIED CHANNEL IS NOT DETECTED: ${UNIFIED} was not classed a publish channel. Either it stopped publishing, or this guard's detection broke. Both are serious; a guard that cannot see the one channel it protects would pass an empty repo.`);
}
for (const [f, why] of EXEMPT) {
  if (!existsSync(join(workflowDir, f))) {
    fail.push(`STALE EXEMPTION: ${f} no longer exists but is still exempted (${why}). Remove the EXEMPT entry — a carve-out that outlives its subject silently widens the guard.`);
  }
}

const label = (f) => (f === UNIFIED ? "UNIFIED" : EXEMPT.has(f) ? `EXEMPT — ${EXEMPT.get(f)}` : "UNSANCTIONED");
console.log("[single-publish-channel] workflows scanned:", files.length);
for (const f of channels) console.log(`  publish-capable: ${f}  [${label(f)}]`);
console.log(`  negative control: ${NEGATIVE_CONTROL} — credentialed, non-publishing, correctly excluded`);

if (fail.length) {
  console.error("\n✗ single-publish-channel guard FAILED\n");
  for (const f of fail) console.error(f + "\n");
  process.exit(1);
}
console.log("✓ single-publish-channel guard passed");
