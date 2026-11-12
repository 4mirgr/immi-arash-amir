import test from 'node:test';
import assert from 'node:assert/strict';
import {runBackgroundCycle} from '../cloud/background-cycle.mjs';

const env={synthetic:true},fetcher=()=>{throw Error('No actual provider requests allowed');};
function fixture({publication={processed:0},throws=[]}={}){
 const calls=[],stages={};
 for(const name of ['publication','reading','discoveryAI','clinicBankGrowth','clinicBank'])stages[name]=async(...args)=>{calls.push({name,args});if(throws.includes(name))throw Error('PRIVATE_PROVIDER_ERROR_MUST_NOT_ESCAPE');return name==='publication'?publication:{processed:2,synthetic:name};};
 return{calls,stages};
}

test('idle publication keeps both core readers every five minutes and rotates auxiliaries every ten minutes',async()=>{
 const f=fixture(),first=await runBackgroundCycle(env,{now:0,fetcher,stages:f.stages});
 assert.deepEqual(f.calls.map(x=>x.name),['publication','reading','clinicBank','discoveryAI']);
 assert.equal(first.clinicBankGrowth.status,'deferred');assert.equal(first.clinicBankGrowth.reason,'auxiliary_rotation');
 assert.equal(first.backgroundCadenceMinutes,5);assert.equal(first.auxiliaryCadenceMinutes,10);
 assert.deepEqual(f.calls.find(x=>x.name==='discoveryAI').args,[env,0]);
 f.calls.length=0;const second=await runBackgroundCycle(env,{now:300000,fetcher,stages:f.stages});
 assert.deepEqual(f.calls.map(x=>x.name),['publication','reading','clinicBank','clinicBankGrowth']);
 assert.equal(second.discoveryAI.status,'deferred');
 assert.deepEqual(f.calls.find(x=>x.name==='clinicBank').args,[env,fetcher,300000]);
});

test('a claimed publication gets the entire invocation without being retried or sharing public work',async()=>{
 const f=fixture({publication:{processed:1,result:{status:'published'}}});
 const result=await runBackgroundCycle(env,{now:300000,fetcher,stages:f.stages});
 assert.deepEqual(f.calls.map(x=>x.name),['publication']);
 for(const name of ['reading','discoveryAI','clinicBankGrowth','clinicBank'])assert.deepEqual(result[name],{status:'deferred',reason:'publication_budget_reserved',retryAfterMinutes:5});
});

test('unknown publication outcomes and thrown errors fail closed, never retry transport and do not expose error text',async()=>{
 for(const options of [{throws:['publication']},{publication:undefined},{publication:{enabled:true}},{publication:{processed:'0'}}]){
  const f=fixture(options);
  if(Object.hasOwn(options,'publication')&&options.publication===undefined)f.stages.publication=async()=>{f.calls.push({name:'publication'});return undefined;};
  const result=await runBackgroundCycle(env,{now:0,fetcher,stages:f.stages});
  assert.deepEqual(f.calls.map(x=>x.name),['publication']);assert.equal(result.reading.status,'deferred');assert(!JSON.stringify(result).includes('PRIVATE_PROVIDER'));
 }
});

test('one failing reader cannot starve the other owner-private queue or the auxiliary work',async()=>{
 for(const now of [0,300000]){
  const f=fixture({throws:['reading']});const result=await runBackgroundCycle(env,{now,fetcher,stages:f.stages});
  assert.equal(result.reading.status,'stage_failed');assert.equal(result.clinicBank.processed,2);
  assert(f.calls.some(x=>x.name===(now===0?'discoveryAI':'clinicBankGrowth')));assert(!JSON.stringify(result).includes('PRIVATE_PROVIDER'));
 }
});

test('auxiliary failures are isolated and never trigger a retry, while core cadence remains stable across ticks',async()=>{
 const f=fixture({throws:['discoveryAI','clinicBankGrowth']});
 for(const now of [0,300000,600000,900000])await runBackgroundCycle(env,{now,fetcher,stages:f.stages});
 for(const name of ['publication','reading','clinicBank'])assert.equal(f.calls.filter(x=>x.name===name).length,4);
 for(const name of ['discoveryAI','clinicBankGrowth'])assert.equal(f.calls.filter(x=>x.name===name).length,2);
});

test('worst-case lane budgets retain headroom under free D1 and subrequest limits, including write recovery',async()=>{
 // Physical binding+HTTP upper bounds: publication idle1; public reader8D1
 // requests+12HTTP+2write recovery; bank4D1+12HTTP+2membership; growth5D1
 // requests+1membership; AI3D1 requests+1inference. SQL counts include batches.
 const caps={publication:{queries:1,requests:1},reading:{queries:29,requests:22},clinicBank:{queries:4,requests:18},clinicBankGrowth:{queries:6,requests:6},discoveryAI:{queries:4,requests:4}};
 for(const now of [0,300000]){
  const use={queries:0,requests:0},stages={};
  for(const [name,cap]of Object.entries(caps))stages[name]=async()=>{use.queries+=cap.queries;use.requests+=cap.requests;return {processed:name==='publication'?0:2};};
  await runBackgroundCycle(env,{now,fetcher,stages});assert(use.queries<=40);assert(use.requests<=47);assert(use.queries<50);assert(use.requests<50);
 }
});

test('invalid scheduled time starts no stage or provider operation',async()=>{
 const f=fixture();assert.equal((await runBackgroundCycle(env,{now:NaN,fetcher,stages:f.stages})).status,'invalid_scheduled_time');assert.equal(f.calls.length,0);
});


test('an explicit invocation quota failure defers remaining work rather than hitting the exhausted runtime again',async()=>{
 for(const failure of ['Too many D1 queries','Too many subrequests','subrequest_budget_exhausted']){
  const f=fixture();f.stages.reading=async()=>{f.calls.push({name:'reading'});throw Error(failure);};
  const result=await runBackgroundCycle(env,{now:0,fetcher,stages:f.stages});
  assert.deepEqual(f.calls.map(x=>x.name),['publication','reading']);assert.equal(result.reading.status,'invocation_budget_exhausted');
  for(const name of ['clinicBank','discoveryAI','clinicBankGrowth'])assert.equal(result[name].reason,'invocation_budget_exhausted');
 }
 const f=fixture();f.stages.clinicBank=async()=>{f.calls.push({name:'clinicBank'});throw Error('Too many subrequests');};
 const result=await runBackgroundCycle(env,{now:300000,fetcher,stages:f.stages});
 assert.deepEqual(f.calls.map(x=>x.name),['publication','reading','clinicBank']);assert.equal(result.clinicBankGrowth.reason,'invocation_budget_exhausted');
});
