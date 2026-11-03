// Bounded public-source pilot. No Google credentials, emails, applications or AI calls.
export const JOB_SOURCE=Object.freeze({id:'tas-pageup-759',name:'Tasmanian Government — PageUp medical listings',state:'TAS',portalUrl:'https://www.jobs.tas.gov.au/',feedUrl:'https://careers.pageuppeople.com/759/cw/en/jobs.json',coverage:'tasmania_pilot_only'});
const MAX_BYTES=3000000,MAX_ITEMS=500,COOLDOWN=15*60*1000;
class JobError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const iso=time=>time==null?null:new Date(time).toISOString();
function dbFor(env){if(!env.OPPORTUNITY_DB)throw new JobError(503,'opportunity_storage_not_configured');return env.OPPORTUNITY_DB;}
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const run=(db,sql,...args)=>statement(db,sql,...args).run();
const first=(db,sql,...args)=>statement(db,sql,...args).first();
const all=async(db,sql,...args)=>(await statement(db,sql,...args).all()).results||[];
export function plainJobText(value,limit=16000){
 if(typeof value!=='string')return '';
 return value.slice(0,250000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const point=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10);return point>31&&point<=0x10ffff?String.fromCodePoint(point):' ';}).replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,v=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[v])).replace(/[\x00-\x1f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
}
export function pageUpDate(value){if(typeof value!=='string')return null;const found=value.match(/^\/Date\((-?\d{1,16})(?:[+-]\d{4})?\)\/$/);if(!found)return null;const time=Number(found[1]);if(!Number.isFinite(time)||time<0||time>8640000000000000)return null;return new Date(time).toISOString();}
export function normalizeOpportunity(raw,time=Date.now()){
 if(!raw||typeof raw!=='object'||typeof raw.Id!=='string'||!/^\d{1,20}$/.test(raw.Id))return null;
 const title=plainJobText(raw.Title,500),categories=Array.isArray(raw.CategoryList)?raw.CategoryList.filter(x=>typeof x==='string'):String(raw.Categories||'').split(',').map(x=>x.trim());
 if(!categories.some(x=>x.toLowerCase()==='medical')||!/(\b(?:general practitioner|medical officer|medical practitioner|registrar|staff specialist|visiting medical specialist|physician|psychiatrist|surgeon|surgical fellow)\b)/i.test(title)||/\b(?:veterinar|nurs(?:e|ing)|radiograph|therapist|roster support)\b/i.test(title))return null;
 const publishedAt=pageUpDate(raw.OpeningDateUtc),closingAt=pageUpDate(raw.ClosingDateUtc);
 // A missing or malformed advertised deadline cannot be promoted to an open job.
 if(!title||!closingAt)return null;
 const kind=/\b(?:employment register|expression(?:s)? of interest|talent (?:pool|register))\b/i.test(title)?'employment_register':'vacancy';
 const status=Date.parse(closingAt)<=time?'closed':publishedAt&&Date.parse(publishedAt)>time?'future':'open';
 return {id:'job_tas_'+raw.Id,sourceId:JOB_SOURCE.id,title,organization:plainJobText(raw.Brand,300)||null,state:'TAS',city:plainJobText(raw.SiteSuburb,200)||null,location:plainJobText(raw.Locations,500)||null,summary:plainJobText(raw.Summary,2500),fullText:plainJobText(raw.Overview),url:'https://careers.pageuppeople.com/759/cw/en/job/'+raw.Id,sourceUrl:JOB_SOURCE.feedUrl,publishedAt,closingAt,kind,status,sponsorship:null,supervision:null,monash:null,eligibility:'not_assessed',evidenceStatus:'official_source_listing_not_job_offer'};
}
async function boundedJson(response){
 if(Number(response.headers.get('content-length')||0)>MAX_BYTES)throw new JobError(502,'source_response_too_large');
 const reader=response.body?.getReader();if(!reader)throw new JobError(502,'invalid_source_response');
 let size=0,text='';const decoder=new TextDecoder();
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new JobError(502,'source_response_too_large');}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 let data;try{data=JSON.parse(text);}catch{throw new JobError(502,'invalid_source_json');}
 if(!Array.isArray(data)||data.length>MAX_ITEMS||data.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new JobError(502,'invalid_source_schema');return data;
}
export async function collectOpportunities(env,fetcher=fetch){
 const db=dbFor(env),now=Date.now(),at=iso(now),lock=crypto.randomUUID();
 await run(db,'INSERT OR IGNORE INTO job_source_checks(source_id) VALUES(?)',JOB_SOURCE.id);
 const claim=await statement(db,'UPDATE job_source_checks SET lock_token=?,lock_until=?,last_attempt_at=? WHERE source_id=? AND lock_until<? AND next_check_at<=? RETURNING etag',lock,now+120000,now,JOB_SOURCE.id,now,now).first();
 if(!claim){const state=await first(db,'SELECT lock_until,next_check_at FROM job_source_checks WHERE source_id=?',JOB_SOURCE.id);return {sourceId:JOB_SOURCE.id,status:state.lock_until>now?'busy':'cooldown',checkedAt:at,nextCheckAt:iso(state.next_check_at),sourceCoverage:JOB_SOURCE.coverage};}
 try{
  const headers={Accept:'application/json'};if(typeof claim.etag==='string'&&claim.etag.length<1000&&!/[\r\n]/.test(claim.etag))headers['If-None-Match']=claim.etag;
  let response;try{response=await fetcher(JOB_SOURCE.feedUrl,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new JobError(502,'source_unavailable');}
  if(response.status===304){
   await run(db,"UPDATE job_opportunities SET status='closed' WHERE source_id=? AND status IN ('open','future') AND closing_at<=?",JOB_SOURCE.id,at);
   await run(db,"UPDATE job_source_checks SET status='not_modified',last_success_at=?,next_check_at=?,last_error_code=NULL WHERE source_id=? AND lock_token=?",now,now+COOLDOWN,JOB_SOURCE.id,lock);
   return {sourceId:JOB_SOURCE.id,status:'not_modified',imported:0,checkedAt:at,nextCheckAt:iso(now+COOLDOWN),sourceCoverage:JOB_SOURCE.coverage};
  }
  if(!response.ok)throw new JobError(502,response.status===429?'source_rate_limited':'source_http_error');
  const data=await boundedJson(response),records=new Map();for(const raw of data){const item=normalizeOpportunity(raw,now);if(item)records.set(item.id,item);}
  // Reject an unexplained empty physician result rather than erasing the last good data.
  if(!records.size)throw new JobError(502,'no_medical_listings_verified');
  const writes=[];
  for(const item of records.values())writes.push(statement(db,`INSERT INTO job_opportunities(id,source_id,title,kind,state,published_at,closing_at,first_seen_at,last_seen_at,status,data) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,state=excluded.state,published_at=excluded.published_at,closing_at=excluded.closing_at,last_seen_at=excluded.last_seen_at,status=excluded.status,data=excluded.data`,item.id,item.sourceId,item.title,item.kind,item.state,item.publishedAt,item.closingAt,at,at,item.status,JSON.stringify(item)));
  writes.push(statement(db,"UPDATE job_opportunities SET status='source_removed' WHERE source_id=? AND id NOT IN (SELECT value FROM json_each(?))",JOB_SOURCE.id,JSON.stringify([...records.keys()])));
  const etag=response.headers.get('etag');
  writes.push(statement(db,"UPDATE job_source_checks SET status='updated',etag=?,last_success_at=?,next_check_at=?,last_error_code=NULL,medical_listings=? WHERE source_id=? AND lock_token=?",etag&&etag.length<1000&&!/[\r\n]/.test(etag)?etag:null,now,now+COOLDOWN,records.size,JOB_SOURCE.id,lock));
  // D1 batch is atomic; a failed import cannot partially erase the last successful feed.
  await db.batch(writes);
  return {sourceId:JOB_SOURCE.id,status:'updated',imported:records.size,checkedAt:at,nextCheckAt:iso(now+COOLDOWN),sourceCoverage:JOB_SOURCE.coverage};
 }catch(error){const code=error instanceof JobError?error.code:'collector_failed';await run(db,"UPDATE job_source_checks SET status='failed',last_error_code=?,next_check_at=? WHERE source_id=? AND lock_token=?",code,now+2*COOLDOWN,JOB_SOURCE.id,lock);return {sourceId:JOB_SOURCE.id,status:'failed',error:code,imported:0,checkedAt:at,nextCheckAt:iso(now+2*COOLDOWN),sourceCoverage:JOB_SOURCE.coverage};}
 finally{await run(db,'UPDATE job_source_checks SET lock_token=NULL,lock_until=0 WHERE source_id=? AND lock_token=?',JOB_SOURCE.id,lock);}
}
export function opportunityMatch(item,profile){
 const title=String(item.title||'').toLowerCase(),reasons=[];let score=0;
 const wanted=profile==='arash'?/\b(general practitioner|medical officer|medical practitioner)\b/:/\b(general medicine|internal medicine|medical registrar|physician|geriatric medicine)\b/;
 if(wanted.test(title)){score+=2;reasons.push('title_matches_interest');}
 if(profile==='amir'&&/\bregistrar\b/.test(title)){score++;reasons.push('registrar_employment_grade_not_training_credit');}
 if(/\bstaff specialist\b/.test(title))reasons.push('specialist_qualification_and_registration_require_verification');
 if(item.kind==='employment_register')reasons.push('register_not_current_specific_vacancy');
 reasons.push('registration_supervision_sponsorship_not_assessed');return {score,reasons,meaning:'known_title_signals_not_acceptance_probability'};
}
async function listOpportunities(db,url,profile){
 const q=(url.searchParams.get('q')||'').trim().toLowerCase(),state=url.searchParams.get('state')||'all',kind=url.searchParams.get('kind')||'all',includeClosed=url.searchParams.get('includeClosed')||'false',limit=Number(url.searchParams.get('limit')||25),offset=Number(url.searchParams.get('offset')||0);
 if(q.length>200||!['all','TAS'].includes(state)||!['all','vacancy','employment_register'].includes(kind)||!['true','false'].includes(includeClosed)||!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>10000)throw new JobError(400,'invalid_opportunity_filter');
 const at=iso(Date.now()),where="WHERE (?='all' OR state=?) AND (?='all' OR kind=?) AND (?='' OR instr(lower(title||' '||data),?)>0) AND (?='true' OR (status IN ('open','future') AND closing_at>? AND (published_at IS NULL OR published_at<=?)))",params=[state,state,kind,kind,q,q,includeClosed,at,at];
 const rows=await all(db,'SELECT data,first_seen_at,last_seen_at,status FROM job_opportunities '+where+' ORDER BY closing_at,id LIMIT ? OFFSET ?',...params,limit,offset);
 const count=await first(db,'SELECT count(*) AS n FROM job_opportunities '+where,...params);
 return {opportunities:rows.map(row=>{const item=JSON.parse(row.data);const status=row.status==='source_removed'?'source_removed':Date.parse(item.closingAt)<=Date.now()?'closed':item.publishedAt&&Date.parse(item.publishedAt)>Date.now()?'future':'open';return {...item,status,firstSeenAt:row.first_seen_at,lastSeenAt:row.last_seen_at,match:opportunityMatch(item,profile)};}),total:count.n,limit,offset,sourceCoverage:JOB_SOURCE.coverage};
}
export async function handleOpportunityRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname;if(!['/api/opportunities','/api/opportunities/sources','/api/opportunities/refresh'].includes(path))return null;
 try{
  if(!context?.userId||!['arash','amir'].includes(context.profileId))throw new JobError(403,'workspace_required');
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)throw new JobError(403,'profile_access_denied');
  const db=dbFor(env);
  if(path==='/api/opportunities'&&request.method==='GET')return json(await listOpportunities(db,url,context.profileId));
  if(path==='/api/opportunities/sources'&&request.method==='GET'){const row=await first(db,'SELECT * FROM job_source_checks WHERE source_id=?',JOB_SOURCE.id);return json({sources:[{...JOB_SOURCE,status:row?.status||'not_checked',lastCheckAt:iso(row?.last_attempt_at),lastSuccessAt:iso(row?.last_success_at),nextCheckAt:iso(row?.next_check_at||null),lastErrorCode:row?.last_error_code||null,medicalListings:row?.medical_listings||0}]});}
  if(path==='/api/opportunities/refresh'&&request.method==='POST'){
   if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)throw new JobError(403,'origin_rejected');
   const text=await request.text();if(text.length>1000)throw new JobError(413,'payload_too_large');let body;try{body=JSON.parse(text||'{}');}catch{throw new JobError(400,'invalid_payload');}if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)throw new JobError(400,'refresh_does_not_accept_source_urls');
   return json(await collectOpportunities(env,fetcher));
  }
  throw new JobError(405,'method_not_allowed');
 }catch(error){return json({error:error instanceof JobError?error.code:'opportunity_request_failed'},error instanceof JobError?error.status:500);}
}
