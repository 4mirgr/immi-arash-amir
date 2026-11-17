import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dispatchClinicBankReading,handleClinicBankRequest,CLINIC_BANK_REFRESH_MS} from '../cloud/clinic-bank.mjs';
import {extractPublicContacts} from '../cloud/public-contact-extraction.mjs';
import {CLINIC_RESEARCH_VERSION} from '../cloud/clinic-research-context.mjs';
import {handleClinicEnquiryRequest} from '../cloud/clinic-enquiry.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',at=Date.parse('2026-11-15T12:00:00Z'),member=async()=>({active:true}),root='https://clinic.example/';
const html=text=>new Response(text,{headers:{'Content-Type':'text/html'}});
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/clinic-bank-schema.sql',import.meta.url),'utf8'));let statements=0;return{db,get statements(){return statements;},env:{CLINIC_BANK_READING_ENABLED:'true',GOOGLE_DB:{prepare(sql){statements++;return{bind(...args){return{async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:db.prepare(sql).run(...args)};}};}};}}}};}
function seed(db,id,url=root,{status='pending',availableAt=0,result={},attempts=0}={}){db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,status,available_at,attempts,result_json,created_at,updated_at) VALUES(?,?,'arash',?,?,?,?,?,?,?)").run(id,owner,url,status,availableAt,attempts,JSON.stringify(result),new Date(at).toISOString(),new Date(at).toISOString());}
const content={
 [root]:'<title>Synthetic Medical Practice</title><main>Our practice provides chronic disease management. Email: jobs@clinic.example.</main><nav><a href="/services">Services</a><a href="/team">Our team</a><a href="/contact">Contact</a><a href="https://foreign.example/team">Team</a></nav>',
 [root+'services']:'<main>We train medical students and GP registrars through our teaching programme. Our clinic offers preventive primary care and wound management.</main>',
 [root+'team']:'<main><p>Our multidisciplinary team includes general practitioners and registered nurses.</p><section>Practice Manager: Alex Example</section></main>',
};
const fetcher=requests=>async url=>{requests.push(url);if(url.endsWith('/robots.txt'))return new Response(null,{status:404});if(content[url])return html(content[url]);throw Error('unexpected URL '+url);};

test('generic email link and canonical service page produce a complete source-bound enquiry automatically',async()=>{
 const f=fixture(),id='bank_'+'a'.repeat(32),service='Our practice provides chronic disease management and preventive care',cvId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';seed(f.db,id);const requests=[];
 await dispatchClinicBankReading(f.env,async url=>{
  requests.push(url);if(url.endsWith('/robots.txt'))return new Response(null,{status:404});
  if(url===root)return html('<title>Synthetic Medical Practice</title><main><p>'+('Welcome to our local practice website '.repeat(30))+'</p><a href="mailto:jobs%40clinic.example?subject=GP">Email our practice</a></main><nav><a href="https://www.clinic.example/services">Our services</a></nav>');
  if(url==='https://www.clinic.example/services')return html('<main><p>'+service+'</p></main>');
  throw Error('Unexpected crawl');
 },at,member);
 assert(requests.includes('https://www.clinic.example/services'));assert(requests.length<=6);
 const row=f.db.prepare('SELECT * FROM clinic_bank_leads WHERE id=?').get(id),snapshot=JSON.parse(row.result_json);assert.equal(row.new_email_count,1);assert(snapshot.contacts[0].quote.includes('jobs@clinic.example'));assert(snapshot.research.facts.some(fact=>fact.text===service));
 const context={userId:owner,profileId:'arash',rest:async(table,query)=>{
  assert(query.includes('user_id=eq.'+owner));assert(query.includes('profile_id=eq.arash'));
  if(table==='immi_cv_defaults')return[{version_id:cvId}];
  if(table==='immi_cv_versions')return[{id:cvId,text:'Provided chronic disease management and preventive care to patients.'}];
  if(table==='immi_profiles')return[{data:{name:'Dr Synthetic',planning:{gpApplicationWriting:{confirmedByOwner:true,writingVersion:'human-four-paragraph-v1',openingParagraph:'I am a synthetic GP seeking an appropriately supervised position in Australian general practice.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',signatureEmail:'synthetic@example.invalid',signaturePhone:'+00 111 222 333'}}}}];
  throw Error('Unexpected owner table');
 }};
 const response=await handleClinicEnquiryRequest(new Request('https://app.example/api/clinic-bank/enquiry?profile=arash&id='+id),f.env,context,at),enquiry=await response.json();assert.equal(response.status,200);assert.equal(enquiry.recipients[0].value,'jobs@clinic.example');assert(enquiry.draft.body);assert.equal(enquiry.draft.clinicQuote,service);assert.equal(enquiry.draft.clinicQuoteSourceURL,'https://www.clinic.example/services');assert.equal(enquiry.draft.evidenceMatch.status,'direct_service_overlap');assert.equal(enquiry.automaticSending,false);assert.equal(enquiry.vacancyVerified,false);assert.equal(enquiry.supervisionVerified,false);
});

test('navigation exposes bounded service/training/recruitment links without off-site or file crawl',()=>{
 const links=extractPublicContacts({sourceURL:root,readAt:new Date(at).toISOString(),html:'<nav><a href="/services">Services</a><a href="/training">Training</a><a href="/careers">Careers</a><a href="https://foreign.example/services">Services</a><a href="/services.pdf">Services</a></nav>'}).followLinks;
 assert.deepEqual(links.map(x=>x.url),[root+'services',root+'training',root+'careers']);assert(links.every(x=>x.sourceURL===root&&x.navigationOnly));
 const many=extractPublicContacts({sourceURL:root,html:'<nav>'+Array.from({length:20},(_,i)=>'<a href="/services/'+i+'">Services</a>').join('')+'</nav>'}).followLinks;assert.equal(many.length,6);
});

test('homepage email does not suppress service/team research and all evidence keeps the current observation source',async()=>{
 const f=fixture();seed(f.db,'bank_first');const requests=[];
 const run=await dispatchClinicBankReading(f.env,fetcher(requests),at,member);assert.equal(run.processed,1);assert(requests.length<=6);assert(requests.includes(root+'services'));assert(requests.includes(root+'team'));assert(!requests.some(x=>x.startsWith('https://foreign.example/')));
 const row=f.db.prepare('SELECT * FROM clinic_bank_leads').get(),data=JSON.parse(row.result_json);
 assert.equal(row.status,'public_contacts_found');assert.equal(data.research.version,CLINIC_RESEARCH_VERSION);assert.equal(data.research.observedAt,new Date(at).toISOString());
 assert(data.research.facts.some(x=>x.category==='training'&&x.sourceURL===root+'services'&&x.readAt===data.contactsReadAt));
 assert(data.research.facts.some(x=>x.category==='team'&&x.sourceURL===root+'team'));assert(data.research.people.some(x=>x.name==='Alex Example'));
 assert.equal(data.clinicalSourceURL,root);assert(!data.clinicalText.includes('students'));assert.equal(data.linkedReadings.length,2);
 assert(f.statements<=4,'no extra D1 queries for context extraction');
});

test('research link redirects share the six-request cap and failed linked pages do not create evidence',async()=>{
 const f=fixture();seed(f.db,'bank_redirect');const requests=[];
 await dispatchClinicBankReading(f.env,async url=>{requests.push(url);if(url.endsWith('/robots.txt'))return new Response(null,{status:404});if(url===root)return html(content[root]);if(url===root+'services')return new Response(null,{status:302,headers:{Location:'/services/one'}});if(url===root+'services/one')return new Response(null,{status:302,headers:{Location:'/services/two'}});if(url===root+'services/two')return html(content[root+'services']);return new Response('Unavailable',{status:503});},at,member);
 assert(requests.length<=6);const data=JSON.parse(f.db.prepare('SELECT result_json FROM clinic_bank_leads').get().result_json);assert.equal(data.research.sourcePages.length,2);assert(!data.research.facts.some(x=>x.sourceURL===root+'team'));
});

test('fresh successful legacy rows upgrade gradually without starving due new clinics or repeating indefinitely',async()=>{
 const f=fixture();for(let i=0;i<3;i++)seed(f.db,'new_'+i,'https://new'+i+'.example/');
 for(let i=0;i<2;i++)seed(f.db,'old_'+i,'https://old'+i+'.example/',{status:'public_contacts_found',availableAt:at+CLINIC_BANK_REFRESH_MS,result:{contacts:[]}});
 const upgradeTick=Math.ceil(at/900000)*900000;
 const simple=async url=>url.endsWith('/robots.txt')?new Response(null,{status:404}):html('<main>Our clinic provides preventive general practice care.</main>');
 let run=await dispatchClinicBankReading(f.env,simple,upgradeTick,member);assert.equal(run.processed,2);assert(run.receipts[0].id.startsWith('new_'));assert(run.receipts[1].id.startsWith('old_'));
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM clinic_bank_leads WHERE id LIKE 'new_%' AND status='pending'").get().n,2);
 run=await dispatchClinicBankReading(f.env,simple,upgradeTick+300000,member);assert.equal(run.processed,2);assert(run.receipts.every(x=>x.id.startsWith('new_')));
 run=await dispatchClinicBankReading(f.env,simple,upgradeTick+600000,member);assert.equal(run.processed,0);
 run=await dispatchClinicBankReading(f.env,simple,upgradeTick+900000,member);assert.equal(run.processed,1);assert(run.receipts[0].id.startsWith('old_'));
 assert.equal((await dispatchClinicBankReading(f.env,simple,upgradeTick+900000,member)).processed,0);
});

test('a failed historical upgrade backs off and preserves the original source observation',async()=>{
 const f=fixture(),old='2026-11-14T00:00:00.000Z';seed(f.db,'old_0',root,{status:'public_contacts_found',availableAt:at+CLINIC_BANK_REFRESH_MS,result:{contactsReadAt:old,contacts:[{type:'email',value:'published@clinic.example'}],research:{version:1,observedAt:old,facts:[]}}});
 const upgradeTick=Math.ceil(at/900000)*900000;let calls=0;
 await dispatchClinicBankReading(f.env,async()=>{calls++;return new Response('Unavailable',{status:503});},upgradeTick,member);
 const row=f.db.prepare('SELECT * FROM clinic_bank_leads').get(),data=JSON.parse(row.result_json);assert.equal(row.status,'robots_unavailable');assert.equal(row.available_at,upgradeTick+86400000);assert.equal(data.research.observedAt,old);assert.equal(data.contactsReadAt,old);
 assert.equal((await dispatchClinicBankReading(f.env,async()=>{calls++;throw Error('backoff');},upgradeTick+900000,member)).processed,0);assert.equal(calls,1);
 const response=await handleClinicBankRequest(new Request('https://app.example/api/clinic-bank/items'),f.env,{userId:owner,profileId:'arash'});assert((await response.json()).items[0].stale);
});
