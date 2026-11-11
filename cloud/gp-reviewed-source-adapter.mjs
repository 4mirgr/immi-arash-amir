// Reviewed public recruitment pages. Review snapshots configure scope only; all
// opportunity/contact text is extracted anew from the current fetched page.
import candidates from './gp-reviewed-discovery-sources.json' with {type:'json'};
import {visiblePageText} from './public-page-worker.mjs';
import {extractPublicContacts} from './public-contact-extraction.mjs';
export class ReviewedGpSourceError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ReviewedGpSourceError(code);};
function definition(source){
 const url=new URL(source.feedUrl),active=source.activationAllowed===true&&source.directHttpStatus===200&&source.collectorUserAgentHttpStatus===200;
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!source.allowedHosts?.includes(url.hostname))fail('invalid_reviewed_gp_configuration');
 return Object.freeze({id:source.id,name:source.name,country:'AU',state:source.state,trust:source.trust==='official'?'official':'unofficial',profileScope:'both',feedUrl:url.href,portalUrl:source.portalUrl,evidenceUrl:url.href,allowedHosts:[url.hostname],organizationName:source.organizationName,organizationDomain:source.organizationDomain,location:source.location,title:source.title,opportunityType:'job',kind:source.kind==='vacancy'?'vacancy':'employment_register',adapter:'gp_reviewed_html',executable:active,configurationStatus:active?'executable':'reviewed_manual_only',verifiedAt:source.reviewedAt,reason:(source.limitations||[]).join(' ').slice(0,1800)||'Public page requires individual vacancy and supervision confirmation.',coverageLimit:'fixed_reviewed_public_recruitment_page_only',requiresRobots:true});
}
export const GP_REVIEWED_SOURCE_DEFINITIONS=Object.freeze(candidates.map(definition));
const registry=new Map(GP_REVIEWED_SOURCE_DEFINITIONS.map(source=>[source.id,source]));
export function normalizeReviewedGpSourceRecords(input,body){
 const source=registry.get(input?.id);if(!source?.executable||input.adapter!==source.adapter)fail('reviewed_gp_source_not_registered');
 if(typeof body!=='string'||new TextEncoder().encode(body).length>1000000)fail('reviewed_gp_source_body_too_large');
 if(!/<html\b/i.test(body)||!/<\/html\s*>/i.test(body))fail('invalid_reviewed_gp_source_html');
 let content=visiblePageText(body).text;
 if(/verify (?:that )?you are (?:a )?human|checking your browser|access denied|sign in to continue|attention required.{0,30}cloudflare|just a moment/i.test(content.slice(0,1500)))fail('reviewed_gp_access_challenge');
 // This third-party referral page also prints its publisher's headquarters and
 // related navigation. Keep only the actual job/practice contact section.
 if(source.id==='reviewed-hwq-wembley-level1'){
  const start=content.indexOf('Position Highlights:'),contact=content.indexOf('Practice Contact Details:',start),end=content.indexOf('APPLY NOW!',contact);
  if(start<0||contact<0||end<contact||!content.slice(contact,end).includes(source.organizationName))fail('reviewed_gp_job_section_missing');
  content=content.slice(start,end);
 }
 const hiringLanguage=/\b(?:career|employment|recruit|hiring|vacanc|supervis|training|mentorship|interest|PESCI)\w*/i.test(content)||/\b(?:looking for|seeking)\s+(?:enthusiastic\s+)?(?:general practitioners?|GPs?)\b/i.test(content);
 if(content.length<120||!/\b(?:GPs?|general practi(?:ce|tioners?)|medical practitioners?)\b/i.test(content)||!hiringLanguage)fail('reviewed_gp_recruitment_not_found');
 const evidence=extractPublicContacts(source.id==='reviewed-hwq-wembley-level1'?{text:content,sourceURL:source.feedUrl}:{html:body,sourceURL:source.feedUrl});
 const contacts=evidence.contacts.filter(contact=>['email','phone','website'].includes(contact.type)&&['application','organization_general','unknown'].includes(contact.contactRole));
 const appendix=contacts.slice(0,12).map(contact=>'Published '+contact.contactRole+' '+contact.type+': '+contact.value+' — '+contact.quote).join('\n');
 const fullText=(content+(appendix?'\n'+appendix:'')).slice(0,20000);
 // Evergreen network pages remain EOI registers, never a current named vacancy.
 const title=source.kind==='employment_register'?'General Practitioner expression of interest — '+source.organizationName:source.title;
 return [{externalId:source.id,title,url:source.feedUrl,country:'AU',state:source.state,organization:source.organizationName,organizationDomain:source.organizationDomain,location:source.location,city:source.location,opportunityType:'job',kind:source.kind,publishedAt:null,closingAt:null,summary:content.slice(0,2800),fullText,contactEvidence:contacts}];
}
