#!/usr/bin/env node
// Deterministic build-info stamp for the P1a reproducible adapter image.
//
// Overwrites every packages/*/dist/build-info.json + adapters/*/dist/build-info.json
// with pinned { commitSha, dirty:false, buildTime:<SOURCE_DATE_EPOCH>, branch } so the
// ONE nondeterministic build input — scripts/build/write-build-info.js stamping
// buildTime=new Date().toISOString() in its prebuild hook — is neutralized.
//
// Schema mirrors scripts/build/write-build-info.js (idea-256 BuildInfo). Skipping
// this script (REPRO_CONTROLS=off) is the digest-equality test's non-vacuity
// mutation: the prebuild's buildTime=now survives -> the image diverges build-to-
// build -> the test goes RED, proving the SOURCE_DATE_EPOCH control is load-bearing.
const fs = require("node:fs");
const path = require("node:path");

const [, , sha, epoch, branch] = process.argv;
if (!sha || !epoch) {
  console.error("usage: write-build-info-deterministic.cjs <commitSha> <sourceDateEpoch> [branch]");
  process.exit(2);
}
const buildTime = new Date(Number(epoch) * 1000).toISOString();
const info = { commitSha: sha, dirty: false, buildTime, branch: branch || "main" };

let n = 0;
for (const root of ["packages", "adapters"]) {
  if (!fs.existsSync(root)) continue;
  for (const pkg of fs.readdirSync(root)) {
    const dist = path.join(root, pkg, "dist");
    if (fs.existsSync(dist) && fs.statSync(dist).isDirectory()) {
      const f = path.join(dist, "build-info.json");
      fs.writeFileSync(f, JSON.stringify(info, null, 2) + "\n");
      console.error(`[stamp] ${f} <- ${sha} dirty=false ${buildTime}`);
      n++;
    }
  }
}
console.error(`[stamp] wrote ${n} deterministic build-info.json`);
