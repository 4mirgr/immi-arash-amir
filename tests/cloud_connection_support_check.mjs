import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {CONNECTION_SUPPORT_VERSION,runConnectionSupportCheck as run} from '../cloud/connection-support-check.mjs';
const owner='11111111-1111-4111-8111-111111111111';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/google-schema.sql',import.meta.url),'utf8'));
 const binding={prepare(sql){const s=db.prepare(sql);let args=[];return{bind(...v){args=v;return this;},async first(){return s.get(...args)||null;},async all(){return{results:s.all(...args)};},async run(){return{meta:s.run(...args)};}};}};
 const seed=(id=owner,profile='arash')=>db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(id,profile,'subject'+id,'synthetic@example.invalid','[]','PRIVATE_TOKEN',0,'connected',0);
 const env={GOOGLE_DB:binding,CONNECTION_SUPPORT_CHECK:CONNECTION_SUPPORT_VERSION},calls=[];
 const check=async(_env,id,profile)=>{calls.push({id,profile});assert.equal(id,owner);assert.equal(profile,'arash');return{email:'PRIVATE_EMAIL',token:'PRIVATE_TOKEN',verification:{state:'verified',code:null,recoveryAction:'none'},serviceChecks:{calendar:{state:'available',code:null}}};};
 return{db,seed,env,calls,options:{membership:async()=>({active:true}),google:check,telegram:check,fetcher:()=>{throw Error('Transport is forbidden in this test');}}};
}
test('support diagnosis is operator enabled, fresh membership bound, unique-owner and single-claim',async()=>{
 const f=fixture();f.seed();f.seed('22222222-2222-4222-8222-222222222222','amir');
 assert.equal((await run({...f.env,CONNECTION_SUPPORT_CHECK:undefined},f.options)).attempted,false);
 assert.equal((await run(f.env,{...f.options,membership:async()=>({active:false})})).attempted,false);assert.equal(f.calls.length,0);
 const first=await run(f.env,f.options);assert.equal(first.attempted,true);assert.equal(f.calls.length,2);
 const saved=f.db.prepare('SELECT code FROM google_oauth_diagnostics').get().code;assert(!saved.includes('PRIVATE'));assert.equal(JSON.parse(saved).google.state,'verified');
 assert.equal((await run(f.env,f.options)).status,'already_recorded');assert.equal(f.calls.length,2);
 f.seed('33333333-3333-4333-8333-333333333333');assert.equal((await run(f.env,f.options)).status,'owner_not_unambiguous');assert.equal(f.calls.length,2);
});
test('support failures retain only safe codes and never retry a provider or send a test message',async()=>{
 const f=fixture();f.seed();let count=0;const result=await run(f.env,{...f.options,google:async()=>{count++;throw Error('PRIVATE_TOKEN');}});assert.equal(result.status,'recorded');assert.equal(count,1);assert.equal(f.calls.length,1);
 const saved=f.db.prepare('SELECT code FROM google_oauth_diagnostics').get().code;assert(!saved.includes('PRIVATE'));assert.equal(JSON.parse(saved).google.code,'support_provider_unavailable');
});
