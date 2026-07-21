#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const source=process.cwd();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'claudeuplift-rev5-mutations-'));
const bpDir=path.join(temp,'docs/blueprints');
const testDir=path.join(temp,'scripts/test');
fs.mkdirSync(bpDir,{recursive:true});fs.mkdirSync(testDir,{recursive:true});
for(const v of ['v0','v1','v2','v3']) fs.copyFileSync(path.join(source,'docs/blueprints',`claudeuplift0-rev5-${v}.json`),path.join(bpDir,`claudeuplift0-rev5-${v}.json`));
fs.copyFileSync(path.join(source,'scripts/test/validate-claudeuplift-rev5.mjs'),path.join(testDir,'validate-claudeuplift-rev5.mjs'));
const v0Path=path.join(bpDir,'claudeuplift0-rev5-v0.json');
const baseline=JSON.parse(fs.readFileSync(v0Path,'utf8'));
function run(){return spawnSync(process.execPath,['scripts/test/validate-claudeuplift-rev5.mjs'],{cwd:temp,encoding:'utf8'});}
function expectPass(label){const r=run();if(r.status!==0)throw new Error(`${label}: expected PASS\n${r.stdout}\n${r.stderr}`)}
function expectFail(label,mutate){const doc=structuredClone(baseline);mutate(doc);fs.writeFileSync(v0Path,JSON.stringify(doc,null,2)+'\n');const r=run();if(r.status===0)throw new Error(`${label}: validator false-PASS\n${r.stdout}`);console.log(`PASS mutation rejected: ${label}`);fs.writeFileSync(v0Path,JSON.stringify(baseline,null,2)+'\n');}
function node(doc,id){return doc.nodes.find(n=>n.localId===id)}
function replaceRef(n){const r=n.references.find(r=>typeof r.ref==='string'&&r.ref.includes('work-409'));if(!r)throw new Error(`missing authority ref ${n.localId}`);r.ref=r.ref.replace('work-409','work-999')}
try{
 expectPass('baseline');
 expectFail('admission ancestry removal: footer.dependsOn=[]',d=>{node(d,'footer').dependsOn=[]});
 expectFail('driver runbook authority removal',d=>{node(d,'driver').runbook=node(d,'driver').runbook.replace('work-409','work-999')});
 expectFail('driver authority reference removal',d=>replaceRef(node(d,'driver')));
 expectFail('rail authority reference removal',d=>replaceRef(node(d,'rail_gate')));
 expectFail('verifier authority reference removal',d=>replaceRef(node(d,'verifier_gate')));
 expectFail('closeout authority reference removal',d=>replaceRef(node(d,'closeout')));
 console.log('claudeuplift Rev5 mutation suite: 7/7 PASS');
} finally {fs.rmSync(temp,{recursive:true,force:true})}
