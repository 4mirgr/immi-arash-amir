// Authenticated owner export only. Provider grants/keys and received-mail caches are excluded.
const SUPABASE_TABLES=['immi_profiles','immi_settings','immi_cv_versions','immi_cv_defaults','immi_presets','immi_preset_defaults','immi_drafts'];
const PRIVATE_TABLES=['linkedin_sections','linkedin_drafts','linkedin_posts','linkedin_metrics','linkedin_contacts','linkedin_network_targets','linkedin_publish_attempts','roadmap_actions','pesci_practice_sessions','ai_assistant_runs','mail_automation_settings','mail_automation_jobs','mail_automation_suppressions','mail_automation_events','gp_workflow_settings','gp_opportunity_progress','clinic_bank_leads'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export async function handleOwnerBackupRequest(request,env,context){
 const url=new URL(request.url);if(url.pathname!=='/api/backup/export')return null;
 try{
  if(typeof context?.userId!=='string'||!context.userId||context.userId.includes(':')||!['amir','arash'].includes(context.profileId)||typeof context.rest!=='function')return json({error:'workspace_required'},403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)return json({error:'profile_access_denied'},403);
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const collections={supabase:{},d1:{}},truncatedTables=[];
  const query='?select=*&profile_id=eq.'+context.profileId+'&user_id=eq.'+encodeURIComponent(context.userId)+'&limit=101';
  for(const table of SUPABASE_TABLES){const rows=await context.rest(table,query);if(!Array.isArray(rows))throw Error('invalid_export');collections.supabase[table]=rows.slice(0,100);if(rows.length>100)truncatedTables.push('supabase.'+table);}
  if(!env.GOOGLE_DB)return json({error:'backup_storage_not_configured'},503);
  const tables=new Set(((await env.GOOGLE_DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").bind().all()).results||[]).map(x=>x.name));
  for(const table of PRIVATE_TABLES){if(!tables.has(table))continue;const rows=(await env.GOOGLE_DB.prepare('SELECT * FROM '+table+' WHERE owner_id=? LIMIT 101').bind(context.userId).all()).results||[];collections.d1[table]=rows.slice(0,100);if(rows.length>100)truncatedTables.push('d1.'+table);}
  const mailOwners=[context.userId,context.userId+':secondary'];
  for(const table of ['google_send_queue','google_send_suppressions']){if(!tables.has(table))continue;const columns=table==='google_send_queue'?'id,owner_id,profile_id,google_subject,google_email,fingerprint,recipient,subject,cv_version_id,attachment_name,reply_thread_id,status,created_at,created_day,attempt_day,attempted_at,gmail_message_id':'owner_id,email,created_at';const rows=(await env.GOOGLE_DB.prepare('SELECT '+columns+' FROM '+table+' WHERE owner_id IN (?,?) LIMIT 101').bind(...mailOwners).all()).results||[];collections.d1[table]=rows.slice(0,100);if(rows.length>100)truncatedTables.push('d1.'+table);}
  const data={format:'masir-owner-export',version:1,profileId:context.profileId,createdAt:new Date().toISOString(),credentialsIncluded:false,providerReconnectRequired:true,scheduledApprovalsExcluded:true,collections,coverage:{truncatedTables,includesReceivedMailBodies:false,includesMailDrafts:true,limits:{recordsPerTable:100,totalBytes:2000000},automaticCloudBackup:false}};
  if(new TextEncoder().encode(JSON.stringify(data)).length>2000000)return json({error:'backup_export_too_large_use_operator_workflow'},413);
  return json(data);
 }catch{return json({error:'owner_backup_export_failed'},500);}
}
