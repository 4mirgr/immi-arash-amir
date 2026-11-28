// Private discovery from the owner's Gmail. An email alert is evidence of a
// message, never a verified vacancy, visa entitlement or acceptance probability.
import {getGoogleAccess} from './google-oauth.mjs';
import {extractEmails,normalizeMessage,readGoogleMailJson,rankMessage} from './google-mail.mjs';
import {correspondenceReplyText} from './clinic-correspondence.mjs';
import {assessOpportunityFit} from './opportunity-fit.mjs';
import {composeClinicParagraphs,readGpWritingProfile,suggestEvidencePair,cvEvidencePriority,classifyGpApplicationVariant} from './gp-letter-composer.mjs';
import {publishedApplicationContact} from './gp-contact-discovery.mjs';
import {buildGpApplicationEmail,GpMailDocumentError} from './gp-mail-documents.mjs';
import {assessMailOutreachEvidence,mailOutreachMode,inferMailLeadEmployerName,mailLeadPublicURL,mailEmployerPublicURL,verifiedMailApplicationURL,mailInitialEnquiryKey} from './mail-lead-discovery.mjs';
import {applyOwnedMailClinicBankProof} from './mail-clinic-bank-proof.mjs';
import {hydrateMailOpportunityEdit,handleMailOpportunityEditsRequest} from './mail-opportunity-edits.mjs';
import {isMailGPJobAnchor,buildMailPublicJobLead,hasExplicitForeignGPJobLocation} from './mail-public-job-headline.mjs';

const DAY=86400000,MAX_AGE=14*DAY,MAX_INPUTS=8,MAX_CANDIDATES=3;
const ID=/^mop_[a-f0-9]{32}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GAP_ID='__history_gap__';
const GMAIL=/^[A-Za-z0-9_-]{1,200}$/;
const GP=/\b(?:general practitioner|general practice|family (?:physician|medicine)|rural generalist|GP)\b/i;
const CAREER=/\b(?:job|jobs|vacanc(?:y|ies)|position|positions|recruit(?:ing|ment)?|hiring|career|opportunit(?:y|ies)|offer|interview|application|apply|invitation to discuss)\b/i;
const AU=/\b(?:Australia(?:n)?|Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Queensland|Victoria|Tasmania|New South Wales|South Australia|Western Australia|Northern Territory|NSW|QLD|VIC|ACT)\b/i;
const NON_GP=/\b(?:nurs(?:e|ing)|receptionist|dentist|dental|physiotherap(?:y|ist)|practice manager|administrat(?:or|ion)|PhD|postdoctoral|scholarship|research assistant)\b/i;
const INSTRUCTION=/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|send.{0,40}(?:token|secret)|javascript:/i;
const NO_REPLY=/^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|alerts?|notifications?|updates?|newsletters?|bounce)[+@._-]/i;
const CONSUMER=/^(?:gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|yahoo\.[a-z.]+|icloud\.com)$/i;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const text=(value,max=32768)=>typeof value==='string'?value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').trim().slice(0,max):'';
const parse=(value,fallback={})=>{try{return JSON.parse(value||'{}');}catch{return fallback;}};
function privateStorageStage(sql){
 if(/^INSERT INTO private_mail_opportunity_inputs\b/.test(sql))return 'mail_opportunity_input_enqueue_failed';
 if(/^UPDATE private_mail_opportunity_inputs SET status='processing'/.test(sql))return 'mail_opportunity_input_claim_failed';
 if(/^UPDATE private_mail_opportunity_inputs\b/.test(sql))return 'mail_opportunity_input_finalize_failed';
 if(/^INSERT INTO private_mail_opportunities\b/.test(sql))return 'mail_opportunity_finding_write_failed';
 if(/\bFROM clinic_bank_leads\b/.test(sql))return 'mail_opportunity_bank_read_failed';
 return 'mail_opportunity_storage_unavailable';
}
async function privateStage(code,operation){
 try{return await operation();}
 catch(error){
  if(/^[a-z_]{3,80}$/.test(error?.code||''))throw error;
  // Inspect only to select a predefined family. Neither SQL text nor any
  // parameter/provider/message contents are retained in a returned error.
  const detail=[error?.message,error?.cause?.message].filter(value=>typeof value==='string').join(' ');
  const family=/too many sql variables|too many (?:bound |bind |sql )?parameters|(?:maximum|max) (?:number of )?(?:bound )?parameters[^.]{0,30}exceed/i.test(detail)?'_parameter_limit':
   /D1_TYPE_ERROR|unsupported (?:type|value)|(?:type|value)[^.]{0,40}not supported|undefined|wrong number of (?:parameter|binding)|number of bindings[^.]{0,30}(?:incorrect|mismatch)/i.test(detail)?'_binding':
   /too many subrequests|too many (?:sql |d1 )?queries|too many terms in compound select|query (?:count|quota)[^.]{0,30}(?:limit|exceed)|quota[^.]{0,30}exceed|(?:query|statement) limit exceeded|D1_[A-Z_]*LIMIT/i.test(detail)?'_limit':
   /no such table|no such column|has no column named|unknown column/i.test(detail)?'_schema':
   /constraint|SQLITE_CONSTRAINT/i.test(detail)?'_constraint':
   /malformed json|invalid json|json[^.]{0,25}(?:invalid|malformed)/i.test(detail)?'_json':'';
  const safe=code+family;throw Object.assign(new Error(safe,{cause:error}),{code:safe,status:503});
 }
}
const first=(db,sql,...args)=>privateStage(privateStorageStage(sql),()=>db.prepare(sql).bind(...args).first());
const all=async(db,sql,...args)=>(await privateStage(privateStorageStage(sql),()=>db.prepare(sql).bind(...args).all())).results||[];
const run=(db,sql,...args)=>privateStage(privateStorageStage(sql),()=>db.prepare(sql).bind(...args).run());
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
function scope(context){
 const user=context?.userId,root=user?.replace(/:secondary$/,'');
 if(!UUID.test(root||'')||context.profileId!=='arash'||user!==root&&user!==root+':secondary'||context.rootUserId&&context.rootUserId!==root)fail('gp_workspace_required',403);
 return {owner:user,root,mailbox:user.endsWith(':secondary')?'secondary':'primary'};
}
function safeURL(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^(?:localhost|\[)|^(?:\d{1,3}\.){3}\d{1,3}$|\.(?:local|localhost|internal|lan|home)$/i.test(u.hostname))return null;
 if(/(?:^|\.)linkedin\.com$/i.test(u.hostname)){
  const match=u.pathname.match(/\/(?:comm\/)?jobs\/view\/(?:[^/?#]*-)?(\d+)(?:\/|$)/i);
  if(!match)return null;return 'https://www.linkedin.com/jobs/view/'+match[1]+'/';
 }
 if(/(?:unsubscribe|preferences|privacy|login|sign[-_]?in|track|redirect)/i.test(u.pathname))return null;
 u.hash='';for(const key of [...u.searchParams.keys()])if(/^(?:utm_|trk|tracking|ref(?:id)?$|token$|email$)/i.test(key))u.searchParams.delete(key);
 return u.href.slice(0,2000);
 }catch{return null;}
}
function host(value){try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}}
function validContact(value){const found=extractEmails(value||'');return found.length===1&&found[0]===String(value).trim().toLowerCase()&&!NO_REPLY.test(found[0])&&!/(?:^|\.)linkedin\.com$/i.test(found[0].split('@')[1])?found[0]:null;}
const date=message=>Number(message?.dateTimestamp)||Date.parse(message?.date||'')||0;
function visible(message){return message?.direction!=='sent'&&!(message?.labels||[]).some(label=>['SPAM','TRASH','DRAFT'].includes(label));}
function content(message){return correspondenceReplyText(message?.plainBody||message?.snippet||'');}
function links(message){
 const found=Array.isArray(message?.links)?message.links.filter(link=>!link?.quoted).map(link=>typeof link==='string'?{url:link,label:''}:link):[];
 for(const url of (content(message).match(/https:\/\/[^\s<>"']+/g)||[]).slice(0,80))found.push({url:url.replace(/[),.;]+$/,''),label:''});
 const seen=new Set();return found.flatMap(link=>{const lead=buildMailPublicJobLead(link),url=safeURL(link?.url)||lead?.sourceURL;if(!url||seen.has(url))return [];seen.add(url);return [{url,label:text(link.label,300),...(lead?{publicJobLead:lead}:{})}];});
}
function clinicName(message,label=''){
 const sources=[label,text(message.subject,500),text(message.from,500).split('<')[0],content(message)];
 for(const value of sources){const match=value.match(/\b([A-Z][A-Za-z'&.-]*(?:\s+[A-Z][A-Za-z'&.-]*){0,6}\s+(?:Medical (?:Centre|Center|Practice|Clinic)|Family Practice|Medical Surgery|Health Clinic|Surgery))\b/);if(match&&!INSTRUCTION.test(match[1]))return match[1].trim();}
 return '';
}
function clinicalFacts(value){return text(value,18000).split(/\n+|(?<=[.!?])\s+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(s=>s.length>=25&&s.length<=600&&!INSTRUCTION.test(s)&&!/\b(?:no|not|without|cannot|can't|unable|testimonial|case report|patient story|DOB|Mr|Mrs)\b/i.test(s)&&/\b(?:provides?|offers?|delivers?|manages?|supports?|includes?|experience|chronic|wound|suturing|emergency|acute|preventive|teaching|multidisciplinary)\b/i.test(s)&&/\b(?:general practice|family medicine|patient|chronic|preventive|diabetes|wound|emergency|acute|community|clinical|teaching)\b/i.test(s)).slice(0,24);}
function cvFacts(value){return text(value,150000).split(/\n+|(?<=[.!?])\s+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(s=>s.length>=25&&s.length<=600&&!INSTRUCTION.test(s)&&!/^(?:phone|email|address|referee|references|contact)\s*:/i.test(s)&&/\b(?:clinical|general practi(?:ce|tioner)|patient|chronic|preventive|diabetes|wound|suturing|emergency|acute|community|medical director|technical manager|multidisciplinary|teamwork|collaborat\w*|coordinat\w*|referrals?|triage|reassessment|teaching|professional development|continuing education)\b/i.test(s)).sort((a,b)=>cvEvidencePriority(b)-cvEvidencePriority(a)).slice(0,40);}
function fitSignals(value){
 const assessed=assessOpportunityFit({title:'General practitioner opportunity',country:'AU',opportunityType:'job',fullText:text(value).replace(/\bno\s+(?:work\s+visa|visa|employer)\s+sponsorship\s+(?:is\s+)?required\b/ig,'')},'arash'),map=signal=>signal?.status==='supported'?'supported':signal?.status==='restricted'?'restricted':'unknown';
 const level1=map(assessed.signals.level1),sponsorship=map(assessed.signals.sponsorship),pesci=map(assessed.signals.pesci),registration=map(assessed.signals.registration);
 return {priority:level1==='supported'&&sponsorship!=='restricted'&&registration!=='restricted'?'high':'review',why:['medical_gp_role','australian_context',...(level1==='supported'?['level1_wording']:[]),...(sponsorship==='supported'?['visa_sponsorship_wording']:[])],level1,sponsorship,pesci,registration,assessment:'mail_text_signals_not_acceptance_probability',acceptanceProbability:null};
}
export function isMailOpportunityMessage(message){
 if(!visible(message))return false;const value=[message.subject,content(message)].join('\n');
 const from=extractEmails(message.from||'')[0]||'',australia=AU.test(value)||/\.com\.au$|\.org\.au$|\.net\.au$/i.test(from.split('@')[1]||'');
 return GP.test(value)&&CAREER.test(value)&&australia&&!/\b(?:application (?:was |has been )?(?:rejected|unsuccessful)|not recruiting|no vacancies|do not contact|delivery fail|undeliverable)\b/i.test(value);
}
export async function extractMailOpportunityCandidates(message,{now=Date.now()}={}){
 if(!isMailOpportunityMessage(message)||!GMAIL.test(message?.id||'')||!GMAIL.test(message.threadId||''))return [];
 const body=content(message),messageLinks=links(message),from=extractEmails(message.from||'')[0]||'',linkedin=/(?:^|\.)linkedin\.com$/i.test(from.split('@')[1]||'');
 if(!linkedin&&rankMessage(((message.subject||'')+'\n'+body).replace(/\bno\s+(?:work\s+visa|visa|employer)\s+sponsorship\s+(?:is\s+)?required\b/ig,'')).reasons.includes('rejection_or_unavailable_position_signal'))return [];
 const jobLabels=messageLinks.filter(link=>link.label&&GP.test(link.label)&&!NON_GP.test(link.label));
 const jobLinks=messageLinks.filter(link=>!hasExplicitForeignGPJobLocation(link.label)&&(/linkedin\.com\/jobs\/view\/|\b(?:job|career|vacanc|recruit|position)/i.test(link.url)||isMailGPJobAnchor(link)));
 const usable=jobLinks.filter(link=>link.label?GP.test(link.label)&&!NON_GP.test(link.label):jobLinks.length===1&&GP.test(message.subject+' '+body));
 const sourceItems=usable.length?usable:!linkedin?[messageLinks.find(link=>host(link.url)&&!/linkedin\.com$/.test(host(link.url)))||{url:null,label:''}]:[];
 const candidates=[];
 for(const source of sourceItems){
  const title=text(source.label||message.subject,300);if(!GP.test(title)&&source.label||hasExplicitForeignGPJobLocation(title))continue;
  let localBody=body;
  const isolated=sourceItems.length>1||jobLabels.length>1,boundaries=jobLabels.length?jobLabels:sourceItems;
  if(isolated){const unique=source.label&&boundaries.filter(item=>item.label.toLowerCase()===source.label.toLowerCase()).length===1;const start=unique?body.toLowerCase().indexOf(source.label.toLowerCase()):-1;const ends=boundaries.filter(other=>other.label&&other.label.toLowerCase()!==source.label?.toLowerCase()).map(other=>body.toLowerCase().indexOf(other.label.toLowerCase(),Math.max(0,start+source.label.length))).filter(at=>at>start);localBody=start>=0?body.slice(start,ends.length?Math.min(...ends):body.length):source.label||'';}
  const name=linkedin||isolated?clinicName({subject:source.label||'',plainBody:localBody,from:''},source.label):clinicName(message,source.label),sender=validContact(extractEmails(message.replyTo||message.from||'')[0]||''),fromDomain=from.split('@')[1]||'';
  const stated=!linkedin&&localBody.match(/\b(?:send|email|forward|submit|contact|applications?|CV|resume)\b[^\n.!?]{0,100}\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  const direct=!linkedin&&!/\b(?:job alert|jobs for you|recommended jobs|newsletter|digest)\b/i.test(message.subject||'')?sender:null;
  const recipient=validContact(stated?.[1]?.toLowerCase())||direct,sourceIncomplete=message.bodyTruncated===true||message.linksTruncated===true;
  const fit=fitSignals(localBody),receivedAt=date(message),closing=localBody.match(/\b(?:closing date|applications? close|deadline)\s*[:–—-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/i),closingDate=closing?Date.parse(closing[1]):NaN,closesAt=Number.isFinite(closingDate)?new Date(closingDate+DAY-1).toISOString():null,current=receivedAt>0&&receivedAt<=now+60000&&now-receivedAt<=MAX_AGE&&(!closesAt||Date.parse(closesAt)>now);
  candidates.push({key:source.url||'gmail:'+message.id,title:GP.test(title)?title:'General practitioner opportunity',clinicName:name,sourceUrl:source.url,publicJobLead:source.publicJobLead||buildMailPublicJobLead(source),sourceKind:linkedin?'linkedin_alert':recipient?'email_offer':'job_notice',sourceIncomplete,closesAt,recipient,contactBasis:recipient?{kind:stated?'private_email_stated_contact':'private_email_reply_address',gmailId:message.id,sourceUrl:null}:null,fit,receivedAt,notificationEligible:current&&!sourceIncomplete&&fit.level1!=='restricted'&&fit.sponsorship!=='restricted'&&fit.registration!=='restricted',gmailId:message.id,threadId:message.threadId,sourceText:localBody.slice(0,12000),clinicalFacts:clinicalFacts(localBody).filter(fact=>!linkedin||name&&fact.toLowerCase().includes(name.toLowerCase())),clinicalFactBasis:'private_email_statement',candidateHosts:[...new Set([host(source.url),!CONSUMER.test(fromDomain)&&!linkedin?fromDomain:null].filter(Boolean))],provenance:{gmailId:message.id,threadId:message.threadId,sourceUrl:source.url,kind:'private_email_statement',publicationVerified:false,sourceIncomplete}});
 }
 return candidates;
}
async function fingerprint(message){return hash([text(message.from,2000),text(message.replyTo,2000),text(message.subject,2000),content(message),links(message).map(link=>({url:link.url,label:link.label}))]);}
async function bankMatches(db,root,candidates,now){
 const domains=[...new Set(candidates.flatMap(c=>c.candidateHosts||[]))].filter(d=>d&&!/linkedin\.com$/.test(d)).slice(0,8),names=[...new Set(candidates.map(inferMailLeadEmployerName).filter(Boolean))].slice(0,3);
 // The proof adapter cannot use domain matches without a specific employer
 // name. Opaque job alerts should continue to public research, not scan a
 // whole private bank for rows that preparation will immediately discard.
 if(!names.length)return [];
 // D1's compound-SELECT ceiling is lower than native SQLite's. Use only
 // two indexed arms, regardless of how many bounded names/hosts occur in an
 // alert. Each term is bound as JSON, never interpolated into SQL.
 const prefixes=domains.flatMap(domain=>['https://'+domain+'/','https://www.'+domain+'/']).map(prefix=>({prefix,upper:prefix.slice(0,-1)+'0'}));
 // Every prefix ends in ASCII '/'; its exclusive successor '0' bounds exactly
 // that host's URL range under NOCASE. The LIKE guard retains the prior match
 // predicate, while explicit bounds make the existing URL index usable.
 // Preserve complete same-name ambiguity outside the twenty displayed rows;
 // unnamed direct-host imports still have a zero name-domain count.
 const sql=`WITH matching AS MATERIALIZED (
  SELECT b.id,b.url,b.name,lower(b.name) AS name_key,b.last_success_at
  FROM json_each(?) n CROSS JOIN clinic_bank_leads b
  WHERE b.owner_id=? AND b.profile_id='arash' AND b.name=n.value COLLATE NOCASE
  UNION
  SELECT b.id,b.url,b.name,lower(b.name) AS name_key,b.last_success_at
  FROM json_each(?) p CROSS JOIN clinic_bank_leads b
  WHERE b.owner_id=? AND b.profile_id='arash'
   AND b.url COLLATE NOCASE>=json_extract(p.value,'$.prefix') AND b.url COLLATE NOCASE<json_extract(p.value,'$.upper')
   AND b.url LIKE json_extract(p.value,'$.prefix')||'%'
 ), matched AS MATERIALIZED (
  SELECT * FROM matching ORDER BY last_success_at DESC,id LIMIT 20
 ), matched_names AS MATERIALIZED (
  SELECT DISTINCT name_key FROM matched WHERE trim(name)!=''
 ), named_sites AS MATERIALIZED (
  SELECT n.name_key,count(DISTINCT lower(substr(replace(b.url,'https://www.','https://'),9,instr(substr(replace(b.url,'https://www.','https://'),9),'/')-1))) AS name_domain_count
  FROM matched_names n CROSS JOIN clinic_bank_leads b
  WHERE b.owner_id=? AND b.profile_id='arash' AND b.name=n.name_key COLLATE NOCASE GROUP BY n.name_key
 ) SELECT b.id,b.owner_id,b.profile_id,b.url,b.name,b.status,b.read_at,b.last_success_at,b.result_json,coalesce(s.name_domain_count,0) AS name_domain_count
 FROM matched m JOIN clinic_bank_leads b ON b.id=m.id LEFT JOIN named_sites s ON s.name_key=m.name_key ORDER BY m.last_success_at DESC,m.id`;
 let rows;try{rows=await all(db,sql,JSON.stringify(names),root,JSON.stringify(prefixes),root,root);}catch(error){if(/no such table:? (?:main\.)?clinic_bank_leads/i.test(error.cause?.message||error.message||''))return [];throw error;}
 return rows.map(row=>({...row,result:parse(row.result_json)}));
}
function applyBank(candidate,matches,root,now){return applyOwnedMailClinicBankProof(candidate,matches,{rootOwnerId:root,now});}
export async function prepareMailOpportunityDraft(candidate,writingContext={},{now=Date.now()}={}){
 const publicEvidence=assessMailOutreachEvidence(candidate,{now}),outreachMode=publicEvidence.outreachMode,initial=outreachMode==='initial_enquiry';
 // Mail/digest wording is a discovery lead. Both variant selection and the
 // letter's clinic facts use only the freshly verified public employer corpus.
 const clinicFacts=publicEvidence.verified?publicEvidence.clinicFacts.map(fact=>fact.text):[];
 const classification=classifyGpApplicationVariant({practiceName:publicEvidence.verified?candidate.clinicName:'',sourceText:clinicFacts.join('\n')});
 const writing=readGpWritingProfile(writingContext.profile||{},{variant:classification.variant}),ownFacts=cvFacts(writingContext.cvText||''),pair=suggestEvidencePair(clinicFacts.map(value=>({text:value})),ownFacts.map(value=>({text:value}))),clinicQuote=pair?.clinic?.text||pair?.clinicQuote||'',cvQuote=pair?.cv?.text||pair?.cvQuote||'';
 const restricted=candidate.sourceReviewRequired||candidate.publicationClosed||(Array.isArray(candidate.sourceRestrictions)&&candidate.sourceRestrictions.length)||['level1','sponsorship','registration'].some(key=>candidate.fit?.[key]==='restricted');
 const missing=[];if(!publicEvidence.verified)missing.push(publicEvidence.reason);if(candidate.sourceUnavailable)missing.push('source_unavailable_requires_review');if(restricted||candidate.closesAt&&Date.parse(candidate.closesAt)<=now)missing.push('source_restrictions_require_review');if(candidate.sourceIncomplete)missing.push('mail_source_incomplete');if(candidate.notificationEligible===false&&!initial)missing.push('source_freshness_or_fit_review_required');if(pair&&pair.evidenceMatch?.cvScope!=='clinical_self_report')missing.push('clinical_cv_evidence_required');if(pair&&!initial&&!pair.evidenceMatch?.sharedServices?.length)missing.push('specific_service_overlap_required');if(!writing.confirmed)missing.push('owner_writing_profile_required');if(!writing.signatureStatus.complete)missing.push(...writing.missingSignatureFields);if(!UUID.test(writingContext.cvVersionId||''))missing.push('cv_version_required');if(!candidate.clinicName)missing.push('clinic_name_required');if(!clinicQuote)missing.push('clinic_evidence_required');if(!cvQuote)missing.push('cv_evidence_required');
 const recipients=[...new Set((candidate.recipients||[candidate.recipient]).filter(value=>validContact(value)))];if(!recipients.length)missing.push('recruitment_contact_required');
 const selectedFact=publicEvidence.clinicFacts?.find(fact=>fact.text===clinicQuote),composed=composeClinicParagraphs({clinicName:candidate.clinicName,clinicQuote,cvQuote,confirmed:Boolean(cvQuote),professionalStrengths:writing.clinicalStrengths,supportingClinicFacts:publicEvidence.clinicFacts||[],now,clinicSourceURL:selectedFact?.sourceURL||candidate.clinicalSourceUrl||candidate.sourceUrl,clinicReadAt:selectedFact?.readAt||candidate.overlap?.readAt||new Date(candidate.receivedAt||Date.now()).toISOString()});
 const allPeople=publicEvidence.verified?(Array.isArray(candidate.research?.people)?candidate.research.people:[]).slice(0,12).map(person=>({...person,sourceRelation:person?.sourceURL===publicEvidence.officialSourceURL?'same_page':'linked_page'})):[];
 const people=allPeople.filter(person=>{
  const source=mailEmployerPublicURL(person?.sourceURL),at=Date.parse(person?.readAt||'');
  if(!source||host(source)!==host(publicEvidence.officialSourceURL)||!Number.isFinite(at)||at>now+60000||now-at>7*DAY||person.method!=='visible_role_label'||typeof person.name!=='string'||typeof person.quote!=='string'||!person.quote.toLowerCase().includes(person.name.toLowerCase()))return false;
  const latest=(candidate.research.sourcePages||[]).map((page,index)=>({...page,index})).filter(page=>mailEmployerPublicURL(page.sourceURL||page.url)===source).sort((a,b)=>Date.parse(b.readAt)-Date.parse(a.readAt)||b.index-a.index)[0];
  return latest&&['read','read_partial'].includes(latest.status)&&Date.parse(latest.readAt)>=at;
 });
 const selectedPerson=publishedApplicationContact({enrichment:{people:allPeople}}).selected;
 const manager=selectedPerson&&people.some(person=>person.name===selectedPerson.name&&person.role===selectedPerson.role)?selectedPerson.name:null;
 const mailEnvelope={practiceName:publicEvidence.verified?candidate.clinicName:'',practiceManager:manager,signatureName:writing.signatureName,signatureEmail:writing.signatureEmail,signaturePhone:writing.signaturePhone,signatureLinkedIn:writing.signatureLinkedIn};
 const subject=(initial?'GP enquiry — ':'GP application — ')+(candidate.clinicName||'practice enquiry');
 const body=writing.confirmed&&writing.signatureStatus.complete&&clinicQuote&&cvQuote&&candidate.clinicName?['Dear '+(manager||'Practice Manager')+',',writing.opening,composed.clinicReason,composed.candidateValue,writing.closing,'Kind regards,\n'+writing.signatureName+'\nPhone: '+writing.signaturePhone+'\nEmail: '+writing.signatureEmail+(writing.signatureLinkedIn?'\nLinkedIn: '+writing.signatureLinkedIn:'')].join('\n\n'):'';
 let emailBody=null;
 if(!missing.length)try{emailBody=buildGpApplicationEmail(mailEnvelope);}catch(error){if(!(error instanceof GpMailDocumentError))throw error;}
 const evidenceHash=await hash([outreachMode,candidate.gmailId,candidate.sourceUrl,candidate.contactBasis,clinicQuote,cvQuote,writingContext.cvVersionId,body]);
 return {status:missing.length?(recipients.length?'needs_evidence':'needs_contact'):'ready_for_review',readyForReview:missing.length===0,outreachMode,subject,body,mailEnvelope,emailBody,variant:classification.variant,recommendedVariant:classification.variant,variantReasons:classification.reasons,recipients,recipient:recipients[0]||null,cvVersionId:UUID.test(writingContext.cvVersionId||'')?writingContext.cvVersionId:null,evidenceHash,missing:[...new Set(missing)],paragraphs:{opening:writing.opening,clinic:composed.clinicReason,value:composed.candidateValue,closing:writing.closing},factBasis:{clinicQuote,cvQuote,kind:candidate.clinicalFactBasis==='source_published_statement'?'source_published_statement':'private_email_statement'},writingQuality:{...composed.writingQuality,outreachMode},reviewRequired:true,automaticSending:false};
}
function view(row){
 const data=parse(row.data_json),evidence=assessMailOutreachEvidence(data);let draft=row.draft_json?parse(row.draft_json):{status:'not_prepared',missing:['own_profile_context_required']};
 if((!evidence.verified||draft.outreachMode!==evidence.outreachMode)&&draft.readyForReview===true)draft={...draft,status:'needs_source_review',readyForReview:false,missing:[...new Set([...(draft.missing||[]),evidence.reason||'outreach_mode_review_required'])]};
 const sourceMap=new Map();for(const page of (Array.isArray(data.research?.sourcePages)?data.research.sourcePages:[]).slice(0,8)){const url=mailLeadPublicURL(page.sourceURL||page.url,{social:true})||safeURL(page.sourceURL||page.url);if(url)sourceMap.set(url,{url,status:page.status,readAt:page.readAt,kind:page.kind});}
 for(const page of (Array.isArray(data.research?.socialSources)?data.research.socialSources:[]).slice(0,6)){const url=mailLeadPublicURL(page.sourceURL||page.url,{social:true});if(url&&!sourceMap.has(url))sourceMap.set(url,{url,status:page.status||'discovered_not_read',readAt:page.readAt||null,kind:'public_social'});}
 const research={status:data.sourceUnavailable?'source_unavailable':data.researchStatus||'queued',verified:evidence.verified,reason:evidence.reason,checkedAt:data.researchReadAt||null,officialSourceUrl:evidence.officialSourceURL,searchStatus:data.research?.discovery?.searchStatus||null,sources:[...sourceMap.values()].slice(0,12),gaps:[...new Set([...(Array.isArray(data.sourceRestrictions)?data.sourceRestrictions.map(item=>item.code).filter(code=>typeof code==='string'):[]),...(Array.isArray(data.research?.gaps)?data.research.gaps:[])])].slice(0,12)};
 return {id:row.id,outreachMode:evidence.outreachMode,title:row.title,clinicName:row.clinic_name,sourceUrl:row.source_url,sourceKind:data.sourceKind||'job_notice',status:row.status,mailbox:row.owner_id.endsWith(':secondary')?'secondary':'primary',receivedAt:row.received_at,updatedAt:row.updated_at,unread:!row.read_at,fit:parse(row.fit_json),draft,overlap:data.overlap||{status:'not_checked'},research,provenance:data.provenance||{gmailId:row.gmail_id,threadId:row.thread_id,sourceUrl:row.source_url},notificationEligible:Boolean(row.notification_eligible),private:true};
}
export async function processMailOpportunityInputs(env,context,identity,options={}){
 const {owner,root}=scope(context);if(!env.GOOGLE_DB)fail('google_storage_required',503);if(!GMAIL.test(identity?.subject||''))fail('google_identity_required',403);
 const db=env.GOOGLE_DB,now=Number.isFinite(options.now)?options.now:Date.now();
 const input=await first(db,"UPDATE private_mail_opportunity_inputs SET status='processing',lease_until=?,updated_at=? WHERE rowid=(SELECT i.rowid FROM private_mail_opportunity_inputs i WHERE i.owner_id=? AND i.google_sub=? AND i.status IN ('queued','processing') AND i.lease_until<=? AND i.created_at>=coalesce((SELECT g.created_at FROM private_mail_opportunity_inputs g WHERE g.owner_id=i.owner_id AND g.google_sub=i.google_sub AND g.gmail_id='__history_gap__'),0) ORDER BY i.created_at,i.gmail_id LIMIT 1) AND lease_until<=? RETURNING *",now+300000,now,owner,identity.subject,now,now);
 if(!input)return {processed:0,more:false};
 try{
  const message=parse(input.payload_json),candidates=await extractMailOpportunityCandidates(message,{now}),selected=candidates.slice(input.candidate_offset,input.candidate_offset+MAX_CANDIDATES),matches=await bankMatches(db,root,selected,now),rows=[];
  for(const raw of selected){
   const candidate=applyBank(raw,matches,root,now),id='mop_'+(await hash([owner,identity.subject,candidate.key])).slice(0,32),draft=await prepareMailOpportunityDraft(candidate,options.writingContext||{},{now}),sourceFingerprint=await fingerprint(message),data={...candidate,messageFingerprint:sourceFingerprint,observedAt:input.created_at,sourceText:undefined};
   rows.push([id,owner,root,'arash',identity.subject,candidate.gmailId,candidate.threadId,candidate.sourceUrl,candidate.title,candidate.clinicName,JSON.stringify(candidate.fit),JSON.stringify(data),JSON.stringify(draft),candidate.receivedAt||now,now,now,root,JSON.stringify(candidate.recipients||[candidate.recipient].filter(Boolean)),candidate.notificationEligible?1:0,owner,identity.subject,input.gmail_id,now+300000,input.created_at]);
  }
  if(rows.length){
   const prefix='private_mail_opportunities.data_json';
   const preserve="json_extract("+prefix+",'$.contactBasis.kind') IN ('source_published_research_contact','source_published_bank_contact') AND coalesce(json_extract("+prefix+",'$.research.validUntil'),0)>excluded.updated_at";
   const restrictions="coalesce(json_extract("+prefix+",'$.sourceReviewRequired'),0)=1 OR coalesce(json_extract("+prefix+",'$.publicationClosed'),0)=1 OR coalesce(json_array_length(json_extract("+prefix+",'$.sourceRestrictions')),0)>0 OR coalesce(json_extract("+prefix+",'$.sourceUnavailable'),0)=1";
   const kept="json_object('recipient',json_extract("+prefix+",'$.recipient'),'recipients',json_extract("+prefix+",'$.recipients'),'contactBasis',json_extract("+prefix+",'$.contactBasis'),'clinicalFacts',json_extract("+prefix+",'$.clinicalFacts'),'clinicalFactBasis',json_extract("+prefix+",'$.clinicalFactBasis'),'clinicalSourceUrl',json_extract("+prefix+",'$.clinicalSourceUrl'),'research',json_extract("+prefix+",'$.research'),'researchStatus',json_extract("+prefix+",'$.researchStatus'),'researchReadAt',json_extract("+prefix+",'$.researchReadAt'),'applicationSourceVerified',json(CASE WHEN json_extract("+prefix+",'$.applicationSourceVerified')=1 THEN 'true' ELSE 'false' END),'publicationBasis',json_extract("+prefix+",'$.publicationBasis'),'canonicalApplicationURL',json_extract("+prefix+",'$.canonicalApplicationURL'))";
   const keptRestrictions="json_object('sourceReviewRequired',json(CASE WHEN coalesce(json_extract("+prefix+",'$.sourceReviewRequired'),0)=1 THEN 'true' ELSE 'false' END),'sourceRestrictions',json_extract("+prefix+",'$.sourceRestrictions'),'publicationClosed',json(CASE WHEN coalesce(json_extract("+prefix+",'$.publicationClosed'),0)=1 THEN 'true' ELSE 'false' END),'closesAt',json_extract("+prefix+",'$.closesAt'),'sourceUnavailable',json(CASE WHEN coalesce(json_extract("+prefix+",'$.sourceUnavailable'),0)=1 THEN 'true' ELSE 'false' END),'sourceUnavailableReason',json_extract("+prefix+",'$.sourceUnavailableReason'),'sourceUnavailableAt',json_extract("+prefix+",'$.sourceUnavailableAt'))";
   const merged="json_patch(CASE WHEN "+preserve+" THEN json_patch(excluded.data_json,"+kept+") ELSE excluded.data_json END,CASE WHEN "+restrictions+" THEN "+keptRestrictions+" ELSE '{}' END)";
   const select="SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM mail_automation_suppressions WHERE owner_id=? AND email IN(SELECT value FROM json_each(?))) THEN 0 ELSE ? END FROM private_mail_opportunity_inputs i WHERE i.owner_id=? AND i.google_sub=? AND i.gmail_id=? AND i.status='processing' AND i.lease_until=? AND i.created_at=?";
   await run(db,'INSERT INTO private_mail_opportunities(id,owner_id,root_owner_id,profile_id,google_sub,gmail_id,thread_id,source_url,title,clinic_name,fit_json,data_json,draft_json,received_at,created_at,updated_at,notification_eligible) '+rows.map(()=>select).join(' UNION ALL ')+" ON CONFLICT(id) DO UPDATE SET gmail_id=excluded.gmail_id,thread_id=excluded.thread_id,source_url=excluded.source_url,title=excluded.title,clinic_name=CASE WHEN "+preserve+" THEN private_mail_opportunities.clinic_name ELSE excluded.clinic_name END,fit_json=CASE WHEN "+preserve+" OR "+restrictions+" THEN private_mail_opportunities.fit_json ELSE excluded.fit_json END,data_json="+merged+",draft_json=CASE WHEN "+restrictions+" THEN json_set(excluded.draft_json,'$.status','needs_source_review','$.readyForReview',json('false'),'$.missing',json_array('source_restrictions_require_review')) WHEN "+preserve+" THEN private_mail_opportunities.draft_json ELSE excluded.draft_json END,received_at=max(private_mail_opportunities.received_at,excluded.received_at),updated_at=excluded.updated_at,notification_eligible=CASE WHEN private_mail_opportunities.status IN ('source_removed','dismissed') OR "+restrictions+" THEN 0 ELSE excluded.notification_eligible END WHERE coalesce(json_extract(excluded.data_json,'$.observedAt'),0)>=coalesce(json_extract(private_mail_opportunities.data_json,'$.observedAt'),0)",...rows.flat());
  }
  const offset=input.candidate_offset+selected.length,complete=offset>=candidates.length;
  await run(db,"UPDATE private_mail_opportunity_inputs SET candidate_offset=?,status=?,payload_json=CASE WHEN ? THEN '{}' ELSE payload_json END,lease_until=0,updated_at=? WHERE owner_id=? AND google_sub=? AND gmail_id=? AND lease_until=?",offset,complete?'completed':'queued',complete?1:0,now,owner,identity.subject,input.gmail_id,now+300000);
  return {processed:rows.length,more:true,completedInput:complete};
 }catch(error){await run(db,"UPDATE private_mail_opportunity_inputs SET status='queued',lease_until=0,updated_at=? WHERE owner_id=? AND google_sub=? AND gmail_id=? AND lease_until=?",now,owner,identity.subject,input.gmail_id,now+300000);throw error;}
}
export async function ingestMailOpportunities(env,context,messages,identity,options={}){
 const {owner,root}=scope(context);if(!env.GOOGLE_DB)fail('google_storage_required',503);if(!GMAIL.test(identity?.subject||'')||!Array.isArray(messages)||messages.length>MAX_INPUTS)fail('invalid_mail_opportunity_batch');
 const now=Number.isFinite(options.now)?options.now:Date.now(),observedAt=Number.isFinite(identity.observedAt)?identity.observedAt:now,hidden=messages.filter(message=>(message?.labels||[]).some(label=>['SPAM','TRASH','DRAFT'].includes(label))).map(message=>message.id).filter(id=>GMAIL.test(id));
 if(hidden.length)await invalidateMailOpportunities(env,context,hidden,identity);
 const valid=messages.filter(message=>GMAIL.test(message?.id||'')&&message.id!==GAP_ID&&isMailOpportunityMessage(message));
 // D1's compound-SELECT limit is lower than native SQLite's. One SELECT over
 // a bounded JSON batch preserves every input without adding per-message SQL.
 if(valid.length)await run(env.GOOGLE_DB,"INSERT INTO private_mail_opportunity_inputs(owner_id,root_owner_id,profile_id,google_sub,gmail_id,payload_json,created_at,updated_at) SELECT ?,?,'arash',?,json_extract(j.value,'$.id'),j.value,?,? FROM json_each(?) j WHERE ?>=coalesce((SELECT created_at FROM private_mail_opportunity_inputs WHERE owner_id=? AND google_sub=? AND gmail_id='__history_gap__'),0) ON CONFLICT(owner_id,google_sub,gmail_id) DO UPDATE SET payload_json=excluded.payload_json,status='queued',candidate_offset=0,lease_until=0,created_at=excluded.created_at,updated_at=excluded.updated_at WHERE private_mail_opportunity_inputs.status<>'source_removed' AND excluded.created_at>private_mail_opportunity_inputs.created_at",owner,root,identity.subject,observedAt,now,JSON.stringify(valid),observedAt,owner,identity.subject);
 if(hidden.length)return {queued:valid.length,processed:0,more:true,deferred:'label_invalidation'};
 const processed=await processMailOpportunityInputs(env,context,identity,options);return {queued:valid.length,...processed};
}
export async function invalidateMailOpportunities(env,context,ids,identity){
 const {owner,root}=scope(context);if(!Array.isArray(ids)||ids.length>2000||ids.some(id=>!GMAIL.test(id))||!GMAIL.test(identity?.subject||''))fail('invalid_mail_opportunity_deletions');if(!ids.length)return {removed:0};
 const now=Date.now(),observedAt=Number.isFinite(identity.observedAt)?identity.observedAt:now;
 const result=await run(env.GOOGLE_DB,"UPDATE private_mail_opportunities SET status='source_removed',notification_eligible=0,data_json=json_set(data_json,'$.observedAt',?),updated_at=? WHERE owner_id=? AND google_sub=? AND gmail_id IN(SELECT value FROM json_each(?)) AND coalesce(json_extract(data_json,'$.observedAt'),0)<=?",observedAt,now,owner,identity.subject,JSON.stringify(ids),observedAt);
 await run(env.GOOGLE_DB,"INSERT INTO private_mail_opportunity_inputs(owner_id,root_owner_id,profile_id,google_sub,gmail_id,payload_json,status,created_at,updated_at) SELECT ?,?,'arash',?,value,'{}','source_removed',?,? FROM json_each(?) WHERE true ON CONFLICT(owner_id,google_sub,gmail_id) DO UPDATE SET status='source_removed',payload_json='{}',lease_until=0,created_at=excluded.created_at,updated_at=excluded.updated_at WHERE excluded.created_at>=private_mail_opportunity_inputs.created_at",owner,root,identity.subject,observedAt,now,JSON.stringify(ids));return {removed:Number(result.meta?.changes)||0};
}
export async function invalidateMailOpportunityHistory(env,context,identity){
 const {owner,root}=scope(context);if(!GMAIL.test(identity?.subject||''))fail('google_identity_required',403);
 const now=Date.now(),observedAt=Number.isFinite(identity.observedAt)?identity.observedAt:now;
 await run(env.GOOGLE_DB,"UPDATE private_mail_opportunities SET notification_eligible=0,data_json=json_set(data_json,'$.historyGap',1,'$.observedAt',?),draft_json=json_set(coalesce(draft_json,'{}'),'$.status','needs_source_review','$.readyForReview',json('false')) WHERE owner_id=? AND google_sub=? AND coalesce(json_extract(data_json,'$.observedAt'),0)<=?",observedAt,owner,identity.subject,observedAt);
 // A tiny durable watermark blocks not-yet-known messages staged before a
 // history reset. Fresh archive observations requeue completed inputs, while
 // old leases/chunks cannot turn missing history into a fresh opportunity.
 await run(env.GOOGLE_DB,"INSERT INTO private_mail_opportunity_inputs(owner_id,root_owner_id,profile_id,google_sub,gmail_id,payload_json,status,created_at,updated_at) VALUES(?,?,'arash',?,'__history_gap__','{}','source_removed',?,?) ON CONFLICT(owner_id,google_sub,gmail_id) DO UPDATE SET created_at=excluded.created_at,updated_at=excluded.updated_at WHERE excluded.created_at>private_mail_opportunity_inputs.created_at",owner,root,identity.subject,observedAt,now);return {status:'source_recheck_required'};
}
async function ownedAccount(env,context){
 const own=scope(context),account=await first(env.GOOGLE_DB,'SELECT google_sub,email,status FROM google_accounts WHERE owner_id=? AND profile_id=?',own.owner,'arash');if(!account)fail('not_connected',409);if(account.status!=='connected')fail('reconnect_required',409);return {...own,account};
}
async function writingContext(context,cvVersionId){
 if(typeof context.rest!=='function')fail('own_profile_context_required',409);
 const root=context.rootUserId||context.userId.replace(/:secondary$/,''),suffix='&profile_id=eq.arash&user_id=eq.'+encodeURIComponent(root);
 const profileRows=await context.rest('immi_profiles','?select=data'+suffix),profiles=profileRows?.[0]?.data;if(!profiles)fail('own_profile_context_required',409);
 let selected=cvVersionId;
 if(!selected){const defaults=await context.rest('immi_cv_defaults','?select=version_id'+suffix);selected=defaults?.[0]?.version_id||null;if(selected&&!UUID.test(selected))fail('invalid_cv_version',409);}
 const query='?select=id,text,version'+suffix+(selected?'&id=eq.'+selected:'&order=version.desc&limit=1'),versions=await context.rest('immi_cv_versions',query),cv=versions?.[0];if(!cv||!UUID.test(cv.id||'')||typeof cv.text!=='string'||selected&&cv.id!==selected)fail('cv_version_required',409);
 return {profile:profiles,cvText:cv.text,cvVersionId:cv.id};
}
export async function prepareOwnedMailOpportunity(env,context,id,input={},options={}){
 if(!ID.test(id||''))fail('invalid_mail_opportunity_id');if(input.cvVersionId!==undefined&&!UUID.test(input.cvVersionId))fail('invalid_cv_version');
 const {owner,root,account}=await ownedAccount(env,context),row=await first(env.GOOGLE_DB,'SELECT * FROM private_mail_opportunities WHERE id=? AND owner_id=? AND google_sub=?',id,owner,account.google_sub);if(!row)fail('mail_opportunity_not_found',404);if(['source_removed','dismissed'].includes(row.status))fail('mail_opportunity_unavailable',409);
 const now=Math.max(options.now||Date.now(),Number(row.updated_at)+1);if(row.received_at>now+60000)fail('mail_opportunity_requires_refresh',409);
 const data=parse(row.data_json),matches=await bankMatches(env.GOOGLE_DB,root,[data],now),candidate=assessMailOutreachEvidence(data,{now}).verified?data:applyBank(data,matches,root,now),writing=options.writingContext||await writingContext(context,input.cvVersionId),draft=await prepareMailOpportunityDraft(candidate,writing,{now});
 if(mailOutreachMode(candidate)==='job_application'&&now-row.received_at>MAX_AGE)fail('mail_opportunity_requires_refresh',409);
 const changed=await run(env.GOOGLE_DB,"UPDATE private_mail_opportunities SET data_json=?,draft_json=?,updated_at=?,clinic_name=? WHERE id=? AND owner_id=? AND google_sub=? AND updated_at=? AND data_json=? AND draft_json IS ? AND status IN ('suggested','reviewed') AND EXISTS(SELECT 1 FROM google_accounts a WHERE a.owner_id=private_mail_opportunities.owner_id AND a.google_sub=private_mail_opportunities.google_sub AND a.status='connected')",JSON.stringify(candidate),JSON.stringify(draft),now,candidate.clinicName||'',id,owner,account.google_sub,row.updated_at,row.data_json,row.draft_json);
 if(Number(changed.meta?.changes)!==1)fail('mail_opportunity_changed',409);
 const proposal={id,...draft,clinicName:candidate.clinicName,mailOpportunityContext:{id},googleSubject:account.google_sub,sender:account.email,provenance:candidate.provenance,fit:parse(row.fit_json),private:true};
 if(options.skipOwnerEdit)return {...proposal,...(options.includeSourceState?{sourceState:{updatedAt:now,dataJson:JSON.stringify(candidate),draftJson:JSON.stringify(draft)}}:{})};
 return hydrateMailOpportunityEdit(env,context,proposal);
}
export async function getOwnedMailOpportunityContext(env,userId,selection,fetcher=fetch,accessProvider=getGoogleAccess){
 if(!env.GOOGLE_DB)fail('google_storage_required',503);if(!ID.test(selection?.id||'')||Object.keys(selection).some(k=>!['id','recipient','editedDraftId'].includes(k))||selection.editedDraftId!==undefined&&selection.editedDraftId!==null&&!/^moedit_[a-f0-9]{32}$/.test(selection.editedDraftId))fail('invalid_mail_opportunity_context');
 const access=await accessProvider(env,userId,fetcher);if(!access.subject||!access.scopes?.some(s=>['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/'].includes(s)))fail('gmail_read_scope_required',403);
 const row=await first(env.GOOGLE_DB,"SELECT * FROM private_mail_opportunities WHERE id=? AND owner_id=? AND google_sub=? AND status IN ('suggested','reviewed')",selection.id,userId,access.subject);if(!row)fail('mail_opportunity_not_found',404);
 const data=parse(row.data_json),draft=parse(row.draft_json);if(data.sourceReviewRequired||data.publicationClosed||(Array.isArray(data.sourceRestrictions)&&data.sourceRestrictions.length)||['level1','sponsorship','registration'].some(key=>data.fit?.[key]==='restricted'))fail('mail_opportunity_source_restricted',409);if(data.sourceUnavailable)fail('mail_opportunity_source_unavailable',409);if(data.closesAt&&Date.parse(data.closesAt)<=Date.now())fail('mail_opportunity_closed',409);if(data.historyGap)fail('mail_opportunity_requires_refresh',409);if(!assessMailOutreachEvidence(data).verified)fail('mail_opportunity_public_evidence_required',409);if(draft.outreachMode!==mailOutreachMode(data))fail('mail_opportunity_changed_review_required',409);if(draft.status!=='ready_for_review'||!draft.body||!draft.subject||!UUID.test(draft.cvVersionId||''))fail('mail_opportunity_draft_not_ready',409);
 if(mailOutreachMode(data)==='job_application'&&Date.now()-row.received_at>MAX_AGE||row.received_at>Date.now()+60000)fail('mail_opportunity_requires_refresh',409);
 const recovery={env,owner:userId,access,accessProvider,refreshed:false};let message;try{message=normalizeMessage(await readGoogleMailJson(fetcher,access.accessToken,'messages/'+encodeURIComponent(row.gmail_id)+'?format=full',recovery));}catch(error){if(error.code==='gmail_not_found')fail('mail_opportunity_source_removed',409);throw error;}if(recovery.access.email?.toLowerCase()!==access.email?.toLowerCase())fail('connection_changed',409);
 if(message.bodyTruncated||message.linksTruncated)fail('mail_opportunity_source_incomplete',409);
 if(message.id!==row.gmail_id||!visible(message)||await fingerprint(message)!==data.messageFingerprint)fail('mail_opportunity_source_changed',409);
 if(/^source_published_/.test(data.contactBasis?.kind||'')){
  const at=typeof data.contactBasis.readAt==='number'?data.contactBasis.readAt:Date.parse(data.contactBasis.readAt||'');
  if(!safeURL(data.contactBasis.sourceUrl)||!Number.isFinite(at)||at>Date.now()+60000||Date.now()-at>7*DAY)fail('mail_opportunity_contact_requires_refresh',409);
 }
 const recipients=(draft.recipients||[]).filter(validContact),recipient=selection.recipient||recipients[0];if(!recipient||!recipients.includes(recipient))fail('mail_opportunity_recipient_changed',409);
 const edited=await hydrateMailOpportunityEdit(env,{userId,profileId:'arash'},{...draft,id:row.id,clinicName:row.clinic_name||data.clinicName,readyForReview:true,googleSubject:access.subject,sender:access.email,provenance:data.provenance},{includeHead:true,...(selection.editedDraftId!==undefined?{editedDraftId:selection.editedDraftId}:{})});
 if(!edited.readyForReview)fail('mail_opportunity_edit_context_changed',409);
 return {id:row.id,outreachMode:edited.outreachMode,to:recipient,recipients,subject:edited.subject,body:edited.body,mailEnvelope:edited.mailEnvelope,cvVersionId:draft.cvVersionId,evidenceHash:draft.evidenceHash,editedDraftId:edited.editedDraftId||null,googleSubject:access.subject,sourceGmailId:row.gmail_id,referenceUrl:row.source_url,applicationKey:mailInitialEnquiryKey(data)||verifiedMailApplicationURL(data)||(data.key&&!data.key.startsWith('gmail:')?data.key:'email:'+data.messageFingerprint),sourceState:{updatedAt:row.updated_at,dataJson:row.data_json,draftJson:row.draft_json,...(edited.editHeadRevision===undefined?{}:{ownerEditRevision:edited.editHeadRevision})}};
}
async function payload(request){if(Number(request.headers.get('content-length')||0)>2000)fail('payload_too_large',413);const raw=await request.text();if(raw.length>2000)fail('payload_too_large',413);try{const parsed=JSON.parse(raw||'{}');if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')fail('invalid_payload');return parsed;}catch{fail('invalid_payload');}}
export async function handleMailOpportunitiesRequest(request,env,context){
 const editing=await handleMailOpportunityEditsRequest(request,env,context);if(editing)return editing;
 const url=new URL(request.url),match=/^\/api\/google\/mail-opportunities(?:\/(mop_[a-f0-9]{32})(?:\/(prepare|read))?)?$/.exec(url.pathname);if(!match)return null;
 try{
  if(!env.GOOGLE_DB)fail('google_storage_required',503);const {owner,account}=await ownedAccount(env,context);if(url.searchParams.has('profile')&&url.searchParams.get('profile')!=='arash')fail('profile_access_denied',403);if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail('origin_rejected',403);
  const id=match[1],action=match[2];
  if(request.method==='GET'&&!id){
   const limit=Number(url.searchParams.get('limit')||25),offset=Number(url.searchParams.get('offset')||0),sort=url.searchParams.get('sort')||'ready';
   if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>10000)fail('invalid_pagination');if(!['relevant','ready','newest'].includes(sort))fail('invalid_sort');
   const now=Date.now(),freshProof="json_extract(data_json,'$.research.publicEmployerVerified')=1 AND (julianday(json_extract(data_json,'$.research.verification.checkedAt'))-2440587.5)*86400000 BETWEEN ? AND ?",
    unrestricted="status IN ('suggested','reviewed') AND coalesce(json_extract(data_json,'$.sourceUnavailable'),0)=0 AND coalesce(json_extract(data_json,'$.sourceReviewRequired'),0)=0 AND coalesce(json_extract(data_json,'$.publicationClosed'),0)=0 AND coalesce(json_array_length(json_extract(data_json,'$.sourceRestrictions')),0)=0 AND coalesce(json_extract(data_json,'$.sourceIncomplete'),0)=0 AND coalesce(json_extract(data_json,'$.historyGap'),0)=0 AND coalesce(json_extract(data_json,'$.fit.level1'),'')!='restricted' AND coalesce(json_extract(data_json,'$.fit.sponsorship'),'')!='restricted' AND coalesce(json_extract(data_json,'$.fit.registration'),'')!='restricted'",
    mode="CASE WHEN json_extract(data_json,'$.applicationSourceVerified')=1 THEN 'job_application' ELSE 'initial_enquiry' END",
    prepared="json_extract(draft_json,'$.readyForReview')=1 AND json_extract(draft_json,'$.outreachMode')="+mode,
    informed="trim(coalesce(json_extract(data_json,'$.clinicName'),clinic_name,''))!='' AND coalesce(json_array_length(json_extract(data_json,'$.research.facts')),0)>0 AND coalesce(json_array_length(json_extract(data_json,'$.research.contactEvidence')),0)>0",
    // Compute rank over the whole owned pool before LIMIT/OFFSET. This is a
    // cached information order; every preview/send repeats the strict gate.
    readyOrder="CASE WHEN "+unrestricted+" THEN 0 ELSE 1 END,CASE WHEN "+freshProof+" THEN CASE WHEN "+prepared+" THEN 0 WHEN "+informed+" THEN 1 ELSE 2 END ELSE 3 END";
   const fit=key=>`coalesce(json_extract(data_json,'$.fit.${key}'),json_extract(fit_json,'$.${key}'),'unknown')`;
   const level1=fit('level1'),sponsorship=fit('sponsorship'),registration=fit('registration'),pesci=fit('pesci');
   const relevantOrder=`CASE
    WHEN status NOT IN ('suggested','reviewed')
      OR coalesce(json_extract(data_json,'$.publicationClosed'),0)=1
      OR coalesce(json_extract(data_json,'$.sourceUnavailable'),0)=1
      OR coalesce(json_extract(data_json,'$.historyGap'),0)=1
      OR coalesce(json_array_length(json_extract(data_json,'$.sourceRestrictions')),0)>0
      OR julianday(json_extract(data_json,'$.closesAt'))<julianday('now')
      OR 'restricted' IN (${level1},${sponsorship},${registration}) THEN 4
    WHEN ${level1}='supported' AND ${sponsorship}='supported' THEN 0
    WHEN ${level1}='supported' THEN 1
    WHEN ${sponsorship}='supported' OR ${pesci}='supported' THEN 2
    ELSE 3 END`;
   const rank=sort==='relevant'?relevantOrder:sort==='ready'?readyOrder:'';
   const order=(rank?rank+',':'')+'received_at DESC,id';
   const rows=await all(env.GOOGLE_DB,'SELECT * FROM private_mail_opportunities WHERE owner_id=? AND google_sub=? ORDER BY '+order+' LIMIT ? OFFSET ?',owner,account.google_sub,...(sort==='ready'?[now-7*DAY,now+60000]:[]),limit+1,offset);
   const counts=await first(env.GOOGLE_DB,"SELECT count(*) AS total,sum(read_at IS NULL AND status NOT IN ('source_removed','dismissed')) AS unread FROM private_mail_opportunities WHERE owner_id=? AND google_sub=?",owner,account.google_sub);
   return json({items:rows.slice(0,limit).map(view),sort,more:rows.length>limit,nextOffset:rows.length>limit?offset+limit:null,unreadCount:Number(counts?.unread)||0,total:Number(counts?.total)||0,private:true,automaticSending:false});
  }
  if(request.method==='GET'&&id&&!action){
   const row=await first(env.GOOGLE_DB,'SELECT * FROM private_mail_opportunities WHERE id=? AND owner_id=? AND google_sub=?',id,owner,account.google_sub);if(!row)fail('mail_opportunity_not_found',404);
   const result=view(row);
   if(UUID.test(result.draft?.cvVersionId||''))result.draft=await hydrateMailOpportunityEdit(env,context,{...result.draft,id:row.id,clinicName:row.clinic_name,googleSubject:account.google_sub,sender:account.email,provenance:parse(row.data_json).provenance});
   return json(result);
  }
  if(request.method==='POST'&&action==='read'){const input=await payload(request);if(Object.keys(input).length)fail('invalid_payload');const changed=await first(env.GOOGLE_DB,"UPDATE private_mail_opportunities SET read_at=?,status=CASE WHEN status='suggested' THEN 'reviewed' ELSE status END WHERE id=? AND owner_id=? AND google_sub=? RETURNING id",Date.now(),id,owner,account.google_sub);if(!changed)fail('mail_opportunity_not_found',404);return json({id,read:true});}
  if(request.method==='POST'&&action==='prepare'){const input=await payload(request);if(Object.keys(input).some(k=>k!=='cvVersionId'))fail('invalid_payload');return json(await prepareOwnedMailOpportunity(env,context,id,input));}
  return json({error:'method_not_allowed'},405);
 }catch(error){return json({error:/^[a-z_]{3,80}$/.test(error.code||'')?error.code:'mail_opportunities_unavailable'},error.status||503);}
}
