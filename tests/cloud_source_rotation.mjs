import test from 'node:test';
import assert from 'node:assert/strict';
import {planSourceRotation} from '../cloud/source-rotation.mjs';
const sources=Array.from({length:12},(_,i)=>({id:'s'+i}));
const at=12*3600000;
test('partial feed gets at most one early slot every third hour without skipping ordinary sources',()=>{
 const checks=[{source_id:'s9',partial:1,record_cursor:80,last_attempt_at:1,next_check_at:0,lock_until:0}];
 const first=planSourceRotation(sources,checks,0,at);assert.deepEqual(first.sources.map(s=>s.id),['s9','s0','s1']);assert.equal(first.nextPosition,2);assert.equal(first.continuationSource,'s9');
 const ordinary=planSourceRotation(sources,checks,2,at+3600000);assert.deepEqual(ordinary.sources.map(s=>s.id),['s2','s3','s4']);assert.equal(ordinary.nextPosition,5);assert.equal(ordinary.continuationSource,null);
});
test('due selection skips future/busy sources before consuming a provider slot',()=>{
 const checks=[{source_id:'s0',next_check_at:at+1,lock_until:0},{source_id:'s1',next_check_at:0,lock_until:at+1},{source_id:'s11',partial:1,record_cursor:40,next_check_at:at+1,lock_until:0}];
 const result=planSourceRotation(sources,checks,0,at);assert.deepEqual(result.sources.map(s=>s.id),['s2','s3','s4']);assert.equal(result.continuationSource,null);assert.equal(result.nextPosition,5);
});
test('oldest due continuation wins and a continuation already in rotation is not repeated',()=>{
 const checks=[{source_id:'s0',partial:1,record_cursor:40,last_attempt_at:1,next_check_at:0,lock_until:0},{source_id:'s10',partial:1,record_cursor:40,last_attempt_at:2,next_check_at:0,lock_until:0}];
 const result=planSourceRotation(sources,checks,0,at);assert.deepEqual(result.sources.map(s=>s.id),['s0','s1','s2']);assert.equal(result.nextPosition,3);
});
test('ordinary sources remain reachable while many partial sources compete; no fourth fetch is created',()=>{
 const checks=sources.slice(6).map((s,i)=>({source_id:s.id,partial:1,record_cursor:40,last_attempt_at:i,next_check_at:0,lock_until:0})),seen=new Set();let position=0;
 for(let turn=0;turn<9;turn++){
  const result=planSourceRotation(sources,checks,position,at+turn*3600000);assert(result.sources.length<=3);for(const s of result.sources)seen.add(s.id);position=result.nextPosition;
 }
 assert.equal(seen.size,sources.length);
});
test('empty and entirely cooling-down registries start no fetches',()=>{
 assert.deepEqual(planSourceRotation([],[],0,at).sources,[]);
 assert.deepEqual(planSourceRotation(sources,sources.map(s=>({source_id:s.id,next_check_at:at+1,lock_until:0})),0,at).sources,[]);
});
