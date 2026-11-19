// Immutable private Gmail-opportunity edits. Reuses the private GP edit journal;
// distinct IDs, source IDs, owner slots and kind prevent crossing the GP API.
import {validateManualLetterEdit,applyManualLetterEdit} from './gp-letter-edits.mjs';

const ID=/^mop_[a-f0-9]{32}$/,EDIT=/^moedit_[a-f0-9]{32}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KIND='private_mail_opportunity_v1',VERSION='private-owner-mail-edit-v1';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const missingTable=error=>/no such table:? (?:main\.)?gp_letter_edits/i.test(error?.cause?.message||error?.message||'');
function own(context){
 const root=context?.userId?.replace(/:secondary$/,'');
 if(context?.profileId!=='arash'||!UUID.test(root||'')||context.userId!==root&&context.userId!==root+':secondary'||context.rootUserId&&context.rootUserId!==root)fail('workspace_required',403);
 return context.userId;
}
function wrapper(proposal){
 const name=proposal.clinicName||String(proposal.subject||'').replace(/^GP (?:application|enquiry)\s*[—–-]\s*/, '');
 return {...proposal,opportunityId:proposal.id,subjects:[proposal.subject,proposal.subject,proposal.subject],dossier:{name:{value:name}}};
}
function apply(proposal,row){
 const adjusted=applyManualLetterEdit(wrapper(proposal),{clinicParagraph:row.clinic_paragraph,valueParagraph:row.value_paragraph,subjectIndex:0,subject:row.subject,method:'owner_manual_edit'});
 return {...proposal,subject:adjusted.subjects[0],body:adjusted.body,paragraphs:adjusted.paragraphs,writingQuality:adjusted.writingQuality,editedDraftId:row.id,editRevision:row.revision,editStatus:'owner_edited',manualReviewRequired:true,automaticSending:false};
}
export async function mailOpportunityEditContextHash(proposal){
 if(!ID.test(proposal?.id||'')||!UUID.test(proposal.cvVersionId||'')||!proposal.googleSubject||!proposal.sender)fail('mail_opportunity_edit_context_required',409);
 const bytes=new TextEncoder().encode(JSON.stringify([VERSION,proposal.id,proposal.googleSubject,proposal.sender.toLowerCase(),proposal.cvVersionId,proposal.subject,proposal.body,proposal.paragraphs,proposal.evidenceHash,proposal.recipients,proposal.provenance,proposal.writingQuality?.version,proposal.outreachMode]));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
}
/** One read. Never writes over source research or the canonical draft cache. */
export async function hydrateMailOpportunityEdit(env,context,proposal,{editedDraftId,strict=false,includeHead=false}={}){
 const owner=own(context);if(!env.GOOGLE_DB)fail('google_storage_required',503);
 if(editedDraftId!==undefined&&editedDraftId!==null&&!EDIT.test(editedDraftId))fail('invalid_mail_opportunity_edit');
 const hash=await mailOpportunityEditContextHash(proposal);let row;
 try{
  row=await stmt(env.GOOGLE_DB,`SELECT *, (SELECT max(head.revision) FROM gp_letter_edits head WHERE head.owner_id=gp_letter_edits.owner_id AND head.opportunity_id=gp_letter_edits.opportunity_id AND json_extract(head.selection_json,'$.kind')='private_mail_opportunity_v1' AND json_extract(head.selection_json,'$.googleSubject')=json_extract(gp_letter_edits.selection_json,'$.googleSubject')) AS latest_private_revision FROM gp_letter_edits WHERE owner_id=? AND profile_id='arash' AND opportunity_id=?
   AND json_extract(selection_json,'$.kind')=? AND json_extract(selection_json,'$.googleSubject')=?
   ${editedDraftId?'AND id=?':''} ORDER BY revision DESC LIMIT 1`,owner,proposal.id,KIND,proposal.googleSubject,...(editedDraftId?[editedDraftId]:[])).first();
 }catch(error){if(missingTable(error)&&(editedDraftId===undefined||editedDraftId===null))return {...proposal,editStatus:'generated'};fail('mail_opportunity_edit_storage_unavailable',503);}
 const head=includeHead?{editHeadRevision:Number(row?.latest_private_revision)||0}:{};
 if(editedDraftId===null&&row)fail('mail_opportunity_edit_context_changed',409);
 if(editedDraftId&&row&&Number(row.latest_private_revision)!==Number(row.revision))fail('mail_opportunity_edit_context_changed',409);
 if(!row){if(editedDraftId||strict)fail('mail_opportunity_edit_context_changed',409);return {...proposal,...head,editStatus:'generated'};}
 if(row.base_hash!==hash||row.cv_version_id!==proposal.cvVersionId||!proposal.readyForReview){
  if(editedDraftId||strict)fail('mail_opportunity_edit_context_changed',409);
  return {...proposal,...head,status:proposal.status==='ready_for_review'?'needs_edit_review':proposal.status,readyForReview:false,missing:[...new Set([...(proposal.missing||[]),'mail_opportunity_saved_edit_requires_review'])],editStatus:'saved_edit_needs_review',ownerEditNeedsReview:true,savedEdit:{id:row.id,revision:row.revision,cvVersionId:row.cv_version_id,subject:row.subject,clinicParagraph:row.clinic_paragraph,valueParagraph:row.value_paragraph},automaticSending:false};
 }
 return {...apply(proposal,row),...head};
}
async function input(request){
 if(Number(request.headers.get('content-length')||0)>16000)fail('payload_too_large',413);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>16000)fail('payload_too_large',413);
 let value;try{value=JSON.parse(raw);}catch{fail('invalid_mail_opportunity_edit');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['cvVersionId','subject','body','clinicParagraph','valueParagraph','editedDraftId'].includes(key))||!UUID.test(value.cvVersionId||'')||value.editedDraftId!==undefined&&!EDIT.test(value.editedDraftId))fail('invalid_mail_opportunity_edit');
 return value;
}
export async function handleMailOpportunityEditsRequest(request,env,context){
 const url=new URL(request.url),match=/^\/api\/google\/mail-opportunities\/(mop_[a-f0-9]{32})\/edit$/.exec(url.pathname);if(!match)return null;
 try{
  const owner=own(context);if(typeof context.rest!=='function')fail('workspace_required',403);
  if(request.method!=='POST')fail('method_not_allowed',405);
  if(request.headers.get('Origin')!==url.origin)fail('origin_rejected',403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!=='arash')fail('profile_access_denied',403);
  if(!env.GOOGLE_DB||typeof env.GOOGLE_DB.batch!=='function')fail('mail_opportunity_edit_storage_unavailable',503);
  const selected=await input(request),{prepareOwnedMailOpportunity}=await import('./mail-opportunities.mjs');
  const proposal=await prepareOwnedMailOpportunity(env,context,match[1],{cvVersionId:selected.cvVersionId},{skipOwnerEdit:true,includeSourceState:true});
  if(!proposal.readyForReview)fail('mail_opportunity_evidence_required',409);
  const validated=validateManualLetterEdit(wrapper(proposal),{...selected,subjectIndex:0}),hash=await mailOpportunityEditContextHash(proposal);
  if(proposal.outreachMode==='initial_enquiry'&&!/\b(?:enquiry|inquiry)\b/i.test(validated.subject))fail('initial_enquiry_subject_required',409);
  if(selected.editedDraftId){
   const previous=await stmt(env.GOOGLE_DB,"SELECT id,revision,base_hash,cv_version_id,selection_json,(SELECT max(h.revision) FROM gp_letter_edits h WHERE h.owner_id=gp_letter_edits.owner_id AND h.opportunity_id=gp_letter_edits.opportunity_id AND json_extract(h.selection_json,'$.kind')='private_mail_opportunity_v1' AND json_extract(h.selection_json,'$.googleSubject')=json_extract(gp_letter_edits.selection_json,'$.googleSubject')) AS head_revision FROM gp_letter_edits WHERE id=? AND owner_id=? AND opportunity_id=? AND profile_id='arash'",selected.editedDraftId,owner,match[1]).first();
   const identity=parse(previous?.selection_json);
   if(!previous||previous.revision!==previous.head_revision||previous.base_hash!==hash||previous.cv_version_id!==selected.cvVersionId||identity.kind!==KIND||identity.googleSubject!==proposal.googleSubject)fail('mail_opportunity_edit_context_changed',409);
  }
  const id='moedit_'+crypto.randomUUID().replaceAll('-',''),at=new Date().toISOString(),snapshot=proposal.sourceState;
  if(!snapshot||!Number.isSafeInteger(snapshot.updatedAt)||typeof snapshot.dataJson!=='string'||typeof snapshot.draftJson!=='string')fail('mail_opportunity_edit_context_required',409);
  const selection=JSON.stringify({kind:KIND,googleSubject:proposal.googleSubject,sender:proposal.sender,mailbox:context.mailbox||'primary'}),time=Date.now();
  const insert=stmt(env.GOOGLE_DB,`INSERT INTO gp_letter_edits(id,owner_id,profile_id,opportunity_id,cv_version_id,base_hash,selection_json,revision,subject_index,subject,clinic_paragraph,value_paragraph,template_id,previous_id,method,created_at)
   SELECT ?,?,'arash',?,?,?,?,coalesce((SELECT max(revision) FROM gp_letter_edits WHERE owner_id=? AND opportunity_id=?),0)+1,0,?,?,?,NULL,?,'owner_manual_edit',?
   FROM private_mail_opportunities o WHERE o.id=? AND o.owner_id=? AND o.google_sub=? AND o.updated_at=? AND o.data_json=? AND o.draft_json=? AND o.status IN ('suggested','reviewed')
   AND EXISTS(SELECT 1 FROM google_accounts a WHERE a.owner_id=o.owner_id AND a.google_sub=o.google_sub AND a.status='connected') RETURNING *`,id,owner,proposal.id,selected.cvVersionId,hash,selection,owner,proposal.id,validated.subject,validated.clinicParagraph,validated.valueParagraph,selected.editedDraftId||null,at,proposal.id,owner,proposal.googleSubject,snapshot.updatedAt,snapshot.dataJson,snapshot.draftJson);
  // Bump the existing source revision atomically. The final Gmail transport
  // claim already pins this revision, including edits saved during its GET.
  const touch=stmt(env.GOOGLE_DB,`UPDATE private_mail_opportunities SET updated_at=max(updated_at+1,?) WHERE id=? AND owner_id=? AND google_sub=? AND updated_at=? AND data_json=? AND draft_json=? AND EXISTS(SELECT 1 FROM gp_letter_edits e WHERE e.id=? AND e.owner_id=private_mail_opportunities.owner_id) RETURNING updated_at`,time,proposal.id,owner,proposal.googleSubject,snapshot.updatedAt,snapshot.dataJson,snapshot.draftJson,id);
  const saved=await env.GOOGLE_DB.batch([insert,touch]),row=saved[0]?.results?.[0];
  if(!row||saved[1]?.results?.length!==1)fail('mail_opportunity_changed',409);
  const {sourceState,...safe}=proposal;return json({...apply(safe,row),sent:false},201);
 }catch(error){return json({error:missingTable(error)?'mail_opportunity_edit_storage_unavailable':/^[a-z_]{3,100}$/.test(error?.code||'')?error.code:'mail_opportunity_edit_unavailable',automaticSending:false},missingTable(error)?503:Number.isInteger(error?.status)?error.status:503);}
}
