// Private, versioned owner editing. No handler in this module sends a message.
import {getGpApplicationPackage} from './gp-application-package.mjs';
import {resolveAcademicDraft} from './gp-academic-writing.mjs';
import {composeClinicParagraphs} from './gp-letter-composer.mjs';

export const GP_LETTER_EDIT_VERSION='owner-evidence-letter-v1';
const EDIT=/^gpedit_[a-f0-9]{32}$/,STYLE=/^gpstyle_[a-f0-9]{32}$/,OPP=/^opp_[a-f0-9]{32}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const FOCUS=new Set(['clinical_breadth','teamwork','continuity','acute','training']);
const TONE=new Set(['warm_professional','formal']);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(value=>value.toString(16).padStart(2,'0')).join('');
const id=prefix=>prefix+crypto.randomUUID().replaceAll('-','');
const own=context=>{
 if(context?.profileId!=='arash'||typeof context.userId!=='string'||!context.userId||context.userId.includes(':')||typeof context.rest!=='function')fail('gp_workspace_required',403);
};
const cleanName=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
function styleValue(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['focus','tone'].includes(key)))fail('invalid_letter_style');
 let focus=value.focus||'clinical_breadth';if(focus==='balanced')focus='clinical_breadth';if(focus==='acute_care')focus='acute';
 const tone=value.tone||'warm_professional';if(!FOCUS.has(focus)||!TONE.has(tone))fail('invalid_letter_style');
 return {focus,tone};
}
function selectionValue(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['variant','cvVersionId','clinicQuote','cvQuote','confirmCvQuote','connectionId','confirmConnection','refinementId'].includes(key))||!['A','B','C'].includes(value.variant)||!UUID.test(value.cvVersionId||'')||typeof value.clinicQuote!=='string'||value.clinicQuote.length>1000||typeof value.cvQuote!=='string'||value.cvQuote.length>1200||value.confirmCvQuote!==true)fail('invalid_manual_letter_selection');
 if(value.connectionId!==undefined&&(!UUID.test(value.connectionId)||value.confirmConnection!==true)||value.confirmConnection!==undefined&&typeof value.confirmConnection!=='boolean'||value.refinementId!==undefined&&!/^academic_[a-f0-9]{32}$/.test(value.refinementId))fail('invalid_manual_letter_selection');
 return {...value};
}
function paragraph(value,minimum=25){
 if(typeof value!=='string')fail('manual_letter_paragraph_required');
 const result=value.trim().replace(/[\r\n\t]+/g,' ').replace(/ {2,}/g,' ');
 if(result.length<minimum||result.length>2400||/[\x00-\x1f<>]/.test(result)||/\{\{|\}\}|system prompt|ignore.{0,30}instructions|javascript:/i.test(result))fail('invalid_manual_letter_paragraph');
 return result;
}
function subjectValue(value,fallback){
 const result=value===undefined?fallback:typeof value==='string'?value.trim():'';
 if(!result||result.length>500||/[\x00-\x1f<>]/.test(result)||/\{\{|\}\}/.test(result))fail('invalid_manual_letter_subject');
 return result;
}
function blocksFor(pkg){
 const blocks=typeof pkg.body==='string'?pkg.body.split('\n\n'):[],p=pkg.paragraphs;
 if(!pkg.readyForReview||!p||blocks.length!==6||blocks[1]!==p.opening||blocks[2]!==p.clinic||blocks[3]!==p.value||blocks[4]!==p.closing||!blocks[0]||!blocks[5])fail('gp_application_evidence_required',409);
 return blocks;
}
export async function gpLetterEditContextHash(pkg){
 blocksFor(pkg);
 return sha([GP_LETTER_EDIT_VERSION,pkg.profileId,pkg.opportunityId,pkg.cvVersionId,pkg.body,pkg.subjects,pkg.provenance,pkg.factBasis,pkg.signatureStatus,pkg.writingQuality?.version||null,pkg.refinementId||null]);
}
export function validateManualLetterEdit(pkg,input){
 const blocks=blocksFor(pkg);let opening=input.openingParagraph,clinic=input.clinicParagraph,value=input.valueParagraph,closing=input.closingParagraph;
 if(input.body!==undefined){
  if(typeof input.body!=='string'||input.body.length>12000)fail('invalid_manual_letter_body');
  const edited=input.body.replaceAll('\r\n','\n').trim().split('\n\n');
  if(edited.length!==6||[0,5].some(index=>edited[index]!==blocks[index]))fail('manual_letter_fixed_sections_changed',409);
  if(opening!==undefined&&opening!==edited[1]||clinic!==undefined&&clinic!==edited[2]||value!==undefined&&value!==edited[3]||closing!==undefined&&closing!==edited[4])fail('manual_letter_body_mismatch');
  opening=edited[1];clinic=edited[2];value=edited[3];closing=edited[4];
 }
 opening=paragraph(opening===undefined?pkg.paragraphs.opening:opening);clinic=paragraph(clinic);value=paragraph(value);closing=paragraph(closing===undefined?pkg.paragraphs.closing:closing,15);
 const name=pkg.dossier?.name?.value;
 if(typeof name!=='string'||!name||!clinic.toLowerCase().includes(name.toLowerCase()))fail('manual_letter_clinic_name_required',409);
 if(!Number.isInteger(input.subjectIndex)||input.subjectIndex<0||input.subjectIndex>2)fail('invalid_manual_letter_subject_index');
 return {openingParagraph:opening,clinicParagraph:clinic,valueParagraph:value,closingParagraph:closing,subjectIndex:input.subjectIndex,subject:subjectValue(input.subject,pkg.subjects?.[input.subjectIndex])};
}
// New revisions capture the editable outer paragraphs in existing private JSON;
// earlier rows without this optional field retain their canonical P1/P4.
export function ownerEditedParagraphs(selectionJson){
 const stored=typeof selectionJson==='string'?parse(selectionJson):selectionJson;
 if(!stored?.ownerParagraphs)return {};
 const value=stored.ownerParagraphs;if(!value||Array.isArray(value)||value.version!=='owner-paragraphs-v1')fail('edited_letter_context_changed',409);
 return {openingParagraph:paragraph(value.openingParagraph),closingParagraph:paragraph(value.closingParagraph,15)};
}
function ownerParagraphSnapshot(edit){return {version:'owner-paragraphs-v1',openingParagraph:edit.openingParagraph,closingParagraph:edit.closingParagraph};}
export function applyManualLetterEdit(pkg,edit){
 const validated=validateManualLetterEdit(pkg,edit),blocks=blocksFor(pkg),subjects=[...pkg.subjects];
 blocks[1]=validated.openingParagraph;blocks[2]=validated.clinicParagraph;blocks[3]=validated.valueParagraph;blocks[4]=validated.closingParagraph;subjects[validated.subjectIndex]=validated.subject;
 return {...pkg,paragraphs:{...pkg.paragraphs,opening:validated.openingParagraph,clinic:validated.clinicParagraph,value:validated.valueParagraph,closing:validated.closingParagraph},body:blocks.join('\n\n'),subjects,writingQuality:{...pkg.writingQuality,method:edit.method||'owner_manual_edit',manualTextIsOwnerReported:edit.method!=='fresh_adaptive_template'||validated.openingParagraph!==pkg.paragraphs.opening||validated.closingParagraph!==pkg.paragraphs.closing,needsOwnerReview:true},manualReviewRequired:true,automaticSending:false};
}
function templateItem(row){
 return {id:row.id,name:row.name,revision:Number(row.revision),variant:row.variant,style:styleValue(parse(row.style_json)||{}),example:parse(row.example_json),createdAt:row.created_at,clinicSpecificTextReused:false};
}
async function loadTemplate(env,context,templateId){
 if(!STYLE.test(templateId||''))fail('invalid_letter_template_id');
 const row=await stmt(env.GOOGLE_DB,"SELECT * FROM gp_letter_style_templates WHERE id=? AND owner_id=? AND profile_id='arash'",templateId,context.userId).first();
 if(!row)fail('letter_template_not_found',404);return row;
}
export function applyAdaptiveLetterStyle(pkg,style){
 const selected=styleValue(style),clinic=pkg.provenance?.find(item=>item.kind==='clinic_quote'),cv=pkg.provenance?.find(item=>item.kind==='cv_quote');
 if(!clinic?.quote||!cv?.quote)fail('gp_application_evidence_required',409);
 const professionalStrengths=Array.isArray(pkg.factBasis?.professionalStrengths)?pkg.factBasis.professionalStrengths.map(value=>typeof value==='string'?value:value?.text||value?.quote||'').filter(Boolean):[];
 const composed=composeClinicParagraphs({clinicName:pkg.dossier?.name?.value,clinicQuote:clinic.quote,cvQuote:cv.quote,confirmed:true,clinicSourceURL:clinic.sourceUrl||clinic.sourceURL,clinicReadAt:clinic.readAt,styleFocus:selected.focus,professionalStrengths,supportingClinicFacts:pkg.factBasis?.clinic?.slice(1)});
 let clinicParagraph=composed.clinicReason,valueParagraph=composed.candidateValue;
 // Tone changes courtesy only. Clinical/source claims come solely from the
 // freshly generated facts; no phrase from a previous clinic is transplanted.
 if(selected.tone==='formal'){
  clinicParagraph=clinicParagraph.replace(/I would value /g,'I would welcome ').replace(/I am particularly interested in /g,'I am interested in ');
  valueParagraph=valueParagraph.replace(/I would welcome feedback/g,'I would be receptive to feedback');
 }
 return {...applyManualLetterEdit(pkg,{clinicParagraph,valueParagraph,subjectIndex:0,method:'fresh_adaptive_template'}),writingQuality:{...composed.writingQuality,method:'fresh_adaptive_template',needsOwnerReview:true,style:selected,manualTextIsOwnerReported:false},manualReviewRequired:true};
}
export async function resolveEditedLetter(env,context,pkg,editedDraftId,subjectIndex){
 own(context);if(!EDIT.test(editedDraftId||''))fail('invalid_edited_letter_id');
 if(!env.GOOGLE_DB)fail('gp_letter_edit_storage_required',503);
 const row=await stmt(env.GOOGLE_DB,"SELECT * FROM gp_letter_edits WHERE id=? AND owner_id=? AND profile_id='arash'",editedDraftId,context.userId).first();
 if(!row||row.opportunity_id!==pkg.opportunityId||row.cv_version_id!==pkg.cvVersionId||row.base_hash!==await gpLetterEditContextHash(pkg)||subjectIndex!==undefined&&row.subject_index!==subjectIndex)fail('edited_letter_context_changed',409);
 const applied=applyManualLetterEdit(pkg,{...ownerEditedParagraphs(row.selection_json),clinicParagraph:row.clinic_paragraph,valueParagraph:row.value_paragraph,subjectIndex:row.subject_index,subject:row.subject,method:row.method});
 return {...applied,editedDraftId:row.id,ownerRevision:row.revision,savedTemplateId:row.template_id,manualSubjectIndex:row.subject_index};
}
async function canonicalPackage(env,context,opportunityId,selection){
 const {refinementId,...options}=selection;let pkg=await getGpApplicationPackage(env,context,opportunityId,options);
 if(!pkg.readyForReview)fail('gp_application_evidence_required',409);
 if(refinementId)pkg=await resolveAcademicDraft(env,context,pkg,refinementId);
 return pkg;
}
async function storeEdit(env,context,pkg,edit,{templateId=null,previousId=null,method='owner_manual_edit',selection,deferred=false}={}){
 const editId=id('gpedit_'),hash=await gpLetterEditContextHash(pkg),at=new Date().toISOString();
 if(previousId){
  if(!EDIT.test(previousId))fail('invalid_edited_letter_id');
  const previous=await stmt(env.GOOGLE_DB,"SELECT opportunity_id,cv_version_id,base_hash FROM gp_letter_edits WHERE id=? AND owner_id=? AND profile_id='arash'",previousId,context.userId).first();
  if(!previous||previous.opportunity_id!==pkg.opportunityId||previous.cv_version_id!==pkg.cvVersionId||previous.base_hash!==hash)fail('edited_letter_context_changed',409);
 }
 const statement=stmt(env.GOOGLE_DB,`INSERT INTO gp_letter_edits(id,owner_id,profile_id,opportunity_id,cv_version_id,base_hash,selection_json,revision,subject_index,subject,clinic_paragraph,value_paragraph,template_id,previous_id,method,created_at)
  SELECT ?,?,'arash',?,?,?,?,coalesce((SELECT max(revision) FROM gp_letter_edits WHERE owner_id=? AND opportunity_id=?),0)+1,?,?,?,?,?,?,?,?
  WHERE (? IS NULL OR EXISTS(SELECT 1 FROM gp_letter_style_templates WHERE id=? AND owner_id=? AND profile_id='arash')) RETURNING *`,editId,context.userId,pkg.opportunityId,pkg.cvVersionId,hash,JSON.stringify({...selectionValue(selection),ownerParagraphs:ownerParagraphSnapshot(edit)}),context.userId,pkg.opportunityId,edit.subjectIndex,edit.subject,edit.clinicParagraph,edit.valueParagraph,templateId,previousId,method,at,templateId,templateId,context.userId);
 const result=saved=>{
  if(!saved)fail('edited_letter_context_changed',409);
  return {...applyManualLetterEdit(pkg,{...edit,method}),editedDraftId:saved.id,ownerRevision:saved.revision,savedTemplateId:templateId,manualSubjectIndex:edit.subjectIndex};
 };
 if(deferred)return {statement,result};
 return result(await statement.first());
}
async function planStyle(env,context,pkg,edit,input){
 const previous=input.templateId?await loadTemplate(env,context,input.templateId):null;
 if(input.saveMode==='new_template'&&!cleanName(input.templateName))fail('letter_template_name_required');
 const name=input.saveMode==='replace'?(previous?.name||cleanName(input.templateName)||pkg.templateName):cleanName(input.templateName);
 if(typeof name!=='string'||!name||name.length>120||/[\x00-\x1f<>]/.test(name))fail('invalid_letter_template_name');
 const style=styleValue(input.style||previous&&parse(previous.style_json)||{}),templateId=id('gpstyle_'),at=new Date().toISOString();
 const statement=stmt(env.GOOGLE_DB,`INSERT INTO gp_letter_style_templates(id,owner_id,profile_id,name,revision,variant,style_json,example_json,created_at)
  SELECT ?,?,'arash',?,coalesce((SELECT max(revision) FROM gp_letter_style_templates WHERE owner_id=? AND name=?),0)+1,?,?,?,?
  WHERE (?='replace' OR NOT EXISTS(SELECT 1 FROM gp_letter_style_templates WHERE owner_id=? AND name=?)) RETURNING *`,templateId,context.userId,name,context.userId,name,pkg.variant,JSON.stringify(style),JSON.stringify({opportunityId:pkg.opportunityId,clinicName:pkg.dossier?.name?.value,openingParagraph:edit.openingParagraph,clinicParagraph:edit.clinicParagraph,valueParagraph:edit.valueParagraph,closingParagraph:edit.closingParagraph}),at,input.saveMode,context.userId,name);
 return {id:templateId,statement};
}
async function body(request){
 if(Number(request.headers.get('content-length')||0)>20000)fail('payload_too_large',413);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>20000)fail('payload_too_large',413);
 let value;try{value=JSON.parse(raw);}catch{fail('invalid_manual_letter_payload');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_manual_letter_payload');return value;
}
export async function handleGpLetterEditsRequest(request,env,context){
 const url=new URL(request.url),library=url.pathname==='/api/gp-writing/templates',match=/^\/api\/gp-writing\/(opp_[a-f0-9]{32})\/(manual-edit|apply-template|restore-edit)$/.exec(url.pathname);
 if(!library&&!match)return null;
 try{
  own(context);if(!env.GOOGLE_DB)fail('gp_letter_edit_storage_required',503);
  if([...url.searchParams.keys()].some(key=>key!=='profile')||url.searchParams.getAll('profile').length>1||url.searchParams.has('profile')&&url.searchParams.get('profile')!=='arash')fail('profile_access_denied',403);
  if(library){
   if(request.method!=='GET')fail('method_not_allowed',405);
   const result=await stmt(env.GOOGLE_DB,"SELECT t.* FROM gp_letter_style_templates t WHERE t.owner_id=? AND t.profile_id='arash' AND t.revision=(SELECT max(v.revision) FROM gp_letter_style_templates v WHERE v.owner_id=t.owner_id AND v.name=t.name) ORDER BY t.created_at DESC LIMIT 100",context.userId).all();
   return json({items:(result.results||[]).map(templateItem),automaticSending:false,sourceAssessmentRequired:true});
  }
  if(request.method==='GET'&&match[2]==='manual-edit'){
   const result=await stmt(env.GOOGLE_DB,"SELECT id,cv_version_id,revision,subject_index,template_id,created_at FROM gp_letter_edits WHERE owner_id=? AND profile_id='arash' AND opportunity_id=? ORDER BY revision DESC LIMIT 20",context.userId,match[1]).all();
   return json({items:(result.results||[]).map(row=>({id:row.id,cvVersionId:row.cv_version_id,revision:row.revision,subjectIndex:row.subject_index,templateId:row.template_id,createdAt:row.created_at})),automaticSending:false,restorationRequiresReview:true});
  }
  if(request.method!=='POST')fail('method_not_allowed',405);
  if(request.headers.get('Origin')!==url.origin)fail('origin_rejected',403);
  const input=await body(request),allowed=match[2]==='manual-edit'?['selection','subjectIndex','subject','body','openingParagraph','clinicParagraph','valueParagraph','closingParagraph','saveMode','templateName','templateId','editedDraftId','style']:match[2]==='restore-edit'?['selection','editedDraftId','subjectIndex']:['selection','templateId','subjectIndex','editedDraftId'];
  if(Object.keys(input).some(key=>!allowed.includes(key)))fail('unexpected_manual_letter_field');
  if(match[2]==='restore-edit'){
   if(!EDIT.test(input.editedDraftId||''))fail('invalid_edited_letter_id');
   const saved=await stmt(env.GOOGLE_DB,"SELECT * FROM gp_letter_edits WHERE id=? AND owner_id=? AND opportunity_id=? AND profile_id='arash'",input.editedDraftId,context.userId,match[1]).first();
   if(!saved)fail('edited_letter_context_changed',409);
   const {ownerParagraphs,...storedSelection}=parse(saved.selection_json)||{},restoredSelection=selectionValue(storedSelection);
   let pkg,result;
   try{pkg=await canonicalPackage(env,context,match[1],restoredSelection);result=await resolveEditedLetter(env,context,pkg,input.editedDraftId,input.subjectIndex);}
   catch(error){
    if(!['edited_letter_context_changed','gp_application_evidence_required','clinic_quote_not_in_current_source','cv_quote_not_in_owned_cv','academic_context_changed','gp_connection_not_in_current_owned_contacts'].includes(error?.code||error?.message))throw error;
    // Keep the old owner's writing recoverable while re-reading only the owned
    // CV and current source. A recovered draft is never a sendable old receipt.
    const current=pkg||await getGpApplicationPackage(env,context,match[1],{variant:restoredSelection.variant,cvVersionId:restoredSelection.cvVersionId});
    result={...current,editedDraftId:saved.id,ownerRevision:saved.revision,savedTemplateId:saved.template_id,manualSubjectIndex:saved.subject_index,ownerEditNeedsReview:true,readyForReview:false,manualReviewRequired:true,automaticSending:false,savedEdit:{id:saved.id,revision:saved.revision,cvVersionId:saved.cv_version_id,subject:saved.subject,...ownerEditedParagraphs(saved.selection_json),clinicParagraph:saved.clinic_paragraph,valueParagraph:saved.value_paragraph}};
   }
   const template=result.savedTemplateId?await loadTemplate(env,context,result.savedTemplateId):null;
   return json({...result,restoredSelection,...(template?{savedTemplate:templateItem(template)}:{}),sourceAssessmentRequired:true,sent:false});
  }
  const selection=selectionValue(input.selection),pkg=await canonicalPackage(env,context,match[1],selection);
  if(match[2]==='apply-template'){
   const template=await loadTemplate(env,context,input.templateId),styled=applyAdaptiveLetterStyle(pkg,parse(template.style_json)||{}),index=input.subjectIndex===undefined?0:input.subjectIndex;
   const current=input.editedDraftId?await resolveEditedLetter(env,context,pkg,input.editedDraftId):pkg;
   const edit=validateManualLetterEdit(pkg,{openingParagraph:current.paragraphs.opening,clinicParagraph:styled.paragraphs.clinic,valueParagraph:styled.paragraphs.value,closingParagraph:current.paragraphs.closing,subjectIndex:index});
   const result=await storeEdit(env,context,pkg,edit,{templateId:template.id,previousId:input.editedDraftId||null,method:'fresh_adaptive_template',selection});
   return json({...result,restoredSelection:selection,savedTemplate:templateItem(template),writingQuality:{...result.writingQuality,style:styleValue(parse(template.style_json)||{}),styleFocus:styled.writingQuality?.styleFocus},sourceAssessmentRequired:true,clinicSpecificTextReused:false,sent:false});
  }
  if(!['replace','new_template'].includes(input.saveMode))fail('invalid_manual_letter_save_mode');
  const edit=validateManualLetterEdit(pkg,input);
  // Validate any preceding revision before creating a new template revision.
  if(input.editedDraftId)await resolveEditedLetter(env,context,pkg,input.editedDraftId);
  if(typeof env.GOOGLE_DB.batch!=='function')fail('gp_letter_edit_storage_required',503);
  const plannedTemplate=await planStyle(env,context,pkg,edit,input),plannedEdit=await storeEdit(env,context,pkg,edit,{templateId:plannedTemplate.id,previousId:input.editedDraftId||null,selection,deferred:true});
  const written=await env.GOOGLE_DB.batch([plannedTemplate.statement,plannedEdit.statement]),template=written[0]?.results?.[0];
  if(!template)fail('letter_template_name_exists',409);
  const result=plannedEdit.result(written[1]?.results?.[0]);
  return json({...result,restoredSelection:selection,savedTemplate:templateItem(template),sourceAssessmentRequired:true,clinicSpecificTextReused:false,sent:false},201);
 }catch(error){
  const missing=/no such table:? (?:main\.)?gp_letter_(?:edits|style_templates)/i.test(error?.message||'');
  return json({error:missing?'gp_letter_edit_storage_required':/^[a-z_]{3,100}$/.test(error?.code||'')?error.code:'manual_letter_unavailable',automaticSending:false},missing?503:Number.isInteger(error?.status)?error.status:503);
 }
}
