// Owner-scoped operational controls. No provider transport or credential reads.
const BASE='/api/operations';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleOperationsRequest(request,env,context){
 const url=new URL(request.url);if(!url.pathname.startsWith(BASE+'/'))return null;
 try{
  if(typeof context?.userId!=='string'||!context.userId||context.userId.includes(':')||!['amir','arash'].includes(context.profileId))return json({error:'workspace_required'},403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)return json({error:'profile_access_denied'},403);
  if(!env.GOOGLE_DB)return json({error:'operations_storage_missing'},503);
  const db=env.GOOGLE_DB,id=context.userId;
  if(request.method==='GET'&&url.pathname===BASE+'/status'){
   const row=await db.prepare("SELECT (SELECT count(*) FROM linkedin_scheduled_approvals WHERE owner_id=? AND status='approved') AS linkedin_pending,(SELECT count(*) FROM mail_scheduled_approvals WHERE owner_id=? AND status='approved') AS mail_pending,(SELECT count(*) FROM linkedin_scheduled_approvals WHERE owner_id=? AND status='dispatching')+(SELECT count(*) FROM mail_scheduled_approvals WHERE owner_id=? AND status='sending') AS in_flight,(SELECT enabled FROM telegram_accounts WHERE owner_id=?) AS telegram_enabled").bind(id,id,id,id,id).first();
   return json({profileId:context.profileId,pending:{linkedin:row.linkedin_pending,mail:row.mail_pending},inFlight:row.in_flight,telegramEnabled:!!row.telegram_enabled,membershipGateConfigured:!!env.AUTOMATION_MEMBERSHIP_KEY,automaticCloudBackup:false});
  }
  if(request.method!=='POST'||url.pathname!==BASE+'/cancel-pending')return json({error:'not_found'},404);
  if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'origin_rejected'},403);
  const raw=await request.text();if(raw.length>200)return json({error:'invalid_confirmation'},400);
  let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid_confirmation'},400);}
  if(!body||Array.isArray(body)||Object.keys(body).length!==1||body.confirmCancel!==true)return json({error:'invalid_confirmation'},400);
  const at=Date.now();
  const result=await db.batch([
   db.prepare("UPDATE linkedin_scheduled_approvals SET status='cancelled',reason='owner_cancelled_pending',updated_at=? WHERE owner_id=? AND status='approved'").bind(at,id),
   db.prepare("UPDATE mail_scheduled_approvals SET status='cancelled',reason='owner_cancelled_pending',updated_at=? WHERE owner_id=? AND status='approved'").bind(at,id),
   db.prepare('UPDATE telegram_accounts SET enabled=0,updated_at=? WHERE owner_id=?').bind(at,id)
  ]);
  return json({profileId:context.profileId,cancelled:{linkedin:result[0]?.meta?.changes??null,mail:result[1]?.meta?.changes??null},telegramEnabled:false,alreadyInFlightMayComplete:true,manualQueuesChanged:false,providerMessagesSent:false});
 }catch{return json({error:'operations_request_failed'},500);}
}
