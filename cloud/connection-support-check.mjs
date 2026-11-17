// Operator-enabled, read-only diagnosis for the reported Arash workspace.
// No token leaves this Worker, no test message is sent, and no public route is
// added. The operator removes the flag after collecting this one-run receipt.
import {verifyGoogleConnection} from './google-oauth.mjs';
import {verifyTelegramConnection} from './telegram-notifications.mjs';
import {checkAutomationMembership} from './automation-membership.mjs';
export const CONNECTION_SUPPORT_VERSION='arash-20261117-v1';
const safe=value=>typeof value==='string'&&/^[a-z0-9_/-]{1,100}$/.test(value)?value:null;
function receipt(result){
 const checks={};for(const [key,value] of Object.entries(result?.serviceChecks||{}))if(/^[A-Za-z]{1,20}$/.test(key))checks[key]={state:safe(value.state),code:safe(value.code)};
 return {state:safe(result?.verification?.state)||'temporary_failure',code:safe(result?.verification?.code),recoveryAction:safe(result?.verification?.recoveryAction),services:checks};
}
export async function runConnectionSupportCheck(env,{fetcher=fetch,membership=checkAutomationMembership,google=verifyGoogleConnection,telegram=verifyTelegramConnection,now=Date.now()}={}){
 if(env.CONNECTION_SUPPORT_CHECK!==CONNECTION_SUPPORT_VERSION||!env.GOOGLE_DB)return{attempted:false,status:'disabled'};
 const db=env.GOOGLE_DB;
 const rows=(await db.prepare("SELECT owner_id FROM google_accounts WHERE profile_id='arash' AND owner_id NOT LIKE '%:%' LIMIT 2").all()).results||[];
 if(rows.length!==1||!/^[a-f0-9-]{36}$/i.test(rows[0].owner_id))return{attempted:false,status:'owner_not_unambiguous'};
 const owner=rows[0].owner_id,id='support_'+CONNECTION_SUPPORT_VERSION+'_'+owner;
 if(await db.prepare('SELECT id FROM google_oauth_diagnostics WHERE id=?').bind(id).first())return{attempted:false,status:'already_recorded'};
 if(!(await membership(env,owner,'arash',fetcher))?.active)return{attempted:false,status:'membership_check_unavailable'};
 const claim=await db.prepare("INSERT INTO google_oauth_diagnostics(id,owner_id,stage,code,created_at) VALUES(?,?,'refresh_grant','support_check_running',?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(id,owner,now).first();
 if(!claim)return{attempted:false,status:'already_claimed'};
 const results={version:CONNECTION_SUPPORT_VERSION};
 for(const [name,probe] of [['google',google],['telegram',telegram]]){
  try{results[name]=receipt(await probe(env,owner,'arash',fetcher));}
  catch{results[name]={state:'temporary_failure',code:'support_provider_unavailable'};}
 }
 await db.prepare('UPDATE google_oauth_diagnostics SET code=?,created_at=? WHERE id=? AND owner_id=?').bind(JSON.stringify(results),now,id,owner).run();
 return{attempted:true,status:'recorded'};
}
