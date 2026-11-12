// Public scholarship pages are evidence/catalog entries, never clinical jobs.
import definitions from './au-funding-sources.json' with {type:'json'};
import {plainJobText} from './job-opportunities.mjs';
export const AU_FUNDING_SOURCE_DEFINITIONS=Object.freeze(definitions.map(s=>Object.freeze(s)));
export class FundingSourceError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new FundingSourceError(code);};
const clean=html=>plainJobText((html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i)?.[1]||html).replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' '),90000);
const snippets=(text,pattern,max=5)=>{const found=[];for(const match of text.matchAll(new RegExp(pattern,'gi'))){const start=Math.max(0,match.index-100),end=Math.min(text.length,match.index+300);const quote=text.slice(start,end).trim();if(!found.some(x=>x.includes(match[0])&&x===quote))found.push(quote);if(found.length>=max)break;}return found;};
function actualDeadline(text){
 const months='January February March April May June July August September October November December'.split(' ');
 // Only use a year-bearing date adjacent to a deadline, never a generic annual date.
 const match=text.match(/(?:closing date|applications? close|expressions? of interest close)[\s:–-]*(?:(\d{1,2})\/(\d{1,2})\/(20\d{2})|(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2}))/i);
 if(!match)return null;
 const day=Number(match[1]||match[4]),month=match[2]?Number(match[2]):months.findIndex(m=>m.toLowerCase()===match[5].toLowerCase())+1,year=Number(match[3]||match[6]);
 const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 if(month<1||month>12||day<1||day>31||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return null;
 return {date,label:match[0],timezone:'institution_local_date',time:null};
}
export function normalizeFundingSourcePage(input,html,now=Date.now()){
 const source=definitions.find(s=>s.id===input?.id);if(!source)fail('funding_source_not_registered');
 if(typeof html!=='string'||new TextEncoder().encode(html).length>3000000)fail('source_response_too_large');
 const text=clean(html);
 if(text.length<300||!text.toLowerCase().includes(source.identityAnchor.toLowerCase())||!/(scholarship|stipend)/i.test(text)||/(?:verify you are human|just a moment\.\.\.|access denied|enable javascript and cookies)/i.test(text.slice(0,1200)))fail('funding_page_not_readable');
 const checkedAt=new Date(now).toISOString(),deadline=actualDeadline(text);
 const explicitlyClosed=/\b(?:this (?:scholarship|project|round) is closed|applications (?:have )?(?:now )?closed|status\s*:?\s*closed)\b/i.test(text);
 const explicitlyOpen=/\bstatus\s*:?\s*open\b/i.test(text);
 const past=deadline&&deadline.date<checkedAt.slice(0,10);
 // A program page stays a program even when it mentions an application round.
 const status=explicitlyClosed||past?'closed':source.catalogKind==='specific_call'?(explicitlyOpen&&deadline?'open':'unknown'):'program';
 const fundingEvidence=snippets(text,'\\$\\s*[0-9][0-9,]*(?:\\.[0-9]+)?|tuition|fee offset|fees offset|fee remission|full fee|OSHC');
 const eligibilityEvidence=snippets(text,'international|citizen|permanent resident|honours|research capability|research potential|supervisor');
 if(!fundingEvidence.length||!eligibilityEvidence.length)fail('funding_page_incomplete');
 const deadlineEvidence=snippets(text,'closing date|applications? close|expressions? of interest close|application deadline|research periods? [1-4]|round [1-4]');
 const annualRate=[...text.matchAll(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)([^$]{0,100})/g)].find(m=>/(?:per annum|per year|p\.?a\.?|annual)/i.test(m[2])&&/2027/.test(m[2]));
 const funding={annualStipendAUD:annualRate?Number(annualRate[1].replaceAll(',','')):null,tuitionCovered:null,healthInsuranceCovered:null,notes:'Any displayed stipend is a published 2027 rate, not an award or individual eligibility decision. Fee and health-insurance coverage must be checked against the award conditions.'};
 const hasStipend=/\b(?:living allowance|stipend)\b/i.test(text);
 // Package evidence is scheme-level only. Monash's stipend page explicitly
 // requires a separate international tuition award; domestic fee offsets do not count.
 const feePackage=(source.id.endsWith('sydney-rtp')&&/Those awarded with a RTP Stipend Scholarship will automatically be awarded this scholarship 100% tuition fees/i.test(text))||(source.id.endsWith('melbourne-grs')&&/Stipend and fee offset scholarships Full fee offset/i.test(text))||(source.id.endsWith('latrobe-baker')&&/Full Fee Research scholarship/i.test(text))||(source.id.endsWith('unisq-international')&&/Tuition fees.{0,180}paid by UniSQ/i.test(text));
 funding.tuitionCovered=feePackage?true:null;
 funding.healthInsuranceCovered=feePackage&&/Overseas Student Health Cover/i.test(text)?true:null;
 const coverageClass=feePackage&&hasStipend?'fees_and_stipend':hasStipend?'partial':'unknown';
 const applicationRounds=[];
 for(const match of text.matchAll(/(Research Period [1-4] and [1-4], 20\d{2})\s+(\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) 20\d{2})/gi)){const parsed=actualDeadline('Closing date '+match[2]);if(parsed)applicationRounds.push({title:match[1],deadline:parsed,status:parsed.date<checkedAt.slice(0,10)?'closed':'upcoming_deadline',evidence:match[0]});}
 const projects=[];
 for(const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  let u;try{u=new URL(match[1].replace(/&amp;/g,'&'),source.url);}catch{continue;}
  const title=plainJobText(match[2],220);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!(/(?:^|\.)(?:monash.edu|sydney.edu.au|unimelb.edu.au|unisq.edu.au|latrobe.edu.au|baker.edu.au)$/.test(u.hostname))||!/(project|thesis|supervisor|research opportunit)/i.test(title+' '+u.pathname)||/login|sign-in|apply-now/i.test(u.pathname))continue;
  u.hash='';if(title&&!projects.some(p=>p.url===u.href))projects.push({title,url:u.href,reading:{status:'not_read'},status:'discovery_link'});if(projects.length===12)break;
 }
 const result={id:source.id,title:source.title,institution:source.institution,url:source.url,country:'AU',state:source.state,profileScope:'amir',degreeTypes:source.degreeTypes,summary:source.summary,requirements:source.requirements,requirementsReviewedAt:source.reviewedAt,requirementsEvidence:snippets(text,'eligible|eligibility|honours|supervisor|admission requirements|research capability'),sourceType:'official',catalogKind:source.catalogKind,status,checkedAt,deadline:deadline||{date:null,label:'Check the course, faculty and applicable scholarship round.',timezone:null},funding,fundingCoverage:{classification:coverageClass,status:'requires_award_confirmation',evidence:fundingEvidence},internationalEligibility:{status:eligibilityEvidence.some(q=>/international/i.test(q))?'international_mentioned_not_individual_assessment':'not_confirmed',evidence:eligibilityEvidence},deadlineEvidence,applicationRounds,reading:{status:'read',readAt:checkedAt},sourceProvenance:{url:source.url,readAt:checkedAt,method:'bounded_official_html',textLength:text.length},projectLinks:projects,clinicalRegistration:'Not conferred by research admission or a scholarship.'};
 return {snapshot:result,contentText:text};
}
export async function fundingSourceRow(source,html,now=Date.now()){
 const {snapshot,contentText}=normalizeFundingSourcePage(source,html,now);
 const contentHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(contentText)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 snapshot.sourceProvenance.contentHash=contentHash;
 return {source_id:snapshot.id,url:snapshot.url,status:snapshot.status,read_at:snapshot.reading.readAt,data:JSON.stringify(snapshot),content_text:contentText,content_hash:contentHash};
}
export async function storeFundingSourcePage(db,source,html,now=Date.now()){
 const row=await fundingSourceRow(source,html,now);
 await db.prepare('INSERT INTO au_funding_pages(source_id,url,status,read_at,data,content_text,content_hash) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET url=excluded.url,status=excluded.status,read_at=excluded.read_at,data=excluded.data,content_text=excluded.content_text,content_hash=excluded.content_hash').bind(row.source_id,row.url,row.status,row.read_at,row.data,row.content_text,row.content_hash).run();
 return JSON.parse(row.data);
}
