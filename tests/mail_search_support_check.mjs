import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runMailSearchSupportCheck,MAIL_SEARCH_SUPPORT_VERSION} from '../cloud/mail-search-support-check.mjs';

const owner='11111111-1111-4111-8111-111111111111',now=Date.parse('2026-11-19T08:00:00Z');
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['google-schema.sql','mail-lead-search-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,'arash','synthetic-sub','synthetic@example.invalid','[]','NOT_A_TOKEN',0,'connected',now);
 const binding={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};}};
 const env={GOOGLE_DB:binding,MAIL_SEARCH_SUPPORT_CHECK:MAIL_SEARCH_SUPPORT_VERSION};let calls=0;
 const options={now,membership:async()=>({active:true}),checker:async(_env,{budget})=>{calls++;assert.equal(budget.remaining,1);return {allowed:false,reason:'paygo_limit_not_confirmed',plan:'Researcher',planLimit:1000,planUsage:0,paygoLimit:null,paygoUsage:0,keyLimit:1000,keyUsage:0,fieldTypes:{paygoLimit:'null'},api_key:'NEVER_STORE_THIS',raw:'NEVER_STORE_PROVIDER_BODY'};}};
 return {db,env,options,calls:()=>calls};
}
test('operator plan diagnosis touches nothing without its exact flag',async()=>{
 const env={};Object.defineProperty(env,'GOOGLE_DB',{get(){throw Error('disabled must not read storage');}});
 assert.equal((await runMailSearchSupportCheck(env)).status,'disabled');
});
test('one real current owner receives one bounded safe plan diagnostic without a search',async()=>{
 const f=fixture();assert.equal((await runMailSearchSupportCheck(f.env,f.options)).status,'recorded');
 const row=f.db.prepare('SELECT * FROM private_mail_lead_searches').get();assert.equal(row.owner_id,owner);assert.equal(row.status,'plan_check');assert.equal(row.error_code,'paygo_limit_not_confirmed');
 const summary=JSON.parse(row.result_json)[0];assert.equal(summary.plan,'Researcher');assert.equal(summary.paygoLimit,null);assert.equal(summary.fieldTypes.paygoLimit,'null');assert(!row.result_json.includes('NEVER_STORE'));
 assert.equal((await runMailSearchSupportCheck(f.env,f.options)).status,'already_recorded');assert.equal(f.calls(),1);
});
test('concurrent operator ticks cannot duplicate the provider usage call',async()=>{
 const f=fixture(),results=await Promise.all([runMailSearchSupportCheck(f.env,f.options),runMailSearchSupportCheck(f.env,f.options)]);
 assert.equal(results.filter(x=>x.attempted).length,1);assert.equal(f.calls(),1);assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_lead_searches').get().n,1);
});
test('inactive membership, missing owner and ambiguous owners never call the provider',async()=>{
 const f=fixture();assert.equal((await runMailSearchSupportCheck(f.env,{...f.options,membership:async()=>({active:false})})).status,'membership_unavailable');assert.equal(f.calls(),0);
 f.db.prepare("INSERT INTO google_accounts VALUES(?,'arash','other-sub','other@example.invalid','[]','NOT_A_TOKEN',0,'connected',?)").run('22222222-2222-4222-8222-222222222222',now);
 assert.equal((await runMailSearchSupportCheck(f.env,f.options)).status,'owner_not_unambiguous');assert.equal(f.calls(),0);
 f.db.prepare('DELETE FROM google_accounts').run();assert.equal((await runMailSearchSupportCheck(f.env,f.options)).status,'owner_not_unambiguous');
});
test('unexpected provider failures store a fixed diagnostic rather than exception contents',async()=>{
 const f=fixture();await runMailSearchSupportCheck(f.env,{...f.options,checker:async()=>{throw Error('SECRET_AND_PRIVATE_PROVIDER_BODY');}});
 const row=f.db.prepare('SELECT result_json,error_code FROM private_mail_lead_searches').get();assert.equal(row.error_code,'plan_check_temporarily_unavailable');assert(!row.result_json.includes('SECRET'));
});
