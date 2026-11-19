import test from 'node:test';
import assert from 'node:assert/strict';
import {runMailOpportunityNotificationCycle} from '../cloud/mail-opportunity-notification-cycle.mjs';

const even=120000,odd=240000,dedicated=360000;
function fixture(privateResult={status:'idle',attempted:0},reading={status:'idle',attempted:false}){
 const calls=[];
 return {calls,options:{now:even,alerts:async()=>{calls.push('private');return privateResult;},research:async()=>{calls.push('research');return reading;},publicAlerts:async()=>{calls.push('public');return {status:'idle',attempted:0};}}};
}
test('an attempted or uncertain private alert consumes this invocation without another transport',async()=>{
 for(const value of [{status:'sent',attempted:1},{status:'outcome_unknown_no_retry',attempted:1},{status:'invalid_candidate',attempted:0},{status:'idle'}]){
  const f=fixture(value),result=await runMailOpportunityNotificationCycle({},f.options);
  assert.deepEqual(f.calls,['private']);assert.equal(result.public.status,'deferred');
 }
 const f=fixture();f.options.alerts=async()=>{throw Error('unknown');};
 const result=await runMailOpportunityNotificationCycle({},f.options);assert.equal(result.private.status,'outcome_unknown_no_retry');assert.deepEqual(f.calls,[]);
});
test('only strictly idle lanes permit subsequent work and public opportunities retain scheduled turns',async()=>{
 const idle=fixture();await runMailOpportunityNotificationCycle({},idle.options);assert.deepEqual(idle.calls,['private','research','public']);
 const busy=fixture(undefined,{status:'read',attempted:true});await runMailOpportunityNotificationCycle({},busy.options);assert.deepEqual(busy.calls,['private','research']);
 const unknown=fixture(undefined,{status:'idle'});await runMailOpportunityNotificationCycle({},unknown.options);assert.deepEqual(unknown.calls,['private','research']);
 const rotated=fixture();await runMailOpportunityNotificationCycle({},{...rotated.options,now:odd});assert.deepEqual(rotated.calls,['private','public']);
});
test('research failure defers transport and cannot result in automatic public fallback',async()=>{
 const f=fixture();f.options.research=async()=>{f.calls.push('research');throw Error('unavailable');};
 const result=await runMailOpportunityNotificationCycle({},f.options);assert.equal(result.research.status,'temporarily_unavailable');assert.deepEqual(f.calls,['private','research']);
});
test('a dedicated research turn progresses despite a permanently deferred private alert',async()=>{
 const f=fixture({status:'source_check_deferred',attempted:0},{status:'read',attempted:1});
 const result=await runMailOpportunityNotificationCycle({},{...f.options,now:dedicated});
 assert.deepEqual(f.calls,['research']);assert.equal(result.research.status,'read');assert.equal(result.private.status,'deferred_research_turn');
});
test('six-minute rotation reserves research and public turns without appending transport after an attempt',async()=>{
 const f=fixture(undefined,{status:'read',attempted:1});
 for(const now of [60000,180000,300000])await runMailOpportunityNotificationCycle({}, {...f.options,now});
 assert.deepEqual(f.calls,['research','private','research','private','public']);
 const invalid=fixture();await runMailOpportunityNotificationCycle({}, {...invalid.options,now:NaN});assert.deepEqual(invalid.calls,[]);
});
