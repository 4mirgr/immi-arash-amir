import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {encryptGoogleSecret} from '../cloud/google-oauth.mjs';
import {normalizeMessage} from '../cloud/google-mail.mjs';
import {ingestMailOpportunities,prepareOwnedMailOpportunity,handleMailOpportunitiesRequest,getOwnedMailOpportunityContext} from '../cloud/mail-opportunities.mjs';
import {handleMailOpportunityEditsRequest} from '../cloud/mail-opportunity-edits.mjs';
import {handleMailOpportunitySendRequest} from '../cloud/mail-opportunity-send.mjs';
import {seedVerifiedMailOpportunity} from './helpers/mail_opportunity_fixture.mjs';

const owner='11111111-1111-4111-8111-111111111111',other='44444444-4444-4444-8444-444444444444',cv1='22222222-2222-4222-8222-222222222222',cv2='33333333-3333-4333-8333-333333333333';
const origin='https://app.example.invalid',scopes=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'];
const profile={name:'Synthetic Applicant',planning:{gpApplicationWriting:{confirmedByOwner:true,writingVersion:'human-four-paragraph-v1',openingParagraph:'I am a general practitioner seeking a long-term supervised GP role in Australia.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',signatureEmail:'applicant@example.invalid',signaturePhone:'+61000000000'}}};
const cvText='Managed chronic disease consultations, acute presentations and preventive care in general practice.';
const edited={clinicParagraph:'I would value the opportunity to join Harbour Medical Centre because its approach to chronic disease management reflects the continuing patient care I hope to provide within a supportive clinical team.',valueParagraph:'My clinical work has included assessing acute presentations and following patients with chronic conditions. I would bring that experience to your practice, communicate openly with colleagues and remain receptive to feedback within the agreed supervision arrangements.'};
const outer={openingParagraph:'I am a general practitioner interested in a long-term clinical role in Australia, subject to appropriate registration and supervision arrangements.',closingParagraph:'I would welcome the opportunity to discuss your clinical priorities and whether my background would suit your team.'};
const raw=id=>({id,threadId:'thread_'+id,internalDate:String(Date.now()-60000),labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'Practice Manager <manager@clinic.example.invalid>'},{name:'To',value:'applicant@example.invalid'},{name:'Subject',value:'Australia General Practitioner vacancy at Harbour Medical Centre'},{name:'Message-ID',value:'<'+id+'@clinic.example.invalid>'}],body:{data:Buffer.from('Harbour Medical Centre is recruiting a general practitioner in regional Australia. Harbour Medical Centre provides chronic disease management, preventive care and wound care. Level 1 supervision and visa sponsorship may be available. Please email manager@clinic.example.invalid. https://clinic.example.invalid/careers/gp').toString('base64url')}}});

async function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['google-schema.sql','google-send-schema.sql','mail-automation-schema.sql','mail-automation-scheduler-schema.sql','clinic-bank-schema.sql','mail-opportunities-schema.sql','gp-letter-edits-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const counts={queries:0,http:0,sends:0},state={defaultId:null,beforeBatch:null,beforeClaim:null,onRead:null,sourceReads:0},versions=[{id:cv2,text:cvText+' Coordinated referrals for patients requiring specialist review.',version:2},{id:cv1,text:cvText,version:1}],messages=new Map();
 const statement=(sql,args=[])=>({_sql:sql,_args:args,bind(...values){return statement(sql,values);},async first(){counts.queries++;if(sql.startsWith("UPDATE google_send_queue SET status='sending'"))state.beforeClaim?.();return db.prepare(sql).get(...args)||null;},async all(){counts.queries++;return {results:db.prepare(sql).all(...args)};},async run(){counts.queries++;return {meta:db.prepare(sql).run(...args)};}});
 const binding={prepare:sql=>statement(sql),async batch(statements){state.beforeBatch?.();db.exec('BEGIN');try{const result=statements.map(item=>{counts.queries++;return {results:db.prepare(item._sql).all(...item._args)};});db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
 const env={GOOGLE_DB:binding,GOOGLE_TOKEN_KEY:Buffer.alloc(32,12).toString('base64'),GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',GOOGLE_REDIRECT_URI:origin+'/api/google/callback'};
 const context=(slot='primary')=>({userId:slot==='other'?other:owner+(slot==='secondary'?':secondary':''),rootUserId:slot==='other'?other:owner,profileId:'arash',mailbox:slot==='secondary'?'secondary':'primary',rest:async(table,query)=>{
  counts.http++;if(table==='immi_profiles')return[{data:profile}];if(table==='immi_cv_defaults')return state.defaultId?[{version_id:state.defaultId}]:[];
  if(table==='immi_cv_versions'){const match=query.match(/&id=eq\.([^&]+)/);return match?versions.filter(value=>value.id===match[1]):versions.slice(0,1);}throw Error('Unexpected private rest table');
 }});
 for(const slot of ['primary','secondary','other']){
  const ctx=context(slot),cipher=await encryptGoogleSecret(env,ctx.userId,{access_token:'synthetic-token-'+slot,refresh_token:'refresh-'+slot});
  db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(ctx.userId,'arash','subject-'+slot,slot+'@example.invalid',JSON.stringify(scopes),cipher,Date.now()+3600000,'connected',Date.now());
 }
 const fetcher=async(url,options={})=>{
  counts.http++;if(url.endsWith('/messages/send')){counts.sends++;return Response.json({id:'synthetic-sent-'+counts.sends});}
  assert(url.startsWith('https://gmail.googleapis.com/'));state.sourceReads++;await state.onRead?.();
  const slot=String(options.headers.Authorization).split('synthetic-token-')[1];const id=new URL(url).pathname.split('/').at(-1),message=messages.get(slot+':'+id);return message?Response.json(message):Response.json({},{status:404});
 };
 const seed=async(slot='primary')=>{
  const ctx=context(slot),message=raw('source_'+slot);messages.set(slot+':'+message.id,message);
  await ingestMailOpportunities(env,ctx,[normalizeMessage(message)],{subject:'subject-'+slot,email:slot+'@example.invalid'},{writingContext:{profile,cvText,cvVersionId:cv1}});
  const row=db.prepare('SELECT id FROM private_mail_opportunities WHERE owner_id=?').get(ctx.userId);assert(row);
  await seedVerifiedMailOpportunity(db,row.id,{profile,cvText,cvVersionId:cv1});return row.id;
 };
 const request=(id,action,body)=>new Request(origin+'/api/google/mail-opportunities/'+id+'/'+action+'?profile=arash',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const save=(id,body={...edited,cvVersionId:cv1},slot='primary')=>handleMailOpportunityEditsRequest(request(id,'edit',body),env,context(slot));
 const send=(id,action,body,slot='primary')=>handleMailOpportunitySendRequest(request(id,action,body),env,context(slot),fetcher);
 const reset=()=>{for(const key of Object.keys(counts))counts[key]=0;};
 return {db,env,context,counts,state,versions,messages,fetcher,seed,request,save,send,reset};
}

test('default preparation respects the owner default CV and latest-owned fallback while an explicit attachment stays pinned',async()=>{
 const f=await fixture(),id=await f.seed();
 assert.equal((await prepareOwnedMailOpportunity(f.env,f.context(),id)).cvVersionId,cv2);
 f.state.defaultId=cv1;assert.equal((await prepareOwnedMailOpportunity(f.env,f.context(),id)).cvVersionId,cv1);
 assert.equal((await prepareOwnedMailOpportunity(f.env,f.context(),id,{cvVersionId:cv2})).cvVersionId,cv2);
 await assert.rejects(()=>prepareOwnedMailOpportunity(f.env,f.context(),id,{cvVersionId:other}),/cv_version_required/);
});
test('private edits version all four owner paragraphs while preserving the signature and rehydrate on prepare/read',async()=>{
 const f=await fixture(),id=await f.seed(),before=await prepareOwnedMailOpportunity(f.env,f.context(),id,{cvVersionId:cv1});
 const response=await f.save(id,{...edited,...outer,cvVersionId:cv1}),saved=await response.json();assert.equal(response.status,201,JSON.stringify(saved));assert.match(saved.editedDraftId,/^moedit_[a-f0-9]{32}$/);assert.equal(saved.editRevision,1);assert.equal(saved.editStatus,'owner_edited');
 const prior=before.body.split('\n\n'),after=saved.body.split('\n\n');assert.deepEqual([after[0],after[5]],[prior[0],prior[5]]);assert.equal(after[1],outer.openingParagraph);assert.equal(after[4],outer.closingParagraph);assert(saved.body.includes(edited.valueParagraph));
 const cached=JSON.parse(f.db.prepare('SELECT draft_json FROM private_mail_opportunities WHERE id=?').get(id).draft_json);assert.equal(cached.body,before.body);assert.notEqual(cached.body,saved.body);
 const journal=f.db.prepare('SELECT * FROM gp_letter_edits WHERE id=?').get(saved.editedDraftId);assert.equal(journal.owner_id,owner);assert.equal(JSON.parse(journal.selection_json).kind,'private_mail_opportunity_v1');assert.deepEqual(JSON.parse(journal.selection_json).ownerParagraphs,{version:'owner-paragraphs-v1',...outer});assert.equal(journal.cv_version_id,cv1);
 assert.equal((await prepareOwnedMailOpportunity(f.env,f.context(),id,{cvVersionId:cv1})).body,saved.body);
 const read=await handleMailOpportunitiesRequest(new Request(origin+'/api/google/mail-opportunities/'+id+'?profile=arash'),f.env,f.context()),item=await read.json();assert.equal(item.draft.editedDraftId,saved.editedDraftId);assert.equal(item.draft.body,saved.body);
 assert.equal(f.counts.sends,0);
});
test('changing the selected CV retains the old edit for review and permits a fresh explicitly saved case without deleting history',async()=>{
 const f=await fixture(),id=await f.seed(),saved=await(await f.save(id,{...edited,...outer,cvVersionId:cv1})).json();
 const changed=await prepareOwnedMailOpportunity(f.env,f.context(),id,{cvVersionId:cv2});assert.equal(changed.readyForReview,false);assert.equal(changed.editStatus,'saved_edit_needs_review');assert.equal(changed.savedEdit.id,saved.editedDraftId);assert.equal(changed.savedEdit.openingParagraph,outer.openingParagraph);assert.equal(changed.savedEdit.closingParagraph,outer.closingParagraph);assert(changed.body);assert.equal(changed.cvVersionId,cv2);
 const response=await f.save(id,{...edited,...outer,cvVersionId:cv2}),next=await response.json();assert.equal(response.status,201,JSON.stringify(next));assert.equal(next.editRevision,2);assert.equal(next.readyForReview,true);assert.equal(next.cvVersionId,cv2);assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_edits').get().n,2);
 assert.equal((await prepareOwnedMailOpportunity(f.env,f.context(),id,{cvVersionId:cv2})).editedDraftId,next.editedDraftId);
});
test('a successful source reread cannot silently overwrite owner text; changed source evidence requires rebase review',async()=>{
 const f=await fixture(),id=await f.seed(),saved=await(await f.save(id)).json();
 await seedVerifiedMailOpportunity(f.db,id,{profile,cvText,cvVersionId:cv1},{now:Date.now()+1,clinicalFacts:['Harbour Medical Centre provides chronic disease management, preventive care and wound care with a multidisciplinary team.']});
 const changed=await prepareOwnedMailOpportunity(f.env,f.context(),id,{cvVersionId:cv1});assert.equal(changed.editStatus,'saved_edit_needs_review');assert.equal(changed.savedEdit.valueParagraph,edited.valueParagraph);assert.equal(changed.readyForReview,false);assert(changed.body);assert.equal(f.db.prepare('SELECT id FROM gp_letter_edits').get().id,saved.editedDraftId);
 assert.equal((await f.send(id,'preview',{cvVersionId:cv1,editedDraftId:saved.editedDraftId})).status,409);
 const rebased=await f.save(id,{...edited,cvVersionId:cv1,valueParagraph:edited.valueParagraph+' I would welcome case discussion.'});assert.equal(rebased.status,201);assert.equal(f.counts.sends,0);
});
test('wrong owner, mailbox, Google identity, fixed-section edits and unpublished evidence cannot authorize a saved ready message',async()=>{
 const f=await fixture(),id=await f.seed(),canonical=await prepareOwnedMailOpportunity(f.env,f.context(),id,{cvVersionId:cv1});
 for(const slot of ['other','secondary'])assert.equal((await f.save(id,undefined,slot)).status,404);
 const changed=canonical.body.replace('Kind regards,','Many thanks,');assert.equal((await f.save(id,{cvVersionId:cv1,body:changed})).status,409);
 assert.equal((await f.save(id,{...edited,cvVersionId:cv1,subject:'hello\r\nBcc: attack@example.invalid'})).status,400);
 f.db.prepare("UPDATE private_mail_opportunities SET data_json=json_set(data_json,'$.research.publicEmployerVerified',json('false')) WHERE id=?").run(id);assert.equal((await f.save(id)).status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_edits').get().n,0);
 assert.equal(f.counts.sends,0);
});
test('private edited receipt drives exact preview/send and an identically worded newer edit invalidates an old approval',async()=>{
 const f=await fixture(),id=await f.seed(),saved=await(await f.save(id)).json();
 const previewResponse=await f.send(id,'preview',{cvVersionId:cv1,editedDraftId:saved.editedDraftId}),preview=await previewResponse.json();assert.equal(previewResponse.status,200,JSON.stringify(preview));assert.equal(preview.coverLetter,saved.body);assert.notEqual(preview.message.body,saved.body);assert.equal(preview.attachments.length,2);assert(preview.attachments.every(item=>item.mimeType==='application/pdf'&&item.size>0&&item.hash));assert.equal(preview.editedDraftId,saved.editedDraftId);
 const newer=await(await f.save(id,{...edited,cvVersionId:cv1,editedDraftId:saved.editedDraftId})).json();assert.equal(newer.body,saved.body);assert.notEqual(newer.editedDraftId,saved.editedDraftId);
 const stale=await f.send(id,'send',{cvVersionId:cv1,editedDraftId:saved.editedDraftId,reviewHash:preview.reviewHash,confirmSend:true});assert.equal(stale.status,409);assert.equal(f.counts.sends,0);
 const fresh=await(await f.send(id,'preview',{cvVersionId:cv1,editedDraftId:newer.editedDraftId})).json();f.reset();
 const sent=await f.send(id,'send',{cvVersionId:cv1,editedDraftId:newer.editedDraftId,recipient:fresh.recipient,reviewHash:fresh.reviewHash,confirmSend:true}),outcome=await sent.json();assert.equal(sent.status,200,JSON.stringify(outcome));assert.equal(outcome.sent,true);assert.equal(f.counts.sends,1);assert(f.counts.queries+f.counts.http+2<=50,JSON.stringify(f.counts));
});
test('a changed source or failed atomic edit storage leaves no orphan ready artifact',async()=>{
 const f=await fixture(),id=await f.seed();
 f.state.beforeBatch=()=>{f.state.beforeBatch=null;f.db.prepare("UPDATE private_mail_opportunities SET status='source_removed',updated_at=updated_at+1 WHERE id=?").run(id);};
 const raced=await f.save(id);assert.equal(raced.status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_edits').get().n,0);assert.equal(f.counts.sends,0);
});
test('the final owned source guard returns a journal head for an atomic send claim and rejects an explicitly superseded receipt',async()=>{
 const f=await fixture(),id=await f.seed(),saved=await(await f.save(id)).json();
 const guarded=await getOwnedMailOpportunityContext(f.env,owner,{id,editedDraftId:saved.editedDraftId},f.fetcher);assert.equal(guarded.body,saved.body);assert.equal(guarded.editedDraftId,saved.editedDraftId);assert.equal(guarded.sourceState.ownerEditRevision,1);
 const newer=await(await f.save(id,{...edited,cvVersionId:cv1,editedDraftId:saved.editedDraftId})).json();await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id,editedDraftId:saved.editedDraftId},f.fetcher),/mail_opportunity_edit_context_changed/);
 assert.equal((await getOwnedMailOpportunityContext(f.env,owner,{id,editedDraftId:newer.editedDraftId},f.fetcher)).sourceState.ownerEditRevision,2);assert.equal(f.counts.sends,0);
});
test('a newer identical edit after source validation blocks the atomic transport claim even when cached source bytes are unchanged',async()=>{
 const f=await fixture(),id=await f.seed(),saved=await(await f.save(id)).json(),preview=await(await f.send(id,'preview',{cvVersionId:cv1,editedDraftId:saved.editedDraftId})).json();
 f.state.beforeClaim=()=>{
  f.state.beforeClaim=null;const previous=f.db.prepare('SELECT * FROM gp_letter_edits WHERE id=?').get(saved.editedDraftId),next={...previous,id:'moedit_'+'f'.repeat(32),revision:previous.revision+1},columns=Object.keys(next);
  f.db.prepare('INSERT INTO gp_letter_edits('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(key=>next[key]));
 };
 const response=await f.send(id,'send',{cvVersionId:cv1,editedDraftId:saved.editedDraftId,recipient:preview.recipient,reviewHash:preview.reviewHash,confirmSend:true}),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.sent,false);assert.equal(result.status,'not_claimed');assert.equal(f.counts.sends,0);
});
test('an identical edit created during queue source reading cannot replace either a reviewed generated message or its exact edited receipt',async()=>{
 for(const mode of ['generated','edited']){
  const f=await fixture(),id=await f.seed(),saved=mode==='edited'?await(await f.save(id)).json():null;
  const selection={cvVersionId:cv1,...(saved?{editedDraftId:saved.editedDraftId}:{})},preview=await(await f.send(id,'preview',selection)).json();assert(preview.reviewHash);
  f.state.sourceReads=0;f.state.onRead=async()=>{
   if(f.state.sourceReads!==1)return;f.state.onRead=null;
   const response=await f.save(id,{cvVersionId:cv1,body:preview.coverLetter,...(saved?{editedDraftId:saved.editedDraftId}:{})}),updated=await response.json();assert.equal(response.status,201,JSON.stringify(updated));assert.equal(updated.body,preview.coverLetter);
  };
  const response=await f.send(id,'send',{...selection,recipient:preview.recipient,reviewHash:preview.reviewHash,confirmSend:true});assert(response.status>=400,await response.text());assert.equal(f.counts.sends,0);assert.equal(f.db.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);
 }
});
test('legacy private revisions retain P2/P3 and canonical outer paragraphs; an outer-only edit requires a fresh mail review',async()=>{
 const f=await fixture(),id=await f.seed(),saved=await(await f.save(id)).json();
 f.db.prepare("UPDATE gp_letter_edits SET selection_json=json_remove(selection_json,'$.ownerParagraphs') WHERE id=?").run(saved.editedDraftId);
 const legacy=await prepareOwnedMailOpportunity(f.env,f.context(),id,{cvVersionId:cv1});assert.equal(legacy.body,saved.body);assert.equal(legacy.editStatus,'owner_edited');
 const preview=await(await f.send(id,'preview',{cvVersionId:cv1,editedDraftId:saved.editedDraftId})).json();
 const nextResponse=await f.save(id,{...edited,...outer,cvVersionId:cv1,editedDraftId:saved.editedDraftId}),next=await nextResponse.json();assert.equal(nextResponse.status,201,JSON.stringify(next));assert.equal(next.editRevision,2);assert.equal(next.paragraphs.opening,outer.openingParagraph);assert.equal(next.paragraphs.closing,outer.closingParagraph);
 const stale=await f.send(id,'send',{cvVersionId:cv1,editedDraftId:next.editedDraftId,reviewHash:preview.reviewHash,confirmSend:true});assert.equal(stale.status,409);assert.equal(f.counts.sends,0);
 const fresh=await(await f.send(id,'preview',{cvVersionId:cv1,editedDraftId:next.editedDraftId})).json();assert.equal(fresh.coverLetter,next.body);assert.notEqual(fresh.reviewHash,preview.reviewHash);assert.equal(fresh.attachments.length,2);assert.equal(f.db.prepare('SELECT count(*) n FROM gp_letter_edits').get().n,2);
});
