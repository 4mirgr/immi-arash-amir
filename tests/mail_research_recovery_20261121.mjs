import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dispatchMailOpportunityResearch} from '../cloud/mail-opportunity-research.mjs';

const NOW=Date.parse('2026-11-21T10:00:00Z');
const OWNER='11111111-1111-4111-8111-111111111111',CV='33333333-3333-4333-8333-333333333333';
const ID='mop_'+'1'.padStart(32,'0'),ORIGIN='https://clinic.example.org',CLINIC='Synthetic Medical Centre';
const CLINICAL='Our practice provides chronic disease management and preventive care in a community general practice setting.';
function fixture({path='/',employment='',title=CLINIC,verified}={}){
 const db=new DatabaseSync(':memory:');
 for(const file of ['google-schema.sql','mail-opportunities-schema.sql','mail-opportunity-research-schema.sql','mail-automation-schema.sql','clinic-bank-schema.sql','mail-lead-discovery-schema.sql','mail-lead-search-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const statements=[],binding={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){statements.push({sql,args});return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};}};
 const env={GOOGLE_DB:binding,MAIL_OPPORTUNITY_RESEARCH_ENABLED:'true'};
 Object.defineProperty(env,'OPPORTUNITY_DB',{get(){throw Error('Private research may not write shared data');}});
 db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(OWNER,'arash','synthetic-google-sub','synthetic@example.org','[]','NOT_A_TOKEN',NOW+3600000,'connected',NOW);
 const data={key:ORIGIN+path,title:'General Practitioner enquiry',clinicName:CLINIC,sourceUrl:ORIGIN+path,sourceKind:'job_notice',recipient:null,recipients:[],fit:{priority:'review',level1:'unknown',sponsorship:'unknown'},receivedAt:NOW-60000,gmailId:'synthetic-mail',threadId:'synthetic-thread',messageFingerprint:'synthetic-source-fingerprint',...(verified===undefined?{}:{applicationSourceVerified:verified})};
 db.prepare('INSERT INTO private_mail_opportunities(id,owner_id,root_owner_id,profile_id,google_sub,gmail_id,thread_id,source_url,title,clinic_name,status,fit_json,data_json,draft_json,received_at,created_at,updated_at,notification_eligible) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(ID,OWNER,OWNER,'arash','synthetic-google-sub',data.gmailId,data.threadId,ORIGIN+path,data.title,CLINIC,'suggested',JSON.stringify(data.fit),JSON.stringify(data),null,NOW-60000,NOW-1000,NOW-1000,1);
 const calls=[],fetcher=async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'manual');assert(!options.headers.Authorization);assert(!options.headers.Cookie);
  if(new URL(url).pathname==='/robots.txt')return new Response('',{status:404});
  const body='<html><head><title>'+title+'</title></head><body><main><h1>'+CLINIC+'</h1><p>'+CLINICAL+'</p><p>'+employment+'</p><p>GP enquiries: manager@clinic.example.org</p></main></body></html>';
  return new Response(body,{headers:{'Content-Type':'text/html'}});
 };
 const writing={profile:{name:'Dr Synthetic Candidate',planning:{gpApplicationWriting:{confirmedByOwner:true,writingVersion:'human-four-paragraph-v1',openingParagraph:'I am a general practitioner with extensive experience in community general practice and chronic disease management.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',signatureEmail:'candidate@example.org',signaturePhone:'+12345678901'}}},cvText:'Managed chronic disease and preventive care in general practice, supporting continuity of patient care within a community clinic.',cvVersionId:CV};
 return {db,calls,statements,async run(){return dispatchMailOpportunityResearch(env,{now:NOW,fetcher,sleep:async()=>{},membership:async()=>({active:true}),writingContextProvider:async()=>writing});},saved(){const row=db.prepare('SELECT data_json,draft_json FROM private_mail_opportunities WHERE id=?').get(ID);return {data:JSON.parse(row.data_json),draft:JSON.parse(row.draft_json)};}};
}

test('a readable clinic homepage supports an initial enquiry without inventing a current vacancy',async()=>{
 for(const verified of [undefined,true]){
  const f=fixture({verified}),result=await f.run(),{data,draft}=f.saved();
  assert.equal(result.status,'read');assert.equal(result.draftReady,true);
  assert.equal(data.applicationSourceVerified,false);assert.equal(draft.outreachMode,'initial_enquiry');
  assert.equal(data.publicationBasis,'clinic_enquiry_unverified_vacancy');assert(data.research.publicEmployerVerified);
  assert.equal(result.publicRequests,f.calls.length);assert(result.publicRequests<=6);
 }
});

test('an unrelated staff recruitment sentence cannot establish a GP vacancy',async()=>{
 const f=fixture({path:'/careers',employment:'We are looking for an experienced practice nurse to join our friendly team.'});
 const result=await f.run(),{data,draft}=f.saved();
 assert.equal(result.draftReady,true);assert.equal(data.applicationSourceVerified,false);assert.equal(draft.outreachMode,'initial_enquiry');
});

test('a GP services title and treatment requirements do not establish employment',async()=>{
 const f=fixture({title:'General Practitioner services | '+CLINIC,employment:'Our team discusses your treatment requirements with you before starting care.'});
 const result=await f.run(),{data,draft}=f.saved();
 assert.equal(result.draftReady,true);assert.equal(data.applicationSourceVerified,false);assert.equal(draft.outreachMode,'initial_enquiry');
});

test('patient registration and non-GP staff job metadata do not establish a GP vacancy',async()=>{
 for(const [title,employment]of [
  ['General Practitioner services | '+CLINIC,'Apply online for our new patient registration service.'],
  ['General Practitioner appointments | '+CLINIC,'Please apply now for our patient registration service.'],
  ['General Practitioner | '+CLINIC,'We are hiring a practice nurse. Job type: full-time permanent.'],
  ['General Practitioner | '+CLINIC,'We are recruiting registered nurses. Job type: full-time permanent.'],
  ['General Practitioner | '+CLINIC,'Job title: Receptionist. Employment type: part-time.'],
 ]){
  const f=fixture({path:'/careers/gp',title,employment}),result=await f.run(),{data,draft}=f.saved();
  assert.equal(result.draftReady,true);assert.equal(data.applicationSourceVerified,false,employment);assert.equal(draft.outreachMode,'initial_enquiry');
 }
});

test('a generic application instruction is not sufficient without GP employment evidence',async()=>{
 const f=fixture({path:'/careers/gp',title:'General Practitioner | '+CLINIC,employment:'Please apply here using the published contact.'});
 const result=await f.run(),{data,draft}=f.saved();
 assert.equal(result.draftReady,true);assert.equal(data.applicationSourceVerified,false);assert.equal(draft.outreachMode,'initial_enquiry');
});

test('current absence of GP vacancies is not employment evidence for a new application',async()=>{
 const f=fixture({title:'General Practitioner careers | '+CLINIC,employment:'There are no GP vacancies at present. Please contact us about future opportunities.'});
 const result=await f.run(),{data,draft}=f.saved();
 assert.equal(result.draftReady,true);assert.equal(data.applicationSourceVerified,false);assert.equal(draft.outreachMode,'initial_enquiry');
});

test('a nurse recruited to work alongside GPs is not a GP recruitment clause',async()=>{
 const f=fixture({path:'/careers/nurse',title:'Practice Nurse vacancy | '+CLINIC,employment:'We are looking for a Registered Nurse to work alongside our GPs. Job type: full time.'});
 const result=await f.run(),{data,draft}=f.saved();
 assert.equal(result.draftReady,true);assert.equal(data.applicationSourceVerified,false);assert.equal(draft.outreachMode,'initial_enquiry');
});

test('a plain GP vacancy title with explicit job-type or position metadata remains an application',async()=>{
 for(const employment of ['Job type: full-time permanent. To apply, email our practice manager.','Position description: provide continuity of care in general practice.']){
  const f=fixture({path:'/careers/gp',title:'General Practitioner | '+CLINIC,employment});
  const result=await f.run(),{data,draft}=f.saved();
  assert.equal(result.draftReady,true);assert.equal(data.applicationSourceVerified,true,employment);assert.equal(draft.outreachMode,'job_application');
 }
});

test('actual current GP recruitment wording still supports the job application mode',async()=>{
 const f=fixture({path:'/careers/gp',title:'General Practitioner position | '+CLINIC,employment:'We are seeking a General Practitioner to join our community practice. Apply here for this GP position.'});
 const result=await f.run(),{data,draft}=f.saved();
 assert.equal(result.draftReady,true);assert.equal(data.applicationSourceVerified,true);assert.equal(draft.outreachMode,'job_application');
});

test('research selection starts from connected accounts and their existing owner index instead of scanning all private opportunities',async()=>{
 const f=fixture();await f.run();
 const query=f.statements.find(item=>item.sql.includes('LEFT JOIN private_mail_opportunity_research'));
 assert(query);const plan=f.db.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.args).map(row=>row.detail);
 assert(plan.some(detail=>/SEARCH o USING INDEX private_mail_opportunities_owner/.test(detail)),plan);
 assert(!plan.some(detail=>/SCAN o\b/.test(detail)),plan);
});
