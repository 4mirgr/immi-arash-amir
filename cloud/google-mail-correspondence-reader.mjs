import {getGoogleAccess} from './google-oauth.mjs';
import {extractEmails,normalizeMessage,readGoogleMailJson} from './google-mail.mjs';

const MAX_PROVIDER_READS=12,MAX_SENT_PAGE=20,MAX_CACHE_WRITES=10,MAX_THREAD_MESSAGES=500,REVISIT_MS=15*60000;
const COVERAGE='all_sent_progressive_related_threads';
const readScope='https://www.googleapis.com/auth/gmail.readonly';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
export class CorrespondenceReaderError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new CorrespondenceReaderError(status,code);};
function ownerContext(context){
 const id=context?.userId,profile=context?.profileId;
 if(typeof id!=='string'||!id||id.length>150||!['arash','amir'].includes(profile)||/[\x00-\x20]/.test(id))fail(403,'workspace_required');
 const secondary=id.endsWith(':secondary'),root=secondary?id.slice(0,-10):id;
 if(root.includes(':')||!root||(context.rootUserId&&context.rootUserId!==root)||(context.mailbox&&context.mailbox!==(secondary?'secondary':'primary')))fail(403,'mailbox_owner_mismatch');
 return {owner:id,profile,mailbox:secondary?'secondary':'primary'};
}
function hasReadScope(access){return [readScope,'https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].some(scope=>access?.scopes?.includes(scope));}
function pendingIds(raw){let values;try{values=JSON.parse(raw||'[]');}catch{fail(409,'invalid_correspondence_cursor');}if(!Array.isArray(values)||values.length>MAX_SENT_PAGE||values.some(id=>!validId(id)))fail(409,'invalid_correspondence_cursor');return values;}
function pendingMessages(raw){let values;try{values=JSON.parse(raw||'[]');}catch{fail(409,'invalid_correspondence_cursor');}if(!Array.isArray(values)||values.length>MAX_THREAD_MESSAGES||values.some(message=>!validId(message?.id)||!validId(message?.threadId)))fail(409,'invalid_correspondence_cursor');return values;}
function snapshotIds(raw){let values;try{values=JSON.parse(raw||'[]');}catch{fail(409,'invalid_correspondence_cursor');}if(!Array.isArray(values)||values.length>MAX_THREAD_MESSAGES||values.some(id=>!validId(id)))fail(409,'invalid_correspondence_cursor');return values;}
function validPageToken(value){if(value===null||value===undefined)return null;if(typeof value!=='string'||value.length>2000||/[\x00-\x1f]/.test(value))fail(409,'invalid_correspondence_cursor');return value;}

/** A Sent match is an application/enquiry signal, never proof of a vacancy. */
export function isClinicApplicationMessage(message,{matchedEmails=[],matchedDomains=[]}={}){
 if(message?.direction!=='sent'||(message.labels||[]).some(label=>['DRAFT','TRASH','SPAM'].includes(label)))return false;
 const recipients=extractEmails([message.to,message.cc,message.bcc].join(' '));if(!recipients.length)return false;
 const text=[message.subject,message.plainBody||message.snippet].join('\n').slice(0,40000);
 const career=/\b(?:job|vacanc(?:y|ies)|employment|recruit(?:ment|er|ing)?|position|application|apply|enquir(?:y|ing)|inquir(?:y|ing)|curriculum vitae|resume|cv|supervis(?:ion|or)|sponsor(?:ship)?|pesci)\b/i.test(text);
 const medicine=/\b(?:general practitioner|gp|medic(?:al|ine)|doctor|physician|clinic|practice|hospital|ahpra|amc|racgp|acrrm|pesci)\b/i.test(text);
 // Do not cache unrelated personal mail merely because it was sent to a known
 // business. An application/enquiry signal is still required.
 const known=recipients.some(email=>matchedEmails.includes(email)||matchedDomains.includes(email.split('@')[1]));
 return career&&(medicine||known);
}

function baseCoverage(mailbox,status='connected'){return {status,mailbox,coverage:COVERAGE,scannedSentCount:0,matchedSentCount:0,backfillComplete:false,moreSent:true,pendingSentCount:0,pendingThreadMessageCount:0,threadCount:0,completeThreadCount:0,failedThreadCount:0,lastSyncedAt:null,automaticSending:false};}
/** Cache-only metadata: never refresh a token merely to display progress. */
export async function getClinicCorrespondenceCoverage(env,context){
 const {owner,profile,mailbox}=ownerContext(context);if(!env.GOOGLE_DB)fail(503,'google_storage_required');
 const db=env.GOOGLE_DB,account=await first(db,'SELECT google_sub,status FROM google_accounts WHERE owner_id=? AND profile_id=?',owner,profile);
 if(!account)return baseCoverage(mailbox,'not_connected');
 const result=baseCoverage(mailbox,account.status==='connected'?'connected':'reconnect_required');
 const state=await first(db,'SELECT * FROM google_mail_correspondence_scan WHERE owner_id=? AND google_sub=?',owner,account.google_sub);
 const threads=await first(db,'SELECT count(*) AS total,coalesce(sum(complete),0) AS completed,coalesce(sum(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END),0) AS failed FROM google_mail_correspondence_threads WHERE owner_id=? AND google_sub=?',owner,account.google_sub);
 return {...result,scannedSentCount:Number(state?.scanned_count||0),matchedSentCount:Number(state?.matched_sent_count||0),backfillComplete:!!state?.backfill_complete,moreSent:!state?.cycle_complete,pendingSentCount:pendingIds(state?.pending_sent_ids).length,pendingThreadMessageCount:pendingMessages(state?.pending_thread_messages).length,threadCount:Number(threads?.total||0),completeThreadCount:Number(threads?.completed||0),failedThreadCount:Number(threads?.failed||0),lastSyncedAt:state?.last_synced_at?new Date(state.last_synced_at).toISOString():null,lastError:state?.last_error||null};
}

/**
 * Trusted server boundary only: authenticated callers supply their scoped owner;
 * unattended callers MUST pass a fresh checkAutomationMembership before calling.
 * The reader performs no sends, no attachment reads and no shared-bank writes.
 * Each invocation has at most twelve Gmail GETs (including a rejected-token
 * retry) and ten cached messages, stored with bounded multi-row statements. A staged
 * long thread remains explicitly incomplete until its last message is saved.
 */
export async function syncClinicCorrespondence(env,context,fetcher=fetch,options={}){
 const {owner,profile,mailbox}=ownerContext(context);if(!env.GOOGLE_DB)fail(503,'google_storage_required');
 const db=env.GOOGLE_DB,account=await first(db,'SELECT google_sub,status FROM google_accounts WHERE owner_id=? AND profile_id=?',owner,profile);
 if(!account)fail(409,'not_connected');if(account.status!=='connected')fail(409,'reconnect_required');
 const accessProvider=options.accessProvider||getGoogleAccess,access=await accessProvider(env,owner,fetcher);
 if(access.subject!==account.google_sub)fail(409,'connection_changed');if(!access.accessToken)fail(401,'reconnect_required');if(!hasReadScope(access))fail(403,'gmail_read_scope_required');
 const now=Number.isFinite(options.now)?options.now:Date.now(),subject=access.subject,lock=crypto.randomUUID();
 let providerReads=0,synced=0,scannedThisRun=0,matchedThisRun=0,readThreads=0,cacheWrites=0;
 const limit=Number.isInteger(options.maxProviderReads)&&options.maxProviderReads>0?Math.min(MAX_PROVIDER_READS,options.maxProviderReads):MAX_PROVIDER_READS;
 const recovery={env,owner,access,accessProvider,refreshed:false};
 const boundedFetch=async(url,init)=>{if(String(url).startsWith('https://gmail.googleapis.com/')){if(providerReads>=limit)fail(409,'correspondence_read_budget');providerReads++;}return fetcher(url,init);};
 const get=path=>readGoogleMailJson(boundedFetch,access.accessToken,path,recovery);
 await run(db,'INSERT OR IGNORE INTO google_mail_correspondence_scan(owner_id,google_sub,scan_started_at) VALUES (?,?,?)',owner,subject,now);
 const acquired=await run(db,'UPDATE google_mail_correspondence_scan SET lock_token=?,lock_until=? WHERE owner_id=? AND google_sub=? AND lock_until<?',lock,now+300000,owner,subject,now);
 if(!acquired.meta?.changes)fail(409,'sync_in_progress');
 let state;
 const saveState=async()=>run(db,'UPDATE google_mail_correspondence_scan SET page_token=?,pending_sent_ids=?,backfill_complete=?,cycle_complete=?,scan_started_at=?,scan_after=?,scanned_count=?,matched_sent_count=?,last_synced_at=?,next_scan_at=?,next_lane=?,pending_thread_id=?,pending_thread_messages=?,pending_snapshot_ids=?,pending_checked_at=?,last_error=? WHERE owner_id=? AND google_sub=? AND lock_token=?',state.page_token,JSON.stringify(state.ids),state.backfill_complete,state.cycle_complete,state.scan_started_at,state.scan_after,state.scanned_count,state.matched_sent_count,state.last_synced_at,state.next_scan_at,state.next_lane,state.pending_thread_id,JSON.stringify(state.messages),JSON.stringify(state.snapshot),state.pending_checked_at,state.last_error,owner,subject,lock);
 const cache=async messages=>{
  if(!messages.length)return;if(messages.length>MAX_CACHE_WRITES)fail(409,'correspondence_write_budget');
  // At most 80 bindings: one D1 statement, not ten independent network writes.
  await run(db,'INSERT INTO google_mail_messages(owner_id,google_sub,gmail_id,thread_id,message_date,priority,data,updated_at) VALUES '+messages.map(()=>'(?,?,?,?,?,?,?,?)').join(',')+' ON CONFLICT(owner_id,google_sub,gmail_id) DO UPDATE SET thread_id=excluded.thread_id,message_date=excluded.message_date,priority=excluded.priority,data=excluded.data,updated_at=excluded.updated_at',...messages.flatMap(message=>[owner,subject,message.id,message.threadId,message.dateTimestamp,message.priority,JSON.stringify(message),now]));
  synced+=messages.length;cacheWrites+=messages.length;
 };
 try{
  const found=await first(db,'SELECT * FROM google_mail_correspondence_scan WHERE owner_id=? AND google_sub=?',owner,subject);
  state={...found,page_token:validPageToken(found.page_token),ids:pendingIds(found.pending_sent_ids),messages:pendingMessages(found.pending_thread_messages),snapshot:snapshotIds(found.pending_snapshot_ids)};
  // Existing own application mail makes the first useful thread read immediate,
  // even when a large unrelated Sent archive precedes further applications.
  await run(db,"INSERT OR IGNORE INTO google_mail_correspondence_threads(owner_id,google_sub,thread_id,discovered_at) SELECT owner_id,google_sub,thread_id,? FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND json_extract(data,'$.direction')='sent' AND (instr(lower(data),'pesci')>0 OR instr(lower(data),'general practitioner')>0 OR instr(lower(data),'supervision')>0) GROUP BY thread_id LIMIT 20",now,owner,subject);
  if(state.cycle_complete&&now>=state.next_scan_at){state.scan_after=Math.max(0,Math.floor(state.scan_started_at/1000)-86400);state.scan_started_at=now;state.cycle_complete=0;state.page_token=null;state.ids=[];}
  const thread=state.pending_thread_id?{thread_id:state.pending_thread_id}:await first(db,'SELECT thread_id FROM google_mail_correspondence_threads WHERE owner_id=? AND google_sub=? AND (last_checked_at IS NULL OR last_checked_at<=?) ORDER BY coalesce(last_checked_at,0),discovered_at,thread_id LIMIT 1',owner,subject,now-REVISIT_MS);
  const threadTurn=!!thread&&(!!state.pending_thread_id||state.next_lane===1||state.scanned_count===0||!!state.cycle_complete);
  if(threadTurn){
   const threadId=thread.thread_id;if(!validId(threadId))fail(409,'invalid_correspondence_cursor');
   if(!state.pending_thread_id){
    await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_error=NULL WHERE owner_id=? AND google_sub=? AND thread_id=?',owner,subject,threadId);
    let raw;
    try{raw=await get('threads/'+encodeURIComponent(threadId)+'?format=full');}
    catch(error){if(error.code==='gmail_not_found'||error.code==='gmail_response_too_large'){
     await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_checked_at=?,last_error=? WHERE owner_id=? AND google_sub=? AND thread_id=?',now,error.code,owner,subject,threadId);
     if(error.code==='gmail_not_found')await run(db,'DELETE FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND thread_id=?',owner,subject,threadId);
     state.next_lane=0;state.last_error=error.code;state.last_synced_at=now;await saveState();return {...await getClinicCorrespondenceCoverage(env,context),synced,providerReads,readThreads,scannedThisRun,matchedThisRun};
    }await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_checked_at=?,last_error=? WHERE owner_id=? AND google_sub=? AND thread_id=?',now,/^[a-z_]{3,80}$/.test(error.code||'')?error.code:'gmail_unavailable',owner,subject,threadId);throw error;}
    if(raw.id!==threadId||!Array.isArray(raw.messages)||raw.messages.length>MAX_THREAD_MESSAGES||raw.messages.some(message=>message?.threadId!==threadId)){
     const code=raw.id===threadId&&Array.isArray(raw.messages)&&raw.messages.length>MAX_THREAD_MESSAGES?'gmail_thread_requires_manual_review':'invalid_gmail_response';
     await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_checked_at=?,last_error=? WHERE owner_id=? AND google_sub=? AND thread_id=?',now,code,owner,subject,threadId);state.next_lane=0;fail(502,code);
    }
    const messages=raw.messages.filter(message=>!(message.labelIds||[]).some(label=>['DRAFT','SPAM','TRASH'].includes(label))).map(normalizeMessage);
    // This thread was selected from a genuine Sent application; no arbitrary
    // user-supplied thread ID can reach this reader.
    state.pending_thread_id=threadId;state.messages=messages;state.snapshot=messages.map(message=>message.id);state.pending_checked_at=now;
    await saveState();
    readThreads++;
   }
   const chunk=state.messages.slice(0,MAX_CACHE_WRITES-cacheWrites);await cache(chunk);state.messages=state.messages.slice(chunk.length);
   if(!state.messages.length){
    // Keep the previous snapshot during temporary failures. Only a complete
    // successful replacement can remove deleted/trashed messages from cache.
    await run(db,'DELETE FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND thread_id=? AND gmail_id NOT IN (SELECT value FROM json_each(?))',owner,subject,threadId,JSON.stringify(state.snapshot));
    await run(db,'UPDATE google_mail_correspondence_threads SET complete=1,last_checked_at=?,last_error=NULL WHERE owner_id=? AND google_sub=? AND thread_id=?',state.pending_checked_at,owner,subject,threadId);state.pending_thread_id=null;state.pending_checked_at=null;state.snapshot=[];state.next_lane=0;
   }
  }else if(!state.cycle_complete){
   if(!state.ids.length){
    const q='-in:spam -in:trash -in:drafts'+(state.scan_after?' after:'+state.scan_after:'');
    const list=await get('messages?labelIds=SENT&maxResults='+MAX_SENT_PAGE+'&q='+encodeURIComponent(q)+(state.page_token?'&pageToken='+encodeURIComponent(state.page_token):''));
    if(list.messages!==undefined&&(!Array.isArray(list.messages)||list.messages.length>MAX_SENT_PAGE))fail(502,'invalid_gmail_response');
    if((list.messages||[]).some(message=>!validId(message?.id)))fail(502,'invalid_gmail_response');
    state.ids=[...new Set((list.messages||[]).map(message=>message.id))].slice(0,MAX_SENT_PAGE);state.page_token=validPageToken(list.nextPageToken);
    // Persist pending work before reading bodies. Transient errors must not
    // skip unread IDs merely because the provider advanced its page token.
    await saveState();
   }
   let processed=0,providerError=null;const matched=[];
   while(processed<state.ids.length&&providerReads<limit&&processed<MAX_CACHE_WRITES){
    const id=state.ids[processed];let message;
    try{message=normalizeMessage(await get('messages/'+encodeURIComponent(id)+'?format=full'));if(message.id!==id)fail(502,'invalid_gmail_response');}
    catch(error){if(error.code!=='gmail_not_found'){providerError=error;break;}}
    if(message&&isClinicApplicationMessage(message,options)){
     matched.push(message);
    }
    processed++;
   }
   await cache(matched);
   const threadIds=[...new Set(matched.map(message=>message.threadId))];
   if(threadIds.length)await run(db,'INSERT OR IGNORE INTO google_mail_correspondence_threads(owner_id,google_sub,thread_id,discovered_at) VALUES '+threadIds.map(()=>'(?,?,?,?)').join(','),...threadIds.flatMap(id=>[owner,subject,id,now]));
   state.ids=state.ids.slice(processed);scannedThisRun=processed;matchedThisRun=matched.length;state.scanned_count+=processed;state.matched_sent_count+=matched.length;
   if(providerError)throw providerError;
   if(!state.ids.length&&!state.page_token){state.cycle_complete=1;state.backfill_complete=1;state.next_scan_at=now+REVISIT_MS;}
   state.next_lane=1;
  }
  state.last_synced_at=now;state.last_error=null;await saveState();
 }catch(error){
  if(state){state.last_error=/^[a-z_]{3,80}$/.test(error.code||'')?error.code:'correspondence_sync_failed';await saveState();}
  throw error;
 }finally{await run(db,'UPDATE google_mail_correspondence_scan SET lock_token=NULL,lock_until=0 WHERE owner_id=? AND google_sub=? AND lock_token=?',owner,subject,lock);}
 return {...await getClinicCorrespondenceCoverage(env,context),synced,providerReads,readThreads,scannedThisRun,matchedThisRun};
}
