// A private message supplies a lead, never public employer proof. These helpers
// accept only bounded, actually-read public evidence; no provider credentials,
// search-result snippets or private correspondence enter the clinic snapshot.
import {clinicBankURL} from './clinic-bank.mjs';

export const MAIL_LEAD_DISCOVERY_VERSION=2;
export const MAIL_PUBLIC_EVIDENCE_MAX_AGE=7*86400000;
const BOARD_HOSTS=['linkedin.com','seek.com.au','indeed.com','indeed.com.au','jora.com','careerjet.com','careerjet.com.au','adzuna.com.au','gumtree.com.au','au.jooble.org','jobrapido.com','simplyhired.com.au','glassdoor.com','glassdoor.com.au','ashbyhq.com','lever.co','greenhouse.io','workable.com'];
const SOCIAL_HOSTS=['linkedin.com','facebook.com','instagram.com','x.com','twitter.com'];
const PRIVATE_PATH=/(?:^|\/)(?:login|logout|signin|sign-in|admin|wp-admin|account|auth|oauth|apply|application|candidate|messages?|inbox|direct)(?:\/|$)/i;
const UNTRUSTED=/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|javascript:|<script/i;
const NO_REPLY=/^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|alerts?|notifications?|updates?|newsletters?|bounce)[+@._-]/i;
const clean=(value,max=600)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
export const normalizeMailClinicName=value=>clean(value,300).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const isSpecificMailClinicName=value=>{const name=normalizeMailClinicName(value);return name.length>=4&&!/^(?:medical (?:centre|center|practice|clinic)|general practice|family practice|GP clinic|clinic|practice|health hub|general practitioner)$/i.test(name);};
const host=value=>new URL(value).hostname.toLowerCase().replace(/^www\./,'');
const isHost=(value,bases)=>bases.some(base=>value===base||value.endsWith('.'+base));
const parse=value=>{try{const out=JSON.parse(value||'{}');return out&&typeof out==='object'&&!Array.isArray(out)?out:{};}catch{return {};}};
const readOK=page=>['read','read_partial'].includes(page?.status);
const stamp=value=>typeof value==='number'?value:Date.parse(value||'');
const fresh=(value,now)=>Number.isFinite(stamp(value))&&stamp(value)<=now+60000&&now-stamp(value)<=MAIL_PUBLIC_EVIDENCE_MAX_AGE;
export const mailPublishedEmail=value=>typeof value==='string'&&value.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value)&&!NO_REPLY.test(value);

/** Public alert titles often carry the employer after the role. This is only
 * a search/bank lookup label; actual employer-page identity is still required. */
export function inferMailLeadEmployerName(candidate){
 const raw=typeof candidate?.clinicName==='string'?candidate.clinicName:'';
 // Job alerts may put the role and employer in adjacent lines. Remove only
 // an explicit role label, retaining actual brands such as "General Practice
 // Medical Centre" or "General Practitioner Clinic".
 const withoutRole=raw.replace(/^\s*(?:(?:mental health|locum|rural|remote)\s+)*(?:general (?:practitioner|practioner)|GP)(?:[ \t]+(?:role|position|opportunity))?[ \t]*(?:\r?\n[ \t]*|[-–—:|][ \t]*|\bat[ \t]+)/i,'');
 let supplied=clean(withoutRole,180);
 const flattened=supplied.match(/^(?:general (?:practitioner|practioner)|GP)\s+((?!medical\b|clinic\b|practice\b|centre\b|center\b)[A-Z][\s\S]{2,160}\s+(?:Medical (?:Centre|Center|Practice|Clinic)|Family Practice|Health Clinic|Surgery))$/i);
 if(flattened)supplied=clean(flattened[1],180);
 if(isSpecificMailClinicName(supplied))return supplied;
 const title=clean(candidate?.title,320).replace(/&(?:middot|bull);|&#(?:183|8226);/gi,' · '),first=title.split(/\s+[·|]\s+/)[0];
 let name=first.match(/\b(?:at|@)\s+(.+)$/i)?.[1]||first.replace(/^(?:(?:mental health|remote|locum|rural|community)\s+)*(?:general practitioner|GP)(?:\s+(?:role|position|opportunity|job))?\s*(?:[-–—:]\s*|\s+)/i,'');
 if(name===first||!name||/^(?:position|role|job|opportunity|Australia|NSW|QLD|VIC|WA|SA|TAS|ACT|NT)$/i.test(name))return '';
 name=name.replace(/^(.{3,45}?)\s+\1\s+/i,'$1 ').trim();
 return isSpecificMailClinicName(name)?clean(name,180):'';
}

export function mailLeadPublicURL(value,{social=false}={}){
 try{
  if(typeof value!=='string'||value.length>2000||/[\x00-\x20\\]/.test(value))return null;
  const url=new URL(value),name=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port||!/^[-a-z0-9.]+\.[a-z]{2,63}$/.test(name)||name.includes('..')||/^\d+(?:\.\d+){3}$/.test(name)||/(?:^|\.)(?:localhost|local|internal|lan|home|onion|invalid|test)$/.test(name)||isHost(name,['nip.io','sslip.io','localtest.me','vcap.me','lvh.me'])||PRIVATE_PATH.test(decodeURIComponent(url.pathname)))return null;
  const socialHost=isHost(name,SOCIAL_HOSTS);
  if(socialHost&&!social)return null;
  if(socialHost){
   // Public business pages linked by an already-verified employer only. No
   // personal profile, job alert, group, search or authenticated endpoint.
   const path=url.pathname.replace(/\/+$/,'');
   if(isHost(name,['linkedin.com'])&&!/^\/company\/[a-z0-9_-]+$/i.test(path))return null;
   if(!isHost(name,['linkedin.com'])&&(!/^\/[a-z0-9_.-]+$/i.test(path)||/^\/(?:home|search|explore|groups?|profile|share|sharer|intent|reel|stories|p|i|jobs)$/i.test(path)))return null;
  }
  for(const key of [...url.searchParams.keys()]){
   if(/^(?:utm_.+|trk|tracking|trackingid|ref|refid|email)$/i.test(key))url.searchParams.delete(key);
   else if(socialHost||!/^(?:id|job|jobid|vacancyid|positionid|requisitionid)$/i.test(key))return null;
  }
  url.hash='';return url.href;
 }catch{return null;}
}
export function isMailEmploymentBoard(value){try{return isHost(host(value),BOARD_HOSTS);}catch{return false;}}
export function mailEmployerPublicURL(value){const url=mailLeadPublicURL(value);return url&&!isMailEmploymentBoard(url)?url:null;}
export function mailPublicEmployerHints(candidate,now=Date.now()){
 return (Array.isArray(candidate?.publicEmployerHints)?candidate.publicEmployerHints:[]).slice(0,4).flatMap(item=>{
  const url=mailLeadPublicURL(item?.url);return url&&fresh(item.checkedAt,now)&&['connected_public_search','tavily_basic_search'].includes(item.discoveryMethod)?[{url,clinicName:clean(item.clinicName,180),method:item.discoveryMethod}]:[];
 });
}
export function mailPageNamesEmployer(page,name){
 const target=normalizeMailClinicName(name);return isSpecificMailClinicName(target)&&(' '+normalizeMailClinicName((page?.title||'')+' '+(page?.text||''))+' ').includes(' '+target+' ');
}
export function mailEmployerIdentityEvidence(page,name,now=Date.now()){
 if(!readOK(page)||!mailEmployerPublicURL(page.finalUrl||page.url)||!mailPageNamesEmployer(page,name))return null;
 const target=normalizeMailClinicName(name),source=page.finalUrl||page.url,identities=Array.isArray(page.enrichment?.publisherIdentities)?page.enrichment.publisherIdentities:[];
 if(/\b(?:recruiters?|recruitment|directories|directory|job ?boards?|employment agenc(?:y|ies)|business listings?|company profiles?|reviews?)\b/i.test(page.title||'')||/\b(?:this directory|listing (?:for|of)|company profile|recruitment agency|recruiting on behalf|advertised by|listed by|recruiter\s*:)\b/i.test(String(page.text||'').slice(0,1500)))return null;
 const publisherConflict=identities.some(item=>item?.role==='publisher'&&mailLeadPublicURL(item.sourceURL)===mailLeadPublicURL(source)&&item.name&&normalizeMailClinicName(item.name)!==target);
 if(publisherConflict)return null;
 const structured=identities.find(item=>item?.method==='jsonld_self_organization'&&normalizeMailClinicName(item.name)===target&&mailLeadPublicURL(item.sourceURL)===mailLeadPublicURL(source)&&mailEmployerPublicURL(item.url)&&host(item.url)===host(source)&&!UNTRUSTED.test(item.quote||''));
 const heading=identities.find(item=>item?.method==='visible_h1'&&normalizeMailClinicName(item.name)===target&&mailLeadPublicURL(item.sourceURL)===mailLeadPublicURL(source)&&!UNTRUSTED.test(item.quote||''));
 const brandTitle=String(page.title||'').split(/\s*[|–—]\s*|\s+-\s+/).some(part=>normalizeMailClinicName(part)===target);
 const item=structured||heading,authority=structured?'structured_self_organization':heading?'visible_brand_heading':brandTitle?'self_brand_title':null;
 const quote=clean(item?.quote||page.title,600);
 return authority&&quote&&!UNTRUSTED.test(quote)?{quote,sourceURL:source,readAt:new Date(now).toISOString(),method:'published_employer_name',authority}:null;
}

/** Imported/unread own-bank entries can seed reading, never prove a clinic. */
export async function resolveOwnedMailClinicSource(db,context,candidate){
 const name=inferMailLeadEmployerName(candidate),target=normalizeMailClinicName(name);if(!isSpecificMailClinicName(target))return null;
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='clinic_bank_leads'").bind().first();if(!exists)return null;
 const rows=(await db.prepare("SELECT id,name,url,status,result_json FROM clinic_bank_leads WHERE owner_id=? AND profile_id='arash' AND name=? COLLATE NOCASE ORDER BY last_success_at DESC,id LIMIT 4").bind(context.rootUserId,name).all()).results||[];
 const candidates=rows.flatMap(row=>{const result=parse(row.result_json),canonical=mailEmployerPublicURL(row.url),url=mailEmployerPublicURL(result.sourceURL||row.url);return normalizeMailClinicName(row.name)===target&&canonical&&url&&host(canonical)===host(url)?[{url,bankURL:row.url,leadId:row.id,name,from:'own_bank_candidate',previouslyRead:['public_contacts_found','public_page_read'].includes(row.status)}]:[];});
 return new Set(candidates.map(row=>host(row.url))).size===1?candidates[0]||null:null;
}

/** Only explicit employer/official-site links from an actual public page. */
export function selectMailEmployerLinks(page,name){
 if(!readOK(page))return [];
 const source=mailLeadPublicURL(page.finalUrl||page.url);if(!source)return [];
 const target=normalizeMailClinicName(name),out=[],seen=new Set();
 for(const item of [...(page.enrichment?.organizations||[]),...(page.enrichment?.contacts||[])].slice(0,80)){
  const url=mailEmployerPublicURL(item.url||item.type==='website'&&item.value),itemSource=mailLeadPublicURL(item.sourceURL||item.sourceUrl);
  if(!url||itemSource!==source||host(url)===host(source)||seen.has(host(url)))continue;
  const quote=clean(item.quote,600),named=isSpecificMailClinicName(target)&&(' '+normalizeMailClinicName((item.name||'')+' '+quote)+' ').includes(' '+target+' ');
  if(UNTRUSTED.test(quote)||!(named||item.method==='jsonld_jobposting'||/\b(?:employer|official (?:site|website)|practice website|clinic website|company website)\b/i.test(quote)))continue;
  seen.add(host(url));out.push({url,sourceURL:source,quote,method:item.method==='jsonld_jobposting'?'public_hiring_organization_link':'published_employer_link'});
 }
 return out.slice(0,2);
}

/** Discovery receipts differ explicitly from actual social-page readings. */
export function discoverMailClinicSocialLinks(pages,officialSourceURL){
 const root=mailEmployerPublicURL(officialSourceURL);if(!root)return [];
 const out=[],seen=new Set();
 for(const page of pages||[]){
  const source=mailEmployerPublicURL(page.finalUrl||page.url);if(!readOK(page)||!source||host(source)!==host(root))continue;
  for(const item of (page.enrichment?.contacts||[]).slice(0,50)){
   const url=mailLeadPublicURL(item.value,{social:true});if(item.type!=='social'||!url||!isHost(host(url),SOCIAL_HOSTS)||seen.has(url)||mailLeadPublicURL(item.sourceURL||item.sourceUrl)!==source)continue;
   seen.add(url);out.push({url,discoveredOn:source,quote:clean(item.quote,500),discoveryMethod:'linked_from_verified_employer',status:'discovered_not_read',readAt:null});
   if(out.length>=6)return out;
  }
 }
 return out;
}

/** Pure, fail-closed gate shared by discovery, draft preparation and sending. */
export function assessMailPublicEmployerEvidence(candidate,{now=Date.now(),requireContact=true}={}){
 const research=candidate?.research,proof=research?.verification,official=mailEmployerPublicURL(proof?.officialSourceURL),fail=reason=>({verified:false,reason,officialSourceURL:official});
 if(!Number.isSafeInteger(now)||now<0)return fail('invalid_evidence_time');
 if(research?.publicEmployerVerified!==true||proof?.version!==MAIL_LEAD_DISCOVERY_VERSION||!official||!fresh(proof.checkedAt,now))return fail('public_employer_verification_required');
 if(candidate.sourceUnavailable===true||candidate.clinicalFactBasis!=='source_published_statement'||normalizeMailClinicName(proof.clinicName)!==normalizeMailClinicName(candidate.clinicName))return fail('public_employer_identity_required');
 const sourcePages=Array.isArray(research.sourcePages)?research.sourcePages:[];
 const goodSource=(value,at)=>{
  const url=mailEmployerPublicURL(value);if(!url||host(url)!==host(official)||!fresh(at,now))return false;
  const latest=sourcePages.map((page,index)=>({...page,index})).filter(page=>mailLeadPublicURL(page.sourceURL||page.url)===url).sort((a,b)=>stamp(b.readAt)-stamp(a.readAt)||b.index-a.index)[0];
  return Boolean(latest&&readOK(latest)&&fresh(latest.readAt,now)&&stamp(latest.readAt)>=stamp(at));
 };
 if(!goodSource(official,proof.checkedAt))return fail('latest_public_employer_read_required');
 const name=normalizeMailClinicName(candidate.clinicName);
 if(!isSpecificMailClinicName(name)||!Array.isArray(proof.identityEvidence)||!proof.identityEvidence.some(item=>item&&['structured_self_organization','visible_brand_heading','self_brand_title'].includes(item.authority)&&goodSource(item.sourceURL,item.readAt)&&!UNTRUSTED.test(item.quote||'')&&(' '+normalizeMailClinicName(item.quote)+' ').includes(' '+name+' ')))return fail('published_employer_name_required');
 if(!Array.isArray(research.facts)||!research.facts.some(fact=>fact&&['services','team','training','recruitment'].includes(fact.category)&&typeof fact.text==='string'&&fact.text.length>=25&&!UNTRUSTED.test(fact.text)&&goodSource(fact.sourceURL,fact.readAt)))return fail('published_clinic_context_required');
 if(!requireContact)return {verified:true,reason:null,officialSourceURL:official};
 if(candidate.applicationSourceVerified===false)return fail('public_job_source_required');
 const contacts=(Array.isArray(research.contactEvidence)?research.contactEvidence:[]).filter(contact=>contact?.type==='email'&&mailPublishedEmail(contact.value)&&typeof contact.quote==='string'&&!UNTRUSTED.test(contact.quote)&&contact.quote.toLowerCase().includes(contact.value.toLowerCase())&&goodSource(contact.sourceURL||contact.sourceUrl,contact.readAt));
 if(!contacts.length)return fail('published_recruitment_contact_required');
 const recipients=Array.isArray(candidate.recipients)?candidate.recipients:[candidate.recipient].filter(Boolean);
 if(!recipients.length||recipients.some(email=>!contacts.some(contact=>contact.value.toLowerCase()===String(email).toLowerCase())))return fail('published_recipient_required');
 return {verified:true,reason:null,officialSourceURL:official};
}
export function hasFreshMailPublicEmployerEvidence(candidate,options){return assessMailPublicEmployerEvidence(candidate,options).verified;}

/** Public-only refresh of this owner's canonical bank row. No private source
 * message, CV, candidate assessment, letter or claimed vacancy is copied. */
export async function upsertOwnedMailClinicEvidence(db,context,candidate,{now=Date.now(),opportunityId,sourceVersion}={}){
 if(!assessMailPublicEmployerEvidence(candidate,{now,requireContact:false}).verified)return {updated:false,reason:'public_evidence_required'};
 const official=candidate.research.verification.officialSourceURL,root=new URL(official);root.search='';
 // Canonical bank URLs are query-free. Preserve an exact owned bank URL when
 // the resolver matched it; otherwise one stable root per employer hostname.
 let url=clinicBankURL(candidate.research.matchedOwnBankURL);if(!url||host(url)!==host(official))url=root.href;
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='clinic_bank_leads'").bind().first();if(!exists)return {updated:false,reason:'clinic_bank_storage_required'};
 const id='bank_'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(context.rootUserId+'\n'+url)))].map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,32),at=new Date(now).toISOString();
 const research=candidate.research,snapshot={sourceStatus:'read',sourceURL:official,title:candidate.clinicName,contacts:research.publicContactEvidence||research.contactEvidence,contactsReadAt:at,clinicalText:research.facts.filter(fact=>fact.category==='services').map(fact=>fact.text).slice(0,12).join('\n'),clinicalSourceURL:candidate.clinicalSourceUrl||official,clinicalReadAt:at,clinicalScope:'bounded_public_service_statements_not_full_page',research:{version:research.version,observedAt:research.observedAt,sourcePages:research.sourcePages,facts:research.facts,people:research.people||[],organizations:research.organizations||[],gaps:research.gaps||[],scope:research.scope,publicEmployerVerified:true,verification:research.verification,socialSources:research.socialSources||[]},linkedReadings:research.sourcePages.filter(page=>page.sourceURL!==official),limitations:['A public clinic record is not a live vacancy, supervision approval or permission to send.'],lastAttempt:{readAt:at,status:'read',sourceURL:official}};
 const result=await db.prepare(`INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,provenance_json,status,attempts,available_at,lease_until,read_at,last_success_at,result_json,new_email_count,created_at,updated_at)
  SELECT ?,?,'arash',?,?,?,?,0,?,0,?,?,?,0,?,? WHERE EXISTS(SELECT 1 FROM private_mail_opportunities o JOIN google_accounts g ON g.owner_id=o.owner_id AND g.google_sub=o.google_sub AND g.profile_id='arash' AND g.status='connected' WHERE o.id=? AND o.owner_id=? AND o.root_owner_id=? AND o.google_sub=? AND o.updated_at=? AND o.status IN ('suggested','reviewed'))
  ON CONFLICT(owner_id,url) DO UPDATE SET name=excluded.name,status=excluded.status,available_at=excluded.available_at,read_at=excluded.read_at,last_success_at=excluded.last_success_at,result_json=excluded.result_json,updated_at=excluded.updated_at
  WHERE clinic_bank_leads.profile_id='arash' AND (trim(clinic_bank_leads.name)='' OR lower(trim(clinic_bank_leads.name))=lower(trim(excluded.name))) AND clinic_bank_leads.lease_until<=? AND coalesce(clinic_bank_leads.last_success_at,'')<=excluded.last_success_at`).bind(id,context.rootUserId,url,clean(candidate.clinicName,180),JSON.stringify({kind:'verified_public_employer_read',sourceURL:official}),research.contactEvidence.length?'public_contacts_found':'public_page_read',now+MAIL_PUBLIC_EVIDENCE_MAX_AGE,at,at,JSON.stringify(snapshot),at,at,opportunityId,context.userId,context.rootUserId,context.googleSubject,sourceVersion,now).run();
 return {updated:Boolean(result.meta?.changes),reason:result.meta?.changes?null:'source_changed_or_bank_leased'};
}
