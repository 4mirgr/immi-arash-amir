// Read-only private Gmail work shares only a positively idle mail invocation.
// Public discovery retains its own cadence and no transport is retried here.
import {dispatchScheduledMail} from './mail-automation-scheduler.mjs';
import {checkAutomationMembership} from './automation-membership.mjs';
import {syncClinicCorrespondence} from './google-mail-correspondence-reader.mjs';
import {recordClinicCorrespondenceStops} from './clinic-correspondence.mjs';

const OWNER=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::secondary)?$/i;
const safeCode=error=>/^[a-z_]{3,80}$/.test(error?.code||'')?error.code:'correspondence_temporarily_unavailable';
const safeReceipt=result=>Object.fromEntries(Object.entries(result||{}).filter(([key,value])=>/^[a-zA-Z]{1,40}$/.test(key)&&(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^[a-z0-9_:-]{1,100}$/.test(value))));

export async function dispatchClinicCorrespondence(env,{fetcher=fetch,now=Date.now(),membership=checkAutomationMembership,sync=syncClinicCorrespondence,recordStops=recordClinicCorrespondenceStops}={}){
 if(env.MAIL_CORRESPONDENCE_ENABLED!=='true'||!env.GOOGLE_DB)return {attempted:false,status:'disabled'};
 if(!Number.isFinite(now))return {attempted:false,status:'invalid_scheduled_time'};
 const db=env.GOOGLE_DB;
 const account=await db.prepare("SELECT a.owner_id,a.profile_id,a.google_sub FROM google_accounts a LEFT JOIN google_mail_correspondence_activity c ON c.owner_id=a.owner_id AND c.google_sub=a.google_sub WHERE a.profile_id='arash' AND a.status='connected' AND coalesce(c.checked_at,0)<? ORDER BY coalesce(c.checked_at,0),a.owner_id LIMIT 1").bind(now-180000).first();
 if(!account)return {attempted:false,status:'idle'};
 if(!OWNER.test(account.owner_id)||account.profile_id!=='arash')return {attempted:false,status:'owner_invalid'};
 const root=account.owner_id.split(':')[0],mailbox=account.owner_id.endsWith(':secondary')?'secondary':'primary';
 const claimed=await db.prepare("INSERT INTO google_mail_correspondence_activity(owner_id,google_sub,checked_at,status,receipt_json) VALUES(?,?,?,'running','{}') ON CONFLICT(owner_id,google_sub) DO UPDATE SET checked_at=excluded.checked_at,status='running',code=NULL,receipt_json='{}' WHERE google_mail_correspondence_activity.checked_at<? RETURNING owner_id").bind(account.owner_id,account.google_sub,now,now-180000).first();
 if(!claimed)return {attempted:false,status:'already_running'};
 let result;
 try{
  const checked=await membership(env,root,account.profile_id,fetcher);
  if(checked?.active!==true)result={attempted:false,status:'blocked',code:checked?.reason==='owner_inactive'?'owner_inactive':'membership_check_unavailable'};
  else{
   const context={userId:account.owner_id,rootUserId:root,profileId:account.profile_id,mailbox};
   result={attempted:true,...safeReceipt(await sync(env,context,fetcher,{now}))};
   const stops=await recordStops(env,context);result.recordedStops=Number(stops?.recorded)||0;
  }
 }catch(error){result={attempted:true,status:'blocked',code:safeCode(error)};}
 await db.prepare('UPDATE google_mail_correspondence_activity SET status=?,code=?,receipt_json=? WHERE owner_id=? AND google_sub=? AND checked_at=?').bind(result.status||'read',result.code||null,JSON.stringify(safeReceipt(result)),account.owner_id,account.google_sub,now).run();
 return result;
}

export async function runCorrespondenceMailCycle(env,{fetcher=fetch,now=Date.now(),transport=dispatchScheduledMail,reading=dispatchClinicCorrespondence}={}){
 let mail;
 try{mail=await transport(env,fetcher,{reportIdle:true});}
 catch{return {mail:{status:'outcome_unknown_no_retry'},correspondence:{status:'deferred_transport'}};}
 if(mail?.enabled!==true||mail?.attempted!==0||mail?.idle!==true)return {mail,correspondence:{status:'deferred_transport'}};
 try{return {mail,correspondence:await reading(env,{fetcher,now})};}
 catch{return {mail,correspondence:{status:'temporarily_unavailable'}};}
}
