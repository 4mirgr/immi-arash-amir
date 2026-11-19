// Optional fixed-host Tavily adapter. Search snippets never become evidence.
// Account usage must prove the free plan with pay-as-you-go disabled before a
// basic search. No arbitrary proxy URL, private mail text or CV is accepted.
import {inferMailLeadEmployerName,isSpecificMailClinicName,mailLeadPublicURL,normalizeMailClinicName} from './mail-lead-discovery.mjs';

const DAY=86400000,CACHE_MS=7*DAY,HTTP_TIMEOUT=8000,MAX_JSON_BYTES=256000;
export const MAIL_LEAD_SEARCH_DAILY_LIMIT=20;
const ROOT=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clean=(value,max=300)=>typeof value==='string'?value.replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const parseArray=value=>{try{const out=JSON.parse(value);return Array.isArray(out)?out:[];}catch{return [];}};
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

export function mailEmployerSearchQuery(candidate){
 const name=inferMailLeadEmployerName(candidate);
 if(!isSpecificMailClinicName(name)||name.length>180||/https?:|@|\b\d{5,}\b|ignore.{0,50}instructions?|password|api[ _-]?key|system prompt/i.test(name))return null;
 return '"'+name.replace(/["\\]/g,'')+'" Australia general practitioner clinic official website careers';
}
export function tavilyFreeSearchAllowed(usage){
 const account=usage?.account,key=usage?.key;
 // An absent/null PAYG cap does not prove it is disabled. Unknown provider
 // contracts or plan labels fail closed until reviewed against official docs.
 return Boolean(account&&key&&/^(?:researcher|free)$/i.test(account.current_plan||'')&&Number.isSafeInteger(account.plan_limit)&&account.plan_limit>0&&account.plan_limit<=1000&&Number.isSafeInteger(account.plan_usage)&&account.plan_usage>=0&&account.plan_usage<account.plan_limit&&account.paygo_limit===0&&account.paygo_usage===0&&Number.isSafeInteger(key.usage)&&key.usage>=0&&(key.limit===null||Number.isSafeInteger(key.limit)&&key.limit>0&&key.limit<=1000&&key.usage<key.limit));
}
async function providerJSON(fetcher,url,init,budget){
 if(budget&&budget.remaining<1)throw Object.assign(Error('request_budget_exhausted'),{code:'request_budget_exhausted'});
 if(budget)budget.remaining--;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),HTTP_TIMEOUT);
 try{
  const response=await fetcher(url,{...init,redirect:'manual',signal:controller.signal});
  if(!response.ok)throw Object.assign(Error('search_provider_unavailable'),{code:response.status===401?'search_key_invalid':response.status===429?'search_provider_rate_limited':'search_provider_unavailable'});
  if(!/application\/json/i.test(response.headers.get('content-type')||''))throw Error('invalid_search_response');
  const reader=response.body?.getReader();if(!reader)throw Error('invalid_search_response');
  const chunks=[];let size=0;
  while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>MAX_JSON_BYTES){await reader.cancel();throw Error('invalid_search_response');}chunks.push(item.value);}
  const merged=new Uint8Array(size);let offset=0;for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(merged));
 }finally{clearTimeout(timer);}
}
function searchCandidates(payload,name,now){
 const target=normalizeMailClinicName(name),out=[],seen=new Set();
 for(const item of Array.isArray(payload?.results)?payload.results.slice(0,8):[]){
  const url=mailLeadPublicURL(item?.url),title=clean(item?.title,300);if(!url||seen.has(url))continue;
  // The title is a relevance hint, never a quote or verified employer fact.
  const named=(' '+normalizeMailClinicName(title)+' ').includes(' '+target+' '),role=/\b(?:GP|general practitioner|careers?|recruitment|jobs?|role|position)\b/i.test(title+' '+new URL(url).pathname.replace(/[-_/]+/g,' '));
  if(!named)continue;seen.add(url);out.push({url,clinicName:name,title,discoveryMethod:'tavily_basic_search',checkedAt:new Date(now).toISOString(),status:'discovered_not_read',rank:role?0:1});
 }
 return out.sort((a,b)=>a.rank-b.rank).slice(0,3).map(({rank,...item})=>item);
}

export async function discoverMailEmployerSearch(env,context,candidate,{fetcher=fetch,now=Date.now(),budget}={}){
 const empty=status=>({status,candidates:[],searchRequests:0});
 if(env.MAIL_LEAD_SEARCH_ENABLED!=='true'||typeof env.TAVILY_API_KEY!=='string'||env.TAVILY_API_KEY.length<12||env.TAVILY_API_KEY.length>300)return empty('search_not_configured');
 if(!Number.isSafeInteger(now)||now<0||!ROOT.test(context?.rootUserId||'')||context.profileId!=='arash'||![context.rootUserId,context.rootUserId+':secondary'].includes(context.userId))return empty('search_owner_invalid');
 const query=mailEmployerSearchQuery(candidate);if(!query)return empty('public_employer_name_required');
 if(!env.GOOGLE_DB)return empty('search_storage_required');
 const db=env.GOOGLE_DB,exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='private_mail_lead_searches'").bind().first();if(!exists)return empty('search_storage_required');
 const queryHash=await hash(query),cached=await db.prepare("SELECT result_json FROM private_mail_lead_searches WHERE owner_id=? AND query_hash=? AND status='searched' AND requested_at>=? AND requested_at<=? ORDER BY requested_at DESC LIMIT 1").bind(context.rootUserId,queryHash,now-CACHE_MS,now).first();
 if(cached)return {status:'cached_search_hints',candidates:parseArray(cached.result_json),searchRequests:0};
 if(budget&&budget.remaining<4)return empty('search_request_budget_exhausted');
 const day=Math.floor(now/DAY)*DAY,id='mls_'+(await hash(context.rootUserId+'\n'+queryHash+'\n'+day)).slice(0,32);
 const reserved=await db.prepare(`INSERT INTO private_mail_lead_searches(id,owner_id,query_hash,requested_at)
  SELECT ?,?,?,? WHERE (SELECT count(*) FROM private_mail_lead_searches WHERE requested_at>=? AND requested_at<?)<?
  AND EXISTS(SELECT 1 FROM google_accounts g WHERE g.owner_id=? AND g.google_sub=? AND g.profile_id='arash' AND g.status='connected') ON CONFLICT(id) DO NOTHING RETURNING id`).bind(id,context.rootUserId,queryHash,now,day,day+DAY,MAIL_LEAD_SEARCH_DAILY_LIMIT,context.userId,context.googleSubject).first();
 if(!reserved)return empty('search_daily_limit_or_identity_changed');
 let status='failed',code=null,candidates=[],searchRequests=0;
 try{
  const headers={Authorization:'Bearer '+env.TAVILY_API_KEY,'Accept':'application/json'};
  const usage=await providerJSON(fetcher,'https://api.tavily.com/usage',{method:'GET',headers},budget);
  if(!tavilyFreeSearchAllowed(usage)){status='blocked';code='free_plan_without_paygo_required';}
  else{
   searchRequests=1;
   const result=await providerJSON(fetcher,'https://api.tavily.com/search',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({query,topic:'general',search_depth:'basic',auto_parameters:false,max_results:5,include_answer:false,include_raw_content:false,include_images:false,exclude_domains:['linkedin.com','facebook.com','instagram.com','x.com','twitter.com']})},budget);
   candidates=searchCandidates(result,inferMailLeadEmployerName(candidate),now);status='searched';
  }
 }catch(error){code=/^[a-z_]{3,80}$/.test(error?.code||'')?error.code:'search_provider_unavailable';}
 await db.prepare('UPDATE private_mail_lead_searches SET completed_at=?,status=?,result_json=?,error_code=? WHERE id=? AND owner_id=? AND status=\'reserved\'').bind(now,status,JSON.stringify(candidates),code,id,context.rootUserId).run();
 return {status:code||status,candidates,searchRequests};
}
