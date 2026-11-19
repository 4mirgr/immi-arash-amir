import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleGpLetterEditsRequest,resolveEditedLetter,gpLetterEditContextHash,validateManualLetterEdit,applyAdaptiveLetterStyle} from '../cloud/gp-letter-edits.mjs';
import {getGpApplicationPackage} from '../cloud/gp-application-package.mjs';
import {handleOpportunityMailRequest} from '../cloud/opportunity-mail.mjs';
import {encryptGoogleSecret} from '../cloud/google-oauth.mjs';

const origin='https://app.example.invalid',opp='opp_'+'1'.repeat(32),otherOpp='opp_'+'2'.repeat(32),cvId='22222222-2222-4222-8222-222222222222',presetId='11111111-1111-4111-8111-111111111111';
const clinic='Our practice provides chronic disease management and preventive care within a multidisciplinary team.';
const cv='Managed chronic diseases and acute presentations in general practice while coordinating care with a clinical team.';
const fixed={openingParagraph:'I am a general practitioner seeking an appropriately supervised clinical position in Australia.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',writingVersion:'human-four-paragraph-v1',confirmedByOwner:true,signatureEmail:'synthetic-doctor@example.invalid',signaturePhone:'+00 123 456 789'};
const profile={name:'Dr Synthetic Applicant',planning:{gpApplicationWriting:fixed}};
const selection={variant:'B',cvVersionId:cvId,clinicQuote:clinic,cvQuote:cv,confirmCvQuote:true};
const edited={clinicParagraph:'I would value the opportunity to join Synthetic Practice because its multidisciplinary approach fits the collaborative clinical environment in which I hope to develop my long-term general practice career.',valueParagraph:'My work in general practice has involved assessing acute presentations and following patients with chronic conditions. I would bring that clinical background to your team, remain open to feedback and adapt carefully to local protocols and agreed supervision.'};
function binding(db){return {prepare(sql){let args=[];return {_sql:sql,_args:[],bind(...values){args=values;this._args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};},async batch(statements){db.exec('BEGIN');try{const values=statements.map(item=>({results:db.prepare(item._sql).all(...item._args)}));db.exec('COMMIT');return values;}catch(error){db.exec('ROLLBACK');throw error;}}};}
async function fixture(){
 const db=new DatabaseSync(':memory:'),publicDb=new DatabaseSync(':memory:');
 for(const file of ['gp-letter-edits-schema.sql','google-schema.sql','google-send-schema.sql','mail-automation-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 publicDb.exec(readFileSync(new URL('../cloud/opportunity-v2-schema.sql',import.meta.url),'utf8'));
 publicDb.prepare('INSERT INTO opportunity_organizations VALUES(?,?,?,?,?,?,?,?)').run('org','Synthetic Practice','clinic.example.invalid','AU','NSW','{}','2026-01-01','2026-01-01');
 const source={id:opp,organization:'Synthetic Practice',title:'General Practitioner',url:'https://clinic.example.invalid/jobs/1',summary:clinic,fullText:clinic+' Apply to recruitment@clinic.example.invalid.',status:'open',kind:'vacancy',lastSeenAt:new Date().toISOString()};
 const put=(record=source)=>publicDb.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(record.id,'source',record.id,'org','edition-'+record.id,'both','official','job','AU','NSW',record.title,record.url,null,'2099-01-01','open',JSON.stringify(record),record.lastSeenAt,record.lastSeenAt);
 put();const own={profile:structuredClone(profile),cv:{id:cvId,text:cv,version:1},preset:{data:{name:'GP B — Independent practice enquiry',subject:'Saved template subject',body:'Saved template body'}}};
 const context={userId:'owner-arash',profileId:'arash',rest:async(table,query)=>{
  assert(query.includes('profile_id=eq.arash'));if(table==='immi_profiles')return [{data:own.profile}];
  if(table==='immi_cv_versions')return query.includes(cvId)?[own.cv]:[];
  if(table==='immi_cv_defaults')return[{version_id:cvId}];
  if(table==='immi_presets')return query.includes(presetId)?[own.preset]:[];
  throw Error('Unexpected private table '+table);
 }};
 const env={GOOGLE_DB:binding(db),OPPORTUNITY_DB:binding(publicDb),GOOGLE_TOKEN_KEY:Buffer.alloc(32,11).toString('base64'),GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',GOOGLE_REDIRECT_URI:origin+'/api/google/callback'};
 const encrypted=await encryptGoogleSecret(env,context.userId,{access_token:'synthetic-token'});
 db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(context.userId,'arash','synthetic-subject','synthetic-doctor@example.invalid',JSON.stringify(['https://www.googleapis.com/auth/gmail.send']),encrypted,Date.now()+3600000,'connected',Date.now());
 const request=(action,input,id=opp,headers={})=>new Request(origin+'/api/gp-writing/'+(action==='templates'?'templates':id+'/'+action)+'?profile=arash',{method:input?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...headers},...(input?{body:JSON.stringify(input)}:{})});
 const input=(overrides={})=>({selection,subjectIndex:0,...edited,saveMode:'replace',style:{focus:'teamwork',tone:'warm_professional'},...overrides});
 const call=(action,body,id,ctx=context,headers)=>handleGpLetterEditsRequest(request(action,body,id,headers),env,ctx);
 const pkg=()=>getGpApplicationPackage(env,context,opp,selection);
 const transportCalls=[];
 const mail=(action,body)=>handleOpportunityMailRequest(new Request(origin+'/api/opportunities/'+opp+'/mail/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),env,context,async url=>{transportCalls.push(url);throw Error('No real provider allowed');});
 return {db,publicDb,env,context,own,source,put,request,input,call,pkg,mail,transportCalls};
}

test('manual editing preserves fixed greeting, first/fourth paragraphs and contact signature',async()=>{
 const f=await fixture(),pkg=await f.pkg(),blocks=pkg.body.split('\n\n');
 blocks[2]=edited.clinicParagraph;blocks[3]=edited.valueParagraph;
 const validation=validateManualLetterEdit(pkg,{body:blocks.join('\n\n'),subjectIndex:0});assert.equal(validation.clinicParagraph,edited.clinicParagraph);
 for(const index of [0,1,4,5]){const changed=[...blocks];changed[index]+=' changed';assert.throws(()=>validateManualLetterEdit(pkg,{body:changed.join('\n\n'),subjectIndex:0}),/manual_letter_fixed_sections_changed/);}
 const response=await f.call('manual-edit',f.input()),saved=await response.json();assert.equal(response.status,201,JSON.stringify(saved));
 const result=saved.body.split('\n\n');assert.deepEqual([result[0],result[1],result[4],result[5]],[blocks[0],blocks[1],blocks[4],blocks[5]]);
 assert(saved.body.includes('Phone: '+fixed.signaturePhone));assert(saved.body.includes('Email: '+fixed.signatureEmail));assert.equal(saved.automaticSending,false);assert.equal(saved.writingQuality.manualTextIsOwnerReported,true);
 assert.match(saved.editedDraftId,/^gpedit_[a-f0-9]{32}$/);assert.match(saved.savedTemplate.id,/^gpstyle_[a-f0-9]{32}$/);assert.equal(saved.ownerRevision,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);assert.equal(f.transportCalls.length,0);
});
test('replace and new-template save immutable own revisions without changing presets or defaults',async()=>{
 const f=await fixture(),first=await(await f.call('manual-edit',f.input())).json();
 const next=await(await f.call('manual-edit',f.input({templateId:first.savedTemplate.id,editedDraftId:first.editedDraftId,valueParagraph:edited.valueParagraph+' I would welcome regular case discussion.'}))).json();
 assert.equal(next.ownerRevision,2);assert.equal(next.savedTemplate.revision,2);assert.notEqual(next.editedDraftId,first.editedDraftId);
 const separate=await(await f.call('manual-edit',f.input({saveMode:'new_template',templateName:'My team-focused letter'}))).json();assert.equal(separate.savedTemplate.revision,1);
 const listed=await(await f.call('templates')).json();assert.equal(listed.items.length,2);assert(listed.items.some(item=>item.revision===2));assert(listed.items.every(item=>item.clinicSpecificTextReused===false));
 const collision=await f.call('manual-edit',f.input({saveMode:'new_template',templateName:'My team-focused letter'}));assert.equal(collision.status,409);assert.equal((await collision.json()).error,'letter_template_name_exists');
 assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_edits').get().n,3);assert.equal(f.own.preset.data.body,'Saved template body');
 assert.equal((await f.call('templates',undefined,undefined,{...f.context,userId:'other-owner'})).status,200);assert.equal((await(await f.call('templates',undefined,undefined,{...f.context,userId:'other-owner'})).json()).items.length,0);
});
test('receipt resolution is bound to owner, opportunity, immutable CV, subject index, source evidence and signature',async()=>{
 const f=await fixture(),saved=await(await f.call('manual-edit',f.input())).json(),pkg=await f.pkg();
 assert.equal((await resolveEditedLetter(f.env,f.context,pkg,saved.editedDraftId,0)).body,saved.body);
 for(const context of [{...f.context,userId:'other-owner'},{...f.context,profileId:'amir'}])await assert.rejects(()=>resolveEditedLetter(f.env,context,pkg,saved.editedDraftId,0));
 for(const change of [{opportunityId:otherOpp},{cvVersionId:'33333333-3333-4333-8333-333333333333'},{subjects:[...pkg.subjects.slice(0,2),'changed']},{provenance:[{kind:'clinic_quote',quote:clinic+' changed'}]},{body:pkg.body.replace(fixed.signaturePhone,'+00 000 000 000')}])await assert.rejects(()=>resolveEditedLetter(f.env,f.context,{...pkg,...change},saved.editedDraftId,0));
 await assert.rejects(()=>resolveEditedLetter(f.env,f.context,pkg,saved.editedDraftId,1),/edited_letter_context_changed/);
 assert.notEqual(await gpLetterEditContextHash(pkg),await gpLetterEditContextHash({...pkg,writingQuality:{...pkg.writingQuality,version:'new-writing-context'}}));
});
test('unknown owner input, unconfirmed evidence, wrong source, header injection and missing clinic name fail closed',async()=>{
 const f=await fixture();
 for(const input of [f.input({ownerId:'other'}),f.input({selection:{...selection,confirmCvQuote:false}}),f.input({selection:{...selection,clinicQuote:'An invented clinic fact.'}}),f.input({subject:'Header\r\nBcc: attacker@example.invalid'}),f.input({clinicParagraph:'I would welcome working at A Completely Different Practice.'}),f.input({style:{focus:'guaranteed-supervisor'}}),f.input({body:'Dear Clinic,\n\nNot a canonical letter.'})]){
  const response=await f.call('manual-edit',input);assert(response.status>=400,await response.text());
 }
 assert.equal((await f.call('manual-edit',f.input(),undefined,{...f.context,profileId:'amir'})).status,403);
 assert.equal((await f.call('manual-edit',f.input(),undefined,f.context,{Origin:'https://hostile.invalid'})).status,403);
 assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_edits').get().n,0);assert.equal(f.transportCalls.length,0);
});
test('reusing an adaptive template regenerates current clinic/CV reasoning and never copies an old edited example',async()=>{
 const f=await fixture(),saved=await(await f.call('manual-edit',f.input({saveMode:'new_template',templateName:'Collaborative practice style'}))).json();
 const newer={...f.source,id:otherOpp,organization:'Fresh Community Practice',url:'https://clinic.example.invalid/jobs/2'};f.put(newer);
 const result=await f.call('apply-template',{selection,templateId:saved.savedTemplate.id,subjectIndex:2},otherOpp),fresh=await result.json();assert.equal(result.status,200,JSON.stringify(fresh));
 assert.match(fresh.editedDraftId,/^gpedit_/);assert(fresh.body.includes('Fresh Community Practice'));assert(!fresh.body.includes('Synthetic Practice'));assert(!fresh.body.includes(edited.clinicParagraph));
 assert.equal(fresh.manualSubjectIndex,2);assert.equal(fresh.writingQuality.method,'fresh_adaptive_template');assert.equal(fresh.clinicSpecificTextReused,false);assert.equal(fresh.templateName,'GP B — Independent practice enquiry');
 assert.equal(fresh.savedTemplate.name,'Collaborative practice style');assert.equal(f.transportCalls.length,0);
 const unsupported=applyAdaptiveLetterStyle(await f.pkg(),{focus:'acute',tone:'formal'});assert(!/clinic.*emergency|practice.*emergency/i.test(unsupported.paragraphs.clinic));
});
test('reviewed manual text reaches the exact public mail preview/queue and a changed manual receipt requires fresh approval',async()=>{
 const f=await fixture(),saved=await(await f.call('manual-edit',f.input())).json(),application={...selection,subjectIndex:0,editedDraftId:saved.editedDraftId};delete application.cvVersionId;
 const payload={presetId,cvVersionId:cvId,mailbox:'primary',recipient:'recruitment@clinic.example.invalid',application};
 const response=await f.mail('preview',payload),preview=await response.json();assert.equal(response.status,200,JSON.stringify(preview));assert(preview.message.body.includes(edited.clinicParagraph));assert(preview.message.body.includes(edited.valueParagraph));assert.equal(f.transportCalls.length,0);
 const newer=await(await f.call('manual-edit',f.input({editedDraftId:saved.editedDraftId,templateId:saved.savedTemplate.id,valueParagraph:edited.valueParagraph+' I would appreciate the opportunity to discuss your priorities.'}))).json();
 const stale=await f.mail('queue',{...payload,application:{...application,editedDraftId:newer.editedDraftId},confirmReviewed:true,reviewHash:preview.reviewHash});assert.equal(stale.status,409);assert.equal((await stale.json()).error,'application_changed_review_required');
 const queued=await f.mail('queue',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash}),result=await queued.json();assert.equal(queued.status,201,JSON.stringify(result));assert.equal(result.sent,false);assert.equal(f.db.prepare('SELECT count(*) n FROM google_send_queue').get().n,1);assert.equal(f.transportCalls.length,0);
 f.own.profile.planning.gpApplicationWriting.signaturePhone='+00 888 888 888';assert.equal((await f.mail('preview',payload)).status,409);
});
test('durable restore needs only an opaque own receipt and revalidates saved source/CV selections without restoring send approval',async()=>{
 const f=await fixture(),saved=await(await f.call('manual-edit',f.input())).json();
 const history=await(await f.call('manual-edit')).json();assert.equal(history.items[0].id,saved.editedDraftId);assert(!JSON.stringify(history).includes(edited.valueParagraph));
 const response=await f.call('restore-edit',{editedDraftId:saved.editedDraftId}),restored=await response.json();assert.equal(response.status,200,JSON.stringify(restored));assert.equal(restored.body,saved.body);assert.deepEqual(restored.restoredSelection,selection);assert.equal(restored.manualSubjectIndex,0);assert.equal(restored.manualReviewRequired,true);assert.equal(restored.automaticSending,false);
 assert.equal((await f.call('restore-edit',{editedDraftId:saved.editedDraftId},otherOpp)).status,409);
 assert.equal((await f.call('restore-edit',{editedDraftId:saved.editedDraftId},opp,{...f.context,userId:'other-owner'})).status,409);
 f.own.profile.planning.gpApplicationWriting.signaturePhone='+00 888 888 888';const changed=await f.call('restore-edit',{editedDraftId:saved.editedDraftId});assert.equal(changed.status,409);assert.equal((await changed.json()).error,'edited_letter_context_changed');assert.equal(f.transportCalls.length,0);
});
test('changing a manual letter subject creates another immutable revision, and the prior receipt cannot silently select it',async()=>{
 const f=await fixture(),saved=await(await f.call('manual-edit',f.input())).json(),pkg=await f.pkg();
 const response=await f.call('manual-edit',f.input({editedDraftId:saved.editedDraftId,templateId:saved.savedTemplate.id,subjectIndex:1,subject:'A separately reviewed subject'})),next=await response.json();assert.equal(response.status,201,JSON.stringify(next));assert.equal(next.manualSubjectIndex,1);assert.equal(next.ownerRevision,2);assert.equal(next.subjects[1],'A separately reviewed subject');
 assert.equal((await resolveEditedLetter(f.env,f.context,pkg,next.editedDraftId,1)).subjects[1],'A separately reviewed subject');
 await assert.rejects(()=>resolveEditedLetter(f.env,f.context,pkg,saved.editedDraftId,1),/edited_letter_context_changed/);
 assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_edits').get().n,2);assert.equal(f.transportCalls.length,0);
});
test('a failed letter write atomically rolls back its named template so a safe owner retry is possible',async()=>{
 const f=await fixture(),input=f.input({saveMode:'new_template',templateName:'A safely saved preference'});
 f.db.exec("CREATE TRIGGER simulated_edit_failure BEFORE INSERT ON gp_letter_edits BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END");
 const failed=await f.call('manual-edit',input);assert.equal(failed.status,503);assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_style_templates').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_edits').get().n,0);
 f.db.exec('DROP TRIGGER simulated_edit_failure');
 const retry=await f.call('manual-edit',input);assert.equal(retry.status,201);assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_style_templates').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_edits').get().n,1);assert.equal(f.transportCalls.length,0);
});
