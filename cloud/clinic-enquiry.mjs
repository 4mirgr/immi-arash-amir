// Review-only enquiries from the authenticated owner's verified website bank.
// No vacancy rows, queues, approvals, provider traffic or database writes.
import {clinicBankURL,clinicBankView,clinicBankClinicalExcerpt,CLINIC_BANK_REFRESH_MS} from './clinic-bank.mjs';
import {buildGpApplicationPackage} from './gp-application-package.mjs';
import {composeClinicParagraphs,readGpWritingProfile,suggestEvidencePair} from './gp-letter-composer.mjs';
const BASE='/api/clinic-bank/enquiry',ID=/^bank_[a-f0-9]{32}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const INSTRUCTION=/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|send.{0,40}(?:token|secret)|javascript:|<script/i;
const clean=(value,max=700)=>typeof value==='string'?value.replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const parse=value=>{try{const x=JSON.parse(value);return x&&typeof x==='object'&&!Array.isArray(x)?x:{};}catch{return {};}};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
function sameHost(value,root){const url=clinicBankURL(value);return url&&new URL(url).hostname.replace(/^www\./,'')===new URL(root).hostname.replace(/^www\./,'')?url:null;}
function publishedContacts(snapshot,root){
 const seen=new Set(),contacts=[];
 for(const item of Array.isArray(snapshot.contacts)?snapshot.contacts:[]){
  if(item?.type!=='email'||typeof item.value!=='string'||!EMAIL.test(item.value)||!['same_page','linked_page'].includes(item.sourceRelation))continue;
  const sourceURL=sameHost(item.sourceURL,root),quote=clean(item.quote),value=item.value.toLowerCase();
  if(!sourceURL||!quote.toLowerCase().includes(value)||INSTRUCTION.test(quote)||seen.has(value))continue;
  seen.add(value);contacts.push({value,sourceURL,quote,role:['application','organization_general'].includes(item.contactRole)?item.contactRole:'unknown',evidence:'published_contact_not_verified_recruiter'});
  if(contacts.length===20)break;
 }
 return contacts;
}
function clinicalQuotes(contacts,snapshot,root,stamp,fresh){
 const candidates=[];
 const storedSource=sameHost(snapshot.clinicalSourceURL,root),storedStamp=Date.parse(snapshot.clinicalReadAt||'');
 const stored=fresh&&storedSource&&Number.isFinite(storedStamp)&&storedStamp===stamp?clinicBankClinicalExcerpt(snapshot.clinicalText):'';
 for(const contact of [...(stored?[{quote:stored,sourceURL:storedSource}]:[]),...contacts]){
  for(const sentence of clinicBankClinicalExcerpt(contact.quote).split('\n')){
   if(sentence&&!candidates.some(x=>x.text===sentence))candidates.push({text:sentence,sourceUrl:contact.sourceURL,status:'source_statement_requires_review'});
  }
 }
 return candidates.slice(0,12);
}
export async function handleClinicEnquiryRequest(request,env,context,at=Date.now()){
 const url=new URL(request.url);if(url.pathname!==BASE)return null;
 if(!UUID.test(context?.userId||'')||context.profileId!=='arash'||typeof context.rest!=='function')return json({error:'profile_access_denied'},403);
 if(url.searchParams.has('profile')&&url.searchParams.get('profile')!=='arash')return json({error:'profile_access_denied'},403);
 if(request.method!=='GET')return json({error:'method_not_allowed'},405);
 for(const key of url.searchParams.keys())if(!['profile','id','cvVersionId'].includes(key)||url.searchParams.getAll(key).length!==1)return json({error:'invalid_enquiry_query'},400);
 const id=url.searchParams.get('id'),selected=url.searchParams.get('cvVersionId');
 if(!ID.test(id||'')||selected&&!UUID.test(selected))return json({error:'invalid_enquiry_query'},400);
 if(!env.GOOGLE_DB)return json({error:'clinic_bank_not_configured'},503);
 try{
  const row=await env.GOOGLE_DB.prepare("SELECT * FROM clinic_bank_leads WHERE id=? AND owner_id=? AND profile_id='arash'").bind(id,context.userId).first();
  if(!row)return json({error:'clinic_enquiry_not_found'},404);
  const root=clinicBankURL(row.url);if(!root)return json({error:'clinic_enquiry_source_unavailable'},409);
  const snapshot=parse(row.result_json),view=clinicBankView(row,at),stamp=Date.parse(snapshot.contactsReadAt||row.last_success_at||'');
  const fresh=['public_contacts_found','public_page_read'].includes(row.status)&&Number.isFinite(stamp)&&stamp<=at&&at-stamp<=CLINIC_BANK_REFRESH_MS;
  const recipients=fresh?publishedContacts(snapshot,root):[],quotes=clinicalQuotes(recipients,snapshot,root,stamp,fresh),sourceTitle=clean(snapshot.title,180);
  // Use a published website title only; never promote an imported spreadsheet
  // name into independently verified clinic identity.
  const clinicName=/\b(?:medical|clinic|health|practice|surgery)\b/i.test(sourceTitle)&&!INSTRUCTION.test(sourceTitle)?sourceTitle:null;
  const own='&profile_id=eq.arash&user_id=eq.'+encodeURIComponent(context.userId);
  let cvId=selected;
  if(!cvId){const defaults=await context.rest('immi_cv_defaults','?select=version_id'+own+'&limit=1');cvId=defaults?.[0]?.version_id||null;}
  if(cvId&&!UUID.test(cvId))return json({error:'owned_enquiry_cv_missing'},409);
  const [profiles,cvs]=await Promise.all([context.rest('immi_profiles','?select=data'+own+'&limit=1'),cvId?context.rest('immi_cv_versions','?select=id,text,version'+own+'&id=eq.'+cvId+'&limit=1'):Promise.resolve([])]);
  const profile=profiles?.[0]?.data||{},cv=cvs?.[0]?.id===cvId?cvs[0]:null;
  if(selected&&!cv)return json({error:'owned_enquiry_cv_missing'},404);
  const writing=readGpWritingProfile(profile),cvText=typeof cv?.text==='string'?cv.text:'';
  const helper=buildGpApplicationPackage({profile,cvText,cvVersionId:cv?.id||null,opportunity:{url:root,kind:'employment_register',opportunityType:'lead',title:'GP enquiry',organization:clinicName||'',lastSeenAt:fresh?new Date(stamp).toISOString():null},now:at});
  const pair=suggestEvidencePair(quotes,helper.cvEvidenceCandidates),cvQuote=pair?.cvQuote||helper.cvEvidenceCandidates[0]?.text||null;
  const value=cvQuote?composeClinicParagraphs({cvQuote,confirmed:true}).candidateValue:null;
  const clinic=pair&&clinicName?composeClinicParagraphs({clinicName,clinicQuote:pair.clinicQuote,cvQuote,confirmed:true}).clinicReason:null;
  const doctorName=clean(profile.name||profile.fullName||profile.full_name,150)||'Dr Arash Entezar';
  const paragraphs={opening:writing.confirmed?writing.opening:null,clinic,value,closing:writing.confirmed?writing.closing:null};
  const missingEvidence=[];
  if(!fresh)missingEvidence.push('fresh_public_read_required');
  if(!recipients.length)missingEvidence.push('published_email_required');
  if(!clinicName)missingEvidence.push('published_clinic_name_required');
  if(!quotes.length)missingEvidence.push('clinic_services_quote_required');
  if(!writing.confirmed)missingEvidence.push('writing_profile_confirmation_required');
  if(!cv||!cvQuote)missingEvidence.push('owned_cv_evidence_required');
  const complete=Object.values(paragraphs).every(Boolean)&&fresh&&recipients.length>0;
  const body=complete?'Dear Practice Manager,\n\n'+Object.values(paragraphs).join('\n\n')+'\n\nKind regards,\n'+doctorName+[writing.signaturePhone,writing.signatureEmail].filter(Boolean).map(x=>'\n'+x).join(''):null;
  return json({profileId:'arash',leadId:row.id,clinic:{name:clinicName,importedLabel:clean(row.name,180),url:root,nameStatus:clinicName?'published_title_requires_review':'not_verified'},source:{status:fresh?'current_public_observation':'refresh_required',readAt:view.readAt,stale:!fresh},recipients,draft:{subject:clinicName?'GP expression of interest — '+clinicName:'GP expression of interest',body,paragraphs,status:body?'unreviewed_enquiry':'insufficient_evidence',cvVersionId:cv?.id||null,cvQuote,clinicQuote:pair?.clinicQuote||null,clinicQuoteSourceURL:pair?quotes.find(x=>x.text===pair.clinicQuote)?.sourceUrl||null:null,doctorName},missingEvidence,leadOnly:true,vacancyVerified:false,supervisionVerified:false,sendingApproved:false,automaticSending:false,providerAction:false});
 }catch{return json({error:'clinic_enquiry_unavailable'},503);}
}
