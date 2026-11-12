import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleClinicBankRequest,dispatchClinicBankReading} from '../cloud/clinic-bank.mjs';
import {PUBLIC_PAGE_REQUEST_LIMIT} from '../cloud/public-page-worker.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',at=Date.parse('2026-11-12T00:00:00Z'),member=async()=>({active:true});
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/clinic-bank-schema.sql',import.meta.url),'utf8'));const env={CLINIC_BANK_READING_ENABLED:'true',GOOGLE_DB:{prepare(sql){return{bind(...args){return{async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:db.prepare(sql).run(...args)};}};}};}}};return{db,env};}
async function seed(env,url='https://clinic.example/'){const r=await handleClinicBankRequest(new Request('https://app.example/api/clinic-bank/import',{method:'POST',headers:{Origin:'https://app.example'},body:JSON.stringify({items:[{url}]})}),env,{userId:owner,profileId:'arash'});assert.equal(r.status,201);}
const html=s=>new Response(s,{headers:{'Content-Type':'text/html'}});
test('email-free homepage follows one contact page and retains its separate published source',async()=>{
 const {db,env}=fixture();await seed(env);const requests=[];
 const result=await dispatchClinicBankReading(env,async url=>{requests.push(url);if(url.endsWith('/robots.txt'))return new Response(null,{status:404});if(url==='https://clinic.example/')return html('<main>Community general practice</main><nav><a href="/contact">Contact our practice</a><a href="/team">Team</a></nav>');if(url==='https://clinic.example/contact')return html('<main>Practice recruitment: <a href="mailto:jobs@clinic.example">jobs@clinic.example</a></main><a href="/contact/more">More contacts</a>');throw Error('unexpected second-depth request');},at,member);
 assert.equal(result.processed,1);assert.equal(requests.length,3);assert(requests.length<=PUBLIC_PAGE_REQUEST_LIMIT);
 const row=db.prepare('SELECT * FROM clinic_bank_leads').get(),data=JSON.parse(row.result_json),email=data.contacts.find(c=>c.type==='email');assert.equal(row.status,'public_contacts_found');assert.equal(email.value,'jobs@clinic.example');assert.equal(email.sourceURL,'https://clinic.example/contact');assert.equal(email.sourceRelation,'linked_page');assert.equal(data.linkedReadings[0].status,'read');assert.equal(row.new_email_count,1);
});
test('apex redirects and contact discovery share one six-request budget instead of rejecting www candidates',async()=>{
 const {db,env}=fixture();await seed(env,'https://www.clinic.example/');const requests=[];
 await dispatchClinicBankReading(env,async url=>{requests.push(url);if(url==='https://www.clinic.example/robots.txt')return new Response(null,{status:301,headers:{Location:'https://clinic.example/robots.txt'}});if(url==='https://clinic.example/robots.txt')return new Response('User-agent: *\nAllow: /');if(url==='https://www.clinic.example/')return new Response(null,{status:302,headers:{Location:'https://clinic.example/'}});if(url==='https://clinic.example/')return html('<main>GP clinic</main><a href="/contact">Contact</a>');return html('<main>Enquiries: published@clinic.example</main>');},at,member);
 assert(requests.length<=PUBLIC_PAGE_REQUEST_LIMIT);assert.equal(requests.length,5);assert.equal(db.prepare('SELECT status FROM clinic_bank_leads').get().status,'public_contacts_found');
});
test('contact-page robots denial remains a failed linked receipt and never becomes a contact',async()=>{
 const {db,env}=fixture();await seed(env);const requests=[];
 await dispatchClinicBankReading(env,async url=>{requests.push(url);if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nDisallow: /contact');return html('<main>GP clinic</main><a href="/contact">Contact</a>');},at,member);
 assert.deepEqual(requests,['https://clinic.example/robots.txt','https://clinic.example/']);const data=JSON.parse(db.prepare('SELECT result_json FROM clinic_bank_leads').get().result_json);assert.equal(data.linkedReadings[0].status,'robots_blocked');assert(!data.contacts.some(c=>c.type==='email'));
});
test('homepage email avoids unnecessary follow-ups and unrelated hosts are never fetched',async()=>{
 for(const content of ['<main>Email: published@clinic.example</main><a href="/contact">Contact</a>','<main>GP clinic</main><a href="https://foreign.example/contact">Contact</a>']){
  const {env}=fixture();await seed(env);let requests=0;await dispatchClinicBankReading(env,async url=>{requests++;return url.endsWith('/robots.txt')?new Response(null,{status:404}):html(content);},at,member);assert.equal(requests,2);
 }
});

test('failed refresh keeps last source-published contacts with old receipt and marks them stale',async()=>{
 const {db,env}=fixture();await seed(env);
 const fetcher=async url=>url.endsWith('/robots.txt')?new Response(null,{status:404}):url==='https://clinic.example/'?html('<main>GP clinic</main><a href="/contact">Contact</a>'):html('<main>Recruitment: published@clinic.example</main>');
 await dispatchClinicBankReading(env,fetcher,at,member);const first=db.prepare('SELECT * FROM clinic_bank_leads').get(),published=JSON.parse(first.result_json);assert.equal(first.status,'public_contacts_found');
 const later=at+7*86400000;await dispatchClinicBankReading(env,async()=>new Response('Unavailable',{status:503}),later,member);
 const failed=db.prepare('SELECT * FROM clinic_bank_leads').get(),retained=JSON.parse(failed.result_json);assert.equal(failed.status,'robots_unavailable');assert.equal(failed.last_success_at,first.last_success_at);assert.deepEqual(retained.contacts,published.contacts);assert.deepEqual(retained.linkedReadings,published.linkedReadings);assert.equal(retained.sourceURL,published.sourceURL);assert.equal(retained.contactsReadAt,published.contactsReadAt);assert.equal(retained.lastAttempt.readAt,new Date(later).toISOString());assert.equal(retained.lastAttempt.status,'robots_unavailable');assert.equal(failed.new_email_count,0);
 const response=await handleClinicBankRequest(new Request('https://app.example/api/clinic-bank/items'),env,{userId:owner,profileId:'arash'}),view=(await response.json()).items[0];assert.equal(view.readAt,first.last_success_at);assert.equal(view.lastAttemptAt,new Date(later).toISOString());assert.equal(view.stale,true);assert.equal(view.sendingApproved,false);assert.equal(view.vacancyVerified,false);assert.equal(view.contacts[0].sourceURL,published.contacts[0].sourceURL);
});

test('first failure has an attempt receipt but never claims successful contact reading',async()=>{
 const {env}=fixture();await seed(env);await dispatchClinicBankReading(env,async()=>new Response('Forbidden',{status:403}),at,member);
 const response=await handleClinicBankRequest(new Request('https://app.example/api/clinic-bank/items'),env,{userId:owner,profileId:'arash'}),view=(await response.json()).items[0];assert.equal(view.readAt,null);assert.equal(view.lastSuccessAt,null);assert.equal(view.lastAttemptAt,new Date(at).toISOString());assert.equal(view.stale,true);assert.deepEqual(view.contacts,[]);
});
