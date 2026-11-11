import test from 'node:test';
import assert from 'node:assert/strict';
import {targetFollowUpDue,rankNetworkTargets,networkIntroduction} from '../src/network-target-actions.mjs';
const now=Date.parse('2026-11-11T12:00:00Z');
test('follow-up reminders are local planning, exclude closed/archived and need a known past contact date',()=>{
 assert(targetFollowUpDue({saved:{status:'follow_up'}},now));
 assert(targetFollowUpDue({saved:{status:'contacted',updatedAt:'2026-11-04T12:00:00Z'}},now));
 for(const item of [{saved:{status:'contacted',updatedAt:'2026-11-05'}},{saved:{status:'contacted',updatedAt:'invalid'}},{saved:{status:'contacted',updatedAt:'2027-01-01'}},{status:'closed',saved:{status:'follow_up'}},{saved:{status:'archived'}}])assert.equal(targetFollowUpDue(item,now),false);
});
test('ranking preserves real priority enums and never mutates input or promotes closed opportunities',()=>{
 const rows=[{id:'closed',status:'closed',match:{priority:'high'}},{id:'medium',match:{priority:'medium'}},{id:'high',match:{priority:'high'}},{id:'due',saved:{status:'follow_up'}},{id:'recent',match:{priority:'high'},publishedAt:'2026-11-11'},{id:'waiting',saved:{status:'contacted',updatedAt:'2026-11-10'}}];
 const before=JSON.stringify(rows);
 assert.deepEqual(rankNetworkTargets(rows,{now}).map(x=>x.id),['due','recent','high','medium','waiting','closed']);
 assert.deepEqual(rankNetworkTargets(rows,{focus:'actionable',now}).map(x=>x.id),['due','recent','high','medium']);
 assert.deepEqual(rankNetworkTargets(rows,{focus:'follow_up',now}).map(x=>x.id),['due']);
 assert.equal(JSON.stringify(rows),before);
});
test('introductions ask about supervision rather than invent it and never reuse another owner identity',()=>{
 assert.match(networkIntroduction('arash',{organization:'Test Clinic'}),/Dr Arash Entezar/);
 assert.match(networkIntroduction('arash',{organization:'Test Clinic'}),/whether Level 1 supervision could be considered/);
 assert.doesNotMatch(networkIntroduction('amir',{organization:'Test Clinic'}),/Arash|Level 1/);
 assert.equal(networkIntroduction('unknown',{}),'');
 assert(!networkIntroduction('arash',{organization:'A\nB'}).includes('\n'));
});
