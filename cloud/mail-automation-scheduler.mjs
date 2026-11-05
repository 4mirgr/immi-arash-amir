// Only an explicitly authorized frozen job may reach the existing Gmail dispatcher.
import {handleGoogleSendRequest} from './google-send.mjs';
import {publishedRecipients} from './mail-automation.mjs';
import {checkAutomationMembership} from './automation-membership.mjs';
import sourceRegistry from './source-registry.json' with {type:'json'};
import {RURAL_SOURCE_DEFINITIONS} from './rural-source-adapters.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results||[];
const parse=value=>{try{return JSON.parse(value);}catch{return {};}};
const enabled=env=>env.MAIL_SCHEDULER_ENABLED==='true';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const DAY=86400000,WINDOW=1800000,SOURCE_FRESHNESS=72*60*60*1000;
const executableSources=new Set([...sourceRegistry,...RURAL_SOURCE_DEFINITIONS].filter(source=>source.executable&&source.trust==='official').map(source=>source.id));
class SchedulerError extends Error{constructor(code,status=400){super(code);this.status=status;}}
const fail=(code,status)=>{throw new SchedulerError(code,status);};
function identity(context){if(typeof context?.userId!=='string'||!context.userId||context.userId.includes(':')||!['amir','arash'].includes(context.profileId))fail('workspace_required',403);return context.userId;}
function itemView(row){return {id:row.id,jobId:row.job_id,mailbox:row.mailbox,sender:row.sender,recipient:row.recipient,sendAfter:new Date(row.send_after).toISOString(),expiresAt:new Date(row.expires_at).toISOString(),status:row.status,reason:row.reason||null,createdAt:new Date(row.created_at).toISOString(),attemptedAt:row.attempted_at?new Date(row.attempted_at).toISOString():null,authorization:'explicit_frozen_message',automaticRetry:false};}
async function input(request){if(Number(request.headers.get('Content-Length')||0)>3000)fail('payload_too_large',413);const raw=await request.text();if(new TextEncoder().encode(raw).length>3000)fail('payload_too_large',413);let value;try{value=JSON.parse(raw);}catch{fail('invalid_payload');}if(!value||Array.isArray(value)||typeof value!=='object')fail('invalid_payload');return value;}
function keys(value,allowed){if(Object.keys(value).some(k=>!allowed.includes(k)))fail('unexpected_field');}
function scheduleTime(value,now){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))fail('invalid_schedule_time');const [year,month,day]=value.slice(0,10).split('-').map(Number),at=Date.parse(value);if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||!Number.isFinite(at)||at<=now+15000||at>now+DAY-WINDOW)fail('schedule_must_be_within_next_23_5_hours');return at;}
function sourceTimestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
 const calendar=Date.parse(value.slice(0,10)+'T00:00:00Z');if(!Number.isFinite(calendar)||new Date(calendar).toISOString().slice(0,10)!==value.slice(0,10))return NaN;
 return Date.parse(value);
}
function activeSource(row,profile,now){
 const published=row?.published_at==null?null:sourceTimestamp(row.published_at),closing=row?.closing_at==null?null:sourceTimestamp(row.closing_at),seen=sourceTimestamp(row?.last_seen_at);
 return row&&row.trust==='official'&&executableSources.has(row.source_id)&&(!(row.country==='IT'||row.profile_scope==='amir')||profile==='amir')&&!['closed','future','source_removed'].includes(row.status)&&(published===null||Number.isFinite(published)&&published<=now)&&(closing===null||Number.isFinite(closing)&&closing>now)&&Number.isFinite(seen)&&seen<=now&&now-seen<=SOURCE_FRESHNESS;
}
async function recentlyVerifiedSource(env,row,profile){
 const now=Date.now();if(!activeSource(row,profile,now))return false;
 const check=await stmt(env.OPPORTUNITY_DB,'SELECT status,last_success_at FROM registered_source_checks WHERE source_id=?',row.source_id).first();
 return !!check&&['updated','not_modified'].includes(check.status)&&Number.isFinite(check.last_success_at)&&check.last_success_at<=now&&now-check.last_success_at<=SOURCE_FRESHNESS;
}
export async function scheduledQueueDigest(job,queue){const data=JSON.stringify({snapshot:job.snapshot_json,mailbox:job.mailbox,recipient:queue.recipient,subject:queue.subject,rawMime:queue.raw_mime,cvVersionId:queue.cv_version_id,googleSubject:queue.google_subject,sender:queue.google_email,queueId:queue.id});return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function checkJob(env,owner,profileId,jobId,approval=null){
 const db=env.GOOGLE_DB,job=await stmt(db,'SELECT * FROM mail_automation_jobs WHERE owner_id=? AND id=?',owner,jobId).first();if(!job)fail('job_not_found',404);if(job.status!=='queued'||!job.queue_id)fail('reviewed_queue_required',409);if(!['amir','arash'].includes(profileId)||!['primary','secondary'].includes(job.mailbox))fail('mailbox_access_denied',403);
 const selected=parse(job.snapshot_json),scopedOwner=owner+(job.mailbox==='secondary'?':secondary':'');
 const queue=await stmt(db,'SELECT * FROM google_send_queue WHERE owner_id=? AND id=?',scopedOwner,job.queue_id).first();if(!queue||queue.profile_id!==profileId||queue.status!=='queued')fail('queue_not_pending',409);if(!uuid(selected.cvVersionId)||selected.cvVersionId!==queue.cv_version_id||selected.recipient!==queue.recipient||job.recipient!==queue.recipient||selected.subject!==queue.subject)fail('frozen_message_mismatch',409);
 if(await stmt(db,'SELECT email FROM mail_automation_suppressions WHERE owner_id=? AND email=?',owner,queue.recipient).first()||await stmt(db,'SELECT email FROM google_send_suppressions WHERE owner_id IN (?,?) AND email=?',owner,owner+':secondary',queue.recipient).first())fail('recipient_suppressed',409);
 const account=await stmt(db,'SELECT profile_id,google_sub,email,status,scopes_json FROM google_accounts WHERE owner_id=?',scopedOwner).first();if(!account||account.status!=='connected'||account.profile_id!==profileId||account.google_sub!==queue.google_subject||account.email.toLowerCase()!==queue.google_email)fail('sender_connection_changed',409);const scopes=parse(account.scopes_json);if(!Array.isArray(scopes)||!scopes.includes('https://www.googleapis.com/auth/gmail.send'))fail('gmail_send_scope_required',409);
 const source=await stmt(env.OPPORTUNITY_DB,'SELECT * FROM opportunity_editions WHERE id=?',job.opportunity_id).first();if(!await recentlyVerifiedSource(env,source,profileId))fail('source_no_longer_actionable',409);const contacts=publishedRecipients(parse(source.data));if(contacts.length!==1||contacts[0]!==queue.recipient)fail('published_recipient_changed',409);
 const settings=await stmt(db,'SELECT * FROM mail_automation_settings WHERE owner_id=?',owner).first();if(!settings||settings.requested_mode!=='automatic')fail('scheduled_mode_required',409);const dailyLimit=Math.max(1,Math.min(3,settings.daily_limit||3));
 const digest=await scheduledQueueDigest(job,queue);if(approval&&(approval.queue_id!==queue.id||approval.queue_digest!==digest||approval.mailbox!==job.mailbox||approval.google_subject!==account.google_sub||approval.sender!==queue.google_email||approval.recipient!==queue.recipient||approval.cv_version_id!==queue.cv_version_id||approval.consent_version!=='frozen_mail_v1'))fail('approved_message_changed',409);
 return {job,queue,account,digest,scopedOwner,dailyLimit};
}
export async function handleMailSchedulerRequest(request,env,context){
 const url=new URL(request.url),base='/api/mail-automation/scheduler';if(url.pathname!==base&&!url.pathname.startsWith(base+'/'))return null;
 try{
  const owner=identity(context);if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)fail('profile_access_denied',403);if(!env.GOOGLE_DB||!env.OPPORTUNITY_DB)fail('scheduler_storage_not_configured',503);if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail('origin_rejected',403);const db=env.GOOGLE_DB,path=url.pathname.slice(base.length);
  if(path===''&&request.method==='GET')return json({profileId:context.profileId,enabled:enabled(env),approvals:(await all(db,'SELECT * FROM mail_scheduled_approvals WHERE owner_id=? ORDER BY created_at DESC LIMIT 60',owner)).map(itemView),maxPerRun:1,maxDaily:3,validityMinutes:30,automaticRetry:false,notice:'ارسال واقعی فقط برای پیام ثابت و جداگانه تأییدشده، پس از زمان انتخابی و در نوبت بعدی سرور انجام می‌شود. انتخاب حالت خودکار به‌تنهایی اجازهٔ ارسال نیست.'});
  if(request.method!=='POST')fail('method_not_allowed',405);const value=await input(request);
  if(path==='/approve'){
   keys(value,['jobId','sendAfter','confirmSend']);if(!enabled(env))fail('scheduler_not_enabled',503);if(!uuid(value.jobId)||value.confirmSend!==true)fail('explicit_send_approval_required');const at=Date.now(),sendAfter=scheduleTime(value.sendAfter,at),checked=await checkJob(env,owner,context.profileId,value.jobId),id=crypto.randomUUID();
   const result=await stmt(db,"INSERT INTO mail_scheduled_approvals(id,owner_id,profile_id,job_id,queue_id,queue_digest,mailbox,google_subject,sender,recipient,cv_version_id,consent_version,send_after,expires_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'frozen_mail_v1',?,?,'approved',?,?) ON CONFLICT DO NOTHING RETURNING *",id,owner,context.profileId,checked.job.id,checked.queue.id,checked.digest,checked.job.mailbox,checked.account.google_sub,checked.queue.google_email,checked.queue.recipient,checked.queue.cv_version_id,sendAfter,sendAfter+WINDOW,at,at).first();
   if(!result){const prior=await stmt(db,"SELECT * FROM mail_scheduled_approvals WHERE owner_id=? AND job_id=? AND status IN ('approved','sending')",owner,value.jobId).first();if(prior?.status==='approved'&&prior.send_after===sendAfter&&prior.queue_digest===checked.digest)return json({...itemView(prior),reused:true});fail('active_approval_exists_cancel_before_rescheduling',409);}return json({...itemView(result),sent:false},201);
  }
  if(path==='/cancel'){
   keys(value,['approvalId']);if(!uuid(value.approvalId))fail('valid_approval_required');const row=await stmt(db,'SELECT * FROM mail_scheduled_approvals WHERE owner_id=? AND id=?',owner,value.approvalId).first();if(!row)fail('approval_not_found',404);if(row.status==='cancelled')return json(itemView(row));if(row.status!=='approved')fail('approval_already_started_or_terminal',409);const cancelled=await stmt(db,"UPDATE mail_scheduled_approvals SET status='cancelled',updated_at=? WHERE owner_id=? AND id=? AND status='approved' RETURNING *",Date.now(),owner,row.id).first();if(!cancelled)fail('approval_already_started_or_terminal',409);return json(itemView(cancelled));
  }
  fail('not_found',404);
 }catch(error){return json({error:error instanceof SchedulerError?error.message:'scheduler_request_failed'},error instanceof SchedulerError?error.status:500);}
}
export async function dispatchScheduledMail(env,fetcher=fetch){
 if(!enabled(env)||!env.GOOGLE_DB||!env.OPPORTUNITY_DB)return {enabled:false,attempted:0};const db=env.GOOGLE_DB,now=Date.now(),day=new Date(now).toISOString().slice(0,10);
 await stmt(db,"UPDATE mail_scheduled_approvals SET status='expired',reason='approval_window_expired',updated_at=? WHERE status='approved' AND expires_at<=?",now,now).run();
 const row=await stmt(db,"SELECT * FROM mail_scheduled_approvals WHERE status='approved' AND send_after<=? AND expires_at>? ORDER BY send_after,created_at LIMIT 1",now,now).first();if(!row)return {enabled:true,attempted:0};
 let checked;try{const membership=await checkAutomationMembership(env,row.owner_id,row.profile_id,fetcher);if(!membership.active)fail(membership.reason,409);checked=await checkJob(env,row.owner_id,row.profile_id,row.job_id,row);}catch(error){await stmt(db,"UPDATE mail_scheduled_approvals SET status='blocked',reason=?,updated_at=? WHERE id=? AND status='approved'",error instanceof SchedulerError?error.message:'preflight_failed',now,row.id).run();return {enabled:true,attempted:0,blocked:1};}
 const claim=await stmt(db,"UPDATE mail_scheduled_approvals SET status='sending',attempted_at=?,attempt_day=?,updated_at=? WHERE id=? AND status='approved' AND send_after<=? AND expires_at>? AND EXISTS(SELECT 1 FROM mail_automation_settings s WHERE s.owner_id=mail_scheduled_approvals.owner_id AND s.requested_mode='automatic') AND (SELECT count(*) FROM mail_scheduled_approvals p WHERE p.owner_id=mail_scheduled_approvals.owner_id AND p.attempt_day=?)<? RETURNING id",now,day,now,row.id,now,now,day,checked.dailyLimit).first();
 if(!claim){await stmt(db,"UPDATE mail_scheduled_approvals SET status='blocked',reason='daily_scheduled_quota_or_guard',updated_at=? WHERE id=? AND status='approved'",now,row.id).run();return {enabled:true,attempted:0};}
 let status='delivery_unknown',reason='dispatch_outcome_unconfirmed',messageId=null;
 try{
  await checkJob(env,row.owner_id,row.profile_id,row.job_id,row);
  const membership=await checkAutomationMembership(env,row.owner_id,row.profile_id,fetcher);if(!membership.active)fail(membership.reason,409);
  const context={userId:checked.scopedOwner,rootUserId:row.owner_id,profileId:row.profile_id,mailbox:row.mailbox,rest:async()=>{throw Error('scheduled_dispatch_must_not_read_rest');}};
  const result=await handleGoogleSendRequest(new Request('https://scheduled.internal/api/google/mail/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[row.queue_id]})}),env,context,fetcher),data=await result.json(),item=data.items?.find(x=>x.id===row.queue_id);
  if(result.ok&&item){if(['sent','failed','delivery_unknown'].includes(item.status)){status=item.status;reason=item.status==='sent'?'gmail_acknowledged':'terminal_no_automatic_retry';messageId=item.gmailMessageId||null;}else if(item.status==='sending'){status='delivery_unknown';reason='dispatch_outcome_unconfirmed';}else{status='blocked';reason='existing_dispatch_guard_blocked';}}
  else {status='blocked';reason='existing_dispatch_preflight_rejected';}
 }catch(error){if(error instanceof SchedulerError){status='blocked';reason=error.message;}}
 try{await stmt(db,"UPDATE mail_scheduled_approvals SET status=?,reason=?,gmail_message_id=?,updated_at=? WHERE id=? AND status='sending'",status,reason,messageId,Date.now(),row.id).run();}catch{status='delivery_unknown';}
 return {enabled:true,attempted:1,status,automaticRetry:false};
}
