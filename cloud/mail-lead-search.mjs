// Optional fixed-host Tavily adapter. Search snippets never become evidence.
// Account usage must prove the free plan with pay-as-you-go disabled before a
// basic search. No arbitrary proxy URL, private mail text or CV is accepted.
import {inferMailLeadEmployerName,isSpecificMailClinicName,mailLeadPublicURL,normalizeMailClinicName} from './mail-lead-discovery.mjs';
import {normalizeMailPublicJobLead,publicGPAttributeSearchQuery} from './mail-public-job-headline.mjs';

const DAY=86400000,CACHE_MS=7*DAY,HTTP_TIMEOUT=8000,MAX_JSON_BYTES=256000;
export const MAIL_LEAD_SEARCH_DAILY_LIMIT=20;
export const MAIL_SEARCH_BILLING_PROOF_PROTOCOL='billing-proof-v2';
const ROOT=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const BILLING_GATE_SOURCE='https://docs.tavily.com/documentation/api-reference/endpoint/logs';
const FREE_LOG_DENIAL='Access denied. Usage logs are only available to paying customers. Please upgrade your plan to access this feature.';
const clean=(value,max=300)=>typeof value==='string'?value.replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
const parseArray=value=>{try{const out=JSON.parse(value);return Array.isArray(out)?out:[];}catch{return [];}};
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');

function searchContext(candidate){
 const name=inferMailLeadEmployerName({clinicName:candidate?.clinicName}),jobLead=normalizeMailPublicJobLead(candidate?.publicJobLead),unknownHeadline=!clean(candidate?.clinicName,180);
 // A typed headline with no separately named clinic must always use only the
 // fixed attribute vocabulary. Its free text cannot become an inferred name.
 if(!unknownHeadline&&isSpecificMailClinicName(name)&&name.length<=180&&!/https?:|@|\b\d{5,}\b|ignore.{0,50}instructions?|password|api[ _-]?key|system prompt/i.test(name))return {mode:'employer_name',name,jobLead:null,query:'"'+name.replace(/["\\]/g,'')+'" Australia general practitioner clinic official website careers'};
 const query=publicGPAttributeSearchQuery(jobLead);return query?{mode:'public_gp_attributes',name:'',jobLead,query}:null;
}
export function mailEmployerSearchQuery(candidate){return searchContext(candidate)?.query||null;}
export function mailEmployerSearchName(candidate){return searchContext(candidate)?.name||'';}
export function inspectTavilyFreePlan(usage){
 const account=usage?.account,key=usage?.key,fields={plan:account?.current_plan,planLimit:account?.plan_limit,planUsage:account?.plan_usage,paygoLimit:account?.paygo_limit,paygoUsage:account?.paygo_usage,keyLimit:key?.limit,keyUsage:key?.usage};
 const type=value=>value===undefined?'missing':value===null?'null':Array.isArray(value)?'array':typeof value;
 const number=value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000000?value:null;
 const plans=new Map(['researcher','free','project','bootstrap','startup','growth','enterprise','pay-as-you-go','pay as you go'].map(plan=>[plan,plan]));
 const summary={allowed:false,reason:null,plan:typeof fields.plan==='string'?plans.get(fields.plan.trim().toLowerCase())||'unrecognized':null,...Object.fromEntries(Object.entries(fields).filter(([name])=>name!=='plan').map(([name,value])=>[name,number(value)])),fieldTypes:Object.fromEntries(Object.entries(fields).map(([name,value])=>[name,type(value)])),missing:Object.keys(fields).filter(name=>fields[name]===undefined)};
 // A missing/null PAYG limit never proves that it is disabled. Keep the
 // original free-only guard while exposing only allowlisted plan diagnostics.
 const reason=!['researcher','free'].includes(summary.plan)?'free_plan_required':
  !Number.isSafeInteger(fields.planLimit)||fields.planLimit<=0||fields.planLimit>1000?'free_plan_limit_unconfirmed':
  !Number.isSafeInteger(fields.planUsage)||fields.planUsage<0?'free_plan_usage_unconfirmed':fields.planUsage>=fields.planLimit?'free_plan_credits_exhausted':
  fields.paygoLimit!==0?'paygo_limit_unconfirmed_or_enabled':fields.paygoUsage!==0?'paygo_usage_unconfirmed_or_present':
  !Number.isSafeInteger(fields.keyUsage)||fields.keyUsage<0?'key_usage_unconfirmed':
  fields.keyLimit!==null&&(!Number.isSafeInteger(fields.keyLimit)||fields.keyLimit<=0||fields.keyLimit>1000)?'key_limit_unconfirmed':
  fields.keyLimit!==null&&fields.keyUsage>=fields.keyLimit?'key_credits_exhausted':null;
 return {...summary,allowed:reason===null,reason:reason||'free_plan_confirmed'};
}
export function tavilyFreeSearchAllowed(usage){return inspectTavilyFreePlan(usage).allowed;}
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
/** Internal preflight. Fixed /usage GET plus the documented read-only paid
 * entitlement gate for the null case; no search, storage or logs returned. */
function nullLimitNeedsIndependentProof(usage,summary){
 const account=usage?.account,key=usage?.key;
 return Boolean(['researcher','free'].includes(summary.plan)&&account?.paygo_limit===null&&account.paygo_usage===0&&Number.isSafeInteger(account.plan_limit)&&account.plan_limit>0&&account.plan_limit<=1000&&Number.isSafeInteger(account.plan_usage)&&account.plan_usage>=0&&account.plan_usage<account.plan_limit&&Number.isSafeInteger(key?.usage)&&key.usage>=0&&(key.limit===null||Number.isSafeInteger(key.limit)&&key.limit>0&&key.limit<=1000&&key.usage<key.limit));
}
async function nonpayingBillingGate(env,{fetcher,budget}={}){
 const proof=(value,httpStatus=null)=>({proof:value,httpStatus,source:BILLING_GATE_SOURCE});
 if(budget&&budget.remaining<1)return proof('unconfirmed');
 if(budget)budget.remaining--;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),HTTP_TIMEOUT);
 try{
  const response=await fetcher('https://api.tavily.com/logs',{method:'POST',headers:{Authorization:'Bearer '+env.TAVILY_API_KEY,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({limit:1,filter_by_api_key:true}),redirect:'manual',signal:controller.signal});
  const discard=async()=>{try{await response.body?.cancel();}catch{}};
  if(response.status===200){await discard();return proof('paid_or_paygo',200);}
  if(response.status!==403||!/application\/json/i.test(response.headers.get('content-type')||'')){await discard();return proof('unconfirmed',Number.isInteger(response.status)?response.status:null);}
  // Inspect only a small documented error response. A successful logs body is
  // never read: it may contain masked keys and account-wide request metadata.
  const reader=response.body?.getReader();if(!reader)return proof('unconfirmed',403);
  const parts=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>4096){await reader.cancel();return proof('unconfirmed',403);}parts.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  let error;try{error=JSON.parse(new TextDecoder().decode(bytes))?.detail?.error;}catch{return proof('unconfirmed',403);}
  return typeof error==='string'&&error.replace(/\s+/g,' ').trim()===FREE_LOG_DENIAL?proof('free_no_paygo',403):proof('unconfirmed',403);
 }catch{return proof('unconfirmed');}finally{clearTimeout(timer);}
}
export async function checkConfiguredTavilyPlan(env,{fetcher=fetch,budget,reserveAfterCheck=0}={}){
 const unavailable=reason=>({...inspectTavilyFreePlan(null),reason});
 if(typeof env.TAVILY_API_KEY!=='string'||env.TAVILY_API_KEY.length<12||env.TAVILY_API_KEY.length>300)return unavailable('search_not_configured');
 try{
  const usage=await providerJSON(fetcher,'https://api.tavily.com/usage',{method:'GET',headers:{Authorization:'Bearer '+env.TAVILY_API_KEY,Accept:'application/json'}},budget),summary=inspectTavilyFreePlan(usage);
  if(summary.allowed||!nullLimitNeedsIndependentProof(usage,summary))return summary;
  // A search needs its own request plus two actual public-document requests
  // after this check. Operator preflight reserves zero and needs budget two.
  if(budget&&budget.remaining<1+Math.max(0,reserveAfterCheck))return {...summary,reason:'billing_probe_request_budget_exhausted',billingGate:{proof:'unconfirmed',httpStatus:null,source:BILLING_GATE_SOURCE}};
  const billingGate=await nonpayingBillingGate(env,{fetcher,budget});
  return {...summary,allowed:billingGate.proof==='free_no_paygo',reason:billingGate.proof==='free_no_paygo'?'free_plan_confirmed_by_billing_gate':summary.reason,billingGate};
 }
 catch(error){return unavailable(/^[a-z_]{3,80}$/.test(error?.code||'')?error.code:'search_provider_unavailable');}
}
function searchCandidates(payload,name,now,jobLead=null){
 const target=normalizeMailClinicName(name),out=[],seen=new Set();
 for(const item of Array.isArray(payload?.results)?payload.results.slice(0,8):[]){
  const url=mailLeadPublicURL(item?.url),title=clean(item?.title,300);if(!url||seen.has(url))continue;
  // The title is a relevance hint, never a quote or verified employer fact.
  const named=(' '+normalizeMailClinicName(title)+' ').includes(' '+target+' '),role=/\b(?:GP|general practitioner|careers?|recruitment|jobs?|role|position)\b/i.test(title+' '+new URL(url).pathname.replace(/[-_/]+/g,' '));
  if(jobLead){const gp=/\b(?:GP|general practitioner|general practice|rural generalist)\b/i.test(title);if(!gp||/\b(?:nurse|receptionist|dentist|practice manager)\b/i.test(title))continue;}
  else if(!named)continue;
  seen.add(url);out.push({url,clinicName:name,title,discoveryMethod:jobLead?'tavily_gp_attributes_search':'tavily_basic_search',checkedAt:new Date(now).toISOString(),status:'discovered_not_read',rank:role?0:1});
 }
 return out.sort((a,b)=>a.rank-b.rank).slice(0,3).map(({rank,...item})=>item);
}

export async function discoverMailEmployerSearch(env,context,candidate,{fetcher=fetch,now=Date.now(),budget}={}){
 const empty=status=>({status,candidates:[],searchRequests:0});
 if(env.MAIL_LEAD_SEARCH_ENABLED!=='true'||typeof env.TAVILY_API_KEY!=='string'||env.TAVILY_API_KEY.length<12||env.TAVILY_API_KEY.length>300)return empty('search_not_configured');
 if(!Number.isSafeInteger(now)||now<0||!ROOT.test(context?.rootUserId||'')||context.profileId!=='arash'||![context.rootUserId,context.rootUserId+':secondary'].includes(context.userId))return empty('search_owner_invalid');
 const contextQuery=searchContext(candidate),query=contextQuery?.query;if(!query)return empty('public_employer_name_required');
 if(!env.GOOGLE_DB)return empty('search_storage_required');
 const db=env.GOOGLE_DB,exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='private_mail_lead_searches'").bind().first();if(!exists)return empty('search_storage_required');
 const queryHash=await hash(query),cached=await db.prepare("SELECT result_json FROM private_mail_lead_searches WHERE owner_id=? AND query_hash=? AND status='searched' AND requested_at>=? AND requested_at<=? ORDER BY requested_at DESC LIMIT 1").bind(context.rootUserId,queryHash,now-CACHE_MS,now).first();
 if(cached)return {status:'cached_search_hints',candidates:parseArray(cached.result_json),searchRequests:0,mode:contextQuery.mode};
 if(budget&&budget.remaining<4)return empty('search_request_budget_exhausted');
 // A fixed protocol revision permits one retry of a pre-proof blocked query;
 // old receipts still consume the same global daily allowance. Cache identity
 // deliberately stays unchanged, so successful old searches are never charged.
 const day=Math.floor(now/DAY)*DAY,id='mls_'+(await hash(context.rootUserId+'\n'+queryHash+'\n'+day+'\n'+MAIL_SEARCH_BILLING_PROOF_PROTOCOL)).slice(0,32);
 const reserved=await db.prepare(`INSERT INTO private_mail_lead_searches(id,owner_id,query_hash,requested_at)
  SELECT ?,?,?,? WHERE (SELECT count(*) FROM private_mail_lead_searches WHERE requested_at>=? AND requested_at<?)<?
  AND EXISTS(SELECT 1 FROM google_accounts g WHERE g.owner_id=? AND g.google_sub=? AND g.profile_id='arash' AND g.status='connected') ON CONFLICT(id) DO NOTHING RETURNING id`).bind(id,context.rootUserId,queryHash,now,day,day+DAY,MAIL_LEAD_SEARCH_DAILY_LIMIT,context.userId,context.googleSubject).first();
 if(!reserved){const prior=await db.prepare('SELECT status,error_code FROM private_mail_lead_searches WHERE id=? AND owner_id=?').bind(id,context.rootUserId).first();return prior?{...empty('search_query_already_reserved'),previousStatus:['reserved','blocked','failed','searched'].includes(prior.status)?prior.status:'unknown',previousErrorCode:/^[a-z_]{3,80}$/.test(prior.error_code||'')?prior.error_code:null}:empty('search_daily_limit_or_identity_changed');}
 let status='failed',code=null,candidates=[],searchRequests=0,planDiagnostic=null;
 try{
  const headers={Authorization:'Bearer '+env.TAVILY_API_KEY,'Accept':'application/json'};
  const plan=await checkConfiguredTavilyPlan(env,{fetcher,budget,reserveAfterCheck:3});
  if(plan.billingGate)planDiagnostic=plan;
  if(!plan.allowed){status='blocked';code=plan.reason==='billing_probe_request_budget_exhausted'?'search_request_budget_exhausted':/^(?:search_|request_budget_exhausted)/.test(plan.reason||'')?plan.reason:'free_plan_without_paygo_required';planDiagnostic=plan;}
  else{
   searchRequests=1;
   const result=await providerJSON(fetcher,'https://api.tavily.com/search',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({query,topic:'general',search_depth:'basic',auto_parameters:false,max_results:5,include_answer:false,include_raw_content:false,include_images:false,exclude_domains:['linkedin.com','facebook.com','instagram.com','x.com','twitter.com']})},budget);
   candidates=searchCandidates(result,contextQuery.name,now,contextQuery.jobLead);status='searched';
  }
 }catch(error){code=/^[a-z_]{3,80}$/.test(error?.code||'')?error.code:'search_provider_unavailable';}
 await db.prepare('UPDATE private_mail_lead_searches SET completed_at=?,status=?,result_json=?,error_code=? WHERE id=? AND owner_id=? AND status=\'reserved\'').bind(now,status,JSON.stringify(status==='searched'?candidates:planDiagnostic?{planDiagnostic}:candidates),code,id,context.rootUserId).run();
 return {status:code||status,candidates,searchRequests,mode:contextQuery.mode,...(planDiagnostic?{planDiagnostic}:{})};
}
