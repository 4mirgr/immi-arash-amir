import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {SOURCE_REGISTRY,normalizeSourceRecords,validateSourceUrl,collectRegisteredSources,handleRegisteredSourcesRequest,registeredSourceStatuses} from '../cloud/source-collectors.mjs';
const source=id=>SOURCE_REGISTRY.find(s=>s.id===id);
const pageup=(id='1',extra={})=>({Id:id,Title:'Medical Registrar - Internal Medicine',CategoryList:['Medical'],Brand:'Synthetic Hospital',OpeningDateUtc:'/Date(1793491200000)/',ClosingDateUtc:'/Date(4102444800000)/',...extra});
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['opportunity-v2-schema.sql','source-registry-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const prepare=sql=>({bind(...args){const st=db.prepare(sql);return {async first(){return st.get(...args)||null;},async all(){return {results:st.all(...args)};},async run(){return {success:true,meta:st.run(...args)};},_run(){return st.run(...args);}};}});
 return {db,env:{OPPORTUNITY_DB:{prepare,async batch(items){db.exec('BEGIN');try{for(const item of items)item._run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}}};
}
const rss=(url='https://bandi.unibo.it/call/synthetic',extra='')=>`<?xml version="1.0"?><rss><channel><item><title>Borsa di studio in medicina</title><link>${url}</link><guid>${url}</guid><pubDate>Tue, 03 Nov 2026 10:00:00 +0100</pubDate><description>Fictional fixture only.</description>${extra}</item></channel></rss>`;
function fetchFixture(log=[]){return async(url,options)=>{log.push({url,options});if(url.includes('bandi.unibo'))return new Response(rss(),{headers:{etag:'"rss"'}});return new Response(JSON.stringify([url.includes('/513/')?pageup('2',{Title:'Research Fellow (Inflammation and Immunology)',Brand:'Faculty of Medicine'}):pageup()]),{headers:{etag:'"json"'}});};}

test('registry covers all Australian jurisdictions honestly and Italy only Amir',()=>{
 assert.deepEqual([...new Set(SOURCE_REGISTRY.filter(s=>s.country==='AU'&&s.state!=='UNKNOWN').map(s=>s.state))].sort(),['ACT','NSW','NT','QLD','SA','TAS','VIC','WA']);
 assert.equal(SOURCE_REGISTRY.filter(s=>s.executable).length,4);
 assert(SOURCE_REGISTRY.filter(s=>s.country==='IT').every(s=>s.profileScope==='amir'));
 assert(SOURCE_REGISTRY.filter(s=>!s.executable).every(s=>s.reason&&s.configurationStatus!=='executable'));
});
test('fixed feed and record host restrictions reject SSRF, credentials and redirection targets',async()=>{
 const s=source('tas-pageup-759');
 for(const value of ['http://careers.pageuppeople.com/759/cw/en/jobs.json','https://127.0.0.1/','https://careers.pageuppeople.com.evil.invalid/','https://user:pw@careers.pageuppeople.com/','https://careers.pageuppeople.com:8443/','https://careers.pageuppeople.com/#fragment'])assert.throws(()=>validateSourceUrl(value,s));
 await assert.rejects(()=>normalizeSourceRecords({id:'unregistered',feedUrl:'https://127.0.0.1'},'[]'));
 await assert.rejects(()=>normalizeSourceRecords(source('unibo-research-contracts'),rss('https://127.0.0.1/call')));
 await assert.rejects(()=>normalizeSourceRecords(source('unibo-research-contracts'),'<!DOCTYPE rss [<!ENTITY x SYSTEM "http://127.0.0.1">]>'+rss()));
});
test('PageUp filters preserve actual advertised dates and never infer eligibility',async()=>{
 const rows=await normalizeSourceRecords(source('tas-pageup-759'),JSON.stringify([pageup(),pageup('2',{Title:'Nurse Practitioner'}),pageup('3',{Title:'Medical Registrar',CategoryList:['Administration']})]));
 assert.equal(rows.length,1);assert.equal(rows[0].externalId,'1');assert.equal(rows[0].opportunityType,'job');assert.equal(rows[0].closingAt,'2100-01-01T00:00:00.000Z');assert.equal(rows[0].sponsorship,undefined);
 await assert.rejects(()=>normalizeSourceRecords(source('tas-pageup-759'),JSON.stringify([pageup(),pageup('4',{ClosingDateUtc:'tomorrow'})])));
 assert.equal((await normalizeSourceRecords(source('tas-pageup-759'),'[]')).length,0);
});
test('Bologna RSS imports unknown deadline and stable URL-hash identity',async()=>{
 const a=await normalizeSourceRecords(source('unibo-scholarship-funding'),rss());
 assert.equal(a.length,1);assert.equal(a[0].opportunityType,'scholarship');assert.equal(a[0].closingAt,null);assert.match(a[0].externalId,/^rss_[a-f0-9]{64}$/);
 const b=await normalizeSourceRecords(source('unibo-scholarship-funding'),rss());assert.equal(a[0].externalId,b[0].externalId);
});
test('bounded three-source rotation, storage scope, and conditional ETags work',async()=>{
 const {db,env}=fixture(),log=[];
 let receipt=await collectRegisteredSources(env,fetchFixture(log));assert.equal(log.length,3);assert.equal(receipt.sources.length,3);assert(receipt.imported<=100);
 assert(log.every(v=>v.options.redirect==='error'&&v.options.signal));
 await collectRegisteredSources(env,fetchFixture(log));assert.equal(log.length,4,'remaining fourth source next invocation; earlier sources cool down');
 const it=JSON.parse(db.prepare("SELECT data FROM opportunity_editions WHERE country='IT' LIMIT 1").get().data);assert.equal(it.profileScope,'amir');assert.equal(it.status,'unknown');
 db.exec('UPDATE registered_source_checks SET next_check_at=0');
 const conditional=[];await collectRegisteredSources(env,async(url,options)=>{conditional.push(options);return new Response(null,{status:304});});
 assert(conditional.every(o=>o.headers['If-None-Match']));
 assert.equal(db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,4);
});
test('source errors preserve previous snapshot and use cooldown',async()=>{
 const {db,env}=fixture();await collectRegisteredSources(env,fetchFixture());const before=db.prepare('SELECT count(*) n FROM opportunity_editions').get().n;
 db.exec('UPDATE registered_source_checks SET next_check_at=0');
 const log=[];const receipt=await collectRegisteredSources(env,async(url,options)=>{log.push(options);return new Response('[]',{status:302,headers:{location:'https://127.0.0.1/'}});});
 assert.equal(receipt.status,'partial_failure');assert(receipt.sources.every(s=>s.error==='source_redirect_rejected'));assert.equal(db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,before);
 assert(db.prepare("SELECT next_check_at,last_attempt_at FROM registered_source_checks WHERE status='failed' LIMIT 1").get().next_check_at>Date.now());
});
test('malformed and oversized source bodies are rejected without replacing records',async()=>{
 for(const body of ['<html>Login</html>','{"items":[]}',JSON.stringify([pageup(),pageup('bad')])])await assert.rejects(()=>normalizeSourceRecords(source('tas-pageup-759'),body));
 await assert.rejects(()=>normalizeSourceRecords(source('tas-pageup-759'),' '.repeat(3000001)));
});
test('large valid feed imports bounded slices with continuation and no absence deletion',async()=>{
 const {db,env}=fixture();db.exec("UPDATE source_collector_state SET position=0");
 const rows=Array.from({length:120},(_,i)=>pageup(String(i+1)));
 const receipt=await collectRegisteredSources(env,async(url)=>url.includes('/759/')?new Response(JSON.stringify(rows),{headers:{etag:'"many"'}}):url.includes('/513/')?new Response('[]'):new Response('<rss><channel></channel></rss>'));
 assert.equal(receipt.sources[0].imported,40);assert.equal(receipt.sources[0].partial,true);assert.equal(receipt.sources[0].nextCursor,40);
 db.exec('UPDATE registered_source_checks SET next_check_at=0');db.exec('UPDATE source_collector_state SET position=0');
 const seen=[];await collectRegisteredSources(env,async(url,options)=>{if(url.includes('/759/')){seen.push(options);return new Response(JSON.stringify(rows));}return url.includes('/513/')?new Response('[]'):new Response('<rss><channel></channel></rss>');});
 assert.equal(seen[0].headers['If-None-Match'],undefined);assert.equal(db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,80);
});
test('sources route enforces workspace, excludes Italy for Arash, rejects client endpoints',async()=>{
 const {env}=fixture();
 const request=(path,options={})=>new Request('https://app.example'+path,options);
 let res=await handleRegisteredSourcesRequest(request('/api/opportunities/sources'),env,{userId:'one',profileId:'arash'});const data=await res.json();assert(data.sources.every(s=>s.country!=='IT'));
 assert((await registeredSourceStatuses(env,'amir')).some(s=>s.country==='IT'));
 assert.equal((await handleRegisteredSourcesRequest(request('/api/opportunities/sources'),env,{})).status,403);
 assert.equal((await handleRegisteredSourcesRequest(request('/api/opportunities/refresh',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}),env,{userId:'one',profileId:'arash'})).status,403);
 assert.equal((await handleRegisteredSourcesRequest(request('/api/opportunities/refresh',{method:'POST',body:JSON.stringify({url:'http://127.0.0.1'})}),env,{userId:'one',profileId:'amir'})).status,400);
});
test('Arash refresh totals and errors cover visible sources only',async()=>{
 const {db,env}=fixture();db.exec('UPDATE source_collector_state SET position=1');
 const response=await handleRegisteredSourcesRequest(new Request('https://app.example/api/opportunities/refresh',{method:'POST',body:'{}'}),env,{userId:'arash-owner',profileId:'arash'},async(url)=>url.includes('bandi.unibo')?new Response('blocked',{status:403}):new Response(JSON.stringify([pageup('2',{Title:'Research Fellow in Clinical Medicine',Brand:'Faculty of Medicine'})])));
 const receipt=await response.json();assert.equal(receipt.status,'completed');assert.equal(receipt.imported,1);assert.equal(receipt.sources.length,1);assert.equal(receipt.sources[0].sourceId,'monash-pageup-513');
});
