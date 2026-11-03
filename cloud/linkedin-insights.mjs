// LinkedIn analytics are permission-gated; imported/manual measurements never become live data.
import {decryptGoogleSecret} from './google-oauth.mjs';
import {linkedInConnectionStatus} from './linkedin-oauth.mjs';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const FIELDS=['connections','followers','profileViews','searchAppearances'];
const FOLLOWER_URL='https://api.linkedin.com/rest/memberFollowersCount?q=me';
const checkedAt='2026-11-03';
export const LINKEDIN_ACCESS_EVIDENCE={checkedAt,profileAnalytics:{scope:'r_member_profileAnalytics',product:'Community Management API',approvalRequired:true},postAnalytics:{scope:'r_member_postAnalytics',product:'Community Management API',approvalRequired:true},connections:{scope:'r_1st_connections',approvalRequired:true,secondDegreeBrowsing:false},sources:['https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/follower-statistics?view=li-lms-2026-10','https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-10','https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/connections-api']};
function parse(value,fallback){try{return JSON.parse(value);}catch{return fallback;}}
export function metricTrends(rows){
 return FIELDS.map(field=>{
  const points=rows.filter(r=>Number.isSafeInteger(r[field])&&r[field]>=0&&Number.isFinite(Date.parse(r.asOf))).map(r=>({asOf:r.asOf,value:r[field],source:r.source})).sort((a,b)=>Date.parse(a.asOf)-Date.parse(b.asOf));
  const latest=points.at(-1),previous=points.at(-2);return {field,points,latest:latest?.value??null,delta:latest&&previous?latest.value-previous.value:null,asOf:latest?.asOf||null,source:latest?.source||null};
 });
}
async function followerJson(response){
 if(Number(response.headers.get('content-length')||0)>65536)throw Error('invalid_response');const reader=response.body?.getReader();if(!reader)throw Error('invalid_response');const chunks=[];let length=0;for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>65536){await reader.cancel();throw Error('invalid_response');}chunks.push(value);}const raw=new Uint8Array(length);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}const data=JSON.parse(new TextDecoder().decode(raw));const value=data?.elements?.[0]?.memberFollowersCount;if(data?.elements?.length!==1||!Number.isSafeInteger(value)||value<0||value>1000000000)throw Error('invalid_response');return value;
}
async function providerFollowers(env,owner,row,fetcher){
 const now=Date.now();
 const cached=await stmt(env.GOOGLE_DB,'SELECT * FROM linkedin_insight_snapshots WHERE owner_id=? AND linkedin_sub=? ORDER BY measured_at DESC LIMIT 1',owner,row.linkedin_sub).first();
 if(cached&&now-cached.measured_at<1800000)return {status:'cached_provider',point:{asOf:new Date(cached.measured_at).toISOString(),followers:cached.followers,source:'linkedin_api'},cacheAgeSeconds:Math.floor((now-cached.measured_at)/1000)};
 // Persist a short, owner+subject specific claim. A failed request must not spin on every render.
 const lease=await stmt(env.GOOGLE_DB,'INSERT INTO linkedin_insight_checks(owner_id,linkedin_sub,next_check_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET linkedin_sub=excluded.linkedin_sub,next_check_at=excluded.next_check_at WHERE linkedin_insight_checks.linkedin_sub<>excluded.linkedin_sub OR linkedin_insight_checks.next_check_at<=? RETURNING owner_id',owner,row.linkedin_sub,now+1800000,now).first();
 if(!lease)return {status:'cooldown',point:cached?{asOf:new Date(cached.measured_at).toISOString(),followers:cached.followers,source:'linkedin_api'}:null};
 try{
  const tokens=await decryptGoogleSecret(env,'linkedin:'+owner,row.token_cipher);if(typeof tokens.access_token!=='string'||!tokens.access_token)throw Error('reconnect_required');
  const response=await fetcher(FOLLOWER_URL,{headers:{Authorization:'Bearer '+tokens.access_token,'LinkedIn-Version':'202610','X-Restli-Protocol-Version':'2.0.0'},redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(!response.ok)return {status:response.status===401?'reconnect_required':response.status===403?'provider_access_denied':'provider_unavailable',point:null};
  const followers=await followerJson(response);
  const current=await stmt(env.GOOGLE_DB,'SELECT linkedin_sub,status,token_cipher FROM linkedin_accounts WHERE owner_id=?',owner).first();if(!current||current.status!=='connected'||current.linkedin_sub!==row.linkedin_sub||current.token_cipher!==row.token_cipher)return {status:'connection_changed',point:null};
  await stmt(env.GOOGLE_DB,'INSERT INTO linkedin_insight_snapshots(owner_id,linkedin_sub,measured_at,followers) VALUES(?,?,?,?)',owner,row.linkedin_sub,now,followers).run();
  await stmt(env.GOOGLE_DB,'DELETE FROM linkedin_insight_snapshots WHERE owner_id=? AND (linkedin_sub<>? OR measured_at<?)',owner,row.linkedin_sub,now-90*86400000).run();
  return {status:'live_provider',point:{asOf:new Date(now).toISOString(),followers,source:'linkedin_api'}};
 }catch{return {status:'provider_unavailable',point:null};}
}
export async function handleLinkedInInsightsRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url);if(url.pathname!=='/api/linkedin/insights')return null;
 try{
  if(!context?.userId||!['amir','arash'].includes(context.profileId))return json({error:'workspace_required'},403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)return json({error:'profile_access_denied'},403);
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  if(!env.GOOGLE_DB)return json({error:'linkedin_storage_not_configured'},503);
  const owner=context.userId;
  const manualRows=(await stmt(env.GOOGLE_DB,'SELECT as_of,data FROM linkedin_metrics WHERE owner_id=? ORDER BY as_of DESC LIMIT 100',owner).all()).results||[];
  const manual=manualRows.map(r=>({...parse(r.data,{}),asOf:r.as_of,source:'manual'}));
  const contactRows=(await stmt(env.GOOGLE_DB,'SELECT json_extract(data,\'$.status\') AS status,COUNT(*) AS n FROM linkedin_contacts WHERE owner_id=? GROUP BY json_extract(data,\'$.status\')',owner).all()).results||[];
  const connection=await linkedInConnectionStatus(env,owner),row=await stmt(env.GOOGLE_DB,'SELECT * FROM linkedin_accounts WHERE owner_id=?',owner).first();
  const scopes=parse(row?.scopes_json||'[]',[]),canRead=connection.connected&&scopes.includes('r_member_profileAnalytics');
  let provider={status:connection.connected?'additional_approval_required':'connection_required',point:null};let providerRows=[];
  if(canRead){provider=await providerFollowers(env,owner,row,fetcher);if(provider.status!=='connection_changed')providerRows=(await stmt(env.GOOGLE_DB,'SELECT measured_at,followers FROM linkedin_insight_snapshots WHERE owner_id=? AND linkedin_sub=? ORDER BY measured_at DESC LIMIT 100',owner,row.linkedin_sub).all()).results.map(r=>({asOf:new Date(r.measured_at).toISOString(),followers:r.followers,source:'linkedin_api'}));}
  return json({profileId:context.profileId,checkedAt,connection:{connected:connection.connected,name:connection.name||null},provider,manualTrends:metricTrends(manual),providerTrends:metricTrends(providerRows),workflow:{source:'private_workspace_records',totalContacts:contactRows.reduce((n,r)=>n+r.n,0),stages:contactRows.map(r=>({status:r.status,count:r.n})),liveLinkedInGraph:false},capabilities:{liveFollowerRead:canRead&&['live_provider','cached_provider'].includes(provider.status),allProfileAnalytics:false,postAnalytics:false,connectionsSync:false,automaticInvitations:false},accessEvidence:LINKEDIN_ACCESS_EVIDENCE,limitations:['ورود با LinkedIn و مجوز انتشار، دسترسی آمار یا کانکشن‌ها ایجاد نمی‌کند.','نمودارهای دادهٔ دستی از نمودارهای دریافتی API جدا نگه داشته می‌شوند.','نمودار ارتباطات هدف از وضعیت‌های ثبت‌شده در همین پنل است، نه گراف زندهٔ LinkedIn.']});
 }catch{return json({error:'linkedin_insights_failed'},500);}
}
