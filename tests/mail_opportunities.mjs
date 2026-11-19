import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {normalizeMessage} from '../cloud/google-mail.mjs';
import {withPublicEmployerEvidence,seedVerifiedMailOpportunity} from './helpers/mail_opportunity_fixture.mjs';
import {extractMailOpportunityCandidates,ingestMailOpportunities,processMailOpportunityInputs,prepareMailOpportunityDraft,prepareOwnedMailOpportunity,handleMailOpportunitiesRequest,getOwnedMailOpportunityContext,invalidateMailOpportunities,invalidateMailOpportunityHistory} from '../cloud/mail-opportunities.mjs';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',cv='33333333-3333-4333-8333-333333333333',now=Date.now();
const writing={profile:{name:'Synthetic Applicant',planning:{gpApplicationWriting:{confirmedByOwner:true,writingVersion:'human-four-paragraph-v1',openingParagraph:'I am a general practitioner seeking a long-term supervised GP role in Australia.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',signatureEmail:'applicant@example.invalid',signaturePhone:'+61000000000'}}},cvText:'Managed chronic disease consultations, preventive care and wound care in general practice.',cvVersionId:cv};
function rawMessage(id='mail1',overrides={}){
 const body=overrides.body||'A GP position is available in Australia. Harbour Medical Centre provides chronic disease management, preventive care and wound care in regional Australia. Please send your CV to careers@harbour.example.invalid.\nhttps://harbour.example.invalid/careers/gp';
 return {id,threadId:'thread-'+id,labelIds:['INBOX'],internalDate:String(now-86400000),payload:{mimeType:'text/plain',headers:[{name:'From',value:overrides.from||'Practice Manager <manager@harbour.example.invalid>'},{name:'To',value:'applicant@example.invalid'},{name:'Subject',value:overrides.subject||'General Practitioner position at Harbour Medical Centre'},{name:'Message-ID',value:'<'+id+'@harbour.example.invalid>'}],body:{data:Buffer.from(body).toString('base64url')}},...overrides.raw};
}
const message=(id,overrides)=>normalizeMessage(rawMessage(id,overrides));
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['google-schema.sql','mail-opportunities-schema.sql','clinic-bank-schema.sql','mail-automation-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 let queries=0;const binding={prepare(sql){let args=[];return{bind(...values){assert(values.length<=100,'D1 binding limit');args=values;return this;},async first(){queries++;return db.prepare(sql).get(...args)||null;},async all(){queries++;return {results:db.prepare(sql).all(...args)};},async run(){queries++;return {meta:db.prepare(sql).run(...args)};}};}};
 const env={GOOGLE_DB:binding},contexts={primary:{userId:owner,rootUserId:owner,profileId:'arash',mailbox:'primary'},secondary:{userId:owner+':secondary',rootUserId:owner,profileId:'arash',mailbox:'secondary'},other:{userId:other,rootUserId:other,profileId:'arash',mailbox:'primary'}};
 for(const [context,sub]of [[contexts.primary,'sub1'],[contexts.secondary,'sub2'],[contexts.other,'sub3']])db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(context.userId,'arash',sub,'applicant@example.invalid','[]','not-real',0,'connected',now);
 return{db,env,...contexts,identity:{subject:'sub1',email:'applicant@example.invalid',mailbox:'primary'},queries:()=>queries,resetQueries:()=>{queries=0;}};
}
test('received GP opportunities are private findings; Sent, non-medical, quoted, spam and unrelated-country messages are excluded',async()=>{
 assert.equal((await extractMailOpportunityCandidates(message('m1'))).length,1);
 for(const m of [message('sent',{raw:{labelIds:['SENT']}}),message('spam',{raw:{labelIds:['SPAM']}}),message('draft',{raw:{labelIds:['DRAFT']}}),message('notjob',{subject:'Clinical case conference',body:'A general practitioner from Australia discusses wound care.'}),message('uk',{from:'manager@practice.example.invalid',subject:'GP vacancy',body:'General Practitioner job available in London, United Kingdom.'}),message('quoted',{subject:'Thanks',body:'Thank you.\n\nOn Monday, Synthetic Applicant wrote:\n> General Practitioner position in Australia.\n> A GP job is available at Harbour Medical Centre.'})])assert.equal((await extractMailOpportunityCandidates(m)).length,0,m.id);
});
test('LinkedIn digest creates separate GP job candidates and ignores no-reply as a recruitment recipient',async()=>{
 const m=message('digest',{from:'LinkedIn <jobs-noreply@linkedin.com>',subject:'Jobs for you in Australia',body:'General Practitioner jobs in Australia. Multiple job opportunities.'});
 m.links=[{url:'https://www.linkedin.com/comm/jobs/view/12345?trackingId=one',label:'General Practitioner — Harbour Medical Centre'},{url:'https://www.linkedin.com/jobs/view/98765?trk=email',label:'General Practitioner — Coast Medical Centre'},{url:'https://www.linkedin.com/jobs/view/33333/',label:'Registered Nurse'},{url:'https://www.linkedin.com/jobs/view/22222/',label:'General Practitioner — Quoted Medical Centre',quoted:true},{url:'https://www.linkedin.com/notifications/',label:'Manage preferences'}];
 const candidates=await extractMailOpportunityCandidates(m);assert.equal(candidates.length,2);assert.deepEqual(candidates.map(x=>x.sourceUrl),['https://www.linkedin.com/jobs/view/12345/','https://www.linkedin.com/jobs/view/98765/']);assert(candidates.every(x=>x.recipient===null));assert(candidates.every(x=>x.sourceKind==='linkedin_alert'));assert(candidates.every(x=>x.clinicalFacts.length===0));
});
test('a private email remains a lead; verified public clinic facts and matching own CV produce the reviewed four-paragraph letter',async()=>{
 const lead=(await extractMailOpportunityCandidates(message('ready')))[0],unverified=await prepareMailOpportunityDraft(lead,writing,{now});assert.equal(unverified.readyForReview,false);assert(unverified.missing.includes('public_employer_verification_required'));
 const candidate=withPublicEmployerEvidence(lead,{now}),draft=await prepareMailOpportunityDraft(candidate,writing,{now});
 assert.equal(draft.readyForReview,true,JSON.stringify(draft.missing));assert.equal(draft.status,'ready_for_review');assert.equal(draft.body.split('\n\n').length,6);assert(draft.body.includes('Harbour Medical Centre'));assert(draft.body.includes('Phone: +61000000000'));assert(draft.body.includes('Email: applicant@example.invalid'));assert.equal(draft.paragraphs.opening,writing.profile.planning.gpApplicationWriting.openingParagraph);assert.equal(draft.paragraphs.closing,writing.profile.planning.gpApplicationWriting.closingParagraph);assert.equal(draft.factBasis.kind,'source_published_statement');assert.equal(draft.reviewRequired,true);
 const incomplete=await prepareMailOpportunityDraft(candidate,{});assert.equal(incomplete.readyForReview,false);assert(incomplete.missing.includes('cv_version_required'));assert.equal(incomplete.body,'');
 const noContact=await prepareMailOpportunityDraft({...candidate,recipient:null,recipients:[]},writing);assert.equal(noContact.status,'needs_contact');
});
test('a legacy ready draft cannot turn unverified private mail into a sendable public opportunity',async()=>{
 const f=fixture();await ingestMailOpportunities(f.env,f.primary,[message('legacy-ready')],f.identity,{writingContext:writing});const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),lead=JSON.parse(row.data_json),draft=await prepareMailOpportunityDraft(withPublicEmployerEvidence(lead,{now}),writing,{now});
 f.db.prepare('UPDATE private_mail_opportunities SET draft_json=? WHERE id=?').run(JSON.stringify(draft),row.id);
 const response=await handleMailOpportunitiesRequest(new Request('https://workspace.example/api/google/mail-opportunities/'+row.id),f.env,f.primary),view=await response.json();assert.equal(response.status,200);assert.equal(view.research.verified,false);assert.equal(view.draft.readyForReview,false);assert(view.draft.missing.includes('public_employer_verification_required'));
 let reads=0;const access=async()=>({subject:'sub1',email:'applicant@example.invalid',accessToken:'synthetic',scopes:['https://www.googleapis.com/auth/gmail.readonly']});await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id:row.id},async()=>{reads++;return Response.json(rawMessage('legacy-ready'));},access),/mail_opportunity_public_evidence_required/);assert.equal(reads,0);
});
test('public employer evidence must remain current, source-bound and verified at draft and send time',async t=>{
 const cases=[
  ['unverified employer',data=>{data.research.publicEmployerVerified=false;},'public_employer_verification_required'],
  ['legacy verification version',data=>{data.research.verification.version=0;},'public_employer_verification_required'],
  ['expired verification',data=>{data.research.verification.checkedAt=new Date(now-8*86400000).toISOString();},'public_employer_verification_required'],
  ['future verification',data=>{data.research.verification.checkedAt=new Date(now+120000).toISOString();},'public_employer_verification_required'],
  ['changed employer identity',data=>{data.research.verification.clinicName='Coast Medical Centre';},'public_employer_identity_required'],
  ['name mentioned without self-brand evidence',data=>{delete data.research.verification.identityEvidence[0].authority;},'published_employer_name_required'],
  ['latest read failed after older successful research',data=>{data.research.sourcePages.push({...data.research.sourcePages[0],status:'robots_disallowed',readAt:new Date(now+1).toISOString()});},'latest_public_employer_read_required'],
  ['clinic facts from another host',data=>{data.research.facts[0].sourceURL='https://unrelated.example.org/services';},'published_clinic_context_required'],
  ['address absent from published quote',data=>{data.research.contactEvidence[0].quote='Contact the practice manager.';},'published_recruitment_contact_required'],
  ['additional recipient lacks publication evidence',data=>{data.recipients.push('unpublished@example.invalid');},'published_recipient_required'],
 ];
 for(const [label,change,reason]of cases)await t.test(label,async()=>{
  const f=fixture(),raw=rawMessage('evidence-'+label.replace(/[^a-z]/g,''));await ingestMailOpportunities(f.env,f.primary,[normalizeMessage(raw)],f.identity,{writingContext:writing});const id=f.db.prepare('SELECT id FROM private_mail_opportunities').get().id,{data,draft}=await seedVerifiedMailOpportunity(f.db,id,writing,{now});change(data);
  const blocked=await prepareMailOpportunityDraft(data,writing,{now});assert.equal(blocked.readyForReview,false);assert(blocked.missing.includes(reason),JSON.stringify(blocked.missing));
  // Keep an older, ready stored draft to ensure transport checks current proof,
  // rather than trusting the status left behind by a previous successful read.
  f.db.prepare('UPDATE private_mail_opportunities SET data_json=?,draft_json=? WHERE id=?').run(JSON.stringify(data),JSON.stringify(draft),id);
  let reads=0;const access=async()=>({subject:'sub1',email:'applicant@example.invalid',accessToken:'synthetic',scopes:['https://www.googleapis.com/auth/gmail.readonly']});await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id},async()=>{reads++;return Response.json(raw);},access),/mail_opportunity_public_evidence_required/);assert.equal(reads,0);
 });
});
test('ingestion is idempotent, owner/subject scoped, bounded, and never writes the shared bank',async()=>{
 const f=fixture(),m=message('new1');f.resetQueries();const result=await ingestMailOpportunities(f.env,f.primary,[m],f.identity,{writingContext:writing});assert.equal(result.processed,1);assert(f.queries()<=5);const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get();assert.equal(row.owner_id,owner);assert.equal(row.google_sub,'sub1');assert.equal(JSON.parse(row.draft_json).readyForReview,false);assert(JSON.parse(row.draft_json).missing.includes('public_employer_verification_required'));assert.equal(f.db.prepare('SELECT count(*) n FROM clinic_bank_leads').get().n,0);assert.equal(f.db.prepare('SELECT payload_json FROM private_mail_opportunity_inputs').get().payload_json,'{}');
 await ingestMailOpportunities(f.env,f.primary,[m],f.identity,{writingContext:writing});assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_opportunities').get().n,1);
 await ingestMailOpportunities(f.env,f.secondary,[m],{...f.identity,subject:'sub2'},{writingContext:writing});assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_opportunities').get().n,2);
});
test('private input storage failures retain a safe stage and never expose database details',async()=>{
 const f=fixture(),prepare=f.env.GOOGLE_DB.prepare.bind(f.env.GOOGLE_DB),original=Error('private message and SQL parameter details');
 f.env.GOOGLE_DB.prepare=sql=>{if(sql.startsWith('INSERT INTO private_mail_opportunity_inputs'))throw original;return prepare(sql);};
 await assert.rejects(ingestMailOpportunities(f.env,f.primary,[message('storage-failure')],f.identity,{writingContext:writing}),error=>error.code==='mail_opportunity_input_enqueue_failed'&&error.status===503&&error.cause===original&&!error.message.includes('private message'));
});
test('database diagnostics disclose only a predefined error family, never private exception text',async()=>{
 for(const [detail,suffix]of [
  ['too many SQL variables','_parameter_limit'],
  ['Too many bound parameters','_parameter_limit'],
  ['D1_TYPE_ERROR: Type undefined not supported','_binding'],
  ['Too many subrequests','_limit'],
  ['too many terms in compound SELECT: SQLITE_ERROR','_limit'],
  ['Query count limit exceeded','_limit'],
  ['no such table: private_table','_schema'],
  ['table private_table has no column named private_field','_schema'],
  ['NOT NULL constraint failed: private_field','_constraint'],
  ['malformed JSON','_json'],
  ['unknown transport failure',''],
 ]){
  const f=fixture(),prepare=f.env.GOOGLE_DB.prepare.bind(f.env.GOOGLE_DB),original=Error('PRIVATE_CANARY '+detail);
  f.env.GOOGLE_DB.prepare=sql=>{if(sql.startsWith('INSERT INTO private_mail_opportunity_inputs'))throw original;return prepare(sql);};
  await assert.rejects(ingestMailOpportunities(f.env,f.primary,[message('family-check')],f.identity,{writingContext:writing}),error=>error.code==='mail_opportunity_input_enqueue_failed'+suffix&&error.message===error.code&&error.code.length<=80&&!error.message.includes('PRIVATE_CANARY')&&error.cause===original);
 }
});
test('an eight-message Gmail batch is lossless under D1 compound-SELECT limits and uses one input insert',async()=>{
 const f=fixture(),prepare=f.env.GOOGLE_DB.prepare.bind(f.env.GOOGLE_DB),inserts=[];
 f.env.GOOGLE_DB.prepare=sql=>{
  // Native SQLite allows more compound terms than production D1. Exercise
  // that runtime boundary explicitly rather than depending on local defaults.
  const terms=1+(sql.match(/\bUNION(?:\s+ALL)?\b/gi)||[]).length;
  if(terms>5)throw Error('too many terms in compound SELECT: SQLITE_ERROR');
  if(sql.startsWith('INSERT INTO private_mail_opportunity_inputs'))inserts.push(sql);
  return prepare(sql);
 };
 const batch=Array.from({length:8},(_,index)=>message('bounded-batch-'+index));
 f.resetQueries();const result=await ingestMailOpportunities(f.env,f.primary,batch,f.identity,{now,writingContext:writing});
 assert.equal(result.queued,8);assert.equal(inserts.length,1);assert(!inserts[0].includes('UNION'));assert(f.queries()<=5);
 const inputs=f.db.prepare('SELECT owner_id,root_owner_id,google_sub,gmail_id,status,payload_json FROM private_mail_opportunity_inputs ORDER BY gmail_id').all();
 assert.equal(inputs.length,8);assert.deepEqual(inputs.map(row=>row.gmail_id),batch.map(item=>item.id).sort());
 assert(inputs.every(row=>row.owner_id===owner&&row.root_owner_id===owner&&row.google_sub===f.identity.subject));
 assert.equal(inputs.filter(row=>row.status==='completed').length,1);
 assert(inputs.filter(row=>row.status==='queued').every(row=>JSON.parse(row.payload_json).id===row.gmail_id));
 for(let index=0;index<7;index++)await processMailOpportunityInputs(f.env,f.primary,f.identity,{now:now+index+1,writingContext:writing});
 assert.equal(f.db.prepare("SELECT count(*) n FROM private_mail_opportunity_inputs WHERE status<>'completed'").get().n,0);
});
test('large job digests retain every candidate in a durable cursor rather than dropping links after a fixed first subset',async()=>{
 const f=fixture(),m=message('large',{from:'jobs@linkedin.com',subject:'General Practitioner jobs in Australia',body:'General Practitioner positions available in Australia.'});m.links=Array.from({length:11},(_,i)=>({url:'https://www.linkedin.com/jobs/view/'+(10000+i)+'/',label:'General Practitioner — Harbour Medical Centre'}));
 const first=await ingestMailOpportunities(f.env,f.primary,[m],f.identity,{writingContext:writing});assert.equal(first.processed,3);assert.equal(first.more,true);
 for(let i=0;i<3;i++)await processMailOpportunityInputs(f.env,f.primary,f.identity,{writingContext:writing});assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_opportunities').get().n,11);const input=f.db.prepare('SELECT * FROM private_mail_opportunity_inputs').get();assert.equal(input.status,'completed');assert.equal(input.candidate_offset,11);assert.equal(input.payload_json,'{}');
});
test('duplicate LinkedIn job alerts do not create repeated opportunities; send application key is independent of mailbox and Gmail IDs',async()=>{
 const f=fixture(),make=id=>{const m=message(id);m.links=[{url:'https://www.linkedin.com/jobs/view/12345?trk='+id,label:'General Practitioner — Harbour Medical Centre'}];return m;};
 await ingestMailOpportunities(f.env,f.primary,[make('one')],f.identity,{writingContext:writing});await ingestMailOpportunities(f.env,f.primary,[make('two')],f.identity,{writingContext:writing});assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_opportunities').get().n,1);
});
test('do-not-contact suppression prevents notification eligibility; explicitly restricted sponsorship does not become a strong fit',async()=>{
 const f=fixture();f.db.prepare('INSERT INTO mail_automation_suppressions VALUES(?,?,?,?)').run(owner,'careers@harbour.example.invalid','owner_requested','2026-01-01');await ingestMailOpportunities(f.env,f.primary,[message('stopped')],f.identity,{writingContext:writing});assert.equal(f.db.prepare('SELECT notification_eligible FROM private_mail_opportunities').get().notification_eligible,0);
 const restricted=message('restricted',{body:'A General Practitioner job is available in Australia. Harbour Medical Centre provides chronic disease care. Visa sponsorship is not available.'});const candidate=(await extractMailOpportunityCandidates(restricted))[0];assert.equal(candidate.fit.sponsorship,'restricted');assert.equal(candidate.notificationEligible,false);
});
test('a statement that visa sponsorship is not required is not converted to an employer refusal',async()=>{
 const m=message('no-prerequisite',{body:'A General Practitioner job is available in Australia. Harbour Medical Centre provides chronic disease care. No visa sponsorship required.'});
 const candidates=await extractMailOpportunityCandidates(m);assert.equal(candidates.length,1);assert.equal(candidates[0].fit.sponsorship,'unknown');
});
test('own bank matching requires current published name, source-bound contact quote and exact clinic host rather than a recruiter or uploaded address',async()=>{
 const f=fixture(),stamp=new Date(now).toISOString();
 for(const [id,url,title,contact,quote,clinical]of [['wrong','https://recruiter.example.org/','Recruiter Medical Centre','wrong@recruiter.example.org','wrong@recruiter.example.org','Recruiter Medical Centre provides emergency care.'],['real','https://harbour.example.org/','Harbour Medical Centre','published@harbour.example.org','Applications: published@harbour.example.org','Harbour Medical Centre provides chronic disease management and wound care.']])f.db.prepare('INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,status,read_at,last_success_at,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,'arash',url,title,'public_contacts_found',stamp,stamp,JSON.stringify({sourceStatus:'read',sourceURL:url,title,clinicalText:clinical,clinicalSourceURL:url,clinicalReadAt:stamp,contactsReadAt:stamp,lastAttempt:{status:'read',sourceURL:url,readAt:stamp},linkedReadings:[{sourceURL:url+'careers',status:'read',readAt:stamp}],contacts:[{type:'email',value:contact,quote,sourceURL:url+'careers',sourceRelation:'linked_page'}]}),stamp,stamp);
 const m=message('bank',{from:'GP Recruiter <careers@recruiter.example.org>',body:'A General Practitioner job is available in Australia. Harbour Medical Centre provides chronic disease management and wound care. https://harbour.example.org/careers/gp'});await ingestMailOpportunities(f.env,f.primary,[m],f.identity,{writingContext:writing});const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),data=JSON.parse(row.data_json);assert.equal(data.overlap.leadId,'real');assert.deepEqual(JSON.parse(row.draft_json).recipients,['published@harbour.example.org']);assert.equal(data.clinicName,'Harbour Medical Centre');assert(!JSON.parse(row.draft_json).body.includes('Recruiter Medical Centre'));assert.equal(JSON.parse(row.draft_json).factBasis.kind,'source_published_statement');
});
test('reading and preparation endpoints enforce exact owner, current Google subject, profile and origin',async()=>{
 const f=fixture();await ingestMailOpportunities(f.env,f.primary,[message('api')],f.identity,{writingContext:writing});const id=f.db.prepare('SELECT id FROM private_mail_opportunities').get().id;
 const call=(context,path='',body,headers={})=>handleMailOpportunitiesRequest(new Request('https://workspace.example/api/google/mail-opportunities'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env,context);
 assert.equal((await call(f.other,'/'+id)).status,404);assert.equal((await call(f.secondary,'/'+id)).status,404);assert.equal((await call(f.primary,'?profile=amir')).status,403);assert.equal((await call(f.primary,'/'+id+'/read',{}, {Origin:'https://other.example'})).status,403);assert.equal((await call(f.primary,'/'+id+'/read',{})).status,200);const result=await(await call(f.primary,'/'+id)).json();assert.equal(result.unread,false);assert.equal(result.status,'reviewed');
 f.db.prepare('UPDATE google_accounts SET google_sub=? WHERE owner_id=?').run('replacement',owner);assert.equal((await call(f.primary,'/'+id)).status,404);
});
test('deleted, trashed or history-gap sources stop proposed sending and are not silently re-opened',async()=>{
 const f=fixture(),m=message('deletion');await ingestMailOpportunities(f.env,f.primary,[m],f.identity,{writingContext:writing});await ingestMailOpportunities(f.env,f.primary,[{...m,labels:['TRASH']}],f.identity,{writingContext:writing});assert.equal(f.db.prepare('SELECT status FROM private_mail_opportunities').get().status,'source_removed');
 await ingestMailOpportunities(f.env,f.primary,[message('other-source',{body:'A GP position is available in Australia. Harbour Medical Centre provides chronic disease management and wound care. Please send your CV to careers@harbour.example.invalid. https://harbour.example.invalid/careers/another-gp'})],f.identity,{writingContext:writing});await invalidateMailOpportunityHistory(f.env,f.primary,f.identity);const source=f.db.prepare("SELECT * FROM private_mail_opportunities WHERE status='suggested'").get();assert.equal(JSON.parse(source.data_json).historyGap,1);assert.equal(JSON.parse(source.draft_json).readyForReview,false);assert.equal(f.db.prepare("SELECT status FROM private_mail_opportunity_inputs WHERE gmail_id='__history_gap__'").get().status,'source_removed');
});
test('transport context rechecks owned Gmail source, recipient, body and CV; a changed or inaccessible source blocks before send',async()=>{
 const f=fixture(),raw=rawMessage('sourcecheck'),m=normalizeMessage(raw);await ingestMailOpportunities(f.env,f.primary,[m],f.identity,{writingContext:writing});const id=f.db.prepare('SELECT id FROM private_mail_opportunities').get().id,access=async()=>({subject:'sub1',email:'applicant@example.invalid',accessToken:'synthetic',scopes:['https://www.googleapis.com/auth/gmail.readonly']});let reads=0;
 await seedVerifiedMailOpportunity(f.db,id,writing,{now});
 const provider=async()=>{reads++;return Response.json(raw);};const context=await getOwnedMailOpportunityContext(f.env,owner,{id},provider,access);assert.equal(context.to,'careers@harbour.example.invalid');assert.equal(context.cvVersionId,cv);assert.equal(context.applicationKey,'https://harbour.example.invalid/careers/gp');assert.equal(reads,1);assert(context.body.includes('Phone:'));
 await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id,recipient:'attacker@example.invalid'},provider,access),/mail_opportunity_recipient_changed/);
 await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id},async()=>Response.json({...raw,labelIds:['TRASH']}),access),/mail_opportunity_source_changed/);
 await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id},async()=>Response.json({}, {status:404}),access),/mail_opportunity_source_removed/);
 const changed=rawMessage('sourcecheck',{body:'A different GP job message in Australia.'});await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id},async()=>Response.json(changed),access),/mail_opportunity_source_changed/);
});
test('source 401 refreshes once for the same identity, while redirects and changed identities fail closed',async()=>{
 const f=fixture(),raw=rawMessage('refresh');await ingestMailOpportunities(f.env,f.primary,[normalizeMessage(raw)],f.identity,{writingContext:writing});const id=f.db.prepare('SELECT id FROM private_mail_opportunities').get().id;let refreshes=0,reads=0;
 await seedVerifiedMailOpportunity(f.db,id,writing,{now});
 const access=async(_env,_owner,_fetch,options)=>{if(options?.forceRefresh)refreshes++;return {subject:'sub1',email:'applicant@example.invalid',accessToken:options?.forceRefresh?'new':'old',scopes:['https://www.googleapis.com/auth/gmail.readonly']};};
 await getOwnedMailOpportunityContext(f.env,owner,{id},async(_url,init)=>{reads++;return init.headers.Authorization==='Bearer old'?new Response(null,{status:401}):Response.json(raw);},access);assert.equal(reads,2);assert.equal(refreshes,1);
 await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id},async()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}}),access),/gmail_redirect_rejected/);
});
test('multi-job digests never transfer another clinic’s contact, service or supervision statements to a different job',async()=>{
 const m=message('distinct',{from:'jobs@linkedin.com',subject:'General Practitioner jobs in Australia',body:'General Practitioner — Harbour Medical Centre\nHarbour Medical Centre provides chronic disease management. Level 1 supervision is available. Visa sponsorship is available. Contact harbour@practice.example.invalid.\nGeneral Practitioner — Coast Medical Centre\nCoast Medical Centre provides wound care. Level 1 supervision is not available. Contact coast@practice.example.invalid.'});
 m.links=[{url:'https://www.linkedin.com/jobs/view/12345/',label:'General Practitioner — Harbour Medical Centre'},{url:'https://www.linkedin.com/jobs/view/98765/',label:'General Practitioner — Coast Medical Centre'}];
 const [harbour,coast]=await extractMailOpportunityCandidates(m);assert.equal(harbour.clinicName,'Harbour Medical Centre');assert.equal(coast.clinicName,'Coast Medical Centre');assert.equal(harbour.fit.level1,'supported');assert.equal(coast.fit.level1,'restricted');assert.equal(harbour.recipient,null);assert.equal(coast.recipient,null);assert(coast.clinicalFacts.every(fact=>!fact.includes('Harbour')));assert.equal(coast.notificationEligible,false);
 const repeated={...m,links:m.links.map(link=>({...link,label:'General Practitioner'}))};const repeatedCandidates=await extractMailOpportunityCandidates(repeated);assert(repeatedCandidates.every(candidate=>!candidate.clinicName&&candidate.clinicalFacts.length===0&&candidate.fit.level1==='unknown'));
});
test('partial bodies or link inventories remain visible for research but cannot produce notifications or ready-to-send drafts',async()=>{
 for(const flag of ['bodyTruncated','linksTruncated']){const candidate=(await extractMailOpportunityCandidates({...message('partial-'+flag),[flag]:true}))[0];assert.equal(candidate.sourceIncomplete,true);assert.equal(candidate.notificationEligible,false);const draft=await prepareMailOpportunityDraft(candidate,writing);assert.equal(draft.readyForReview,false);assert(draft.missing.includes('mail_source_incomplete'));}
});
test('public contacts without source quote or same-host publication are never promoted from the imported bank',async()=>{
 const f=fixture(),stamp=new Date(now).toISOString();f.db.prepare('INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,status,read_at,last_success_at,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('unproven',owner,'arash','https://harbour.example.invalid/','Harbour Medical Centre','public_contacts_found',stamp,stamp,JSON.stringify({title:'Harbour Medical Centre',clinicalText:'Harbour Medical Centre provides chronic disease care and wound care.',contacts:[{type:'email',value:'import-only@example.invalid',sourceURL:'https://harbour.example.invalid/',sourceRelation:'same_page',quote:''},{type:'email',value:'foreign@example.invalid',sourceURL:'https://foreign.example.invalid/',sourceRelation:'same_page',quote:'foreign@example.invalid'}]}),stamp,stamp);
 await ingestMailOpportunities(f.env,f.primary,[message('unproven-bank')],f.identity,{writingContext:writing});const data=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert.equal(data.recipient,'careers@harbour.example.invalid');assert.equal(data.contactBasis.kind,'private_email_stated_contact');assert(!JSON.stringify(data).includes('import-only@example.invalid'));
});
test('a previously researched canonical job retains fresh public facts while a newer digest updates its own Gmail anchor',async()=>{
 const f=fixture(),first=message('research-old');await ingestMailOpportunities(f.env,f.primary,[first],f.identity,{writingContext:writing});const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),{data,draft}=await seedVerifiedMailOpportunity(f.db,row.id,writing,{now,recipients:['published@harbour.example.invalid']});
 await ingestMailOpportunities(f.env,f.primary,[message('research-new')],f.identity,{writingContext:writing});const updated=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),saved=JSON.parse(updated.data_json);assert.equal(updated.gmail_id,'research-new');assert.equal(saved.gmailId,'research-new');assert.equal(saved.contactBasis.kind,'source_published_research_contact');assert.equal(saved.recipient,'published@harbour.example.invalid');assert.deepEqual(saved.research,data.research);assert.equal(JSON.parse(updated.draft_json).body,draft.body);assert.equal((await prepareMailOpportunityDraft(saved,writing,{now})).readyForReview,true);
});
test('identical private offers sent to two own mailboxes use one canonical application key without exposing the other mailbox data',async()=>{
 const f=fixture(),raw=rawMessage('mirrored');await ingestMailOpportunities(f.env,f.primary,[normalizeMessage(raw)],f.identity,{writingContext:writing});await ingestMailOpportunities(f.env,f.secondary,[normalizeMessage(raw)],{...f.identity,subject:'sub2'},{writingContext:writing});const rows=f.db.prepare('SELECT id,owner_id FROM private_mail_opportunities ORDER BY owner_id').all(),keys=[];
 for(const row of rows){await seedVerifiedMailOpportunity(f.db,row.id,writing,{now});const access=async()=>({subject:row.owner_id.endsWith(':secondary')?'sub2':'sub1',email:'applicant@example.invalid',accessToken:'synthetic',scopes:['https://www.googleapis.com/auth/gmail.readonly']});keys.push((await getOwnedMailOpportunityContext(f.env,row.owner_id,{id:row.id},async()=>Response.json(raw),access)).applicationKey);}
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.notEqual(rows[0].id,rows[1].id);
});
test('an older staged snapshot cannot create or revive a source removed by a newer mailbox observation',async()=>{
 const f=fixture(),m=message('tombstone');await invalidateMailOpportunities(f.env,f.primary,[m.id],{...f.identity,observedAt:2000});
 await ingestMailOpportunities(f.env,f.primary,[m],{...f.identity,observedAt:1000},{writingContext:writing});assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_opportunities').get().n,0);const input=f.db.prepare('SELECT status,created_at FROM private_mail_opportunity_inputs').get();assert.equal(input.status,'source_removed');assert.equal(input.created_at,2000);
 const fresh=message('newer-live');await ingestMailOpportunities(f.env,f.primary,[fresh],{...f.identity,observedAt:4000},{writingContext:writing});await invalidateMailOpportunities(f.env,f.primary,[fresh.id],{...f.identity,observedAt:3000});const row=f.db.prepare('SELECT status,data_json FROM private_mail_opportunities').get();assert.equal(row.status,'suggested');assert.equal(JSON.parse(row.data_json).observedAt,4000);
});
test('a public source restriction survives later mail, an expired research cache and manual draft regeneration',async()=>{
 const f=fixture();await ingestMailOpportunities(f.env,f.primary,[message('restricted-old')],{...f.identity,observedAt:1000},{writingContext:writing});const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),data=JSON.parse(row.data_json);Object.assign(data,{sourceReviewRequired:true,publicationClosed:true,sourceRestrictions:[{code:'source_level1_restricted',quote:'Level 1 supervision is not available.'}],research:{validUntil:now-1}});f.db.prepare('UPDATE private_mail_opportunities SET data_json=? WHERE id=?').run(JSON.stringify(data),row.id);
 await ingestMailOpportunities(f.env,f.primary,[message('restricted-new')],{...f.identity,observedAt:2000},{writingContext:writing});const updated=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),saved=JSON.parse(updated.data_json);assert.equal(saved.sourceReviewRequired,true);assert.equal(saved.publicationClosed,true);assert.equal(saved.sourceRestrictions[0].code,'source_level1_restricted');assert.equal(JSON.parse(updated.draft_json).readyForReview,false);assert.equal(updated.notification_eligible,0);
 const prepared=await prepareOwnedMailOpportunity(f.env,f.primary,row.id,{cvVersionId:cv},{writingContext:writing});assert.equal(prepared.readyForReview,false);assert(prepared.missing.includes('source_restrictions_require_review'));
 const access=async()=>({subject:'sub1',email:'applicant@example.invalid',accessToken:'synthetic',scopes:['https://www.googleapis.com/auth/gmail.readonly']});let calls=0;await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id:row.id},async()=>{calls++;return Response.json(rawMessage('restricted-new'));},access),/mail_opportunity_source_restricted/);assert.equal(calls,0);
});
test('a deletion racing an already claimed extraction prevents that worker from inserting an orphan opportunity',async()=>{
 const f=fixture(),m=message('race'),prepare=f.env.GOOGLE_DB.prepare.bind(f.env.GOOGLE_DB);let raced=false;
 f.env.GOOGLE_DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('SELECT id,owner_id,profile_id,url,name,status')){const bind=statement.bind.bind(statement);statement.bind=(...args)=>{const bound=bind(...args),read=bound.all.bind(bound);bound.all=async()=>{if(!raced){raced=true;await invalidateMailOpportunities(f.env,f.primary,[m.id],{...f.identity,observedAt:3000});}return read();};return bound;};}return statement;};
 await ingestMailOpportunities(f.env,f.primary,[m],{...f.identity,observedAt:1000},{writingContext:writing});assert.equal(raced,true);assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_opportunities').get().n,0);assert.equal(f.db.prepare('SELECT status FROM private_mail_opportunity_inputs').get().status,'source_removed');
});
test('history-gap watermarks reject unknown old staged jobs and require a fresh archive observation before restoring a proposal',async()=>{
 const f=fixture(),m=message('gap-source');await ingestMailOpportunities(f.env,f.primary,[m],{...f.identity,observedAt:1000},{writingContext:writing});const id=f.db.prepare('SELECT id FROM private_mail_opportunities').get().id;
 await invalidateMailOpportunityHistory(f.env,f.primary,{...f.identity,observedAt:3000});
 const old=message('unknown-old',{body:'General Practitioner position in Australia. Coast Medical Centre provides chronic disease and wound care. https://coast.example.invalid/careers/gp'});await ingestMailOpportunities(f.env,f.primary,[old],{...f.identity,observedAt:2000},{writingContext:writing});assert.equal(f.db.prepare("SELECT count(*) n FROM private_mail_opportunity_inputs WHERE gmail_id='unknown-old'").get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_opportunities').get().n,1);assert.equal(JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities WHERE id=?').get(id).data_json).historyGap,1);
 await ingestMailOpportunities(f.env,f.primary,[m],{...f.identity,observedAt:4000},{writingContext:writing});const restored=f.db.prepare('SELECT * FROM private_mail_opportunities WHERE id=?').get(id);assert(!JSON.parse(restored.data_json).historyGap);assert.equal(JSON.parse(restored.draft_json).readyForReview,false);assert(JSON.parse(restored.draft_json).missing.includes('public_employer_verification_required'));await seedVerifiedMailOpportunity(f.db,id,writing,{now});assert.equal(JSON.parse(f.db.prepare('SELECT draft_json FROM private_mail_opportunities WHERE id=?').get(id).draft_json).readyForReview,true);
});
test('a failed latest public read blocks draft regeneration and transport until that transient failure is explicitly cleared by fresh research',async()=>{
 const f=fixture();await ingestMailOpportunities(f.env,f.primary,[message('unavailable-old')],{...f.identity,observedAt:1000},{writingContext:writing});const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),data=JSON.parse(row.data_json);Object.assign(data,{sourceUnavailable:true,sourceUnavailableReason:'robots_disallowed',sourceUnavailableAt:now,research:{validUntil:now-1}});f.db.prepare('UPDATE private_mail_opportunities SET data_json=? WHERE id=?').run(JSON.stringify(data),row.id);
 await ingestMailOpportunities(f.env,f.primary,[message('unavailable-new')],{...f.identity,observedAt:2000},{writingContext:writing});const changed=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),saved=JSON.parse(changed.data_json);assert.equal(saved.sourceUnavailable,true);assert.equal(saved.sourceUnavailableReason,'robots_disallowed');assert.equal(changed.notification_eligible,0);assert.equal(JSON.parse(changed.draft_json).readyForReview,false);
 const prepared=await prepareOwnedMailOpportunity(f.env,f.primary,row.id,{cvVersionId:cv},{writingContext:writing});assert.equal(prepared.readyForReview,false);assert(prepared.missing.includes('source_unavailable_requires_review'));const access=async()=>({subject:'sub1',email:'applicant@example.invalid',accessToken:'synthetic',scopes:['https://www.googleapis.com/auth/gmail.readonly']});let reads=0;await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id:row.id},async()=>{reads++;return Response.json(rawMessage('unavailable-new'));},access),/mail_opportunity_source_unavailable/);assert.equal(reads,0);
 const cleared={...saved,sourceUnavailable:false,sourceUnavailableReason:null,sourceUnavailableAt:null};assert.equal((await prepareMailOpportunityDraft(cleared,writing,{now})).readyForReview,false);const fresh=withPublicEmployerEvidence(cleared,{now});assert.equal((await prepareMailOpportunityDraft(fresh,writing,{now})).readyForReview,true);
});
test('preparation cannot overwrite a concurrent source closure, even if its timestamp happens to match the earlier observation',async()=>{
 const f=fixture();await ingestMailOpportunities(f.env,f.primary,[message('prepare-race')],f.identity,{writingContext:writing});const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get();let changed=false;
 const context={...f.primary,rest:async table=>{if(table==='immi_profiles'){if(!changed){changed=true;const data=JSON.parse(row.data_json);data.sourceReviewRequired=true;data.publicationClosed=true;f.db.prepare('UPDATE private_mail_opportunities SET data_json=?,draft_json=? WHERE id=?').run(JSON.stringify(data),JSON.stringify({status:'needs_source_review',readyForReview:false}),row.id);}return [{data:writing.profile}];}if(table==='immi_cv_versions')return [{id:cv,text:writing.cvText,version:1}];throw Error('unexpected private table');}};
 await assert.rejects(()=>prepareOwnedMailOpportunity(f.env,context,row.id,{cvVersionId:cv}),/mail_opportunity_changed/);const saved=f.db.prepare('SELECT * FROM private_mail_opportunities').get();assert.equal(JSON.parse(saved.data_json).publicationClosed,true);assert.equal(JSON.parse(saved.draft_json).readyForReview,false);
});
