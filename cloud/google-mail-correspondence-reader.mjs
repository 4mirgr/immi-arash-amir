import {getGoogleAccess} from './google-oauth.mjs';
import {extractEmails,normalizeMessage,readGoogleMailJson,classifyProjectMessage} from './google-mail.mjs';

const MAX_PROVIDER_READS=10,MAX_PAGE=20,MAX_BATCH=8,MAX_THREAD_MESSAGES=500,MAX_HISTORY_IDS=100000,REVISIT_MS=15*60000;
const COVERAGE='all_mail_progressive_related_threads';
const readScope='https://www.googleapis.com/auth/gmail.readonly';
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const validHistory=value=>typeof value==='string'&&/^\d{1,100}$/.test(value);
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
export class CorrespondenceReaderError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new CorrespondenceReaderError(status,code);};
const safeCode=error=>/^[a-z_]{3,80}$/.test(error?.code||'')?error.code:'correspondence_sync_failed';
const excluded=message=>(message.labels||[]).some(label=>['DRAFT','SPAM','TRASH'].includes(label));
function ownerContext(context){
 const id=context?.userId,profile=context?.profileId;
 if(typeof id!=='string'||!id||id.length>150||!['arash','amir'].includes(profile)||/[\x00-\x20]/.test(id))fail(403,'workspace_required');
 const secondary=id.endsWith(':secondary'),root=secondary?id.slice(0,-10):id;
 if(root.includes(':')||!root||(context.rootUserId&&context.rootUserId!==root)||(context.mailbox&&context.mailbox!==(secondary?'secondary':'primary')))fail(403,'mailbox_owner_mismatch');
 return {owner:id,profile,mailbox:secondary?'secondary':'primary'};
}
function hasReadScope(access){return [readScope,'https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].some(scope=>access?.scopes?.includes(scope));}
function idList(raw,max=MAX_HISTORY_IDS){let values;try{values=JSON.parse(raw||'[]');}catch{fail(409,'invalid_correspondence_cursor');}if(!Array.isArray(values)||values.length>max||values.some(id=>!validId(id)))fail(409,'invalid_correspondence_cursor');return values;}
function messageList(raw){let values;try{values=JSON.parse(raw||'[]');}catch{fail(409,'invalid_correspondence_cursor');}if(!Array.isArray(values)||values.length>MAX_THREAD_MESSAGES||values.some(message=>!validId(message?.id)||!validId(message?.threadId)))fail(409,'invalid_correspondence_cursor');return values;}
function pageToken(value){if(value===null||value===undefined)return null;if(typeof value!=='string'||value.length>2000||/[\x00-\x1f]/.test(value))fail(409,'invalid_correspondence_cursor');return value;}

/** An application/enquiry signal, never proof of a vacancy or employer intent. */
export function isClinicApplicationMessage(message,{matchedEmails=[],matchedDomains=[]}={}){
 if(message?.direction!=='sent'||excluded(message))return false;
 const recipients=extractEmails([message.to,message.cc,message.bcc].join(' '));if(!recipients.length)return false;
 const text=[message.subject,message.plainBody||message.snippet].join('\n').slice(0,40000);
 const career=/\b(?:jobs?|vacanc(?:y|ies)|employment|recruit(?:ment|er|ing)?|position|application|apply|enquir(?:y|ing)|inquir(?:y|ing)|curriculum vitae|resume|cv|supervis(?:ion|or)|sponsor(?:ship)?|pesci)\b/i.test(text);
 const medicine=/\b(?:general practitioner|gp|medic(?:al|ine)|doctor|physician|clinic|practice|hospital|ahpra|amc|racgp|acrrm|pesci)\b/i.test(text);
 return career&&(medicine||recipients.some(email=>matchedEmails.includes(email)||matchedDomains.includes(email.split('@')[1])));
}
function projectRelated(message,options){
 if(excluded(message))return false;if(isClinicApplicationMessage(message,options)||classifyProjectMessage(message).related)return true;
 const text=[message.subject,message.plainBody||message.snippet].join('\n').slice(0,40000);
 return /\b(?:jobs?|vacanc(?:y|ies)|recruit(?:ment|ing)?|opportunit(?:y|ies)|supervis(?:ion|or))\b/i.test(text)&&/\b(?:gp|general practitioner|medic(?:al|ine)|doctor|physician|clinic|hospital|healthcare)\b/i.test(text);
}
function defaults(mailbox,status='connected'){return {status,mailbox,coverage:COVERAGE,folderScope:'all_sent_received_including_spam_trash',ignoredAutomationLabels:['DRAFT','SPAM','TRASH'],scannedMessageCount:0,scannedSentCount:0,scannedReceivedCount:0,matchedSentCount:0,relatedMessageCount:0,ignoredLabelCount:0,archiveComplete:false,backfillComplete:false,moreArchive:true,moreSent:true,pendingMessageCount:0,pendingSentCount:0,pendingThreadMessageCount:0,historyReviewedCount:0,historyPendingCount:0,historyCaughtUp:false,historyGapRequiresReview:false,historyRecoveryActive:false,lastHistorySyncedAt:null,threadCount:0,completeThreadCount:0,failedThreadCount:0,unreadableMessageCount:0,fullReadingComplete:false,lastSyncedAt:null,automaticSending:false};}
async function coverage(db,owner,subject,mailbox,state,status='connected'){
 const aggregate=await first(db,'SELECT count(*) AS total,coalesce(sum(complete),0) AS completed,coalesce(sum(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END),0) AS failed,(SELECT count(*) FROM google_mail_full_scan_errors WHERE owner_id=? AND google_sub=?) AS unreadable FROM google_mail_correspondence_threads WHERE owner_id=? AND google_sub=?',owner,subject,owner,subject);
 const base=defaults(mailbox,status),pending=idList(state?.archive_pending_ids,MAX_PAGE).length,historyPending=idList(state?.history_pending_ids).length+idList(state?.history_deleted_ids).length,unreadable=Number(aggregate?.unreadable||0),threadPending=messageList(state?.pending_thread_messages).length;
 return {...base,scannedMessageCount:Number(state?.archive_scanned_count||0),scannedSentCount:Number(state?.archive_sent_count||0),scannedReceivedCount:Number(state?.archive_received_count||0),relatedMessageCount:Number(state?.related_count||0),matchedSentCount:Number(state?.related_sent_count||0),ignoredLabelCount:Number(state?.ignored_label_count||0),archiveComplete:!!state?.archive_complete,backfillComplete:!!state?.archive_complete,moreArchive:!state?.archive_complete,moreSent:!state?.archive_complete,pendingMessageCount:pending,pendingSentCount:pending,pendingThreadMessageCount:threadPending,historyReviewedCount:Number(state?.history_reviewed_count||0),historyPendingCount:historyPending,historyCaughtUp:!!state?.history_caught_up&&!state?.history_gap_since&&!state?.history_recovery_active,historyGapRequiresReview:!!state?.history_gap_since,historyRecoveryActive:!!state?.history_recovery_active,lastHistorySyncedAt:state?.history_last_synced_at?new Date(state.history_last_synced_at).toISOString():null,threadCount:Number(aggregate?.total||0),completeThreadCount:Number(aggregate?.completed||0),failedThreadCount:Number(aggregate?.failed||0),unreadableMessageCount:unreadable,fullReadingComplete:!!state?.archive_complete&&!!state?.history_caught_up&&!state?.history_gap_since&&!state?.history_recovery_active&&!pending&&!historyPending&&!state?.history_page_token&&!threadPending&&!Number(aggregate?.failed||0)&&!unreadable,lastSyncedAt:state?.last_synced_at?new Date(state.last_synced_at).toISOString():null,lastError:state?.last_error||null};
}
/** Cache-only progress: no provider credentials or raw correspondence returned. */
export async function getClinicCorrespondenceCoverage(env,context){
 const {owner,profile,mailbox}=ownerContext(context);if(!env.GOOGLE_DB)fail(503,'google_storage_required');
 const db=env.GOOGLE_DB,account=await first(db,'SELECT google_sub,status FROM google_accounts WHERE owner_id=? AND profile_id=?',owner,profile);
 if(!account)return defaults(mailbox,'not_connected');
 const state=await first(db,'SELECT * FROM google_mail_full_scan WHERE owner_id=? AND google_sub=?',owner,account.google_sub);
 return coverage(db,owner,account.google_sub,mailbox,state,account.status==='connected'?'connected':'reconnect_required');
}
const stateFields=['archive_page_token','archive_pending_ids','archive_complete','archive_started_at','archive_scanned_count','archive_sent_count','archive_received_count','related_count','related_sent_count','ignored_label_count','has_analysis_limits','history_id','history_page_token','history_pending_ids','history_deleted_ids','history_pending_target','history_caught_up','history_last_synced_at','history_reviewed_count','history_gap_since','history_recovery_after','history_recovery_page_token','history_recovery_active','gap_rescan_active','last_full_scan_at','last_synced_at','next_lane','pending_thread_id','pending_thread_messages','pending_snapshot_ids','pending_checked_at','last_error'];

/**
 * Trusted server-only adapter. Unattended callers first check fresh membership.
 * Archive, unfiltered Gmail history and related-thread refresh rotate separately.
 * onMessages sees ALL read messages (max eight) before cursor advancement; the
 * callback must be owner-private, idempotent and bounded. No sending occurs.
 */
export async function syncClinicCorrespondence(env,context,fetcher=fetch,options={}){
 const {owner,profile,mailbox}=ownerContext(context);if(!env.GOOGLE_DB)fail(503,'google_storage_required');
 let readerQueries=0;const original=env.GOOGLE_DB;
 const db={prepare(sql){return {bind(...args){const bound=original.prepare(sql).bind(...args);return {async first(...values){readerQueries++;return bound.first(...values);},async all(...values){readerQueries++;return bound.all(...values);},async run(...values){readerQueries++;return bound.run(...values);}};}};}};
 const account=await first(db,'SELECT google_sub,status FROM google_accounts WHERE owner_id=? AND profile_id=?',owner,profile);
 if(!account)fail(409,'not_connected');if(account.status!=='connected')fail(409,'reconnect_required');
 const readerEnv={...env,GOOGLE_DB:db},accessProvider=options.accessProvider||getGoogleAccess,access=await accessProvider(readerEnv,owner,fetcher);
 if(access.subject!==account.google_sub)fail(409,'connection_changed');if(!access.accessToken)fail(401,'reconnect_required');if(!hasReadScope(access))fail(403,'gmail_read_scope_required');
 const now=Number.isFinite(options.now)?options.now:Date.now(),subject=access.subject,lock=crypto.randomUUID();
 let providerReads=0,synced=0,scannedThisRun=0,matchedThisRun=0,readThreads=0,lane='archive',laneStarted=false;
 const limit=Number.isInteger(options.maxProviderReads)&&options.maxProviderReads>0?Math.min(MAX_PROVIDER_READS,options.maxProviderReads):MAX_PROVIDER_READS;
 const recovery={env:readerEnv,owner,access,accessProvider,refreshed:false};
 const boundedFetch=async(url,init)=>{if(String(url).startsWith('https://gmail.googleapis.com/')){if(providerReads>=limit)fail(409,'correspondence_read_budget');providerReads++;}return fetcher(url,init);};
 const get=path=>readGoogleMailJson(boundedFetch,access.accessToken,path,recovery);
 await run(db,'INSERT OR IGNORE INTO google_mail_full_scan(owner_id,google_sub,archive_started_at) VALUES (?,?,?)',owner,subject,now);
 const acquired=await run(db,'UPDATE google_mail_full_scan SET lock_token=?,lock_until=? WHERE owner_id=? AND google_sub=? AND lock_until<?',lock,now+300000,owner,subject,now);if(!acquired.meta?.changes)fail(409,'sync_in_progress');
 let state;
 const save=async()=>run(db,'UPDATE google_mail_full_scan SET '+stateFields.map(name=>name+'=?').join(',')+' WHERE owner_id=? AND google_sub=? AND lock_token=?',...stateFields.map(name=>state[name]??null),owner,subject,lock);
 const identity=source=>({subject,email:access.email||null,mailbox,source,observedAt:source==='thread'&&state?.pending_checked_at?state.pending_checked_at:now});
 const call=async(name,values,source)=>{
  if(typeof options[name]!=='function')return;
  try{await options[name](values,context,identity(source));}
  catch(error){
   if(/^[a-z_]{3,80}$/.test(error?.code||''))throw error;
   // Keep diagnostic categories safe; exception messages can contain private
   // message content, SQL parameters or provider responses.
   const wrapped=new CorrespondenceReaderError(503,name==='onDeleted'?'correspondence_deletion_analysis_failed':'correspondence_message_analysis_failed');
   wrapped.cause=error;throw wrapped;
  }
 };
 const cache=async(messages,observedAt=now)=>{if(!messages.length)return;if(messages.length>MAX_BATCH)fail(409,'correspondence_write_budget');await run(db,'INSERT INTO google_mail_messages(owner_id,google_sub,gmail_id,thread_id,message_date,priority,data,updated_at) VALUES '+messages.map(()=>'(?,?,?,?,?,?,?,?)').join(',')+' ON CONFLICT(owner_id,google_sub,gmail_id) DO UPDATE SET thread_id=excluded.thread_id,message_date=excluded.message_date,priority=excluded.priority,data=excluded.data,updated_at=excluded.updated_at WHERE google_mail_messages.updated_at<=excluded.updated_at',...messages.flatMap(message=>[owner,subject,message.id,message.threadId,message.dateTimestamp,message.priority,JSON.stringify(message),observedAt]));synced+=messages.length;};
 async function recordReadLimits(messages,source,unreadable=[]){
  const hadLimits=!!state.has_analysis_limits,limited=[...unreadable,...messages.filter(message=>message.bodyTruncated||message.linksTruncated).map(message=>({id:message.id,code:message.bodyTruncated?'mail_body_analysis_limited':'mail_link_analysis_limited'}))];
  if(limited.length){await run(db,'INSERT INTO google_mail_full_scan_errors(owner_id,google_sub,gmail_id,source,code,checked_at) VALUES '+limited.map(()=>'(?,?,?,?,?,?)').join(',')+' ON CONFLICT(owner_id,google_sub,gmail_id) DO UPDATE SET source=excluded.source,code=excluded.code,checked_at=excluded.checked_at',...limited.flatMap(item=>[owner,subject,item.id,source,item.code,now]));state.has_analysis_limits=1;}
  const complete=messages.filter(message=>!message.bodyTruncated&&!message.linksTruncated).map(message=>message.id);if(hadLimits&&complete.length)await run(db,'DELETE FROM google_mail_full_scan_errors WHERE owner_id=? AND google_sub=? AND gmail_id IN (SELECT value FROM json_each(?))',owner,subject,JSON.stringify(complete));
 }
 const abandonSnapshot=()=>{state.pending_thread_id=null;state.pending_thread_messages='[]';state.pending_snapshot_ids='[]';state.pending_checked_at=null;};
 async function notifyDeleted(ids,source){if(!ids.length)return;await call('onDeleted',ids,source);if(state.pending_thread_id&&idList(state.pending_snapshot_ids,MAX_THREAD_MESSAGES).some(id=>ids.includes(id)))abandonSnapshot();await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_checked_at=NULL WHERE owner_id=? AND google_sub=? AND thread_id IN (SELECT thread_id FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND gmail_id IN (SELECT value FROM json_each(?)))',owner,subject,owner,subject,JSON.stringify(ids));await run(db,'DELETE FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND gmail_id IN (SELECT value FROM json_each(?))',owner,subject,JSON.stringify(ids));}
 async function processIds(ids,source,knownDeleted=[]){
  const messages=[],deleted=[...knownDeleted],unreadable=[];let processed=0,error=null;
  while(processed<ids.length&&processed<MAX_BATCH&&providerReads<limit){
   const id=ids[processed];try{const message=normalizeMessage(await get('messages/'+encodeURIComponent(id)+'?format=full'));if(message.id!==id)fail(502,'invalid_gmail_response');messages.push(message);}
   catch(cause){if(cause.code==='gmail_not_found')deleted.push(id);else if(cause.code==='gmail_response_too_large')unreadable.push({id,code:'gmail_response_too_large'});else{error=cause;break;}}processed++;
  }
  // Extraction and stop-state observation are part of committing a read. If a
  // callback fails, these IDs remain pending for an idempotent retry.
  await call('onMessages',messages,source);await notifyDeleted([...new Set(deleted)],source);
  await recordReadLimits(messages,source,unreadable);
  if(messages.length){
   // A snapshot spanning multiple invocations cannot later delete a new reply
   // observed by the independent history lane. Re-read that thread freshly.
   if(state.pending_thread_id&&messages.some(message=>message.threadId===state.pending_thread_id))abandonSnapshot();
   const idsJson=JSON.stringify(messages.map(message=>message.threadId)),known=new Set((await rows(db,'SELECT thread_id FROM google_mail_correspondence_threads WHERE owner_id=? AND google_sub=? AND thread_id IN (SELECT value FROM json_each(?))',owner,subject,idsJson)).map(row=>row.thread_id));
   const related=messages.filter(message=>!excluded(message)&&(known.has(message.threadId)||projectRelated(message,options)));await cache(related);matchedThisRun+=related.length;state.related_count+=related.length;state.related_sent_count+=related.filter(message=>message.direction==='sent').length;
   const remove=messages.filter(message=>!related.includes(message)).map(message=>message.id);if(remove.length)await run(db,'DELETE FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND gmail_id IN (SELECT value FROM json_each(?))',owner,subject,JSON.stringify(remove));
   const applications=[...new Set(related.filter(message=>isClinicApplicationMessage(message,options)).map(message=>message.threadId))];if(applications.length)await run(db,'INSERT OR IGNORE INTO google_mail_correspondence_threads(owner_id,google_sub,thread_id,discovered_at) VALUES '+applications.map(()=>'(?,?,?,?)').join(','),...applications.flatMap(id=>[owner,subject,id,now]));
   if(known.size)await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_checked_at=NULL WHERE owner_id=? AND google_sub=? AND thread_id IN (SELECT value FROM json_each(?))',owner,subject,idsJson);
   state.ignored_label_count+=messages.filter(excluded).length;
   if(source==='archive'){state.archive_sent_count+=messages.filter(message=>message.direction==='sent'&&!message.labels.includes('DRAFT')).length;state.archive_received_count+=messages.filter(message=>message.direction!=='sent'&&!message.labels.includes('DRAFT')).length;}
  }
  return {processed,error};
 }
 try{
  state=await first(db,'SELECT * FROM google_mail_full_scan WHERE owner_id=? AND google_sub=?',owner,subject);
  for(const field of ['archive_page_token','history_page_token','history_recovery_page_token'])state[field]=pageToken(state[field]);
  idList(state.archive_pending_ids,MAX_PAGE);idList(state.history_pending_ids);idList(state.history_deleted_ids);messageList(state.pending_thread_messages);idList(state.pending_snapshot_ids,MAX_THREAD_MESSAGES);
  if(![0,1,2].includes(state.next_lane))fail(409,'invalid_correspondence_cursor');
  if(!state.history_id){const profileData=await get('profile');if(!validHistory(profileData.historyId))fail(502,'invalid_gmail_response');state.history_id=profileData.historyId;state.history_last_synced_at=now;await save();}
  if(!validHistory(state.history_id))fail(409,'invalid_correspondence_cursor');
  if(!state.archive_scanned_count&&!state.history_reviewed_count)await run(db,"INSERT OR IGNORE INTO google_mail_correspondence_threads(owner_id,google_sub,thread_id,discovered_at) SELECT owner_id,google_sub,thread_id,? FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND json_extract(data,'$.direction')='sent' AND (instr(lower(data),'pesci')>0 OR instr(lower(data),'general practitioner')>0 OR instr(lower(data),'supervision')>0) GROUP BY thread_id LIMIT 20",now,owner,subject);
  lane=state.next_lane===1?'history':state.next_lane===2?'thread':'archive';
  if(lane==='archive'&&state.archive_complete){if(state.history_gap_since&&!state.gap_rescan_active){state.archive_complete=0;state.archive_page_token=null;state.archive_pending_ids='[]';state.archive_started_at=now;state.gap_rescan_active=1;}else lane='history';}
  let thread=null;
  if(lane==='thread'){thread=state.pending_thread_id?{thread_id:state.pending_thread_id}:await first(db,'SELECT thread_id FROM google_mail_correspondence_threads WHERE owner_id=? AND google_sub=? AND (last_checked_at IS NULL OR last_checked_at<=?) ORDER BY coalesce(last_checked_at,0),discovered_at,thread_id LIMIT 1',owner,subject,now-REVISIT_MS);if(!thread)lane=state.archive_complete&&!state.history_gap_since?'history':'archive';}
  if(lane==='archive'&&state.archive_complete&&state.history_gap_since&&!state.gap_rescan_active){state.archive_complete=0;state.archive_page_token=null;state.archive_pending_ids='[]';state.archive_started_at=now;state.gap_rescan_active=1;}
  laneStarted=true;
  if(lane==='archive'){
   let ids=idList(state.archive_pending_ids,MAX_PAGE),pageRead=ids.length>0;
   if(!ids.length&&providerReads<limit){const list=await get('messages?includeSpamTrash=true&maxResults='+MAX_PAGE+'&q='+encodeURIComponent('-in:drafts')+(state.archive_page_token?'&pageToken='+encodeURIComponent(state.archive_page_token):''));if(list.messages!==undefined&&(!Array.isArray(list.messages)||list.messages.length>MAX_PAGE||(list.messages||[]).some(message=>!validId(message?.id))))fail(502,'invalid_gmail_response');ids=[...new Set((list.messages||[]).map(message=>message.id))];state.archive_page_token=pageToken(list.nextPageToken);state.archive_pending_ids=JSON.stringify(ids);pageRead=true;await save();}
   const result=await processIds(ids,'archive');state.archive_pending_ids=JSON.stringify(ids.slice(result.processed));state.archive_scanned_count+=result.processed;scannedThisRun=result.processed;
   if(pageRead&&!ids.slice(result.processed).length&&!state.archive_page_token){state.archive_complete=1;state.last_full_scan_at=now;if(state.gap_rescan_active){state.history_gap_since=null;state.gap_rescan_active=0;}}
   state.next_lane=1;if(result.error)throw result.error;
  }else if(lane==='history'){
   let ids=idList(state.history_pending_ids),deleted=idList(state.history_deleted_ids),pageRead=ids.length>0||deleted.length>0;
   if(!ids.length&&!deleted.length&&providerReads<limit){
    if(state.history_recovery_active){
     const list=await get('messages?includeSpamTrash=true&maxResults='+MAX_PAGE+'&q='+encodeURIComponent('-in:drafts after:'+state.history_recovery_after)+(state.history_recovery_page_token?'&pageToken='+encodeURIComponent(state.history_recovery_page_token):''));if(list.messages!==undefined&&(!Array.isArray(list.messages)||list.messages.length>MAX_PAGE||(list.messages||[]).some(message=>!validId(message?.id))))fail(502,'invalid_gmail_response');ids=[...new Set((list.messages||[]).map(message=>message.id))];state.history_recovery_page_token=pageToken(list.nextPageToken);pageRead=true;
    }else{
     let history;
     try{history=await get('history?startHistoryId='+encodeURIComponent(state.history_id)+'&maxResults='+MAX_PAGE+(state.history_page_token?'&pageToken='+encodeURIComponent(state.history_page_token):''));}
     catch(error){if(error.code!=='gmail_not_found')throw error;if(typeof options.onHistoryGap==='function')await options.onHistoryGap(context,identity('history'));if(providerReads>=limit)throw error;const profileData=await get('profile');if(!validHistory(profileData.historyId))fail(502,'invalid_gmail_response');state.history_gap_since=state.history_gap_since||state.history_last_synced_at||state.archive_started_at;state.history_recovery_after=Math.max(0,Math.floor(Number(state.history_last_synced_at||state.archive_started_at)/1000)-86400);state.history_recovery_active=1;state.history_recovery_page_token=null;state.history_id=profileData.historyId;state.history_page_token=null;state.history_pending_target=null;state.history_caught_up=0;state.last_error='gmail_history_gap_recovery';state.next_lane=2;state.last_synced_at=now;await save();history=null;}
     if(history){if(!validHistory(history.historyId)||history.history!==undefined&&!Array.isArray(history.history))fail(502,'invalid_gmail_response');const candidates=new Set(),removed=new Set();for(const item of history.history||[]){for(const message of item.messages||[])if(validId(message?.id))candidates.add(message.id);for(const type of ['messagesAdded','labelsAdded','labelsRemoved'])for(const change of item[type]||[])if(validId(change.message?.id))candidates.add(change.message.id);for(const change of item.messagesDeleted||[])if(validId(change.message?.id))removed.add(change.message.id);}for(const id of removed)candidates.delete(id);ids=[...candidates];deleted=[...removed];if(ids.length>MAX_HISTORY_IDS||deleted.length>MAX_HISTORY_IDS)fail(409,'gmail_history_page_requires_manual_review');state.history_page_token=pageToken(history.nextPageToken);state.history_pending_target=history.historyId;state.history_caught_up=0;pageRead=true;}
    }
    state.history_pending_ids=JSON.stringify(ids);state.history_deleted_ids=JSON.stringify(deleted);await save();
   }
   const result=await processIds(ids,'history',deleted);state.history_pending_ids=JSON.stringify(ids.slice(result.processed));state.history_deleted_ids='[]';state.history_reviewed_count+=result.processed;scannedThisRun=result.processed;
   if(pageRead&&!ids.slice(result.processed).length){if(state.history_recovery_active&&!state.history_recovery_page_token){state.history_recovery_active=0;state.history_last_synced_at=now;}else if(!state.history_recovery_active&&!state.history_page_token&&state.history_pending_target){state.history_id=state.history_pending_target;state.history_pending_target=null;state.history_caught_up=1;state.history_last_synced_at=now;}}
   state.next_lane=2;if(result.error)throw result.error;
  }else{
   const threadId=thread.thread_id;if(!validId(threadId))fail(409,'invalid_correspondence_cursor');
   if(!state.pending_thread_id){
    await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_error=NULL WHERE owner_id=? AND google_sub=? AND thread_id=?',owner,subject,threadId);
    let raw;try{raw=await get('threads/'+encodeURIComponent(threadId)+'?format=full');}catch(error){await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_checked_at=?,last_error=? WHERE owner_id=? AND google_sub=? AND thread_id=?',now,safeCode(error),owner,subject,threadId);if(error.code==='gmail_not_found'){const removed=(await rows(db,'SELECT gmail_id FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND thread_id=?',owner,subject,threadId)).map(message=>message.gmail_id);await notifyDeleted(removed,'thread');}state.next_lane=0;throw error;}
    if(raw.id!==threadId||!Array.isArray(raw.messages)||raw.messages.length>MAX_THREAD_MESSAGES||raw.messages.some(message=>message?.threadId!==threadId)){const code=raw.id===threadId&&Array.isArray(raw.messages)&&raw.messages.length>MAX_THREAD_MESSAGES?'gmail_thread_requires_manual_review':'invalid_gmail_response';await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_checked_at=?,last_error=? WHERE owner_id=? AND google_sub=? AND thread_id=?',now,code,owner,subject,threadId);state.next_lane=0;fail(502,code);}
    let messages;try{messages=raw.messages.map(normalizeMessage);if(new TextEncoder().encode(JSON.stringify(messages)).length>1500000)fail(502,'gmail_thread_requires_manual_review');}catch(error){await run(db,'UPDATE google_mail_correspondence_threads SET complete=0,last_checked_at=?,last_error=? WHERE owner_id=? AND google_sub=? AND thread_id=?',now,safeCode(error),owner,subject,threadId);state.next_lane=0;throw error;}state.pending_thread_id=threadId;state.pending_thread_messages=JSON.stringify(messages);state.pending_snapshot_ids=JSON.stringify(messages.filter(message=>!excluded(message)).map(message=>message.id));state.pending_checked_at=now;await save();readThreads++;
   }
   const messages=messageList(state.pending_thread_messages),chunk=messages.slice(0,MAX_BATCH);await call('onMessages',chunk,'thread');await recordReadLimits(chunk,'thread');await cache(chunk.filter(message=>!excluded(message)),state.pending_checked_at);state.pending_thread_messages=JSON.stringify(messages.slice(chunk.length));
   if(!messages.slice(chunk.length).length){const removed=(await rows(db,'SELECT gmail_id FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND thread_id=? AND updated_at<=? AND gmail_id NOT IN (SELECT value FROM json_each(?))',owner,subject,threadId,state.pending_checked_at,state.pending_snapshot_ids)).map(message=>message.gmail_id);await call('onDeleted',removed,'thread');await run(db,'DELETE FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND thread_id=? AND updated_at<=? AND gmail_id NOT IN (SELECT value FROM json_each(?))',owner,subject,threadId,state.pending_checked_at,state.pending_snapshot_ids);await run(db,'UPDATE google_mail_correspondence_threads SET complete=1,last_checked_at=?,last_error=NULL WHERE owner_id=? AND google_sub=? AND thread_id=?',state.pending_checked_at,owner,subject,threadId);state.pending_thread_id=null;state.pending_checked_at=null;state.pending_snapshot_ids='[]';}
   state.next_lane=0;
  }
  state.last_synced_at=now;state.last_error=null;await save();
 }catch(error){if(state){
  // A failed classifier or storage write must keep its exact pending batch,
  // while allowing the independent new-mail/history lane to run next time.
  // Otherwise one old archive message can indefinitely starve fresh replies.
  if(laneStarted)state.next_lane=lane==='archive'?1:lane==='history'?2:0;
  state.last_error=safeCode(error);await save();
 }throw error;}
 finally{await run(db,'UPDATE google_mail_full_scan SET lock_token=NULL,lock_until=0 WHERE owner_id=? AND google_sub=? AND lock_token=?',owner,subject,lock);}
 // The scheduled receipt only needs cursor progress. Counting the entire
 // thread and error ledger every minute serves no scheduled decision.
 const result=options.includeCoverage===false?{
  status:'connected',mailbox,
  archiveComplete:!!state.archive_complete,
  scannedMessageCount:Number(state.archive_scanned_count||0),
  historyReviewedCount:Number(state.history_reviewed_count||0),
  historyRecoveryActive:!!state.history_recovery_active,
  pendingThreadMessageCount:messageList(state.pending_thread_messages).length,
  lastSyncedAt:state.last_synced_at?new Date(state.last_synced_at).toISOString():null
 }:await coverage(db,owner,subject,mailbox,state);
 return {...result,synced,providerReads,readerQueries,readThreads,scannedThisRun,matchedThisRun,lane};
}
