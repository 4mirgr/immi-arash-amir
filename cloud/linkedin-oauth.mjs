import {encryptGoogleSecret,decryptGoogleSecret} from './google-oauth.mjs';
const COOKIE='__Host-immi_linkedin_oauth';
const AUTH='https://www.linkedin.com/oauth/v2/authorization',TOKEN='https://www.linkedin.com/oauth/v2/accessToken',USER='https://api.linkedin.com/v2/userinfo';
const SCOPES=['openid','profile','email','w_member_social'];
const API_VERSION='202610',DAILY_LIMIT=5;
class LinkedInOAuthError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new LinkedInOAuthError(status,code);};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const bytes=s=>new TextEncoder().encode(s);
const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const hash=async s=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(s))));
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const owner=context=>{if(!context?.userId||!['arash','amir'].includes(context.profileId))fail(403,'workspace_required');return context.userId;};
function missing(env){return ['GOOGLE_DB','GOOGLE_TOKEN_KEY','LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET','LINKEDIN_REDIRECT_URI'].filter(x=>!env[x]);}
function config(env){if(missing(env).length)fail(503,'linkedin_setup_required');let u;try{u=new URL(env.LINKEDIN_REDIRECT_URI);}catch{}if(!u||u.protocol!=='https:'||u.pathname!=='/api/linkedin/callback'||u.search||u.hash||u.username||u.password)fail(503,'linkedin_setup_required');return u;}
async function boundedJson(response){if(Number(response.headers.get('content-length')||0)>65536)fail(502,'linkedin_invalid_response');const reader=response.body?.getReader();let text='';if(reader){let n=0;const decoder=new TextDecoder();for(;;){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>65536){await reader.cancel();fail(502,'linkedin_invalid_response');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}else text=await response.text();try{return JSON.parse(text);}catch{fail(502,'linkedin_invalid_response');}}
async function provider(fetcher,url,options,stage){let response;try{response=await fetcher(url,{...options,redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{fail(502,stage==='identity'?'linkedin_identity_unavailable':'linkedin_token_unavailable');}if(response.status>=300&&response.status<400){await response.body?.cancel();fail(502,'linkedin_redirect_rejected');}return response;}
const account=(env,id)=>stmt(env.GOOGLE_DB,'SELECT * FROM linkedin_accounts WHERE owner_id=?',id).first();
function capabilities(canPublish=false){return {liveAnalytics:false,directProfileEdit:false,connectionsSync:false,automaticPublishing:false,explicitPostPublishing:canPublish};}
export async function linkedInConnectionStatus(env,id){
 const absent=missing(env);if(absent.length)return {configured:false,connected:false,status:'setup_required',missing:absent,email:null,name:null,canPublish:false,capabilities:capabilities()};
 try{config(env);}catch{return {configured:false,connected:false,status:'setup_required',email:null,name:null,canPublish:false,capabilities:capabilities()};}
 const row=await account(env,id);const connected=row?.status==='connected'&&row.expires_at>Date.now()+30000;const scopes=row?JSON.parse(row.scopes_json):[];const canPublish=connected&&scopes.includes('w_member_social');
 return {configured:true,connected,status:row?(connected?'connected':'reconnect_required'):'not_connected',email:row?.email||null,name:row?.name||null,canPublish,expiresAt:row?new Date(row.expires_at).toISOString():null,capabilities:capabilities(canPublish)};
}
function finish(ok,code='linkedin_connection_failed'){
 const allowed=new Set(['linkedin_setup_required','invalid_state','browser_binding_missing','browser_binding_mismatch','authorization_denied','linkedin_token_rejected','linkedin_identity_invalid','linkedin_identity_in_use','linkedin_connection_failed','linkedin_unavailable','linkedin_token_unavailable','linkedin_identity_unavailable','linkedin_redirect_rejected','linkedin_client_rejected','linkedin_invalid_response']);
 const safe=allowed.has(code)?code:'linkedin_connection_failed';
 return new Response('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>LinkedIn</title><h1>'+(ok?'اتصال LinkedIn ثبت شد':'اتصال LinkedIn انجام نشد')+'</h1><p>به پنل اصلی برگردید و این پنجره را ببندید.</p>'+(ok?'':'<p>کد خطا: <code>'+safe+'</code></p>')+'</html>',{status:ok?200:400,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'Set-Cookie':COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'}});
}
export async function handleLinkedInOAuthCallback(request,env,fetcher=fetch){
 try{
  const cfg=config(env),url=new URL(request.url);if(request.method!=='GET'||url.origin!==cfg.origin||url.pathname!==cfg.pathname)fail(400,'invalid_state');
  const state=url.searchParams.get('state');if(!state||!/^[\w-]{43}$/.test(state))fail(400,'invalid_state');
  const binding=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim().split('=')).find(x=>x[0]===COOKIE)?.[1];if(!binding||!/^[\w-]{43}$/.test(binding))fail(400,'browser_binding_missing');
  const stateHash=await hash(state),row=await stmt(env.GOOGLE_DB,'SELECT * FROM linkedin_oauth_states WHERE state_hash=?',stateHash).first();
  if(!row||row.expires_at<=Date.now())fail(400,'invalid_state');if(row.browser_hash!==await hash(binding))fail(400,'browser_binding_mismatch');
  const consumed=await stmt(env.GOOGLE_DB,'DELETE FROM linkedin_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *',stateHash,row.browser_hash,Date.now()).first();if(!consumed)fail(400,'invalid_state');
  const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code||code.length>4096)fail(400,'authorization_denied');
  const response=await provider(fetcher,TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:cfg.href,client_id:env.LINKEDIN_CLIENT_ID,client_secret:env.LINKEDIN_CLIENT_SECRET}).toString()},'token');
  const grant=await boundedJson(response);if(!response.ok&&['invalid_client','invalid_client_id'].includes(grant.error))fail(400,'linkedin_client_rejected');if(!response.ok||typeof grant.access_token!=='string'||!grant.access_token||!Number.isFinite(Number(grant.expires_in))||Number(grant.expires_in)<=0)fail(400,'linkedin_token_rejected');
  const identityResponse=await provider(fetcher,USER,{headers:{Authorization:'Bearer '+grant.access_token}},'identity'),identity=await boundedJson(identityResponse);
  if(!identityResponse.ok||typeof identity.sub!=='string'||!/^[-A-Za-z0-9_]{1,255}$/.test(identity.sub))fail(400,'linkedin_identity_invalid');
  const duplicate=await stmt(env.GOOGLE_DB,'SELECT owner_id FROM linkedin_accounts WHERE linkedin_sub=? AND owner_id<>?',identity.sub,row.owner_id).first();if(duplicate)fail(409,'linkedin_identity_in_use');
  // Store actual returned scopes only. Missing scope never implicitly enables publication.
  const scopes=typeof grant.scope==='string'?[...new Set(grant.scope.split(/[ ,]+/).filter(Boolean))]:[];
  const cipher=await encryptGoogleSecret(env,'linkedin:'+row.owner_id,{access_token:grant.access_token});
  const name=typeof identity.name==='string'?identity.name.slice(0,200):'';
  const email=[true,'true'].includes(identity.email_verified)&&typeof identity.email==='string'?identity.email.slice(0,320):null;
  await stmt(env.GOOGLE_DB,"INSERT INTO linkedin_accounts(owner_id,profile_id,linkedin_sub,name,email,scopes_json,token_cipher,expires_at,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET profile_id=excluded.profile_id,linkedin_sub=excluded.linkedin_sub,name=excluded.name,email=excluded.email,scopes_json=excluded.scopes_json,token_cipher=excluded.token_cipher,expires_at=excluded.expires_at,status=excluded.status,updated_at=excluded.updated_at",row.owner_id,row.profile_id,identity.sub,name,email,JSON.stringify(scopes),cipher,Date.now()+Math.min(Number(grant.expires_in),90*86400)*1000,'connected',Date.now()).run();
  return finish(true);
 }catch(error){return finish(false,error instanceof LinkedInOAuthError?error.code:'linkedin_connection_failed');}
}
async function payload(request){if(Number(request.headers.get('content-length')||0)>2000)fail(413,'payload_too_large');const raw=await request.text();if(bytes(raw).length>2000)fail(413,'payload_too_large');let body;try{body=JSON.parse(raw);}catch{fail(400,'invalid_payload');}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'invalid_payload');return body;}
async function publish(request,env,id,fetcher){
 const input=await payload(request);if(Object.keys(input).some(x=>x!=='postId')||typeof input.postId!=='string'||!/^[-a-f0-9]{36}$/i.test(input.postId))fail(400,'post_id_required');
 const post=await stmt(env.GOOGLE_DB,'SELECT * FROM linkedin_posts WHERE owner_id=? AND id=?',id,input.postId).first();if(!post)fail(404,'post_not_found');if(post.status==='published_by_user')fail(409,'post_already_reported_published');
 const row=await account(env,id);if(!row||row.status!=='connected'||row.expires_at<=Date.now()+30000)fail(409,'linkedin_reconnect_required');if(!JSON.parse(row.scopes_json).includes('w_member_social'))fail(403,'linkedin_publish_scope_required');
 const tokens=await decryptGoogleSecret(env,'linkedin:'+id,row.token_cipher);
 if(typeof tokens.access_token!=='string'||!tokens.access_token)fail(409,'linkedin_reconnect_required');
 if(typeof post.text!=='string'||!post.text.trim()||post.text.length>3000)fail(400,'invalid_post_text');
 const digest=await hash(post.text),at=new Date().toISOString(),day=at.slice(0,10),attemptId=crypto.randomUUID();
 const claimed=await stmt(env.GOOGLE_DB,"INSERT INTO linkedin_publish_attempts(id,owner_id,post_id,author_sub,content_hash,status,created_at,created_day) SELECT ?,?,?,?,?,'sending',?,? WHERE (SELECT count(*) FROM linkedin_publish_attempts WHERE owner_id=? AND created_day=?)<? ON CONFLICT(owner_id,post_id) DO NOTHING RETURNING *",attemptId,id,post.id,row.linkedin_sub,digest,at,day,id,day,DAILY_LIMIT).first();
 if(!claimed){const previous=await stmt(env.GOOGLE_DB,'SELECT status,provider_urn,author_sub FROM linkedin_publish_attempts WHERE owner_id=? AND post_id=?',id,post.id).first();if(previous)return {postId:post.id,status:previous.status,providerUrn:previous.provider_urn||null,authorSubject:previous.author_sub,reused:true};fail(429,'linkedin_daily_limit');}
 // A local disconnect/relink between claim and transport must stop publication.
 const current=await account(env,id);if(!current||current.status!=='connected'||current.linkedin_sub!==row.linkedin_sub||current.token_cipher!==row.token_cipher){await stmt(env.GOOGLE_DB,"UPDATE linkedin_publish_attempts SET status='failed' WHERE id=? AND owner_id=?",attemptId,id).run();fail(409,'linkedin_connection_changed');}
 let status='delivery_unknown',urn=null;
 try{
  const result=await fetcher('https://api.linkedin.com/rest/posts',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json','LinkedIn-Version':env.LINKEDIN_API_VERSION||API_VERSION,'X-Restli-Protocol-Version':'2.0.0'},body:JSON.stringify({author:'urn:li:person:'+row.linkedin_sub,commentary:post.text,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false}),signal:AbortSignal.timeout(20000),redirect:'manual'});
  const acknowledged=result.headers.get('x-restli-id');if(result.status===201&&acknowledged&&/^urn:li:(?:share|ugcPost):\d+$/.test(acknowledged)){status='published';urn=acknowledged;}else if(result.status>=400&&result.status<500)status='failed';
 }catch{/* Ambiguous acceptance is terminal; never retry automatically. */}
 try{await stmt(env.GOOGLE_DB,'UPDATE linkedin_publish_attempts SET status=?,provider_urn=? WHERE id=? AND owner_id=? AND status=?',status,urn,attemptId,id,'sending').run();}catch{status='delivery_unknown';}
 return {postId:post.id,status,providerUrn:urn,authorSubject:row.linkedin_sub,reused:false,automaticPublishing:false};
}
export async function handleLinkedInOAuthRequest(request,env,context,fetcher=fetch){
 const path=new URL(request.url).pathname;if(!['/api/linkedin/connection','/api/linkedin/connect','/api/linkedin/disconnect','/api/linkedin/publish','/api/linkedin/publications'].includes(path))return null;
 try{
  const id=owner(context),url=new URL(request.url);if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)fail(403,'profile_access_denied');if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail(403,'origin_rejected');
  if(path==='/api/linkedin/connection'&&request.method==='GET')return json(await linkedInConnectionStatus(env,id));
  if(path==='/api/linkedin/publications'&&request.method==='GET'){if(!env.GOOGLE_DB)fail(503,'linkedin_setup_required');const rows=await stmt(env.GOOGLE_DB,'SELECT post_id,status,provider_urn,created_at,author_sub FROM linkedin_publish_attempts WHERE owner_id=? ORDER BY created_at DESC LIMIT 100',id).all();return json({publications:rows.results.map(r=>({postId:r.post_id,status:r.status,providerUrn:r.provider_urn||null,createdAt:r.created_at,authorSubject:r.author_sub}))});}
  if(path==='/api/linkedin/connect'&&request.method==='POST'){
   const cfg=config(env);if(cfg.origin!==url.origin)fail(503,'linkedin_setup_required');
   const state=random(),binding=random();await stmt(env.GOOGLE_DB,'DELETE FROM linkedin_oauth_states WHERE owner_id=? OR expires_at<?',id,Date.now()).run();await stmt(env.GOOGLE_DB,'INSERT INTO linkedin_oauth_states VALUES(?,?,?,?,?)',await hash(state),id,context.profileId,await hash(binding),Date.now()+600000).run();
   const params=new URLSearchParams({response_type:'code',client_id:env.LINKEDIN_CLIENT_ID,redirect_uri:cfg.href,state,scope:SCOPES.join(' ')});
   return json({authorizationUrl:AUTH+'?'+params},200,{'Set-Cookie':COOKIE+'='+binding+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600'});
  }
  if(path==='/api/linkedin/disconnect'&&request.method==='POST'){if(!env.GOOGLE_DB)fail(503,'linkedin_setup_required');await stmt(env.GOOGLE_DB,'DELETE FROM linkedin_accounts WHERE owner_id=?',id).run();await stmt(env.GOOGLE_DB,'DELETE FROM linkedin_oauth_states WHERE owner_id=?',id).run();return json({connected:false,status:'not_connected',providerRevocationConfirmed:false});}
  if(path==='/api/linkedin/publish'&&request.method==='POST'){config(env);return json(await publish(request,env,id,fetcher));}
  fail(405,'method_not_allowed');
 }catch(error){const known=error instanceof LinkedInOAuthError;return json({error:known?error.code:'linkedin_request_failed'},known?error.status:500);}
}
