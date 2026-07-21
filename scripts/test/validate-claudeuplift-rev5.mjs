#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root=process.cwd();
const variants={
 v0:{optional:[], closeout:'V0 includes no optional nodes; keep pB2_selfheal, pA_traction, and pA_tool_actuator explicitly out of scope.'},
 v1:{optional:['pB2_selfheal'], closeout:'V1 includes pB2_selfheal; keep pA_traction and pA_tool_actuator explicitly out of scope.'},
 v2:{optional:['pA_traction','pA_tool_actuator'], closeout:'V2 includes pA_traction and pA_tool_actuator; keep pB2_selfheal explicitly out of scope.'},
 v3:{optional:['pB2_selfheal','pA_traction','pA_tool_actuator'], closeout:'V3 includes pB2_selfheal, pA_traction, and pA_tool_actuator; no optional track is omitted.'},
};
const base=['driver','artifact_gate','rail_gate','drift_fixture','schema_policy','dispatch_tolerance','drift_alert','bug203_track','footer','frequency_calibration','estate_provenance','na_pin','specstore','skill_hotreload_probe','opencode_cleanup','citation_resolver','verifier_gate','closeout'];
function fail(message){throw new Error(message)}

// The prose authority rail is load-bearing too: reject a graph whose design still
// directs operators through an abandoned predecessor chain.
const design=fs.readFileSync(path.join(root,'docs/design/claude-posture-clean-audit0-followon-uplift-design-rev5.md'),'utf8');
if(!design.includes('**WorkItem:** `work-418`')) fail('design: work-418 source binding required');
const sequence=design.match(/### 5\.2 Current operational sequence\n([\s\S]*?)\n## 6\./)?.[1];
if(!sequence) fail('design: current operational sequence required');
const expectedStepIds=['work-418','work-419','work-420','work-421','work-422'];
const actualSteps=[...sequence.matchAll(/^([1-5])\..*\(`(work-\d+)`\)\.$/gm)];
if(actualSteps.length!==5) fail('design: exactly five numbered authority steps required');
for(let index=0;index<5;index++){
 const [full,number,id]=actualSteps[index];
 if(Number(number)!==index+1||id!==expectedStepIds[index]) fail(`design: numbered step ${index+1} must bind ${expectedStepIds[index]} (found ${full})`);
}
if(/work-(398|399|400|401|402|405|406|407|408|409|410|411|412|413|414|415|416|417)\b/.test(sequence)) fail('design: rejected/retired work id in current operational sequence');
if(!design.includes('`work-398 → work-399 → work-400 → work-401 → work-402`')||!design.includes('`work-405 → work-406 → work-407 → work-408 → work-409`')||!design.includes('`work-412 → work-413 → work-414 → work-415 → work-416`')) fail('design: immutable rejected lineage must remain explicit');

for(const [variant,contract] of Object.entries(variants)){
 const {optional,closeout}=contract;
 const file=path.join(root,'docs/blueprints',`claudeuplift0-rev5-${variant}.json`);
 const doc=JSON.parse(fs.readFileSync(file,'utf8'));
 if(doc.runId!==`claudeuplift0_rev5_${variant}`) fail(`${variant}: runId`);
 const legalId=/^[A-Za-z0-9_]+$/;
 if(!legalId.test(doc.runId)) fail(`${variant}: runId must be alphanumeric/underscore`);
 const ids=doc.nodes.map(n=>n.localId), set=new Set(ids);
 for(const id of ids) if(!legalId.test(id)) fail(`${variant}: localId ${id} must be alphanumeric/underscore`);
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
   if(req.kind!=='doc'||req.refResolvable===true||req.evidenceAuthority!=='verifier-attestation') fail(`${variant}/${gateId}: verifier-attestation doc without refResolvable required`);
 }
 const vg=byId.verifier_gate;
 if(vg.type!=='verifier-gate'||JSON.stringify(vg.roleEligibility)!==JSON.stringify(['verifier'])) fail(`${variant}: stable verifier gate`);
 if(JSON.stringify(byId.closeout.dependsOn)!==JSON.stringify(['verifier_gate'])) fail(`${variant}: closeout edge`);
 if(!byId.closeout.runbook.includes(`finite ${variant.toUpperCase()} graph`)||!byId.closeout.runbook.includes(closeout)) fail(`${variant}: truthful closeout contract`);
 for(const id of ['driver','drift_alert','frequency_calibration','verifier_gate','closeout']) {
   const text=`${byId[id].runbook??''} ${byId[id].evidenceRequirements?.[0]?.description??''}`;
   if(!text.includes(variant.toUpperCase())) fail(`${variant}/${id}: variant-specific contract`);
 }
 // Every non-root node must have BOTH admission gates in transitive dependsOn ancestry.
 const ancestorMemo=new Map();
 function dependsAncestors(id){
   if(ancestorMemo.has(id)) return ancestorMemo.get(id);
   const out=new Set();
   for(const dep of byId[id].dependsOn??[]){out.add(dep);for(const a of dependsAncestors(dep))out.add(a)}
   ancestorMemo.set(id,out);return out;
 }
 for(const id of ids.filter(id=>!['driver','artifact_gate','rail_gate'].includes(id))){
   const ancestors=dependsAncestors(id);
   if(!ancestors.has('artifact_gate')||!ancestors.has('rail_gate')) fail(`${variant}/${id}: both admission gates required in transitive dependsOn ancestry`);
 }
 // Authority is location-bound, never satisfied by a compensating duplicate elsewhere.
 const hasAuthorityRef=node=>(node.references??[]).some(r=>typeof r.ref==='string'&&r.ref.includes('work-422'));
 if(!driver.runbook.includes('work-422')) fail(`${variant}/driver: work-422 pre-seed runbook authority required`);
 if(!hasAuthorityRef(driver)) fail(`${variant}/driver: work-422 authority reference required`);
 if(!hasAuthorityRef(byId.rail_gate)) fail(`${variant}/rail_gate: work-422 authority reference required`);
 if(!hasAuthorityRef(vg)) fail(`${variant}/verifier_gate: work-422 authority reference required`);
 if(!hasAuthorityRef(byId.closeout)) fail(`${variant}/closeout: work-422 authority reference required`);
 const serialized=JSON.stringify(doc);
 if(serialized.includes('work-363')||serialized.includes('work-381')||serialized.includes('work-402')||serialized.includes('work-409')||serialized.includes('work-416')||serialized.match(/work-(315|316|317|335|336|337|355|356|357)/)) fail(`${variant}: stale authority reference`);
 if(optional.includes('pA_tool_actuator')&&!byId['pA_tool_actuator'].dependsOn.includes('pA_traction'))fail(`${variant}: actuator traction edge`);
 for(const o of optional) if(!vg.dependsOn.includes(o)||!driver.completionDependsOn.includes(o))fail(`${variant}: optional edge ${o}`);
 if(!optional.includes('pA_traction') && ids.some(x=>x.startsWith('pA-')))fail(`${variant}: pA omission`);
}
console.log('claudeuplift Rev5 blueprints: 4/4 valid finite DAGs; node sets 18/19/20/21; admission authority and optional edges PASS');
