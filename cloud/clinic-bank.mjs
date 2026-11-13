// Imported URLs remain private leads. Public reading neither creates a vacancy
// nor grants permission to contact anyone. Original spreadsheet contacts are not
// promoted into source-published evidence or shared with another workspace.
import {readQueuedPage,PUBLIC_PAGE_REQUEST_LIMIT} from './public-page-worker.mjs';
import {checkAutomationMembership} from './automation-membership.mjs';
export const CLINIC_BANK_REFRESH_MS=7*86400000;
export const CLINIC_BANK_RUN_LIMIT=2;
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
 const db=env.GOOGLE_DB,receipts=[];
 try{
  for(let i=0;i<CLINIC_BANK_RUN_LIMIT;i++){
   const row=await db.prepare("UPDATE clinic_bank_leads SET lease_until=?,status=CASE WHEN status='pending' THEN 'reading' ELSE status END WHERE id=(SELECT id FROM clinic_bank_leads WHERE profile_id='arash' AND lease_until<=? AND available_at<=? ORDER BY available_at,updated_at,id LIMIT 1) AND lease_until<=? AND available_at<=? RETURNING *").bind(at+180000,at,at,at,at).first();
   if(!row)break;
   let result;
   try{
    const membership=await membershipCheck(env,row.owner_id,'arash',fetcher);
    if(!membership?.active){
     const status=membership?.reason==='owner_inactive'?'owner_inactive':'membership_check_unavailable';
     await db.prepare('UPDATE clinic_bank_leads SET lease_until=0,available_at=?,status=?,updated_at=? WHERE id=? AND owner_id=? AND lease_until=?').bind(at+(status==='owner_inactive'?86400000:900000),status,new Date(at).toISOString(),row.id,row.owner_id,at+180000).run();
     receipts.push({id:row.id,status});continue;
    }
    const url=clinicBankURL(row.url);
    if(!UUID.test(row.owner_id)||!url)result={status:'invalid_url',enrichment:{contacts:[]}};
    else{
     const base=new URL(url).hostname.replace(/^www\./,''),budget={remaining:PUBLIC_PAGE_REQUEST_LIMIT};
     result=await readQueuedPage({id:row.id,url,data:JSON.stringify({officialBases:[base]})},fetcher,undefined,budget);
     if(['read','read_partial'].includes(result.status)&&!(result.enrichment?.contacts||[]).some(contact=>contact.type==='email')){
      const candidates=(result.enrichment?.followLinks||[]).filter(link=>clinicBankURL(link.url)&&/contact|team|staff|about/i.test(new URL(link.url).pathname+' '+String(link.label||'')));
      const follow=candidates.find(link=>/contact/i.test(new URL(link.url).pathname+' '+String(link.label||'')))||candidates[0];
      if(follow&&budget.remaining>=2){
       const linked=await readQueuedPage({id:row.id,url:follow.url,data:JSON.stringify({officialBases:[base]})},fetcher,undefined,budget);
       result.linkedReadings=[{url:follow.url,sourceURL:linked.finalUrl||follow.url,status:linked.status,readAt:linked.readAt}];
       if(['read','read_partial'].includes(linked.status))result.enrichment.contacts=[...(result.enrichment?.contacts||[]),...(linked.enrichment?.contacts||[]).map(contact=>({...contact,sourceRelation:'linked_page'}))];
      }
     }
    }
    const read=['read','read_partial'].includes(result.status),previousResult=parse(row.result_json),previousContacts=Array.isArray(previousResult.contacts)?previousResult.contacts:[];
    // A failed refresh must not erase the last published observations. Retain
    // their original source/quote and receipt, while the failure status makes
    // the entire observation explicitly stale and never sending-approved.
    const contacts=read?(result.enrichment?.contacts||[]).slice(0,100):previousContacts.slice(0,100);
    const previous=new Set(previousContacts.filter(c=>c.type==='email').map(c=>String(c.value).toLowerCase()));
    const newEmails=read?contacts.filter(c=>c.type==='email'&&!previous.has(String(c.value).toLowerCase())).length:0;
    const status=read?(contacts.length?'public_contacts_found':'public_page_read'):result.status;
    const attempts=read?0:row.attempts+1,next=at+(read?CLINIC_BANK_REFRESH_MS:attempts<3?86400000:CLINIC_BANK_REFRESH_MS),now=new Date(at).toISOString();
    const contactsReadAt=read?now:previousResult.contactsReadAt||row.last_success_at||null;
    const clinicalSource=read?clinicBankURL(result.finalUrl||row.url):null;
    const clinicalText=read&&clinicalSource&&new URL(clinicalSource).hostname.replace(/^www\./,'')===new URL(row.url).hostname.replace(/^www\./,'')?clinicBankClinicalExcerpt(result.text,result.title):'';
    const clinicalEvidence=read?{clinicalText,clinicalSourceURL:clinicalText?clinicalSource:null,clinicalReadAt:clinicalText?now:null,clinicalScope:'bounded_public_service_statements_not_full_page'}:{clinicalText:previousResult.clinicalText||'',clinicalSourceURL:previousResult.clinicalSourceURL||null,clinicalReadAt:previousResult.clinicalReadAt||null,clinicalScope:previousResult.clinicalScope||'not_recorded'};
    const snapshot={sourceStatus:result.status,sourceURL:read?result.finalUrl||row.url:previousResult.sourceURL||row.url,title:read?clean(result.title,500):previousResult.title||'',contacts,contactsReadAt,...clinicalEvidence,linkedReadings:read?result.linkedReadings||[]:previousResult.linkedReadings||[],limitations:result.limitations||[],lastAttempt:{readAt:now,status:result.status,sourceURL:result.finalUrl||row.url}};
    await db.prepare('UPDATE clinic_bank_leads SET status=?,attempts=?,available_at=?,lease_until=0,read_at=?,last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END,result_json=?,new_email_count=?,updated_at=? WHERE id=? AND owner_id=? AND lease_until=?').bind(status,attempts,next,now,read?1:0,now,JSON.stringify(snapshot),newEmails,now,row.id,row.owner_id,at+180000).run();
    receipts.push({id:row.id,status,newEmails});
   }catch{
    // Release the lease with a durable backoff, without claiming a read succeeded.
    await db.prepare("UPDATE clinic_bank_leads SET lease_until=0,available_at=?,status='reading_storage_failed',updated_at=? WHERE id=? AND owner_id=? AND lease_until=?").bind(at+86400000,new Date(at).toISOString(),row.id,row.owner_id,at+180000).run();
    receipts.push({id:row.id,status:'reading_storage_failed'});
   }
  }
  return{enabled:true,processed:receipts.length,receipts,limitPerRun:CLINIC_BANK_RUN_LIMIT};
 }catch{return{enabled:true,processed:receipts.length,status:'clinic_bank_storage_unavailable'};}
}
