// Fixed, public university call tables. No private APIs, applicant records or PDF inference.
import {plainJobText} from './job-opportunities.mjs';
export const ITALY_SOURCE_DEFINITIONS=Object.freeze([
 {id:'pisa-public-research-scholarships',name:'University of Pisa public research scholarships',country:'IT',state:'Toscana',trust:'official',profileScope:'amir',executable:true,configurationStatus:'executable',verifiedAt:'2026-11-04',adapter:'italy_pisa_calls',portalUrl:'https://www.unipi.it/ateneo/concorsi/borse-e-assegni-di-ricerca/',evidenceUrl:'https://www.unipi.it/ateneo/concorsi/borse-e-assegni-di-ricerca/',feedUrl:'https://bandi.unipi.it/public/Bandi?type=BRS',allowedHosts:['bandi.unipi.it'],organizationName:'University of Pisa',organizationDomain:'unipi.it',opportunityType:'scholarship',coverageLimit:'public_research_scholarship_table_only',reason:'Official university index explicitly links the public BRS table. Health/life-science wording filter; advertised local deadline is retained as text, not converted to an assumed exact timezone.'},
 {id:'pisa-public-research-appointments',name:'University of Pisa public research appointments',country:'IT',state:'Toscana',trust:'official',profileScope:'amir',executable:true,configurationStatus:'executable',verifiedAt:'2026-11-04',adapter:'italy_pisa_calls',portalUrl:'https://www.unipi.it/ateneo/concorsi/borse-e-assegni-di-ricerca/',evidenceUrl:'https://www.unipi.it/ateneo/concorsi/borse-e-assegni-di-ricerca/',feedUrl:'https://bandi.unipi.it/public/Bandi?type=IRIC',allowedHosts:['bandi.unipi.it'],organizationName:'University of Pisa',organizationDomain:'unipi.it',opportunityType:'university',coverageLimit:'public_research_appointment_table_only',reason:'Official university index explicitly links the public IRIC table. Clinical/life-science and biomedical engineering signals are discovery evidence, not personal eligibility or a funded clinical post.'},
 {id:'catania-public-research-scholarships',name:'University of Catania public research scholarships',country:'IT',state:'Sicilia',trust:'official',profileScope:'amir',executable:true,configurationStatus:'executable',verifiedAt:'2026-11-04',adapter:'italy_catania_calls',portalUrl:'https://www.unict.it/it/ricerca/borse-di-ricerca',evidenceUrl:'https://www.unict.it/it/bandi/ricerca/borse-di-ricerca',feedUrl:'https://www.unict.it/it/bandi/ricerca/borse-di-ricerca',allowedHosts:['www.unict.it'],organizationName:'University of Catania',organizationDomain:'unict.it',opportunityType:'scholarship',coverageLimit:'current_public_research_scholarship_table_only',reason:'Public current-call table and linked official details; ten source rows currently contain zero retained medical/life-science calls. Zero is not padded with unrelated engineering/agriculture. Robots ten-second delay is exceeded by the scheduled multi-hour cadence.'}
].map(Object.freeze));
const SOURCES=new Map(ITALY_SOURCE_DEFINITIONS.map(source=>[source.id,source]));
const HEALTH=/medicin|biolog|farmac|biomed|neuron|neurali|cellular|cardiovas|oncolog|ginecol|\bHPV\b|movimento umano|TOLIFE|salute|clinica|allerg|immunolog|bioingegner/i;
const EXCLUDED=/vigneto|vegetal|oceanica|lepidocron|fitostatic|agricoltura|agrarie|animali e piante|public engagement/i;
const plain=(v,n=20000)=>plainJobText(v,n);
function fail(code){const error=new Error(code);error.code=code;throw error;}
function detailUrl(raw,source){let u;try{u=new URL(raw,source.feedUrl);}catch{fail('invalid_italy_call_url');}if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!source.allowedHosts.includes(u.hostname))fail('invalid_italy_call_url');
 if(source.adapter==='italy_pisa_calls'){if(!/^\/public\/Bandi\/Detail\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(u.pathname)||u.search)fail('invalid_italy_call_url');}
 else if(u.pathname!=='/it/bandi/ricerca/borsa-di-ricerca'||!/^\?k=\d{1,12}$/.test(u.search))fail('invalid_italy_call_url');
 return u;
}
export async function normalizeItalySourceRecords(input,body){
 const source=SOURCES.get(input?.id);if(!source||input.adapter!==source.adapter)fail('italy_source_not_registered');
 if(typeof body!=='string'||new TextEncoder().encode(body).length>3000000)fail('italy_source_body_too_large');
 if(!/<html\b/i.test(body)||!/<\/html\s*>/i.test(body)||!/<table\b/i.test(body)||!/Scadenza/i.test(body))fail('invalid_italy_source_html');
 const tables=[...body.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m=>m[1]);
 const table=tables.find(t=>source.adapter==='italy_pisa_calls'?/Scadenza/i.test(t)&&/Selezione/i.test(t):/Scadenza/i.test(t)&&/Oggetto/i.test(t));
 if(!table)fail('invalid_italy_source_table');
 const rows=[...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];if(rows.length>500)fail('italy_source_row_limit');
 const result=[];
 for(const [,row]of rows){const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);if(!cells.length)continue;
  const match=row.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);if(!match)fail('invalid_italy_call_identity');
  const u=detailUrl(match[1].replaceAll('&amp;','&'),source),title=plain(match[2],500),content=plain(cells.join('\n'));
  if(!title)fail('invalid_italy_call_identity');if(!HEALTH.test(content)||EXCLUDED.test(content))continue;
  const id=source.adapter==='italy_pisa_calls'?u.pathname.split('/').pop():u.searchParams.get('k');
  result.push({externalId:id,title,url:u.href,organization:source.organizationName,organizationDomain:source.organizationDomain,country:'IT',state:source.state,opportunityType:source.opportunityType,kind:'vacancy',publishedAt:null,closingAt:null,summary:content.slice(0,2500),fullText:content+'\nPublisher table dates and times are local display values. Exact deadline/time zone, qualification, funding and availability require the original call and attachments to be reviewed.'});
 }
 return result;
}
