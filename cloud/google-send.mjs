import { getGoogleAccess } from './google-oauth.mjs';
import { createDocx } from './docx.mjs';
import { getOwnedMailReplyContext } from './google-mail.mjs';

const LIMIT = 20, MAX_MIME = 750000;
const encoder = new TextEncoder();
const EMAIL = /^[^\s@<>;,"\\]+@[^\s@<>;,"\\]+\.[^\s@<>;,"\\]+$/;
const CLINIC = /^cl_[a-f0-9]{20}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class SendError extends Error { constructor(status,code) {super(code);this.status=status;this.code=code;} }
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const now=()=>new Date().toISOString();
const mailbox=value=>typeof value==='string'&&EMAIL.test(value.trim())?value.trim().toLowerCase():null;
function b64(bytes){let text='';for(let offset=0;offset<bytes.length;offset+=8192)text+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(text);}
const utf8b64=value=>b64(encoder.encode(value));
const lines=value=>value.match(/.{1,76}/g)?.join('\r\n')||'';
async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
function validText(value,limit){return typeof value==='string'&&value.trim()&&value.length<=limit;}
async function body(request){if(Number(request.headers.get('Content-Length')||0)>100000)throw new SendError(413,'payload_too_large');let value;const raw=await request.text();if(encoder.encode(raw).length>100000)throw new SendError(413,'payload_too_large');try{value=JSON.parse(raw);}catch{throw new SendError(400,'invalid_payload');}if(!value||Array.isArray(value)||typeof value!=='object')throw new SendError(400,'invalid_payload');return value;}
function dbFor(env){if(!env.GOOGLE_DB)throw new SendError(503,'google_storage_not_configured');return env.GOOGLE_DB;}
function stmt(db,sql,...args){return db.prepare(sql).bind(...args);}
async function all(db,sql,...args){return (await stmt(db,sql,...args).all()).results||[];}
function publicItem(row){return {id:row.id,recipient:row.recipient,sender:row.google_email,subject:row.subject,status:row.status,createdAt:row.created_at,attemptedAt:row.attempted_at||null,gmailMessageId:row.gmail_message_id||null,cvVersionId:row.cv_version_id||null,attachmentName:row.attachment_name||null,replyThreadId:row.reply_thread_id||null};}
function validateContext(context){if(!context?.userId||!['arash','amir'].includes(context.profileId)||typeof context.rest!=='function')throw new SendError(403,'workspace_required');}
async function access(env,userId,fetcher){const value=await getGoogleAccess(env,userId,fetcher);if(!mailbox(value.email)||!value.subject||!value.scopes?.includes('https://www.googleapis.com/auth/gmail.send'))throw new SendError(403,'gmail_send_consent_required');return value;}
function encodedSubject(subject){
  const words=[];let part='';
  for(const char of subject){if(encoder.encode(part+char).length>42){words.push('=?UTF-8?B?'+utf8b64(part)+'?=');part='';}part+=char;}
  if(part)words.push('=?UTF-8?B?'+utf8b64(part)+'?=');return words.join('\r\n ');
}
function mime({sender,recipient,subject,text,attachment,messageId,reply}){
  const headers=[`From: ${sender}`,`To: ${recipient}`,`Subject: ${encodedSubject(subject)}`,`Message-ID: <${messageId}@immi-mail.invalid>`,'MIME-Version: 1.0'];
  if(reply)headers.push(`In-Reply-To: ${reply.rfcMessageId}`,`References: ${reply.rfcMessageId}`);
  if(!attachment)return [...headers,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',lines(utf8b64(text)),''].join('\r\n');
  const boundary='immi_'+messageId.replaceAll('-','');
  return [...headers,`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',lines(utf8b64(text)),`--${boundary}`,'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document',`Content-Disposition: attachment; filename="${attachment.name}"`,'Content-Transfer-Encoding: base64','',lines(b64(attachment.bytes)),`--${boundary}--`,''].join('\r\n');
}
async function prepare(env,context,payload,fetcher){
  const allowed=['clinicIds','presetId','subject','body','cvVersionId','replyContext'];
  if(Object.keys(payload).some(key=>!allowed.includes(key)))throw new SendError(400,'unexpected_queue_field');
  const replying=payload.replyContext!==undefined;
  if(replying){
    if(!payload.replyContext||typeof payload.replyContext!=='object'||Array.isArray(payload.replyContext)||Object.keys(payload.replyContext).some(key=>!['messageId','threadId','to'].includes(key))||payload.clinicIds!==undefined||payload.presetId!==undefined)throw new SendError(400,'invalid_reply_context');
  }else if(!Array.isArray(payload.clinicIds)||payload.clinicIds.length<1||payload.clinicIds.length>200||payload.clinicIds.some(id=>typeof id!=='string'||!CLINIC.test(id)))throw new SendError(400,'invalid_clinic_selection');
  const account=await access(env,context.userId,fetcher), db=dbFor(env);
  let reply=null;
  if(replying){
    reply=await getOwnedMailReplyContext(env,context.userId,payload.replyContext,fetcher);
    if(reply.googleSubject!==account.subject)throw new SendError(409,'reply_account_changed');
    if(typeof reply.rfcMessageId!=='string'||reply.rfcMessageId.length>998||!/^<[^<>@\s\x00-\x1f\x7f]+@[^<>@\s\x00-\x1f\x7f]+>$/.test(reply.rfcMessageId))throw new SendError(400,'reply_message_header_required');
    if(!mailbox(reply.to))throw new SendError(400,'invalid_reply_recipient');
  }
  let subject=payload.subject, text=payload.body;
  if(payload.presetId){
    if(!UUID.test(payload.presetId)||payload.subject!==undefined||payload.body!==undefined)throw new SendError(400,'invalid_preset_selection');
    const rows=await context.rest('immi_presets',`?select=data&profile_id=eq.${context.profileId}&id=eq.${payload.presetId}`);
    if(!rows[0])throw new SendError(404,'preset_not_found');
    subject=rows[0].data.subject;text=rows[0].data.body;
  }
  if(!validText(subject,500)||/[\r\n]/.test(subject)||!validText(text,50000))throw new SendError(400,'invalid_mail_content');
  subject=subject.trim();text=text.trim();
  if(reply){
    const normalized=value=>value.replace(/^(?:\s*re\s*:\s*)+/i,'').trim().replace(/\s+/g,' ');
    if(typeof reply.subject!=='string'||normalized(subject)!==normalized(reply.subject))throw new SendError(400,'reply_subject_mismatch');
  }
  let attachment=null,cvHash='';
  if(payload.cvVersionId){
    if(typeof payload.cvVersionId!=='string'||!UUID.test(payload.cvVersionId))throw new SendError(400,'invalid_cv_selection');
    const rows=await context.rest('immi_cv_versions',`?select=text,version&profile_id=eq.${context.profileId}&id=eq.${payload.cvVersionId}`);
    if(!rows[0]||typeof rows[0].text!=='string'||rows[0].text.length>200000)throw new SendError(404,'cv_not_found');
    cvHash=await hash(rows[0].text);attachment={name:`cv-${context.profileId}-v${Number(rows[0].version)||1}.docx`,bytes:createDocx(rows[0].text)};
  }
  let clinics;
  if(reply)clinics=[{id:reply.messageId,data:{email:reply.to}}];
  else{
    const ids=[...new Set(payload.clinicIds)];
    clinics=await context.rest('immi_clinics','?select=id,data&id=in.('+ids.join(',')+')');
    if(clinics.length!==ids.length)throw new SendError(400,'unknown_clinic');
  }
  const recipients=new Map(),excluded=[];
  for(const clinic of clinics){
    const email=mailbox(clinic.data.email);
    if(!email){excluded.push({clinicId:clinic.id,reason:'missing_or_invalid_email'});continue;}
    if(await stmt(db,'SELECT email FROM google_send_suppressions WHERE owner_id=? AND email=?',context.userId,email).first()){excluded.push({clinicId:clinic.id,reason:'suppressed'});continue;}
    if(recipients.has(email))continue;
    const fingerprint=await hash(JSON.stringify({subject,body:text,recipient:email,cvHash,googleSubject:account.subject,googleEmail:account.email.toLowerCase(),...(reply?{reply:{messageId:reply.messageId,threadId:reply.threadId,rfcMessageId:reply.rfcMessageId}}:{})}));
    const existing=await stmt(db,'SELECT * FROM google_send_queue WHERE owner_id=? AND fingerprint=?',context.userId,fingerprint).first();
    const id=existing?.id||crypto.randomUUID();
    const raw=mime({sender:account.email,recipient:email,subject,text,attachment,messageId:id,reply});
    if(encoder.encode(raw).length>MAX_MIME)throw new SendError(413,'mail_too_large');
    recipients.set(email,{id,email,subject,fingerprint,raw,existing,cvVersionId:payload.cvVersionId||null,attachmentName:attachment?.name||null,replyThreadId:reply?.threadId||null});
  }
  const createdDay=now().slice(0,10);
  const reserved=Number((await stmt(db,'SELECT count(*) AS n FROM google_send_queue WHERE owner_id=? AND created_day=?',context.userId,createdDay).first()).n);
  return {account,recipients:[...recipients.values()],excluded,createdDay,reserved};
}
function preview(data){return {sender:data.account.email,recipients:data.recipients.map(item=>({recipient:item.email,subject:item.subject,existingId:item.existing?.id||null,status:item.existing?.status||'preview',cvVersionId:item.cvVersionId,attachmentName:item.attachmentName,replyThreadId:item.replyThreadId})),excluded:data.excluded,dailyLimit:LIMIT,reservedToday:data.reserved,newCount:data.recipients.filter(item=>!item.existing).length,quotaTimezone:'UTC',sendingAutomatic:false};}
async function enqueue(env,context,payload,fetcher){
  const db=dbFor(env),data=await prepare(env,context,payload,fetcher),items=[],excluded=[...data.excluded];
  for(const item of data.recipients){
    if(item.existing){items.push({...publicItem(item.existing),reused:true});continue;}
    // Each conditional insert reserves one daily slot atomically, including concurrent requests.
    const inserted=await stmt(db,`INSERT INTO google_send_queue(id,owner_id,profile_id,google_subject,google_email,fingerprint,recipient,subject,raw_mime,cv_version_id,attachment_name,reply_thread_id,status,created_at,created_day)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'queued',?,? WHERE (SELECT count(*) FROM google_send_queue WHERE owner_id=? AND created_day=?)<?
      ON CONFLICT(owner_id,fingerprint) DO NOTHING RETURNING *`,item.id,context.userId,context.profileId,data.account.subject,data.account.email.toLowerCase(),item.fingerprint,item.email,item.subject,item.raw,item.cvVersionId,item.attachmentName,item.replyThreadId,now(),data.createdDay,context.userId,data.createdDay,LIMIT).first();
    const row=inserted||await stmt(db,'SELECT * FROM google_send_queue WHERE owner_id=? AND fingerprint=?',context.userId,item.fingerprint).first();
    if(row)items.push({...publicItem(row),reused:!inserted});else excluded.push({recipient:item.email,reason:'daily_quota_reached'});
  }
  return {items,excluded,dailyLimit:LIMIT,automaticSending:false};
}
async function dispatch(env,context,payload,fetcher){
  if(Object.keys(payload).some(key=>key!=='ids')||!Array.isArray(payload.ids)||payload.ids.length<1||payload.ids.length>5||payload.ids.some(id=>typeof id!=='string'||!UUID.test(id)))throw new SendError(400,'select_one_to_five_queue_items');
  const db=dbFor(env);let account=await access(env,context.userId,fetcher);const results=[];
  // Verify all supplied IDs before making any external send request.
  const owned=[];
  for(const id of [...new Set(payload.ids)]){const row=await stmt(db,'SELECT * FROM google_send_queue WHERE owner_id=? AND id=?',context.userId,id).first();if(!row)throw new SendError(404,'queue_item_not_found');owned.push(row);}
  for(const row of owned){
    try{account=await access(env,context.userId,fetcher);}catch{results.push({id:row.id,status:'blocked_google_connection'});continue;}
    if(row.google_subject!==account.subject||row.google_email!==account.email.toLowerCase()){results.push({id:row.id,status:'blocked_account_changed'});continue;}
    if(row.status!=='queued'){results.push(publicItem(row));continue;}
    const day=now().slice(0,10),attempted=now();
    const claim=await stmt(db,`UPDATE google_send_queue SET status='sending',attempted_at=?,attempt_day=? WHERE id=? AND owner_id=? AND status='queued' AND google_subject=?
      AND NOT EXISTS(SELECT 1 FROM google_send_suppressions WHERE owner_id=? AND email=google_send_queue.recipient)
      AND (SELECT count(*) FROM google_send_queue WHERE owner_id=? AND attempt_day=?)<? RETURNING *`,attempted,day,row.id,context.userId,account.subject,context.userId,context.userId,day,LIMIT).first();
    if(!claim){results.push({id:row.id,status:'not_claimed',reason:'suppressed_quota_or_concurrent_claim'});continue;}
    let final='delivery_unknown',messageId=null;
    try{
      const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+account.accessToken,'Content-Type':'application/json'},body:JSON.stringify({raw:utf8b64(claim.raw_mime).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''),...(claim.reply_thread_id?{threadId:claim.reply_thread_id}:{})}),signal:AbortSignal.timeout(20000)});
      if(response.ok){let result;try{result=await response.json();}catch{}if(typeof result?.id==='string'&&result.id.length<200){final='sent';messageId=result.id;}}
      // Explicit 4xx rejections are terminal failures. 5xx/timeouts remain ambiguous.
      else if(response.status>=400&&response.status<500)final='failed';
    }catch{/* The server may have accepted the message before the response was lost. Never retry. */}
    try{await stmt(db,"UPDATE google_send_queue SET status=?,gmail_message_id=? WHERE id=? AND owner_id=? AND status='sending'",final,messageId,row.id,context.userId).run();}
    catch{/* Leave 'sending' terminal and non-retryable if acknowledgment persistence failed. */final='delivery_unknown';}
    results.push({id:row.id,status:final,gmailMessageId:messageId});
  }
  return {items:results,automaticSending:false};
}
export async function handleGoogleSendRequest(request,env,context,fetcher=fetch){
  const path=new URL(request.url).pathname;
  if(!['/api/google/mail/queue','/api/google/mail/preview','/api/google/mail/dispatch','/api/google/mail/suppress'].includes(path))return null;
  try{
    validateContext(context);const db=dbFor(env);
    if(request.method==='GET'&&path==='/api/google/mail/queue')return json({items:(await all(db,'SELECT * FROM google_send_queue WHERE owner_id=? ORDER BY created_at DESC LIMIT 200',context.userId)).map(publicItem),automaticSending:false,dailyLimit:LIMIT});
    if(request.method!=='POST')throw new SendError(405,'method_not_allowed');
    const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)throw new SendError(403,'origin_rejected');
    const payload=await body(request);
    if(path==='/api/google/mail/preview')return json(preview(await prepare(env,context,payload,fetcher)));
    if(path==='/api/google/mail/queue')return json(await enqueue(env,context,payload,fetcher),201);
    if(path==='/api/google/mail/dispatch')return json(await dispatch(env,context,payload,fetcher));
    if(Object.keys(payload).some(key=>key!=='email')||!mailbox(payload.email))throw new SendError(400,'valid_suppression_email_required');
    const email=mailbox(payload.email);
    await db.batch([stmt(db,'INSERT INTO google_send_suppressions(owner_id,email,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING',context.userId,email,now()),stmt(db,"UPDATE google_send_queue SET status='suppressed' WHERE owner_id=? AND recipient=? AND status='queued'",context.userId,email)]);
    return json({email,suppressed:true});
  }catch(error){const known=error instanceof SendError;return json({error:known?error.code:'google_mail_unavailable'},known?error.status:(Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:503));}
}
