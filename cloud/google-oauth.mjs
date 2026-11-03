// Independent owner-bound Google grants. Tokens never leave this server module.
const AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const USERINFO_URL='https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL='https://oauth2.googleapis.com/revoke';
const COOKIE='__Host-immi_google_oauth';
export const GOOGLE_SCOPES=Object.freeze(['openid','email','profile','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/drive.file']);
export class GoogleError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const unb64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const url64=bytes=>b64(bytes).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const random=()=>url64(crypto.getRandomValues(new Uint8Array(32)));
const bytes=value=>new TextEncoder().encode(value);
const hash=async value=>url64(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(value))));
const now=()=>Date.now();
function missing(env){return ['GOOGLE_DB','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_TOKEN_KEY','GOOGLE_REDIRECT_URI'].filter(k=>!env[k]);}
function configured(env){
 if(missing(env).length)throw new GoogleError(503,'setup_required','Google connection setup is incomplete');
 let uri;try{uri=new URL(env.GOOGLE_REDIRECT_URI);}catch{}
 if(!uri||uri.protocol!=='https:'||uri.pathname!=='/api/google/callback'||uri.search||uri.hash||uri.username||uri.password)throw new GoogleError(503,'setup_required','Google redirect configuration is invalid');
 return uri;
}
function owner(context){if(!context?.userId||!['arash','amir'].includes(context.profileId))throw new GoogleError(403,'owner_required','An authenticated workspace owner is required');return context.userId;}
async function encryptionKey(env){
 try{const raw=unb64(env.GOOGLE_TOKEN_KEY);if(raw.length!==32)throw Error();return await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);}catch{throw new GoogleError(503,'setup_required','Google token encryption is not configured');}
}
export async function encryptGoogleSecret(env,ownerBinding,value){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(ownerBinding)},await encryptionKey(env),bytes(JSON.stringify(value)));
 return 'v1.'+b64(iv)+'.'+b64(new Uint8Array(encrypted));
}
export async function decryptGoogleSecret(env,ownerBinding,envelope){
 try{const [version,iv,cipher,...extra]=String(envelope).split('.');if(version!=='v1'||extra.length||unb64(iv).length!==12)throw Error();const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:bytes(ownerBinding)},await encryptionKey(env),unb64(cipher));return JSON.parse(new TextDecoder().decode(raw));}catch(error){if(error instanceof GoogleError)throw error;throw new GoogleError(409,'reconnect_required','Google connection must be renewed');}
}
async function responseJson(response){const text=await response.text();if(text.length>65536)throw new GoogleError(502,'provider_unavailable','Google returned an invalid response');try{return JSON.parse(text);}catch{throw new GoogleError(502,'provider_unavailable','Google returned an invalid response');}}
async function googleFetch(fetcher,url,options){try{return await fetcher(url,{...options,signal:AbortSignal.timeout(15000)});}catch{throw new GoogleError(502,'provider_unavailable','Google is temporarily unavailable');}}
const form=body=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString()});
const scopeList=value=>typeof value==='string'?[...new Set(value.split(/\s+/).filter(Boolean))]:[];
async function account(env,id){return env.GOOGLE_DB.prepare('SELECT * FROM google_accounts WHERE owner_id=?').bind(id).first();}
async function reconnect(env,id,snapshot){await env.GOOGLE_DB.prepare("UPDATE google_accounts SET status='reconnect_required',updated_at=? WHERE owner_id=? AND google_sub=? AND token_cipher=?").bind(now(),id,snapshot.google_sub,snapshot.token_cipher).run();}
export async function getGoogleAccess(env,userId,fetcher=fetch){
 configured(env);if(typeof userId!=='string'||!userId)throw new GoogleError(403,'owner_required','An authenticated workspace owner is required');
 const row=await account(env,userId);
 if(!row)throw new GoogleError(409,'not_connected','Connect your own Google account first');
 if(row.status!=='connected')throw new GoogleError(409,'reconnect_required','Google connection must be renewed');
 let tokens;try{tokens=await decryptGoogleSecret(env,userId,row.token_cipher);}catch(e){if(e.code==='reconnect_required')await reconnect(env,userId,row);throw e;}
 if(row.expires_at<=now()+60000){
  if(!tokens.refresh_token){await reconnect(env,userId,row);throw new GoogleError(409,'reconnect_required','Google connection must be renewed');}
  const result=await googleFetch(fetcher,TOKEN_URL,form({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:'refresh_token'}));
  const payload=await responseJson(result);
  if(!result.ok){if(payload.error==='invalid_grant'){await reconnect(env,userId,row);throw new GoogleError(409,'reconnect_required','Google connection must be renewed');}throw new GoogleError(502,'provider_unavailable','Google token refresh could not be completed');}
  if(typeof payload.access_token!=='string'||!payload.access_token||!Number.isFinite(Number(payload.expires_in))||Number(payload.expires_in)<=0)throw new GoogleError(502,'provider_unavailable','Google returned an invalid grant');
  tokens={access_token:payload.access_token,refresh_token:payload.refresh_token||tokens.refresh_token};
  const scopes=payload.scope?scopeList(payload.scope):JSON.parse(row.scopes_json);
  await env.GOOGLE_DB.prepare("UPDATE google_accounts SET token_cipher=?,expires_at=?,scopes_json=?,updated_at=? WHERE owner_id=? AND google_sub=? AND status='connected' AND token_cipher=?").bind(await encryptGoogleSecret(env,userId,tokens),now()+Math.min(Number(payload.expires_in),86400)*1000,JSON.stringify(scopes),now(),userId,row.google_sub,row.token_cipher).run();
  // If disconnected/replaced while refreshing, never use the stale grant.
  const current=await account(env,userId);if(!current||current.status!=='connected'||current.google_sub!==row.google_sub)throw new GoogleError(409,'reconnect_required','Google connection changed; try again');
  const currentTokens=await decryptGoogleSecret(env,userId,current.token_cipher);
  return {accessToken:currentTokens.access_token,email:current.email,subject:current.google_sub,scopes:JSON.parse(current.scopes_json)};
 }
 return {accessToken:tokens.access_token,email:row.email,subject:row.google_sub,scopes:JSON.parse(row.scopes_json)};
}
export async function googleStatus(env,id){
 const absent=missing(env);if(absent.length)return {configured:false,connected:false,status:'setup_required',missing:absent,email:null,scopes:[],capabilities:{gmailRead:false,gmailSend:false,calendar:false,drive:false}};
 try{configured(env);await encryptionKey(env);}catch{return {configured:false,connected:false,status:'setup_required',missing:[],email:null,scopes:[]};}
 const row=await account(env,id);const scopes=row?JSON.parse(row.scopes_json):[];
 return {configured:true,connected:row?.status==='connected',status:row?.status||'not_connected',email:row?.email||null,scopes,capabilities:{gmailRead:scopes.includes(GOOGLE_SCOPES[3]),gmailSend:scopes.includes(GOOGLE_SCOPES[4]),calendar:scopes.includes(GOOGLE_SCOPES[5]),drive:scopes.includes(GOOGLE_SCOPES[6])}};
}
export async function handleGoogleRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url);const id=owner(context);
 if(request.method==='GET'&&url.pathname==='/api/google/status')return json(await googleStatus(env,id));
 if(request.method==='POST'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)throw new GoogleError(403,'origin_rejected','Origin rejected');
 if(request.method==='POST'&&url.pathname==='/api/google/start'){
  const redirect=configured(env);await encryptionKey(env);
  if(redirect.origin!==url.origin)throw new GoogleError(503,'setup_required','Google callback must use this site origin');
  const state=random(),binding=random(),verifier=random(),stateHash=await hash(state);
  await env.GOOGLE_DB.prepare('DELETE FROM google_oauth_states WHERE expires_at<? OR owner_id=?').bind(now(),id).run();
  await env.GOOGLE_DB.prepare('INSERT INTO google_oauth_states(state_hash,owner_id,profile_id,browser_hash,verifier_cipher,expires_at) VALUES(?,?,?,?,?,?)').bind(stateHash,id,context.profileId,await hash(binding),await encryptGoogleSecret(env,'oauth:'+stateHash+':'+id,{verifier}),now()+600000).run();
  const params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirect.href,response_type:'code',scope:GOOGLE_SCOPES.join(' '),access_type:'offline',prompt:'consent select_account',include_granted_scopes:'true',state,code_challenge:await hash(verifier),code_challenge_method:'S256'});
  return json({authorizationUrl:AUTH_URL+'?'+params},200,{'Set-Cookie':COOKIE+'='+binding+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'});
 }
 if(request.method==='POST'&&url.pathname==='/api/google/disconnect'){
  // Disconnect local identity first; provider outages cannot leave a local sender active.
  if(!env.GOOGLE_DB)throw new GoogleError(503,'setup_required','Google connection storage is not configured');const row=await account(env,id);let revoked=false;
  await env.GOOGLE_DB.prepare('DELETE FROM google_accounts WHERE owner_id=?').bind(id).run();
  await env.GOOGLE_DB.prepare('DELETE FROM google_oauth_states WHERE owner_id=?').bind(id).run();
  if(row){try{const tokens=await decryptGoogleSecret(env,id,row.token_cipher);const response=await googleFetch(fetcher,REVOKE_URL,form({token:tokens.refresh_token||tokens.access_token}));revoked=response.ok;}catch{}}
  return json({connected:false,status:'not_connected',revocationConfirmed:revoked});
 }
 return null;
}
function finish(ok,status=200){return new Response('<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>اتصال Google</title><body><h1>'+(ok?'اتصال Google ثبت شد':'اتصال Google انجام نشد')+'</h1><p>'+(ok?'به پنل اصلی برگردید. می‌توانید این پنجره را ببندید.':'به پنل اصلی برگردید و اتصال را دوباره آغاز کنید.')+'</p></body></html>',{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'Set-Cookie':COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});}
export async function handleGoogleCallback(request,env,fetcher=fetch){
 try{
  const expected=configured(env),url=new URL(request.url);if(request.method!=='GET'||url.origin!==expected.origin||url.pathname!==expected.pathname)throw new GoogleError(400,'invalid_callback','Invalid callback');
  const state=url.searchParams.get('state');if(!state||!/^[A-Za-z0-9_-]{43}$/.test(state))throw new GoogleError(400,'invalid_state','Invalid connection state');
  const cookies=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim().split('='));const binding=cookies.find(([k])=>k===COOKIE)?.[1];if(!binding||!/^[A-Za-z0-9_-]{43}$/.test(binding))throw new GoogleError(400,'invalid_state','Invalid connection state');
  const stateHash=await hash(state),browserHash=await hash(binding);
  const pending=await env.GOOGLE_DB.prepare('DELETE FROM google_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *').bind(stateHash,browserHash,now()).first();
  if(!pending)throw new GoogleError(400,'invalid_state','Connection state expired or already used');
  const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code||code.length>4096)throw new GoogleError(400,'authorization_denied','Google connection was not authorized');
  const {verifier}=await decryptGoogleSecret(env,'oauth:'+stateHash+':'+pending.owner_id,pending.verifier_cipher);
  const response=await googleFetch(fetcher,TOKEN_URL,form({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:expected.href}));const grant=await responseJson(response);
  if(!response.ok||typeof grant.access_token!=='string'||!grant.access_token||!Number.isFinite(Number(grant.expires_in))||Number(grant.expires_in)<=0)throw new GoogleError(400,'authorization_denied','Google connection could not be completed');
  const identityResponse=await googleFetch(fetcher,USERINFO_URL,{headers:{Authorization:'Bearer '+grant.access_token}});const identity=await responseJson(identityResponse);
  if(!identityResponse.ok||typeof identity.sub!=='string'||!identity.sub||identity.sub.length>255||typeof identity.email!=='string'||identity.email.length>320||![true,'true'].includes(identity.email_verified))throw new GoogleError(400,'identity_not_verified','Google identity could not be verified');
  const duplicate=await env.GOOGLE_DB.prepare('SELECT owner_id FROM google_accounts WHERE google_sub=? AND owner_id<>?').bind(identity.sub,pending.owner_id).first();if(duplicate)throw new GoogleError(409,'identity_in_use','This Google account is already connected to another workspace');
  const previous=await account(env,pending.owner_id);let refreshToken=grant.refresh_token;
  if(!refreshToken&&previous?.google_sub===identity.sub){refreshToken=(await decryptGoogleSecret(env,pending.owner_id,previous.token_cipher)).refresh_token;}
  if(!refreshToken)throw new GoogleError(400,'offline_grant_missing','Reconnect Google with offline access permission');
  const scopes=scopeList(grant.scope);const cipher=await encryptGoogleSecret(env,pending.owner_id,{access_token:grant.access_token,refresh_token:refreshToken});
  await env.GOOGLE_DB.prepare('INSERT INTO google_accounts(owner_id,profile_id,google_sub,email,scopes_json,token_cipher,expires_at,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET profile_id=excluded.profile_id,google_sub=excluded.google_sub,email=excluded.email,scopes_json=excluded.scopes_json,token_cipher=excluded.token_cipher,expires_at=excluded.expires_at,status=excluded.status,updated_at=excluded.updated_at').bind(pending.owner_id,pending.profile_id,identity.sub,identity.email.toLowerCase(),JSON.stringify(scopes),cipher,now()+Math.min(Number(grant.expires_in),86400)*1000,'connected',now()).run();
  return finish(true);
 }catch(error){return finish(false,error instanceof GoogleError?error.status:400);}
}
