#!/usr/bin/env node
/**
 * M-Real-CLI-Harness n5 — dialog-free + plugin-marketplace bootstrap, baked into the image's
 * CLAUDE_CONFIG_DIR so the real claude-code CLI boots zero-keystroke ON THE PROVEN PLUGIN PATH.
 *
 * Writes:
 *  - <cfgDir>/.claude.json: the n3 dialog-free preseed (onboarding/theme/established-state) +
 *    project-trust for WORK_DIR (so no folder-trust prompt).
 *  - <cfgDir>/plugins/known_marketplaces.json: the IN-REPO 'agentic-network' DIRECTORY marketplace
 *    (-> /app/adapters/claude-plugin, which the Dockerfile already COPYs) so the flag
 *    `--dangerously-load-development-channels plugin:agent-adapter@agentic-network` resolves with
 *    NO external hand-staged dir and NO marketplace download. (Greg's host uses the equivalent
 *    external dir; the image uses the in-repo package.)
 *
 * usage: node real-cli-bootstrap.cjs <preseedPath> <cfgDir> [workDir=/work] [marketplaceDir=/app/adapters/claude-plugin]
 */
const fs = require("fs");
const path = require("path");

const [, , preseedPath, cfgDir, workDirArg, mktArg] = process.argv;
if (!preseedPath || !cfgDir) {
  console.error("usage: real-cli-bootstrap.cjs <preseedPath> <cfgDir> [workDir] [marketplaceDir]");
  process.exit(2);
}
const workDir = workDirArg || "/work";
const mktDir = mktArg || "/app/adapters/claude-plugin";

const preseed = JSON.parse(fs.readFileSync(preseedPath, "utf8"));
delete preseed._comment;
const baseVer = preseed.lastOnboardingVersion || "2.1.196";
preseed.projects = preseed.projects || {};
preseed.projects[workDir] = {
  hasTrustDialogAccepted: true,
  projectOnboardingSeenCount: 1,
  allowedTools: [],
  enableAllProjectMcpServers: true,
  lastVersionBase: baseVer,
};

fs.mkdirSync(cfgDir, { recursive: true });
fs.writeFileSync(path.join(cfgDir, ".claude.json"), JSON.stringify(preseed, null, 2) + "\n");

// settings.json — skipDangerousModePermissionPrompt:true SUPPRESSES the one residual dialog the
// preseed alone can't (the --dangerously-skip-permissions "Bypass Permissions mode" accept, which
// otherwise blocks the unattended boot defaulting to "No, exit"). enableAllProjectMcpServers covers
// any project .mcp.json path too. (n5: the n4-receipt config had this; the fresh bake must too.)
fs.writeFileSync(
  path.join(cfgDir, "settings.json"),
  JSON.stringify({ skipDangerousModePermissionPrompt: true, enableAllProjectMcpServers: true }, null, 2) + "\n",
);

const pluginsDir = path.join(cfgDir, "plugins");
fs.mkdirSync(pluginsDir, { recursive: true });
const knownMarketplaces = {
  "agentic-network": {
    source: { source: "directory", path: mktDir },
    installLocation: mktDir,
    lastUpdated: "2026-06-30T00:00:00.000Z",
  },
};
fs.writeFileSync(path.join(pluginsDir, "known_marketplaces.json"), JSON.stringify(knownMarketplaces, null, 2) + "\n");

console.error(`[real-cli-bootstrap] ${cfgDir}/.claude.json (trust ${workDir}) + plugins/known_marketplaces.json (agentic-network DIRECTORY -> ${mktDir})`);
