import {gpOpportunitySignals} from './gp-opportunity-signals.mjs';
import {screenOpportunity} from './opportunity-screening.mjs';
// Server-controlled source configurations enter here; public HTTP routes are read-only.
const TYPES = new Set(['job', 'university', 'grant', 'funding', 'scholarship']);
const AU_STATES = new Set(['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'UNKNOWN']);
const TRUST = new Set(['official', 'unofficial']);
const MAX_RECORDS = 500;
export class OpportunityStoreError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function fail(status, code) { throw new OpportunityStoreError(status, code); }
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function text(value, limit=1000) {
  if (typeof value !== 'string') return '';
  return value.slice(0,250000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
}
const normalized = value => text(value).normalize('NFKC').toLowerCase();
function date(value) {
  if(value==null||value==='')return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))return null;
  const calendar=Date.parse(value.slice(0,10)+'T00:00:00Z'),n=Date.parse(value);
  if(!Number.isFinite(calendar)||new Date(calendar).toISOString().slice(0,10)!==value.slice(0,10)||!Number.isFinite(n))return null;
  return new Date(n).toISOString();
}
function clock(value) { const n=value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):value; if (!Number.isFinite(n)) fail(400,'invalid_collection_time'); return {ms:n,iso:new Date(n).toISOString()}; }
async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join(''); }
function host(value) {
  if (typeof value !== 'string' || value.length>253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value)) return null;
  const lower=value.toLowerCase();
  if (!lower.includes('.') || /^(?:\d+\.){3}\d+$/.test(lower) || lower.endsWith('.local') || lower.endsWith('.localhost')) return null;
  return lower;
}
function safeUrl(value, allowedHosts) {
  let url; try { url=new URL(value); } catch { fail(400,'invalid_opportunity_url'); }
  if (url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || !allowedHosts.includes(url.hostname.toLowerCase())) fail(400,'unregistered_opportunity_host');
  url.hash=''; return url.href;
}
function sourceConfig(source) {
  if (!source || typeof source !== 'object' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(source.id||'')) fail(400,'invalid_source_configuration');
  if (!['AU','IT'].includes(source.country) || !TRUST.has(source.trust)) fail(400,'invalid_source_configuration');
  if (!Array.isArray(source.allowedHosts) || !source.allowedHosts.length || source.allowedHosts.length>20 || source.allowedHosts.some(v=>!host(v))) fail(400,'invalid_source_hosts');
  const allowedHosts=[...new Set(source.allowedHosts.map(v=>v.toLowerCase()))];
  if (source.opportunityType && !TYPES.has(source.opportunityType)) fail(400,'invalid_source_type');
  if (source.profileScope && !['both','amir'].includes(source.profileScope)) fail(400,'invalid_source_scope');
  return {...source,allowedHosts,profileScope:source.country==='IT'?'amir':source.profileScope==='amir'?'amir':'both'};
}
function stateCode(raw, country, fallback) {
  const state=text(raw || fallback || 'UNKNOWN',80);
  if (country==='AU') {const upper=state.toUpperCase(); if (!AU_STATES.has(upper)) fail(400,'invalid_australian_state'); return upper;}
  if(state==='UNKNOWN')return state;
  const region=state.startsWith('IT-')?state.slice(3):state;
  if(!/^[A-Za-z0-9_-]{1,30}$/.test(region))fail(400,'invalid_italian_region');
  return 'IT-'+region;
}
function statusAt(item, ms) {
  if (item.status==='source_removed') return 'source_removed';
  if (item.closingAt && Date.parse(item.closingAt)<=ms) return 'closed';
  if (item.publishedAt && Date.parse(item.publishedAt)>ms) return 'future';
  // A source listing with no explicit deadline is not represented as a verified open job.
  return item.closingAt ? 'open' : 'unknown';
}
async function prepare(source, raw, now) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) fail(400,'invalid_opportunity_record');
  const externalId=text(raw.externalId || raw.id,200), title=text(raw.title,500);
  if (!externalId || !title) fail(400,'opportunity_identity_required');
  const country=source.country;
  if (raw.country && raw.country!==country) fail(400,'source_country_mismatch');
  const opportunityType=raw.opportunityType || raw.opportunity_type || source.opportunityType || 'job';
  if (!TYPES.has(opportunityType)) fail(400,'invalid_opportunity_type');
  const state=stateCode(raw.state,country,source.state);
  const url=safeUrl(raw.url,source.allowedHosts);
  const publishedAt=date(raw.publishedAt), closingAt=date(raw.closingAt);
  if ((raw.publishedAt && !publishedAt) || (raw.closingAt && !closingAt)) fail(400,'invalid_opportunity_date');
  const organizationName=text(typeof raw.organization==='object'?raw.organization?.name:raw.organization,300) || text(source.organizationName || source.name,300) || source.id;
  let organizationDomain=host(raw.organizationDomain);
  if (!organizationDomain && raw.organizationWebsite) {
    try {const u=new URL(raw.organizationWebsite);if(u.protocol==='https:'&&!u.username&&!u.password)organizationDomain=host(u.hostname);}catch{}
  }
  // Publisher-domain fallback is labelled inferred and can be enriched later.
  const inferredDomain=!organizationDomain;
  organizationDomain ||= new URL(url).hostname;
  const organizationId='org_'+(await digest(JSON.stringify([normalized(organizationName),organizationDomain,country,state]))).slice(0,24);
  const organization={id:organizationId,name:organizationName,domain:organizationDomain,country,state,domainEvidence:inferredDomain?'publisher_domain_fallback':'source_provided'};
  const kind=raw.kind==='employment_register'?'employment_register':'vacancy';
  // Only material recruitment changes produce an edition; overview corrections do not.
  const editionKey=await digest(JSON.stringify([normalized(title),publishedAt,closingAt,opportunityType,kind]));
  const id='opp_'+(await digest(JSON.stringify([source.id,externalId,editionKey]))).slice(0,32);
  const item={id,sourceId:source.id,externalId,organizationId,organization:organizationName,organizationDomain,editionKey,profileScope:source.profileScope,trust:source.trust,opportunityType,country,state,title,url,publishedAt,closingAt,kind,summary:text(raw.summary,3000),fullText:text(raw.fullText || raw.description,20000),location:text(raw.location,500)||null,city:text(raw.city,200)||null,sourceUrl:source.feedUrl || source.portalUrl || null,sponsorship:null,supervision:null,monash:null,eligibility:'not_assessed',evidenceStatus:source.trust==='official'?'official_source_listing_not_job_offer':'unofficial_listing_requires_verification'};
  item.status=statusAt({...item,status:raw.status==='source_removed'?'source_removed':undefined},now.ms);
  return {item,organization};
}
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results||[];

export async function upsertOpportunityBatch(db, inputSource, rawRecords, at=Date.now()) {
  const source=sourceConfig(inputSource),now=clock(at);
  if (!db || typeof db.prepare!=='function' || typeof db.batch!=='function') fail(503,'opportunity_storage_not_configured');
  if (!Array.isArray(rawRecords) || rawRecords.length>MAX_RECORDS) fail(400,'opportunity_batch_limit');
  // Validate all records before any mutation; malformed sources never partially import.
  const prepared=await Promise.all(rawRecords.map(raw=>prepare(source,raw,now)));
  const unique=new Map(prepared.map(row=>[row.item.id,row]));
  const existing=new Set((await all(db,'SELECT id FROM opportunity_editions WHERE source_id=? AND id IN (SELECT value FROM json_each(?))',source.id,JSON.stringify([...unique.keys()]))).map(row=>row.id));
  // JSON table-valued inserts keep D1 queries bounded independently of record count.
  // Each bound JSON payload stays below 400KB and the entire normalized import is capped.
  const organizations=[...new Map([...unique.values()].map(row=>[row.organization.id,row.organization])).values()];
  const editionRows=[...unique.values()].map(({item})=>item);
  const serialized=JSON.stringify(editionRows);
  if(new TextEncoder().encode(serialized).length>3000000)fail(400,'opportunity_normalized_batch_limit');
  const organizationRows=organizations.map(org=>({...org,normalizedName:normalized(org.name),data:JSON.stringify(org)}));
  const writes=[];
  if(organizationRows.length)writes.push(stmt(db,`INSERT INTO opportunity_organizations(id,normalized_name,domain,country,state,data,created_at,updated_at)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.normalizedName'),json_extract(value,'$.domain'),json_extract(value,'$.country'),json_extract(value,'$.state'),json_extract(value,'$.data'),?,? FROM json_each(?) WHERE 1
    ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`,now.iso,now.iso,JSON.stringify(organizationRows)));
  const chunks=[];let chunk=[],bytes=2;
  for(const item of editionRows){const size=new TextEncoder().encode(JSON.stringify(item)).length+1;if(chunk.length&&bytes+size>400000){chunks.push(chunk);chunk=[];bytes=2;}chunk.push(item);bytes+=size;}if(chunk.length)chunks.push(chunk);
  for(const items of chunks)writes.push(stmt(db,`INSERT INTO opportunity_editions(id,source_id,external_id,organization_id,edition_key,profile_scope,trust,opportunity_type,country,state,title,url,published_at,closing_at,status,data,first_seen_at,last_seen_at)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.sourceId'),json_extract(value,'$.externalId'),json_extract(value,'$.organizationId'),json_extract(value,'$.editionKey'),json_extract(value,'$.profileScope'),json_extract(value,'$.trust'),json_extract(value,'$.opportunityType'),json_extract(value,'$.country'),json_extract(value,'$.state'),json_extract(value,'$.title'),json_extract(value,'$.url'),json_extract(value,'$.publishedAt'),json_extract(value,'$.closingAt'),json_extract(value,'$.status'),value,?,? FROM json_each(?) WHERE 1
    ON CONFLICT(source_id,external_id,edition_key) DO UPDATE SET organization_id=excluded.organization_id,profile_scope=excluded.profile_scope,trust=excluded.trust,country=excluded.country,state=excluded.state,title=excluded.title,url=excluded.url,status=excluded.status,data=excluded.data,last_seen_at=excluded.last_seen_at`,now.iso,now.iso,JSON.stringify(items)));
  if (writes.length) await db.batch(writes);
  return {sourceId:source.id,seen:rawRecords.length,accepted:unique.size,inserted:[...unique.keys()].filter(id=>!existing.has(id)).length,updated:[...unique.keys()].filter(id=>existing.has(id)).length,organizationCount:new Set([...unique.values()].map(row=>row.organization.id)).size};
}

export const TAS_V2_SOURCE=Object.freeze({id:'tas-pageup-759',name:'Tasmanian Government',country:'AU',state:'TAS',trust:'official',allowedHosts:['careers.pageuppeople.com'],feedUrl:'https://careers.pageuppeople.com/759/cw/en/jobs.json',opportunityType:'job'});
export async function ingestLegacyTasmania(db, at=Date.now()) {
  const rows=await all(db,'SELECT data,status FROM job_opportunities WHERE source_id=?','tas-pageup-759');
  return upsertOpportunityBatch(db,TAS_V2_SOURCE,rows.map(row=>{const item=JSON.parse(row.data);return {...item,status:row.status,externalId:item.id.replace(/^job_tas_/,''),country:'AU'};}),at);
}
function match(item,profile) {
  const title=item.title.toLowerCase(),reasons=[];let score=0;
  const desired=profile==='arash'?/\b(general practitioner|medical officer|medical practitioner)\b/:/\b(general medicine|internal medicine|medical registrar|physician|geriatric medicine)\b/;
  if(desired.test(title)){score+=2;reasons.push('title_matches_interest');}
  if(profile==='amir'&&/\bregistrar\b/.test(title)){score++;reasons.push('registrar_employment_grade_not_training_credit');}
  if(item.country==='IT')reasons.push('italian_university_requirements_need_individual_review');
  if(item.kind==='employment_register')reasons.push('register_not_current_specific_vacancy');
  reasons.push('registration_supervision_sponsorship_not_assessed');return {score,reasons,meaning:'known_text_signals_not_acceptance_probability'};
}
function owner(context) {if(typeof context?.userId!=='string'||!context.userId||!['arash','amir'].includes(context.profileId))fail(403,'workspace_required');return context.profileId;}
function filters(url,profile) {
  const country=url.searchParams.get('country')||'all',state=url.searchParams.get('state')||'all',trust=url.searchParams.get('trust')||'all',kind=url.searchParams.get('kind')||'all',q=(url.searchParams.get('q')||'').trim().toLowerCase(),includeClosed=url.searchParams.get('includeClosed')||'false';
  const clinicalFocus=url.searchParams.get('clinicalFocus')||'all',ruralOnly=url.searchParams.get('ruralOnly')||'false',sort=url.searchParams.get('sort')||'deadline';
  if(!['all','gp','medical'].includes(clinicalFocus)||!['true','false'].includes(ruralOnly)||!['deadline','newest'].includes(sort))fail(400,'invalid_opportunity_filter');
  const typesRaw=url.searchParams.get('types')||url.searchParams.get('type')||'all';
  const types=typesRaw==='all'?[]:[...new Set(typesRaw.split(',').filter(Boolean))];
  const organizationId=url.searchParams.get('organizationId')||null,limit=Number(url.searchParams.get('limit')||25),offset=Number(url.searchParams.get('offset')||0);
  if(!['all','AU','IT'].includes(country)||!['all',...AU_STATES].includes(state)&&!/^IT-[A-Za-z0-9_-]{1,30}$/.test(state)||!['all','official','unofficial'].includes(trust)||!['all','vacancy','employment_register'].includes(kind)||types.some(type=>!TYPES.has(type))||q.length>200||!['true','false'].includes(includeClosed)||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000||organizationId&&!/^org_[a-f0-9]{24}$/.test(organizationId))fail(400,'invalid_opportunity_filter');
  if(profile==='arash'&&country==='IT')fail(403,'italy_scope_not_permitted');
  return {country,state,trust,kind,q,includeClosed,types,organizationId,limit,offset,clinicalFocus,ruralOnly,sort};
}
function whereFor(f,profile,now) {
  const clauses=["(country<>'IT' OR ?='amir')","(profile_scope='both' OR ?='amir')"],args=[profile,profile];
  if(f.country!=='all'){clauses.push('country=?');args.push(f.country);}
  if(f.state!=='all'){clauses.push('state=?');args.push(f.state);}
  if(f.trust!=='all'){clauses.push('trust=?');args.push(f.trust);}
  if(f.kind!=='all'){clauses.push("json_extract(data,'$.kind')=?");args.push(f.kind);}
  if(f.organizationId){clauses.push('organization_id=?');args.push(f.organizationId);}
  if(f.types.length){clauses.push('opportunity_type IN ('+f.types.map(()=>'?').join(',')+')');args.push(...f.types);}
  if(f.clinicalFocus!=='all'){
    const gp="(instr(lower(title),'general practitioner')>0 OR instr(lower(title),'general practice')>0 OR instr(lower(title),'rural generalist')>0 OR instr(' '||lower(replace(title,'-',' '))||' ',' gp ')>0)";
    const medical=f.clinicalFocus==='medical'?" OR instr(lower(title),'medical officer')>0 OR instr(lower(title),'medical practitioner')>0":"";
    clauses.push("country='AU' AND opportunity_type='job' AND ("+gp+medical+") AND instr(lower(title),'nurs')=0 AND instr(lower(title),'manager')=0 AND instr(lower(title),'reception')=0");
  }
  if(f.ruralOnly==='true')clauses.push("(instr(lower(title||' '||coalesce(json_extract(data,'$.summary'),'')||' '||coalesce(json_extract(data,'$.fullText'),'')||' '||coalesce(json_extract(data,'$.location'),'')),'rural')>0 OR instr(lower(data),'regional')>0 OR instr(lower(data),'remote')>0)");
  if(f.q){clauses.push("instr(lower(title||' '||data),?)>0");args.push(f.q);}
  if(f.includeClosed!=='true'){clauses.push("status NOT IN ('closed','source_removed') AND (closing_at IS NULL OR closing_at>?) AND (published_at IS NULL OR published_at<=?)");args.push(now,now);}
  return {sql:'WHERE '+clauses.join(' AND '),args};
}
function publicItem(row,profile,ms) {
  const item=JSON.parse(row.data);return {...item,status:statusAt({...item,status:row.status},ms),firstSeenAt:row.first_seen_at,lastSeenAt:row.last_seen_at,match:match(item,profile),screening:screenOpportunity(item,profile),gpSignals:gpOpportunitySignals(item)};
}
export async function enrichReadPages(db,rows,profile,ms,enabled){
 const items=rows.map(row=>publicItem(row,profile,ms));if(!enabled||!items.length)return items;
 const readings=await all(db,"SELECT q.url,q.country,q.status,q.read_at,c.read_at AS content_read_at,c.status AS content_status,c.text,e.analysis,e.read_at AS evidence_read_at FROM public_page_queue q JOIN public_page_content c ON c.page_id=q.id LEFT JOIN public_page_evidence e ON e.page_id=q.id AND e.profile_id=? WHERE q.url IN (SELECT value FROM json_each(?)) AND q.status IN ('read','read_partial') AND (q.profile_scope='both' OR ?='amir')",profile,JSON.stringify(items.map(item=>item.url)),profile);
 if(!readings.length)return items;
 // A current URL can be reused by a later publication. Do not rewrite an older edition
 // with content fetched after its successor was first seen, including equal-time imports.
 const boundaries=await all(db,"SELECT current.id,(SELECT min(next.first_seen_at) FROM opportunity_editions next WHERE next.source_id=current.source_id AND next.external_id=current.external_id AND (next.first_seen_at>current.first_seen_at OR (next.first_seen_at=current.first_seen_at AND next.rowid>current.rowid))) AS next_first_seen FROM opportunity_editions current WHERE current.id IN (SELECT value FROM json_each(?))",JSON.stringify(items.map(item=>item.id)));
 const nextById=new Map(boundaries.map(row=>[row.id,row.next_first_seen]));
 return items.map(item=>{
  const read=readings.find(r=>r.url===item.url&&r.country===item.country);if(!read)return item;
  const readTime=Date.parse(read.read_at),firstSeen=Date.parse(item.firstSeenAt),nextSeen=Date.parse(nextById.get(item.id));
  if(!Number.isFinite(readTime)||!Number.isFinite(firstSeen)||readTime>ms+60000)return {...item,reading:{status:'invalid_reading_timestamp',readAt:null}};
  if(read.read_at!==read.content_read_at||read.status!==read.content_status||typeof read.text!=='string')return {...item,reading:{status:'content_receipt_mismatch',readAt:read.read_at}};
  if(readTime<firstSeen)return {...item,reading:{status:'before_current_edition',readAt:read.read_at}};
  if(Number.isFinite(nextSeen)&&readTime>=nextSeen)return {...item,reading:{status:'after_current_edition',readAt:read.read_at,editionChangedAt:nextById.get(item.id)}};
  let analysis=null;if(read.analysis&&read.evidence_read_at===read.read_at){try{analysis=JSON.parse(read.analysis);}catch{/* Content remains usable; stale/broken evidence never breaks the opportunity list. */}}
  const body={...item,fullText:read.text.slice(0,20000)};
  return {...body,screening:screenOpportunity(body,profile),gpSignals:gpOpportunitySignals(body),reading:{status:read.status,readAt:read.read_at,partialReading:read.status==='read_partial',textTruncatedForDisplay:read.text.length>20000,summary:typeof analysis?.summary==='string'?analysis.summary.slice(0,1800):'',category:['call','admission','funding','career','development','guidance','navigation','unrelated'].includes(analysis?.category)?analysis.category:null,eligibility:'not_assessed'}};
 });
}
export async function handleOpportunityV2Request(request,env,context) {
  const url=new URL(request.url),path=url.pathname;
  const group=path.match(/^\/api\/opportunities\/organizations\/(org_[a-f0-9]{24})$/);
  if(!['/api/opportunities','/api/opportunities/organizations'].includes(path)&&!group)return null;
  try {
    const profile=owner(context);
    if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==profile)fail(403,'profile_access_denied');
    if(request.method!=='GET')fail(405,'method_not_allowed');
    const db=env.OPPORTUNITY_DB;if(!db)fail(503,'opportunity_storage_not_configured');
    const f=filters(url,profile),now=clock(Date.now());
    if(group){
      const org=await stmt(db,'SELECT * FROM opportunity_organizations WHERE id=?',group[1]).first();
      if(!org)fail(404,'organization_not_found');
      if(profile==='arash'&&org.country==='IT')fail(403,'italy_scope_not_permitted');
      const where=whereFor({...f,organizationId:org.id,includeClosed:'true'},profile,now.iso);
      const rows=await all(db,'SELECT * FROM opportunity_editions '+where.sql+' ORDER BY published_at DESC,first_seen_at DESC,id LIMIT ? OFFSET ?',...where.args,f.limit,f.offset);
      const count=await stmt(db,'SELECT count(*) AS n FROM opportunity_editions '+where.sql,...where.args).first();
      return json({organization:JSON.parse(org.data),opportunities:await enrichReadPages(db,rows,profile,now.ms,env.PUBLIC_PAGE_READING_ENABLED==='true'),total:count.n,limit:f.limit,offset:f.offset});
    }
    const where=whereFor(f,profile,now.iso);
    if(path==='/api/opportunities/organizations') {
      const rows=await all(db,'SELECT o.id,o.data,count(e.id) AS editions FROM opportunity_organizations o JOIN opportunity_editions e ON e.organization_id=o.id '+where.sql.replaceAll('country','e.country').replaceAll('profile_scope','e.profile_scope').replaceAll('state','e.state').replaceAll('trust','e.trust').replaceAll('opportunity_type','e.opportunity_type').replaceAll('title','e.title').replaceAll('data','e.data').replaceAll('organization_id','e.organization_id').replaceAll('status','e.status').replaceAll('closing_at','e.closing_at').replaceAll('published_at','e.published_at')+' GROUP BY o.id ORDER BY o.id LIMIT ? OFFSET ?',...where.args,f.limit,f.offset);
      return json({organizations:rows.map(row=>({...JSON.parse(row.data),editionCount:row.editions})),limit:f.limit,offset:f.offset});
    }
    const rows=await all(db,'SELECT * FROM opportunity_editions '+where.sql+(f.sort==='newest'?' ORDER BY first_seen_at DESC,published_at DESC,id':' ORDER BY closing_at IS NULL,closing_at,published_at DESC,id')+' LIMIT ? OFFSET ?',...where.args,f.limit,f.offset);
    const count=await stmt(db,'SELECT count(*) AS n FROM opportunity_editions '+where.sql,...where.args).first();
    return json({opportunities:await enrichReadPages(db,rows,profile,now.ms,env.PUBLIC_PAGE_READING_ENABLED==='true'),total:count.n,limit:f.limit,offset:f.offset,sourceCoverage:'configured_sources_only',scope:{country:f.country,trust:f.trust,types:f.types,italyAllowed:profile==='amir'}});
  } catch(error) {return json({error:error instanceof OpportunityStoreError?error.code:'opportunity_request_failed'},error instanceof OpportunityStoreError?error.status:500);}
}
