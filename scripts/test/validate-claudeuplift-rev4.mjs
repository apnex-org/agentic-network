#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root=process.cwd();
const variants={
 v0:[],
 v1:['pB2-selfheal'],
 v2:['pA-traction','pA-tool-actuator'],
 v3:['pB2-selfheal','pA-traction','pA-tool-actuator'],
};
const base=['driver','artifact_gate','rail_gate','drift_fixture','schema_policy','dispatch_tolerance','drift_alert','bug203_track','footer','frequency_calibration','estate_provenance','na_pin','specstore','skill_hotreload_probe','opencode_cleanup','citation_resolver','verifier_gate','closeout'];
function fail(message){throw new Error(message)}
for(const [variant,optional] of Object.entries(variants)){
 const file=path.join(root,'docs/blueprints',`claudeuplift0-rev4-${variant}.json`);
 const doc=JSON.parse(fs.readFileSync(file,'utf8'));
 if(doc.runId!==`claudeuplift0_rev4_${variant}`) fail(`${variant}: runId`);
 const ids=doc.nodes.map(n=>n.localId), set=new Set(ids);
 if(set.size!==ids.length) fail(`${variant}: duplicate localId`);
 const expected=[...base.slice(0,-2),...optional,...base.slice(-2)];
 if(JSON.stringify(ids)!==JSON.stringify(expected)) fail(`${variant}: node set/order mismatch`);
 const byId=Object.fromEntries(doc.nodes.map(n=>[n.localId,n]));
 for(const node of doc.nodes){
   if(!Array.isArray(node.evidenceRequirements)||node.evidenceRequirements.length!==1) fail(`${variant}/${node.localId}: exactly one evidence requirement required`);
   for(const edge of [...(node.dependsOn??[]),...(node.completionDependsOn??[])]) if(!set.has(edge)||edge===node.localId) fail(`${variant}/${node.localId}: dangling/self edge ${edge}`);
   if((node.references?.length??0)>0 && !node.runbook) fail(`${variant}/${node.localId}: references require runbook`);
 }
 // Cycle check across both edge kinds.
 const visiting=new Set(),done=new Set();
 function visit(id){if(visiting.has(id))fail(`${variant}: cycle at ${id}`);if(done.has(id))return;visiting.add(id);const n=byId[id];for(const d of [...(n.dependsOn??[]),...(n.completionDependsOn??[])])visit(d);visiting.delete(id);done.add(id)}
 ids.forEach(visit);
 const driver=byId.driver;
 if(driver.completionDependsOn.length!==ids.length-1 || !ids.filter(x=>x!=='driver').every(x=>driver.completionDependsOn.includes(x))) fail(`${variant}: driver must complete-gate every other node`);
 for(const gateId of ['artifact_gate','rail_gate']){
   const req=byId[gateId].evidenceRequirements[0];
   if(req.kind!=='doc'||req.refResolvable!==true||req.evidenceAuthority!=='verifier-attestation') fail(`${variant}/${gateId}: verifier-attestation doc required`);
 }
 const vg=byId.verifier_gate;
 if(vg.type!=='verifier-gate'||JSON.stringify(vg.roleEligibility)!==JSON.stringify(['verifier'])) fail(`${variant}: stable verifier gate`);
 if(JSON.stringify(byId.closeout.dependsOn)!==JSON.stringify(['verifier_gate'])) fail(`${variant}: closeout edge`);
 if(optional.includes('pA-tool-actuator')&&!byId['pA-tool-actuator'].dependsOn.includes('pA-traction'))fail(`${variant}: actuator traction edge`);
 for(const o of optional) if(!vg.dependsOn.includes(o)||!driver.completionDependsOn.includes(o))fail(`${variant}: optional edge ${o}`);
 if(!optional.includes('pA-traction') && ids.some(x=>x.startsWith('pA-')))fail(`${variant}: pA omission`);
}
console.log('claudeuplift Rev4 blueprints: 4/4 valid finite DAGs; node sets 18/19/20/21; admission authority and optional edges PASS');
