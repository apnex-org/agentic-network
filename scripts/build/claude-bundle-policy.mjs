import { createHash } from "node:crypto";

const lifecycleHooks = [
  "preinstall",
  "install",
  "postinstall",
  "prepack",
  "prepare",
  "prepublish",
  "prepublishOnly",
];

function fail(message) {
  throw new Error(`claude package policy: ${message}`);
}

export function validateClaudePackageJson(pkg, expectedVersion = pkg.version) {
  if (pkg.name !== "@apnex/claude-plugin") fail(`wrong package name: ${pkg.name}`);
  if (pkg.version !== expectedVersion) fail(`wrong package version: ${pkg.version}`);
  if (pkg.main !== "dist/shim.js") fail(`wrong entrypoint: ${pkg.main}`);
  if (Object.keys(pkg.dependencies ?? {}).length !== 0) fail("consumer runtime dependencies are forbidden");
  if (Object.keys(pkg.peerDependencies ?? {}).length !== 0) fail("consumer runtime peers are forbidden");
  for (const hook of lifecycleHooks) {
    if (pkg.scripts?.[hook] !== undefined) fail(`lifecycle script is forbidden: ${hook}`);
  }
  return true;
}

export function validateClaudeBundleMetafile(metafile) {
  const outputs = Object.entries(metafile.outputs ?? {});
  const jsOutputs = outputs.filter(([path]) => path.endsWith(".js"));
  if (jsOutputs.length !== 2) fail(`expected shim and seed JavaScript outputs, observed ${jsOutputs.length}`);

  const nonNodeExternals = [];
  for (const [outputPath, output] of outputs) {
    for (const imported of output.imports ?? []) {
      if (imported.external && !imported.path.startsWith("node:")) {
        nonNodeExternals.push(`${outputPath}:${imported.kind}:${imported.path}`);
      }
    }
  }
  if (nonNodeExternals.length > 0) {
    fail(`bare runtime imports escaped the bundle: ${nonNodeExternals.sort().join(", ")}`);
  }

  const inputs = Object.keys(metafile.inputs ?? {}).map((path) => path.replaceAll("\\", "/"));
  const authExtensionInputs = inputs.filter((path) => /@modelcontextprotocol\/sdk\/dist\/(?:esm|cjs)\/client\/auth-extensions\.js$/.test(path));
  const joseInputs = inputs.filter((path) => /node_modules\/jose\//.test(path));
  if (authExtensionInputs.length > 0 && joseInputs.length === 0) {
    fail("MCP client auth extensions became reachable without bundling jose");
  }

  return {
    schemaVersion: 1,
    mcpClientAuthExtensions: authExtensionInputs.length > 0 ? "bundled-with-jose" : "rejected-not-reachable",
    authExtensionInputs: authExtensionInputs.sort(),
    joseInputCount: joseInputs.length,
    consumerRuntimeExternals: [],
  };
}

export function validateBuiltRuntimeText(text, featurePolicy) {
  const bareJose = [
    /import\s*\(\s*["']jose["']\s*\)/,
    /from\s*["']jose["']/,
    /require\s*\(\s*["']jose["']\s*\)/,
  ];
  if (bareJose.some((pattern) => pattern.test(text))) {
    fail("built runtime retains a bare jose branch");
  }
  if (!["bundled-with-jose", "rejected-not-reachable"].includes(featurePolicy.mcpClientAuthExtensions)) {
    fail(`unknown MCP auth-extension disposition: ${featurePolicy.mcpClientAuthExtensions}`);
  }
  return true;
}

export function canonicalSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
