#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node --input-type=module - "$REPO" <<'NODE'
import { readFileSync } from "node:fs";
import { join } from "node:path";
const root=process.argv[2], read=(p)=>JSON.parse(readFileSync(join(root,p),'utf8'));
const claude=read('adapters/claude-plugin/package.json');
const pi=read('adapters/pi-plugin/package.json');
const lock=read('package-lock.json');
const assert=(v,m)=>{if(!v)throw new Error(m)};
assert(claude.version==='0.1.18','Claude fresh version');
assert(pi.version==='0.1.9','Pi fresh version');
assert(Object.keys(claude.dependencies||{}).length===0,'Claude consumer dependency-free');
assert(Object.keys(pi.dependencies||{}).length===0,'Pi consumer dependency-free');
assert(JSON.stringify(pi.peerDependencies)===JSON.stringify({'@earendil-works/pi-tui':'0.81.1',typebox:'1.1.38'}),'Pi exact host peers');
assert(lock.packages['adapters/claude-plugin'].version==='0.1.18','Claude lock version');
assert(lock.packages['adapters/pi-plugin'].version==='0.1.9','Pi lock version');
for(const p of [claude,pi])for(const h of ['preinstall','install','postinstall','prepack'])assert(!p.scripts?.[h],`${p.name} forbidden lifecycle ${h}`);
console.log('PASS: adapter manifests carry fresh, consumer-closed runtime authority');
NODE
