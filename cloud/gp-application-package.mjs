// Owner-only GP application preparation. This module never sends mail, changes
// credentials/CVs, fetches arbitrary URLs, or turns source wording into eligibility.
import {enrichReadPages} from './opportunity-store.mjs';
import {publishedRecipients} from './mail-automation.mjs';
import {gpOpportunitySignals} from './gp-opportunity-signals.mjs';
const ID=/^opp_[a-f0-9]{32}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const VARIANTS=['A','B','C'];
const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const NETWORKS=['IPN','ForHealth','Sonic HealthPlus','Ochre Health','Partnered Health','Healius','NCN Health'];
const CLINICAL=/\b(?:general practice|family (?:medicine|practice)|patient|chronic|preventive|prevention|diabetes|wound|suturing|emergency|acute|community|multidisciplinary|supervision|teaching|clinic|medical centre|medical center)\b/i;
const INSTRUCTION=/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|send.{0,40}(?:token|secret)|javascript:|<script/i;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status});};
const text=(value,max=1000)=>typeof value==='string'?value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,' ').trim().slice(0,max):'';
const normalize=value=>text(value,150000).replace(/\s+/g,' ').trim();
function safeURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function field(value,url,quote=value,method='published_field'){
 const clean=normalize(value).slice(0,500),sourceUrl=safeURL(url);return clean&&sourceUrl?{value:clean,status:'source_statement',sourceUrl,quote:normalize(quote).slice(0,700),method}:{value:null,status:'not_stated',sourceUrl:null};
}
function lines(value){return text(value,80000).split(/\n+|(?<=[.!?])\s+/).map(normalize).filter(Boolean);}
function sentences(value,{cv=false}={}){
 const seen=new Set(),out=[];
 for(const line of lines(value)){
  if(line.length<12||line.length>600||INSTRUCTION.test(line)||/[\[\]{}]|\*\*/.test(line)||!CLINICAL.test(line)||seen.has(line))continue;
  // Do not promote a header, personal address or contact line as a capability.
  if(cv&&/^(?:email|phone|address|referee|references|contact)\s*:/i.test(line))continue;
  seen.add(line);out.push(line);if(out.length>=12)break;
 }
 return out;
}
const SOURCE_CAUTION='Published clinic and advertisement statements require review; they do not establish an approved supervisor, current vacancy or personal eligibility.';
export const GP_APPLICATION_TEMPLATES=Object.freeze([
 {variant:'A',name:'GP A — Urban network enquiry',subject:'GP application — {{clinicName}}',body:'Dear {{practiceManager}},\n\nI am an internationally trained doctor seeking a supervised general practice position within an established team. I would welcome a discussion about whether your practice can support the position-specific PESCI and supervised practice documentation, where applicable.\n\n{{clinicEvidence}}\n\n{{cvEvidence}}\n\nPlease let me know a convenient time to discuss the role and supervision arrangements. Commencement would be subject to the required registration, supervision and work rights.\n\nKind regards,\n{{doctorName}}'},
 {variant:'B',name:'GP B — Independent practice enquiry',subject:'GP enquiry — {{clinicName}}',body:'Dear {{practiceManager}},\n\nI am an internationally trained doctor enquiring about a supervised GP role at your practice. Could we discuss whether you have a suitable position and capacity to support the required supervision and a position-specific PESCI application, where applicable?\n\n{{clinicEvidence}}\n\n{{cvEvidence}}\n\nI would be grateful for the opportunity to discuss your requirements. Commencement would be subject to the required registration, supervision and work rights.\n\nKind regards,\n{{doctorName}}'},
 {variant:'C',name:'GP C — Regional community enquiry',subject:'Supervised GP enquiry for your community — {{clinicName}}',body:'Dear {{practiceManager}},\n\nI am an internationally trained doctor interested in a supervised general practice role serving your regional community. I would welcome a discussion about a suitable position, supervision capacity and support for position-specific PESCI documentation, where applicable.\n\n{{clinicEvidence}}\n\n{{cvEvidence}}\n\nPlease let me know a convenient time to discuss your practice and community needs. Commencement would be subject to the required registration, supervision and work rights.\n\nKind regards,\n{{doctorName}}'},
].map(item=>Object.freeze(item)));
export const templateDefinitions=GP_APPLICATION_TEMPLATES;

export function buildGpApplicationPackage({opportunity={},profile={},cvText='',cvVersionId=null,variant='auto',clinicQuote='',cvQuote='',confirmCvQuote=false,now=Date.now()}={}){
 if(!['auto',...VARIANTS].includes(variant))fail('invalid_gp_variant');
 const sourceURL=safeURL(opportunity.url),sourceText=[opportunity.summary,opportunity.fullText].map(value=>text(value,50000)).filter(Boolean).join('\n');
 const organizations=typeof opportunity.organization==='string'?opportunity.organization:opportunity.organization?.name;
 const publishedOrg=(Array.isArray(opportunity.enrichment?.organizations)?opportunity.enrichment.organizations:[]).find(item=>['visible_label','jsonld_jobposting'].includes(item?.method)&&safeURL(item.sourceURL)===sourceURL&&normalize(item.name)&&normalize(item.quote));
 const name=normalize(publishedOrg?.name||opportunity.clinicName||opportunity.organizationName||organizations).slice(0,300);
 const contactEvidence=(Array.isArray(opportunity.contactEvidence)?opportunity.contactEvidence:[]).filter(c=>c&&['same_page','linked_page'].includes(c.sourceRelation)&&safeURL(c.sourceURL||c.sourceUrl));
 const contact=type=>contactEvidence.find(c=>c.type===type&&typeof c.value==='string');
 const contactField=type=>{const c=type==='website'?contactEvidence.find(c=>c.type==='website'&&c.contactRole==='organization_general'&&c.method==='jsonld_jobposting'):contact(type);return c?field(c.value,c.sourceURL||c.sourceUrl,c.quote,c.method):field(null);};
 const contactEmails=contactEvidence.filter(c=>c.type==='email'&&['application','organization_general','unknown'].includes(c.contactRole)&&EMAIL.test(c.value)).map(c=>c.value.toLowerCase());
 const recipients=[...new Set([...publishedRecipients(opportunity),...contactEmails])].slice(0,20);
 const geography=gpOpportunitySignals(opportunity),rural=lines(sourceText).find(s=>!INSTRUCTION.test(s)&&/\b(?:rural|regional|remote)\b/i.test(s)&&!/\b(?:not|no|non[- ])\s*(?:a\s+)?(?:rural|regional|remote)\b/i.test(s));
 const explicitNetwork=NETWORKS.find(n=>name.toLowerCase().includes(n.toLowerCase())||lines(sourceText).some(s=>new RegExp('(?:part of (?:the )?'+n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'|'+n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' (?:network|medical centres?|practices?))','i').test(s)))||null;
 const regional=geography.monashMentioned.some(n=>n>=3)||Boolean(rural);
 const urban=geography.monashMentioned.some(n=>n<=2)||lines(sourceText).some(s=>/\b(?:metropolitan|urban)\b/i.test(s)&&!INSTRUCTION.test(s)&&!/\b(?:not|non[- ])\s*(?:a\s+)?(?:metropolitan|urban)\b/i.test(s));
 const recommendedVariant=regional?'C':explicitNetwork&&urban?'A':'B';
 const chosen=variant==='auto'?recommendedVariant:variant;
 const clinicEvidenceCandidates=sentences(sourceText).map(value=>({text:value,sourceUrl:sourceURL,status:'source_statement_not_independently_verified'})).slice(0,8);
 const cvEvidenceCandidates=sentences(cvText,{cv:true}).map(value=>({text:value,source:'own_cv_self_reported',status:'owner_confirmation_required'})).slice(0,8);
 const selectedClinic=normalize(clinicQuote),selectedCv=normalize(cvQuote);
 if(selectedClinic&&!clinicEvidenceCandidates.some(item=>item.text===selectedClinic))fail('clinic_quote_not_in_current_source',409);
 if(selectedCv&&!cvEvidenceCandidates.some(item=>item.text===selectedCv))fail('cv_quote_not_in_owned_cv',409);
 const managerLine=lines(sourceText).find(line=>/^practice manager\s*[:–—-]\s*[A-Za-z]/i.test(line)&&line.length<180&&!INSTRUCTION.test(line));
 const managerName=managerLine?managerLine.replace(/^practice manager\s*[:–—-]\s*/i,'').split(/\s+(?:phone|email|telephone)\s*:/i)[0]:null;
 const manager=field(opportunity.practiceManager||(managerName&&/^[\p{L}][\p{L} .'-]{2,100}$/u.test(managerName)?managerName:null),sourceURL,managerLine||opportunity.practiceManager),network=field(explicitNetwork,sourceURL,explicitNetwork?lines(sourceText).find(line=>line.includes(explicitNetwork))||name:null,'published_network_wording');
 const title=text(opportunity.title,400),kind=opportunity.kind||'vacancy';
 const applicationType=kind==='employment_register'||opportunity.opportunityType==='lead'?'expression_of_interest':'advertised_position';
 const observed=Date.parse(opportunity.lastSeenAt||opportunity.last_seen_at),deadline=Date.parse(opportunity.closingAt||opportunity.closing_at),published=Date.parse(opportunity.publishedAt||opportunity.published_at);
 const sourceFresh=Number.isFinite(observed)&&observed<=now+60000&&now-observed<=72*3600000;
 const sourceClosed=['closed','source_removed','future'].includes(opportunity.status)||Number.isFinite(deadline)&&deadline<=now||Number.isFinite(published)&&published>now;
 const roleRelevant=/\b(?:GP|general practitioner|general practice|rural generalist)\b/i.test(title)&&!/\b(?:nurs(?:e|ing)|reception|manager|administrator)\b/i.test(title);
 const missingFields=[];
 for(const [missing,code]of[[!name,'clinic_name_not_stated'],[!sourceURL,'source_url_missing'],[!sourceFresh,'source_observation_stale'],[sourceClosed,'source_closed_or_future'],[!roleRelevant,'gp_role_requires_review'],[!recipients.length,'published_recipient_missing'],[!selectedClinic,'clinic_quote_required'],[!selectedCv,'cv_quote_required'],[selectedCv&&confirmCvQuote!==true,'cv_confirmation_required'],[!UUID.test(cvVersionId||''),'cv_version_required']])if(missing)missingFields.push(code);
 const doctorName=normalize(profile.name||profile.fullName||profile.full_name).slice(0,150)||'Dr Arash Entezar';
 const clinicParagraph=selectedClinic?'Your published information states: "'+selectedClinic+'".':'{{clinicEvidence}}';
 const cvParagraph=selectedCv&&confirmCvQuote===true?'My CV records the following relevant experience: "'+selectedCv+'". I would welcome a discussion about how this experience could support your team under the required supervision.':'{{cvEvidence}}';
 const substitutions={clinicName:name||'{{clinicName}}',practiceManager:manager.value||'Practice Manager',doctorName,clinicEvidence:clinicParagraph,cvEvidence:cvParagraph};
 const template=GP_APPLICATION_TEMPLATES.find(item=>item.variant===chosen);
 const body=template.body.replace(/\{\{(clinicName|practiceManager|doctorName|clinicEvidence|cvEvidence)\}\}/g,(match,key)=>substitutions[key]??match);
 const subjects=chosen==='C'?['Supervised GP enquiry for your community — '+(name||'{{clinicName}}'),'GP expression of interest — '+(name||'{{clinicName}}'),'General practice role enquiry — '+doctorName]:chosen==='A'?['GP application — '+(name||'{{clinicName}}')+' — '+doctorName,'Application for a supervised GP role — '+(name||'{{clinicName}}'),'GP opportunity enquiry — '+(name||'{{clinicName}}')]:['GP enquiry — '+(name||'{{clinicName}}'),'Expression of interest — '+doctorName,'Supervised GP role enquiry — '+(name||'{{clinicName}}')];
 if(/\{\{|\[\[(?:name|clinic|doctor|recipient)/i.test(body+' '+subjects.join(' '))&&!missingFields.includes('template_placeholders_require_review'))missingFields.push('template_placeholders_require_review');
 const provenance=[{kind:'advertisement',url:sourceURL,checkedAt:opportunity.lastSeenAt||opportunity.last_seen_at||null,status:'source_observation_not_vacancy_verification'},...(selectedClinic?[{kind:'clinic_quote',url:sourceURL,quote:selectedClinic,status:'exact_source_statement'}]:[]),...(selectedCv&&confirmCvQuote===true?[{kind:'cv_quote',cvVersionId,quote:selectedCv,status:'owner_confirmed_self_report_not_credential_verification'}]:[])];
 const warnings=[SOURCE_CAUTION,'RACGP FSP 2027.1 excludes applicants requiring Level 1 supervision; confirm the correct registration and training route.','PESCI is position-specific; the employer position description and supervised practice documentation require confirmation.','FSP eligibility, Level 1 supervision, registration, Medicare/19AB and visa requirements are separate checks; no eligibility is inferred.'];
 if(selectedClinic&&clinicParagraph.split(/\s+/).length>25)warnings.push('The selected complete source quote makes the clinic paragraph longer than 25 words; it was not truncated or reworded.');
 return {version:1,profileId:'arash',opportunityId:opportunity.id||null,cvVersionId:UUID.test(cvVersionId||'')?cvVersionId:null,templateName:template.name,variant:chosen,recommendedVariant,variantReasons:regional?['explicit_rural_or_mmm3_7_source_wording']:explicitNetwork&&urban?['published_network_and_urban_wording']:['independent_or_unknown_location_or_network_default'],subjects,body,recipients,dossier:{name:field(name,sourceURL,publishedOrg?.quote||name,publishedOrg?.method||'published_organization_label_not_verified_clinic'),address:opportunity.address?field(opportunity.address,sourceURL):contactField('address'),phone:opportunity.phone?field(opportunity.phone,sourceURL):contactField('phone'),website:safeURL(opportunity.website||opportunity.organizationWebsite)?field(safeURL(opportunity.website||opportunity.organizationWebsite),sourceURL):contactField('website'),sourcePage:field(sourceURL,sourceURL),practiceManager:manager,network,mmm:field(geography.monashMentioned.length?geography.monashMentioned.join(', '):null,sourceURL,'MMM '+geography.monashMentioned.join(', '),'advertisement_wording_not_verified_geography'),dpa:field(geography.dpaExcerpts.join(' | ')||null,sourceURL,geography.dpaExcerpts.join(' | '),'advertisement_wording_not_verified_geography'),activity:{value:sourceClosed?'source_closed_or_unavailable':sourceFresh?'recent_source_observation':'source_requires_refresh',status:'needs_review',sourceUrl:sourceURL,clinicOperatingStatus:'not_verified'},applicationType:{value:applicationType,status:'source_statement',sourceUrl:sourceURL}},readyForReview:missingFields.length===0,missingFields,provenance,clinicEvidenceCandidates,cvEvidenceCandidates,candidates:{clinic:clinicEvidenceCandidates,strengths:cvEvidenceCandidates},registrationCautions:warnings,automaticSending:false};
}

async function boundedText(request,max){
 if(Number(request.headers.get('Content-Length')||0)>max)fail('gp_package_payload_too_large',413);
 const reader=request.body?.getReader();if(!reader)return '';const chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail('gp_package_payload_too_large',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const data=new Uint8Array(size);let offset=0;for(const part of chunks){data.set(part,offset);offset+=part.byteLength;}try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{fail('invalid_gp_package_payload');}
}
function authorized(context){if(!context||context.profileId!=='arash'||typeof context.userId!=='string'||!context.userId||context.userId.includes(':')||typeof context.rest!=='function')fail('gp_workspace_required',403);}
export async function getGpApplicationPackage(env,context,opportunityId,options={}){
 authorized(context);if(!ID.test(opportunityId||''))fail('invalid_gp_opportunity');if(!env.OPPORTUNITY_DB)fail('gp_package_storage_missing',503);
 const row=await env.OPPORTUNITY_DB.prepare('SELECT * FROM opportunity_editions WHERE id=?').bind(opportunityId).first();
 if(!row||row.country!=='AU'||row.profile_scope==='amir'||row.opportunity_type!=='job')fail('gp_opportunity_not_available',404);
 let source;try{source=JSON.parse(row.data);}catch{fail('gp_source_unavailable',409);}
 source={...source,id:row.id,title:row.title,url:row.url,status:row.status,lastSeenAt:row.last_seen_at,closingAt:row.closing_at,publishedAt:row.published_at};
 if(env.PUBLIC_PAGE_READING_ENABLED==='true'){
  try{const [enriched]=await enrichReadPages(env.OPPORTUNITY_DB,[row],'arash',Date.now(),true);if(['read','read_partial'].includes(enriched?.reading?.status))source={...source,fullText:enriched.fullText,reading:enriched.reading,contactEvidence:enriched.contactEvidence||[],enrichment:enriched.enrichment||null};}catch{/* No stale/unavailable reading manufactures public evidence. */}
 }
 const own='&profile_id=eq.arash&user_id=eq.'+encodeURIComponent(context.userId);
 let selected=options.cvVersionId||null;if(selected&&!UUID.test(selected))fail('invalid_gp_cv_version');
 if(!selected){const defaults=await context.rest('immi_cv_defaults','?select=version_id'+own);selected=defaults?.[0]?.version_id||null;}
 if(selected&&!UUID.test(selected))fail('invalid_gp_cv_version');
 const [profiles,cvs]=await Promise.all([context.rest('immi_profiles','?select=data'+own),selected?context.rest('immi_cv_versions','?select=id,text,version'+own+'&id=eq.'+selected):Promise.resolve([])]);
 if(options.cvVersionId&&!cvs?.[0])fail('owned_gp_cv_not_found',404);
 const cv=cvs?.[0];return buildGpApplicationPackage({opportunity:source,profile:profiles?.[0]?.data||{},cvText:cv?.text||'',cvVersionId:cv?selected:null,variant:options.variant||'auto',clinicQuote:options.clinicQuote||'',cvQuote:options.cvQuote||'',confirmCvQuote:options.confirmCvQuote===true,now:Date.now()});
}
export async function installGpApplicationTemplates(context){
 authorized(context);
 const names=GP_APPLICATION_TEMPLATES.map(item=>item.name),filter='('+names.map(name=>'"'+name+'"').join(',')+')';
 const own='&profile_id=eq.arash&user_id=eq.'+encodeURIComponent(context.userId);
 const rows=await context.rest('immi_presets','?select=name'+own+'&name=in.'+encodeURIComponent(filter)+'&limit=100');
 const existingSet=new Set((Array.isArray(rows)?rows:[]).map(row=>row.name||row.data?.name).filter(Boolean)),added=[],existing=[];
 for(const item of GP_APPLICATION_TEMPLATES){
  if(existingSet.has(item.name)){existing.push(item.name);continue;}
  await context.rest('rpc/immi_save_preset','',{method:'POST',body:JSON.stringify({p_name:item.name,p_subject:item.subject,p_body:item.body})});
  added.push(item.name);existingSet.add(item.name);
 }
 return {added,existing,addedCount:added.length,existingCount:existing.length,defaultChanged:false,automaticSending:false};
}
export async function handleGpApplicationPackageRequest(request,env,context){
 const url=new URL(request.url),installer=url.pathname==='/api/gp-applications/templates',match=/^\/api\/gp-applications\/(opp_[a-f0-9]{32})\/package$/.exec(url.pathname);if(!match&&!installer)return null;
 try{
  authorized(context);for(const key of url.searchParams.keys())if(!(installer?['profile']:['profile','variant','cvVersionId']).includes(key)||url.searchParams.getAll(key).length!==1)fail('unexpected_gp_package_query');if(installer){
   if(url.searchParams.has('profile')&&url.searchParams.get('profile')!=='arash')fail('profile_access_denied',403);
   if(request.method!=='POST')fail('method_not_allowed',405);if(request.headers.get('Origin')!==url.origin)fail('origin_rejected',403);
   if(Number(request.headers.get('Content-Length')||0)>500)fail('gp_package_payload_too_large',413);
   const raw=await boundedText(request,500);
   let input;try{input=JSON.parse(raw||'{}');}catch{fail('invalid_gp_package_payload');}
   if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length)fail('unexpected_gp_package_field');
   return json(await installGpApplicationTemplates(context));
  }
if(url.searchParams.has('profile')&&url.searchParams.get('profile')!=='arash')fail('profile_access_denied',403);
  if(!['GET','POST'].includes(request.method))fail('method_not_allowed',405);
  let options={variant:url.searchParams.get('variant')||'auto',cvVersionId:url.searchParams.get('cvVersionId')||null};
  if(request.method==='POST'){
   if(request.headers.get('Origin')!==url.origin)fail('origin_rejected',403);
   if(Number(request.headers.get('Content-Length')||0)>6000)fail('gp_package_payload_too_large',413);
   const raw=await boundedText(request,6000);let input;try{input=JSON.parse(raw);}catch{fail('invalid_gp_package_payload');}
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['variant','cvVersionId','clinicQuote','cvQuote','confirmCvQuote'].includes(key)))fail('unexpected_gp_package_field');
   if(input.clinicQuote!=null&&(typeof input.clinicQuote!=='string'||input.clinicQuote.length>600)||input.cvQuote!=null&&(typeof input.cvQuote!=='string'||input.cvQuote.length>600)||input.confirmCvQuote!=null&&typeof input.confirmCvQuote!=='boolean')fail('invalid_gp_package_quote');options={...options,...input};
  }
  if(!['auto',...VARIANTS].includes(options.variant)||options.cvVersionId&&!UUID.test(options.cvVersionId))fail('invalid_gp_package_options');
  return json(await getGpApplicationPackage(env,context,match[1],options));
 }catch(error){return json({error:Number.isInteger(error.status)?error.message:'gp_package_unavailable'},Number.isInteger(error.status)?error.status:503);}
}
