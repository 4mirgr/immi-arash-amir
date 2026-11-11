// Owner-private preparation. This router never dispatches Gmail messages.
import {googleStatus} from './google-oauth.mjs';
import {googleAccountContext} from './google-account-scope.mjs';
import {handleGoogleSendRequest} from './google-send.mjs';
import {enrichReadPages} from './opportunity-store.mjs';
import {assessFiveTier} from './gp-workflow.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results||[];
const EMAIL=/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/;
const validEmail=value=>typeof value==='string'&&value.length<=254&&EMAIL.test(value)?value.toLowerCase():null;
const opportunityId=value=>typeof value==='string'&&/^opp_[a-f0-9]{32}$/.test(value);
const parse=value=>{try{return JSON.parse(value);}catch{return {};}};
const now=()=>new Date().toISOString();
const defaults={requestedMode:'draft_only',mailbox:'primary',dailyLimit:3};
const view=row=>({id:row.id,opportunityId:row.opportunity_id,recipient:row.recipient,mailbox:row.mailbox,status:row.status,snapshot:parse(row.snapshot_json),queueId:row.queue_id||null,createdAt:row.created_at,updatedAt:row.updated_at,sent:false});
async function body(request){if(Number(request.headers.get('Content-Length')||0)>6000)throw Error('payload_too_large');const raw=await request.text();if(new TextEncoder().encode(raw).length>6000)throw Error('payload_too_large');let value;try{value=JSON.parse(raw);}catch{throw Error('invalid_payload');}if(!value||Array.isArray(value)||typeof value!=='object')throw Error('invalid_payload');return value;}
function keys(value,allowed){if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error('unexpected_field');}
function own(context){if(typeof context?.userId!=='string'||!context.userId||context.userId.includes(':')||!['amir','arash'].includes(context.profileId)||typeof context.rest!=='function')throw Error('workspace_required');return context.userId;}
function settingView(row){return row?{requestedMode:row.requested_mode,mailbox:row.mailbox,dailyLimit:row.daily_limit}:defaults;}
const settings=async(db,owner)=>settingView(await stmt(db,'SELECT * FROM mail_automation_settings WHERE owner_id=?',owner).first());
export async function rootSuppressed(env,rootOwner,email){return Boolean(await stmt(env.GOOGLE_DB,'SELECT email FROM mail_automation_suppressions WHERE owner_id=? AND email=?',rootOwner,String(email).toLowerCase()).first());}
async function blockedByAnyMailbox(env,owner,email){if(await rootSuppressed(env,owner,email))return true;return Boolean(await stmt(env.GOOGLE_DB,'SELECT email FROM google_send_suppressions WHERE owner_id IN (?,?) AND email=?',owner,owner+':secondary',email).first());}
function visible(row,profileId){return row&&(row.country!=='IT'&&row.profile_scope!=='amir'||profileId==='amir');}
const SOURCE_MAX_AGE=72*60*60*1000;
function freshSource(row){const at=Date.parse(row?.last_seen_at);return Number.isFinite(at)&&at<=Date.now()+60000&&Date.now()-at<=SOURCE_MAX_AGE;}
function actionable(row){return freshSource(row)&&!['closed','source_removed','future'].includes(row.status)&&(!row.closing_at||Date.parse(row.closing_at)>Date.now())&&(!row.published_at||Date.parse(row.published_at)<=Date.now());}
export function publishedRecipients(item){const emails=new Set();const text=[item.email,item.contactEmail,item.summary,item.fullText].filter(x=>typeof x==='string').join(' ').slice(0,26000);for(const token of text.split(/\s+/)){if(!token.includes('@')||token.length>512)continue;for(const email of token.match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}/g)||[]){const normalized=validEmail(email);if(normalized)emails.add(normalized);if(emails.size>=20)return [...emails];}}return [...emails];}
async function profileDefaults(context){const suffix='&profile_id=eq.'+context.profileId;const [presetRows,cvRows]=await Promise.all([context.rest('immi_preset_defaults','?select=preset_id'+suffix),context.rest('immi_cv_defaults','?select=version_id'+suffix)]);const presetId=presetRows[0]?.preset_id,cvVersionId=cvRows[0]?.version_id;let preset=null,cv=null;if(presetId)preset=(await context.rest('immi_presets','?select=data&id=eq.'+encodeURIComponent(presetId)+suffix))[0]?.data;if(cvVersionId)cv=(await context.rest('immi_cv_versions','?select=id,version&id=eq.'+encodeURIComponent(cvVersionId)+suffix))[0];return {presetId:preset?String(presetId):null,cvVersionId:cv?String(cvVersionId):null,preset,cv};}
async function event(db,owner,id,action,reason){await stmt(db,'INSERT INTO mail_automation_events(id,owner_id,opportunity_id,action,reason,created_at) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),owner,id,action,reason,now()).run();}
// Suggestions are read-only views over scheduled public discovery plus this owner's
// private suppression/history. A suggestion is never a draft, approval or transport job.
async function recurringSuggestions(env,context,current,cadence){
 const stamp=Date.now(),at=new Date(stamp),owner=context.userId,timeZone='Asia/Tehran';
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(at).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const periodKey=parts.year+'-'+parts.month+'-'+parts.day;
 const localAsUTC=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
 const offset=localAsUTC-Math.floor(stamp/1000)*1000;
 const nextRefreshAt=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day)+1)-offset).toISOString();
 // Daily and weekly are different new-ad windows, not the same evergreen list.
 // Re-observing an old advertisement does not make it newly published.
 const windowStart=new Date(stamp-(cadence==='weekly'?7:1)*86400000).toISOString(),windowEnd=at.toISOString();
 const rows=await all(env.OPPORTUNITY_DB,"SELECT e.*,o.data AS organization_data FROM opportunity_editions e LEFT JOIN opportunity_organizations o ON o.id=e.organization_id WHERE e.country='AU' AND e.profile_scope!='amir' AND e.opportunity_type='job' AND e.trust='official' AND e.status NOT IN ('closed','source_removed','future') AND (e.closing_at IS NULL OR julianday(e.closing_at)>julianday(?)) AND (e.published_at IS NULL OR julianday(e.published_at)<=julianday(?)) AND julianday(e.last_seen_at)>=julianday(?) AND julianday(e.last_seen_at)<=julianday(?) AND julianday(coalesce(e.published_at,e.first_seen_at))>=julianday(?) AND julianday(coalesce(e.published_at,e.first_seen_at))<=julianday(?) AND (instr(lower(e.title),'general practitioner')>0 OR instr(lower(e.title),'general practice')>0 OR instr(lower(e.title),'rural generalist')>0 OR instr(' '||lower(replace(e.title,'-',' '))||' ',' gp ')>0 OR instr(lower(e.title),'medical officer')>0 OR instr(lower(e.title),'medical practitioner')>0) AND instr(lower(e.title),'nurs')=0 AND instr(lower(e.title),'manager')=0 AND instr(lower(e.title),'reception')=0 ORDER BY e.last_seen_at DESC,e.id LIMIT 180",at.toISOString(),at.toISOString(),new Date(stamp-SOURCE_MAX_AGE).toISOString(),new Date(stamp+60000).toISOString(),windowStart,windowEnd);
 const enriched=await enrichReadPages(env.OPPORTUNITY_DB,rows,context.profileId,stamp,env.PUBLIC_PAGE_READING_ENABLED==='true');
 const candidates=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i],item=enriched[i],original=parse(row.data);
  if(!actionable(row)||item.kind==='employment_register'||/\b(?:expression(?:s)? of interest|talent (?:pool|register)|employment register)\b/i.test(item.title||''))continue;
  const assessment=assessFiveTier(item,'pesci_readiness',stamp);if(assessment.tier===1||!assessment.roleRelevant)continue;
  // Only the current ad text supplies recipients. Related-page contact evidence
  // and private uploaded spreadsheets are deliberately not recipients here.
  const recipients=publishedRecipients(item);if(!recipients.length)continue;
  const organization=parse(row.organization_data);let firstParty=false;
  try{const host=new URL(row.url).hostname.replace(/^www\./,'');const domain=String(original.organizationDomain||'').replace(/^www\./,'');firstParty=organization.domainEvidence==='source_provided'&&!!domain&&(host===domain||host.endsWith('.'+domain));}catch{}
  candidates.push({id:row.id,title:row.title,url:row.url,state:row.state,organization:original.organization||null,publishedAt:row.published_at||null,closingAt:row.closing_at||null,lastSeenAt:row.last_seen_at,status:row.status,firstParty,stars:assessment.stars,priorityWeight:assessment.priorityWeight,recipients,contactDiscoveryStatus:item.contactDiscovery?.status||null});
 }
 const addresses=[...new Set(candidates.flatMap(x=>x.recipients))],ids=candidates.map(x=>x.id);
 let suppressed=[],prior=[],prepared=[];
 if(addresses.length){
  [suppressed,prior,prepared]=await Promise.all([
   all(env.GOOGLE_DB,"SELECT email FROM mail_automation_suppressions WHERE owner_id=? AND email IN (SELECT value FROM json_each(?)) UNION SELECT email FROM google_send_suppressions WHERE owner_id IN (?,?) AND email IN (SELECT value FROM json_each(?))",owner,JSON.stringify(addresses),owner,owner+':secondary',JSON.stringify(addresses)),
   all(env.GOOGLE_DB,"SELECT recipient,status,created_at FROM google_send_queue WHERE owner_id IN (?,?) AND recipient IN (SELECT value FROM json_each(?)) AND status IN ('queued','sending','sent','delivery_unknown','failed')",owner,owner+':secondary',JSON.stringify(addresses)),
   all(env.GOOGLE_DB,"SELECT opportunity_id,recipient FROM mail_automation_jobs WHERE owner_id=? AND (opportunity_id IN (SELECT value FROM json_each(?)) OR recipient IN (SELECT value FROM json_each(?))) AND status IN ('draft','preparing','queued')",owner,JSON.stringify(ids),JSON.stringify(addresses))
  ]);
 }
 const blocked=new Set([...suppressed.map(x=>x.email),...prior.map(x=>x.recipient),...prepared.map(x=>x.recipient)].map(x=>String(x).toLowerCase())),preparedIds=new Set(prepared.map(x=>x.opportunity_id));
 const ranked=candidates.filter(x=>!preparedIds.has(x.id)&&x.recipients.every(email=>!blocked.has(email))).sort((a,b)=>b.stars-a.stars||Number(b.firstParty)-Number(a.firstParty)||(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)||a.id.localeCompare(b.id));
 const selected=[],used=new Set();for(const candidate of ranked){if(candidate.recipients.some(email=>used.has(email)))continue;candidate.recipients.forEach(email=>used.add(email));const {recipients,priorityWeight,...view}=candidate;selected.push({...view,publishedRecipientCount:recipients.length,reviewRequired:true});if(selected.length>=current.dailyLimit)break;}
 return {profileId:context.profileId,cadence,periodKey,nextRefreshAt,timeZone,windowStart,windowEnd,publicationFallback:'first_seen_only_when_publication_missing',generatedAt:at.toISOString(),suggestions:selected,availableCount:ranked.length,candidateWindow:rows.length,candidateLimit:180,batchLimit:current.dailyLimit,automaticSending:false,reviewRequired:true,coverage:'bounded_fresh_registered_advertisements_only',refresh:'recomputed_on_read_from_scheduled_discovery',exclusions:['owner_suppression','previous_or_uncertain_delivery_across_both_mailboxes','existing_preparation','closed_future_stale','employment_registers','duplicate_network_recipient'],importedClinicLeadsIncluded:false};
}
export async function handleMailAutomationRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url),base='/api/mail-automation';if(url.pathname!==base&&!url.pathname.startsWith(base+'/'))return null;
 try{
  const owner=own(context);if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)throw Error('profile_access_denied');if(!env.GOOGLE_DB||!env.OPPORTUNITY_DB)throw Error('automation_storage_not_configured');
  if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)throw Error('origin_rejected');
  const db=env.GOOGLE_DB,path=url.pathname.slice(base.length),current=await settings(db,owner);
  if(request.method==='GET'&&path==='/suggestions'){
   if(context.profileId!=='arash')throw Error('profile_access_denied');
   const cadence=url.searchParams.get('cadence')||'daily';if(!['daily','weekly'].includes(cadence))throw Error('invalid_suggestion_cadence');
   return json(await recurringSuggestions(env,context,current,cadence));
  }
  if(request.method==='GET'&&path===''){
   const selected=await profileDefaults(context),mailboxes=[];for(const mailbox of ['primary','secondary']){const state=await googleStatus(env,owner+(mailbox==='secondary'?':secondary':''),context.profileId);mailboxes.push({mailbox,connected:state.connected,email:state.email||null,gmailSend:Boolean(state.capabilities?.gmailSend)});}
   const candidateTime=Date.now(),candidateNow=new Date(candidateTime).toISOString();
   // Restrict Arash's clinical worklist before pagination; university feeds must not crowd it out.
   const arashClinical=context.profileId==='arash'?" AND country='AU' AND opportunity_type='job' AND (instr(lower(title),'general practitioner')>0 OR instr(lower(title),'general practice')>0 OR instr(lower(title),'rural generalist')>0 OR instr(' '||lower(replace(title,'-',' '))||' ',' gp ')>0 OR instr(lower(title),'medical officer')>0 OR instr(lower(title),'medical practitioner')>0) AND instr(lower(title),'nurs')=0 AND instr(lower(title),'manager')=0 AND instr(lower(title),'reception')=0":"";
   const opportunities=await all(env.OPPORTUNITY_DB,"SELECT id,title,country,status,data,closing_at,published_at,profile_scope,last_seen_at FROM opportunity_editions WHERE (country!='IT' OR ?='amir') AND (profile_scope!='amir' OR ?='amir') AND status NOT IN ('closed','source_removed','future') AND (closing_at IS NULL OR julianday(closing_at)>julianday(?)) AND (published_at IS NULL OR julianday(published_at)<=julianday(?)) AND julianday(last_seen_at)>=julianday(?) AND julianday(last_seen_at)<=julianday(?)"+arashClinical+" ORDER BY last_seen_at DESC,id LIMIT 30",context.profileId,context.profileId,candidateNow,candidateNow,new Date(candidateTime-SOURCE_MAX_AGE).toISOString(),new Date(candidateTime+60000).toISOString());
   return json({profileId:context.profileId,settings:{...current,effectiveMode:current.requestedMode==='draft_only'?'draft_only':'approval_required'},defaults:{presetId:selected.presetId,cvVersionId:selected.cvVersionId},mailboxes,opportunities:opportunities.filter(actionable).map(row=>({id:row.id,title:row.title,country:row.country,status:row.status,publishedRecipientCount:publishedRecipients(parse(row.data)).length})),jobs:(await all(db,'SELECT * FROM mail_automation_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 100',owner)).map(view),events:await all(db,'SELECT opportunity_id AS opportunityId,action,reason,created_at AS createdAt FROM mail_automation_events WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',owner),suppressions:await all(db,'SELECT email,reason,created_at AS createdAt FROM mail_automation_suppressions WHERE owner_id=?',owner),readiness:{automaticSending:false,schedulerEnabled:env.MAIL_SCHEDULER_ENABLED==='true',perJobApprovalRequired:true,guards:[env.MAIL_SCHEDULER_ENABLED==='true'?'explicit_per_job_schedule_approval_required':'automatic_transport_not_enabled','source_recipient_content_cv_require_review','root_owner_suppression_and_deduplication','terminal_no_automatic_retries']},limitations:[env.MAIL_SCHEDULER_ENABLED==='true'?'ارسال زمان‌بندی‌شده فقط با تأیید جداگانهٔ همان پیام ثابت فعال می‌شود؛ آماده‌سازی به‌تنهایی ارسال نیست.':'این بخش فقط پیش‌نویس و صف قابل بازبینی می‌سازد؛ زمان‌بندی ارسال فعال نیست.','ترجیح ارسال خودکار ثبت می‌شود، اما حالت مؤثر فعلاً نیازمند تأیید صریح است.','فقط فرصت انتخاب‌شده، قالب و رزومهٔ پیش‌فرض همان مالک استفاده می‌شود.','گیرنده باید یکتا در متن عمومی آگهی باشد و برای صف با بانک مراکز تطبیق دقیق داشته باشد.']});
  }
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  const input=await body(request);
  if(path==='/settings'){
   keys(input,['mode','dailyLimit','mailbox']);const requestedMode=input.mode??current.requestedMode,mailbox=input.mailbox??current.mailbox,dailyLimit=input.dailyLimit??current.dailyLimit;
   if(!['draft_only','approval_required','automatic'].includes(requestedMode)||!['primary','secondary'].includes(mailbox)||!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>3)throw Error('invalid_automation_settings');
   await stmt(db,'INSERT INTO mail_automation_settings(owner_id,requested_mode,mailbox,daily_limit,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET requested_mode=excluded.requested_mode,mailbox=excluded.mailbox,daily_limit=excluded.daily_limit,updated_at=excluded.updated_at',owner,requestedMode,mailbox,dailyLimit,now()).run();return json({requestedMode,effectiveMode:requestedMode==='draft_only'?'draft_only':'approval_required',mailbox,dailyLimit,automaticSending:false});
  }
  if(path==='/suppress'){
   keys(input,['email','reason']);const email=validEmail(input.email);if(!email||input.reason!==undefined&&(typeof input.reason!=='string'||input.reason.length>300))throw Error('invalid_suppression');
   await stmt(db,'INSERT INTO mail_automation_suppressions(owner_id,email,reason,created_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,email) DO UPDATE SET reason=excluded.reason',owner,email,input.reason||'',now()).run();await stmt(db,"UPDATE mail_automation_jobs SET status='suppressed',updated_at=? WHERE owner_id=? AND recipient=? AND status IN ('draft','blocked')",now(),owner,email).run();return json({suppressed:true,email,sent:false});
  }
  if(path==='/run'){
   keys(input,['opportunityIds']);if(!Array.isArray(input.opportunityIds)||input.opportunityIds.length<1||input.opportunityIds.length>3||input.opportunityIds.some(id=>!opportunityId(id)))throw Error('select_one_to_three_opportunities');
   const selected=await profileDefaults(context),results=[];
   for(const id of new Set(input.opportunityIds)){
    const row=await stmt(env.OPPORTUNITY_DB,'SELECT * FROM opportunity_editions WHERE id=?',id).first();let reason=null;const item=parse(row?.data),recipients=publishedRecipients(item);
    if(!visible(row,context.profileId))reason='opportunity_not_available';else if(!freshSource(row))reason='source_observation_stale';else if(!actionable(row))reason='opportunity_closed_or_future';else if(row.trust!=='official')reason='official_source_required';else if(!selected.presetId)reason='default_template_required';else if(!selected.cvVersionId)reason='default_cv_required';else if(!recipients.length)reason='published_recipient_missing';else if(recipients.length!==1)reason='published_recipient_ambiguous';else if(!selected.preset?.subject?.trim()||!selected.preset?.body?.trim()||/[\r\n]/.test(selected.preset.subject)||selected.preset.subject.length>500||selected.preset.body.length>50000)reason='template_content_invalid';else if(/\{\{|\[\[(?:name|clinic|doctor|recipient)/i.test(selected.preset.subject+' '+selected.preset.body))reason='template_placeholders_require_review';else if(await blockedByAnyMailbox(env,owner,recipients[0]))reason='recipient_suppressed';
    if(reason){await event(db,owner,id,'blocked',reason);results.push({opportunityId:id,status:'blocked',reason,sent:false});continue;}
    const existing=await stmt(db,'SELECT * FROM mail_automation_jobs WHERE owner_id=? AND opportunity_id=? AND recipient=? LIMIT 1',owner,id,recipients[0]).first();if(existing){results.push({...view(existing),reused:true});continue;}
    const at=now(),day=at.slice(0,10),jobId=crypto.randomUUID(),snapshot={opportunityId:id,title:row.title,sourceUrl:item.sourceUrl||row.url,url:row.url,closingAt:row.closing_at||null,presetId:selected.presetId,cvVersionId:selected.cvVersionId,cvVersion:Number(selected.cv?.version)||null,subject:selected.preset.subject.trim(),body:selected.preset.body.trim(),recipient:recipients[0],sourceEvidence:'public_advertisement_contact_not_verified_identity',cvEvidence:'owner_selected_default_not_independent_verification'};
    const added=await stmt(db,"INSERT INTO mail_automation_jobs(id,owner_id,opportunity_id,recipient,mailbox,status,snapshot_json,created_at,created_day,updated_at) SELECT ?,?,?,?,?,'draft',?,?,?,? WHERE (SELECT count(*) FROM mail_automation_jobs WHERE owner_id=? AND created_day=?)<? ON CONFLICT DO NOTHING RETURNING *",jobId,owner,id,recipients[0],current.mailbox,JSON.stringify(snapshot),at,day,at,owner,day,current.dailyLimit).first();
    const reused=added||await stmt(db,'SELECT * FROM mail_automation_jobs WHERE owner_id=? AND opportunity_id=? AND recipient=? LIMIT 1',owner,id,recipients[0]).first();if(reused){await event(db,owner,id,'prepared',added?'draft_prepared':'duplicate_reused');results.push({...view(reused),reused:!added});}else{await event(db,owner,id,'blocked','daily_quota_reached');results.push({opportunityId:id,status:'blocked',reason:'daily_quota_reached',sent:false});}
   }
   return json({results,automaticSending:false,quotaTimezone:'UTC'},201);
  }
  const queue=/^\/jobs\/([a-f0-9-]{36})\/queue$/.exec(path);
  if(queue){
   keys(input,['confirmReviewed']);if(input.confirmReviewed!==true)throw Error('explicit_review_required');const job=await stmt(db,'SELECT * FROM mail_automation_jobs WHERE owner_id=? AND id=?',owner,queue[1]).first();if(!job)throw Error('job_not_found');if(job.status==='queued')return json({...view(job),reused:true});if(job.status!=='draft')throw Error('job_requires_review_no_retry');if(await blockedByAnyMailbox(env,owner,job.recipient))throw Error('recipient_suppressed');
   const opportunity=await stmt(env.OPPORTUNITY_DB,'SELECT * FROM opportunity_editions WHERE id=?',job.opportunity_id).first();if(!visible(opportunity,context.profileId))throw Error('opportunity_closed_or_future');if(!freshSource(opportunity))throw Error('source_observation_stale');if(!actionable(opportunity))throw Error('opportunity_closed_or_future');
   const clinics=await context.rest('immi_clinics','?select=id,data&data->>email=eq.'+encodeURIComponent(job.recipient)+'&limit=2');if(!clinics.length||clinics.some(c=>validEmail(c.data?.email)!==job.recipient))throw Error('published_recipient_not_linked_to_clinic');
   const selected=parse(job.snapshot_json),scoped=googleAccountContext(new Request(url.origin+'/api/google/mail/queue?mailbox='+job.mailbox),context);
   const claimed=await stmt(db,"UPDATE mail_automation_jobs SET status='preparing',updated_at=? WHERE owner_id=? AND id=? AND status='draft' RETURNING id",now(),owner,job.id).first();if(!claimed)throw Error('job_requires_review_no_retry');
   let response;try{response=await handleGoogleSendRequest(new Request(url.origin+'/api/google/mail/queue',{method:'POST',headers:{'Content-Type':'application/json',Origin:url.origin},body:JSON.stringify({clinicIds:[clinics[0].id],subject:selected.subject,body:selected.body,cvVersionId:selected.cvVersionId})}),env,scoped,fetcher);const outcome=await response.json(),item=outcome.items?.[0];if(!response.ok||!item||!['queued','sent','sending','delivery_unknown'].includes(item.status))throw Error('queue_preparation_failed');await stmt(db,"UPDATE mail_automation_jobs SET status='queued',queue_id=?,updated_at=? WHERE owner_id=? AND id=?",item.id,now(),owner,job.id).run();await event(db,owner,job.opportunity_id,'queue_prepared','explicit_review_no_send');return json({id:job.id,status:'queued',queueId:item.id,mailbox:job.mailbox,automaticSending:false,sent:false});}catch{await stmt(db,"UPDATE mail_automation_jobs SET status='blocked',updated_at=? WHERE owner_id=? AND id=?",now(),owner,job.id).run();await event(db,owner,job.opportunity_id,'blocked','queue_preparation_failed_no_automatic_retry');throw Error('queue_preparation_failed_no_retry');}
  }
  return json({error:'not_found'},404);
 }catch(error){const code=/^[a-z_]{3,90}$/.test(error.message)?error.message:'automation_request_failed';return json({error:code},['workspace_required','profile_access_denied','origin_rejected'].includes(code)?403:code==='job_not_found'?404:code.endsWith('not_configured')?503:code==='payload_too_large'?413:400);}
}
