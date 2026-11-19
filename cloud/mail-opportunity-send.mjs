// One explicit review freezes one private source-derived application. Reading,
// drafting and Telegram alerts never call this adapter's transport branch.
import {prepareOwnedMailOpportunity} from './mail-opportunities.mjs';
import {handleGoogleSendRequest} from './google-send.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function input(request){
 if(Number(request.headers.get('content-length')||0)>2000)fail('payload_too_large',413);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>2000)fail('payload_too_large',413);
 let value;try{value=JSON.parse(raw);}catch{fail('invalid_payload');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['cvVersionId','recipient','reviewHash','confirmSend','editedDraftId'].includes(key))||!UUID.test(value.cvVersionId||'')||value.recipient!==undefined&&(typeof value.recipient!=='string'||value.recipient.length>320)||value.reviewHash!==undefined&&!/^[a-f0-9]{64}$/.test(value.reviewHash)||value.confirmSend!==undefined&&typeof value.confirmSend!=='boolean'||value.editedDraftId!==undefined&&!/^moedit_[a-f0-9]{32}$/.test(value.editedDraftId))fail('invalid_mail_opportunity_review');
 return value;
}

export async function handleMailOpportunitySendRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url),match=/^\/api\/google\/mail-opportunities\/(mop_[a-f0-9]{32})\/(preview|send)$/.exec(url.pathname);if(!match)return null;
 try{
  if(request.method!=='POST')fail('method_not_allowed',405);
  if(!context?.userId||context.profileId!=='arash'||typeof context.rest!=='function')fail('workspace_required',403);
  if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail('origin_rejected',403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)fail('profile_access_denied',403);
  const selected=await input(request);
  if(match[2]==='send'&&selected.confirmSend!==true)fail('explicit_send_approval_required',409);
  const proposal=await prepareOwnedMailOpportunity(env,context,match[1],{cvVersionId:selected.cvVersionId});
  if(!proposal?.readyForReview) return json({error:'mail_opportunity_evidence_required',missing:proposal?.missing||proposal?.missingFields||[],proposal,sent:false},409);
  if(selected.editedDraftId!==undefined&&selected.editedDraftId!==proposal.editedDraftId||match[2]==='send'&&(selected.editedDraftId||null)!==(proposal.editedDraftId||null))fail('mail_opportunity_edit_context_changed',409);
  const availableRecipients=[...new Set((proposal.recipients||[]).map(item=>typeof item==='string'?item:item?.recipient||item?.value).filter(Boolean))];
  const recipient=(selected.recipient||availableRecipients[0]||'').toLowerCase();
  if(!availableRecipients.includes(recipient))fail('mail_opportunity_recipient_unavailable',409);
  const root=context.rootUserId||context.userId.replace(/:secondary$/,'');
  const cvs=await context.rest('immi_cv_versions','?select=id,text,version&profile_id=eq.arash&user_id=eq.'+encodeURIComponent(root)+'&id=eq.'+selected.cvVersionId);
  if(!cvs?.[0]||typeof cvs[0].text!=='string')fail('owned_cv_required',404);
  const payload={mailOpportunityContext:{id:match[1],recipient,editedDraftId:proposal.editedDraftId||null},subject:proposal.subject,body:proposal.body,cvVersionId:selected.cvVersionId};
  const frozen={...context,rest:async(table,query)=>table==='immi_cv_versions'?[cvs[0]]:context.rest(table,query)};
  const actionRequest=(action,body=payload)=>new Request(url.origin+'/api/google/mail/'+action,{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  let preview=null;
  if(match[2]==='preview'){
   const response=await handleGoogleSendRequest(actionRequest('preview'),env,frozen,fetcher);preview=await response.json();
   if(!response.ok)return json(preview,response.status);
  }
  const identity=await env.GOOGLE_DB.prepare('SELECT google_sub,email,status FROM google_accounts WHERE owner_id=? AND profile_id=?').bind(context.userId,'arash').first();
  if(identity?.status!=='connected'||preview&&identity.email.toLowerCase()!==preview.sender?.toLowerCase())fail('mail_opportunity_account_changed',409);
  const reviewHash=await digest({owner:root,slot:context.userId,googleSubject:identity.google_sub,sender:identity.email.toLowerCase(),id:match[1],recipient,subject:proposal.subject,body:proposal.body,cvVersionId:selected.cvVersionId,cvText:cvs[0].text,cvVersion:cvs[0].version,evidenceHash:proposal.evidenceHash,editedDraftId:proposal.editedDraftId||null});
  const details={...preview,id:match[1],availableRecipients,recipient,mailbox:context.mailbox||'primary',subject:proposal.subject,body:proposal.body,message:{subject:proposal.subject,body:proposal.body},cvVersionId:selected.cvVersionId,editedDraftId:proposal.editedDraftId||null,editRevision:proposal.editRevision||null,reviewHash,readyForReview:preview?.recipients?.length===1,automaticSending:false};
  if(match[2]==='preview')return json({...details,sent:false});
  if(selected.reviewHash!==reviewHash)fail('mail_opportunity_changed_review_required',409);
  // Do not perform another discarded preview during Send. The hash above
  // rechecks the frozen review; queue creation and dispatch each independently
  // validate the owned live Gmail source, sender and suppression controls.
  frozen.expectedGoogleIdentity={subject:identity.google_sub,email:identity.email};
  const queuedResponse=await handleGoogleSendRequest(actionRequest('queue'),env,frozen,fetcher),queued=await queuedResponse.json();
  if(!queuedResponse.ok)return json(queued,queuedResponse.status);
  const queue=queued.items?.[0];if(!queue?.id)fail(queued.excluded?.[0]?.reason||'mail_opportunity_queue_unavailable',409);
  // Reused sent/uncertain records are displayed, never transported again.
  let delivered={items:[queue]};
  if(queue.status==='queued'){
   const dispatched=await handleGoogleSendRequest(actionRequest('dispatch',{ids:[queue.id]}),env,frozen,fetcher);delivered=await dispatched.json();
   if(!dispatched.ok)return json({...delivered,id:match[1],automaticRetry:false},dispatched.status);
  }
  const result=delivered.items?.find(item=>item.id===queue.id),status=result?.status||'delivery_unknown';
  return json({...delivered,id:match[1],recipient,status,sent:status==='sent',automaticRetry:false});
 }catch(error){return json({error:/^[a-z_]{3,80}$/.test(error?.code||error?.message||'')?(error.code||error.message):'mail_opportunity_send_unavailable',automaticRetry:false},Number.isInteger(error?.status)?error.status:503);}
}
