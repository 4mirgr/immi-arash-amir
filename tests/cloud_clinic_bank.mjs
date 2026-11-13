import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {clinicBankURL,handleClinicBankRequest,dispatchClinicBankReading,CLINIC_BANK_REFRESH_MS,clinicBankClinicalExcerpt} from '../cloud/clinic-bank.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',origin='https://app.example';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/clinic-bank-schema.sql',import.meta.url),'utf8'));
 const binding={prepare(sql){return{bind(...args){return{async all(){return{results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){return{meta:db.prepare(sql).run(...args)};}};}};},async batch(s){return Promise.all(s.map(q=>q.run()));}};
 return{db,env:{GOOGLE_DB:binding,CLINIC_BANK_READING_ENABLED:'true'}};
}
async function api(env,path,{userId=owner,profileId='arash',method='GET',body,headers={}}={}){return handleClinicBankRequest(new Request(origin+'/api/clinic-bank/'+path,{method,headers:{Origin:origin,...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{userId,profileId});}
const member=async()=>({active:true});
const input={items:[{url:'https://clinic.example/',name:'Synthetic Clinic',provenance:{sourceFile:'synthetic.xlsx',sourceSheet:'sheet',sourceRow:2}}]};
const fetcher=async url=>String(url).endsWith('/robots.txt')?new Response('',{status:404}):new Response('<html><title>Synthetic Clinic</title><main>Contact <a href="mailto:jobs@clinic.example">jobs@clinic.example</a> for enquiries.</main></html>',{headers:{'Content-Type':'text/html'}});
test('clinic URL candidates reject private address spellings, credentials, login paths and secrets',()=>{
 for(const url of ['http://clinic.example/','https://127.0.0.1/','https://2130706433/','https://[::1]/','https://localhost/','https://local.internal/','https://clinic.example:444/','https://x:y@clinic.example/','https://clinic.example/login','https://clinic.example/%61uth','https://clinic.example/?token=secret','https://clinic.example/#secret','https://clinic.example/white space'])assert.equal(clinicBankURL(url),null,url);
 assert.equal(clinicBankURL('https://Clinic.example/contact'),'https://clinic.example/contact');
});
test('import is owner-private, idempotent and never promotes spreadsheet email or geographic assertions',async()=>{
 const{env}=fixture();let r=await api(env,'import',{method:'POST',body:input});assert.equal(r.status,201);assert.equal((await r.json()).imported,1);
 r=await api(env,'import',{method:'POST',body:input});assert.equal((await r.json()).imported,0);
 const owned=await(await api(env,'items')).json();assert.equal(owned.items.length,1);assert.equal(owned.items[0].leadOnly,true);assert.equal(owned.items[0].vacancyVerified,false);assert.equal(owned.items[0].sendingApproved,false);assert.deepEqual(owned.items[0].contacts,[]);
 assert.equal((await(await api(env,'items',{userId:other})).json()).items.length,0);
 assert.equal((await api(env,'items?profile=amir')).status,403);assert.equal((await api(env,'items',{profileId:'amir'})).status,403);
 assert.equal((await api(env,'import',{method:'POST',body:{items:[{...input.items[0],email:'private@sheet.example'}]}})).status,400);
 assert.equal((await api(env,'import',{method:'POST',body:input,headers:{Origin:'https://other.example'}})).status,403);
});
test('bounded public reads record provenance and contacts, refresh weekly, no provider transport',async()=>{
 const{env,db}=fixture();await api(env,'import',{method:'POST',body:{items:[...input.items,{url:'https://second.example/'},{url:'https://third.example/'}]}});
 let requests=[];const at=Date.parse('2026-11-11T00:00:00Z');const spy=(url,options)=>{requests.push([url,options]);assert.equal(options.method,undefined);assert(!String(url).includes('google'));return fetcher(url);};
 const run=await dispatchClinicBankReading(env,spy,at,member);assert.equal(run.processed,2);assert.equal(requests.length,4);
 assert.equal(db.prepare("SELECT count(*) AS n FROM clinic_bank_leads WHERE status='pending'").get().n,1);
 const done=db.prepare("SELECT * FROM clinic_bank_leads WHERE status='public_contacts_found' LIMIT 1").get();assert(done);assert.equal(done.available_at,at+CLINIC_BANK_REFRESH_MS);assert.equal(done.new_email_count,1);
 const data=JSON.parse(done.result_json);assert.equal(data.contacts.find(c=>c.type==='email').sourceURL,done.url);assert.equal(data.contacts.find(c=>c.type==='email').value,'jobs@clinic.example');
 await dispatchClinicBankReading(env,spy,at,member);requests=[];assert.equal((await dispatchClinicBankReading(env,spy,at,member)).processed,0);assert.equal(requests.length,0);
 const status=await(await api(env,'status')).json();assert.equal(status.counts.total,3);assert.equal(status.counts.read,3);assert.equal(status.automaticSending,false);
});
test('robots denial backs off, no success receipt; disabled reader does no work',async()=>{
 const{env,db}=fixture();await api(env,'import',{method:'POST',body:input});let n=0;const at=Date.parse('2026-11-11T00:00:00Z');
 assert.equal((await dispatchClinicBankReading({...env,CLINIC_BANK_READING_ENABLED:'false'},()=>{throw Error('no fetch');},at)).processed,0);
 const run=await dispatchClinicBankReading(env,async()=>{n++;return new Response('User-agent: *\nDisallow: /');},at,member);assert.equal(run.processed,1);assert.equal(n,1);
 const row=db.prepare('SELECT * FROM clinic_bank_leads').get();assert.equal(row.status,'robots_blocked');assert.equal(row.last_success_at,null);assert.equal(row.available_at,at+86400000);assert.equal(JSON.parse(row.result_json).contacts.length,0);
});

test('scheduled website reading fails closed when membership is inactive or unavailable',async()=>{
 const{env,db}=fixture();await api(env,'import',{method:'POST',body:input});let n=0;const at=Date.parse('2026-11-11T00:00:00Z');
 const run=await dispatchClinicBankReading(env,()=>{n++;throw Error('must not fetch');},at,async()=>({active:false,reason:'owner_inactive'}));assert.equal(run.processed,1);assert.equal(n,0);
 const row=db.prepare('SELECT * FROM clinic_bank_leads').get();assert.equal(row.status,'owner_inactive');assert.equal(row.read_at,null);assert.equal(row.lease_until,0);assert.equal(row.available_at,at+86400000);
});

test('already-read public service excerpts are bounded and retained without additional HTTP or patient narratives',async()=>{
 const {env,db}=fixture();await api(env,'import',{method:'POST',body:input});const at=Date.parse('2026-11-13T00:00:00Z');let calls=0;
 const service='Our clinic provides chronic disease management and preventive care.';
 await dispatchClinicBankReading(env,async url=>{calls++;return url.endsWith('/robots.txt')?new Response(null,{status:404}):new Response('<title>Synthetic Medical Practice</title><main>'+service+' My daughter receives treatment and our clinic provides diabetes care. Testimonial: the clinic provides care for my diagnosed condition. Contact jobs@clinic.example for enquiries.</main>',{headers:{'Content-Type':'text/html'}});},at,member);
 assert.equal(calls,2);const first=db.prepare('SELECT * FROM clinic_bank_leads').get(),data=JSON.parse(first.result_json);assert.equal(data.clinicalText,service);assert.equal(data.clinicalSourceURL,'https://clinic.example/');assert.equal(data.clinicalReadAt,new Date(at).toISOString());assert.equal(data.clinicalScope,'bounded_public_service_statements_not_full_page');assert(!data.clinicalText.includes('daughter'));assert(!data.clinicalText.includes('Testimonial'));
 await dispatchClinicBankReading(env,async()=>new Response('Unavailable',{status:503}),at+CLINIC_BANK_REFRESH_MS,member);const failed=JSON.parse(db.prepare('SELECT result_json FROM clinic_bank_leads').get().result_json);assert.equal(failed.clinicalText,data.clinicalText);assert.equal(failed.clinicalReadAt,data.clinicalReadAt);assert.equal(failed.clinicalSourceURL,data.clinicalSourceURL);
});

test('clinical evidence is a bounded subset of generic service statements, never a full-page cache',()=>{
 const statements=Array.from({length:16},(_,i)=>'Our clinic provides chronic disease care through service '+i+'.');
 const excerpt=clinicBankClinicalExcerpt(statements.join('\n'));assert.equal(excerpt.split('\n').length,12);assert(!excerpt.includes('service 15'));assert.equal(clinicBankClinicalExcerpt('x'.repeat(12000)+' Our clinic provides chronic disease care.'),'');
 assert.equal(clinicBankClinicalExcerpt('My husband says the clinic provides diabetes treatment. I receive care and the clinic provides support. Testimonial: our clinic provides community care.'),'');
});
