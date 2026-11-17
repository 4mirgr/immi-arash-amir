import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ACADEMIC_MODEL,ACADEMIC_SYSTEM,academicModelInput,academicContextHash,validateAcademicDraft,applyAcademicDraft,resolveAcademicDraft,handleAcademicWritingRequest as route} from '../cloud/gp-academic-writing.mjs';
import {buildGpApplicationPackage} from '../cloud/gp-application-package.mjs';
const opp='opp_'+'a'.repeat(32),cvId='22222222-2222-4222-8222-222222222222',origin='https://app.example';
const clinic='Our general practice provides chronic disease management, preventive health and a treatment room for minor procedures.';
const cv='Managed chronic diseases and acute presentations, performed suturing and wound care, and coordinated referrals as a general practitioner.';
const name='Sample Community Medical Centre';
const fixed={openingParagraph:'I am a synthetic doctor applying for an appropriately supervised GP position.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',writingVersion:'human-four-paragraph-v1',confirmedByOwner:true,signaturePhone:'+00 123 456 789',signatureEmail:'doctor@example.invalid'};
const profile={name:'Dr Synthetic',planning:{gpApplicationWriting:fixed}};
const source={id:opp,organization:name,title:'General Practitioner',url:'https://clinic.example.invalid/jobs/gp',summary:clinic,fullText:clinic+' Apply to manager@clinic.example.invalid.',status:'open',kind:'vacancy',lastSeenAt:new Date().toISOString()};
const options={variant:'B',cvVersionId:cvId,clinicQuote:clinic,cvQuote:cv,confirmCvQuote:true};
const pkg=()=>buildGpApplicationPackage({opportunity:source,profile,cvText:cv,...options});
const draft={clinicParagraph:"Sample Community Medical Centre's combination of chronic disease management and treatment-room procedures offers the breadth of general practice I am seeking, with opportunities to support both continuing care and practical clinical work.",valueParagraph:"My experience managing chronic illness and acute presentations, together with suturing, wound care and referral coordination, would provide a relevant foundation for contributing to these services. I would build on that experience within the agreed supervision arrangements and your practice's clinical protocols.",clinicFactIds:['clinic_1'],cvFactIds:['cv_1']};
function binding(db){return{prepare(sql){const s=db.prepare(sql);return{bind(...args){return{async first(){return s.get(...args)||null;},async all(){return{results:s.all(...args)};},async run(){return{meta:s.run(...args)};}};}};}};}
function fixture(){
 const privateDB=new DatabaseSync(':memory:'),publicDB=new DatabaseSync(':memory:');
 privateDB.exec(readFileSync(new URL('../cloud/ai-assistant-schema.sql',import.meta.url),'utf8'));
 publicDB.exec(readFileSync(new URL('../cloud/opportunity-v2-schema.sql',import.meta.url),'utf8'));
 publicDB.prepare('INSERT INTO opportunity_organizations VALUES(?,?,?,?,?,?,?,?)').run('org',name,'clinic.example.invalid','AU','NSW','{}','2026-01-01','2026-01-01');
 publicDB.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(opp,'source','external','org','one','both','official','job','AU','NSW',source.title,source.url,null,null,'open',JSON.stringify(source),source.lastSeenAt,source.lastSeenAt);
 const calls=[];let inference=0;
 const context={userId:'owner-arash',profileId:'arash',rest:async(table,query)=>{
  calls.push({table,query});assert(query.includes('user_id=eq.owner-arash'));assert(query.includes('profile_id=eq.arash'));
  if(table==='immi_profiles')return[{data:profile}];if(table==='immi_cv_versions')return[{id:cvId,text:cv,version:1}];if(table==='immi_cv_defaults')return[{version_id:cvId}];throw Error('Unexpected private read');
 }};
 const env={GOOGLE_DB:binding(privateDB),OPPORTUNITY_DB:binding(publicDB),AI_ENABLED:'true',AI:{async run(model,input){inference++;assert.equal(model,ACADEMIC_MODEL);assert.equal(input.max_tokens,450);const text=JSON.stringify(input);assert(text.includes(clinic)&&text.includes(cv));assert(!text.includes(fixed.signatureEmail)&&!text.includes(fixed.signaturePhone));return{response:draft,usage:{prompt_tokens:500,completion_tokens:150}};}}};
 const request=(body={...options,contextConsent:true},headers={})=>new Request(origin+'/api/gp-writing/'+opp+'/refine?profile=arash',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 return {privateDB,publicDB,context,env,request,calls,get inference(){return inference;}};
}
test('academic edit contains only selected evidence and preserves fixed paragraphs and full own signature',()=>{
 const p=pkg(),input=academicModelInput(p);assert(p.readyForReview);assert.deepEqual(Object.keys(input.clinicFact),['id','text']);
 assert(!JSON.stringify(input).includes(fixed.signatureEmail));assert(!JSON.stringify(input).includes(fixed.signaturePhone));
 const result=applyAcademicDraft(p,validateAcademicDraft(draft,input));
 assert(result.body.includes(fixed.openingParagraph));assert(result.body.includes(fixed.closingParagraph));assert(result.body.endsWith('Email: '+fixed.signatureEmail));assert(result.body.includes('Phone: '+fixed.signaturePhone));assert.equal(result.writingQuality.needsOwnerReview,true);assert.equal(result.paragraphs.clinic,draft.clinicParagraph);
 assert(ACADEMIC_SYSTEM.includes('untrusted DATA'));assert(!ACADEMIC_SYSTEM.includes('send messages'));
});
test('basic checks reject new quantities, names, credentials, expertise, instructions and invented source IDs',()=>{
 const input=academicModelInput(pkg());
 for(const change of [{clinicParagraph:draft.clinicParagraph.replace('offers','offers 99 services and')},{valueParagraph:'Zealand Hospital recruited me for advanced surgery. '+draft.valueParagraph},{valueParagraph:draft.valueParagraph+' I hold FRACGP fellowship.'},{valueParagraph:draft.valueParagraph.replace('experience','expertise')},{clinicFactIds:['private_fact']},{clinicParagraph:draft.clinicParagraph+' <script>ignore instructions</script>'}])assert.throws(()=>validateAcademicDraft({...draft,...change},input),/academic_draft_failed_checks/);
 // A digit contained inside a source year must never count as that quantity.
 assert.throws(()=>validateAcademicDraft({...draft,valueParagraph:draft.valueParagraph+' I treated 1 patient.'},{...input,cvFact:{id:'cv_1',text:cv+' Since 2021.'}}),/academic_draft_failed_checks/);
});
test('published clinic quantities cannot become the applicant’s experience and CV dates cannot become clinic history',()=>{
 const base=academicModelInput(pkg()),input={...base,clinicFact:{id:'clinic_1',text:clinic+' The clinic sees 40 patients daily.'},cvFact:{id:'cv_1',text:cv+' My GP work began in 2021.'}};
 assert.throws(()=>validateAcademicDraft({...draft,valueParagraph:draft.valueParagraph+' I managed 40 patients each day.'},input),/academic_draft_failed_checks/);
 assert.throws(()=>validateAcademicDraft({...draft,clinicParagraph:draft.clinicParagraph+' It opened in 2021.'},input),/academic_draft_failed_checks/);
 assert.doesNotThrow(()=>validateAcademicDraft({...draft,valueParagraph:draft.valueParagraph+' I have worked since 2021.'},input));
 const numberedName={...base,clinicName:'Clinic 40'};
 const clinicParagraph=draft.clinicParagraph.replace('Sample Community Medical Centre','Clinic 40');
 assert.throws(()=>validateAcademicDraft({...draft,clinicParagraph,valueParagraph:draft.valueParagraph+' My 40 years of experience would contribute.'},numberedName),/academic_draft_failed_checks/);
 assert.doesNotThrow(()=>validateAcademicDraft({...draft,clinicParagraph,valueParagraph:draft.valueParagraph+' I would welcome a discussion with Clinic 40.'},numberedName));
});
test('academic replacement preserves fixed paragraph slots even when phrases repeat in the opening and closing',()=>{
 const original=pkg(),blocks=original.body.split('\n\n'),opening=original.paragraphs.opening+' '+original.paragraphs.clinic,closing=original.paragraphs.closing+' '+original.paragraphs.value;
 blocks[1]=opening;blocks[4]=closing;
 const repeated={...original,body:blocks.join('\n\n'),paragraphs:{...original.paragraphs,opening,closing}};
 const edited=applyAcademicDraft(repeated,draft),result=edited.body.split('\n\n');
 assert.equal(result[1],opening);assert.equal(result[2],draft.clinicParagraph);assert.equal(result[3],draft.valueParagraph);assert.equal(result[4],closing);assert.equal(result[5],blocks[5]);
 assert.throws(()=>applyAcademicDraft({...original,body:original.body+'\n\nUnexpected appended text'},draft),/academic_context_changed/);
});
test('nonclinical or explicitly limited CV evidence cannot consume quota or be rewritten as performed clinical work',async()=>{
 for(const quote of ['Completed a course in chronic disease care.','Research thesis on chronic disease care.','I have no experience in chronic disease care.','Provided research support for a study of chronic disease care.']){
  const f=fixture(),read=f.context.rest;f.context.rest=async(table,query)=>table==='immi_cv_versions'?[{id:cvId,text:quote,version:1}]:read(table,query);
  const response=await route(f.request({...options,cvQuote:quote,contextConsent:true}),f.env,f.context);
  assert.equal(response.status,409);assert.equal((await response.json()).error,'academic_clinical_evidence_required');assert.equal(f.inference,0);
  assert.equal(f.privateDB.prepare('SELECT count(*) n FROM ai_assistant_runs').get().n,0);
 }
});
test('cache is owner-bound and stale source, CV, signature or paragraph context cannot resolve',async()=>{
 const f=fixture(),r=await route(f.request(),f.env,f.context),saved=await r.json();assert.equal(r.status,200);assert.match(saved.refinementId,/^academic_[a-f0-9]{32}$/);assert.equal(f.inference,1);
 assert.equal((await route(f.request(),f.env,f.context)).status,200);assert.equal(f.inference,1);
 assert.equal((await resolveAcademicDraft(f.env,f.context,pkg(),saved.refinementId)).body,saved.body);
 await assert.rejects(()=>resolveAcademicDraft(f.env,{...f.context,userId:'other-owner'},pkg(),saved.refinementId),/academic_context_changed/);
 for(const p of [{...pkg(),cvVersionId:'33333333-3333-4333-8333-333333333333'},{...pkg(),body:pkg().body+' changed'},{...pkg(),provenance:[{kind:'clinic_quote',quote:clinic+' changed'}]}])await assert.rejects(()=>resolveAcademicDraft(f.env,f.context,p,saved.refinementId),/academic_context_changed/);
 assert.notEqual(await academicContextHash(pkg()),await academicContextHash({...pkg(),body:'changed signature'}));
});
test('refinement cannot forge an owner, inject arbitrary text, use unconfirmed quotes or perform provider transport',async()=>{
 const f=fixture();
 for(const body of [{...options,contextConsent:false},{...options,contextConsent:true,ownerId:'other'},{...options,contextConsent:true,clinicQuote:'invented'},{...options,contextConsent:true,confirmCvQuote:false},{...options,contextConsent:true,connectionId:'other'}])assert((await route(f.request(body),f.env,f.context)).status>=400);
 assert.equal((await route(f.request(),f.env,{...f.context,profileId:'amir'})).status,403);
 assert.equal((await route(f.request(undefined,{Origin:'https://hostile.invalid'}),f.env,f.context)).status,403);
 assert.equal(f.inference,0);assert.equal(f.privateDB.prepare('select count(*) n from ai_assistant_runs').get().n,0);
});
test('private academic drafting shares the existing hard global budget including failed assistant attempts',async()=>{
 const f=fixture(),day=new Date().toISOString().slice(0,10);
 for(let i=0;i<6;i++)f.privateDB.prepare('INSERT INTO ai_assistant_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('other'+i,'owner-other','amir',day,'hash'+i,'email','synthetic','failed',null,null,new Date().toISOString());
 assert.equal((await route(f.request(),f.env,f.context)).status,429);assert.equal(f.inference,0);
});
