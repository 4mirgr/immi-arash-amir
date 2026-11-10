// Same-owner, in-memory orchestration over the existing source-bound mail API.
// No aggregate send endpoint, local-storage approval or transport retry exists.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const OPP=/^opp_[a-f0-9]{32}$/;
const brands=new WeakMap(),consumed=new WeakSet(),MAX=20;
const email=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validEmail=value=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)&&value.length<=254;
const fail=code=>{throw Error(code);};
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function active(check){if(check()!==true)fail('batch_context_changed');}
function checkPerson(person){if(!['arash','amir'].includes(person))fail('workspace_required');}
const path=(person,id,action)=>'opportunities/'+encodeURIComponent(id)+'/mail/'+action+'?profile='+encodeURIComponent(person);
const mailboxPath=(person,mailbox,action)=>'google/'+action+'?profile='+encodeURIComponent(person)+'&mailbox='+mailbox;
const payload=entry=>({presetId:entry.plan.presetId,cvVersionId:entry.plan.cvVersionId,mailbox:entry.plan.mailbox,recipient:entry.recipient,...(entry.plan.application?{application:entry.plan.application}:{})});
function reason(error){return typeof error?.message==='string'&&/^[a-z][a-z0-9_]{2,100}$/.test(error.message)?error.message:'recipient_request_failed';}
function planValue(input){
 if(!input||!OPP.test(input.opportunityId||'')||!UUID.test(input.presetId||'')||!UUID.test(input.cvVersionId||'')||!['primary','secondary'].includes(input.mailbox||'primary')||!Array.isArray(input.recipients)||input.recipients.length>500)fail('invalid_recipient_batch_plan');
 return clone({opportunityId:input.opportunityId,presetId:input.presetId,cvVersionId:input.cvVersionId,mailbox:input.mailbox||'primary',recipients:input.recipients,...(input.application?{application:input.application}:{})});
}
function checkedPreview(preview,plan,recipient){
 if(!preview||preview.opportunityId!==plan.opportunityId||preview.mailbox!==plan.mailbox||preview.presetId!==plan.presetId||preview.cvVersionId!==plan.cvVersionId||!validEmail(email(preview.sender))||!preview.reviewHash||typeof preview.reviewHash!=='string'||!preview.message||typeof preview.message.subject!=='string'||typeof preview.message.body!=='string'||!preview.message.subject.trim()||!preview.message.body.trim())fail('application_changed_review_required');
 if(preview.excluded?.length)fail(preview.excluded[0]?.reason==='suppressed'?'recipient_suppressed':'recipient_unavailable');
 const rows=preview.recipients;
 if(!Array.isArray(rows)||rows.length!==1||email(rows[0].recipient)!==recipient||rows[0].cvVersionId!==plan.cvVersionId||rows[0].subject!==preview.message.subject||typeof rows[0].attachmentName!=='string'||!rows[0].attachmentName)fail('application_changed_review_required');
 const queuedExisting=typeof rows[0].existingId==='string'&&!!rows[0].existingId&&rows[0].status==='queued';
 if(!queuedExisting&&(rows[0].existingId||rows[0].status!=='preview'))fail('previous_application_exists');
 return {queuedExisting,fingerprint:JSON.stringify({sender:email(preview.sender),message:preview.message,attachment:rows[0].attachmentName,cv:plan.cvVersionId,preset:plan.presetId,mailbox:plan.mailbox,url:preview.url,lastSeenAt:preview.lastSeenAt,reading:preview.reading}),row:rows[0]};
}
export async function prepareRecipientBatch({api,person,plans,isActive=()=>true}){
 checkPerson(person);if(typeof api!=='function'||!Array.isArray(plans)||plans.length>25)fail('invalid_recipient_batch_plan');active(isActive);
 const entries=[],blocked=[],duplicates=[],seen=new Set(),capacity=new Map(),used=new Map();let previewRequests=0,totalSelected=0;
 for(const input of plans){
  active(isActive);const plan=planValue(input),targets=[],localSeen=new Set();
  for(const value of plan.recipients){const recipient=email(value);totalSelected++;
   if(!validEmail(recipient)){blocked.push({opportunityId:plan.opportunityId,recipient,reason:'invalid_recipient'});continue;}
   const key=plan.mailbox+':'+recipient;if(seen.has(key)||localSeen.has(key)){duplicates.push({opportunityId:plan.opportunityId,recipient,reason:'duplicate_recipient'});continue;}localSeen.add(key);targets.push(recipient);
  }
  let fingerprint=null,invalidPlan=false;const current=[];
  for(const recipient of targets){
   if(previewRequests>=MAX){blocked.push({opportunityId:plan.opportunityId,recipient,reason:'batch_limit_reached'});continue;}
   active(isActive);previewRequests++;
   const entry={id:plan.opportunityId+':'+plan.mailbox+':'+recipient,plan,...payload({plan,recipient}),opportunityId:plan.opportunityId,recipient};
   try{
    const preview=await api(path(person,plan.opportunityId,'preview'),{method:'POST',body:JSON.stringify(payload(entry))});active(isActive);
    const checked=checkedPreview(preview,plan,recipient);
    if(fingerprint!==null&&fingerprint!==checked.fingerprint){invalidPlan=true;continue;}fingerprint=checked.fingerprint;
    const remaining=Number.isFinite(preview.dailyLimit)&&Number.isFinite(preview.reservedToday)?Math.max(0,preview.dailyLimit-preview.reservedToday):MAX;
    capacity.set(plan.mailbox,Math.min(capacity.get(plan.mailbox)??MAX,remaining));
    current.push({...entry,sender:email(preview.sender),queuedExisting:checked.queuedExisting,preview:clone(preview)});
   }catch(error){if(isActive()!==true)throw error;blocked.push({opportunityId:plan.opportunityId,recipient,reason:reason(error),message:error?.message});if(reason(error)==='application_changed_review_required')invalidPlan=true;}
  }
  if(invalidPlan){for(const recipient of targets){const prior=blocked.find(item=>item.opportunityId===plan.opportunityId&&item.recipient===recipient);if(prior){prior.reason='application_changed_review_required';delete prior.message;}else blocked.push({opportunityId:plan.opportunityId,recipient,reason:'application_changed_review_required'});}continue;}
  for(const entry of current){const count=used.get(plan.mailbox)||0;if(!entry.queuedExisting&&count>=(capacity.get(plan.mailbox)??MAX))blocked.push({opportunityId:plan.opportunityId,recipient:entry.recipient,reason:'daily_quota_reached'});else{entries.push(freeze(entry));seen.add(plan.mailbox+':'+entry.recipient);if(!entry.queuedExisting)used.set(plan.mailbox,count+1);}}
 }
 const finalEntries=[],finalUsed=new Map();for(const entry of entries){const count=finalUsed.get(entry.plan.mailbox)||0;if(!entry.queuedExisting&&count>=(capacity.get(entry.plan.mailbox)??MAX))blocked.push({opportunityId:entry.plan.opportunityId,recipient:entry.recipient,reason:'daily_quota_reached'});else{finalEntries.push(entry);if(!entry.queuedExisting)finalUsed.set(entry.plan.mailbox,count+1);}}
 const prepared=freeze({person,entries:finalEntries,blocked,duplicates,totalSelected,previewRequests,limit:MAX,ready:finalEntries.length>0});brands.set(prepared,{person});return prepared;
}
function reviewed(prepared,person,confirmReviewed){
 checkPerson(person);if(!brands.has(prepared)||brands.get(prepared).person!==person)fail('batch_review_not_available');if(confirmReviewed!==true)fail('explicit_review_required');if(consumed.has(prepared))fail('batch_already_consumed');if(!prepared.entries.length)fail('batch_review_not_available');
}
async function checkedAccount(api,person,entry,isActive){active(isActive);const result=await api(mailboxPath(person,entry.plan.mailbox,'status'));active(isActive);if(!result?.connected||result.capabilities?.gmailSend!==true||email(result.email)!==entry.sender)fail('sender_connection_changed');}
function queuedItem(response,entry){
 const rows=response?.items,item=Array.isArray(rows)&&rows.length===1?rows[0]:null;
 if(!item||response.opportunityId!==entry.plan.opportunityId||response.mailbox!==entry.plan.mailbox||response.excluded?.length||typeof item.id!=='string'||!item.id||email(item.recipient)!==entry.recipient||email(item.sender)!==entry.sender||item.cvVersionId!==entry.plan.cvVersionId||item.subject!==entry.preview.message.subject||item.attachmentName!==entry.preview.recipients[0].attachmentName)fail('application_changed_review_required');return item;
}
function resultFor(entry,values){return {id:entry.id,opportunityId:entry.plan.opportunityId,mailbox:entry.plan.mailbox,recipient:entry.recipient,...values};}
function finish(results,stopped,entries=[]){if(stopped)for(const entry of entries)if(!results.some(result=>result.id===entry.id))results.push(resultFor(entry,{status:'not_attempted',reason:'batch_stopped'}));return {results,items:results,stopped,unknown:results.some(item=>['delivery_unknown','queue_unknown','schedule_unknown'].includes(item.status))};}
function report(results,entry,values,onProgress,isActive){const result=resultFor(entry,values);results.push(result);if(isActive()===true){try{onProgress(result,[...results]);}catch{/* A UI callback cannot cause transport replay. */}}return result;}
function uncertain(error){return !Number.isInteger(error?.status)||error.status>=500||[408,429].includes(error.status);}
export async function sendRecipientBatch({api,person,prepared,isActive=()=>true,onProgress=()=>{},confirmReviewed=false,queueOnly=false}){
 reviewed(prepared,person,confirmReviewed);active(isActive);consumed.add(prepared);const results=[];
 for(const entry of prepared.entries){let stage='preflight',queueId=null;
  if(entry.queuedExisting){if(isActive()!==true)return finish(results,true,prepared.entries);report(results,entry,{status:'reused',queueId:entry.preview.recipients[0].existingId,previousStatus:'queued',reason:'existing_queue_item'},onProgress,isActive);continue;}
  try{
   await checkedAccount(api,person,entry,isActive);active(isActive);stage='queue';
   const response=await api(path(person,entry.plan.opportunityId,'queue'),{method:'POST',body:JSON.stringify({...payload(entry),confirmReviewed:true,reviewHash:entry.preview.reviewHash})});
   active(isActive);const item=queuedItem(response,entry);queueId=item.id;
   if(item.reused!==false||item.status!=='queued'){report(results,entry,{status:'reused',queueId,previousStatus:item.status,reason:'existing_queue_item'},onProgress,isActive);continue;}
   if(queueOnly){report(results,entry,{status:'queued',queueId},onProgress,isActive);continue;}
   stage='pre_dispatch';await checkedAccount(api,person,entry,isActive);active(isActive);stage='dispatch';
   const delivery=await api(mailboxPath(person,entry.plan.mailbox,'mail/dispatch'),{method:'POST',body:JSON.stringify({ids:[queueId]})});active(isActive);
   const sent=delivery?.items?.length===1&&delivery.items[0].id===queueId?delivery.items[0]:null;
   if(!sent||sent.recipient&&email(sent.recipient)!==entry.recipient||sent.sender&&email(sent.sender)!==entry.sender)fail('dispatch_outcome_unconfirmed');
   if(sent.status==='sent'){report(results,entry,{status:'sent',queueId,gmailMessageId:sent.gmailMessageId||null},onProgress,isActive);continue;}
   const status=['sending','delivery_unknown'].includes(sent.status)?'delivery_unknown':'failed';report(results,entry,{status,queueId,reason:sent.reason||sent.status||'dispatch_outcome_unconfirmed'},onProgress,isActive);return finish(results,true,prepared.entries);
  }catch(error){
   if(isActive()!==true){report(results,entry,{status:stage==='dispatch'?'delivery_unknown':'cancelled',queueId,reason:'batch_context_changed'},onProgress,isActive);return finish(results,true,prepared.entries);}
   const status=stage==='dispatch'?'delivery_unknown':stage==='queue'&&uncertain(error)?'queue_unknown':'failed';report(results,entry,{status,queueId,reason:reason(error)},onProgress,isActive);return finish(results,true,prepared.entries);
  }
 }
 return finish(results,false);
}
export async function scheduleRecipientBatch({api,person,prepared,isActive=()=>true,onProgress=()=>{},confirmReviewed=false,confirmSend=false,sendAfter,sendAfterISO}){
 reviewed(prepared,person,confirmReviewed);if(confirmSend!==true)fail('explicit_send_approval_required');if(prepared.entries.length>3)fail('schedule_recipient_limit_reached');
 if(sendAfter===undefined)sendAfter=sendAfterISO;else if(sendAfterISO!==undefined&&Date.parse(sendAfterISO)!==Date.parse(sendAfter))fail('invalid_schedule_time');
 const instant=Date.parse(sendAfter);if(typeof sendAfter!=='string'||!Number.isFinite(instant)||instant<=Date.now()+15000||instant>Date.now()+23.5*3600000)fail('schedule_must_be_within_next_23_5_hours');
 active(isActive);consumed.add(prepared);const results=[];
 for(const entry of prepared.entries){let submitted=false;
  try{
   await checkedAccount(api,person,entry,isActive);active(isActive);submitted=true;
   const response=await api(path(person,entry.plan.opportunityId,'schedule'),{method:'POST',body:JSON.stringify({...payload(entry),confirmReviewed:true,reviewHash:entry.preview.reviewHash,confirmSend:true,sendAfter})});active(isActive);
   const item=queuedItem(response,entry),approval=response.approval;
   if(!approval?.id||!['approved','sending'].includes(approval.status)||approval.queueId!==item.id||approval.mailbox!==entry.plan.mailbox||approval.opportunityId!==entry.plan.opportunityId||email(approval.sender)!==entry.sender||email(approval.recipient)!==entry.recipient||approval.cvVersionId!==entry.plan.cvVersionId||Date.parse(approval.sendAfter)!==instant||approval.message?.subject!==entry.preview.message.subject||approval.message?.body!==entry.preview.message.body)fail('schedule_outcome_unconfirmed');
   report(results,entry,{status:approval.status==='sending'?'sending':'scheduled',queueId:item.id,approval:clone(approval)},onProgress,isActive);
  }catch(error){if(isActive()!==true){report(results,entry,{status:submitted?'schedule_unknown':'cancelled',reason:'batch_context_changed'},onProgress,isActive);return finish(results,true,prepared.entries);}report(results,entry,{status:submitted?'schedule_unknown':'failed',reason:reason(error)},onProgress,isActive);return finish(results,true,prepared.entries);}
 }
 return finish(results,false);
}
