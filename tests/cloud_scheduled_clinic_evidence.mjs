import test from 'node:test';
import assert from 'node:assert/strict';
import {opportunityScheduleEvidence} from '../cloud/mail-automation-scheduler.mjs';
const source={fullText:'Public GP services. Apply to jobs@example.invalid'},row={edition_key:'edition1',url:'https://clinic.example.invalid/jobs',data:JSON.stringify(source)};
const fact={text:'Our practice provides chronic disease management.',sourceURL:'https://clinic.example.invalid/services',readAt:'2026-11-17T08:01:00.000Z',parentPageId:'page1',parentReadAt:'2026-11-17T08:00:00.000Z'};
test('scheduled application digest changes with the selected child clinical statement and its own proof',async()=>{
 const baseline=await opportunityScheduleEvidence({},row,'arash',source,[fact]);
 for(const patch of [{text:'Different published service.'},{sourceURL:'https://clinic.example.invalid/other-services'},{readAt:'2026-11-17T09:01:00.000Z'},{parentReadAt:'2026-11-17T09:00:00.000Z'},{parentPageId:'page2'}]){
  const changed=await opportunityScheduleEvidence({},row,'arash',source,[{...fact,...patch}]);assert.notEqual(changed.sourceEvidenceDigest,baseline.sourceEvidenceDigest);
 }
 assert.deepEqual(baseline.recipients,['jobs@example.invalid']);
});
test('raw current-source properties do not become trusted child proof and empty legacy digests remain compatible',async()=>{
 const old=await opportunityScheduleEvidence({},row,'arash',source);
 const spoofed=await opportunityScheduleEvidence({},row,'arash',{...source,clinicEvidence:[fact]});
 assert.equal(spoofed.sourceEvidenceDigest,old.sourceEvidenceDigest);
 assert.equal((await opportunityScheduleEvidence({},row,'arash',source,[])).sourceEvidenceDigest,old.sourceEvidenceDigest);
 assert.notEqual((await opportunityScheduleEvidence({},row,'arash',source,[fact])).sourceEvidenceDigest,old.sourceEvidenceDigest);
});
