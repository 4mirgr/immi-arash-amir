// Public, fixed publisher feeds only. No user-supplied endpoints or private integrations.
import registry from './source-registry.json' with {type:'json'};
import {ITALY_SOURCE_DEFINITIONS,normalizeItalySourceRecords} from './italy-source-adapters.mjs';
import {AU_SOURCE_DEFINITIONS,normalizeAuSourceRecords} from './au-source-adapters.mjs';
import {GP_EXPANDED_SOURCE_DEFINITIONS,normalizeExpandedGpSourceRecords} from './gp-expanded-sources.mjs';
import {GP_REVIEWED_SOURCE_DEFINITIONS,normalizeReviewedGpSourceRecords,ReviewedGpSourceError} from './gp-reviewed-source-adapter.mjs';
import {robotsAllows} from './public-page-worker.mjs';
import {RURAL_SOURCE_DEFINITIONS,normalizeRuralSourceRecords} from './rural-source-adapters.mjs';
import {sourceAutomationStatus} from './source-automation.mjs';
import {plainJobText,pageUpDate} from './job-opportunities.mjs';
import {upsertOpportunityBatch} from './opportunity-store.mjs';
import {enqueuePublicPages} from './public-page-store.mjs';
export const SOURCE_REGISTRY=Object.freeze([...registry,...RURAL_SOURCE_DEFINITIONS,...ITALY_SOURCE_DEFINITIONS,...AU_SOURCE_DEFINITIONS,...GP_EXPANDED_SOURCE_DEFINITIONS,...GP_REVIEWED_SOURCE_DEFINITIONS].map(source=>Object.freeze({...source,allowedHosts:Object.freeze([...source.allowedHosts])})));
const ACTIVE=SOURCE_REGISTRY.filter(s=>s.executable);
const MAX_BYTES=3000000, MAX_CALLS=3, MAX_RECORDS=100, PER_SOURCE=40;
const SUCCESS_COOLDOWN=3*60*60*1000, FAILURE_COOLDOWN=6*60*60*1000;
class SourceError extends Error {constructor(code,status=502){super(code);this.code=code;this.status=status;}}
const fail=code=>{throw new SourceError(code);};
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const run=(db,sql,...args)=>stmt(db,sql,...args).run();
const first=(db,sql,...args)=>stmt(db,sql,...args).first();
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results||[];
const iso=v=>v==null?null:new Date(v).toISOString();
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function database(env){if(!env.OPPORTUNITY_DB)throw new SourceError('opportunity_storage_not_configured',503);return env.OPPORTUNITY_DB;}
export function validateSourceUrl(value,source){
 let u;try{u=new URL(value);}catch{fail('invalid_source_url');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||!source.allowedHosts.includes(u.hostname)||u.hash)fail('unregistered_source_url');
 return u.href;
}
function canonicalSource(input){const source=SOURCE_REGISTRY.find(s=>s.id===input?.id);if(!source?.executable)fail('source_not_executable');return source;}
function opportunityType(title,fallback='university'){
 if(/scholarship|bors[ae]\s+di\s+studio/i.test(title))return 'scholarship';
 if(/\bgrant\b|\bpremi[oi]\b/i.test(title))return 'grant';
 if(/\bfunding\b|\bcontribut[oi]\b/i.test(title))return 'funding';
 return fallback;
}
const HEALTH=/medic|biolog|psicolog|psycholog|pharm|farmac|biomed|clinical|health|neuro|epidem|toxicol|oncolog|cardio|rheumat|microbi|immunolog|inflammat|biomarker|biopolymer|liver|fibrosis|drug|antigen/i;
function pageup(source,body){
 let data;try{data=JSON.parse(body);}catch{fail('invalid_source_json');}
 if(!Array.isArray(data)||data.length>500||data.some(r=>!r||typeof r!=='object'||Array.isArray(r)))fail('invalid_source_schema');
 const records=[];
 for(const row of data){
  if(typeof row.Id!=='string'||!/^\d{1,20}$/.test(row.Id)||typeof row.Title!=='string')fail('invalid_source_identity');
  const title=plainJobText(row.Title,500);if(!title)fail('invalid_source_identity');
  let relevant;
  if(source.adapter==='pageup_medical'){
   const categories=Array.isArray(row.CategoryList)?row.CategoryList:String(row.Categories||'').split(',');
   relevant=categories.some(c=>/(?:^|\|)medical$/i.test(String(c).trim()))&&/\b(general practitioner|medical officers?|medical practitioner|registrars?|consultant|junior doctors?|staff specialist|visiting medical specialist|physician|psychiatrist|surgeon|surgical fellow)\b/i.test(title)&&!/\b(veterinar|nurs(?:e|ing)|midwif|radiograph|physiotherap|sonograph|therapist|human resources|medical officer unit|team leader|roster support)\b/i.test(title);
  }else relevant=HEALTH.test(title+' '+plainJobText(row.Brand))&&/research|lecturer|professor|PhD|scholarship|academic/i.test(title)&&!/\b(nurs(?:e|ing)|midwifery|physiotherap|technical|engagement officer|program manager|project officer|executive assistant|administrative)\b/i.test(title);
  if(!relevant)continue;
  const publishedAt=pageUpDate(row.OpeningDateUtc),closingAt=pageUpDate(row.ClosingDateUtc);
  if((row.OpeningDateUtc&&!publishedAt)||(row.ClosingDateUtc&&!closingAt))fail('invalid_source_date');
  records.push({externalId:row.Id,title,url:`https://careers.pageuppeople.com/${source.tenant}/${source.channel||'cw'}/en/job/${row.Id}`,organization:source.adapter==='pageup_medical'?plainJobText(row.Brand,300)||source.organizationName:source.organizationName,organizationDomain:source.organizationDomain||(source.adapter==='pageup_medical'?'tas.gov.au':'monash.edu'),publishedAt,closingAt,summary:plainJobText(row.Summary,2500),fullText:plainJobText(row.Overview,16000),location:plainJobText(row.Locations,500),city:plainJobText(row.SiteSuburb,200),opportunityType:source.adapter==='pageup_medical'?'job':opportunityType(title),kind:/employment register|expression(?:s)? of interest|talent (?:pool|register)|\(pool\)/i.test(title)?'employment_register':'vacancy'});
 }
 return records;
}
function smartrecruiters(source,body){
 let data;try{data=JSON.parse(body);}catch{fail('invalid_source_json');}
 if(!data||Array.isArray(data)||!Array.isArray(data.content)||data.content.length>100||!Number.isSafeInteger(data.totalFound)||data.totalFound<0||data.offset!==0)fail('invalid_source_schema');
 if(data.totalFound!==data.content.length)fail('source_pagination_required');
 const records=[];
 for(const row of data.content){
  if(!row||typeof row!=='object'||typeof row.id!=='string'||!/^\d{1,20}$/.test(row.id)||typeof row.name!=='string'||row.company?.identifier!=='GriffithUniversity')fail('invalid_source_identity');
  const title=plainJobText(row.name,500);if(!title)fail('invalid_source_identity');
  if(row.visibility!=='PUBLIC'||String(row.location?.country).toLowerCase()!=='au')continue;
  if(!HEALTH.test(title)||!/research|lecturer|professor|PhD|scholarship/i.test(title)||/\b(nurs(?:e|ing)|midwifery|physiotherap|technical|executive officer|program manager|project officer|executive assistant|administrative)\b/i.test(title))continue;
  const published=typeof row.releasedDate==='string'?Date.parse(row.releasedDate):NaN;if(row.releasedDate&&!Number.isFinite(published))fail('invalid_source_date');
  const state=String(row.location?.region||'').toUpperCase();
  records.push({externalId:row.id,title,url:'https://jobs.smartrecruiters.com/GriffithUniversity/'+row.id,organization:source.organizationName,organizationDomain:source.organizationDomain,state:['ACT','NSW','NT','QLD','SA','TAS','VIC','WA'].includes(state)?state:'UNKNOWN',publishedAt:Number.isFinite(published)?new Date(published).toISOString():null,closingAt:null,summary:plainJobText([row.department?.label,row.typeOfEmployment?.label].filter(Boolean).join(' · '),1000),location:plainJobText(row.location?.fullLocation,500),city:plainJobText(row.location?.city,200),opportunityType:opportunityType(title)});
 }
 return records;
}
function ntPublicSearch(source,body){
 let data;try{data=JSON.parse(body);}catch{fail('invalid_source_json');}
 if(!data||data.success!==true||!Array.isArray(data.data)||data.data.length>500)fail('invalid_source_schema');
 const result=[];
 for(const row of data.data){
  if(!row||!Number.isSafeInteger(row.rtfId)||row.rtfId<=0||typeof row.jobTitle!=='string')fail('invalid_source_identity');
  if(row.agency!=='Department of Health'||row.isCanceled===true||/cancelled|canceled/i.test(String(row.closingDate||'')))continue;
  const title=plainJobText(row.jobTitle,500);
  if(!/medical officer|registrar|consultant|general practitioner|staff specialist|medicine specialist|care specialist|geriatrician|paediatric.*ologist|advanced trainee|clinical director|head of department/i.test(title)||/nurs(?:e|ing)|midwif|technolog|coordinator|poisons officer|dental|dentist/i.test(title))continue;
  const publishedAt=pageUpDate(row.dateAdded),sourceClosing=pageUpDate(row.closingDateAsDateTime);if((row.dateAdded&&!publishedAt)||(row.closingDateAsDateTime&&!sourceClosing))fail('invalid_source_date');
  // NT publishes a display date plus a midnight date-value, not a verified exact cutoff.
  const closingAt=null,advertisedClose=plainJobText(row.closingDate,100);
  result.push({externalId:String(row.rtfId),title,url:'https://jobs.nt.gov.au/Home/JobDetails?rtfId='+row.rtfId,organization:source.organizationName,organizationDomain:source.organizationDomain,state:source.state,publishedAt,closingAt,summary:plainJobText(row.primaryObjective,2500),fullText:plainJobText([row.primaryObjective,row.specialInstructions,row.contactPerson,advertisedClose?'Advertised closing date: '+advertisedClose+' (publisher display; exact cutoff/time zone not verified).':''].filter(Boolean).join('\n'),16000),location:plainJobText(row.locations,500),opportunityType:'job',kind:!row.closingDateAsDateTime&&row.RecruitmentProgramId>1?'employment_register':'vacancy'});
 }
 return result;
}
async function careerpages(source,body){
 if(!/<html\b/i.test(body)||!/<\/html\s*>/i.test(body)||!/job-search-results-card-col/.test(body))fail('invalid_source_html');
 const cards=[...body.matchAll(/<article\b[^>]*class=["'][^"']*\bjob-search-results-card-col\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)];if(!cards.length||cards.length>100)fail('invalid_source_html');
 const result=[];
 for(const [,card] of cards){
  const anchor=card.match(/<a\b(?=[^>]*\bid=["']link_job_title_)[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);if(!anchor)fail('invalid_source_identity');
  const url=anchor[1].replaceAll('&amp;','&');validateSourceUrl(url,source);const parsed=new URL(url);if(!/^\/jobs\/[a-z0-9-]+$/.test(parsed.pathname)||parsed.pathname==='/jobs/search'||parsed.search)fail('invalid_source_identity');
  const title=plainJobText(anchor[2],500),category=plainJobText(card.match(/<span\b[^>]*id=["']category_icon_text_[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1],500);
  if(!title)fail('invalid_source_identity');
  if(!HEALTH.test(title+' '+category)||!/research|lecturer|professor|academic|PhD|scholarship/i.test(title)||/nurs(?:e|ing)|midwif|optometr|physiotherap|coordinator|administrative|assistant director|science communication/i.test(title))continue;
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  result.push({externalId:'html_'+hash,title,url,organization:source.organizationName,organizationDomain:source.organizationDomain,state:source.state,publishedAt:null,closingAt:null,summary:plainJobText(card.match(/<p\b[^>]*class=["'][^"']*job-search-results-summary[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1],2500),location:plainJobText(card.match(/<span\b[^>]*id=["']location_icon_text_[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1],500),opportunityType:opportunityType(title)});
 }
 return result;
}
function xmlField(item,name){const match=item.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'\\s*>','i'));return match?plainJobText(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'),30000):'';}
async function rss(source,body){
 if(/<!DOCTYPE|<!ENTITY/i.test(body)||!/<rss\b/i.test(body)||!/<channel\b/i.test(body)||!/<\/rss\s*>/i.test(body))fail('invalid_source_rss');
 const entries=[...body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)];if(entries.length>500)fail('source_item_limit');
 const result=[];
 for(const entry of entries){
  const title=xmlField(entry[1],'title'),url=xmlField(entry[1],'link'),published=xmlField(entry[1],'pubDate');
  if(!title||!url)fail('invalid_source_identity');validateSourceUrl(url,source);
  const n=published?Date.parse(published):NaN;if(published&&!Number.isFinite(n))fail('invalid_source_date');
  const relevant=source.id==='unibo-research-contracts'?HEALTH.test(title):HEALTH.test(title)||/borse?\s+di\s+studio|borsa\s+di\s+studio|contribut[oi]|grant|scholarship|premi[oi]/i.test(title);
  if(!relevant)continue;
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  result.push({externalId:'rss_'+hash,title,url,publishedAt:published?new Date(n).toISOString():null,closingAt:null,organization:source.organizationName,organizationDomain:'unibo.it',summary:xmlField(entry[1],'description'),opportunityType:opportunityType(title)});
 }
 return result;
}
export async function normalizeSourceRecords(input,body){
 const source=canonicalSource(input);if(typeof body!=='string'||new TextEncoder().encode(body).length>MAX_BYTES)fail('source_response_too_large');
 const records=source.adapter==='gp_reviewed_html'?normalizeReviewedGpSourceRecords(source,body):source.adapter.startsWith('gp_')?await normalizeExpandedGpSourceRecords(source,body):source.adapter.startsWith('italy_')?await normalizeItalySourceRecords(source,body):source.adapter.startsWith('au_')?await normalizeAuSourceRecords(source,body):source.adapter.startsWith('rural_')?await normalizeRuralSourceRecords(source,body):source.adapter==='bologna_rss'?await rss(source,body):source.adapter==='nt_public_search'?ntPublicSearch(source,body):source.adapter==='careerpages_public_html'?await careerpages(source,body):source.adapter==='smartrecruiters_university'?smartrecruiters(source,body):pageup(source,body);
 for(const row of records)validateSourceUrl(row.url,source);
 return records;
}
async function boundedText(response,limit=MAX_BYTES){
 if(Number(response.headers.get('content-length')||0)>limit)fail('source_response_too_large');
 const reader=response.body?.getReader();if(!reader)fail('invalid_source_response');let bytes=0,text='';const decoder=new TextDecoder();
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>limit){await reader.cancel();fail('source_response_too_large');}text+=decoder.decode(part.value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}
}
async function reviewedRobots(source,fetcher){
 const url=new URL(source.feedUrl);let response;try{response=await fetcher(url.origin+'/robots.txt',{headers:{'User-Agent':'MasirUniversityDiscovery/1.0',Accept:'text/plain'},redirect:'manual',signal:AbortSignal.timeout(8000)});}catch{fail('source_robots_unavailable');}
 if(response.redirected||response.url&&response.url!==url.origin+'/robots.txt'){await response.body?.cancel();fail('source_robots_redirect_rejected');}
 if(response.status===404){await response.body?.cancel();return;}
 if(response.status!==200){await response.body?.cancel();fail([401,403].includes(response.status)?'source_robots_blocked':'source_robots_unavailable');}
 const text=await boundedText(response,64000);if(/<html/i.test(text.slice(0,500)))fail('source_robots_unavailable');
 const permission=robotsAllows(text,source.feedUrl);if(!permission.allowed)fail('source_robots_blocked');
 // Honor the same bounded asynchronous publisher delay as the public reader.
 // Each source lease is 90s; long delays remain outside this collector budget.
 if(permission.delay>30)fail('source_robots_delay_exceeds_budget');
 if(permission.delay>0)await new Promise(resolve=>setTimeout(resolve,permission.delay*1000));
}
async function collectOne(db,source,fetcher,remaining,now,readPages=false){
 const lock=crypto.randomUUID();
 await run(db,'INSERT OR IGNORE INTO registered_source_checks(source_id) VALUES(?)',source.id);
 const claim=await first(db,'UPDATE registered_source_checks SET lock_token=?,lock_until=?,last_attempt_at=? WHERE source_id=? AND lock_until<? AND next_check_at<=? RETURNING etag,record_cursor',lock,now+90000,now,source.id,now,now);
 if(!claim)return {sourceId:source.id,status:'cooldown_or_busy',imported:0};
 try{
  validateSourceUrl(source.feedUrl,source);
  if(source.requiresRobots)await reviewedRobots(source,fetcher);
  const headers={Accept:['bologna_rss','rural_ntphn_rss'].includes(source.adapter)?'application/rss+xml, application/xml':(['careerpages_public_html','rural_people_html'].includes(source.adapter)||source.adapter.startsWith('italy_')||source.adapter.startsWith('au_')||source.adapter.startsWith('gp_'))?'text/html':'application/json','User-Agent':source.requiresRobots?'MasirUniversityDiscovery/1.0':'MasirPublicSourceCollector/1.0'};
  // Partial snapshots must fetch their next segment even when publisher ETag is unchanged.
  if(source.requestMethod!=='POST'&&!claim.record_cursor&&claim.etag&&claim.etag.length<1000&&!/[\r\n]/.test(claim.etag))headers['If-None-Match']=claim.etag;
  let response;try{response=await fetcher(source.feedUrl,{headers:{...headers,...(source.requestMethod==='POST'?{'Content-Type':'application/json'}:{})},...(source.requestMethod==='POST'?{method:'POST',body:JSON.stringify(source.requestBody)}:{}),redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{fail('source_unavailable');}
  if(response.redirected||(response.status>=300&&response.status<400&&response.status!==304))fail('source_redirect_rejected');
  if(response.url&&response.url!==source.feedUrl)fail('source_redirect_rejected');
  if(response.status===304){await run(db,"UPDATE registered_source_checks SET status='not_modified',last_success_at=?,next_check_at=?,last_error_code=NULL,imported_records=0 WHERE source_id=? AND lock_token=?",now,now+SUCCESS_COOLDOWN,source.id,lock);return {sourceId:source.id,status:'not_modified',imported:0};}
  if(!response.ok)fail(response.status===429?'source_rate_limited':response.status===403?'source_access_denied':'source_http_error');
  const records=await normalizeSourceRecords(source,await boundedText(response));
  const start=claim.record_cursor<records.length?claim.record_cursor:0;
  const selected=records.slice(start,start+Math.min(PER_SOURCE,remaining));
  const partial=start+selected.length<records.length, nextCursor=partial?start+selected.length:0;
  const imported=await upsertOpportunityBatch(db,source,selected,now);
  if(readPages&&selected.length){
   const queue=await Promise.all(selected.map(async record=>{const bytes=new TextEncoder().encode(record.url),id='page_'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);const versionText=JSON.stringify([record.title,record.publishedAt||null,record.closingAt||null,record.opportunityType||source.opportunityType,record.kind||null,record.summary||'',record.fullText||record.description||'']);const discoveryVersion=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(versionText)))].map(v=>v.toString(16).padStart(2,'0')).join('');return {id,url:record.url,country:source.country,institutionIds:[],officialBases:[new URL(record.url).hostname.replace(/^www\./,'')],labels:[record.title],discoveredFrom:[source.feedUrl],sourceId:source.id,discoveryVersion};}));
   try{await enqueuePublicPages(db,queue);imported.readingQueue='queued';}catch{imported.readingQueue='queue_retry_required';}
  }
  let etag=response.headers.get('etag');if(!etag||etag.length>=1000||/[\r\n]/.test(etag))etag=null;
  await run(db,"UPDATE registered_source_checks SET status='updated',etag=?,last_success_at=?,next_check_at=?,last_error_code=NULL,imported_records=?,record_cursor=?,partial=? WHERE source_id=? AND lock_token=?",etag,now,now+(partial?15*60*1000:SUCCESS_COOLDOWN),selected.length,nextCursor,Number(partial),source.id,lock);
  return {...imported,sourceId:source.id,status:'updated',imported:selected.length,matchingRecords:records.length,partial,nextCursor};
 }catch(error){const code=error instanceof SourceError||error instanceof ReviewedGpSourceError?error.code:'collector_failed';await run(db,"UPDATE registered_source_checks SET status='failed',last_error_code=?,next_check_at=? WHERE source_id=? AND lock_token=?",code,now+FAILURE_COOLDOWN,source.id,lock);return {sourceId:source.id,status:'failed',error:code,imported:0};}
 finally{await run(db,'UPDATE registered_source_checks SET lock_token=NULL,lock_until=0 WHERE source_id=? AND lock_token=?',source.id,lock);}
}
export async function collectRegisteredSources(env,fetcher=fetch){
 const db=database(env),now=Date.now();
 const position=(await first(db,"SELECT position FROM source_collector_state WHERE id='rotation'"))?.position||0;
 // Claim the rotation atomically: concurrent triggers use disjoint initial positions and source locks.
 const rotation=await first(db,"UPDATE source_collector_state SET position=(position+?)%? WHERE id='rotation' RETURNING position",MAX_CALLS,ACTIVE.length);
 const start=rotation?(rotation.position-MAX_CALLS+ACTIVE.length*2)%ACTIVE.length:position;
 const receipts=[];let remaining=MAX_RECORDS;
 for(let i=0;i<Math.min(MAX_CALLS,ACTIVE.length)&&remaining>0;i++){
  const source=ACTIVE[(start+i)%ACTIVE.length];const receipt=await collectOne(db,source,fetcher,remaining,now,env.PUBLIC_PAGE_READING_ENABLED==='true');receipts.push(receipt);remaining-=receipt.imported||0;
 }
 return {status:receipts.some(r=>r.status==='failed')?'partial_failure':'completed',checkedAt:iso(now),sourceBudget:MAX_CALLS,recordBudget:MAX_RECORDS,imported:MAX_RECORDS-remaining,sources:receipts,coverage:'bounded_registered_public_sources_only'};
}
export async function registeredSourceStatuses(env,profile){
 if(!['arash','amir'].includes(profile))throw new SourceError('workspace_required',403);
 const checks=new Map((await all(database(env),'SELECT * FROM registered_source_checks')).map(row=>[row.source_id,row]));
 return SOURCE_REGISTRY.filter(s=>profile==='amir'||(s.country!=='IT'&&s.profileScope!=='amir')).map(source=>{
  const check=checks.get(source.id);return {...source,status:check?.status||'not_checked',collectorStatus:source.executable?check?.status||'not_checked':source.configurationStatus,lastAttemptAt:iso(check?.last_attempt_at),lastSuccessAt:iso(check?.last_success_at),nextCheckAt:iso(check?.next_check_at||null),lastErrorCode:check?.last_error_code||null,importedRecords:check?.imported_records||0,partial:Boolean(check?.partial)};
 });
}
export async function handleRegisteredSourcesRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url);if(!['/api/opportunities/sources','/api/opportunities/refresh'].includes(url.pathname))return null;
 try{
  if(!context?.userId||!['arash','amir'].includes(context.profileId))throw new SourceError('workspace_required',403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)throw new SourceError('profile_access_denied',403);
  if(request.method==='GET'&&url.pathname.endsWith('/sources'))return json({sources:await registeredSourceStatuses(env,context.profileId),automation:await sourceAutomationStatus(env,Date.now(),ACTIVE.length),coverage:'bounded_registered_public_sources_only'});
  if(request.method==='POST'&&url.pathname.endsWith('/refresh')){
   if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)throw new SourceError('origin_rejected',403);
   const body=await request.text();if(body.length>1000)throw new SourceError('payload_too_large',413);let value;try{value=JSON.parse(body||'{}');}catch{throw new SourceError('invalid_payload',400);}
   if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length)throw new SourceError('refresh_does_not_accept_source_urls',400);
   const receipt=await collectRegisteredSources(env,fetcher);
   // Shared public collector may refresh IT sources; private workspace response must not expose them.
   if(context.profileId==='arash'){
    receipt.sources=receipt.sources.filter(r=>SOURCE_REGISTRY.find(s=>s.id===r.sourceId)?.country!=='IT');
    receipt.imported=receipt.sources.reduce((sum,row)=>sum+(row.imported||0),0);
    receipt.status=receipt.sources.some(row=>row.status==='failed')?'partial_failure':'completed';
   }
   return json(receipt);
  }
  throw new SourceError('method_not_allowed',405);
 }catch(error){return json({error:error instanceof SourceError?error.code:'source_request_failed'},error instanceof SourceError?error.status:500);}
}
