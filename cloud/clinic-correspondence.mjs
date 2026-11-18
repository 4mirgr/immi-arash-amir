// Private correspondence intelligence. A cached application is a contact record,
// never proof of a vacancy, clinical supervision, sponsorship or registration.
// This module drafts only; the existing reviewed sender owns all transport.
import {getGoogleAccess} from './google-oauth.mjs';
import {extractEmails,normalizeMessage} from './google-mail.mjs';
import {getClinicCorrespondenceCoverage} from './google-mail-correspondence-reader.mjs';
import {readGpWritingProfile} from './gp-letter-composer.mjs';

const DAY=86400000, FOLLOW_UP_DELAY=7*DAY, FRESHNESS=DAY, MAX_RESPONSE=1500000;
const ID=/^[a-zA-Z0-9_-]{1,200}$/;
const APPLICATION=/\b(?:application|applying|apply|enquir(?:y|ies)|inquir(?:y|ies)|interested|interest|position|opportunit(?:y|ies)|vacanc(?:y|ies)|curriculum vitae|resume|CV|PESCI)\b/i;
const MEDICAL=/\b(?:general practitioner|general practice|GP|PESCI|AHPRA|RACGP|ACRRM|medical (?:centre|center|practice|officer)|level\s*(?:1|one)\s+supervision)\b/i;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const text=(value,max=32768)=>typeof value==='string'?value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').slice(0,max):'';
const address=value=>extractEmails(text(value,6000));
class CorrespondenceError extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new CorrespondenceError(status,code);};
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
function requireAccess(access){
 if(!access?.subject||!access.accessToken)fail(401,'reconnect_required');
 if(!access.scopes?.some(scope=>['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].includes(scope)))fail(403,'gmail_read_scope_required');
}
function timestamp(message){const value=Number(message?.dateTimestamp)||Date.parse(message?.date)||0;return Number.isFinite(value)&&value>0?value:0;}
function visible(message){return message&&!message.labels?.some(label=>['SPAM','TRASH','DRAFT'].includes(label));}

// Keep only the newly written reply. Quoted applications must never become an
// employer's offer, and a quoted refusal is not a new refusal by this sender.
export function correspondenceReplyText(value){
 const lines=text(value).split(/\r?\n/),kept=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim();
  if(/^>/.test(line))continue;
  if(/^-{2,}\s*(?:original|forwarded) message\s*-*/i.test(line)||/^begin forwarded message:/i.test(line))break;
  if(/^on\b/i.test(line)&&lines.slice(i,i+4).some(part=>/\bwrote:\s*$/i.test(part)))break;
  if(/^from:\s+\S/i.test(line)&&lines.slice(i+1,i+5).some(next=>/^(?:sent|date|to|subject):/i.test(next.trim())))break;
  if(/^(?:--\s*$|sent from my (?:iphone|ipad|android)|kind regards[,!]?\s*$|best regards[,!]?\s*$|regards[,!]?\s*$)/i.test(line))break;
  kept.push(line);
 }
 return kept.join('\n').trim();
}
function recipients(message,ownEmail){
 const own=String(ownEmail||'').toLowerCase();
 return [...new Set(address([message?.to,message?.cc,message?.bcc].filter(Boolean).join('\n')).filter(email=>email!==own))];
}
function application(message){return visible(message)&&message.direction==='sent'&&APPLICATION.test(text(message.subject,1000)+'\n'+text(message.plainBody||message.snippet))&&MEDICAL.test(text(message.subject,1000)+'\n'+text(message.plainBody||message.snippet));}
function labelFor(message,email){
 const raw=text(message?.to,2000),match=raw.match(/^\s*"?([^<>"\r\n]{2,150})"?\s*<([^<>]+)>\s*$/);
 return match&&match[2].trim().toLowerCase()===email?match[1].trim():email;
}
function clauses(value){return correspondenceReplyText(value).split(/(?:[.!?;]\s+|\n+|\bbut\b|\bhowever\b|\band\s+(?=(?:we\s+)?(?:cannot|do\s+not|don't|no|not|unable)\b))/i).map(part=>part.trim()).filter(Boolean);}
function supportSignal(messages,topic){
 const topicPattern=topic==='level1'?/\b(?:level|tier)\s*(?:1|one)\s+(?:clinical\s+)?supervision\b|\bsupervision\s+(?:at\s+)?(?:level|tier)\s*(?:1|one)\b/i:topic==='sponsorship'?/\b(?:visa\s+|employer[- ]sponsored\s+|work\s+visa\s+)?sponsor(?:ship|ing|ed)?\b/i:/\bPESCI\b/i;
 let positive=null,negative=null;
 for(const message of messages.filter(item=>item.direction!=='sent').sort((a,b)=>timestamp(b)-timestamp(a))){
  const statements=clauses(message.plainBody||message.snippet).filter(clause=>!/[?]/.test(clause)&&!/\b(?:if|unless|hypothetical|example)\b/i.test(clause));
  for(const clause of statements.flatMap(statement=>statement.split(/,\s+/))){
   if(!topicPattern.test(clause))continue;
   // These idioms are not refusals and are not affirmative commitments either.
   if(/\b(?:no objection|(?:do not|don't|cannot|can't) rule out|not only)\b/i.test(clause))continue;
   if(/\b(?:no|not|cannot|can't|unable|unavailable|neither|don't|do not|won't|will not)\b/i.test(clause))negative??=clause;
   // A question, eligibility requirement or applicant quotation is not support.
   else if(!/[?]/.test(clause)&&/\b(?:we|our practice|our clinic|the practice|the clinic)\b.{0,65}\b(?:can|could|offer|offers|provide|provides|support|supports|able|available|willing)\b|\b(?:supervision|sponsorship)\s+(?:is|would be)\s+available\b/i.test(clause))positive??=clause;
  }
 }
 return {status:negative?'negative':positive?'positive':'unknown',excerpt:text(negative||positive,500)||null,verified:false,basis:'employer_message_requires_review'};
}
function stopReason(message){
 if(message.direction==='sent')return null;
 const value=correspondenceReplyText(message.plainBody||message.snippet),from=text(message.from,2000),subject=text(message.subject,1000);
 if(/\b(?:do not|don't|please stop|stop)\s+(?:contact(?:ing)?|email(?:ing)?|writ(?:e|ing)|send(?:ing)?\s+(?:me|us))\b|\bremove\s+(?:me|us)\s+from\b/i.test(value))return 'do_not_contact';
 if(/(?:mailer-daemon|postmaster)@/i.test(from)||/\b(?:delivery (?:status notification|failure|failed)|undeliverable|message not delivered|returned mail|mail delivery subsystem)\b/i.test(subject+'\n'+value))return 'bounced';
 if(/\b(?:application\s+(?:was |is |has been )?(?:unsuccessful|declined|rejected)|not\s+(?:currently\s+)?(?:recruiting|hiring)|no\s+(?:current\s+)?(?:vacancies|positions)|(?:cannot|can't|unable to|not able to|do not|don't)\s+(?:currently\s+)?(?:offer|provide|support|sponsor|consider|proceed)|(?:cannot|can't|unable to)\s+issue\s+(?:an?\s+)?offer|not\s+in\s+a\s+position\s+to\s+offer|(?:will not|won't)\s+(?:be\s+)?(?:proceed|progress|consider)|not\s+(?:a\s+)?suitable)\b/i.test(value))return 'rejected';
 return null;
}
function replyStatus(message){
 const stop=stopReason(message);if(stop)return stop;
 const value=correspondenceReplyText(message.plainBody||message.snippet);
 if(/\b(?:out of (?:the )?office|on (?:annual|parental|medical) leave|away from (?:the )?office|automatic reply|auto[- ]?reply)\b/i.test(text(message.subject,1000)+'\n'+value))return 'out_of_office';
 const affirmative=clauses(value).filter(clause=>!/[?]/.test(clause)&&!/^\s*(?:if|unless|once|when|should we|in case)\b/i.test(clause)&&!/\b(?:no|not|cannot|can't|unable|neither|don't|do not|won't|will not|hypothetical|example)\b/i.test(clause)).join('\n');
 if(/\b(?:we (?:would like to|are pleased to) offer you|please find (?:attached|enclosed).{0,50}(?:offer of employment|employment contract|formal (?:job |employment )?offer))\b/i.test(affirmative))return 'offer_mentioned';
 if(/\b(?:we (?:would like to|would be happy to|can|could)\s+(?:arrange|schedule|invite)|invite you\s+(?:to|for)|please\s+(?:confirm|choose|advise).{0,45}(?:time|availability))\b.{0,100}\b(?:interview|meeting|call|discuss)|\b(?:interview|meeting|call)\b.{0,80}\b(?:please confirm|availability|available|schedule)\b/i.test(affirmative))return 'interview';
 if(/\b(?:please (?:send|provide|forward|attach)|could you (?:send|provide|forward)|we (?:need|require))\b.{0,100}\b(?:CV|resume|curriculum vitae|certificate|documents?|registration|references?|qualifications?)\b/i.test(affirmative))return 'documents_requested';
 if(/\b(?:application (?:has been |was |is )?received|received your (?:application|CV|resume|email|enquiry)|thank you for (?:your application|applying|your interest|your email|contacting))\b/i.test(affirmative))return 'acknowledgement';
 return 'reply_received';
}
const nextAction=status=>({waiting:'follow_up_when_due',acknowledgement:'read_acknowledgement',out_of_office:'check_return_date',documents_requested:'prepare_requested_documents',interview:'arrange_interview',offer_mentioned:'review_offer_and_requirements',rejected:'stop_and_review_reason',bounced:'verify_published_contact',do_not_contact:'do_not_contact',reply_received:'read_and_respond'}[status]||'review_thread');

const stopSeverity=reason=>({rejected:1,bounced:2,do_not_contact:3}[reason]||0);
function contactStopReceipts(messages){
 const sent=messages.filter(message=>visible(message)&&message.direction==='sent'),threadRecipients=new Map(),knownRecipients=new Set(),stopped=new Map();
 for(const message of sent){if(!threadRecipients.has(message.threadId))threadRecipients.set(message.threadId,new Set());for(const email of recipients(message,'')){threadRecipients.get(message.threadId).add(email);knownRecipients.add(email);}}
 for(const message of messages.filter(visible)){
  const reason=stopReason(message);if(!reason)continue;
  const inThread=threadRecipients.get(message.threadId)||new Set(),directKnown=address(message.replyTo||message.from).filter(email=>knownRecipients.has(email));
  // A reply to an old multi-clinic To/CC message belongs to its actual sender,
  // not to every other clinic that happened to share that historical thread.
  const emails=new Set(directKnown.length?directKnown:inThread.size===1?[...inThread]:[]);
  // An explicit professional request to stop contact must not be forgotten
  // merely because its older Sent anchor has not reached the archive cursor.
  if(reason==='do_not_contact'&&MEDICAL.test(text(message.subject,1000)+'\n'+correspondenceReplyText(message.plainBody||message.snippet))){
   const direct=address(message.replyTo||message.from);if(direct.length===1)emails.add(direct[0]);
  }
  for(const email of emails){const previous=stopped.get(email);if(!previous||stopSeverity(reason)>stopSeverity(previous.reason))stopped.set(email,{recipient:email,reason,gmail_id:message.id,thread_id:message.threadId});}
 }
 return stopped;
}
function applyRecipientGuards(cases,messages,{complete=true,stops=[]}={}){
 const sent=messages.filter(message=>visible(message)&&message.direction==='sent'),latest=new Map(),counts=new Map(),stopped=contactStopReceipts(messages);
 for(const receipt of stops){const previous=stopped.get(receipt.recipient);if(!previous||stopSeverity(receipt.reason)>stopSeverity(previous.reason))stopped.set(receipt.recipient,receipt);}
 for(const message of sent){
  const values=recipients(message,''),date=timestamp(message);counts.set(message.threadId,(counts.get(message.threadId)||0)+1);
  for(const email of values){const previous=latest.get(email);if(!previous||date>previous.date)latest.set(email,{date,threadId:message.threadId,ambiguous:false});else if(date===previous.date&&message.threadId!==previous.threadId)previous.ambiguous=true;}
 }
 for(const item of cases){
  const last=latest.get(item.recipient),stop=stopped.get(item.recipient)?.reason;
  let reason=null;
  if(!complete)reason='contact_history_limit';
  else if(stop)reason='contact_stopped_'+stop;
  else if(last&&(last.ambiguous||last.threadId!==item.threadId))reason='newer_application_exists';
  else if((counts.get(item.threadId)||0)>=2)reason='follow_up_limit';
  if(reason){if(!item.followUp.reason.startsWith('stopped_'))item.followUp={...item.followUp,eligible:false,reason};if(stop){item.contactStop=stop;item.nextAction=nextAction(stop);}}
 }
 return cases;
}

export function deriveClinicCorrespondence(messages,{ownEmail='',now=Date.now(),threadCoverage=[]}={}){
 const groups=new Map(),coverage=new Map(threadCoverage.map(item=>[item.thread_id,item]));
 for(const message of messages.filter(visible)){
  if(!ID.test(message?.id||'')||!ID.test(message?.threadId||''))continue;
  if(!groups.has(message.threadId))groups.set(message.threadId,[]);
  groups.get(message.threadId).push(message);
 }
 const cases=[];
 for(const [threadId,thread]of groups){
  thread.sort((a,b)=>timestamp(a)-timestamp(b)||a.id.localeCompare(b.id));
  const applications=thread.filter(application);if(!applications.length)continue;
  const sent=thread.filter(item=>item.direction==='sent'),lastSent=sent.at(-1),initial=applications[0],received=thread.filter(item=>item.direction!=='sent'),lastReceived=received.at(-1);
  const recipientSet=new Set(sent.flatMap(message=>recipients(message,ownEmail))),recipient=recipientSet.size===1?[...recipientSet][0]:null;
  const receivedAfter=received.filter(message=>timestamp(message)>=timestamp(lastSent));
  const hardStop=received.map(stopReason).find(Boolean),status=hardStop|| (receivedAfter.length?replyStatus(receivedAfter.at(-1)):'waiting');
  const ledger=coverage.get(threadId),complete=Number(ledger?.complete)===1,fresh=complete&&Number(ledger.last_checked_at)>0&&now-Number(ledger.last_checked_at)<=FRESHNESS&&Number(ledger.last_checked_at)<=now+60000;
  const dueAt=timestamp(lastSent)?timestamp(lastSent)+FOLLOW_UP_DELAY:null;
  const reason=!recipient?'ambiguous_recipients':hardStop?'stopped_'+hardStop:receivedAfter.length?'reply_received':!complete?'thread_reading_incomplete':!fresh?'thread_refresh_required':!dueAt?'message_date_required':dueAt>now?'not_due':'due';
  const level1=supportSignal(received,'level1');
  const clinicLabel=recipient?labelFor(initial,recipient):text(initial.subject,150);
  const replyMessage=lastReceived?{...lastReceived,plainBody:correspondenceReplyText(lastReceived.plainBody||lastReceived.snippet)}:null;
  cases.push({id:threadId,threadId,clinicLabel,name:clinicLabel,recipient,recipients:[...recipientSet],subject:text(initial.subject,500),status,nextAction:nextAction(status),updatedAt:timestamp(thread.at(-1))||null,lastSentAt:timestamp(lastSent)||null,lastReceivedAt:lastReceived?timestamp(lastReceived)||null:null,outboundMessageCount:sent.length,
   signals:{level1,supervision:level1,sponsorship:supportSignal(received,'sponsorship'),pesci:supportSignal(received,'pesci')},
   threadComplete:complete,threadCheckedAt:Number(ledger?.last_checked_at)||null,
   followUp:{eligible:reason==='due',dueAt,reason,messageId:lastSent.id,reviewRequired:true},replyMessage,
   timeline:thread.slice(-40).map(message=>({id:message.id,direction:message.direction,date:message.date||null,dateTimestamp:timestamp(message),from:text(message.from,2000),to:text(message.to,2000),subject:text(message.subject,500),excerpt:text(correspondenceReplyText(message.plainBody||message.snippet),2000),snippet:text(correspondenceReplyText(message.plainBody||message.snippet),2000)})),
   timelineLimited:thread.length>40,assessment:'rule_based_review_required',automaticSending:false});
 }
 return applyRecipientGuards(cases,messages).sort((a,b)=>Number(b.followUp.eligible)-Number(a.followUp.eligible)||b.updatedAt-a.updatedAt);
}

async function recipientHistory(db,owner,subject){
 // Project only small headers for the broad index; loading thousands of full
 // bodies would exceed a free Worker's memory. Negative candidates retain their
 // original text so quoted/forwarded statements are checked by the same rules.
 const sent=await all(db,"SELECT gmail_id id,thread_id threadId,message_date dateTimestamp,json_extract(data,'$.to') AS recipient_to,json_extract(data,'$.cc') AS cc,json_extract(data,'$.bcc') AS bcc,json_extract(data,'$.labels') AS labels FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND json_extract(data,'$.direction')='sent' ORDER BY message_date DESC LIMIT 5001",owner,subject);
 const negative=await all(db,"SELECT data FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND json_extract(data,'$.direction')<>'sent' AND (instr(lower(data),'not')>0 OR instr(lower(data),'no ')>0 OR instr(lower(data),'cannot')>0 OR instr(lower(data),'unable')>0 OR instr(lower(data),'stop')>0 OR instr(lower(data),'undeliver')>0 OR instr(lower(data),'mailer-daemon')>0 OR instr(lower(data),'postmaster')>0 OR instr(lower(data),'delivery fail')>0 OR instr(lower(data),'returned mail')>0 OR instr(lower(data),'remove')>0 OR instr(lower(data),'don''t')>0 OR instr(lower(data),'won''t')>0) ORDER BY message_date DESC LIMIT 201",owner,subject);
 const messages=sent.slice(0,5000).map(message=>({...message,to:message.recipient_to,direction:'sent',labels:JSON.parse(message.labels||'[]')}));
 for(const row of negative.slice(0,200)){try{messages.push(JSON.parse(row.data));}catch{return {complete:false,messages,stops:[]};}}
 // This additive table is a required sender guard. A missing migration throws
 // and blocks follow-up rather than assuming that no historical stop exists.
 // A no-contact request belongs to the application owner, including the two
 // independently authorized own mailboxes and later grant replacements. Only
 // these minimal stop codes cross that person's slots; raw mail stays pinned
 // to the selected Google subject above.
 const root=owner.endsWith(':secondary')?owner.slice(0,-10):owner;
 if(!root||root.includes(':'))fail(403,'mailbox_owner_mismatch');
 const stops=await all(db,'SELECT recipient,reason FROM clinic_correspondence_stops WHERE owner_id IN (?,?) LIMIT 5001',root,root+':secondary');
 return {complete:sent.length<=5000&&negative.length<=200&&stops.length<=5000,messages,stops:stops.slice(0,5000)};
}

/** Record bounded minimal stop receipts before raw cache expiry. Never clears a stop. */
export async function recordClinicCorrespondenceStops(env,context,options={}){
 if(!env.GOOGLE_DB)fail(503,'google_storage_required');
 if(!context?.userId||!['arash','amir'].includes(context.profileId))fail(403,'workspace_required');
 const account=await first(env.GOOGLE_DB,'SELECT google_sub,status FROM google_accounts WHERE owner_id=? AND profile_id=?',context.userId,context.profileId);
 if(!account)return {recorded:0,status:'not_connected'};
 if(account.status!=='connected')return {recorded:0,status:'reconnect_required'};
 const history=await recipientHistory(env.GOOGLE_DB,context.userId,account.google_sub),existing=new Map(history.stops.map(row=>[row.recipient,row]));
 const batch=Array.isArray(options.messages)?options.messages.slice(0,8):[];
 const receipts=[...contactStopReceipts([...history.messages,...batch]).values()].filter(receipt=>!existing.has(receipt.recipient)||stopSeverity(receipt.reason)>stopSeverity(existing.get(receipt.recipient).reason));
 const selected=receipts.slice(0,10),now=Date.now();
 if(selected.length){
  const args=selected.flatMap(receipt=>[context.userId,account.google_sub,receipt.recipient,receipt.reason,receipt.gmail_id,receipt.thread_id,now]);
  await env.GOOGLE_DB.prepare('INSERT INTO clinic_correspondence_stops(owner_id,google_sub,recipient,reason,gmail_id,thread_id,recorded_at) VALUES '+selected.map(()=>'(?,?,?,?,?,?,?)').join(',')+' ON CONFLICT(owner_id,google_sub,recipient) DO UPDATE SET reason=excluded.reason,gmail_id=excluded.gmail_id,thread_id=excluded.thread_id,recorded_at=excluded.recorded_at WHERE CASE excluded.reason WHEN \'do_not_contact\' THEN 3 WHEN \'bounced\' THEN 2 ELSE 1 END > CASE clinic_correspondence_stops.reason WHEN \'do_not_contact\' THEN 3 WHEN \'bounced\' THEN 2 ELSE 1 END').bind(...args).run();
 }
 // An explicit request to stop contacting also applies to new applications,
 // across both of this person's sender slots. Repair this independently of new
 // receipts, so a previous partial failure cannot silently reopen transport.
 const root=context.rootUserId||context.userId.replace(/:secondary$/,'');
 await env.GOOGLE_DB.prepare("INSERT INTO mail_automation_suppressions(owner_id,email,reason,created_at) SELECT ?,s.recipient,'gmail_do_not_contact',? FROM clinic_correspondence_stops s WHERE s.owner_id IN (?,?) AND s.reason='do_not_contact' AND NOT EXISTS(SELECT 1 FROM mail_automation_suppressions m WHERE m.owner_id=? AND m.email=s.recipient) LIMIT 10 ON CONFLICT(owner_id,email) DO NOTHING").bind(root,new Date(now).toISOString(),root,root+':secondary',root).run();
 return {recorded:selected.length,more:receipts.length>selected.length,complete:history.complete,status:history.complete?'recorded':'history_limit_requires_review'};
}

/** Preserve each just-read stop before advancing the full-mailbox cursor. */
export async function recordClinicCorrespondenceBatchStops(env,context,identity,messages=[]){
 if(!env.GOOGLE_DB||!context?.userId||context.profileId!=='arash'||!ID.test(identity?.subject||'')||!Array.isArray(messages)||messages.length>8)fail(403,'workspace_required');
 const root=context.rootUserId||context.userId.replace(/:secondary$/,'');
 if(context.userId!==root&&context.userId!==root+':secondary')fail(403,'mailbox_owner_mismatch');
 const ids=[...new Set(messages.map(message=>message?.threadId).filter(value=>ID.test(value||'')))];
 let sent=[];
 if(ids.length)sent=(await all(env.GOOGLE_DB,"SELECT data FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND thread_id IN (SELECT value FROM json_each(?)) AND json_extract(data,'$.direction')='sent' LIMIT 200",context.userId,identity.subject,JSON.stringify(ids))).flatMap(row=>{try{return [JSON.parse(row.data)];}catch{return [];}});
 const receipts=contactStopReceipts([...sent,...messages]);
 // A medical recruitment refusal can arrive before its older Sent anchor.
 // Its exact sender is enough to stop reminders, never to establish a vacancy.
 for(const message of messages.filter(visible)){
  const reason=stopReason(message),content=text(message.subject,1000)+'\n'+correspondenceReplyText(message.plainBody||message.snippet),direct=address(message.replyTo||message.from);
  if(reason&&reason!=='bounced'&&MEDICAL.test(content)&&direct.length===1){const prior=receipts.get(direct[0]);if(!prior||stopSeverity(reason)>stopSeverity(prior.reason))receipts.set(direct[0],{recipient:direct[0],reason,gmail_id:message.id,thread_id:message.threadId});}
 }
 const selected=[...receipts.values()],now=Date.now();
 if(selected.length>200)fail(409,'contact_stop_batch_requires_review');
 if(selected.length)await env.GOOGLE_DB.prepare("INSERT INTO clinic_correspondence_stops(owner_id,google_sub,recipient,reason,gmail_id,thread_id,recorded_at) SELECT ?,?,json_extract(value,'$.recipient'),json_extract(value,'$.reason'),json_extract(value,'$.gmail_id'),json_extract(value,'$.thread_id'),? FROM json_each(?) WHERE true ON CONFLICT(owner_id,google_sub,recipient) DO UPDATE SET reason=excluded.reason,gmail_id=excluded.gmail_id,thread_id=excluded.thread_id,recorded_at=excluded.recorded_at WHERE CASE excluded.reason WHEN 'do_not_contact' THEN 3 WHEN 'bounced' THEN 2 ELSE 1 END > CASE clinic_correspondence_stops.reason WHEN 'do_not_contact' THEN 3 WHEN 'bounced' THEN 2 ELSE 1 END").bind(context.userId,identity.subject,now,JSON.stringify(selected)).run();
 const noContact=selected.filter(receipt=>receipt.reason==='do_not_contact').map(receipt=>receipt.recipient),stamp=new Date(now).toISOString();
 await env.GOOGLE_DB.prepare("INSERT INTO mail_automation_suppressions(owner_id,email,reason,created_at) SELECT ?,value,'gmail_do_not_contact',? FROM json_each(?) WHERE true UNION SELECT ?,s.recipient,'gmail_do_not_contact',? FROM (SELECT recipient FROM clinic_correspondence_stops WHERE owner_id IN (?,?) AND reason='do_not_contact' AND NOT EXISTS(SELECT 1 FROM mail_automation_suppressions m WHERE m.owner_id=? AND m.email=clinic_correspondence_stops.recipient) LIMIT 10) s WHERE true ON CONFLICT DO NOTHING").bind(root,stamp,JSON.stringify(noContact),root,stamp,root,root+':secondary',root).run();
 return {recorded:selected.length};
}

async function safeProviderJson(response){
 if(Number(response.headers.get('content-length')||0)>MAX_RESPONSE){await response.body?.cancel();fail(502,'gmail_response_too_large');}
 const reader=response.body?.getReader();let value='';
 if(reader){let bytes=0;const decoder=new TextDecoder();while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>MAX_RESPONSE){await reader.cancel();fail(502,'gmail_response_too_large');}value+=decoder.decode(next.value,{stream:true});}value+=decoder.decode();}else value=await response.text();
 try{return JSON.parse(value);}catch{fail(502,'invalid_gmail_response');}
}
async function providerRead(env,userId,path,fetcher,accessProvider,recovery){
 const read=async()=>{try{return await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+recovery.access.accessToken},redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{fail(502,'gmail_unavailable');}};
 let response=await read();
 if(response.status===401&&!recovery.refreshed){
  await response.body?.cancel();recovery.refreshed=true;
  const renewed=await accessProvider(env,userId,fetcher,{forceRefresh:true,rejectedAccessToken:recovery.access.accessToken});requireAccess(renewed);
  if(renewed.subject!==recovery.access.subject||renewed.email?.toLowerCase()!==recovery.access.email?.toLowerCase())fail(409,'connection_changed');
  recovery.access=renewed;response=await read();
 }
 if(response.redirected||response.status>=300&&response.status<400){await response.body?.cancel();fail(502,'gmail_redirect_rejected');}
 if(!response.ok){await response.body?.cancel();fail(response.status===404?404:response.status===401?401:response.status===403?403:response.status===429?429:502,response.status===404?'message_not_found':response.status===401?'reconnect_required':response.status===403?'gmail_scope_or_api_required':response.status===429?'gmail_rate_limited':'gmail_unavailable');}
 return safeProviderJson(response);
}
async function freshThread(env,userId,threadId,fetcher,accessProvider,recovery){
 const raw=await providerRead(env,userId,'threads/'+encodeURIComponent(threadId)+'?format=full',fetcher,accessProvider,recovery);
 if(raw.id!==threadId||!Array.isArray(raw.messages)||raw.messages.length>200)fail(409,'thread_manual_review_required');
 return raw.messages.map(normalizeMessage);
}

// Called again by the explicit sender. Draft-time checking alone is not a
// transport guard: a reply can arrive while the user is reviewing a draft.
export async function getOwnedClinicFollowUpContext(env,userId,body,fetcher=fetch,accessProvider=getGoogleAccess){
 if(!env.GOOGLE_DB)fail(503,'google_storage_required');
 if(!userId||!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['messageId','threadId','to'].includes(key))||!ID.test(body.messageId||'')||!ID.test(body.threadId||'')||typeof body.to!=='string'||address(body.to).length!==1||address(body.to)[0]!==body.to.trim().toLowerCase())fail(400,'invalid_follow_up_context');
 const access=await accessProvider(env,userId,fetcher);requireAccess(access);
 const row=await first(env.GOOGLE_DB,'SELECT data FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND gmail_id=?',userId,access.subject,body.messageId);
 if(!row)fail(404,'message_not_found');
 let cached;try{cached=JSON.parse(row.data);}catch{fail(409,'message_cache_invalid');}
 if(cached.threadId!==body.threadId||!application(cached)||recipients(cached,access.email).length!==1||recipients(cached,access.email)[0]!==body.to.toLowerCase())fail(403,'follow_up_context_mismatch');
 const recovery={access,refreshed:false},messages=await freshThread(env,userId,body.threadId,fetcher,accessProvider,recovery),now=Date.now();
 const found=messages.find(message=>message.id===body.messageId);
 if(!found||found.threadId!==body.threadId||found.direction!=='sent')fail(409,'follow_up_context_changed');
 const cases=deriveClinicCorrespondence(messages,{ownEmail:access.email,now,threadCoverage:[{thread_id:body.threadId,complete:1,last_checked_at:now}]}),item=cases.find(value=>value.id===body.threadId);
 if(!item||item.recipient!==body.to.trim().toLowerCase()||item.followUp.messageId!==body.messageId)fail(409,'follow_up_context_changed');
 if(!item.followUp.eligible)fail(409,'follow_up_'+item.followUp.reason);
 const history=await recipientHistory(env.GOOGLE_DB,userId,access.subject);applyRecipientGuards([item],history.messages,history);
 if(!item.followUp.eligible)fail(409,'follow_up_'+item.followUp.reason);
 // Replies and delivery failures sometimes arrive in a new Gmail thread. A
 // fresh thread check alone cannot clear them. Any recent matching mail needs
 // human review; these read-only searches never infer that no reply ever exists.
 const after=Math.max(0,Math.floor(timestamp(found)/1000)-1),exclusions=' -in:sent -in:drafts -in:spam -in:trash';
 for(const query of ['after:'+after+' from:"'+item.recipient+'"'+exclusions,'after:'+after+' {from:mailer-daemon from:postmaster} "'+item.recipient+'"'+exclusions]){
  const result=await providerRead(env,userId,'messages?maxResults=1&q='+encodeURIComponent(query),fetcher,accessProvider,recovery);
  if(result.messages!==undefined&&(!Array.isArray(result.messages)||result.messages.some(message=>!ID.test(message?.id||''))))fail(502,'invalid_gmail_response');
  if(result.messages?.length)fail(409,'follow_up_new_correspondence_requires_review');
 }
 if(!/^<[^<>\s@\x00-\x1f\x7f]+@[^<>\s@\x00-\x1f\x7f]+>$/.test(found.rfcMessageId||''))fail(409,'reply_message_header_required');
 return {messageId:found.id,threadId:found.threadId,to:item.recipient,subject:'Re: '+text(found.subject,495).replace(/^(?:\s*re\s*:\s*)+/i,'').trim(),rfcMessageId:found.rfcMessageId,googleSubject:access.subject};
}

async function payload(request){
 if(Number(request.headers.get('content-length')||0)>2000)fail(413,'payload_too_large');
 const raw=await request.text();if(new TextEncoder().encode(raw).length>2000)fail(413,'payload_too_large');
 let value;try{value=JSON.parse(raw);}catch{fail(400,'invalid_payload');}
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>key!=='threadId')||!ID.test(value.threadId||''))fail(400,'invalid_thread_selection');
 return value;
}
async function ledgerRows(db,owner,subject,ids){
 const exists=await first(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='google_mail_correspondence_threads'");
 if(!exists||!ids.length)return [];
 return all(db,'SELECT thread_id,complete,last_checked_at FROM google_mail_correspondence_threads WHERE owner_id=? AND google_sub=? AND thread_id IN ('+ids.map(()=>'?').join(',')+')',owner,subject,...ids);
}
async function ownedDraftProfile(context){
 if(typeof context.rest!=='function')fail(409,'follow_up_signature_required');
 const root=context.rootUserId||context.userId.replace(/:secondary$/,''),profiles=await context.rest('immi_profiles','?select=data&profile_id=eq.'+encodeURIComponent(context.profileId)+'&user_id=eq.'+encodeURIComponent(root));
 const writing=readGpWritingProfile(profiles?.[0]?.data||{});if(!writing.signatureStatus.complete)fail(409,'follow_up_signature_required');return writing;
}
function followUpBody(item,writing,context){
 const date=new Date(item.lastSentAt).toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
 const clinic=item.clinicLabel!==item.recipient?item.clinicLabel:'your practice';
 const requirement=context.profileId==='arash'?'I would particularly appreciate your guidance on whether your practice could consider an overseas GP requiring appropriate Level 1 clinical supervision and employer-sponsored work visa arrangements. If there may be a suitable position, I would welcome clarification of the proposed supervision and the information needed to assess the position-specific PESCI and registration requirements.':'If a suitable position is available, I would appreciate your guidance on the next steps and any further information needed to assess my application.';
 return 'Dear Practice Manager,\n\nI am following up on my email of '+date+' regarding a GP position with '+clinic+'. I would be grateful to know whether you have had an opportunity to review my application.\n\n'+requirement+'\n\nPlease let me know a convenient time to discuss how I can support your practice.\n\nKind regards,\n'+writing.signatureName+'\nPhone: '+writing.signaturePhone+'\nEmail: '+writing.signatureEmail;
}

export async function handleClinicCorrespondenceRequest(request,env,context,fetcher=fetch,accessProvider=getGoogleAccess){
 const url=new URL(request.url),path=url.pathname;
 if(!['/api/google/clinic-correspondence','/api/google/clinic-correspondence/draft'].includes(path))return null;
 try{
  if(!context?.userId||!['arash','amir'].includes(context.profileId))fail(403,'workspace_required');
  if(!env.GOOGLE_DB)fail(503,'google_storage_required');
  const requested=url.searchParams.get('profile');if(requested&&requested!==context.profileId)fail(403,'profile_access_denied');
  if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail(403,'origin_rejected');
  const access=await accessProvider(env,context.userId,fetcher);requireAccess(access);
  const db=env.GOOGLE_DB,owner=context.userId,subject=access.subject;
  if(request.method==='GET'&&path==='/api/google/clinic-correspondence'){
   const limit=Number(url.searchParams.get('limit')||25),offset=Number(url.searchParams.get('offset')||0);
   if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>10000)fail(400,'invalid_pagination');
   const threadRows=await all(db,"SELECT thread_id,max(message_date) latest FROM google_mail_messages WHERE owner_id=? AND google_sub=? GROUP BY thread_id HAVING sum(CASE WHEN json_extract(data,'$.direction')='sent' THEN 1 ELSE 0 END)>0 ORDER BY latest DESC LIMIT ? OFFSET ?",owner,subject,limit+1,offset);
   const hasMore=threadRows.length>limit,ids=threadRows.slice(0,limit).map(row=>row.thread_id);
   const rows=ids.length?await all(db,'SELECT data FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND thread_id IN ('+ids.map(()=>'?').join(',')+') ORDER BY message_date DESC LIMIT 501',owner,subject,...ids):[];
   const messages=rows.slice(0,500).flatMap(row=>{try{return [JSON.parse(row.data)];}catch{return [];}});
   const ledger=await ledgerRows(db,owner,subject,ids),items=deriveClinicCorrespondence(messages,{ownEmail:access.email,threadCoverage:rows.length>500?[]:ledger});
   const history=await recipientHistory(db,owner,subject);applyRecipientGuards(items,history.messages,history);
   const coverage=await getClinicCorrespondenceCoverage(env,context);
   const activityTable=await first(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='google_mail_correspondence_activity'");
   const activityRow=activityTable?await first(db,'SELECT status,code,checked_at FROM google_mail_correspondence_activity WHERE owner_id=? AND google_sub=?',owner,subject):null;
   const safeCode=value=>typeof value==='string'&&/^[a-z_]{3,80}$/.test(value)?value:null;
   const activity=activityRow?{status:safeCode(activityRow.status)||'unknown',code:safeCode(activityRow.code),checkedAt:Number(activityRow.checked_at)||null}:null;
   return json({items,coverage:{...coverage,activity,loadedMessages:messages.length,windowLimit:500,contactHistoryComplete:history.complete,limited:hasMore||rows.length>500||!history.complete},hasMore,nextOffset:hasMore?offset+limit:null,mailbox:context.mailbox||'primary',automaticSending:false});
  }
  if(request.method==='POST'&&path==='/api/google/clinic-correspondence/draft'){
   const selection=await payload(request),rows=await all(db,'SELECT data FROM google_mail_messages WHERE owner_id=? AND google_sub=? AND thread_id=? ORDER BY message_date DESC LIMIT 201',owner,subject,selection.threadId);
   if(!rows.length)fail(404,'message_not_found');if(rows.length>200)fail(409,'thread_manual_review_required');
   const messages=rows.map(row=>JSON.parse(row.data)),ledger=await ledgerRows(db,owner,subject,[selection.threadId]),item=deriveClinicCorrespondence(messages,{ownEmail:access.email,threadCoverage:ledger})[0];
   if(!item)fail(409,'clinic_application_required');
   if(!item.followUp.eligible)fail(409,'follow_up_'+item.followUp.reason);
   const followUpContext={messageId:item.followUp.messageId,threadId:item.threadId,to:item.recipient};
   const verified=await getOwnedClinicFollowUpContext(env,owner,followUpContext,fetcher,accessProvider),writing=await ownedDraftProfile(context);
   return json({kind:'follow_up',subject:verified.subject,body:followUpBody(item,writing,context),recipient:verified.to,threadId:verified.threadId,replyContext:null,followUpContext,reviewRequired:true,automaticSending:false});
  }
  return json({error:'method_not_allowed'},405);
 }catch(error){return json({error:error.code||'clinic_correspondence_unavailable'},error.status||503);}
}
