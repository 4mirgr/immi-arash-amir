// Public contact coverage is a universal ingestion/backfill rule, not a claim
// that an old advertisement is open or that every contact can be retrieved.
export const CONTACT_COVERAGE_POLICY='all_opportunities_contact_v3';
export const CONTACT_COVERAGE_LIMIT=25;
const jsonData=alias=>`CASE WHEN json_valid(${alias}.data) THEN ${alias}.data ELSE '{}' END`;
const related=`(EXISTS(SELECT 1 FROM opportunity_editions e WHERE e.url=q.url AND e.country=q.country) OR EXISTS(SELECT 1 FROM public_page_queue parent JOIN opportunity_editions e ON e.url=parent.url AND e.country=parent.country WHERE parent.id=json_extract(${jsonData('q')},'$.parentPageId') AND parent.country=q.country))`;
const selectionSQL=`WITH missing AS (
 SELECT e.url,min(e.country) AS country,min(e.title) AS title,min(e.source_id) AS source_id,min(e.first_seen_at) AS first_seen_at
 FROM opportunity_editions e WHERE e.country IN ('AU','IT') AND NOT EXISTS(SELECT 1 FROM public_page_queue q WHERE q.url=e.url)
 GROUP BY e.url HAVING min(e.country)=max(e.country)
), obsolete AS (
 SELECT q.id,q.url,q.country FROM public_page_queue q
 JOIN public_page_enrichment x ON x.page_id=q.id AND x.country=q.country AND x.read_at=q.read_at
 JOIN public_page_content c ON c.page_id=q.id AND c.read_at=q.read_at AND c.status=q.status
 WHERE q.status IN ('read','read_partial') AND q.lease_until<=?
 AND coalesce(json_extract(${jsonData('q')},'$.refreshRequested'),0)<>1
 AND coalesce(json_extract(x.data,'$.extractorVersion'),0)<3 AND ${related}
), scope_conflicts AS (
 SELECT e.url FROM opportunity_editions e LEFT JOIN public_page_queue q ON q.url=e.url
 WHERE e.country IN ('AU','IT') GROUP BY e.url HAVING min(e.country)<>max(e.country) OR max(CASE WHEN q.country IS NOT NULL AND q.country<>e.country THEN 1 ELSE 0 END)=1
)
SELECT 'summary' AS kind,NULL AS id,NULL AS url,NULL AS country,NULL AS title,NULL AS source_id,
 (SELECT count(*) FROM missing) AS missing_before,(SELECT count(*) FROM obsolete) AS obsolete_before,(SELECT count(*) FROM scope_conflicts) AS scope_conflicts,
 (SELECT count(*) FROM missing WHERE length(url)>4000) AS oversized_targets
UNION ALL SELECT 'missing',NULL,url,country,title,source_id,NULL,NULL,NULL,NULL FROM (SELECT * FROM missing WHERE length(url)<=4000 ORDER BY first_seen_at,url LIMIT ${CONTACT_COVERAGE_LIMIT})
UNION ALL SELECT 'obsolete',id,url,country,NULL,NULL,NULL,NULL,NULL,NULL FROM (SELECT * FROM obsolete ORDER BY CASE WHEN country='AU' THEN 0 ELSE 1 END,url LIMIT ${CONTACT_COVERAGE_LIMIT})`;

function publicTarget(value){
 try{
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!/^[-a-z0-9.]+$/.test(u.hostname)||!u.hostname.includes('.')||/^\d+(?:\.\d+){3}$/.test(u.hostname)||u.hostname.includes('..')||/\.(?:local|localhost|internal)$/.test(u.hostname)||/(?:^|\/)(?:login|logout|signin|sign-in|admin|wp-admin|account|auth|oauth|apply|application|candidate)(?:\/|$)/i.test(decodeURIComponent(u.pathname))||[...u.searchParams.keys()].some(k=>/token|secret|session|password|code|auth/i.test(k)))return null;
  // Keep the original lookup key for a legacy spelling; the page reader safely
  // normalizes its fetch URL. Fragments/control characters never become targets.
  if(u.hash||/[\x00-\x20]/.test(value))return null;
  return u;
 }catch{return null;}
}
async function pageId(url){return 'page_'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url)))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);}
const changes=results=>Array.isArray(results)?results.reduce((sum,r)=>sum+Number(r?.meta?.changes||0),0):0;

export async function reconcileContactCoverage(env,now=Date.now()){
 if(env?.PUBLIC_PAGE_READING_ENABLED!=='true'||!env?.OPPORTUNITY_DB)return {enabled:false,registered:0,refreshMarked:0};
 if(!Number.isFinite(now))return {enabled:true,status:'invalid_time',registered:0,refreshMarked:0};
 const db=env.OPPORTUNITY_DB;
 let rows;
 try{rows=(await db.prepare(selectionSQL).bind(now).all()).results||[];}
 catch(error){return {enabled:true,status:/no such (?:table|column)/i.test(String(error?.message||''))?'storage_not_configured':'coverage_storage_unavailable',registered:0,refreshMarked:0};}
 const summary=rows.find(r=>r.kind==='summary')||{},pages=[];let invalidTargets=0;
 for(const row of rows.filter(r=>r.kind==='missing').slice(0,CONTACT_COVERAGE_LIMIT)){
  const target=publicTarget(row.url);if(!target)invalidTargets++;
  // Persist an explicit non-fetchable exception so malformed legacy entries
  // cannot occupy the first batch forever and starve later valid targets.
  pages.push({id:await pageId(row.url),url:row.url,country:row.country,profileScope:row.country==='IT'?'amir':'both',status:target?'pending':'invalid_url',officialBases:target?[target.hostname.replace(/^www\./,'')]:[],institutionIds:[],labels:[String(row.title||'Public opportunity').slice(0,400)],sourceId:String(row.source_id||'').slice(0,120),contactCoveragePolicy:CONTACT_COVERAGE_POLICY,requiredExtractorVersion:3,contactCoverageRequired:true,contactCoverageBlocked:!target,...(!target?{blockedReason:'unsafe_legacy_url'}:{}),depth:0});
 }
 const obsolete=rows.filter(r=>r.kind==='obsolete').map(r=>r.id).slice(0,CONTACT_COVERAGE_LIMIT);
 const writes=[];
 if(pages.length)writes.push(db.prepare(`INSERT INTO public_page_queue(id,url,country,profile_scope,data,status)
  SELECT json_extract(value,'$.id'),json_extract(value,'$.url'),json_extract(value,'$.country'),json_extract(value,'$.profileScope'),value,json_extract(value,'$.status') FROM json_each(?) WHERE 1 ON CONFLICT DO NOTHING`).bind(JSON.stringify(pages)));
 if(obsolete.length)writes.push(db.prepare(`UPDATE public_page_queue SET data=json_set(data,'$.refreshRequested',json('true'),'$.contactCoveragePolicy',?,'$.requiredExtractorVersion',3,'$.contactCoverageRequired',json('true')),available_at=0,attempts=0
  WHERE id IN (SELECT value FROM json_each(?)) AND status IN ('read','read_partial') AND lease_until<=? AND coalesce(json_extract(data,'$.refreshRequested'),0)<>1`).bind(CONTACT_COVERAGE_POLICY,JSON.stringify(obsolete),now));
 let results=[];
 try{if(writes.length)results=await db.batch(writes);}
 catch{return {enabled:true,status:'coverage_write_failed',registered:0,refreshMarked:0,missingBefore:Number(summary.missing_before||0),obsoleteBefore:Number(summary.obsolete_before||0)};}
 return {enabled:true,status:Number(summary.scope_conflicts||0)||Number(summary.oversized_targets||0)?'partial':'reconciled',policy:CONTACT_COVERAGE_POLICY,registered:pages.length?changes(results.slice(0,1)):0,refreshMarked:obsolete.length?changes(results.slice(pages.length?1:0)):0,missingBefore:Number(summary.missing_before||0),obsoleteBefore:Number(summary.obsolete_before||0),scopeConflicts:Number(summary.scope_conflicts||0),oversizedTargets:Number(summary.oversized_targets||0),invalidTargets,limitPerCategory:CONTACT_COVERAGE_LIMIT};
}
