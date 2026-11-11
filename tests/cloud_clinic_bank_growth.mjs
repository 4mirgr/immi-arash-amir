import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {clinicCandidateFromOpportunity,reconcileClinicBankGrowth,CLINIC_BANK_GROWTH_LIMIT} from '../cloud/clinic-bank-growth.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',at=Date.parse('2026-11-11T12:00:00Z'),member=async()=>({active:true});
const binding=db=>({prepare(sql){return{bind(...args){return{async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:db.prepare(sql).run(...args)};}};}};},async batch(items){db.exec('BEGIN');try{const results=[];for(const item of items)results.push(await item.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}});
function fixture(){
 const db=new DatabaseSync(':memory:'),opportunities=new DatabaseSync(':memory:');
 for(const name of ['clinic-bank-schema.sql','clinic-bank-growth-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+name,import.meta.url),'utf8'));
 opportunities.exec(readFileSync(new URL('../cloud/opportunity-v2-schema.sql',import.meta.url),'utf8'));
 db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,created_at,updated_at) VALUES('bank_seed',?,'arash','https://seed.example/',?,?)").run(owner,new Date(at).toISOString(),new Date(at).toISOString());
 return{db,opportunities,env:{GOOGLE_DB:binding(db),OPPORTUNITY_DB:binding(opportunities),CLINIC_BANK_READING_ENABLED:'true'}};
}
function row(n=1,extra={}){return{id:'opp_'+String(n).padStart(32,'0'),country:'AU',profile_scope:'both',trust:'official',opportunity_type:'job',status:'open',title:'General Practitioner - synthetic clinic',url:'https://clinic'+n+'.example/careers/gp',last_seen_at:new Date(at-1000).toISOString(),closing_at:new Date(at+86400000).toISOString(),data:JSON.stringify({kind:'vacancy'}),organization_data:JSON.stringify({name:'Synthetic clinic '+n,domain:'clinic'+n+'.example',domainEvidence:'source_provided'}),...extra};}
function store(db,r){const org=JSON.parse(r.organization_data);db.prepare('INSERT INTO opportunity_organizations VALUES(?,?,?,?,?,?,?,?)').run('org'+r.id,'synthetic',org.domain,'AU','NSW',r.organization_data,r.last_seen_at,r.last_seen_at);db.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(r.id,'synthetic','ext'+r.id,'org'+r.id,'edition'+r.id,r.profile_scope,r.trust,r.opportunity_type,r.country,'NSW',r.title,r.url,null,r.closing_at,r.status,r.data,r.last_seen_at,r.last_seen_at);}
test('growth candidates require fresh first-party GP ad evidence and never infer employer domains or vacancy permission',()=>{
 const r=row(),candidate=clinicCandidateFromOpportunity(r,at);assert(candidate);assert.equal(candidate.url,'https://clinic1.example/');assert.equal(candidate.provenance.candidateOnly,true);assert.equal(candidate.provenance.sourceOpportunityId,r.id);
 for(const changes of [{country:'IT'},{trust:'unofficial'},{profile_scope:'amir'},{status:'closed'},{status:'source_removed'},{title:'GP Nurse Manager'},{last_seen_at:new Date(at-73*3600000).toISOString()},{closing_at:new Date(at-1000).toISOString()},{data:JSON.stringify({kind:'employment_register'})},{organization_data:JSON.stringify({name:'Synthetic Clinic',domain:'clinic1.example',domainEvidence:'publisher_domain_fallback'})},{organization_data:JSON.stringify({name:'Synthetic Clinic',domain:'other.example',domainEvidence:'source_provided'})},{url:'https://clinic1.example/login'},{url:'https://clinic1.example/jobs?token=secret'},{organization_data:JSON.stringify({name:'Recruitment Publisher',domain:'clinic1.example',domainEvidence:'source_provided'})},{url:'https://ruralhealthwest.com.au/vacancy/gp',organization_data:JSON.stringify({name:'Rural Health West',domain:'ruralhealthwest.com.au',domainEvidence:'source_provided'})}])assert.equal(clinicCandidateFromOpportunity({...r,...changes},at),null,JSON.stringify(changes));
});
test('cursor advances beyond first batch, owner-private additions are idempotent and preserve prior evidence',async()=>{
 const{db,opportunities,env}=fixture();for(let i=1;i<=CLINIC_BANK_GROWTH_LIMIT+3;i++)store(opportunities,row(i));
 const noFetch=()=>{throw Error('must not fetch external pages or transport messages');};
 let result=await reconcileClinicBankGrowth(env,noFetch,at,member);assert.equal(result.scanned,10);assert.equal(result.added,10);assert.equal(db.prepare('SELECT count(*) AS n FROM clinic_bank_leads').get().n,11);
 const first=db.prepare("SELECT id FROM clinic_bank_leads WHERE url='https://clinic1.example/'").get();db.prepare("UPDATE clinic_bank_leads SET status='public_contacts_found',result_json='{\"contacts\":[{\"type\":\"email\",\"value\":\"published@clinic1.example\"}]}' WHERE id=?").run(first.id);
 result=await reconcileClinicBankGrowth(env,noFetch,at,member);assert.equal(result.scanned,3);assert.equal(result.added,3);
 result=await reconcileClinicBankGrowth(env,noFetch,at,member);assert.equal(result.scanned,0);assert.equal(result.added,0);
 assert.equal(db.prepare('SELECT status FROM clinic_bank_leads WHERE id=?').get(first.id).status,'public_contacts_found');
 const state=db.prepare('SELECT * FROM clinic_bank_growth_state WHERE owner_id=?').get(owner);assert.equal(state.scanned_count,13);assert.equal(state.added_count,13);
 opportunities.prepare('UPDATE opportunity_editions SET last_seen_at=?').run(new Date(at).toISOString());result=await reconcileClinicBankGrowth(env,noFetch,at,member);assert.equal(result.scanned,10);assert.equal(result.added,0);assert.equal(db.prepare('SELECT status FROM clinic_bank_leads WHERE id=?').get(first.id).status,'public_contacts_found');
 assert.equal(db.prepare('SELECT count(DISTINCT owner_id) AS n FROM clinic_bank_leads').get().n,1);
});
test('invalid candidates still advance cursor; membership denial and disabled flag prevent bank growth',async()=>{
 const{db,opportunities,env}=fixture();store(opportunities,row(1,{organization_data:JSON.stringify({domain:'clinic1.example',domainEvidence:'publisher_domain_fallback'})}));store(opportunities,row(2));
 let result=await reconcileClinicBankGrowth(env,()=>{},at,async()=>({active:false}));assert.equal(result.status,'membership_check_blocked');assert.equal(db.prepare('SELECT count(*) AS n FROM clinic_bank_growth_state').get().n,0);
 result=await reconcileClinicBankGrowth({...env,CLINIC_BANK_READING_ENABLED:'false'},()=>{},at,member);assert.equal(result.enabled,false);
 result=await reconcileClinicBankGrowth(env,()=>{},at,member);assert.equal(result.scanned,2);assert.equal(result.added,1);result=await reconcileClinicBankGrowth(env,()=>{},at,member);assert.equal(result.scanned,0);
});
