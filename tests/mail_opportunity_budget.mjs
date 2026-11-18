import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runCorrespondenceMailCycle} from '../cloud/clinic-correspondence-cycle.mjs';
import {syncMailDiscovery} from '../cloud/mail-discovery-pipeline.mjs';
import {recordClinicCorrespondenceBatchStops} from '../cloud/clinic-correspondence.mjs';
import {ingestMailOpportunities} from '../cloud/mail-opportunities.mjs';
import {handleMailOpportunitySendRequest} from '../cloud/mail-opportunity-send.mjs';
import {handleGoogleSendRequest} from '../cloud/google-send.mjs';
import {encryptGoogleSecret} from '../cloud/google-oauth.mjs';
import {normalizeMessage} from '../cloud/google-mail.mjs';
import {dispatchMailOpportunityNotifications} from '../cloud/telegram-notifications.mjs';

const owner='11111111-1111-4111-8111-111111111111',cvId='22222222-2222-4222-8222-222222222222';
const origin='https://immi-arash-amir.dr-gerami-md.workers.dev';
const scopes=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'];
const profile={name:'Synthetic Applicant',planning:{gpApplicationWriting:{confirmedByOwner:true,writingVersion:'human-four-paragraph-v1',openingParagraph:'I am a general practitioner seeking a long-term supervised GP role in Australia.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',signatureEmail:'applicant@example.invalid',signaturePhone:'+61000000000'}}};
const cvText='Managed chronic disease consultations, preventive care and wound care in general practice.';
const writing={profile,cvText,cvVersionId:cvId};
const notice=(id,now=Date.now())=>({id,threadId:'thread_'+id,internalDate:String(now-60000),labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'Practice Manager <manager@clinic.example.invalid>'},{name:'To',value:'applicant@example.invalid'},{name:'Subject',value:'Australia General Practitioner vacancy at Harbour Medical Centre'},{name:'Message-ID',value:'<'+id+'@clinic.example.invalid>'}],body:{data:Buffer.from('Harbour Medical Centre is recruiting a general practitioner in regional Australia. Harbour Medical Centre provides chronic disease management, preventive care and wound care in regional Australia. Appropriate Level 1 supervision and visa sponsorship may be available. Please email your CV to manager@clinic.example.invalid. https://clinic.example.invalid/careers/gp').toString('base64url')}}});

async function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const name of ['google-schema.sql','google-mail-schema.sql','google-mail-correspondence-schema.sql','google-mail-full-scan-schema.sql','clinic-correspondence-cycle-schema.sql','clinic-correspondence-stops-schema.sql','clinic-correspondence-batch-schema.sql','clinic-bank-schema.sql','google-send-schema.sql','mail-automation-schema.sql','mail-automation-scheduler-schema.sql','mail-opportunities-schema.sql','telegram-notifications-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+name,import.meta.url),'utf8'));
 const counts={queries:0,http:0,gmail:0,tokens:0,rest:0,sends:0,alerts:0,writing:0,membership:0};
 function statement(sql,args=[]){return {bind(...values){assert(values.length<=100,'D1 binding limit');return statement(sql,values);},async first(){counts.queries++;return db.prepare(sql).get(...args)||null;},async all(){counts.queries++;return {results:db.prepare(sql).all(...args)};},async run(){counts.queries++;return {meta:db.prepare(sql).run(...args)};}};}
 const env={GOOGLE_DB:{prepare:sql=>statement(sql)},OPPORTUNITY_DB:{},GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_KEY:Buffer.alloc(32,3).toString('base64'),GOOGLE_REDIRECT_URI:origin+'/api/google/callback',MAIL_SCHEDULER_ENABLED:'true',MAIL_CORRESPONDENCE_ENABLED:'true',AUTOMATION_MEMBERSHIP_KEY:'m'.repeat(40),SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'};
 const state={rejectNextGmail:false,rejectEachSource:false,historyGone:false,sourceChecks:0,history:null,rawByOwner:new Map(),currentTokens:new Map(),tokenOwners:new Map(),archiveIds:[],refreshOwner:owner};
 for(const [id,subject,email]of [[owner,'subject-primary','applicant@example.invalid'],[owner+':secondary','subject-secondary','applicant2@example.invalid']]){
  const token='synthetic-'+subject;state.currentTokens.set(id,token);state.tokenOwners.set(token,id);state.rawByOwner.set(id,new Map());
  const cipher=await encryptGoogleSecret(env,id,{access_token:token,refresh_token:'refresh-'+subject});db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(id,'arash',subject,email,JSON.stringify(scopes),cipher,Date.now()+3600000,'connected',Date.now());
 }
 const fetcher=async(url,options={})=>{
  counts.http++;
  if(url.includes('/rpc/immi_automation_owner_active')){counts.membership++;return Response.json(true);}
  if(url.includes('/rpc/immi_automation_writing_context')){counts.writing++;return Response.json({ownerId:owner,profileId:'arash',profile,cv:{id:cvId,version:1,text:cvText,isDefault:true},snapshotAt:new Date().toISOString(),transportApproved:false});}
  if(url.includes('/token')){counts.tokens++;const params=new URLSearchParams(options.body),target=params.get('refresh_token')==='refresh-subject-secondary'?owner+':secondary':owner;const token='renewed-'+target+'-'+counts.tokens;state.currentTokens.set(target,token);state.tokenOwners.set(token,target);return Response.json({access_token:token,expires_in:3600,scope:scopes.join(' ')});}
  if(url.startsWith('https://api.telegram.org/')){assert(url.endsWith('/sendMessage'));counts.alerts++;return Response.json({ok:true,result:{message_id:counts.alerts}});}
  assert(url.startsWith('https://gmail.googleapis.com/'),'No unrelated HTTP request');counts.gmail++;
  const slot=state.tokenOwners.get(String(options.headers.Authorization).replace(/^Bearer /,''));assert(slot,'Known synthetic Google grant');const parsed=new URL(url);
  if(parsed.pathname.endsWith('/messages/send')){counts.sends++;assert.equal(options.headers.Authorization,'Bearer '+state.currentTokens.get(slot),'Send uses the grant refreshed during its source guard');return Response.json({id:'ack-'+counts.sends});}
  if(state.rejectEachSource&&parsed.pathname.endsWith('/messages/source-notice')&&++state.sourceChecks%2===1)return Response.json({},{status:401});
  if(state.rejectNextGmail){state.rejectNextGmail=false;return Response.json({},{status:401});}
  if(parsed.pathname.endsWith('/profile'))return Response.json({historyId:'100'});
  if(parsed.pathname.endsWith('/history'))return state.historyGone?Response.json({},{status:404}):Response.json(state.history||{historyId:'101',history:[]});
  if(parsed.pathname.endsWith('/messages'))return Response.json({messages:state.archiveIds.map(id=>({id})),nextPageToken:'next-private-page'});
  const id=parsed.pathname.split('/').at(-1),raw=state.rawByOwner.get(slot).get(id);return raw?Response.json(raw):Response.json({},{status:404});
 };
 const context=(slot='primary')=>({userId:owner+(slot==='secondary'?':secondary':''),rootUserId:owner,profileId:'arash',mailbox:slot,rest:async table=>{counts.http++;counts.rest++;if(table==='immi_profiles')return [{data:profile}];if(table==='immi_cv_versions')return [{id:cvId,text:cvText,version:1}];return [];}});
 const putRaw=(raw,slot='primary')=>{const id=context(slot).userId;state.rawByOwner.get(id).set(raw.id,raw);return normalizeMessage(raw);};
 const seedOpportunity=async(slot='primary')=>{const message=putRaw(notice('source-notice'),slot),identity={subject:slot==='secondary'?'subject-secondary':'subject-primary',email:slot==='secondary'?'applicant2@example.invalid':'applicant@example.invalid'};await ingestMailOpportunities(env,context(slot),[message],identity,{now:Date.now(),writingContext:writing});const row=db.prepare('SELECT id,draft_json FROM private_mail_opportunities WHERE owner_id=?').get(context(slot).userId);assert(row,'Private opportunity created');const draft=JSON.parse(row.draft_json);assert(draft.readyForReview,JSON.stringify(draft.missing));return {id:row.id,draft};};
 const reset=()=>{for(const key of Object.keys(counts))counts[key]=0;};
 const reviewRequest=(id,action,body)=>new Request(origin+'/api/google/mail-opportunities/'+id+'/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {db,env,counts,state,fetcher,context,putRaw,seedOpportunity,reset,reviewRequest};
}

for(const lane of ['archive','history_with_deletions','mixed_history','mixed_visible_history'])test('complete read/extract/stop pipeline stays within free-tier limits: '+lane,async()=>{
 const f=await fixture(),now=Date.now();
 for(let i=0;i<8;i++){const raw=notice('notice'+i,now);f.putRaw(raw);f.state.archiveIds.push(raw.id);}
 // Exercise a full bounded stop-receipt batch, including root suppression.
 for(let i=0;i<10;i++){
  const address='old'+i+'@clinic.example.invalid',thread='oldthread'+i;
  for(const message of [{id:'oldsent'+i,threadId:thread,direction:'sent',labels:['SENT'],to:address,from:'applicant@example.invalid',subject:'GP application',plainBody:'I applied for a GP position.'},{id:'oldreply'+i,threadId:thread,direction:'received',labels:['INBOX'],to:'applicant@example.invalid',from:address,subject:'Re: GP application',plainBody:'Please do not contact us again.'}])f.db.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(owner,'subject-primary',message.id,thread,now-86400000,'weak',JSON.stringify({...message,dateTimestamp:now-86400000}),now);
 }
 const stopped=f.state.rawByOwner.get(owner).get('notice0');stopped.threadId='oldthread0';stopped.payload.headers.find(header=>header.name==='From').value='old0@clinic.example.invalid';stopped.payload.body.data=Buffer.from('Regarding the GP application, please do not contact us again.').toString('base64url');
 if(lane!=='archive'){
  f.db.prepare('INSERT INTO google_mail_full_scan(owner_id,google_sub,archive_started_at,history_id,next_lane) VALUES(?,?,?,?,1)').run(owner,'subject-primary',now,'100');
  f.state.history={historyId:'101',history:[{messagesAdded:f.state.archiveIds.map(id=>({message:{id}})),messagesDeleted:[{message:{id:'removed-notice'}}]}]};
 }
 if(lane.startsWith('mixed_')){
  const raw=f.state.rawByOwner.get(owner);
  raw.get('notice1').labelIds=['SENT'];raw.get('notice2').labelIds=lane==='mixed_history'?['SPAM']:['INBOX'];
  if(lane==='mixed_visible_history'){
   // A visible unrelated message still needs cache deletion, while extraction
   // proceeds normally rather than taking the cheaper Spam invalidation path.
   raw.get('notice2').payload.headers.find(header=>header.name==='Subject').value='Monthly invoice';
   raw.get('notice2').payload.body.data=Buffer.from('Your monthly invoice is ready.').toString('base64url');
  }
  raw.get('notice3').payload.body.data=Buffer.from('X'.repeat(1600000)).toString('base64url');
  raw.get('notice4').threadId='oldthread0';
  f.db.prepare('INSERT INTO google_mail_correspondence_threads(owner_id,google_sub,thread_id,discovered_at,last_checked_at,complete) VALUES(?,?,?,?,?,1)').run(owner,'subject-primary','oldthread0',now-10000,now-10000);
  f.db.prepare('UPDATE google_mail_full_scan SET has_analysis_limits=1 WHERE owner_id=?').run(owner);
  raw.get('notice5').payload.body.data=Buffer.from('Harbour Medical Centre GP job opportunity in Australia. '+'X'.repeat(40000)).toString('base64url');
  const pending=f.putRaw(notice('earlier-pending-notice',now));
  f.db.prepare('INSERT INTO private_mail_opportunity_inputs(owner_id,root_owner_id,profile_id,google_sub,gmail_id,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(owner,owner,'arash','subject-primary',pending.id,JSON.stringify(pending),now-1000,now-1000);
 }
 f.db.prepare('UPDATE google_accounts SET expires_at=0 WHERE owner_id=?').run(owner);f.state.rejectNextGmail=true;f.reset();
 const result=await runCorrespondenceMailCycle(f.env,{now,fetcher:f.fetcher});
 assert.equal(result.correspondence.status,'connected',JSON.stringify(result));assert(f.counts.writing>0);assert(f.counts.membership>0);assert.equal(f.counts.tokens,2);assert.equal(f.counts.sends,0);
 assert(f.db.prepare('SELECT count(*) n FROM private_mail_opportunity_inputs').get().n>0);assert.equal(f.db.prepare('SELECT count(*) n FROM clinic_correspondence_stops').get().n,1);
 assert(f.counts.queries<=50,JSON.stringify(f.counts));assert(f.counts.queries+f.counts.http<=50,JSON.stringify(f.counts));
 if(lane==='mixed_history'){
  // Label invalidation defers drafting, but the durable input must be drained by
  // the next empty history pass without rereading the original inbox messages.
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_opportunities').get().n,0);
  f.db.prepare("UPDATE google_mail_full_scan SET next_lane=1,history_id='101',history_pending_ids='[]',history_deleted_ids='[]',history_caught_up=0 WHERE owner_id=?").run(owner);f.state.history={historyId:'102',history:[]};f.reset();
  const progressed=await syncMailDiscovery(f.env,f.context(),f.fetcher,{now:now+60000});assert(progressed.opportunitiesProcessed>0,JSON.stringify(progressed));assert(f.db.prepare('SELECT count(*) n FROM private_mail_opportunities').get().n>0);assert.equal(f.counts.sends,0);assert(f.counts.queries+f.counts.http<=50,JSON.stringify(f.counts));
 }
});

test('expired Gmail history invalidates private readiness before recovery without exceeding the free-tier budget',async()=>{
 const f=await fixture(),item=await f.seedOpportunity(),now=Date.now()+1000;
 f.db.prepare('INSERT INTO google_mail_full_scan(owner_id,google_sub,archive_started_at,history_id,next_lane) VALUES(?,?,?,?,1)').run(owner,'subject-primary',now-86400000,'100');
 f.db.prepare('UPDATE google_accounts SET expires_at=0 WHERE owner_id=?').run(owner);f.state.rejectNextGmail=true;f.state.historyGone=true;f.reset();
 const result=await runCorrespondenceMailCycle(f.env,{now,fetcher:f.fetcher});assert.equal(result.correspondence.status,'connected',JSON.stringify(result));assert.equal(result.correspondence.historyRecoveryActive,true);
 const row=f.db.prepare('SELECT notification_eligible,draft_json,data_json FROM private_mail_opportunities WHERE id=?').get(item.id);assert.equal(row.notification_eligible,0);assert.equal(JSON.parse(row.draft_json).readyForReview,false);assert.equal(JSON.parse(row.data_json).historyGap,1);
 assert(f.db.prepare("SELECT 1 FROM private_mail_opportunity_inputs WHERE gmail_id='__history_gap__'").get());assert.equal(f.counts.tokens,2);assert.equal(f.counts.sends,0);assert.equal(f.counts.alerts,0);assert(f.counts.queries+f.counts.http<=50,JSON.stringify(f.counts));
});

test('private opportunity preview and reviewed send include all source checks within free-tier limits',async()=>{
 const f=await fixture(),item=await f.seedOpportunity();f.db.prepare('UPDATE google_accounts SET expires_at=0 WHERE owner_id=?').run(owner);f.state.rejectNextGmail=true;f.reset();
 const first=await handleMailOpportunitySendRequest(f.reviewRequest(item.id,'preview',{cvVersionId:cvId}),f.env,f.context(),f.fetcher);assert.equal(first.status,200,await first.clone().text());const preview=await first.json();assert(preview.reviewHash);assert.equal(f.counts.sends,0);assert(f.counts.queries+f.counts.http+2<=50,JSON.stringify(f.counts));
 f.db.prepare('UPDATE google_accounts SET expires_at=0 WHERE owner_id=?').run(owner);f.state.rejectNextGmail=false;f.state.rejectEachSource=true;f.state.sourceChecks=0;f.reset();
 const sent=await handleMailOpportunitySendRequest(f.reviewRequest(item.id,'send',{cvVersionId:cvId,recipient:preview.recipient,reviewHash:preview.reviewHash,confirmSend:true}),f.env,f.context(),f.fetcher);assert.equal(sent.status,200,await sent.clone().text());const result=await sent.json();assert.equal(result.sent,true,JSON.stringify(result));assert.equal(f.counts.sends,1);assert(f.counts.tokens>=2);
 const routerRequests=2;assert(f.counts.queries<=50,JSON.stringify(f.counts));assert(f.counts.queries+f.counts.http+routerRequests<=50,JSON.stringify(f.counts));
});

test('private Telegram notification validates its live own Gmail source with both refresh paths within the free-tier budget',async()=>{
 const f=await fixture(),item=await f.seedOpportunity(),now=Date.now();
 Object.assign(f.env,{MAIL_OPPORTUNITY_ALERTS_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123456789:abcdefghijklmnopqrstuvwxyz_123456789',TELEGRAM_WEBHOOK_SECRET:'s'.repeat(40)});
 const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(part=>part.toString(16).padStart(2,'0')).join('');
 const webhook=origin+'/api/telegram/webhook';
 f.db.prepare("INSERT INTO telegram_bot_state(id,username,identity_hash,checked_at,registration_hash,webhook_registered_at) VALUES('bot','SyntheticBot',?,?,?,?)").run(await hash(f.env.TELEGRAM_BOT_TOKEN),now,await hash(f.env.TELEGRAM_BOT_TOKEN+'\n'+f.env.TELEGRAM_WEBHOOK_SECRET+'\n'+webhook),now);
 f.db.prepare('INSERT INTO telegram_accounts(owner_id,profile_id,chat_id,enabled,enabled_since,quiet_start,quiet_end,linked_at,updated_at) VALUES(?,?,?,1,?,0,0,?,?)').run(owner,'arash','12345',new Date(now-86400000).toISOString(),now-1000,now-1000);
 f.db.prepare('UPDATE google_accounts SET expires_at=0 WHERE owner_id=?').run(owner);f.state.rejectEachSource=true;f.reset();
 const result=await dispatchMailOpportunityNotifications(f.env,{fetcher:f.fetcher,now});assert.equal(result.status,'sent',JSON.stringify(result));assert.equal(result.attempted,1);assert.equal(f.counts.tokens,2);assert.equal(f.counts.alerts,1);assert.equal(f.counts.sends,0);
 assert.equal(f.db.prepare('SELECT notification_sent_at FROM private_mail_opportunities WHERE id=?').get(item.id).notification_sent_at,now);assert(f.counts.queries+f.counts.http<=50,JSON.stringify(f.counts));
});

test('a closure recorded during the final live Gmail source read blocks the atomic application claim',async()=>{
 const f=await fixture(),item=await f.seedOpportunity();
 const response=await handleMailOpportunitySendRequest(f.reviewRequest(item.id,'preview',{cvVersionId:cvId}),f.env,f.context(),f.fetcher),preview=await response.json();assert.equal(response.status,200);assert(preview.reviewHash);
 let reads=0;
 const concurrentClosure=async(url,options)=>{
  const result=await f.fetcher(url,options);
  if(url.includes('/messages/source-notice?')&&++reads===2)f.db.prepare("UPDATE private_mail_opportunities SET data_json=json_set(data_json,'$.sourceReviewRequired',json('true'),'$.publicationClosed',json('true')),draft_json=json_set(draft_json,'$.status','needs_source_review','$.readyForReview',json('false')),notification_eligible=0 WHERE id=?").run(item.id);
  return result;
 };
 f.reset();const sent=await handleMailOpportunitySendRequest(f.reviewRequest(item.id,'send',{cvVersionId:cvId,recipient:preview.recipient,reviewHash:preview.reviewHash,confirmSend:true}),f.env,f.context(),concurrentClosure),result=await sent.json();
 assert.equal(reads,2);assert.equal(f.counts.sends,0,JSON.stringify(result));assert.equal(result.sent,false);assert.equal(f.db.prepare("SELECT count(*) n FROM google_send_queue WHERE status IN ('sending','sent','delivery_unknown')").get().n,0);assert(f.counts.queries+f.counts.http+2<=50,JSON.stringify(f.counts));
});

test('concurrent own sender slots cannot reserve the same canonical application twice',async()=>{
 const f=await fixture(),primary=await f.seedOpportunity(),secondary=await f.seedOpportunity('secondary');assert.notEqual(primary.id,secondary.id);
 const enqueue=(item,slot)=>handleGoogleSendRequest(new Request(origin+'/api/google/mail/queue',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({mailOpportunityContext:{id:item.id,recipient:item.draft.recipients[0]},subject:item.draft.subject,body:item.draft.body,cvVersionId:cvId})}),f.env,f.context(slot),f.fetcher);
 const results=await Promise.all([enqueue(primary,'primary'),enqueue(secondary,'secondary')]);
 const rows=f.db.prepare('SELECT owner_id,status,mail_opportunity_context FROM google_send_queue').all();assert.equal(rows.length,1);assert.equal(rows[0].status,'queued');assert.equal(f.counts.sends,0);
 const payloads=await Promise.all(results.map(response=>response.json()));assert.equal(payloads.flatMap(value=>value.items||[]).length,1);assert(!JSON.stringify(payloads).includes('raw_mime'));
});

test('one eight-message stop batch preserves every explicitly matching joint sender without a silent slice',async()=>{
 const f=await fixture(),messages=[];
 for(let index=0;index<8;index++){
  const threadId='legacy-multi-'+index,from='manager'+index+'@clinic.example.invalid',second='recruitment'+index+'@clinic.example.invalid';
  const sent={id:'sent-multi-'+index,threadId,direction:'sent',labels:['SENT'],to:from+', '+second,subject:'GP application',plainBody:'I am applying for a supervised GP role.',dateTimestamp:Date.now()-10000};
  f.db.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(owner,'subject-primary',sent.id,threadId,sent.dateTimestamp,'weak',JSON.stringify(sent),Date.now());
  messages.push({id:'reply-multi-'+index,threadId,direction:'received',labels:['INBOX'],from:from+', '+second,subject:'Re: GP application',plainBody:'Please do not contact us again.',dateTimestamp:Date.now()});
 }
 f.reset();await recordClinicCorrespondenceBatchStops(f.env,f.context(),{subject:'subject-primary'},messages);
 assert.equal(f.db.prepare('SELECT count(*) n FROM clinic_correspondence_stops').get().n,16);
 // Every newly observed explicit opt-out blocks ordinary new applications in
 // this same tick; the bounded historical repair must not delay recipients 11+.
 assert.equal(f.db.prepare('SELECT count(*) n FROM mail_automation_suppressions WHERE owner_id=?').get(owner).n,16);
 assert(f.counts.queries<=3,JSON.stringify(f.counts));assert.equal(f.counts.sends,0);
});

test('one clinic replying in an old multi-clinic thread does not suppress the unrelated recipient',async()=>{
 const f=await fixture(),from='first@clinic.example.invalid',other='unrelated@clinic.example.invalid',threadId='legacy-unrelated';
 const sent={id:'old-ambiguous-sent',threadId,direction:'sent',labels:['SENT'],to:from+', '+other,subject:'GP application',plainBody:'I am applying for a supervised GP role.',dateTimestamp:Date.now()-10000};
 f.db.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(owner,'subject-primary',sent.id,threadId,sent.dateTimestamp,'weak',JSON.stringify(sent),Date.now());
 await recordClinicCorrespondenceBatchStops(f.env,f.context(),{subject:'subject-primary'},[{id:'exact-reply',threadId,direction:'received',labels:['INBOX'],from,subject:'Re: GP application',plainBody:'Please do not contact us again.',dateTimestamp:Date.now()}]);
 assert.deepEqual(f.db.prepare('SELECT recipient FROM clinic_correspondence_stops').all().map(row=>row.recipient),[from]);
 assert.equal(f.db.prepare('SELECT count(*) n FROM mail_automation_suppressions WHERE email=?').get(other).n,0);
});
