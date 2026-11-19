// Adapt this owner's actually-read clinic cache into the minimum evidence for
// an initial enquiry. Imported names/addresses alone never supply publication.
import {assessMailOutreachEvidence,inferMailLeadEmployerName,normalizeMailClinicName,mailEmployerPublicURL,mailLeadPublicURL,isMailEmploymentBoard,mailEmployerIdentityEvidence,mailPublishedEmail,MAIL_LEAD_DISCOVERY_VERSION,MAIL_PUBLIC_EVIDENCE_MAX_AGE} from './mail-lead-discovery.mjs';
import {extractClinicResearchStatements} from './clinic-research-context.mjs';
import {mergeClinicSourceRestrictions} from './clinic-source-restrictions.mjs';

const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const stamp=value=>typeof value==='number'?value:Date.parse(value||'');
const fresh=(value,now)=>Number.isFinite(stamp(value))&&stamp(value)<=now+60000&&now-stamp(value)<=MAIL_PUBLIC_EVIDENCE_MAX_AGE;
const readOK=value=>['read','read_partial'].includes(value);
const host=value=>new URL(value).hostname.toLowerCase().replace(/^www\./,'');
const badText=/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|javascript:|<script/i;

export function applyOwnedMailClinicBankProof(candidate,rows,{rootOwnerId,now=Date.now()}={}){
 const name=inferMailLeadEmployerName(candidate),target=normalizeMailClinicName(name);
 if(!target||!rootOwnerId)return candidate;
 const source=mailEmployerPublicURL(candidate.sourceUrl),matches=(Array.isArray(rows)?rows:[]).filter(row=>{
  const url=mailEmployerPublicURL(row.url);
  return row.owner_id===rootOwnerId&&row.profile_id==='arash'&&url&&(!source||host(source)===host(url))&&normalizeMailClinicName(row.name)===target;
 });
 // Exact names on different sites are ambiguous, even if only one has email.
 if(new Set(matches.map(row=>host(row.url))).size!==1||!source&&matches.some(row=>Number(row.name_domain_count)>1))return candidate;
 for(const row of matches.sort((a,b)=>stamp(b.last_success_at||b.read_at)-stamp(a.last_success_at||a.read_at))){
  const result=row.result||parse(row.result_json),official=mailEmployerPublicURL(result.sourceURL||row.url),at=row.last_success_at||row.read_at;
  if(!['public_contacts_found','public_page_read'].includes(row.status)||!official||host(official)!==host(row.url)||!fresh(at,now)||!readOK(result.sourceStatus)||!readOK(result.lastAttempt?.status)||!fresh(result.lastAttempt?.readAt,now))continue;
  const attemptURL=mailEmployerPublicURL(result.lastAttempt.sourceURL);
  if(!attemptURL||host(attemptURL)!==host(official)||stamp(result.lastAttempt.readAt)<stamp(at))continue;
  const identity=mailEmployerIdentityEvidence({status:result.sourceStatus,url:official,finalUrl:official,title:result.title,text:result.clinicalText||''},name,stamp(at));
  if(!identity)continue;
  const pages=[...(Array.isArray(result.research?.sourcePages)?result.research.sourcePages:[]),...(Array.isArray(result.linkedReadings)?result.linkedReadings:[]),{url:official,sourceURL:official,status:result.lastAttempt.status,readAt:result.lastAttempt.readAt,kind:'root'},...(Array.isArray(candidate.research?.sourcePages)?candidate.research.sourcePages:[])];
  const latestPage=value=>pages.map((page,index)=>({...page,index})).filter(page=>mailLeadPublicURL(page.sourceURL||page.url)===value).sort((a,b)=>stamp(b.readAt)-stamp(a.readAt)||b.index-a.index)[0];
  const proved=(value,time)=>{const url=mailEmployerPublicURL(value),page=url&&latestPage(url);return Boolean(url&&host(url)===host(official)&&fresh(time,now)&&page&&readOK(page.status)&&fresh(page.readAt,now)&&stamp(page.readAt)>=stamp(time));};
  const contactAt=result.contactsReadAt||at,contacts=(Array.isArray(result.contacts)?result.contacts:[]).filter(contact=>contact?.type==='email'&&mailPublishedEmail(contact.value)&&['same_page','linked_page'].includes(contact.sourceRelation)&&typeof contact.quote==='string'&&!badText.test(contact.quote)&&contact.quote.toLowerCase().includes(contact.value.toLowerCase())&&proved(contact.sourceURL||contact.sourceUrl,contact.readAt||contactAt)).map(contact=>({...contact,value:contact.value.toLowerCase(),sourceURL:contact.sourceURL||contact.sourceUrl,readAt:contact.readAt||contactAt}));
  const facts=(Array.isArray(result.research?.facts)?result.research.facts:[]).filter(fact=>['services','team','training','recruitment'].includes(fact?.category)&&proved(fact.sourceURL,fact.readAt)&&typeof fact.text==='string'&&!badText.test(fact.text));
  const clinicalSource=mailEmployerPublicURL(result.clinicalSourceURL),clinicalAt=result.clinicalReadAt;
  if(clinicalSource&&proved(clinicalSource,clinicalAt))for(const fact of extractClinicResearchStatements(result.clinicalText||'',result.title,12))if(!facts.some(item=>item.text===fact.text))facts.push({...fact,sourceURL:clinicalSource,readAt:clinicalAt});
  if(!contacts.length||!facts.length)continue;
  // A later failed employer reading remains authoritative. A successful new
  // bank observation can clear an older failure, retaining its prior receipt.
  const failedAt=stamp(candidate.sourceUnavailableAt),original=candidate.research?.originalAdvertisement,failedOriginal=mailLeadPublicURL(original?.sourceURL)||(original?.sourceURL===candidate.sourceUrl&&isMailEmploymentBoard(original.sourceURL)?original.sourceURL:null),jobOnlyFailure=Number.isFinite(failedAt)&&stamp(original?.readAt)>=failedAt&&failedOriginal&&failedOriginal!==official&&!readOK(original.status)&&![...contacts.map(contact=>contact.sourceURL),...facts.map(fact=>fact.sourceURL)].includes(failedOriginal);
  const unavailable=candidate.sourceUnavailable===true&&!jobOnlyFailure&&(!Number.isFinite(failedAt)||stamp(at)<failedAt);
  const research={...candidate.research,version:MAIL_LEAD_DISCOVERY_VERSION,observedAt:at,validUntil:stamp(at)+MAIL_PUBLIC_EVIDENCE_MAX_AGE,publicEmployerVerified:true,verification:{version:MAIL_LEAD_DISCOVERY_VERSION,officialSourceURL:official,clinicName:name,checkedAt:at,identityEvidence:[identity]},sourcePages:pages,facts,contactEvidence:contacts,matchedOwnBankLeadId:row.id,matchedOwnBankURL:row.url,scope:'fresh_owned_bank_minimum_for_initial_enquiry'};
  const cachedRestrictions=mergeClinicSourceRestrictions(result.sourceRestrictions,result.sourceAssessment?.restrictions,result.research?.sourceRestrictions,result.research?.sourceAssessment?.restrictions),sameRole=item=>mailLeadPublicURL(item.sourceURL)===mailLeadPublicURL(candidate.sourceUrl)&&Boolean(mailLeadPublicURL(candidate.sourceUrl));
  const applies=item=>sameRole(item)||item.scope==='clinic_policy'&&mailEmployerPublicURL(item.sourceURL)&&host(item.sourceURL)===host(official);
  const relevant=cachedRestrictions.filter(applies),priorRoleRestrictions=cachedRestrictions.filter(item=>!applies(item));
  const restrictions=[...new Map([...(Array.isArray(candidate.sourceRestrictions)?candidate.sourceRestrictions:[]),...relevant].map(item=>[item.code+'\n'+item.sourceURL,item])).values()].slice(0,24),publicationClosed=candidate.publicationClosed===true||restrictions.some(item=>['source_applications_closed','source_deadline_expired'].includes(item.code));
  const next={...candidate,clinicName:name,applicationSourceVerified:false,publicationBasis:'clinic_enquiry_unverified_vacancy',sourceUnavailable:unavailable,sourceRestrictions:restrictions,priorRoleRestrictions,sourceReviewRequired:candidate.sourceReviewRequired===true||restrictions.length>0,publicationClosed,recipient:contacts[0].value,recipients:[...new Set(contacts.map(contact=>contact.value))],contactBasis:{kind:'source_published_bank_contact',sourceUrl:contacts[0].sourceURL,readAt:contacts[0].readAt},clinicalFacts:facts.map(fact=>fact.text),clinicalFactBasis:'source_published_statement',clinicalSourceUrl:facts[0].sourceURL,research,researchStatus:'minimum_clinic_evidence',researchReadAt:at,overlap:{status:'verified_own_bank_match',leadId:row.id,url:row.url,readAt:at}};
  if(assessMailOutreachEvidence(next,{now}).verified)return next;
 }
 return candidate;
}
