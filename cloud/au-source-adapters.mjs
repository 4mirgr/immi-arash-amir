// Fixed first-party public recruitment pages; no applications, sessions or private APIs.
import {plainJobText} from './job-opportunities.mjs';
export const AU_SOURCE_DEFINITIONS=Object.freeze([
 {id:'qld-smartjobs-medical-html',name:'Queensland Government Smart Jobs — Health Medical',country:'AU',state:'QLD',trust:'official',profileScope:'both',executable:true,configurationStatus:'executable',verifiedAt:'2026-11-04',adapter:'au_qld_smartjobs_html',portalUrl:'https://smartjobs.qld.gov.au/',evidenceUrl:'https://smartjobs.qld.gov.au/jobtools/jncustomsearch.jobsearch?in_organid=14904&in_exact_phrase_match=Y',feedUrl:'https://smartjobs.qld.gov.au/jobtools/jncustomsearch.searchResults?in_organid=14904&in_multi01_id=1108&in_multi01=%2244%22&in_orderby=scoring%20desc',allowedHosts:['smartjobs.qld.gov.au'],organizationName:'Queensland Health',organizationDomain:'health.qld.gov.au',opportunityType:'job',coverageLimit:'first_public_medical_search_page_only',reason:'Visible public form identifies occupational group Health - Medical as44 and field1108; fixed anonymous HTML search returns first20cards. Explicit ISO closing dates retained except Ongoing placeholder; publication dates absent. No applications, cookies, sessions or candidate endpoints used.'},
 {id:'nsw-health-jmo-public-html',name:'NSW Health — public Junior Medical Officer portal',country:'AU',state:'NSW',trust:'official',profileScope:'both',executable:true,configurationStatus:'executable',verifiedAt:'2026-11-04',adapter:'au_nsw_jmo_html',portalUrl:'https://jobs.health.nsw.gov.au/medical-jobs',evidenceUrl:'https://jobs.health.nsw.gov.au/medical-jobs',feedUrl:'https://jobs.health.nsw.gov.au/JMO-ex',allowedHosts:['jobs.health.nsw.gov.au'],organizationName:'NSW Health (recruitment publisher)',organizationDomain:'health.nsw.gov.au',opportunityType:'job',coverageLimit:'public_jmo_landing_page_cards_only',reason:'Official medical-jobs page links JMO-ex. Its public landing HTML contains five JMO cards; employer district, title, location and synopsis retained. No closing or publication dates on cards; detail conditions require separate review. No internal search/API, login or application endpoint used.'}
].map(Object.freeze));
const sources=new Map(AU_SOURCE_DEFINITIONS.map(s=>[s.id,s]));
const plain=(value,max=20000)=>plainJobText(value,max);
const clinical=/\b(?:general practitioner|rural generalist|medical officer|medical practitioner|medical superintendent|registrar|house officer|staff specialist|provisional fellow|advanced trainee|physician)\b/i;
const excluded=/\b(?:nurs(?:e|ing)|dent(?:al|ist)|physiotherap|social worker|administrat|reception|practice manager)\b/i;
function fail(code){const error=new Error(code);error.code=code;throw error;}
function safeUrl(value,source){let u;try{u=new URL(value,source.feedUrl);}catch{fail('invalid_au_source_url');}if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!source.allowedHosts.includes(u.hostname))fail('invalid_au_source_url');return u;}
function base(source,id,title,url,extra={}){return {externalId:id,title,url,country:'AU',state:source.state,organization:source.organizationName,organizationDomain:source.organizationDomain,opportunityType:'job',kind:/expression(?:s)? of interest|talent pool|employment register/i.test(title)?'employment_register':'vacancy',publishedAt:null,closingAt:null,...extra};}
function qld(source,body){
 const area=body.match(/<ol\b[^>]*class=["'][^"']*\bsearch-results\s+jobs\b[^"']*["'][^>]*>([\s\S]*?)<\/ol>/i)?.[1];
 if(area==null)fail('invalid_au_source_html');
 const cards=[...area.matchAll(/<li>\s*<h3>([\s\S]*?)<\/div>\s*<\/li>/gi)];if(!cards.length||cards.length>100)fail('invalid_au_source_schema');
 const records=[];
 for(const [,card]of cards){
  const anchor=card.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<span\b[^>]*class=["'][^"']*result-title[^"']*["'][^>]*>\s*<strong>([\s\S]*?)<\/strong>/i);
  if(!anchor)fail('invalid_au_source_identity');
  const title=plain(anchor[2],500),u=safeUrl(anchor[1].replaceAll('&amp;','&'),source);
  const id=u.searchParams.get('in_jnCounter');
  if(u.pathname!=='/jobtools/jncustomsearch.viewFullSingle'||u.searchParams.get('in_organid')!=='14904'||!/^\d{1,20}$/.test(id||'')||[...u.searchParams.keys()].some(k=>!['in_organid','in_jnCounter','in_orderby'].includes(k)))fail('invalid_au_source_identity');
  if(!clinical.test(title)||excluded.test(title))continue;
  const close=card.match(/<time\b[^>]*class=["'][^"']*date-closes[^"']*["'][^>]*datetime=["']([^"']+)["'][^>]*>([\s\S]*?)<\/time>/i);
  let closingAt=null;
  if(close&&!/ongoing/i.test(plain(close[2]))){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(close[1])||!Number.isFinite(Date.parse(close[1]))||new Date(Date.parse(close[1].slice(0,10)+'T00:00:00Z')).toISOString().slice(0,10)!==close[1].slice(0,10))fail('invalid_au_source_date');closingAt=new Date(close[1]).toISOString();}
  const summary=plain(card.match(/<div\b[^>]*class=["'][^"']*search-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1],3000);
  const location=plain(card.match(/<strong\b[^>]*class=["'][^"']*locality[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i)?.[1],500);
  const grade=plain(card.match(/<strong\b[^>]*class=["'][^"']*grade[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i)?.[1],200);
  records.push(base(source,id,title,'https://smartjobs.qld.gov.au/jobtools/jncustomsearch.viewFullSingle?in_organid=14904&in_jnCounter='+id,{closingAt,location,summary,fullText:[summary,grade?'Advertised classification: '+grade:'',close?'Advertised closing: '+plain(close[2],100):''].filter(Boolean).join('\n')}));
 }
 return records;
}
function nsw(source,body){
 if(!/<html\b/i.test(body)||!/<\/html\s*>/i.test(body))fail('invalid_au_source_html');
 const cards=body.split(/<div\b(?=[^>]*\bid=["']job_list_\d+["'])(?=[^>]*\bclass=["'][^"']*job_list_row)[^>]*>/i).slice(1);if(!cards.length||cards.length>100)fail('invalid_au_source_schema');
 const records=[];
 for(const card of cards){
  const anchor=card.match(/<a\b(?=[^>]*\bclass=["'][^"']*\bjob_link\b)[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);if(!anchor)fail('invalid_au_source_identity');
  const u=safeUrl(anchor[1].replaceAll('&amp;','&'),source),id=u.pathname.match(/^\/JMO-ex\/jobs\/[a-z0-9-]+-(\d+)$/)?.[1];
  if(!id||u.search)fail('invalid_au_source_identity');
  const title=plain(anchor[2],500);if(!clinical.test(title)||excluded.test(title))continue;
  const summary=plain(card.match(/<p\b[^>]*class=["'][^"']*\bjlr_description\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1],3000);
  const location=plain(card.match(/<p\b[^>]*class=["'][^"']*\bjlr_location\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1],500);
  const company=plain(card.match(/<p\b[^>]*class=["'][^"']*\bjlr_company_field\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\bjlr_value\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1],300);
  records.push(base(source,id,title,u.href,{organization:company||source.organizationName,location,summary,fullText:summary}));
 }
 return records;
}
export async function normalizeAuSourceRecords(input,body){const source=sources.get(input?.id);if(!source||input.adapter!==source.adapter)fail('au_source_not_registered');if(typeof body!=='string'||new TextEncoder().encode(body).length>3000000)fail('au_source_response_too_large');return source.adapter==='au_qld_smartjobs_html'?qld(source,body):nsw(source,body);}
