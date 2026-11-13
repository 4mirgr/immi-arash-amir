// ACT primary-health-network public listing only. Detail-page reading is separate;
// a GP card is neither personal eligibility nor a verified supervision offer.
import {visiblePageText} from './public-page-worker.mjs';
export const CHN_GP_SOURCE_DEFINITIONS=Object.freeze([Object.freeze({
 id:'act-chn-public-gp',name:'Capital Health Network — ACT public GP vacancies',country:'AU',state:'ACT',trust:'official',profileScope:'both',executable:true,configurationStatus:'executable',verifiedAt:'2026-11-13',adapter:'gp_chn_listing_html',
 portalUrl:'https://www.chnact.org.au/careers/external-primary-care-vacancies/general-practitioner-vacancies/',
 evidenceUrl:'https://www.chnact.org.au/careers/external-primary-care-vacancies/general-practitioner-vacancies/',
 feedUrl:'https://www.chnact.org.au/careers/external-primary-care-vacancies/general-practitioner-vacancies/',allowedHosts:Object.freeze(['www.chnact.org.au']),organizationName:'Capital Health Network (recruitment publisher)',organizationDomain:'chnact.org.au',requiresRobots:true,opportunityType:'job',coverageLimit:'first_public_listing_page_only',
 reason:'Public GP cards with named practices and publication dates. Explicit VR-only titles excluded; linked requirements/contact reading remains necessary. Neither supervision level, visa sponsorship nor eligibility is inferred. First page only; closing dates unstated.'
})]);
const SOURCE=CHN_GP_SOURCE_DEFINITIONS[0];
export class ChnGpSourceError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new ChnGpSourceError(code);};
const text=html=>visiblePageText(html).text.trim();
function link(value){
 let u;try{u=new URL(value,SOURCE.feedUrl);}catch{fail('invalid_chn_job_url');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname!=='www.chnact.org.au'||u.search||u.hash||!/^\/gp_vacancies\/[a-z0-9-]+\/$/.test(u.pathname))fail('invalid_chn_job_url');
 return u;
}
function listedDay(value){
 const m=value.match(/^Date:\s*(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})$/i);
 if(!m)fail('invalid_chn_publication_date');
 const months='January February March April May June July August September October November December'.toLowerCase().split(' '),day=Number(m[1]);
 const date=`${m[3]}-${String(months.indexOf(m[2].toLowerCase())+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 if(!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('invalid_chn_publication_date');
 return date; // Published day only, not a claimed exact venue timestamp.
}
export function normalizeChnGpSourceRecords(input,body){
 if(input?.id!==SOURCE.id||input.adapter!==SOURCE.adapter)fail('chn_source_not_registered');
 if(typeof body!=='string'||new TextEncoder().encode(body).length>1000000)fail('chn_source_response_too_large');
 if(!/<html\b/i.test(body)||!/<\/html\s*>/i.test(body))fail('invalid_chn_source_html');
 const overall=visiblePageText(body);
 if(!/Capital Health Network/i.test(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')||!/General Practitioner Vacancies/i.test(overall.text)||/verify you are human|access denied|just a moment|sign in to continue/i.test(overall.text.slice(0,1200)))fail('chn_listing_not_readable');
 const main=body.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]?.replace(/<(script|style|template|form|nav)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');if(!main)fail('chn_listing_not_readable');
 const cards=[...main.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(([,attrs,card])=>/\bclass=["'][^"']*\blisting-item\b/i.test(card));
 if(!cards.length||cards.length>40)fail('chn_listing_schema_changed');
 const rows=[],seen=new Set();
 for(const [,attrs,card]of cards){
  const visible=text('<a '+attrs+'>'+card+'</a>');if(!visible||!overall.text.includes(visible))continue;
  const heading=card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1],title=heading?text(heading):'';
  if(!title||title.length>500)fail('invalid_chn_job_title');
  if(!/\b(?:general practitioner|GP)\b/i.test(title)||/\b(?:nurs(?:e|ing)|practice manager|receptionist|physiotherap)\b/i.test(title))continue;
  if(!/\bnon[\s-]?VR\b/i.test(title)&&/\b(?:VR|vocationally registered)\s+(?:general practitioner|GP)\b/i.test(title))continue;
  const href=attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];if(!href)fail('invalid_chn_job_url');
  const url=link(href);if(seen.has(url.href))fail('duplicate_chn_job_identity');seen.add(url.href);
  const details=[...card.matchAll(/<p\b[^>]*\bclass=["'][^"']*\bdetails-row\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)].map(([,value])=>text(value));
  const dates=details.filter(value=>/^Date:/i.test(value));if(dates.length!==1)fail('invalid_chn_publication_date');
  const publishedAt=listedDay(dates[0]),location=details.find(value=>!/^Date:|^Hours:/i.test(value))||'';
  const separator=title.lastIndexOf(' - '),organization=separator>=0?title.slice(separator+3).trim():SOURCE.organizationName;
  rows.push({externalId:url.pathname.split('/').filter(Boolean).at(-1),title,url:url.href,country:'AU',state:'ACT',organization,organizationDomain:null,location,city:location,publishedAt,closingAt:null,opportunityType:'job',kind:'vacancy',summary:visible.slice(0,2800),fullText:visible.slice(0,16000)});
 }
 return rows;
}
