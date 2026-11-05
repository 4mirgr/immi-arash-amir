// Explicit source-bound applications. Reuse the existing owner-isolated Gmail queue;
// this router never dispatches transport or publishes a private contact.
import {getGpApplicationPackage} from './gp-application-package.mjs';
import {handleGoogleSendRequest} from './google-send.mjs';
import {googleAccountContext} from './google-account-scope.mjs';
import {enrichReadPages} from './opportunity-store.mjs';
import {publishedRecipients} from './mail-automation.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function fail(code,status=400){throw Object.assign(Error(code),{status});}
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');}
function condition(row,profile){
 if(!row||(row.country==='IT'||row.profile_scope==='amir')&&profile!=='amir')fail('opportunity_not_available',404);
 if(!['open','unknown'].includes(row.status)||row.closing_at&&!(Date.parse(row.closing_at)>Date.now())||row.published_at&&!(Date.parse(row.published_at)<=Date.now()))fail('opportunity_closed_or_future',409);
 const at=Date.parse(row.last_seen_at);if(!Number.isFinite(at)||at>Date.now()+60000||Date.now()-at>72*3600000)fail('source_observation_stale',409);
}
export async function handleOpportunityMailRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url),match=/^\/api\/opportunities\/(opp_[a-f0-9]{32})\/mail(?:\/(preview|queue))?$/.exec(url.pathname);if(!match)return null;
 try{
  if(typeof context?.userId!=='string'||!context.userId||context.userId.includes(':')||!['amir','arash'].includes(context.profileId)||typeof context.rest!=='function')fail('workspace_required',403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)fail('profile_access_denied',403);
  if(!env.OPPORTUNITY_DB||!env.GOOGLE_DB)fail('opportunity_mail_storage_missing',503);
  const row=await env.OPPORTUNITY_DB.prepare('SELECT * FROM opportunity_editions WHERE id=?').bind(match[1]).first();
  condition(row,context.profileId);let source=JSON.parse(row.data);
  if(env.PUBLIC_PAGE_READING_ENABLED==='true'){
   try{const [enriched]=await enrichReadPages(env.OPPORTUNITY_DB,[row],context.profileId,Date.now(),true);
    if(['read','read_partial'].includes(enriched?.reading?.status))source={...source,fullText:enriched.fullText,reading:enriched.reading,contactEvidence:enriched.contactEvidence||[]};
   }catch{/* Missing reading storage never manufactures a recipient. */}
  }
  const recipientDetails=(source.contactEvidence||[]).filter(contact=>contact.type==='email'&&['same_page','linked_page'].includes(contact.sourceRelation)&&['application','organization_general','unknown'].includes(contact.contactRole)&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(contact.value)).map(contact=>({...contact,value:contact.value.toLowerCase()}));
  const recipients=[...new Set([...publishedRecipients(source),...recipientDetails.map(contact=>contact.value)])];
  const sourceView={opportunityId:row.id,title:row.title,url:row.url,trust:row.trust,lastSeenAt:row.last_seen_at,recipientEvidence:'public_source_contact_not_verified_identity',recipientDetails};
  const reading=source.reading?{status:source.reading.status,readAt:source.reading.readAt}:null;
  if(request.method==='GET'&&!match[2])return json({...sourceView,reading,publishedRecipients:recipients,blockedReason:recipients.length?null:'published_recipient_missing',automaticSending:false});
  if(request.method!=='POST'||!match[2])fail('method_not_allowed',405);
  if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail('origin_rejected',403);
  if(Number(request.headers.get('Content-Length')||0)>10000)fail('payload_too_large',413);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>10000)fail('payload_too_large',413);
  let input;try{input=JSON.parse(raw);}catch{fail('invalid_payload');}
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!['presetId','cvVersionId','mailbox','recipient','confirmReviewed','reviewHash','application'].includes(k)))fail('unexpected_opportunity_mail_field');
  if(!UUID.test(input.presetId||'')||!UUID.test(input.cvVersionId||''))fail('preset_and_cv_required');
  if(!recipients.length)fail('published_recipient_missing',409);
  if(typeof input.recipient!=='string'||!recipients.includes(input.recipient.toLowerCase()))fail('recipient_not_published',409);
  const recipient=input.recipient.toLowerCase(),mailbox=input.mailbox||'primary';
  if(!['primary','secondary'].includes(mailbox))fail('invalid_mailbox');
  const scoped=googleAccountContext(new Request(url.origin+'/api/google/mail/preview?mailbox='+mailbox),context);
  const suffix='&profile_id=eq.'+context.profileId;
  const [presets,cvs]=await Promise.all([context.rest('immi_presets','?select=data&id=eq.'+input.presetId+suffix),context.rest('immi_cv_versions','?select=text,version&id=eq.'+input.cvVersionId+suffix)]);
  let preset=presets[0];const cv=cvs[0];if(!preset)fail('preset_not_found',404);if(!cv||typeof cv.text!=='string')fail('cv_not_found',404);
  if(input.application!==undefined){
   const app=input.application;
   if(context.profileId!=='arash'||!app||typeof app!=='object'||Array.isArray(app)||Object.keys(app).some(k=>!['variant','subjectIndex','clinicQuote','cvQuote','confirmCvQuote'].includes(k))||!['A','B','C'].includes(app.variant)||!Number.isInteger(app.subjectIndex)||app.subjectIndex<0||app.subjectIndex>2||typeof app.clinicQuote!=='string'||app.clinicQuote.length>1000||typeof app.cvQuote!=='string'||app.cvQuote.length>1200||app.confirmCvQuote!==true)fail('invalid_gp_application');
   const generated=await getGpApplicationPackage(env,context,row.id,{...app,cvVersionId:input.cvVersionId});
   if(!generated.readyForReview)fail('gp_application_evidence_required',409);
   if(preset.data?.name!==generated.templateName)fail('gp_application_template_mismatch',409);
   preset={...preset,data:{...preset.data,subject:generated.subjects[app.subjectIndex],body:generated.body}};
  }
  if(typeof preset.data?.subject!=='string'||typeof preset.data?.body!=='string'||/\{\{|\[\[(?:name|clinic|doctor|recipient)/i.test(preset.data.subject+' '+preset.data.body))fail('template_placeholders_require_review',409);
  // Ephemeral adapter binds exactly one server-verified source recipient. It never
  // inserts a clinic, accepts a browser clinic ID, or consults another owner.
  const clinicId='cl_'+(await digest(recipient)).slice(0,20);
  const frozen={...scoped,rest:async(table,query)=>{
   if(table==='immi_presets')return [preset];if(table==='immi_cv_versions')return [cv];
   if(table==='immi_clinics')return [{id:clinicId,data:{email:recipient}}];
   return context.rest(table,query);
  }};
  const payload={clinicIds:[clinicId],presetId:input.presetId,cvVersionId:input.cvVersionId};
  const transportRequest=action=>new Request(url.origin+'/api/google/mail/'+action,{method:'POST',headers:{Origin:url.origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const previewResponse=await handleGoogleSendRequest(transportRequest('preview'),env,frozen,fetcher),preview=await previewResponse.json();
  if(!previewResponse.ok)return json(preview,previewResponse.status);
  const identity=await env.GOOGLE_DB.prepare('SELECT google_sub,email,status FROM google_accounts WHERE owner_id=?').bind(scoped.userId).first();
  if(!identity||identity.status!=='connected'||identity.email.toLowerCase()!==preview.sender.toLowerCase())fail('google_account_changed',409);
  const reviewHash=await digest({owner:context.userId,googleSubject:identity.google_sub,mailbox,opportunityId:row.id,editionKey:row.edition_key,sourceContent:source,presetId:input.presetId,cvVersionId:input.cvVersionId,recipient,subject:preset.data.subject,body:preset.data.body,cvText:cv.text,cvVersion:cv.version,sender:preview.sender,attachmentName:preview.recipients?.[0]?.attachmentName});
  if(match[2]==='preview')return json({...preview,...sourceView,mailbox,presetId:input.presetId,cvVersionId:input.cvVersionId,message:{subject:preset.data.subject,body:preset.data.body},reviewHash,sent:false});
  if(input.confirmReviewed!==true)fail('explicit_review_required',409);
  if(input.reviewHash!==reviewHash)fail('application_changed_review_required',409);
  if(preview.recipients?.length!==1)fail(preview.excluded?.[0]?.reason==='suppressed'?'recipient_suppressed':'recipient_unavailable',409);
  frozen.expectedGoogleIdentity={subject:identity.google_sub,email:identity.email};
  const response=await handleGoogleSendRequest(transportRequest('queue'),env,frozen,fetcher);
  return json({...await response.json(),...sourceView,mailbox,sent:false},response.status);
 }catch(error){return json({error:Number.isInteger(error.status)?error.message:'opportunity_mail_unavailable'},Number.isInteger(error.status)?error.status:503);}
}
