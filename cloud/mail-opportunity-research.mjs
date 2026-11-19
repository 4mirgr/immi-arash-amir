// Owner-private public-page enrichment for Gmail discoveries. Reading a clinic's
// page is evidence of its published wording, not an accepted job or supervision.
import {readQueuedPage,PUBLIC_PAGE_REQUEST_LIMIT} from './public-page-worker.mjs';
import {buildClinicResearchContext,selectClinicResearchLinks,extractClinicResearchStatements} from './clinic-research-context.mjs';
import {prepareMailOpportunityDraft} from './mail-opportunities.mjs';
import {checkAutomationMembership} from './automation-membership.mjs';
import {assessOpportunityFit} from './opportunity-fit.mjs';
import {MAIL_LEAD_DISCOVERY_VERSION,mailLeadPublicURL,mailEmployerPublicURL,mailPublicEmployerHints,inferMailLeadEmployerName,mailPageNamesEmployer,mailEmployerIdentityEvidence,resolveOwnedMailClinicSource,selectMailEmployerLinks,discoverMailClinicSocialLinks,hasFreshMailPublicEmployerEvidence,upsertOwnedMailClinicEvidence} from './mail-lead-discovery.mjs';
import {discoverMailEmployerSearch} from './mail-lead-search.mjs';

const DAY=86400000,LEASE_MS=6*60000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID=/^mop_[a-f0-9]{32}$/;
const NO_REPLY=/^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|alerts?|notifications?|updates?|newsletters?|bounce)[+@._-]/i;
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const parse=value=>{try{const out=JSON.parse(value||'{}');return out&&typeof out==='object'&&!Array.isArray(out)?out:{};}catch{return {};}};
const text=(value,max=1000)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const hostname=value=>new URL(value).hostname.toLowerCase().replace(/^www\./,'');
const readOK=record=>['read','read_partial'].includes(record?.status);
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)&&!NO_REPLY.test(value);

/** No credentials, authenticated social pages or guessed email-domain roots. */
export function mailResearchURL(value){
 return mailLeadPublicURL(value);
}
function safeContext(row){
 const root=row.root_owner_id,secondary=row.owner_id===root+':secondary';
 if(!ID.test(row.id)||!UUID.test(root||'')||row.profile_id!=='arash'||row.owner_id!==root&&!secondary)return null;
 return {userId:row.owner_id,rootUserId:root,profileId:'arash',mailbox:secondary?'secondary':'primary',googleSubject:row.google_sub};
}
function employerName(record){
 const match=text(record?.title,500).match(/\b([A-Z][A-Za-z'&.-]*(?:\s+[A-Z][A-Za-z'&.-]*){0,6}\s+(?:Medical (?:Centre|Center|Practice|Clinic)|Family Practice|Medical Surgery|Health Clinic|Surgery))\b/);
 return match?text(match[1],180):'';
}
/** Only actual primary-page employment wording can restrict this position. */
export function assessMailResearchSource(record,row,now=Date.now()){
 const fullText=typeof record.text==='string'?record.text.slice(0,50000):'',sourceURL=record.finalUrl||record.url,checkedAt=new Date(now).toISOString();
 const assessment=assessOpportunityFit({title:row.title||record.title,country:'AU',opportunityType:'job',fullText,url:sourceURL},'arash'),restrictions=[];
 // "No sponsorship required" describes a requirement, not an employer's
 // explicit refusal to sponsor. Preserve any separate actual refusal.
 const sponsorship=assessment.signals.sponsorship;
 if(sponsorship){const excerpts=sponsorship.excerpts.filter(item=>!/^\s*(?:no|without)\s+(?:(?:work\s+)?visa\s+|employer\s+)?sponsorship\s+(?:(?:is|will be)\s+)?(?:required|needed|necessary)\s*[.!?]?\s*$/i.test(item.text));assessment.signals.sponsorship={...sponsorship,excerpts,status:excerpts.some(item=>item.status==='restricted')?'restricted':excerpts.some(item=>item.status==='supported')?'supported':'not_stated'};}
 const parts=fullText.split(/\n+|(?<=[.!?;])\s+/).map(part=>part.trim()).filter(part=>part.length>=3&&part.length<=1200);
 const add=(code,quote)=>{if(!restrictions.some(item=>item.code===code))restrictions.push({code,sourceURL,quote:text(quote,600),checkedAt});};
 const closure=/\b(?:applications?\s+(?:(?:for\s+(?:this|the)\s+(?:GP\s+)?(?:position|role)\s+)?(?:are|is|have|has)\s+)?(?:now\s+|been\s+)?closed|(?:this\s+)?(?:GP\s+)?(?:position|vacancy|role|job)\s+(?:(?:has\s+been|is|was)\s+)?(?:filled|closed|withdrawn)|(?:this\s+)?(?:position|vacancy|role|job)\s+(?:is\s+)?no\s+longer\s+(?:available|open)|(?:we\s+are\s+)?(?:not|no\s+longer)\s+(?:currently\s+)?(?:recruiting|hiring)\s+(?:GPs?|general practitioners?))\b/i;
 for(const clause of parts){
  if(closure.test(clause)&&!/\b(?:vaccinations?|immunisations?|immunizations?|patient intake|appointments?)\b/i.test(clause))add('source_applications_closed',clause);
  if(!/\b(?:not required|not essential|not mandatory|preferred|working towards|non[- ]VR|not restricted|not limited)\b/i.test(clause)&&(/\b(?:FRACGP|FACRRM)\b[^.!?;]{0,40}\bonly\b|\bonly\b[^.!?;]{0,40}\b(?:FRACGP|FACRRM)\b|\b(?:VR GPs? only|only VR GPs?|must (?:have|hold) VR status)\b/i.test(clause)))add('source_registration_restricted',clause);
  if(!/\b(?:not required|not essential|preferred|working towards|non[- ]VR)\b/i.test(clause)&&/\b(?:seeking|recruiting|looking for|require)\b[^.!?;]{0,80}\b(?:a\s+)?(?:Vocationally Registered\s*(?:\(VR\))?|VR)\s+GP\b/i.test(clause))add('source_registration_restricted',clause);
  if(/\b(?:must|need to|required to)\s+(?:reside|live|be based)\s+in Australia\b/i.test(clause))add('source_australian_residence_required',clause);
 }
 // Qualifications listed under an explicit applicant/requirements heading are
 // requirements even when each bullet does not repeat "must" or "required".
 const requirementSection=fullText.match(/\b(?:requirements?|essential (?:criteria|qualifications)|about you|what you (?:will|need to))\s*:?([\s\S]{0,1800})/i)?.[1]?.split(/\b(?:benefits|what we offer|why join|how to apply|apply here|about us)\b/i)[0]||'';
 const qualifications=requirementSection.split(/\n+|(?<=[.!?;])\s+/).map(part=>part.trim()).filter(Boolean);
 const restrictedQualification=qualifications.find(part=>/\b(?:FRACGP|FACRRM|Vocational Registration)\b/i.test(part)&&!/(?:not required|not essential|not mandatory|preferred|working towards|non[- ]VR)/i.test(part));
 if(restrictedQualification)add('source_registration_restricted',restrictedQualification);
 const residence=qualifications.find(part=>/\b(?:reside|live|be based)\s+in Australia\b/i.test(part));if(residence)add('source_australian_residence_required',residence);
 const registration=restrictions.find(item=>item.code==='source_registration_restricted');
 if(registration)assessment.signals.registration={...assessment.signals.registration,status:'restricted',excerpts:[{text:registration.quote,status:'restricted',reason:'stated_qualification_prerequisite'},...(assessment.signals.registration?.excerpts||[])].slice(0,3)};
 for(const field of ['level1','sponsorship','registration','img','supervision'])if(assessment.signals[field]?.status==='restricted')add('source_'+field+'_restricted',assessment.signals[field].excerpts.find(item=>item.status==='restricted')?.text||'');
 const deadlines=[];
 for(const match of fullText.matchAll(/\b(?:closing date|applications? close|application deadline|deadline for applications?)\s*[:–—-]?\s*(\d{4}-\d{2}-\d{2}(?:T[^\s<]+)?|\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/gi)){
  const parsed=Date.parse(match[1]),dateOnly=!/T/.test(match[1]);if(Number.isFinite(parsed))deadlines.push({at:parsed+(dateOnly?DAY-1:0),quote:match[0]});
 }
 const structured=(record.enrichment?.publicationDates||[]).filter(item=>item.field==='validThrough'&&Number.isFinite(Date.parse(item.value)));
 if(structured.length===1){const item=structured[0],parsed=Date.parse(item.value);deadlines.push({at:parsed+(/^\d{4}-\d{2}-\d{2}$/.test(item.value)?DAY-1:0),quote:item.quote||'validThrough: '+item.value});}
 const expired=deadlines.find(item=>item.at<=now);if(expired)add('source_deadline_expired',expired.quote);
 return {restrictions,sourceReviewRequired:restrictions.length>0,publicationClosed:restrictions.some(item=>['source_applications_closed','source_deadline_expired'].includes(item.code)),closesAt:deadlines.length?new Date(Math.min(...deadlines.map(item=>item.at))).toISOString():null,assessment,sourceURL,checkedAt};
}
function publicEvidence(pages,rootURL,name,now){
 const normalizedHost=hostname(rootURL),successful=pages.filter(page=>readOK(page)&&mailEmployerPublicURL(page.finalUrl||page.url)&&hostname(page.finalUrl||page.url)===normalizedHost),identity=successful.map(page=>mailEmployerIdentityEvidence(page,name,now)).filter(Boolean),clinicalPages=identity.length?successful:[];
 const compatibleRoot=new URL(rootURL);compatibleRoot.search='';
 const research=buildClinicResearchContext({rootURL:compatibleRoot.href,observedAt:new Date(now).toISOString(),pages:clinicalPages.filter(page=>!new URL(page.finalUrl||page.url).search)});
 research.sourcePages=pages.map(page=>({url:page.url,sourceURL:page.finalUrl||page.url,status:page.status,readAt:page.readAt||new Date(now).toISOString(),kind:page.kind||'root'}));
 const facts=new Map(research.facts.map(fact=>[fact.text,fact]));
 for(const page of clinicalPages)for(const fact of extractClinicResearchStatements(page.text,page.title,8))if(facts.size<24&&!facts.has(fact.text))facts.set(fact.text,{...fact,sourceURL:page.finalUrl||page.url,readAt:new Date(now).toISOString()});
 research.facts=[...facts.values()];research.validUntil=now+7*DAY;
 research.publicEmployerVerified=identity.length>0;
 research.verification={version:MAIL_LEAD_DISCOVERY_VERSION,officialSourceURL:rootURL,clinicName:name,checkedAt:new Date(now).toISOString(),identityEvidence:identity.slice(0,3)};
 const contacts=new Map(),publicContacts=new Map();
 for(const page of successful){
  if(!identity.length)continue;
  const source=page.finalUrl||page.url;
  for(const contact of page.enrichment?.contacts||[]){
   if(!['email','phone','website','social'].includes(contact?.type)||typeof contact.quote!=='string'||mailResearchURL(contact.sourceURL||contact.sourceUrl)!==mailResearchURL(source))continue;
   const published={type:contact.type,value:contact.value,quote:text(contact.quote,500),sourceURL:source,readAt:new Date(now).toISOString(),method:contact.method,contactRole:contact.contactRole,sourceRelation:page===successful[0]?'same_page':'linked_page'};
   const accepted=contact.type==='email'?validEmail(contact.value)&&contact.quote.toLowerCase().includes(contact.value.toLowerCase()):contact.type==='phone'?typeof contact.value==='string'&&/^\+?[\d ().-]{6,30}$/.test(contact.value):Boolean(mailLeadPublicURL(contact.value,{social:contact.type==='social'}));
   if(!accepted)continue;
   if(publicContacts.size<30)publicContacts.set(contact.type+'\n'+contact.value,published);
   if(contact.type!=='email')continue;
   if(contacts.size<20)contacts.set(contact.value.toLowerCase(),{...contact,value:contact.value.toLowerCase(),readAt:new Date(now).toISOString(),sourceRelation:page===successful[0]?'same_page':'linked_page'});
  }
 }
 const ordered=[...contacts.values()].sort((a,b)=>['application','organization_general','unknown'].indexOf(a.contactRole)-['application','organization_general','unknown'].indexOf(b.contactRole));
 research.publicContactEvidence=[...publicContacts.values()];
 return {research,contacts:ordered,clinicalFacts:research.facts.filter(fact=>['services','team','training','recruitment'].includes(fact.category)).map(fact=>fact.text).slice(0,24),clinicalSourceUrl:research.facts[0]?.sourceURL||null};
}

/** Independent scheduled lane: one private opportunity, <=6 public HTTP reads. */
export async function dispatchMailOpportunityResearch(env,{fetcher=fetch,now=Date.now(),writingContextProvider,membership=checkAutomationMembership,pageReader=readQueuedPage,sleep}={}){
 if(env.MAIL_OPPORTUNITY_RESEARCH_ENABLED!=='true'||!env.GOOGLE_DB)return {attempted:0,status:'disabled'};
 if(!Number.isSafeInteger(now)||now<0)return {attempted:0,status:'invalid_scheduled_time'};
 const db=env.GOOGLE_DB,exists=await first(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='private_mail_opportunity_research'");
 if(!exists)return {attempted:0,status:'research_storage_required'};
 const selected=await first(db,`SELECT o.id,o.owner_id,o.root_owner_id,o.google_sub,o.profile_id,o.updated_at
  FROM private_mail_opportunities o JOIN google_accounts g ON g.owner_id=o.owner_id AND g.google_sub=o.google_sub AND g.profile_id=o.profile_id AND g.status='connected'
  LEFT JOIN private_mail_opportunity_research r ON r.opportunity_id=o.id AND r.owner_id=o.owner_id AND r.google_sub=o.google_sub
  WHERE o.profile_id='arash' AND o.status IN ('suggested','reviewed') AND coalesce(r.lease_until,0)<=?
  AND (r.opportunity_id IS NULL OR r.next_attempt_at<=? OR r.source_updated_at<o.updated_at OR coalesce(json_extract(CASE WHEN json_valid(r.receipt_json) THEN r.receipt_json ELSE '{}' END,'$.discoveryVersion'),0)<?)
  ORDER BY coalesce(r.next_attempt_at,0),o.received_at DESC,o.id LIMIT 1`,now,now,MAIL_LEAD_DISCOVERY_VERSION);
 if(!selected)return {attempted:0,status:'idle'};
 const context=safeContext(selected);if(!context)return {attempted:0,status:'owner_invalid'};
 if((await membership(env,context.rootUserId,'arash',fetcher))?.active!==true)return {attempted:0,status:'membership_unavailable'};
 const row=await first(db,"SELECT * FROM private_mail_opportunities WHERE id=? AND owner_id=? AND google_sub=? AND status IN ('suggested','reviewed')",selected.id,context.userId,context.googleSubject);
 if(!row)return {attempted:0,status:'source_changed'};
 const lease=await first(db,`INSERT INTO private_mail_opportunity_research(opportunity_id,owner_id,google_sub,status,attempts,next_attempt_at,lease_until,source_updated_at)
  VALUES(?,?,?,'reading',1,0,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET owner_id=excluded.owner_id,google_sub=excluded.google_sub,status='reading',attempts=private_mail_opportunity_research.attempts+1,lease_until=excluded.lease_until,source_updated_at=excluded.source_updated_at
  WHERE private_mail_opportunity_research.lease_until<=? RETURNING attempts,receipt_json`,row.id,context.userId,context.googleSubject,now+LEASE_MS,row.updated_at,now);
 if(!lease)return {attempted:0,status:'already_reading'};
 const candidate=parse(row.data_json),pages=[],budget={remaining:PUBLIC_PAGE_REQUEST_LIMIT};let finalStatus='failed',code=null,prepared=false,publicContacts=0,sourceVersion=row.updated_at,searchReceipt={status:'not_needed',candidates:[],searchRequests:0};
 const priorReceipt=parse(lease.receipt_json),priorAttempts=new Map((Array.isArray(priorReceipt.sourceAttempts)?priorReceipt.sourceAttempts:[]).filter(item=>mailLeadPublicURL(item?.url,{social:true})).map(item=>[item.url,item]));
 const knownSourceURLs=new Set((Array.isArray(priorReceipt.knownSourceURLs)?priorReceipt.knownSourceURLs:[]).filter(mailResearchURL)),unverifiedEmployerURLs=new Set();
 const prioritize=items=>items.map((item,index)=>({...item,index})).sort((a,b)=>(Number(priorAttempts.get(a.url)?.failures)||0)-(Number(priorAttempts.get(b.url)?.failures)||0)||a.index-b.index).map(({index,...item})=>item);
 const attemptedSources=()=>{
  const attempts=new Map(priorAttempts);for(const page of pages)attempts.set(page.url,{url:page.url,status:page.status,readAt:page.readAt,...(unverifiedEmployerURLs.has(page.url)?{employerIdentity:'unverified'}:{}),failures:readOK(page)&&!unverifiedEmployerURLs.has(page.url)?0:Math.min(10,(Number(attempts.get(page.url)?.failures)||0)+1)});
  return [...attempts.values()].slice(-24);
 };
 const finish=async(next)=>run(db,'UPDATE private_mail_opportunity_research SET status=?,next_attempt_at=?,lease_until=0,last_read_at=?,last_error=?,receipt_json=?,source_updated_at=? WHERE opportunity_id=? AND owner_id=? AND google_sub=? AND lease_until=?',finalStatus,next,now,code,JSON.stringify({discoveryVersion:MAIL_LEAD_DISCOVERY_VERSION,pages:pages.length,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,contacts:publicContacts,draftReady:prepared,searchStatus:searchReceipt.status,searchRequests:searchReceipt.searchRequests,sourceAttempts:attemptedSources(),knownSourceURLs:[...knownSourceURLs].slice(-12)}),sourceVersion,row.id,context.userId,context.googleSubject,now+LEASE_MS);
 // A later failed check invalidates earlier green state. Patch only the guard
 // fields, preserving concurrent owner text/CV changes for this same source.
 const invalidateSource=async(reason)=>{
  const invalidated=await first(db,`UPDATE private_mail_opportunities SET
   data_json=json_set(CASE WHEN json_valid(data_json) THEN data_json ELSE '{}' END,'$.sourceUnavailable',json('true'),'$.sourceUnavailableReason',?,'$.sourceUnavailableAt',?),
   draft_json=json_set(CASE WHEN json_valid(draft_json) THEN draft_json ELSE '{}' END,'$.status','needs_source_review','$.readyForReview',json('false'),'$.missing',json('["latest_source_reading_required"]')),
   notification_eligible=0,updated_at=max(updated_at,?)
   WHERE id=? AND owner_id=? AND google_sub=? AND source_url IS ? AND status IN ('suggested','reviewed') RETURNING updated_at`,reason,now,now,row.id,context.userId,context.googleSubject,row.source_url);
  if(invalidated)sourceVersion=invalidated.updated_at;
 };
 try{
  const hints=prioritize(mailPublicEmployerHints(candidate,now)),leadName=inferMailLeadEmployerName(candidate)||hints.find(item=>item.clinicName)?.clinicName||'';
  let url=mailResearchURL(row.source_url||candidate.sourceUrl),bank=null;
  if(!url){bank=await resolveOwnedMailClinicSource(db,context,candidate);url=bank?.url||null;}
  if(!url&&hints.length)url=hints[0].url;
  let searched=false;
  const search=async()=>{if(searched)return;searched=true;searchReceipt=await discoverMailEmployerSearch(env,context,{...candidate,clinicName:leadName},{fetcher,now,budget});hints.push(...prioritize(searchReceipt.candidates.map(item=>({...item,method:item.discoveryMethod}))));};
  for(const item of [...(url?[{url}]:[]),...(bank?[bank]:[]),...hints])knownSourceURLs.add(item.url);
  // Persistent but unusable URLs must not prevent wider discovery forever.
  // Reserve search's two requests before repeating reads on a later attempt.
  if(Number(lease.attempts)>1&&knownSourceURLs.size&&[...knownSourceURLs].every(known=>Number(priorAttempts.get(known)?.failures)>0)){
   await search();const discovered=prioritize(searchReceipt.candidates);if(discovered.length)url=discovered[0].url;
  }
  if(!url){await search();url=hints[0]?.url||null;}
  if(!url){finalStatus='blocked';code='public_employer_source_required';await invalidateSource(code);await finish(now+DAY);return {attempted:1,status:finalStatus,code,publicRequests:0,draftReady:false};}
  const base=hostname(url),read=async(target,kind='root')=>{
   const result=await pageReader({id:row.id,url:target,data:JSON.stringify({officialBases:[hostname(target)]})},fetcher,sleep,budget);
   const record={...result,url:target,readAt:new Date(now).toISOString(),kind};pages.push(record);return record;
  };
  let root=await read(url);const originalReading=root,originalUnavailable=!readOK(root),originalURL=mailResearchURL(row.source_url||candidate.sourceUrl),socialOriginal=!originalURL,switchedOriginal=Boolean(originalURL&&originalURL!==url);
  if(originalUnavailable){
   if(!bank)bank=await resolveOwnedMailClinicSource(db,context,{...candidate,clinicName:leadName});
   let alternatives=prioritize([...(bank?[{url:bank.url}]:[]),...hints].filter(item=>mailResearchURL(item.url)&&item.url!==url));
   for(const alternative of alternatives)knownSourceURLs.add(alternative.url);
   if(!alternatives.length){await search();alternatives=hints.filter(item=>item.url!==url);}
   for(const alternative of alternatives.slice(0,3)){if(budget.remaining<2)break;const found=await read(alternative.url,'alternative_public_source');if(readOK(found)){root=found;break;}}
   if(!readOK(root)){finalStatus='blocked';code=/^[a-z_]{3,80}$/.test(originalReading.status||'')?originalReading.status:'reading_failed';await invalidateSource(code);await finish(now+Math.min(DAY,3600000*2**Math.min(6,Number(lease.attempts)-1)));return {attempted:1,status:finalStatus,code,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,draftReady:false};}
  }
  const rootSource=mailResearchURL(root.finalUrl||root.url);if(!rootSource||hostname(rootSource)!==hostname(root.url))throw Object.assign(Error('source_host_changed'),{code:'source_host_changed'});
  const clinicName=leadName||employerName(root);
  let employerRoot=mailEmployerIdentityEvidence(root,clinicName,now)?root:null,employerLink=null;
  if(!employerRoot){
   if(!bank)bank=await resolveOwnedMailClinicSource(db,context,{...candidate,clinicName});
   const selfSiteLinks=mailEmployerPublicURL(rootSource)?selectClinicResearchLinks(rootSource.replace(/\?.*$/,''),root.enrichment?.followLinks,{validateURL:mailResearchURL}).map(item=>({...item,method:'same_host_brand_check'})):[];
   let choices=[...(bank?[{url:bank.url,method:'own_bank_candidate'}]:[]),...hints.filter(item=>mailEmployerPublicURL(item.url)&&item.url!==rootSource),...selectMailEmployerLinks(root,clinicName),...selfSiteLinks];
   for(const choice of choices)knownSourceURLs.add(choice.url);
   if(!choices.length){await search();choices=hints.filter(item=>mailEmployerPublicURL(item.url)&&item.url!==rootSource);}
   for(const choice of prioritize(choices).slice(0,2)){
    if(budget.remaining<(hostname(choice.url)===hostname(rootSource)?1:2))break;
    const found=await read(choice.url,'employer');
    if(readOK(found)&&mailEmployerPublicURL(found.finalUrl||found.url)&&hostname(found.finalUrl||found.url)===hostname(choice.url)&&mailEmployerIdentityEvidence(found,clinicName,now)){employerRoot=found;employerLink=choice;break;}
   }
  }
  if(!employerRoot)for(const page of pages)if(readOK(page)&&page.kind!=='public_social')unverifiedEmployerURLs.add(page.url);
  const officialSource=employerRoot?.finalUrl||employerRoot?.url||rootSource,linkBase=new URL(officialSource);linkBase.search='';
  const following=employerRoot?prioritize(selectClinicResearchLinks(linkBase.href,employerRoot.enrichment?.followLinks,{hasEmail:(employerRoot.enrichment?.contacts||[]).some(contact=>contact.type==='email'),validateURL:mailResearchURL})):[];
  const previousPages=Array.isArray(candidate.research?.sourcePages)?candidate.research.sourcePages:[];
  following.sort((a,b)=>Number(previousPages.some(page=>page.url===a.url&&readOK(page)))-Number(previousPages.some(page=>page.url===b.url&&readOK(page))));
  // The employer's robots policy is already cached in this request budget, so
  // a remaining single request can still read its contact/services document.
  for(const link of following){if(budget.remaining<1)break;await read(link.url,link.kind);}
  const socialSources=employerRoot?discoverMailClinicSocialLinks(pages,officialSource):[];
  for(const social of socialSources.slice(0,1)){
   if(budget.remaining<2)break;
   const reading=await read(social.url,'public_social');social.status=reading.status;social.readAt=reading.readAt;social.sourceURL=reading.finalUrl||reading.url;
  }
  const evidence=publicEvidence(pages,officialSource,clinicName,now),allEmails=[...new Set(evidence.contacts.map(contact=>contact.value))];
  const suppressed=allEmails.length?new Set((await all(db,'SELECT email FROM mail_automation_suppressions WHERE owner_id=? AND email IN (SELECT value FROM json_each(?))',context.rootUserId,JSON.stringify(allEmails))).map(item=>item.email)):new Set();
  const contacts=evidence.contacts.filter(contact=>!suppressed.has(contact.value));publicContacts=contacts.length;
  const publishedFacts=evidence.clinicalFacts.length>0;
  const currentSource=assessMailResearchSource(root,row,now),relatedAssessments=pages.filter(page=>readOK(page)&&page!==root&&mailEmployerPublicURL(page.finalUrl||page.url)&&hostname(page.finalUrl||page.url)===hostname(officialSource)).map(page=>assessMailResearchSource(page,row,now));
  const priorRestrictions=Array.isArray(candidate.sourceRestrictions)?candidate.sourceRestrictions:[],restrictions=[...new Map([...priorRestrictions,...currentSource.restrictions,...relatedAssessments.flatMap(assessment=>assessment.restrictions)].map(item=>[item.code+'\n'+item.sourceURL,item])).values()].slice(0,12),reviewRequired=candidate.sourceReviewRequired===true||candidate.publicationClosed===true||restrictions.length>0;
  for(const assessment of relatedAssessments)for(const [field,signal] of Object.entries(assessment.assessment.signals))if(signal.status==='restricted'||signal.status==='supported'&&currentSource.assessment.signals[field]?.status==='not_stated')currentSource.assessment.signals[field]=signal;
  currentSource.restrictions=restrictions;currentSource.publicationClosed=currentSource.publicationClosed||relatedAssessments.some(assessment=>assessment.publicationClosed);currentSource.relatedSources=relatedAssessments.map(assessment=>({sourceURL:assessment.sourceURL,checkedAt:assessment.checkedAt,restrictions:assessment.restrictions}));
  const publicGPPosition=pages.some(page=>readOK(page)&&(/\b(?:general practitioner|GP)\b/i.test(page.title||'')&&/\b(?:requirements?|about you|the opportunity|the role|apply here|GP applications?|GP position)\b/i.test(page.text||'')||/\b(?:we (?:are )?(?:seeking|recruiting|looking for)|(?:GP|general practitioner) (?:vacancy|position|role))\b/i.test(page.text||'')));
  const applicationSourceVerified=(originalUnavailable||socialOriginal||switchedOriginal)?publicGPPosition:candidate.applicationSourceVerified!==false||publicGPPosition;
  const priorFit=parse(row.fit_json),signalStatus=field=>currentSource.assessment.signals[field]?.status==='supported'?'supported':currentSource.assessment.signals[field]?.status==='restricted'?'restricted':'unknown';
  const fit={...priorFit,level1:signalStatus('level1'),sponsorship:signalStatus('sponsorship'),registration:signalStatus('registration'),pesci:signalStatus('pesci'),priority:reviewRequired?'review':signalStatus('level1')==='supported'&&signalStatus('sponsorship')!=='restricted'?'high':'review',sourceReviewRequired:reviewRequired,sourceRestrictions:restrictions,sourceURL:currentSource.sourceURL,checkedAt:currentSource.checkedAt,assessment:'current_public_page_signals_not_acceptance_probability'};
  const updated={...candidate,clinicName,fit,sourceUnavailable:false,sourceUnavailableReason:null,sourceUnavailableAt:null,sourceReviewRequired:reviewRequired,sourceRestrictions:restrictions,publicationClosed:candidate.publicationClosed===true||currentSource.publicationClosed,...(currentSource.closesAt?{closesAt:currentSource.closesAt}:{}),applicationSourceVerified,publicationBasis:applicationSourceVerified?'public_source_reviewed':'clinic_enquiry_unverified_vacancy',notificationEligible:reviewRequired?false:candidate.notificationEligible,clinicalFacts:publishedFacts?evidence.clinicalFacts:[],clinicalFactBasis:publishedFacts?'source_published_statement':null,clinicalSourceUrl:publishedFacts?evidence.clinicalSourceUrl:null,research:{...evidence.research,...(bank?{matchedOwnBankLeadId:bank.leadId,matchedOwnBankURL:bank.bankURL||bank.url}:{}),contactEvidence:contacts,sourceAssessment:currentSource,originalAdvertisement:{sourceURL:row.source_url||candidate.sourceUrl,status:socialOriginal?'unread_social_lead':switchedOriginal?priorAttempts.get(originalURL)?.status||'unread_original':originalReading.status,readAt:switchedOriginal?priorAttempts.get(originalURL)?.readAt||null:originalReading.readAt},socialSources,discovery:{version:MAIL_LEAD_DISCOVERY_VERSION,employerSource:employerLink?.method||bank?.from||'published_employer_page',searchStatus:searchReceipt.status,coverage:'bounded_owned_bank_and_published_public_links',employerCandidates:hints.slice(0,4).map(item=>({url:item.url,discoveryMethod:item.method||item.discoveryMethod,status:pages.find(page=>page.url===item.url)?.status||'discovered_not_read'})),privateEmailIsLeadOnly:true}},researchStatus:employerRoot?'read':'needs_employer_source',researchReadAt:new Date(now).toISOString(),...(contacts.length?{recipient:contacts[0].value,recipients:contacts.map(contact=>contact.value),contactBasis:{kind:'source_published_research_contact',sourceUrl:contacts[0].sourceURL||contacts[0].sourceUrl,readAt:new Date(now).toISOString()}}:{recipient:null,recipients:[],contactBasis:null})};
  let writing={};if(typeof writingContextProvider==='function'){try{const found=await writingContextProvider(env,context,fetcher);if(found?.profile&&typeof found.cvText==='string')writing=found;}catch{code='own_writing_context_unavailable';}}
  const draft=await prepareMailOpportunityDraft(updated,writing,{now});
  if(reviewRequired||!hasFreshMailPublicEmployerEvidence(updated,{now})){draft.status='needs_source_review';draft.readyForReview=false;draft.missing=[...new Set([...(draft.missing||[]),...(reviewRequired?['current_source_requires_review',...restrictions.map(item=>item.code)]:[]),...(!hasFreshMailPublicEmployerEvidence(updated,{now})?['public_employer_verification_required']:[])])];}
  prepared=draft.readyForReview===true;
  if((await membership(env,context.rootUserId,'arash',fetcher))?.active!==true){finalStatus='blocked';code='membership_unavailable';await finish(now+3600000);return {attempted:1,status:finalStatus,code,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,draftReady:false};}
  const allSuppressed=allEmails.length>0&&!contacts.length;
  const mayNotify=prepared&&!allSuppressed&&!reviewRequired&&updated.notificationEligible!==false&&!updated.sourceIncomplete&&!updated.historyGap&&row.received_at>0&&row.received_at<=now+60000&&now-row.received_at<=14*DAY;
  const saved=await run(db,"UPDATE private_mail_opportunities SET data_json=?,draft_json=?,fit_json=?,updated_at=?,notification_eligible=? WHERE id=? AND owner_id=? AND google_sub=? AND updated_at=? AND data_json=? AND draft_json IS ? AND source_url IS ? AND status IN ('suggested','reviewed') AND EXISTS(SELECT 1 FROM google_accounts g WHERE g.owner_id=? AND g.google_sub=? AND g.profile_id='arash' AND g.status='connected')",JSON.stringify(updated),JSON.stringify(draft),JSON.stringify(fit),now,mayNotify?1:0,row.id,context.userId,context.googleSubject,row.updated_at,row.data_json,row.draft_json,row.source_url,context.userId,context.googleSubject);
  if(!saved.meta?.changes){finalStatus='deferred';code='source_changed';await finish(now+60000);return {attempted:1,status:finalStatus,code,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,draftReady:false};}
  sourceVersion=now;finalStatus='read';
  // A bank refresh failure cannot turn a safely saved letter into a failed
  // source reading; report it separately and retry through the existing bank.
  try{await upsertOwnedMailClinicEvidence(db,context,updated,{now,opportunityId:row.id,sourceVersion});}catch{code=code||'clinic_bank_refresh_failed';}
  await finish(now+(prepared?7*DAY:DAY));
  return {attempted:1,status:finalStatus,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,contacts:publicContacts,draftReady:prepared,...(code?{code}:{})};
 }catch(error){
  finalStatus='failed';code=/^[a-z_]{3,80}$/.test(error?.code||'')?error.code:'private_research_failed';await invalidateSource(code);await finish(now+Math.min(DAY,3600000*2**Math.min(6,Number(lease.attempts)-1)));
  return {attempted:1,status:finalStatus,code,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,draftReady:false};
 }
}
