import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {assessFiveTier,readGpGoalMode,handleGpWorkflowRequest as route} from '../cloud/gp-workflow.mjs';

const id='opp_'+'a'.repeat(32),otherId='opp_'+'b'.repeat(32),foreignId='opp_'+'c'.repeat(32),origin='https://workspace.example';
const owner={userId:'owner-arash',profileId:'arash'},other={userId:'other-arash',profileId:'arash'};
const source={country:'AU',opportunityType:'job',title:'General Practitioner',status:'open',url:'https://clinic.example/jobs',fullText:'Level 1 supervision is available. International medical graduates are welcome. We provide clinical supervision for IMGs. PESCI support is available.'};
function binding(db){return {prepare(sql){return {bind(...args){const p=db.prepare(sql);return {async first(){return p.get(...args)||null;},async all(){return {results:p.all(...args)};},async run(){return {meta:p.run(...args)};}};}};}};}
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/gp-workflow-schema.sql',import.meta.url),'utf8'));
 db.exec('CREATE TABLE opportunity_editions(id TEXT PRIMARY KEY,country TEXT,profile_scope TEXT,opportunity_type TEXT,title TEXT,status TEXT,kind TEXT,url TEXT,closing_at TEXT,published_at TEXT,data TEXT)');
 for(const [key,record,profile]of [[id,source,'both'],[otherId,{...source,fullText:'General practice services are provided in this clinic.'},'both'],[foreignId,{...source,country:'IT'},'amir']])db.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(key,record.country,profile,'job',record.title,record.status,'vacancy',record.url,null,null,JSON.stringify(record));
 const env={GOOGLE_DB:binding(db),OPPORTUNITY_DB:binding(db)};
 const call=(path='settings',body,context=owner,headers={})=>route(new Request(origin+'/api/gp-workflow/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,context);
 return {db,env,call};
}
test('PESCI-readiness mode changes evidence weights without a visa or MMM1 exclusion',()=>{
 const record={...source,location:'MMM1 metropolitan clinic. Non-DPA.',fullText:source.fullText+' No visa sponsorship is available.'};
 const a=assessFiveTier(record),b=assessFiveTier(record,'employment');
 assert.equal(a.tier,4);assert.equal(b.tier,4);assert.equal(a.stars,4);assert(a.priorityWeight>b.priorityWeight);assert.equal(a.eligibility,'not_assessed');assert(!('acceptanceProbability' in a));assert(a.unknowns.includes('registration'));
 assert(a.registrationCautions.some(x=>x.includes('19AB')));assert(a.registrationCautions.some(x=>x.includes('FSP')));
});
test('large teams and a simple or old website never manufacture supervision or clinic closure',()=>{
 const record={...source,fullText:'We are a teaching practice with 20 doctors and clinics across Australia. Website last updated 2021.',websiteStatus:'404'};
 const assessment=assessFiveTier(record);assert.equal(assessment.tier,2);assert(assessment.unknowns.includes('level1'));assert.equal(assessment.priorityWeight,0);assert(assessment.nextSteps.some(x=>x.includes('Level 1')));
});
test('five tiers distinguish explicit commitments, weaker leads, normal prerequisites and clear restrictions',()=>{
 assert.equal(assessFiveTier({...source,fullText:source.fullText+' Visa sponsorship is available.'}).tier,5);
 assert.equal(assessFiveTier(source).tier,4);
 assert.equal(assessFiveTier({...source,fullText:'Level 1 supervision is available. International medical graduates are welcome.'}).tier,4);
 assert.equal(assessFiveTier({...source,fullText:'International medical graduates are welcome.'}).tier,3);
 assert.equal(assessFiveTier({...source,fullText:'General practice consultations. Ahpra registration is required. PESCI is required.'}).tier,2);
 for(const record of [{...source,status:'closed'},{...source,title:'Practice Manager'},{...source,fullText:'No Level 1 supervision is available.'},{...source,fullText:'FRACGP is required.'}])assert.equal(assessFiveTier(record).tier,1);
 assert.equal(assessFiveTier({...source,fullText:'FRACGP is preferred. General practice consultations.'}).tier,2);
 assert.equal(assessFiveTier({...source,closingAt:'2026-01-01T00:00:00Z'},'pesci_readiness',Date.parse('2026-02-01T00:00:00Z')).tier,1);
});
test('Level 1–2 wording is retained as potential evidence, never confirmed Level 1 support',()=>{
 const record={...source,fullText:'International Medical Graduates requiring Level 1-2 supervision are welcome to enquire.'},a=assessFiveTier(record);
 assert.equal(a.tier,3);assert(a.unknowns.includes('level1'));assert.equal(a.evidence.find(x=>x.field==='level1_range').status,'potential');assert(a.reasons.some(x=>x.includes('هنوز تأیید نشده')));
 assert(!assessFiveTier({...record,fullText:'We cannot consider International Medical Graduates requiring Level 1-2 supervision.'}).evidence.some(x=>x.field==='level1_range'));
});
test('owner settings are private; list helper safely defaults when the new table is unavailable',async()=>{
 const {call,env,db}=fixture();const initial=await(await call()).json();assert.equal(initial.goalMode,'pesci_readiness');assert.equal(initial.automaticSending,false);assert.equal(db.prepare('SELECT count(*) n FROM gp_workflow_settings').get().n,0);
 assert.equal((await call('settings',{goalMode:'employment'})).status,200);assert.equal(await readGpGoalMode(env,owner),'employment');assert.equal(await readGpGoalMode(env,other),'pesci_readiness');
 assert.equal((await call('settings',{goalMode:'automatic_acceptance'})).status,400);assert.equal((await call('settings',{goalMode:'employment',owner_id:'other'})).status,400);
 assert.equal(await readGpGoalMode({},owner),'pesci_readiness');assert.equal(await readGpGoalMode({GOOGLE_DB:{prepare(){throw Error('missing table');}}},owner),'pesci_readiness');
});
test('progress is explicitly owner-reported and cannot manufacture evidence or a verified CV achievement',async()=>{
 const {call,db}=fixture(),path='opportunities/'+otherId;
 assert.equal((await call(path,{stage:'supervision_confirmed',note:'short',confirm:true})).status,400);
 assert.equal((await call(path,{stage:'supervision_confirmed',note:'Written clinic response received, awaiting independent review.',confirm:false})).status,400);
 assert.equal(db.prepare('SELECT count(*) n FROM gp_opportunity_progress').get().n,0);
 const saved=await(await call(path,{stage:'supervision_confirmed',note:'SYNTHETIC PRIVATE: clinic reply received for own review.',evidenceUrl:'https://clinic.example/reply',confirm:true})).json();
 assert.equal(saved.stage,'supervision_confirmed');assert.equal(saved.status,'owner_reported');assert.equal(saved.officiallyVerified,false);assert.equal(saved.achievementVerified,false);assert.equal(saved.automaticSending,false);assert.equal(saved.assessment.tier,2);
 const second=await(await call(path,undefined,other)).json();assert.equal(second.stage,'clinic_identified');assert.equal(second.note,'');assert(!JSON.stringify(second).includes('SYNTHETIC PRIVATE'));
 assert.equal((await call(path,{stage:'application_ready',note:'Detailed owner review of documents, not regulator verification.',evidenceUrl:'javascript:alert(1)',confirm:true})).status,400);
});
test('advanced stages require supporting notes while ordinary progress still requires explicit confirmation',async()=>{
 const {call}=fixture(),path='opportunities/'+id;
 assert.equal((await call(path,{stage:'contact_identified',note:'',confirm:true})).status,200);
 for(const stage of ['supervision_confirmed','position_documents','application_ready'])assert.equal((await call(path,{stage,note:'',confirm:true})).status,400);
 assert.equal((await call(path,{stage:'verified_registration',note:'Synthetic',confirm:true})).status,400);
 assert.equal((await call(path,{stage:'application_ready',note:'Owner checked the position description and pending verification.',confirm:true})).status,200);
});
test('foreign profile, forged owner fields, non-root identity and cross-origin mutations cannot change private progress',async()=>{
 const {call,db}=fixture(),path='opportunities/'+id;
 assert.equal((await call('settings',undefined,{userId:'owner-amir',profileId:'amir'})).status,403);
 assert.equal((await call('settings',undefined,{userId:'owner-arash:secondary',profileId:'arash'})).status,403);
 assert.equal((await call('settings?profile=amir')).status,403);
 assert.equal((await call(path,{stage:'clinic_identified',note:'',confirm:true,userId:'other'})).status,400);
 assert.equal((await call(path,{stage:'clinic_identified',note:'',confirm:true},owner,{Origin:'https://evil.example'})).status,403);
 assert.equal(db.prepare('SELECT count(*) n FROM gp_opportunity_progress').get().n,0);
 assert.equal((await call('opportunities/'+foreignId)).status,404);assert.equal((await call('opportunities/opp_'+'d'.repeat(32))).status,404);
});
test('progress assessment follows that owner goal mode while another owner remains at the default',async()=>{
 const {call}=fixture();await call('settings',{goalMode:'employment'});
 assert.equal((await(await call('opportunities/'+id)).json()).assessment.goalMode,'employment');
 assert.equal((await(await call('opportunities/'+id,undefined,other)).json()).assessment.goalMode,'pesci_readiness');
});

test('five stars require explicit exact Level 1, IMG/PESCI and visa evidence; absence is not rejection',()=>{
 const full={...source,fullText:source.fullText+' Visa sponsorship is available.'};
 const rating=assessFiveTier(full);
 assert.equal(rating.stars,5);assert.equal(rating.maxStars,5);assert.equal(rating.tier,5);
 assert.equal(rating.meaning,'source_evidence_fit_not_acceptance_probability');
 assert.equal(rating.profileContext,'gp_level1_pesci_route_only_no_private_cv_assessed');
 assert.equal(rating.matrix.find(r=>r.id==='sponsorship').status,'supported');
 assert(rating.matrix.find(r=>r.id==='level1').evidence.every(e=>e.url===source.url&&e.quote.includes('Level 1')));
 for(const text of ['No visa sponsorship is available.','Visa sponsorship may be available.','We provide event sponsorship.','']){
  const a=assessFiveTier({...source,fullText:source.fullText+' '+text});assert.equal(a.stars,4);
  assert.notEqual(a.matrix.find(r=>r.id==='sponsorship').status,'supported');
 }
 assert.equal(assessFiveTier({...full,fullText:full.fullText.replace('Level 1 supervision','Level 1-2 supervision')}).stars,4);
 assert.equal(assessFiveTier({...full,fullText:full.fullText.replace('Level 1 supervision is available.','Level 1 supervision may be available.')}).stars,4);
 assert.equal(assessFiveTier({...full,fullText:full.fullText.replace('PESCI support is available.','PESCI is required.')}).stars,4);
});
test('team context supports four stars only with IMG and applicant-supervision evidence',()=>{
 const base='International medical graduates are welcome. We provide clinical supervision for IMGs. ';
 const rating=assessFiveTier({...source,fullText:base+'We are a teaching practice with 8 doctors.'});
 assert.equal(rating.stars,4);assert.equal(rating.matrix.find(r=>r.id==='team_training').status,'supported');
 assert.equal(rating.matrix.find(r=>r.id==='level1').status,'not_stated');
 assert(rating.reasons.some(s=>s.includes('سطح دقیق')));
 assert.equal(assessFiveTier({...source,fullText:'We are a teaching practice with 8 doctors.'}).stars,2);
 assert.equal(assessFiveTier({...source,fullText:base+'We are not a teaching practice and cannot provide registrar training.'}).stars,3);
 assert.equal(assessFiveTier({...source,fullText:'Supervision may be available. General practice consultations.'}).stars,3);
});
test('solo and unknown/old websites are not invented supervision bans, but explicit VR/Fellowship-only restrictions are visible',()=>{
 const solo=assessFiveTier({...source,fullText:'General practice consultations with a solo GP. Website last updated 2019.',websiteStatus:'404'});
 assert.equal(solo.stars,2);assert.equal(solo.matrix.find(r=>r.id==='level1').status,'not_stated');
 assert.equal(solo.matrix.find(r=>r.id==='source_currency').status,'not_stated');
 for(const phrase of ['FRACGP only.','Only FACRRM applicants should apply.','VR GPs only.']){
  const a=assessFiveTier({...source,fullText:phrase});assert.equal(a.stars,1);assert.equal(a.matrix.find(r=>r.id==='registration').status,'restricted');
  assert(a.matrix.find(r=>r.id==='registration').evidence.some(e=>e.quote===phrase));
 }
 assert.equal(assessFiveTier({...source,fullText:'FRACGP is not the only route. General practice consultations.'}).stars,2);
 const dpa=assessFiveTier({...source,location:'MMM1, non-DPA metropolitan clinic.'});
 assert.equal(dpa.stars,4);assert.equal(dpa.matrix.find(r=>r.id==='geography').status,'informational');
});
