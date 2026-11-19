import {readClinicSourceRestrictions,mergeClinicSourceRestrictions} from './clinic-source-restrictions.mjs';
// Imported URLs remain private leads. Public reading neither creates a vacancy
// nor grants permission to contact anyone. Original spreadsheet contacts are not
// promoted into source-published evidence or shared with another workspace.
import {readQueuedPage,PUBLIC_PAGE_REQUEST_LIMIT,PUBLIC_PAGE_HTTP_TIMEOUT_MS,PUBLIC_PAGE_ROBOTS_TIMEOUT_MS,PUBLIC_PAGE_MAX_CRAWL_DELAY_MS} from './public-page-worker.mjs';
import {checkAutomationMembership} from './automation-membership.mjs';
import {buildClinicResearchContext,selectClinicResearchLinks,CLINIC_RESEARCH_VERSION} from './clinic-research-context.mjs';
export const CLINIC_BANK_REFRESH_MS=7*86400000;
export const CLINIC_BANK_RUN_LIMIT=2;
// Both rows are leased before same-host reads run serially. Each observation
// has at least one robots request, at most five document waits (30s each), and
// six HTTP timeouts (<=10s each). Two sites plus each 8s membership check and
// 30s storage headroom round up to eight minutes, covering the next 5min tick.
const observationWallMs=PUBLIC_PAGE_REQUEST_LIMIT*Math.max(PUBLIC_PAGE_HTTP_TIMEOUT_MS,PUBLIC_PAGE_ROBOTS_TIMEOUT_MS)+(PUBLIC_PAGE_REQUEST_LIMIT-1)*PUBLIC_PAGE_MAX_CRAWL_DELAY_MS;
export const CLINIC_BANK_LEASE_MS=Math.ceil((CLINIC_BANK_RUN_LIMIT*(observationWallMs+8000)+30000)/60000)*60000;
const BASE='/api/clinic-bank',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const deniedPath=/(?:^|\/)(?:login|logout|signin|sign-in|admin|wp-admin|account|auth|oauth|apply|application|candidate)(?:\/|$)/i;
export function clinicBankURL(value){
 try{
  if(typeof value!=='string'||value.length>2000||/[\x00-\x20\\]/.test(value))return null;
  const u=new URL(value),host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!/^[-a-z0-9.]+\.[a-z]{2,63}$/.test(host)||host.includes('..')||/^\d+(?:\.\d+){3}$/.test(host)||/(?:^|\.)(?:localhost|local|internal|lan|home|onion)$/.test(host)||['nip.io','sslip.io','localtest.me','vcap.me','lvh.me'].some(d=>host===d||host.endsWith('.'+d))||deniedPath.test(decodeURIComponent(u.pathname)))return null;
  return u.href;
 }catch{return null;}
}
const clean=(v,max)=>typeof v==='string'?v.replace(/[\x00-\x1f<>]/g,' ').trim().slice(0,max):'';
// Save only bounded generic service statements from the already-read public
// publisher page. Do not retain full pages, testimonials or patient narratives.
export function clinicBankClinicalExcerpt(value,pageTitle=''){
 if(typeof value!=='string')return '';
 let visible=value.replace(/<[^>]*>/g,' ').trim();
 if(typeof pageTitle==='string'&&pageTitle.trim()&&visible.startsWith(pageTitle.trim()))visible=visible.slice(pageTitle.trim().length).trimStart();
 const statements=[],seen=new Set();
 for(const part of visible.slice(0,12000).split(/\n+|(?<=[.!?])\s+/)){
  const line=part.replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim();
  if(line.length<25||line.length>600||seen.has(line)||/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|javascript:/i.test(line)||/\b(?:no|not|never|without|unable|cannot|can't|testimonial|diagnosed|diagnosis|case report|patient story|I|my|mine|Mr|Mrs|Ms|Miss|DOB)\b|\b\d{1,3}[- ]year[- ]old\b/i.test(line))continue;
  if(!/\b(?:provides?|offers?|delivers?|specialises?|specializes?|treats?|manages?|supports?)\b/i.test(line)||!/\b(?:general practice|family medicine|patient|chronic|preventive|diabetes|wound|emergency|acute|community|multidisciplinary|clinical|teaching)\b/i.test(line))continue;
  seen.add(line);statements.push(line);if(statements.length>=12)break;
 }
 return statements.join('\n');
}
async function leadId(owner,url){return 'bank_'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner+'\n'+url)))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);}
function provenance(item){const p=item.provenance;if(!p||typeof p!=='object'||Array.isArray(p))return {};return{sourceFile:clean(p.sourceFile,180),sourceSheet:clean(p.sourceSheet,100),...(Number.isInteger(p.sourceRow)&&p.sourceRow>0&&p.sourceRow<10000000?{sourceRow:p.sourceRow}:{})};}
export function clinicBankView(row,at=Date.now()){
 const result=parse(row.result_json),contacts=Array.isArray(result.contacts)?result.contacts:[],successful=['public_contacts_found','public_page_read'].includes(row.status);
 const readAt=result.contactsReadAt||row.last_success_at||(successful?row.read_at:null),readStamp=Date.parse(readAt);
 return{id:row.id,name:row.name,url:row.url,status:row.status,readAt,lastAttemptAt:result.lastAttempt?.readAt||row.read_at||null,lastSuccessAt:row.last_success_at,nextRefreshAt:new Date(Number(row.available_at)||at).toISOString(),contacts,newEmailCount:row.new_email_count||0,stale:!successful||!Number.isFinite(readStamp)||readStamp>at||at-readStamp>CLINIC_BANK_REFRESH_MS,leadOnly:true,vacancyVerified:false,sendingApproved:false,sourceStatus:result.sourceStatus||null};
}
export async function handleClinicBankRequest(request,env,context){
 const u=new URL(request.url);if(!u.pathname.startsWith(BASE+'/'))return null;
 if(!UUID.test(context?.userId||'')||context.profileId!=='arash')return json({error:'profile_access_denied'},403);
 if(u.searchParams.has('profile')&&u.searchParams.get('profile')!=='arash')return json({error:'profile_access_denied'},403);
 if(!env.GOOGLE_DB)return json({error:'clinic_bank_not_configured'},503);
 const db=env.GOOGLE_DB,owner=context.userId;
 try{
  if(request.method==='GET'&&u.pathname===BASE+'/status'){
   const counts=await db.prepare("SELECT count(*) AS total,sum(status='pending') AS pending,sum(status IN ('public_contacts_found','public_page_read')) AS read,sum(status='public_contacts_found') AS with_contacts,sum(status NOT IN ('pending','reading','public_contacts_found','public_page_read')) AS blocked,max(read_at) AS last_run,min(available_at) AS next_run,sum(new_email_count) AS new_emails FROM clinic_bank_leads WHERE owner_id=? AND profile_id='arash'").bind(owner).first();
   return json({profileId:'arash',enabled:env.CLINIC_BANK_READING_ENABLED==='true',counts:{total:Number(counts?.total||0),pending:Number(counts?.pending||0),read:Number(counts?.read||0),withContacts:Number(counts?.with_contacts||0),blocked:Number(counts?.blocked||0)},lastRunAt:counts?.last_run||null,nextRefreshAt:counts?.next_run?new Date(counts.next_run).toISOString():null,newEmails:Number(counts?.new_emails||0),refreshDays:7,limitPerRun:CLINIC_BANK_RUN_LIMIT,leadOnly:true,automaticSending:false});
  }
  if(request.method==='GET'&&u.pathname===BASE+'/items'){
   const params=u.searchParams.get('status')||'all';if(!['all','contacts','pending','blocked'].includes(params))return json({error:'invalid_bank_filter'},400);
   const limit=Number(u.searchParams.get('limit')||20),offset=Number(u.searchParams.get('offset')||0);
   if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>1000000)return json({error:'invalid_bank_page'},400);
   const filter=params==='contacts'?" AND status='public_contacts_found'":params==='pending'?" AND status IN ('pending','reading')":params==='blocked'?" AND status NOT IN ('pending','reading','public_contacts_found','public_page_read')":'';
   const rows=(await db.prepare("SELECT * FROM clinic_bank_leads WHERE owner_id=? AND profile_id='arash'"+filter+" ORDER BY CASE status WHEN 'public_contacts_found' THEN 0 WHEN 'public_page_read' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,read_at DESC,id LIMIT ? OFFSET ?").bind(owner,limit,offset).all()).results||[];
   return json({profileId:'arash',items:rows.map(row=>clinicBankView(row)),leadOnly:true,automaticSending:false});
  }
  if(request.method!=='POST'||u.pathname!==BASE+'/import')return json({error:'not_found'},404);
  if(request.headers.get('Origin')!==u.origin)return json({error:'origin_rejected'},403);
  const raw=await request.text();if(raw.length>120000)return json({error:'payload_too_large'},413);
  let input;try{input=JSON.parse(raw);}catch{return json({error:'invalid_bank_import'},400);}
  if(!input||Array.isArray(input)||Object.keys(input).some(k=>k!=='items')||!Array.isArray(input.items)||!input.items.length||input.items.length>100)return json({error:'invalid_bank_import'},400);
  const items=[],seen=new Set();
  for(const item of input.items){
   if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['url','name','provenance'].includes(k)))return json({error:'invalid_bank_import'},400);
   const url=clinicBankURL(item.url);if(!url)return json({error:'invalid_bank_url'},400);
   if(seen.has(url))continue;seen.add(url);items.push({id:await leadId(owner,url),url,name:clean(item.name,180),provenance:provenance(item)});
  }
  const now=new Date().toISOString(),result=await db.prepare(`INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,provenance_json,created_at,updated_at)
   SELECT json_extract(value,'$.id'),?,'arash',json_extract(value,'$.url'),json_extract(value,'$.name'),json_extract(value,'$.provenance'),?,? FROM json_each(?) WHERE 1 ON CONFLICT(owner_id,url) DO NOTHING`).bind(owner,now,now,JSON.stringify(items.map(item=>({...item,provenance:JSON.stringify(item.provenance)})))).run();
  return json({imported:Number(result.meta?.changes||0),submitted:input.items.length,leadOnly:true,vacancyVerified:false,sendingApproved:false},201);
 }catch(e){return json({error:/no such (?:table|column)/i.test(String(e?.message))?'clinic_bank_not_configured':'clinic_bank_request_failed'},503);}
}
export async function dispatchClinicBankReading(env,fetcher=fetch,at=Date.now(),membershipCheck=checkAutomationMembership){
 if(env.CLINIC_BANK_READING_ENABLED!=='true'||!env.GOOGLE_DB)return{enabled:false,processed:0};
 if(!Number.isFinite(at))return{enabled:true,processed:0,status:'invalid_time'};
 const db=env.GOOGLE_DB,receipts=[],claimed=[],membershipChecks=new Map();let storageUnavailable=false;
 // Membership is fresh for this invocation, single-flight for concurrent sites
 // owned by the same account. Inactive/unavailable results are not retained.
 function membershipFor(owner){
  if(!membershipChecks.has(owner)){
   const pending=Promise.resolve().then(()=>membershipCheck(env,owner,'arash',fetcher)).then(result=>{if(!result?.active)membershipChecks.delete(owner);return result;},error=>{membershipChecks.delete(owner);throw error;});
   membershipChecks.set(owner,pending);
  }
  return membershipChecks.get(owner);
 }
 try{
  // Reserve at most one of six slots (two sites in each of three five-minute
  // runs) for successful legacy snapshots that did not retain research. The
  // first slot always serves ordinary due work, including never-read sites.
  const upgradeWindow=Math.floor(at/300000)%3===0;
  const legacy="status IN ('public_contacts_found','public_page_read') AND attempts=0 AND (CASE WHEN json_valid(result_json) THEN CASE WHEN json_type(result_json,'$.research.version')='integer' THEN json_extract(result_json,'$.research.version') ELSE 0 END ELSE 0 END)<"+CLINIC_RESEARCH_VERSION;
  for(let i=0;i<CLINIC_BANK_RUN_LIMIT;i++){
   const upgradeSlot=i===1&&upgradeWindow,eligible=upgradeSlot?'(available_at<=? OR ('+legacy+'))':'available_at<=?',priority=upgradeSlot?'CASE WHEN '+legacy+' THEN 0 ELSE 1 END,':'';
   const row=await db.prepare("UPDATE clinic_bank_leads SET lease_until=?,status=CASE WHEN status='pending' THEN 'reading' ELSE status END WHERE id=(SELECT id FROM clinic_bank_leads WHERE profile_id='arash' AND lease_until<=? AND "+eligible+" ORDER BY "+priority+"available_at,updated_at,id LIMIT 1) AND lease_until<=? AND "+eligible+" RETURNING *").bind(at+CLINIC_BANK_LEASE_MS,at,at,at,at).first();
   if(!row){if(i===0&&upgradeWindow)continue;break;}
   claimed.push(row);
  }
 }catch{storageUnavailable=true;}
 // Finish any successful claim even if the next claim fails; never strand it
 // merely because another row/storage request was unavailable.
 async function processRow(row){
   let result;
   try{
    const membership=await membershipFor(row.owner_id);
    if(!membership?.active){
     const status=membership?.reason==='owner_inactive'?'owner_inactive':'membership_check_unavailable';
     await db.prepare('UPDATE clinic_bank_leads SET lease_until=0,available_at=?,status=?,updated_at=? WHERE id=? AND owner_id=? AND lease_until=?').bind(at+(status==='owner_inactive'?86400000:900000),status,new Date(at).toISOString(),row.id,row.owner_id,at+CLINIC_BANK_LEASE_MS).run();
     return{id:row.id,status};
    }
    const url=clinicBankURL(row.url);
    if(!UUID.test(row.owner_id)||!url)result={status:'invalid_url',enrichment:{contacts:[]}};
    else{
     const base=new URL(url).hostname.replace(/^www\./,''),budget={remaining:PUBLIC_PAGE_REQUEST_LIMIT};
     result=await readQueuedPage({id:row.id,url,data:JSON.stringify({officialBases:[base]})},fetcher,undefined,budget);
     if(['read','read_partial'].includes(result.status)){
      const pages=[{...result}],now=new Date(at).toISOString();result.linkedReadings=[];
      const candidates=selectClinicResearchLinks(url,result.enrichment?.followLinks,{hasEmail:(result.enrichment?.contacts||[]).some(contact=>contact.type==='email'),validateURL:clinicBankURL});
      for(const follow of candidates){
       // Root and linked reads share this six-request counter and robots cache;
       // redirects/denials consume the same budget. No second-depth crawl.
       if(budget.remaining<2)break;
       const linked=await readQueuedPage({id:row.id,url:follow.url,data:JSON.stringify({officialBases:[base]})},fetcher,undefined,budget);
       pages.push({...linked,kind:follow.kind});
       result.linkedReadings.push({url:follow.url,sourceURL:linked.finalUrl||follow.url,status:linked.status,readAt:now});
       const publishedSource=clinicBankURL(linked.finalUrl||follow.url);
       if(['read','read_partial'].includes(linked.status)&&publishedSource&&new URL(publishedSource).hostname.replace(/^www\./,'')===base)result.enrichment.contacts=[...(result.enrichment?.contacts||[]),...(linked.enrichment?.contacts||[]).map(contact=>({...contact,sourceRelation:'linked_page'}))];
      }
      // Pin fresh fetched pages to the same scheduler observation used by the
      // contact/service receipts. Failed root refreshes retain the old dossier.
      result.research=buildClinicResearchContext({rootURL:url,observedAt:now,pages:pages.map(page=>({...page,readAt:now}))});
      result.sourceRestrictions=readClinicSourceRestrictions(pages,{now:at});
     }
    }
    const read=['read','read_partial'].includes(result.status),previousResult=parse(row.result_json),previousContacts=Array.isArray(previousResult.contacts)?previousResult.contacts:[];
    // A failed refresh must not erase the last published observations. Retain
    // their original source/quote and receipt, while the failure status makes
    // the entire observation explicitly stale and never sending-approved.
    const contacts=read?(result.enrichment?.contacts||[]).slice(0,100):previousContacts.slice(0,100);
    const previous=new Set(previousContacts.filter(c=>c.type==='email').map(c=>String(c.value).toLowerCase()));
    const newEmails=read?new Set(contacts.filter(c=>c.type==='email'&&!previous.has(String(c.value).toLowerCase())).map(c=>String(c.value).toLowerCase())).size:0;
    const status=read?(contacts.length?'public_contacts_found':'public_page_read'):result.status;
    const attempts=read?0:row.attempts+1,next=at+(read?CLINIC_BANK_REFRESH_MS:attempts<3?86400000:CLINIC_BANK_REFRESH_MS),now=new Date(at).toISOString();
    const contactsReadAt=read?now:previousResult.contactsReadAt||row.last_success_at||null;
    const clinicalSource=read?clinicBankURL(result.finalUrl||row.url):null;
    const clinicalText=read&&clinicalSource&&new URL(clinicalSource).hostname.replace(/^www\./,'')===new URL(row.url).hostname.replace(/^www\./,'')?clinicBankClinicalExcerpt(result.text,result.title):'';
    const clinicalEvidence=read?{clinicalText,clinicalSourceURL:clinicalText?clinicalSource:null,clinicalReadAt:clinicalText?now:null,clinicalScope:'bounded_public_service_statements_not_full_page'}:{clinicalText:previousResult.clinicalText||'',clinicalSourceURL:previousResult.clinicalSourceURL||null,clinicalReadAt:previousResult.clinicalReadAt||null,clinicalScope:previousResult.clinicalScope||'not_recorded'};
    const snapshot={sourceRestrictions:mergeClinicSourceRestrictions(previousResult.sourceRestrictions,previousResult.research?.sourceRestrictions,result.sourceRestrictions),sourceStatus:result.status,sourceURL:read?result.finalUrl||row.url:previousResult.sourceURL||row.url,title:read?clean(result.title,500):previousResult.title||'',contacts,contactsReadAt,...clinicalEvidence,...(read?{research:result.research}:previousResult.research?{research:previousResult.research}:{}),linkedReadings:read?result.linkedReadings||[]:previousResult.linkedReadings||[],limitations:result.limitations||[],lastAttempt:{readAt:now,status:result.status,sourceURL:result.finalUrl||row.url}};
    const stored=await db.prepare('UPDATE clinic_bank_leads SET status=?,attempts=?,available_at=?,lease_until=0,read_at=?,last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END,result_json=?,new_email_count=?,updated_at=? WHERE id=? AND owner_id=? AND lease_until=?').bind(status,attempts,next,now,read?1:0,now,JSON.stringify(snapshot),newEmails,now,row.id,row.owner_id,at+CLINIC_BANK_LEASE_MS).run();
    if(Number(stored.meta?.changes)===0)return{id:row.id,status:'lease_lost'};
    return{id:row.id,status,newEmails};
   }catch{
    // Release the lease with a durable backoff, without claiming a read succeeded.
    await db.prepare("UPDATE clinic_bank_leads SET lease_until=0,available_at=?,status='reading_storage_failed',updated_at=? WHERE id=? AND owner_id=? AND lease_until=?").bind(at+86400000,new Date(at).toISOString(),row.id,row.owner_id,at+CLINIC_BANK_LEASE_MS).run();
    return{id:row.id,status:'reading_storage_failed'};
   }
 }
 // Different clinic hosts overlap only their network waits. Entries on the
 // same host remain serial so this optimisation cannot overlap crawl delays.
 // Related pages keep their existing serial shared-budget/robots-cache path.
 const hosts=new Map(),tasks=claimed.map(row=>{
  const source=clinicBankURL(row.url),key=source?new URL(source).hostname.replace(/^www\./,''):row.id;
  const previous=hosts.get(key)||Promise.resolve();
  const task=previous.catch(()=>{}).then(()=>processRow(row));hosts.set(key,task);return task;
 });
 const results=await Promise.allSettled(tasks);
 for(const result of results){if(result.status==='fulfilled')receipts.push(result.value);else storageUnavailable=true;}
 if(storageUnavailable)return{enabled:true,processed:receipts.length,receipts,status:'clinic_bank_storage_unavailable'};
 return{enabled:true,processed:receipts.length,receipts,limitPerRun:CLINIC_BANK_RUN_LIMIT};
}
