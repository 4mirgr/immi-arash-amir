// Operator-enabled, one-off, read-only provider configuration check. No search,
// application or bot message is sent. Only an allowlisted plan summary is stored.
import {checkConfiguredTavilyPlan} from './mail-lead-search.mjs';
import {checkAutomationMembership} from './automation-membership.mjs';

export const MAIL_SEARCH_SUPPORT_VERSION='tavily-20261119-v1';
const ROOT=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const fields=['plan','planLimit','planUsage','paygoLimit','paygoUsage','keyLimit','keyUsage'];
function safeSummary(value){
 const summary={allowed:value?.allowed===true,reason:/^[a-z_]{3,100}$/.test(value?.reason||'')?value.reason:'plan_check_incomplete'};
 for(const key of fields){const item=value?.[key];if(key==='plan')summary[key]=typeof item==='string'&&/^[a-z0-9 _-]{1,40}$/i.test(item)?item:null;else summary[key]=Number.isSafeInteger(item)&&item>=0?item:null;}
 if(value?.fieldTypes&&typeof value.fieldTypes==='object')summary.fieldTypes=Object.fromEntries(fields.map(key=>[key,['number','string','null','undefined','missing','boolean','object','array'].includes(value.fieldTypes[key])?value.fieldTypes[key]:'unknown']));
 if(Array.isArray(value?.missing))summary.missing=value.missing.filter(key=>fields.includes(key)).slice(0,fields.length);
 return summary;
}

export async function runMailSearchSupportCheck(env,{fetcher=fetch,now=Date.now(),membership=checkAutomationMembership,checker=checkConfiguredTavilyPlan}={}){
 if(env.MAIL_SEARCH_SUPPORT_CHECK!==MAIL_SEARCH_SUPPORT_VERSION||!env.GOOGLE_DB)return {attempted:false,status:'disabled'};
 if(!Number.isSafeInteger(now)||now<0)return {attempted:false,status:'invalid_scheduled_time'};
 const db=env.GOOGLE_DB,rows=(await db.prepare("SELECT owner_id FROM google_accounts WHERE profile_id='arash' AND owner_id NOT LIKE '%:%' AND status='connected' LIMIT 2").all()).results||[];
 if(rows.length!==1||!ROOT.test(rows[0].owner_id||''))return {attempted:false,status:'owner_not_unambiguous'};
 const owner=rows[0].owner_id,hash=await digest(MAIL_SEARCH_SUPPORT_VERSION+'\n'+owner),id='mlp_'+hash.slice(0,32);
 if(await db.prepare('SELECT id FROM private_mail_lead_searches WHERE id=? AND owner_id=?').bind(id,owner).first())return {attempted:false,status:'already_recorded'};
 if(!(await membership(env,owner,'arash',fetcher))?.active)return {attempted:false,status:'membership_unavailable'};
 const claimed=await db.prepare("INSERT INTO private_mail_lead_searches(id,owner_id,query_hash,requested_at,status) VALUES(?,?,?,?,'plan_check_running') ON CONFLICT(id) DO NOTHING RETURNING id").bind(id,owner,hash,now).first();
 if(!claimed)return {attempted:false,status:'already_claimed'};
 let summary;try{summary=safeSummary(await checker(env,{fetcher,budget:{remaining:1}}));}catch{summary={allowed:false,reason:'plan_check_temporarily_unavailable'};}
 await db.prepare("UPDATE private_mail_lead_searches SET completed_at=?,status='plan_check',result_json=?,error_code=? WHERE id=? AND owner_id=? AND status='plan_check_running'").bind(now,JSON.stringify([{kind:'provider_plan_diagnostic',version:MAIL_SEARCH_SUPPORT_VERSION,...summary}]),summary.allowed?null:summary.reason,id,owner).run();
 return {attempted:true,status:'recorded'};
}
