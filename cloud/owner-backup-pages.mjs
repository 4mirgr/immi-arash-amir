// Bounded, owner-scoped recovery-data export. Not an atomic database snapshot,
// credential backup, restore endpoint, or authorization to replay external jobs.
const BASE='/api/backup/export',PAGE_SIZE=50,MAX_BYTES=500000,TTL=30*60*1000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SIMPLE=/^[a-zA-Z0-9_-]{1,128}$/;
const SUPABASE={immi_profiles:'profile_id',immi_settings:'profile_id',immi_cv_versions:'id',immi_cv_defaults:'profile_id',immi_presets:'id',immi_preset_defaults:'profile_id',immi_drafts:'id'};
const PRIVATE=['research_funding_plans','linkedin_sections','linkedin_drafts','linkedin_posts','linkedin_metrics','linkedin_contacts','linkedin_network_targets','linkedin_publish_attempts','roadmap_actions','pesci_practice_sessions','ai_assistant_runs','mail_automation_settings','mail_automation_jobs','mail_automation_suppressions','mail_automation_events','gp_workflow_settings','gp_opportunity_progress','clinic_bank_leads'];
const SEND_COLUMNS='id,owner_id,profile_id,google_subject,google_email,fingerprint,recipient,subject,cv_version_id,attachment_name,reply_thread_id,status,created_at,created_day,attempt_day,attempted_at,gmail_message_id';
const D1=Object.fromEntries(PRIVATE.map(table=>[table,{owner:'owner_id',columns:'*'}]));
D1.team_board_tasks={owner:'creator_id',columns:'*'};
D1.google_send_queue={owner:'owner_id',columns:SEND_COLUMNS,secondary:true};
D1.google_send_suppressions={owner:'owner_id',columns:'owner_id,email,created_at',secondary:true};
const exclusions=['provider_credentials_and_oauth_state','scheduled_send_and_publish_approvals','received_mail_bodies_and_sync_tokens','raw_send_mime_and_attachments','private_provider_files_not_stored_by_this_app','public_opportunity_database','other_doctor_private_data','shared_tasks_authored_by_other_doctor'];
const recovery={providerReconnectRequired:true,scheduledApprovalsExcluded:true,automaticJobsRequireReview:true,transportRecordsReferenceOnly:true,productionRestoreImplemented:false};
const utf8=value=>new TextEncoder().encode(value);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const fail=(status,code)=>{const e=new Error(code);e.status=status;throw e;};
const hex=value=>[...new Uint8Array(value)].map(b=>b.toString(16).padStart(2,'0')).join('');
const digest=async value=>hex(await crypto.subtle.digest('SHA-256',utf8(JSON.stringify(value))));
const encode=raw=>btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
async function signingKey(env){
 if(typeof env.GOOGLE_TOKEN_KEY!=='string'||env.GOOGLE_TOKEN_KEY.length<32)fail(503,'backup_cursor_key_not_configured');
 const material=await crypto.subtle.importKey('raw',utf8(env.GOOGLE_TOKEN_KEY),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:utf8('masir-owner-export-v2'),info:utf8('owner-bound-page-cursor')},material,{name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify']);
}
async function sign(value,key){const body=encode(utf8(JSON.stringify(value)));return body+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,utf8(body))));}
async function cursor(value,key,context,collection,now){
 try{if(typeof value!=='string'||value.length>2048||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(value))fail(400,'invalid_backup_cursor');const [body,signature]=value.split('.');if(!await crypto.subtle.verify('HMAC',key,decode(signature),utf8(body)))fail(400,'invalid_backup_cursor');const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(body)));if(data.version!==1||data.owner!==context.userId||data.profile!==context.profileId||data.collection!==collection||!Number.isFinite(data.started)||data.started>now+60000||now-data.started>TTL||!Number.isSafeInteger(data.page)||data.page<1||!SIMPLE.test(data.exportId))fail(400,'invalid_backup_cursor');return data;}catch(e){if(e.status)throw e;fail(400,'invalid_backup_cursor');}
}
async function tables(db){return new Set(((await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").bind().all()).results||[]).map(x=>x.name));}
function descriptor(id){const match=/^(d1|supabase)\.([a-z_]+)$/.exec(id||'');if(!match)return null;const [,,table]=match;if(match[1]==='supabase'&&SUPABASE[table])return{source:'supabase',table,key:SUPABASE[table]};if(match[1]==='d1'&&D1[table])return{source:'d1',table,...D1[table]};return null;}
function scope(item,context){return item.secondary?{sql:'owner_id IN (?,?)',args:[context.userId,context.userId+':secondary']}:{sql:item.owner+'=?',args:[context.userId]};}
function assertOwned(rows,item,context){for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row))fail(503,'backup_invalid_source_rows');if(item.source==='supabase'){if(row.user_id!==context.userId||row.profile_id!==context.profileId)fail(503,'backup_source_owner_mismatch');}else if(![context.userId,...(item.secondary?[context.userId+':secondary']:[])].includes(row[item.owner]))fail(503,'backup_source_owner_mismatch');}}
function baseQuery(context){return '?select=*&profile_id=eq.'+context.profileId+'&user_id=eq.'+encodeURIComponent(context.userId);}
export async function handleOwnerBackupPagesRequest(request,env,context,now=Date.now()){
 const url=new URL(request.url);if(![BASE+'/manifest',BASE+'/page'].includes(url.pathname))return null;
 try{
  if(!UUID.test(context?.userId||'')||!['amir','arash'].includes(context?.profileId)||typeof context.rest!=='function')return json({error:'workspace_required'},403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)return json({error:'profile_access_denied'},403);
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  if(!env.GOOGLE_DB)return json({error:'backup_storage_not_configured'},503);
  const existing=await tables(env.GOOGLE_DB);
  if(url.pathname.endsWith('/manifest'))return json({format:'masir-owner-paged-export',version:2,profileId:context.profileId,generatedAt:new Date(now).toISOString(),collections:[...Object.keys(SUPABASE).map(table=>({id:'supabase.'+table,available:true})),...Object.keys(D1).map(table=>({id:'d1.'+table,available:existing.has(table)}))],exclusions,limits:{pageRows:PAGE_SIZE,pageBytes:MAX_BYTES,cursorMinutes:TTL/60000},coverage:{complete:false,atomicSnapshot:false,automaticCloudBackup:false,meaning:'all_pages_of_each_available_declared_collection_required; concurrent edits may require restart'},recovery});
  const collection=url.searchParams.get('collection'),item=descriptor(collection);if(!item)return json({error:'backup_collection_not_allowed'},400);
  if(item.source==='d1'&&!existing.has(item.table))return json({error:'backup_collection_unavailable'},404);
  const key=await signingKey(env),token=url.searchParams.get('cursor');let state=token?await cursor(token,key,context,collection,now):{version:1,owner:context.userId,profile:context.profileId,collection,started:now,exportId:crypto.randomUUID(),page:0,after:item.source==='d1'?0:'',maximum:null};
  let rows;
  if(item.source==='d1'){
   const own=scope(item,context);
   if(!token){const max=await env.GOOGLE_DB.prepare('SELECT max(rowid) AS highest FROM '+item.table+' WHERE '+own.sql).bind(...own.args).first();state.maximum=max?.highest||0;}
   if(!Number.isSafeInteger(state.maximum)||state.maximum<0||!Number.isSafeInteger(state.after)||state.after<0||state.after>state.maximum)fail(400,'invalid_backup_cursor');
   rows=(await env.GOOGLE_DB.prepare('SELECT rowid AS __backup_rowid,'+item.columns+' FROM '+item.table+' WHERE '+own.sql+' AND rowid>? AND rowid<=? ORDER BY rowid LIMIT ?').bind(...own.args,state.after,state.maximum,PAGE_SIZE+1).all()).results||[];
  }else{
   if(!token){const max=await context.rest(item.table,baseQuery(context)+'&order='+item.key+'.desc&limit=1');assertOwned(max,item,context);state.maximum=max[0]?.[item.key]||'';}
   if(typeof state.maximum!=='string'||state.maximum&&!SIMPLE.test(state.maximum)||typeof state.after!=='string'||state.after&&!SIMPLE.test(state.after))fail(400,'invalid_backup_cursor');
   rows=state.maximum?await context.rest(item.table,baseQuery(context)+'&order='+item.key+'.asc&'+item.key+'=lte.'+encodeURIComponent(state.maximum)+(state.after?'&'+item.key+'=gt.'+encodeURIComponent(state.after):'')+'&limit='+(PAGE_SIZE+1)):[];
  }
  if(!Array.isArray(rows)||rows.length>PAGE_SIZE+1)fail(503,'backup_invalid_source_rows');assertOwned(rows,item,context);
  const selected=[];let byteLength=0,last=state.after;
  for(const row of rows.slice(0,PAGE_SIZE)){
   const {__backup_rowid,...record}=row,bytes=utf8(JSON.stringify(record)).length;
   if(bytes>MAX_BYTES-8000)fail(413,'backup_record_too_large');
   if(byteLength+bytes>MAX_BYTES-8000)break;
   const position=item.source==='d1'?__backup_rowid:record[item.key];
   if(item.source==='d1'?!Number.isSafeInteger(position)||position<=last:!SIMPLE.test(position)||position<=last)fail(503,'backup_invalid_source_order');
   selected.push(record);byteLength+=bytes;last=position;
  }
  const collectionComplete=selected.length===rows.length,nextCursor=collectionComplete?null:await sign({...state,page:state.page+1,after:last},key);
  const payload={collection,exportId:state.exportId,page:state.page,rows:selected,collectionComplete};
  return json({format:'masir-owner-paged-export',version:2,profileId:context.profileId,startedAt:new Date(state.started).toISOString(),...payload,rowCount:selected.length,sha256:await digest(payload),nextCursor,coverage:{atomicSnapshot:false,fullBackupComplete:false,automaticCloudBackup:false},recovery});
 }catch(error){return json({error:error.status?error.message:'backup_page_export_failed'},error.status||503);}
}
