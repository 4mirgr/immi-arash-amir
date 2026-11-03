import {getGoogleAccess} from './google-oauth.mjs';

const MAX_BODY=32768, MAX_RESPONSE=1500000, MAX_PENDING=2000;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class MailError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const clean=value=>String(value||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
const trimBytes=(text,max=MAX_BODY)=>new TextDecoder().decode(new TextEncoder().encode(clean(text)).slice(0,max),{stream:true});
const header=(payload,name)=>clean(payload?.headers?.find(h=>String(h.name).toLowerCase()===name)?.value).slice(0,2000);
const gmailId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
function requireReadScope(access){const scopes=Array.isArray(access?.scopes)?access.scopes:[];if(!['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].some(scope=>scopes.includes(scope)))throw new MailError(403,'gmail_read_scope_required');}
function decodeBody(data){try{const value=data.replaceAll('-','+').replaceAll('_','/');return new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));}catch{return '';}}
function plainParts(payload,depth=0){
 if(!payload||depth>10)return '';
 let value=payload.mimeType==='text/plain'&&typeof payload.body?.data==='string'?decodeBody(payload.body.data):'';
 for(const part of (payload.parts||[]).slice(0,30)){value+='\n'+plainParts(part,depth+1);if(new TextEncoder().encode(value).length>=MAX_BODY)break;}
 return trimBytes(value);
}
export function extractEmails(text){
 const emails=new Set();
 // Check bounded tokens only: long non-email body text must not induce regex
 // backtracking on every character, especially on the free Worker CPU budget.
 for(const token of String(text).split(/\s+/)){
  if(!token.includes('@')||token.length>512)continue;
  for(const email of token.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}/g)||[]){emails.add(email.toLowerCase());if(emails.size>=50)return [...emails];}
 }
 return [...emails];
}
function latestReply(text){
 const lines=String(text).split(/\r?\n/),current=[];let excludedHistory=false,excludedSignature=false;
 for(let i=0;i<lines.length;i++){
  const line=lines[i],trimmed=line.trim();
  if(/^>/.test(trimmed)){excludedHistory=true;continue;}
  // Gmail/Apple/Outlook reply boundaries; do not treat a correspondent's old
  // words, the applicant's original pitch or a forwarded thread as new intent.
  const wrappedReplyHeader=/^On\s/i.test(trimmed)&&[1,2,3].some(count=>/^On\s.{1,750}\bwrote:\s*$/i.test(lines.slice(i,i+count).join(' ').slice(0,800).trim()));
  if(wrappedReplyHeader||/^On\s.{1,750}\bwrote:\s*$/i.test(trimmed)||/^(?:-{2,}\s*(?:Original Message|Forwarded message)\s*-*|Begin forwarded message:|_{5,})$/i.test(trimmed)||(/^From:\s/i.test(trimmed)&&lines.slice(i+1,i+5).some(v=>/^(?:Sent|Date|To|Subject):\s/i.test(v.trim())))){
   excludedHistory=true;break;
  }
  if(/^--\s*$/.test(trimmed)||/^(?:sent from my (?:iphone|ipad|android)|get outlook for\b)/i.test(trimmed)||(/^(?:kind regards|best regards|regards|sincerely|yours sincerely|yours faithfully|best wishes)[,!]?$/i.test(trimmed)&&current.some(v=>v.trim()))){excludedSignature=true;break;}
  current.push(line);
 }
 return {text:current.join('\n'),excludedHistory,excludedSignature};
}
export function rankMessage(text,direction='received'){
 if(direction==='sent')return {priority:'weak',reasons:['outbound_message_not_an_employer_response']};
 const current=latestReply(text),lower=current.text.toLowerCase();
 const explained=(priority,reasons)=>({priority,reasons:[...reasons,...(current.excludedHistory?['quoted_history_excluded_from_analysis']:[]),...(current.excludedSignature?['signature_excluded_from_analysis']:[]),'rule_based_review_required']});
 const rejection=/\b(not interested|no (?:current )?(?:vacanc(?:y|ies)|positions|openings)|unsuccessful|unfortunately|we regret|cannot (?:offer|provide|sponsor)|unable to (?:offer|provide|sponsor|proceed)|not able to (?:offer|provide|sponsor)|do not (?:offer|provide|sponsor)|not (?:offer(?:ing)?|provid(?:e|ing)) (?:visa )?sponsor)/;
 const negatedInvitation=/\b(?:unable to|not able to|cannot|can't|can not|will not|won't|do not|don't|not)\s+(?:[a-z]+\s+){0,3}(?:interview(?:ing)?|offer(?:ing)?|arrange|schedule|book|call|sponsor|proceed)\b|\b(?:interview|call|meeting|job offer)\s+(?:is |are )?(?:not (?:possible|available|offered)|unavailable)\b|\bno\s+(?:interview|job offer|call|meeting)\b/;
 if(rejection.test(lower)||negatedInvitation.test(lower))return explained('weak',['rejection_or_unavailable_position_signal']);
 const strong=[['interview',/\binterview\b/],['offer',/\b(?:job offer|offer of employment|employment offer)\b/],['call',/\b(?:arrange|schedule|book) (?:a |an )?(?:call|meeting)\b/],['sponsorship',/\bsponsorship (?:is )?available\b/],['supervision',/\bsupervision (?:is )?available\b/]].filter(([,pattern])=>pattern.test(lower)).map(([name])=>name);
 if(strong.length)return explained('strong',strong.map(v=>'positive_'+v+'_signal'));
 if(/\b(application (?:received|under review)|review (?:your|the) application|send (?:us )?(?:your )?(?:cv|resume)|further information|more information)\b/.test(lower))return explained('medium',['application_or_information_request_signal']);
 return explained('weak',['no_explicit_positive_signal']);
}
export function normalizeMessage(raw){
 if(!gmailId(raw?.id))throw new MailError(502,'invalid_gmail_response');
 const labels=Array.isArray(raw.labelIds)?raw.labelIds.filter(v=>typeof v==='string').slice(0,50):[];
 const direction=labels.includes('SENT')?'sent':'received';
 const from=header(raw.payload,'from'), subject=header(raw.payload,'subject'), plainBody=plainParts(raw.payload).trim();
 const originalId=header(raw.payload,'message-id').trim();
 const rfcMessageId=/^<[^<>\s@]+@[^<>\s@]+>$/.test(originalId)?originalId:null;
 const dateNumber=Number(raw.internalDate)||Date.parse(header(raw.payload,'date'))||0;
 const safeDate=Number.isFinite(dateNumber)&&dateNumber>0&&dateNumber<8640000000000000?dateNumber:0;
 const snippet=trimBytes(clean(raw.snippet).replace(/<[^>]*>/g,''),2000);
 return {rfcMessageId,replyTo:header(raw.payload,'reply-to'),id:raw.id,threadId:gmailId(raw.threadId)?raw.threadId:raw.id,from,subject,date:safeDate?new Date(safeDate).toISOString():null,dateTimestamp:safeDate,snippet,plainBody,hasPlainBody:!!plainBody,labels,direction,...rankMessage(subject+'\n'+(plainBody||snippet),direction),extractedEmails:extractEmails(from+'\n'+header(raw.payload,'reply-to')+'\n'+plainBody)};
}
async function googleJson(fetcher,accessToken,path){
 let response;try{response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(12000)});}catch{throw new MailError(502,'gmail_unavailable');}
 if(response.status===404)throw new MailError(404,'gmail_not_found');
 if(!response.ok)throw new MailError(response.status===429?429:response.status===401?401:response.status===403?403:502,response.status===401?'reconnect_required':response.status===403?'gmail_scope_or_api_required':response.status===429?'gmail_rate_limited':'gmail_unavailable');
 const length=Number(response.headers.get('content-length')||0);if(length>MAX_RESPONSE)throw new MailError(502,'gmail_response_too_large');
 const reader=response.body?.getReader();let text='';
 if(reader){let size=0;const decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE){await reader.cancel();throw new MailError(502,'gmail_response_too_large');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}else text=await response.text();
 try{return JSON.parse(text);}catch{throw new MailError(502,'invalid_gmail_response');}
}
const row=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
function pendingIds(raw){let values;try{values=JSON.parse(raw||'[]');}catch{throw new MailError(409,'invalid_sync_state');}if(!Array.isArray(values)||values.length>MAX_PENDING||values.some(v=>!gmailId(v)))throw new MailError(409,'invalid_sync_state');return values;}
async function readPayload(request){if(Number(request.headers.get('content-length')||0)>2000)throw new MailError(413,'payload_too_large');const raw=await request.text();if(raw.length>2000)throw new MailError(413,'payload_too_large');if(!raw)return {};let parsed;try{parsed=JSON.parse(raw);}catch{throw new MailError(400,'invalid_json');}if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new MailError(400,'object_required');return parsed;}
async function syncMailbox(db,owner,subject,accessToken,fetcher,reset){
 await run(db,'INSERT OR IGNORE INTO google_mail_sync(owner_id,google_sub) VALUES (?,?)',owner,subject);
 const now=Date.now(),lock=crypto.randomUUID();
 const acquired=await run(db,'UPDATE google_mail_sync SET lock_token=?,lock_until=? WHERE owner_id=? AND google_sub=? AND lock_until<?',lock,now+300000,owner,subject,now);
 if(!acquired.meta?.changes)throw new MailError(409,'sync_in_progress');
 try{
  const state=await row(db,'SELECT * FROM google_mail_sync WHERE owner_id=? AND google_sub=?',owner,subject);
  let ids=reset?[]:pendingIds(state.pending_ids),historyId=reset?null:state.history_id,pageToken=reset?null:state.page_token,targetHistory=reset?null:state.pending_history_id;
  let coverage=state.coverage,deleted=0,resetUsed=false;
  if(!historyId){
   const profile=await googleJson(fetcher,accessToken,'profile');
   if(typeof profile.historyId!=='string'||!/^\d+$/.test(profile.historyId))throw new MailError(502,'invalid_gmail_response');
   const list=await googleJson(fetcher,accessToken,'messages?maxResults=20&q='+encodeURIComponent('{in:inbox in:sent}'));
   ids=[...new Set((list.messages||[]).map(v=>v.id).filter(gmailId))].slice(0,20);historyId=profile.historyId;pageToken=null;targetHistory=null;coverage='recent20_initial_then_incremental';resetUsed=reset;
  }else if(!ids.length){
   let history;
   try{history=await googleJson(fetcher,accessToken,'history?startHistoryId='+encodeURIComponent(historyId)+'&maxResults=20'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''));}
   catch(error){if(error.code==='gmail_not_found'){
    await run(db,'UPDATE google_mail_sync SET history_id=NULL,page_token=NULL,pending_ids=\'[]\',pending_history_id=NULL,coverage=? WHERE owner_id=? AND google_sub=?','history_expired_reset_required',owner,subject);
    throw new MailError(409,'history_expired_retry_sync');
   }throw error;}
   const candidates=new Set(),deletedIds=new Set();
   for(const item of (history.history||[]).slice(0,20)){
    for(const message of item.messages||[])if(gmailId(message.id))candidates.add(message.id);
    for(const type of ['messagesAdded','labelsAdded','labelsRemoved'])for(const change of item[type]||[])if(gmailId(change.message?.id))candidates.add(change.message.id);
    for(const change of item.messagesDeleted||[])if(gmailId(change.message?.id))deletedIds.add(change.message.id);
   }
   if(candidates.size>MAX_PENDING||deletedIds.size>MAX_PENDING)throw new MailError(409,'sync_volume_limit_reset_required');
   for(const id of deletedIds){await run(db,'DELETE FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND gmail_id=?',owner,subject,id);candidates.delete(id);deleted++;}
   ids=[...candidates];pageToken=typeof history.nextPageToken==='string'?history.nextPageToken:null;targetHistory=history.historyId||historyId;
   if(!/^\d+$/.test(targetHistory)||pageToken?.length>2000)throw new MailError(502,'invalid_gmail_response');
  }
  let synced=0;
  for(const id of ids.slice(0,20)){
   try{
    const message=normalizeMessage(await googleJson(fetcher,accessToken,'messages/'+encodeURIComponent(id)+'?format=full'));
    await run(db,'INSERT INTO google_mail_messages(owner_id,google_sub,gmail_id,thread_id,message_date,priority,data,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,google_sub,gmail_id) DO UPDATE SET thread_id=excluded.thread_id,message_date=excluded.message_date,priority=excluded.priority,data=excluded.data,updated_at=excluded.updated_at',owner,subject,message.id,message.threadId,message.dateTimestamp,message.priority,JSON.stringify(message),Date.now());synced++;
   }catch(error){if(error.code==='gmail_not_found'){await run(db,'DELETE FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND gmail_id=?',owner,subject,id);deleted++;}else throw error;}
  }
  const remaining=ids.slice(20);
  if(!remaining.length&&!pageToken&&targetHistory){historyId=targetHistory;targetHistory=null;}
  await run(db,'UPDATE google_mail_sync SET history_id=?,page_token=?,pending_ids=?,pending_history_id=?,last_synced_at=?,coverage=? WHERE owner_id=? AND google_sub=? AND lock_token=?',historyId,pageToken,JSON.stringify(remaining),targetHistory,Date.now(),coverage,owner,subject,lock);
  return {synced,deleted,pendingCount:remaining.length,moreHistory:!!pageToken,coverage,resetUsed,sendingEnabled:false};
 }finally{await run(db,'UPDATE google_mail_sync SET lock_token=NULL,lock_until=0 WHERE owner_id=? AND google_sub=? AND lock_token=?',owner,subject,lock);}
}
export async function handleGoogleMailRequest(request,env,context,fetcher=fetch,accessProvider=getGoogleAccess){
 try{
  const url=new URL(request.url);
  if(!['/api/google/mail/messages','/api/google/mail/sync','/api/google/mail/extract-contact'].includes(url.pathname))return null;
  if(!context?.userId||!['arash','amir'].includes(context.profileId))throw new MailError(403,'workspace_required');
  if(!env.GOOGLE_DB)throw new MailError(503,'google_storage_required');
  const profile=url.searchParams.get('profile');if(profile&&profile!==context.profileId)throw new MailError(403,'profile_access_denied');
  if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)throw new MailError(403,'origin_rejected');
  const access=await accessProvider(env,context.userId,fetcher);
  requireReadScope(access);
  const db=env.GOOGLE_DB,owner=context.userId,subject=access.subject;
  if(!subject||!access.accessToken)throw new MailError(401,'reconnect_required');
  if(request.method==='GET'&&url.pathname==='/api/google/mail/messages'){
   const priority=url.searchParams.get('priority')||'all',q=(url.searchParams.get('q')||'').trim().toLowerCase();
   if(!['all','strong','medium','weak'].includes(priority)||q.length>200)throw new MailError(400,'invalid_filter');
   const limit=Number(url.searchParams.get('limit')||50),offset=Number(url.searchParams.get('offset')||0);
   if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000)throw new MailError(400,'invalid_pagination');
   // Filtering is parameterised and owner+Google identity are mandatory predicates.
   const result=await db.prepare("SELECT data FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND (?='all' OR priority=?) AND (?='' OR instr(lower(data),?)>0) ORDER BY CASE priority WHEN 'strong' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,message_date DESC LIMIT ? OFFSET ?").bind(owner,subject,priority,priority,q,q,limit,offset).all();
   const state=await row(db,'SELECT last_synced_at,coverage,pending_ids,page_token FROM google_mail_sync WHERE owner_id=? AND google_sub=?',owner,subject);
   return json({messages:(result.results||[]).map(r=>JSON.parse(r.data)),sync:{lastSyncedAt:state?.last_synced_at?new Date(state.last_synced_at).toISOString():null,coverage:state?.coverage||'not_synced',pendingCount:pendingIds(state?.pending_ids).length,moreHistory:!!state?.page_token},analysis:'rule_based',sendingEnabled:false,limit,offset});
  }
  if(request.method==='POST'&&url.pathname==='/api/google/mail/sync'){
   const body=await readPayload(request);if(Object.keys(body).some(k=>k!=='reset')||('reset'in body&&typeof body.reset!=='boolean'))throw new MailError(400,'invalid_sync_payload');
   return json(await syncMailbox(db,owner,subject,access.accessToken,fetcher,body.reset===true));
  }
  if(request.method==='POST'&&url.pathname==='/api/google/mail/extract-contact'){
   const body=await readPayload(request);if(!gmailId(body.id))throw new MailError(400,'message_id_required');
   const message=await row(db,'SELECT data FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND gmail_id=?',owner,subject,body.id);
   if(!message)throw new MailError(404,'message_not_found');
   const data=JSON.parse(message.data);return json({messageId:data.id,emails:data.extractedEmails,scope:'private_mailbox_only',shared:false});
  }
  return null;
 }catch(error){const status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:500;const known=/^[a-z_]{3,80}$/.test(error.code||'');return json({error:known?error.code:'mail_request_failed'},status);}
}

/** Derive reply routing only from this account's cached original message. */
export async function getOwnedMailReplyContext(env,userId,body,fetcher=fetch,accessProvider=getGoogleAccess){
 if(!env.GOOGLE_DB)throw new MailError(503,'google_storage_required');
 if(!userId||!body||!gmailId(body.messageId))throw new MailError(400,'message_id_required');
 const access=await accessProvider(env,userId,fetcher);requireReadScope(access);
 const found=await row(env.GOOGLE_DB,'SELECT data FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND gmail_id=?',userId,access.subject,body.messageId);
 if(!found)throw new MailError(404,'message_not_found');
 const message=JSON.parse(found.data);
 if(message.direction==='sent')throw new MailError(400,'cannot_reply_to_outbound_message');
 if(!gmailId(message.threadId))throw new MailError(400,'invalid_reply_thread');
 const addresses=extractEmails(message.replyTo||message.from);
 if(addresses.length!==1)throw new MailError(400,'unambiguous_reply_address_required');
 const to=addresses[0];
 if((body.threadId!==undefined&&body.threadId!==message.threadId)||(body.to!==undefined&&(typeof body.to!=='string'||body.to.trim().toLowerCase()!==to)))throw new MailError(403,'reply_context_mismatch');
 return {messageId:message.id,threadId:message.threadId,to,subject:message.subject,rfcMessageId:message.rfcMessageId||null,googleSubject:access.subject};
}
