# Claude native npm Phase-A S0 harness

Mission-125 fixture-only qualification harness. This directory is not production package or actuator code.

## Frozen tuple

`claude-native-npm-s0.mjs` fails before fixture work unless the contract from
`docs/contracts/claude-native-npm-phase-a-tuple-contract.md` is present on the
host: Claude Code 2.1.216 at its exact SHA-256, Fedora 31/x64/glibc 2.30, Node
24.12.0 and npm 11.6.2 at their exact executable hashes, and a source commit
additive to `1055d80161df4d36e6a1876676a822e7fe99b029`.

The harness creates only private temporary directories and two read-only
loopback registries. It creates four physically independent consumer roots:
R1/npm, R2/npm, R1/Claude and R2/Claude. Every root has distinct HOME, XDG,
temporary, npm cache/config/prefix, Claude config/plugin cache, marketplace,
stage and result locations. Proxy settings fail closed for non-loopback traffic.

The committed catalog template is exact, minified, contains one registry
placeholder and no trailing newline. Disposable package manifests are generated
from constants in the harness. npm generates the package-root shrinkwrap; the
harness never synthesizes lock topology. The disposable seed endpoint is
normalized to npm's configuration-relative default registry host, while exact
integrities remain bound. Every actual request must still reach R1 or R2.

## Run

```sh
scripts/test/claude-native-npm-s0.test.sh
# preserve a standalone result:
node scripts/phase-a/claude-native-npm-s0.mjs --run-dir=/private/empty/path
```

The frozen run manifest is written before the first consumer acquisition and
hash-checked between phases. Per-root receipts/failure observations, registry
request logs and the binary result are under the selected run directory.

## Expected exact-tuple result

The committed test intentionally expects **FAIL**, not a greenwashed mechanism:

- R1 direct npm oracle: PASS (only transitive 1.0.0 exists);
- R2 direct npm oracle: FAIL (npm global installation does not apply the
  published dependency's shrinkwrap as consumer-root authority and resolves
  compatible transitive 1.0.1);
- R1 Claude-native: PASS (cache-local `npm ci` consumes package-root shrinkwrap);
- R2 Claude-native: PASS for the same reason.

Because both arms are required, oracle failure is terminal. This source node
implements and tests the measuring instrument; it does not remediate or weaken
the result. The later canonical execution/verifier nodes own the durable binary
semantics report.

## Mutation coverage

The test kills per-authority version disagreement/range, shared roots,
outer/graph/dependency corruption, moving catalog, wrong scope/enabled state,
receipt replay, prior-state mutation, host-path leakage, Pi/generic-HCAP scope,
same-version wrong acquisition cache, ambient/global resolution, process-level
registry-binding removal, and shrinkwrap removal under R2. The continuity test
atomically replaces the npmrc pathname between Claude acquisition and
cache-local install: the bound process remains on R1, while removing
`NPM_CONFIG_REGISTRY` produces observed unauthorized R2 requests.

## Anti-scope

No production adapter, OIS, marketplace, settings, cache, package, release,
fleet, Pi, HCAP, uplift or npmjs surface is read as a mutation target. This
Phase-A harness cannot authorize Phase B or resolve bug-316.
