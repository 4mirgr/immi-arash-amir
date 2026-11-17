import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dispatchClinicBankReading,CLINIC_BANK_REFRESH_MS,CLINIC_BANK_LEASE_MS} from '../cloud/clinic-bank.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',at=Date.parse('2026-11-15T12:05:00Z');
const html=value=>new Response(value,{headers:{'Content-Type':'text/html'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({failSecondClaim=false}={}){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/clinic-bank-schema.sql',import.meta.url),'utf8'));let queries=0,claims=0;
 const env={CLINIC_BANK_READING_ENABLED:'true',GOOGLE_DB:{prepare(sql){queries++;return{bind(...args){return{async first(){if(sql.includes('RETURNING *')&&++claims===2&&failSecondClaim)throw Error('synthetic claim failure');return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:db.prepare(sql).run(...args)};}};}};}}};
 function seed(id,url,who=owner){db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,created_at,updated_at) VALUES(?,?,'arash',?,?,?)").run(id,who,url,new Date(at).toISOString(),new Date(at).toISOString());}
 return{db,env,seed,get queries(){return queries;}};
}

test('two independent clinic hosts overlap network waiting, keep claim-order receipts and check an active owner once per invocation',async()=>{
 const f=fixture();f.seed('a_first','https://first.example/');f.seed('b_second','https://second.example/');f.seed('c_third','https://third.example/');
 const gates={first:deferred(),second:deferred()},started=[],finished=[];let checks=0,active=0,maxActive=0;
 const fetcher=async url=>{if(url.endsWith('/robots.txt'))return new Response(null,{status:404});const site=new URL(url).hostname.split('.')[0];started.push(site);active++;maxActive=Math.max(maxActive,active);await gates[site].promise;active--;finished.push(site);return html('<main>Our practice provides preventive general practice care.</main>');};
 const run=dispatchClinicBankReading(f.env,fetcher,at,async()=>{checks++;return{active:true};});
 try{
  for(let i=0;i<20&&started.length<2;i++)await tick();
  assert.deepEqual(started,['first','second'],'both sites must start before the first response is released');assert.equal(checks,1);assert.equal(maxActive,2);
  gates.second.resolve();for(let i=0;i<20&&!finished.includes('second');i++)await tick();
  assert.deepEqual(finished,['second']);
 }finally{gates.first.resolve();gates.second.resolve();}
 const result=await run;assert.deepEqual(result.receipts.map(x=>x.id),['a_first','b_second']);assert.equal(result.processed,2);assert.equal(f.queries,4);
 assert.equal(f.db.prepare("SELECT status FROM clinic_bank_leads WHERE id='c_third'").get().status,'pending');
 // A new invocation must ask the server again, never reuse this run's active grant.
 await dispatchClinicBankReading(f.env,async url=>url.endsWith('/robots.txt')?new Response(null,{status:404}):html('<main>Public clinic information.</main>'),at+CLINIC_BANK_REFRESH_MS,async()=>{checks++;return{active:true};});assert.equal(checks,2);
});

test('rows for the same clinic host stay serial and a completed active membership check remains invocation-local',async()=>{
 const f=fixture();f.seed('a_first','https://clinic.example/one');f.seed('b_second','https://clinic.example/two');
 const first=deferred(),started=[];let active=0,maxActive=0,checks=0;
 const run=dispatchClinicBankReading(f.env,async url=>{if(url.endsWith('/robots.txt'))return new Response(null,{status:404});started.push(url);active++;maxActive=Math.max(maxActive,active);if(url.endsWith('/one'))await first.promise;active--;return html('<main>Our practice provides preventive clinical care.</main>');},at,async()=>{checks++;return{active:true};});
 try{for(let i=0;i<10&&!started.length;i++)await tick();await tick();assert.deepEqual(started,['https://clinic.example/one']);}finally{first.resolve();}
 const result=await run;assert.equal(result.processed,2);assert.equal(started.length,2);assert.equal(maxActive,1);assert.equal(checks,1);assert.equal(f.queries,4);
});

test('preclaimed same-host rows cannot be reclaimed at the next five-minute tick while either site remains active',async()=>{
 const f=fixture();f.seed('a_first','https://clinic.example/one');f.seed('b_second','https://clinic.example/two');
 const first=deferred(),second=deferred(),started=[],member=async()=>({active:true});let duplicateFetches=0;
 const run=dispatchClinicBankReading(f.env,async url=>{if(url.endsWith('/robots.txt'))return new Response(null,{status:404});started.push(url);await(url.endsWith('/one')?first.promise:second.promise);return html('<main>Our practice provides preventive general practice care.</main>');},at,member);
 try{
  for(let i=0;i<20&&!started.length;i++)await tick();assert.deepEqual(started,['https://clinic.example/one']);
  assert.equal(CLINIC_BANK_LEASE_MS,8*60000);assert(f.db.prepare('SELECT min(lease_until) n FROM clinic_bank_leads').get().n>at+5*60000);
  const noDuplicate=async()=>{duplicateFetches++;throw Error('Active site must not be fetched twice');};
  assert.equal((await dispatchClinicBankReading(f.env,noDuplicate,at+5*60000,member)).processed,0);
  first.resolve();for(let i=0;i<20&&started.length<2;i++)await tick();assert.equal(started.length,2);
  assert.equal((await dispatchClinicBankReading(f.env,noDuplicate,at+5*60000+1,member)).processed,0);assert.equal(duplicateFetches,0);
 }finally{first.resolve();second.resolve();}
 const result=await run;assert.equal(result.processed,2);assert(f.db.prepare('SELECT count(*) n FROM clinic_bank_leads WHERE lease_until=0').get().n===2);
});

test('a delayed completion cannot overwrite a newer lease and is never reported as stored evidence',async()=>{
 const f=fixture();f.seed('a_first','https://clinic.example/one');const gate=deferred();let started=false;
 const run=dispatchClinicBankReading(f.env,async url=>{if(url.endsWith('/robots.txt'))return new Response(null,{status:404});started=true;await gate.promise;return html('<main>Our practice provides preventive primary care.</main>');},at,async()=>({active:true}));
 let newer;
 try{for(let i=0;i<20&&!started;i++)await tick();assert(started);newer=at+CLINIC_BANK_LEASE_MS+60000;f.db.prepare("UPDATE clinic_bank_leads SET lease_until=?,result_json='{}' WHERE id='a_first'").run(newer);}finally{gate.resolve();}
 const result=await run,row=f.db.prepare('SELECT * FROM clinic_bank_leads').get();assert.equal(row.lease_until,newer);assert.equal(row.result_json,'{}');assert.equal(row.read_at,null);assert.equal(result.receipts[0].status,'lease_lost');
});

test('distinct owners retain separate fresh membership checks; inactive owners never fetch public pages',async()=>{
 const f=fixture();f.seed('a_first','https://first.example/');f.seed('b_second','https://second.example/',other);const checks=[],requests=[];
 const result=await dispatchClinicBankReading(f.env,async url=>{requests.push(url);return url.endsWith('/robots.txt')?new Response(null,{status:404}):html('<main>Public clinic information.</main>');},at,async(_env,id)=>{checks.push(id);return id===owner?{active:true}:{active:false,reason:'owner_inactive'};});
 assert.deepEqual(checks,[owner,other]);assert(!requests.some(x=>x.includes('second.example')));assert.equal(result.receipts[1].status,'owner_inactive');assert.equal(f.queries,4);
});

test('two concurrent reads retain at most twelve public HTTP requests and four D1 statements including redirects',async()=>{
 for(const separateOwners of [false,true]){
  const f=fixture();f.seed('a_first','https://first.example/');f.seed('b_second','https://second.example/',separateOwners?other:owner);
  Object.assign(f.env,{AUTOMATION_MEMBERSHIP_KEY:'x'.repeat(40),SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',SUPABASE_URL:'https://synthetic.supabase.co'});
  const perHost=new Map();let memberships=0;
  const result=await dispatchClinicBankReading(f.env,async(url,options)=>{
   if(url.includes('synthetic.supabase.co')){memberships++;assert.equal(options.method,'POST');return new Response('true');}
   const u=new URL(url);perHost.set(u.hostname,(perHost.get(u.hostname)||0)+1);
   if(u.pathname==='/robots.txt')return new Response(null,{status:404});
   if(u.pathname==='/')return new Response(null,{status:302,headers:{Location:'/home'}});
   if(u.pathname==='/home')return html('<main>Our practice provides chronic disease care. Published: jobs@'+u.hostname+'</main><a href="/services">Clinical services</a><a href="/team">Team</a>');
   if(u.pathname==='/services')return new Response(null,{status:302,headers:{Location:'/services/one'}});
   if(u.pathname==='/services/one')return new Response(null,{status:302,headers:{Location:'/services/two'}});
   if(u.pathname==='/services/two')return html('<main>Our practice provides preventive primary care.</main>');
   throw Error('request budget must prevent another page');
  },at);
  assert.equal(result.processed,2);assert.deepEqual([...perHost.values()],[6,6]);assert.equal(memberships,separateOwners?2:1);assert.equal(f.queries,4);
  const physicalRequests=[...perHost.values()].reduce((a,b)=>a+b,0)+memberships+f.queries;assert(physicalRequests<=18);
 }
});

test('a second claim storage failure does not abandon a site that was already leased',async()=>{
 const f=fixture({failSecondClaim:true});f.seed('a_first','https://first.example/');f.seed('b_second','https://second.example/');
 const result=await dispatchClinicBankReading(f.env,async url=>url.endsWith('/robots.txt')?new Response(null,{status:404}):html('<main>Our practice provides preventive general practice care.</main>'),at,async()=>({active:true}));
 assert.equal(result.status,'clinic_bank_storage_unavailable');assert.equal(result.processed,1);assert.equal(result.receipts[0].id,'a_first');
 assert.equal(f.db.prepare("SELECT lease_until FROM clinic_bank_leads WHERE id='a_first'").get().lease_until,0);assert.equal(f.db.prepare("SELECT status FROM clinic_bank_leads WHERE id='b_second'").get().status,'pending');assert.equal(f.queries,3);
});

test('completed inactive/unavailable membership results are not cached for a later same-owner site',async()=>{
 for(const reason of ['owner_inactive','membership_check_unavailable']){
  const f=fixture();f.seed('a_first','https://clinic.example/one');f.seed('b_second','https://clinic.example/two');let checks=0;const requests=[];
  const result=await dispatchClinicBankReading(f.env,async url=>{requests.push(url);return url.endsWith('/robots.txt')?new Response(null,{status:404}):html('<main>Our practice provides preventive primary care.</main>');},at,async()=>++checks===1?{active:false,reason}:{active:true});
  assert.equal(checks,2);assert.equal(result.receipts[0].status,reason);assert.equal(result.receipts[1].status,'public_page_read');assert(!requests.includes('https://clinic.example/one'));assert(requests.includes('https://clinic.example/two'));assert.equal(f.queries,4);
 }
});
