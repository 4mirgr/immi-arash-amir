import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {applyOwnedMailClinicBankProof} from '../cloud/mail-clinic-bank-proof.mjs';
import {assessMailOutreachEvidence,resolveOwnedMailClinicSource,upsertOwnedMailClinicEvidence,MAIL_PUBLIC_EVIDENCE_MAX_AGE,MAIL_LEAD_DISCOVERY_VERSION} from '../cloud/mail-lead-discovery.mjs';
import {withPublicEmployerEvidence} from './helpers/mail_opportunity_fixture.mjs';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const NOW=Date.parse('2026-11-21T12:00:00Z'),at=new Date(NOW-86400000).toISOString(),site='https://harbour.example.org/',name='Harbour Medical Centre';
const lead={clinicName:name,title:'General Practitioner — '+name,sourceUrl:site+'jobs/gp',candidateHosts:['harbour.example.org'],gmailId:'mail1',clinicalFacts:[],clinicalFactBasis:'private_email_statement'};
const context={userId:owner,rootUserId:owner,profileId:'arash',googleSubject:'synthetic-sub'};
function bank(changes={}){
 return {id:'bank_synthetic',owner_id:owner,profile_id:'arash',url:site,name:'',status:'public_contacts_found',last_success_at:at,read_at:at,
  result:{sourceStatus:'read',sourceURL:site,title:name+' | Home',lastAttempt:{status:'read',sourceURL:site,readAt:at},contactsReadAt:at,
   contacts:[{type:'email',value:'manager@harbour.example.org',quote:'Practice Manager: manager@harbour.example.org',sourceURL:site,sourceRelation:'same_page'}],
   research:{facts:[{category:'training',text:'Our practice supports medical student teaching and continuing clinical learning.',sourceURL:site,readAt:at}]}},...changes};
}
function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['clinic-bank-schema.sql','google-schema.sql','mail-opportunities-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const binding={prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};}};
 function seed(id,url,{rowOwner=owner,rowName=name,stamp=at}={}){db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,status,last_success_at,created_at,updated_at) VALUES(?,?,'arash',?,?,'public_page_read',?,?,?)").run(id,rowOwner,url,rowName,stamp,stamp,stamp);}
 return {db,binding,seed};
}

test('an imported blank bank name may reuse actual branded evidence only for the same direct employer host',()=>{
 const row=bank(),candidate=applyOwnedMailClinicBankProof(lead,[row],{rootOwnerId:owner,now:NOW});
 assert.equal(assessMailOutreachEvidence(candidate,{now:NOW}).verified,true);
 assert.equal(assessMailOutreachEvidence(candidate,{now:NOW}).outreachMode,'initial_enquiry');assert.equal(candidate.applicationSourceVerified,false);
 assert.equal(candidate.research.verification.checkedAt,at);
 for(const change of [item=>{item.owner_id=other;},item=>{item.name='Other Medical Centre';},item=>{item.result.title='Different practice | Home';},item=>{item.result.lastAttempt.status='access_denied';}]){
  const item=bank();change(item);assert.equal(assessMailOutreachEvidence(applyOwnedMailClinicBankProof(lead,[item],{rootOwnerId:owner,now:NOW}),{now:NOW}).verified,false);
 }
 const unrelated={...lead,sourceUrl:'https://different.example.org/jobs/gp'};
 assert.equal(assessMailOutreachEvidence(applyOwnedMailClinicBankProof(unrelated,[row],{rootOwnerId:owner,now:NOW}),{now:NOW}).verified,false);
 const board={...lead,sourceUrl:'https://www.linkedin.com/jobs/view/123/'};
 assert.equal(assessMailOutreachEvidence(applyOwnedMailClinicBankProof(board,[row],{rootOwnerId:owner,now:NOW}),{now:NOW}).verified,false,'an unnamed import is not a global name lookup or cross-host match');
});

test('resolver detects a fifth same-name host beyond the result window without conflating owners',async()=>{
 const f=fixture();for(let index=0;index<4;index++)f.seed('bank_'+index,site+'branch/'+index,{stamp:new Date(NOW-index*1000).toISOString()});
 f.seed('bank_other_owner','https://foreign.example.org/',{rowOwner:other});
 assert.equal((await resolveOwnedMailClinicSource(f.binding,context,lead)).url,site+'branch/0');
 f.seed('bank_ambiguous','https://another.example.org/',{stamp:new Date(NOW-86400000).toISOString()});
 assert.equal(await resolveOwnedMailClinicSource(f.binding,context,lead),null,'the fifth hostname must not be hidden by LIMIT4');
});

test('persisting cached employer proof keeps the original observation and refresh deadline',async()=>{
 const f=fixture(),id='mop_'+'a'.repeat(32),version=123,readAt=NOW-86400000;
 f.db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,'arash',context.googleSubject,'candidate@example.org','[]','synthetic',0,'connected',NOW);
 f.db.prepare("INSERT INTO private_mail_opportunities(id,owner_id,root_owner_id,profile_id,google_sub,gmail_id,thread_id,source_url,title,clinic_name,received_at,created_at,updated_at) VALUES(?,?,?,'arash',?,'mail1','thread1',?,?,?, ?,?,?)").run(id,owner,owner,context.googleSubject,site+'jobs/gp','General Practitioner',name,readAt,readAt,version);
 const candidate=withPublicEmployerEvidence({...lead,recipients:['manager@harbour.example.org']},{now:readAt,officialSourceURL:site});
 const result=await upsertOwnedMailClinicEvidence(f.binding,context,candidate,{now:NOW,opportunityId:id,sourceVersion:version});assert.equal(result.updated,true);
 const row=f.db.prepare('SELECT * FROM clinic_bank_leads').get(),snapshot=JSON.parse(row.result_json);
 assert.equal(row.last_success_at,at);assert.equal(row.read_at,at);assert.equal(row.available_at,readAt+MAIL_PUBLIC_EVIDENCE_MAX_AGE);
 assert.equal(snapshot.lastAttempt.readAt,at);assert.equal(snapshot.contactsReadAt,at);assert.equal(snapshot.clinicalReadAt,at);
 assert.equal(snapshot.research.verification.checkedAt,at);
});

test('legacy v2 employer proof cannot retain job-application readiness without current mode revalidation',()=>{
 // v2 could label an employment-looking homepage as a verified application.
 // The discovery-version guard makes existing research receipts due again;
 // an actual fresh bank reading can meanwhile rebuild v3 initial-enquiry proof
 // without resetting its observation date or claiming the old vacancy is open.
 const legacy=withPublicEmployerEvidence({...lead,recipients:['manager@harbour.example.org']},{now:NOW,officialSourceURL:site});
 legacy.research.verification.version=2;
 assert.equal(assessMailOutreachEvidence(legacy,{now:NOW}).verified,false);
 assert.equal(assessMailOutreachEvidence(legacy,{now:NOW}).reason,'public_employer_verification_required');
 const current=applyOwnedMailClinicBankProof(legacy,[bank()],{rootOwnerId:owner,now:NOW});
 assert.equal(current.research.verification.version,MAIL_LEAD_DISCOVERY_VERSION);
 assert.equal(current.research.verification.checkedAt,at);
 assert.equal(assessMailOutreachEvidence(current,{now:NOW}).verified,true);
 assert.equal(assessMailOutreachEvidence(current,{now:NOW}).outreachMode,'initial_enquiry');
});
