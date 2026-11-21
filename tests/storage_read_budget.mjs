import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{createHandler} from '../cloud/worker.mjs';
import {storageReadPause,storageDailyReadFailure,storageBackedPath,storagePauseResponse} from '../cloud/storage-read-budget.mjs';
const now=Date.parse('2026-11-21T11:00:00Z'),until='2026-11-22T00:00:05.000Z';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('finite configured pause expires automatically and invalid or indefinite flags do not freeze the service',()=>{
 const paused=storageReadPause({D1_READS_RESUME_AFTER:until},{now});assert.equal(paused.retryAt,until);assert.equal(paused.error,'storage_daily_read_limit');assert(paused.retryAfterSeconds>0);
 assert.equal(storageReadPause({D1_READS_RESUME_AFTER:until},{now:Date.parse(until)}),null);
 for(const value of ['true','forever','Infinity','2027-01-01T00:00:00Z','0','https://bad.invalid'])assert.equal(storageReadPause({D1_READS_RESUME_AFTER:value},{now}),null);
 assert.equal(storageReadPause({D1_READS_RESUME_AFTER:String(Date.parse(until))},{now}).retryAt,until);
});
test('only the documented daily read failure is classified; next reset is UTC and provider errors stay distinct',()=>{
 const inner=Error("D1_ERROR: Your account has exceeded D1's free tier limits for daily row reads. Please wait until midnight UTC.");
 assert(storageDailyReadFailure(inner));assert(storageDailyReadFailure(Error('storage unavailable',{cause:inner})));
 for(const wording of ['daily rows read','daily row reads','daily rows-read','daily read rows'])assert(storageDailyReadFailure(Error('D1_ERROR: Account exceeded free tier limits for '+wording+'.')));
 for(const value of [Error('D1 daily row writes limit exceeded'),Error('Google API daily request limit exceeded'),Error('D1 query exceeded row limit'),Error('D1 database unavailable')])assert.equal(storageDailyReadFailure(value),false);
 const cyclic=Error('ordinary');cyclic.cause=cyclic;assert.equal(storageDailyReadFailure(cyclic),false);
 assert.equal(storageReadPause({},{now,failure:true}).retryAt,until);
});
test('pre-dispatch pause never claims an after-action failure is safe to retry',async()=>{
 const pause=storageReadPause({},{now,failure:true});
 const before=storagePauseResponse(pause,{actionNotStarted:true}),unknown=storagePauseResponse(pause);
 assert.equal(before.status,503);assert.equal(before.headers.get('Cache-Control'),'no-store');assert.equal(Number(before.headers.get('Retry-After')),pause.retryAfterSeconds);
 assert.equal((await before.json()).actionNotStarted,true);assert.equal((await unknown.json()).actionNotStarted,undefined);
});
test('all cron lanes defer without touching databases or grants while the verified daily pause is active',async()=>{
 for(const cron of ['* * * * *','1-59/2 * * * *','*/5 * * * *','0 * * * *','15 */6 * * *']){
  const env={D1_READS_RESUME_AFTER:String(Date.now()+60000)};for(const name of ['GOOGLE_DB','OPPORTUNITY_DB','GOOGLE_TOKEN_KEY'])Object.defineProperty(env,name,{get(){throw Error('Paused lane must not touch storage or transport');}});
  const result=await worker.scheduled({cron,scheduledTime:Date.now()-86400000},env);assert.equal(result.status,'storage_daily_read_limit');assert.equal(result.deferred,true);
 }
});
test('a quota failure caught after a lane began does not claim no transport action occurred',async()=>{
 const env={};Object.defineProperty(env,'OPPORTUNITY_DB',{get(){throw Error("D1_ERROR: Your account has exceeded D1 free tier daily row read limits.");}});
 const result=await worker.scheduled({cron:'0 * * * *'},env);assert.equal(result.status,'storage_daily_read_limit');assert.equal(result.transportOutcome,'not_inferred');assert.equal(Object.hasOwn(result,'automaticEmailSending'),false);
});
test('authenticated storage routes pause before actions; public health, membership and owned CV metadata remain available',async()=>{
 const calls=[],env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',D1_READS_RESUME_AFTER:String(Date.now()+60000)};
 for(const name of ['GOOGLE_DB','OPPORTUNITY_DB'])env[name]={prepare(){throw Error('Read gate must precede D1 queries');},batch(){throw Error('Read gate must precede D1 writes');}};
 const handle=createHandler(async(url,options)=>{calls.push({url,method:options?.method});if(url.endsWith('/auth/v1/user'))return json({id:'owner-arash'});if(url.includes('/immi_memberships'))return json([{profile_id:'arash'}]);if(url.includes('/immi_cv_'))return json([]);throw Error('Unexpected provider request');});
 const get=path=>handle(new Request('https://app.example'+path,{headers:{Authorization:'Bearer synthetic'}}),env);
 assert.equal((await handle(new Request('https://app.example/api/health'),env)).status,200);
 assert.equal((await handle(new Request('https://app.example/api/public-config'),env)).status,200);
 assert.equal((await handle(new Request('https://app.example/api/google/mail-opportunities'),env)).status,401);
 assert.equal((await get('/api/me')).status,200);assert.equal((await get('/api/cv/versions')).status,200);
 const result=await get('/api/google/mail-opportunities');assert.equal(result.status,503);assert.equal((await result.json()).actionNotStarted,true);
 const write=await handle(new Request('https://app.example/api/google/mail-opportunities/mop_'+'a'.repeat(32)+'/send',{method:'POST',headers:{Authorization:'Bearer synthetic',Origin:'https://app.example'},body:'{}'}),env);assert.equal(write.status,503);assert.equal((await write.json()).actionNotStarted,true);
 assert.equal((await get('/api/google/mail-opportunities?profile=amir')).status,403);assert(calls.every(call=>!call.method||call.method==='GET'));
 assert.equal(storageBackedPath('/api/settings'),false);assert.equal(storageBackedPath('/api/bootstrap'),true);
});
