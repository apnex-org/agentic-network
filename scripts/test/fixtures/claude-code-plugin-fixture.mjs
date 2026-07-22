#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const configRoot = resolve(process.env.CLAUDE_CONFIG_DIR || "");
if (!process.env.CLAUDE_CONFIG_DIR) throw new Error("CLAUDE_CONFIG_DIR is required for the disposable Claude fixture");
const args = process.argv.slice(2);
const registryPath = join(configRoot, "known_marketplaces.json");

if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add" && args[3]) {
  const source = resolve(args[3]);
  const marketplace = readJson(join(source, ".claude-plugin", "marketplace.json"));
  const destination = join(configRoot, "marketplaces", marketplace.name);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(resolve(destination, ".."), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: false });
  const known = (() => {
    try { return readJson(registryPath); } catch { return {}; }
  })();
  known[marketplace.name] = { source, destination };
  writeJson(registryPath, known);
  console.log(JSON.stringify({ command: "plugin marketplace add", marketplace: marketplace.name, destination }));
  process.exit(0);
}

if (args[0] === "plugin" && args[1] === "install" && args[2]) {
  const separator = args[2].lastIndexOf("@");
  if (separator <= 0) throw new Error("plugin install requires <plugin>@<marketplace>");
  const pluginName = args[2].slice(0, separator);
  const marketplaceName = args[2].slice(separator + 1);
  const known = readJson(registryPath);
  const marketplaceRoot = known[marketplaceName]?.destination;
  if (!marketplaceRoot) throw new Error(`unknown marketplace: ${marketplaceName}`);
  const marketplace = readJson(join(marketplaceRoot, ".claude-plugin", "marketplace.json"));
  const entry = marketplace.plugins.find((candidate) => candidate.name === pluginName);
  if (!entry) throw new Error(`plugin absent from marketplace: ${pluginName}`);
  if (entry.source !== "./") throw new Error(`fixture only accepts package-relative plugin source, observed ${entry.source}`);
  const plugin = readJson(join(marketplaceRoot, ".claude-plugin", "plugin.json"));
  if (plugin.version !== entry.version) throw new Error("marketplace/plugin version mismatch");
  const destination = join(configRoot, "plugins", "cache", marketplaceName, pluginName, plugin.version);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(resolve(destination, ".."), { recursive: true });
  cpSync(marketplaceRoot, destination, { recursive: true, dereference: false });
  const installedPath = join(configRoot, "installed_plugins.json");
  const installed = (() => {
    try { return readJson(installedPath); } catch { return {}; }
  })();
  installed[`${pluginName}@${marketplaceName}`] = { version: plugin.version, installPath: destination };
  writeJson(installedPath, installed);
  console.log(JSON.stringify({ command: "plugin install", plugin: `${pluginName}@${marketplaceName}`, version: plugin.version, destination }));
  process.exit(0);
}

throw new Error("usage: claude-code-plugin-fixture.mjs plugin marketplace add <package-root> | plugin install <plugin>@<marketplace>");
