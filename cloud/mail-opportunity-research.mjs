// Owner-private public-page enrichment for Gmail discoveries. Reading a clinic's
// page is evidence of its published wording, not an accepted job or supervision.
import {readQueuedPage,PUBLIC_PAGE_REQUEST_LIMIT} from './public-page-worker.mjs';
import {buildClinicResearchContext,selectClinicResearchLinks,extractClinicResearchStatements} from './clinic-research-context.mjs';
import {prepareMailOpportunityDraft} from './mail-opportunities.mjs';
import {checkAutomationMembership} from './automation-membership.mjs';
import {assessOpportunityFit} from './opportunity-fit.mjs';

const DAY=86400000,LEASE_MS=6*60000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID=/^mop_[a-f0-9]{32}$/;
const NO_REPLY=/^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|alerts?|notifications?|updates?|newsletters?|bounce)[+@._-]/i;
const PRIVATE_PATH=/(?:^|\/)(?:login|logout|signin|sign-in|admin|wp-admin|account|auth|oauth|apply|application|candidate|messages?|inbox|direct)(?:\/|$)/i;
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
const parse=value=>{try{const out=JSON.parse(value||'{}');return out&&typeof out==='object'&&!Array.isArray(out)?out:{};}catch{return {};}};
const text=(value,max=1000)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const normalizedName=value=>text(value,300).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const hostname=value=>new URL(value).hostname.toLowerCase().replace(/^www\./,'');
const readOK=record=>['read','read_partial'].includes(record?.status);
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)&&!NO_REPLY.test(value);

/** No credentials, authenticated social pages or guessed email-domain roots. */
export function mailResearchURL(value){
 try{
  if(typeof value!=='string'||value.length>2000||/[\x00-\x20\\]/.test(value))return null;
  const u=new URL(value),host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||!/^[-a-z0-9.]+\.[a-z]{2,63}$/.test(host)||host.includes('..')||/^\d+(?:\.\d+){3}$/.test(host)||/(?:^|\.)(?:localhost|local|internal|lan|home|onion|invalid|test)$/.test(host)||['nip.io','sslip.io','localtest.me','vcap.me','lvh.me','linkedin.com','facebook.com','instagram.com','x.com','twitter.com'].some(base=>host===base||host.endsWith('.'+base))||PRIVATE_PATH.test(decodeURIComponent(u.pathname)))return null;
  for(const key of [...u.searchParams.keys()]){
   if(/^(?:utm_.+|trk|tracking|trackingid|ref|refid|email)$/i.test(key))u.searchParams.delete(key);
   else if(!/^(?:id|job|jobid|vacancyid|positionid|requisitionid)$/i.test(key))return null;
  }
  u.hash='';return u.href;
 }catch{return null;}
}
function safeContext(row){
 const root=row.root_owner_id,secondary=row.owner_id===root+':secondary';
 if(!ID.test(row.id)||!UUID.test(root||'')||row.profile_id!=='arash'||row.owner_id!==root&&!secondary)return null;
 return {userId:row.owner_id,rootUserId:root,profileId:'arash',mailbox:secondary?'secondary':'primary',googleSubject:row.google_sub};
}
async function bankSource(db,context,candidate,now){
 const name=text(candidate.clinicName,180),normalized=normalizedName(name);if(!normalized||normalized.length<8)return null;
 const exists=await first(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='clinic_bank_leads'");if(!exists)return null;
 const rows=await all(db,"SELECT id,name,url,status,last_success_at,read_at,result_json FROM clinic_bank_leads WHERE owner_id=? AND profile_id='arash' AND lower(trim(name))=lower(?) AND status IN ('public_contacts_found','public_page_read') LIMIT 3",context.rootUserId,name);
 const matches=rows.flatMap(row=>{
  const result=parse(row.result_json),url=mailResearchURL(result.sourceURL||row.url),original=mailResearchURL(row.url),at=Date.parse(row.last_success_at||row.read_at||'');
  if(!url||!original||hostname(url)!==hostname(original)||!Number.isFinite(at)||at>now+60000||now-at>7*DAY||normalizedName(row.name)!==normalized||!(' '+normalizedName(result.title)+' ').includes(' '+normalized+' '))return [];
  return [{url,leadId:row.id,checkedAt:at,name}];
 });
 if(new Set(matches.map(row=>hostname(row.url))).size!==1)return null;
 return matches[0]||null;
}
function employerName(record){
 const match=text(record?.title,500).match(/\b([A-Z][A-Za-z'&.-]*(?:\s+[A-Z][A-Za-z'&.-]*){0,6}\s+(?:Medical (?:Centre|Center|Practice|Clinic)|Family Practice|Medical Surgery|Health Clinic|Surgery))\b/);
 return match?text(match[1],180):'';
}
function matchesEmployer(page,name){const target=normalizedName(name);return target.length>=8&&(' '+normalizedName(page.title+' '+page.text)+' ').includes(' '+target+' ');}
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
 }
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
function publicEvidence(pages,rootURL,name,bankMatched,now){
 const normalizedHost=hostname(rootURL),successful=pages.filter(page=>readOK(page)&&mailResearchURL(page.finalUrl||page.url)&&hostname(page.finalUrl||page.url)===normalizedHost),clinicalPages=successful.filter(page=>bankMatched||matchesEmployer(page,name));
 const compatibleRoot=new URL(rootURL);compatibleRoot.search='';
 const research=buildClinicResearchContext({rootURL:compatibleRoot.href,observedAt:new Date(now).toISOString(),pages:clinicalPages.filter(page=>!new URL(page.finalUrl||page.url).search)});
 research.sourcePages=pages.map(page=>({url:page.url,sourceURL:page.finalUrl||page.url,status:page.status,readAt:new Date(now).toISOString()}));
 const facts=new Map(research.facts.map(fact=>[fact.text,fact]));
 for(const page of clinicalPages)for(const fact of extractClinicResearchStatements(page.text,page.title,8))if(facts.size<24&&!facts.has(fact.text))facts.set(fact.text,{...fact,sourceURL:page.finalUrl||page.url,readAt:new Date(now).toISOString()});
 research.facts=[...facts.values()];research.validUntil=now+7*DAY;
 const contacts=new Map();
 for(const page of successful){
  if(!bankMatched&&!matchesEmployer(page,name))continue;
  const source=page.finalUrl||page.url;
  for(const contact of page.enrichment?.contacts||[]){
   if(contact?.type!=='email'||!validEmail(contact.value)||mailResearchURL(contact.sourceURL||contact.sourceUrl)!==mailResearchURL(source))continue;
   if(contacts.size<20)contacts.set(contact.value.toLowerCase(),{...contact,value:contact.value.toLowerCase(),readAt:new Date(now).toISOString(),sourceRelation:page===successful[0]?'same_page':'linked_page'});
  }
 }
 const ordered=[...contacts.values()].sort((a,b)=>['application','organization_general','unknown'].indexOf(a.contactRole)-['application','organization_general','unknown'].indexOf(b.contactRole));
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
  AND (r.opportunity_id IS NULL OR r.next_attempt_at<=? OR r.source_updated_at<o.updated_at)
  ORDER BY coalesce(r.next_attempt_at,0),o.received_at DESC,o.id LIMIT 1`,now,now);
 if(!selected)return {attempted:0,status:'idle'};
 const context=safeContext(selected);if(!context)return {attempted:0,status:'owner_invalid'};
 if((await membership(env,context.rootUserId,'arash',fetcher))?.active!==true)return {attempted:0,status:'membership_unavailable'};
 const row=await first(db,"SELECT * FROM private_mail_opportunities WHERE id=? AND owner_id=? AND google_sub=? AND status IN ('suggested','reviewed')",selected.id,context.userId,context.googleSubject);
 if(!row)return {attempted:0,status:'source_changed'};
 const lease=await first(db,`INSERT INTO private_mail_opportunity_research(opportunity_id,owner_id,google_sub,status,attempts,next_attempt_at,lease_until,source_updated_at)
  VALUES(?,?,?,'reading',1,0,?,?) ON CONFLICT(opportunity_id) DO UPDATE SET owner_id=excluded.owner_id,google_sub=excluded.google_sub,status='reading',attempts=private_mail_opportunity_research.attempts+1,lease_until=excluded.lease_until,source_updated_at=excluded.source_updated_at
  WHERE private_mail_opportunity_research.lease_until<=? RETURNING attempts`,row.id,context.userId,context.googleSubject,now+LEASE_MS,row.updated_at,now);
 if(!lease)return {attempted:0,status:'already_reading'};
 const candidate=parse(row.data_json),pages=[],budget={remaining:PUBLIC_PAGE_REQUEST_LIMIT};let finalStatus='failed',code=null,prepared=false,publicContacts=0,sourceVersion=row.updated_at;
 const finish=async(next)=>run(db,'UPDATE private_mail_opportunity_research SET status=?,next_attempt_at=?,lease_until=0,last_read_at=?,last_error=?,receipt_json=?,source_updated_at=? WHERE opportunity_id=? AND owner_id=? AND google_sub=? AND lease_until=?',finalStatus,next,now,code,JSON.stringify({pages:pages.length,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,contacts:publicContacts,draftReady:prepared}),sourceVersion,row.id,context.userId,context.googleSubject,now+LEASE_MS);
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
  let url=mailResearchURL(row.source_url||candidate.sourceUrl),bank=null;
  if(!url){bank=await bankSource(db,context,candidate,now);url=bank?.url||null;}
  if(!url){finalStatus='blocked';code='public_employer_source_required';await invalidateSource(code);await finish(now+DAY);return {attempted:1,status:finalStatus,code,publicRequests:0,draftReady:false};}
  const base=hostname(url),read=async(target,kind='root')=>{
   const result=await pageReader({id:row.id,url:target,data:JSON.stringify({officialBases:[base]})},fetcher,sleep,budget);
   const record={...result,url:target,readAt:new Date(now).toISOString(),kind};pages.push(record);return record;
  };
  const root=await read(url);
  if(!readOK(root)){finalStatus='blocked';code=/^[a-z_]{3,80}$/.test(root.status||'')?root.status:'reading_failed';await invalidateSource(code);await finish(now+Math.min(DAY,3600000*2**Math.min(6,Number(lease.attempts)-1)));return {attempted:1,status:finalStatus,code,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,draftReady:false};}
  const rootSource=mailResearchURL(root.finalUrl||url);if(!rootSource||hostname(rootSource)!==base)throw Object.assign(Error('source_host_changed'),{code:'source_host_changed'});
  const clinicName=text(candidate.clinicName,180)||employerName(root);
  const linkBase=new URL(rootSource);linkBase.search='';
  const following=selectClinicResearchLinks(linkBase.href,root.enrichment?.followLinks,{hasEmail:(root.enrichment?.contacts||[]).some(contact=>contact.type==='email'),validateURL:mailResearchURL});
  for(const link of following){if(budget.remaining<2)break;await read(link.url,link.kind);}
  const evidence=publicEvidence(pages,rootSource,clinicName,Boolean(bank),now),privateFallback=String(candidate.contactBasis?.kind||'').startsWith('private_email_')?[...new Set((candidate.recipients||[candidate.recipient]).filter(validEmail))]:[],allEmails=[...new Set([...evidence.contacts.map(contact=>contact.value),...privateFallback])];
  const suppressed=allEmails.length?new Set((await all(db,'SELECT email FROM mail_automation_suppressions WHERE owner_id=? AND email IN (SELECT value FROM json_each(?))',context.rootUserId,JSON.stringify(allEmails))).map(item=>item.email)):new Set();
  const contacts=evidence.contacts.filter(contact=>!suppressed.has(contact.value)),fallbackRecipients=privateFallback.filter(email=>!suppressed.has(email));publicContacts=contacts.length;
  const publishedFacts=evidence.clinicalFacts.length>0,privateFacts=candidate.clinicalFactBasis==='private_email_statement'||!String(candidate.contactBasis?.kind||'').startsWith('source_published_')?candidate.clinicalFacts||[]:[];
  const currentSource=assessMailResearchSource(root,row,now),priorRestrictions=Array.isArray(candidate.sourceRestrictions)?candidate.sourceRestrictions:[],restrictions=[...new Map([...priorRestrictions,...currentSource.restrictions].map(item=>[item.code,item])).values()].slice(0,12),reviewRequired=candidate.sourceReviewRequired===true||candidate.publicationClosed===true||restrictions.length>0;
  const priorFit=parse(row.fit_json),signalStatus=field=>currentSource.assessment.signals[field]?.status==='supported'?'supported':currentSource.assessment.signals[field]?.status==='restricted'?'restricted':'unknown';
  const fit={...priorFit,level1:signalStatus('level1'),sponsorship:signalStatus('sponsorship'),registration:signalStatus('registration'),pesci:signalStatus('pesci'),priority:reviewRequired?'review':signalStatus('level1')==='supported'&&signalStatus('sponsorship')!=='restricted'?'high':'review',sourceReviewRequired:reviewRequired,sourceRestrictions:restrictions,sourceURL:currentSource.sourceURL,checkedAt:currentSource.checkedAt,assessment:'current_public_page_signals_not_acceptance_probability'};
  const updated={...candidate,clinicName,fit,sourceUnavailable:false,sourceUnavailableReason:null,sourceUnavailableAt:null,sourceReviewRequired:reviewRequired,sourceRestrictions:restrictions,publicationClosed:candidate.publicationClosed===true||currentSource.publicationClosed,...(currentSource.closesAt?{closesAt:currentSource.closesAt}:{}),notificationEligible:reviewRequired?false:candidate.notificationEligible,clinicalFacts:publishedFacts?evidence.clinicalFacts:privateFacts,clinicalFactBasis:publishedFacts?'source_published_statement':'private_email_statement',clinicalSourceUrl:publishedFacts?evidence.clinicalSourceUrl:privateFacts.length?candidate.clinicalSourceUrl||candidate.sourceUrl:null,research:{...evidence.research,...(bank?{matchedOwnBankLeadId:bank.leadId}:{}),contactEvidence:contacts,sourceAssessment:currentSource},researchStatus:'read',researchReadAt:new Date(now).toISOString(),...(contacts.length?{recipient:contacts[0].value,recipients:contacts.map(contact=>contact.value),contactBasis:{kind:'source_published_research_contact',sourceUrl:contacts[0].sourceURL||contacts[0].sourceUrl,readAt:new Date(now).toISOString()}}:{recipient:fallbackRecipients[0]||null,recipients:fallbackRecipients,contactBasis:fallbackRecipients.length?candidate.contactBasis:null})};
  let writing={};if(typeof writingContextProvider==='function'){try{const found=await writingContextProvider(env,context,fetcher);if(found?.profile&&typeof found.cvText==='string')writing=found;}catch{code='own_writing_context_unavailable';}}
  const draft=await prepareMailOpportunityDraft(updated,writing);
  if(reviewRequired){draft.status='needs_source_review';draft.readyForReview=false;draft.missing=[...new Set([...(draft.missing||[]),'current_source_requires_review',...restrictions.map(item=>item.code)])];}
  prepared=draft.readyForReview===true;
  if((await membership(env,context.rootUserId,'arash',fetcher))?.active!==true){finalStatus='blocked';code='membership_unavailable';await finish(now+3600000);return {attempted:1,status:finalStatus,code,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,draftReady:false};}
  const allSuppressed=allEmails.length>0&&!contacts.length&&!fallbackRecipients.length;
  const mayNotify=prepared&&!allSuppressed&&!reviewRequired&&updated.notificationEligible!==false&&!updated.sourceIncomplete&&!updated.historyGap&&row.received_at>0&&row.received_at<=now+60000&&now-row.received_at<=14*DAY;
  const saved=await run(db,"UPDATE private_mail_opportunities SET data_json=?,draft_json=?,fit_json=?,updated_at=?,notification_eligible=? WHERE id=? AND owner_id=? AND google_sub=? AND updated_at=? AND data_json=? AND draft_json IS ? AND source_url IS ? AND status IN ('suggested','reviewed') AND EXISTS(SELECT 1 FROM google_accounts g WHERE g.owner_id=? AND g.google_sub=? AND g.profile_id='arash' AND g.status='connected')",JSON.stringify(updated),JSON.stringify(draft),JSON.stringify(fit),now,mayNotify?1:0,row.id,context.userId,context.googleSubject,row.updated_at,row.data_json,row.draft_json,row.source_url,context.userId,context.googleSubject);
  if(!saved.meta?.changes){finalStatus='deferred';code='source_changed';await finish(now+60000);return {attempted:1,status:finalStatus,code,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,draftReady:false};}
  sourceVersion=now;finalStatus='read';await finish(now+(prepared?7*DAY:DAY));
  return {attempted:1,status:finalStatus,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,contacts:publicContacts,draftReady:prepared,...(code?{code}:{})};
 }catch(error){
  finalStatus='failed';code=/^[a-z_]{3,80}$/.test(error?.code||'')?error.code:'private_research_failed';await invalidateSource(code);await finish(now+Math.min(DAY,3600000*2**Math.min(6,Number(lease.attempts)-1)));
  return {attempted:1,status:finalStatus,code,publicRequests:PUBLIC_PAGE_REQUEST_LIMIT-budget.remaining,draftReady:false};
 }
}
