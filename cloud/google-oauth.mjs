// Independent owner-bound Google grants. Tokens never leave this server module.
const AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const USERINFO_URL='https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL='https://oauth2.googleapis.com/revoke';
const COOKIE='__Host-immi_google_oauth';
export const GOOGLE_SECONDARY_MAILBOX_SUFFIX=':secondary';
export const isSecondaryGoogleOwner=id=>typeof id==='string'&&id.endsWith(GOOGLE_SECONDARY_MAILBOX_SUFFIX);
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
function appOrigins(env,redirect){
 const origins=new Set([redirect.origin]);
 for(const entry of String(env.GOOGLE_APP_ORIGINS||'').split(',')){
  const value=entry.trim();if(!value)continue;
  try{const candidate=new URL(value);if(candidate.protocol==='https:'&&candidate.origin===value)origins.add(value);}catch{}
 }
 return origins;
}
export function googleStartOriginAllowed(request,env){
 try{const redirect=configured(env),url=new URL(request.url),origin=request.headers.get('Origin')||url.origin;return url.origin===redirect.origin&&appOrigins(env,redirect).has(origin);}catch{return false;}
}
function authorizationUrl(env,id,redirect,state,verifierHash,purpose=null,requestedScopes=null,expectedIdentity=null){
 const requested=requestedScopes||(isSecondaryGoogleOwner(id)?[...GOOGLE_SCOPES.slice(0,5),...(purpose==='calendar'?[GOOGLE_SCOPES[5]]:[]),...(purpose==='backup'?[GOOGLE_SCOPES[6]]:[])]:GOOGLE_SCOPES);
 const params=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirect.href,response_type:'code',scope:requested.join(' '),access_type:'offline',prompt:'consent select_account',include_granted_scopes:'true',state,code_challenge:verifierHash,code_challenge_method:'S256'});
 if(isSecondaryGoogleOwner(id)&&expectedIdentity?.email)params.set('login_hint',expectedIdentity.email);
 return AUTH_URL+'?'+params;
}
function owner(context){if(typeof context?.userId!=='string'||!context.userId||!['arash','amir'].includes(context.profileId))throw new GoogleError(403,'owner_required','An authenticated workspace owner is required');return context.userId;}
function secondaryEmail(env){const value=typeof env.GOOGLE_SECONDARY_EMAIL==='string'?env.GOOGLE_SECONDARY_EMAIL.trim().toLowerCase():'';if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value))throw new GoogleError(503,'secondary_setup_required','The secondary mailbox setup is incomplete');return value;}
function assertMailboxIdentity(env,id,email,profileId){if(!isSecondaryGoogleOwner(id))return;if(!['amir','arash'].includes(profileId)||typeof email!=='string'||!/^([^\s@<>]+)@[^\s@<>]+$/.test(email)||(profileId==='amir'&&email.toLowerCase()!==secondaryEmail(env)))throw new GoogleError(409,'identity_mailbox_mismatch','Select the connected secondary Google account');}

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
async function responseJson(response){
 if(Number(response.headers.get('Content-Length')||0)>65536)throw new GoogleError(502,'provider_unavailable','Google returned an invalid response');
 const reader=response.body?.getReader();if(!reader)throw new GoogleError(502,'provider_unavailable','Google returned an invalid response');
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new GoogleError(502,'provider_unavailable','Google returned an invalid response');}chunks.push(value);}}catch(error){if(error instanceof GoogleError)throw error;throw new GoogleError(502,'provider_unavailable','Google returned an invalid response');}finally{reader.releaseLock();}
 const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
 try{const value=JSON.parse(new TextDecoder().decode(raw));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new GoogleError(502,'provider_unavailable','Google returned an invalid response');}
}
async function googleFetch(fetcher,url,options){
 let response;try{response=await fetcher(url,{...options,signal:AbortSignal.timeout(15000),redirect:'manual'});}catch{throw new GoogleError(502,'provider_unavailable','Google is temporarily unavailable');}
 if(response.redirected||response.status>=300&&response.status<400){await response.body?.cancel();throw new GoogleError(502,'provider_redirect_rejected','Google redirected unexpectedly');}return response;
}
const form=body=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString()});
const scopeList=value=>typeof value==='string'?[...new Set(value.split(/\s+/).filter(Boolean))]:[];
async function account(env,id){return env.GOOGLE_DB.prepare('SELECT * FROM google_accounts WHERE owner_id=?').bind(id).first();}
async function reconnect(env,id,snapshot){await env.GOOGLE_DB.prepare("UPDATE google_accounts SET status='reconnect_required',updated_at=? WHERE owner_id=? AND google_sub=? AND token_cipher=?").bind(now(),id,snapshot.google_sub,snapshot.token_cipher).run();}
export async function getGoogleAccess(env,userId,fetcher=fetch,options={}){
 configured(env);if(typeof userId!=='string'||!userId)throw new GoogleError(403,'owner_required','An authenticated workspace owner is required');
 const row=await account(env,userId);
 if(!row)throw new GoogleError(409,'not_connected','Connect your own Google account first');
 assertMailboxIdentity(env,userId,row.email,row.profile_id);
 if(row.status!=='connected')throw new GoogleError(409,'reconnect_required','Google connection must be renewed');
 let tokens;try{tokens=await decryptGoogleSecret(env,userId,row.token_cipher);}catch(e){if(e.code==='reconnect_required')await reconnect(env,userId,row);throw e;}
 const forceRefresh=options.forceRefresh===true&&(!options.rejectedAccessToken||tokens.access_token===options.rejectedAccessToken);
 if(forceRefresh||!tokens.access_token||!Number.isFinite(Number(row.expires_at))||Number(row.expires_at)<=now()+60000){
  if(!tokens.refresh_token){await reconnect(env,userId,row);throw new GoogleError(409,'reconnect_required','Google connection must be renewed');}
  const result=await googleFetch(fetcher,TOKEN_URL,form({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:tokens.refresh_token,grant_type:'refresh_token'}));
  const payload=await responseJson(result);
  if(!result.ok){if(payload.error==='invalid_grant'){await reconnect(env,userId,row);throw new GoogleError(409,'reconnect_required','Google connection must be renewed');}if(payload.error==='invalid_client'||payload.error==='unauthorized_client')throw new GoogleError(503,'google_client_setup_required','Google application credentials need administrator attention');throw new GoogleError(502,'provider_unavailable','Google token refresh could not be completed');}
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
export async function googleStatus(env,id,profileId=null){
 const unavailable=(missing=[],status='setup_required')=>({configured:false,connected:false,status,missing,email:null,scopes:[],capabilities:{gmailRead:false,gmailSend:false,calendar:false,drive:false,backupDrive:false},verification:{state:'setup_required',checkedAt:null,code:status,retryable:false,recoveryAction:'contact_administrator'}});
 const absent=missing(env);if(absent.length)return unavailable(absent);
 try{configured(env);await encryptionKey(env);}catch{return unavailable();}
 const row=await account(env,id),profile=profileId||row?.profile_id;
 if(profileId&&row&&row.profile_id!==profileId)return unavailable([],'identity_mailbox_mismatch');
 if(isSecondaryGoogleOwner(id)){
  if(!['amir','arash'].includes(profile))return unavailable(['trusted_profile']);
  if(profile==='amir'){try{secondaryEmail(env);}catch{return unavailable(['GOOGLE_SECONDARY_EMAIL']);}}
  if(row){try{assertMailboxIdentity(env,id,row.email,profile);}catch{return unavailable([],'identity_mailbox_mismatch');}}
 }
 const scopes=row?JSON.parse(row.scopes_json):[],connected=row?.status==='connected',status=row?.status||'not_connected';
 return {configured:true,connected,status,email:row?.email||null,scopes,capabilities:{gmailRead:connected&&scopes.includes(GOOGLE_SCOPES[3]),gmailSend:connected&&scopes.includes(GOOGLE_SCOPES[4]),calendar:connected&&scopes.includes(GOOGLE_SCOPES[5]),drive:connected&&!isSecondaryGoogleOwner(id)&&scopes.includes(GOOGLE_SCOPES[6]),backupDrive:connected&&isSecondaryGoogleOwner(id)&&scopes.includes(GOOGLE_SCOPES[6])},verification:{state:connected?'not_checked':row?'reconnect_required':'not_connected',checkedAt:null,code:connected?null:status,retryable:false,recoveryAction:connected?'verify_connection':row?'reconnect_google':'connect_google'}};
}
const serviceKeys=['gmailRead','gmailSend','calendar','drive','backupDrive'];
const serviceCheck=(state,code=null)=>({state,code});
function providerCheckFailure(status,payload){
 const reasons=[payload?.error?.status,...(Array.isArray(payload?.error?.errors)?payload.error.errors.map(item=>item?.reason):[])];
 if(status===429||status>=500||reasons.some(reason=>['rateLimitExceeded','userRateLimitExceeded','quotaExceeded','dailyLimitExceeded','RESOURCE_EXHAUSTED'].includes(reason)))return serviceCheck('temporary_failure','provider_unavailable');
 if(status===403&&reasons.some(reason=>['accessNotConfigured','serviceDisabled','SERVICE_DISABLED'].includes(reason)))return serviceCheck('api_disabled','google_api_disabled');
 if(status===403)return serviceCheck('permission_required','google_permission_required');
 if(status===401)return serviceCheck('permission_required','google_access_rejected');
 return serviceCheck('temporary_failure','provider_unavailable');
}
// Explicit owner-authenticated support check, never part of the cheap status poll.
// Read-only provider probes discard mail/calendar/Drive content. A scope record
// is not a sending test, and transient failures never erase a stored grant.
export async function verifyGoogleConnection(env,id,profileId,fetcher=fetch){
 owner({userId:id,profileId});
 const before=missing(env).length?null:await account(env,id);
 if(before&&before.profile_id!==profileId)throw new GoogleError(403,'owner_required','Google account does not belong to this workspace');
 const initial=await googleStatus(env,id,profileId),checkedAt=new Date().toISOString();
 const serviceChecks=Object.fromEntries(serviceKeys.map(key=>[key,serviceCheck(initial.capabilities[key]?'not_checked':'not_granted')]));
 const result=(status,state,code,recoveryAction,retryable=false)=>({...status,serviceChecks,verification:{state,checkedAt,code,retryable,recoveryAction}});
 if(!initial.configured||!initial.connected)return result(initial,initial.verification.state,initial.verification.code,initial.verification.recoveryAction);
 let access,snapshot,forcedRefresh=false;
 const captureSnapshot=async()=>{
  snapshot=await account(env,id);
  if(!snapshot||snapshot.status!=='connected'||snapshot.profile_id!==profileId||snapshot.google_sub!==access.subject||(await decryptGoogleSecret(env,id,snapshot.token_cipher)).access_token!==access.accessToken)throw new GoogleError(409,'connection_changed','Google connection changed; verify again');
 };
 const refreshRejectedAccess=async()=>{forcedRefresh=true;access=await getGoogleAccess(env,id,fetcher,{forceRefresh:true,rejectedAccessToken:access.accessToken});await captureSnapshot();};
 const verifyIdentity=async()=>{
  let response=await googleFetch(fetcher,USERINFO_URL,{headers:{Authorization:'Bearer '+access.accessToken}});
  if(response.status===401&&!forcedRefresh){await response.body?.cancel();await refreshRejectedAccess();response=await googleFetch(fetcher,USERINFO_URL,{headers:{Authorization:'Bearer '+access.accessToken}});}
  if(!response.ok){await response.body?.cancel();if(response.status===401){await reconnect(env,id,snapshot);throw new GoogleError(409,'reconnect_required','Google connection must be renewed');}throw new GoogleError(502,'provider_unavailable','Google verification is temporarily unavailable');}
  const identity=await responseJson(response);
  if(typeof identity.sub!=='string'||!identity.sub||typeof identity.email!=='string'||!identity.email||typeof identity.email_verified!=='boolean')throw new GoogleError(502,'provider_unavailable','Google returned an invalid identity response');
  if(identity.sub!==access.subject||identity.email_verified!==true||identity.email.toLowerCase()!==access.email.toLowerCase()){await reconnect(env,id,snapshot);throw new GoogleError(409,'identity_mailbox_mismatch','Google identity no longer matches this workspace');}
 };
 try{
  access=await getGoogleAccess(env,id,fetcher);
  await captureSnapshot();await verifyIdentity();
  const probes=[['gmailRead',GOOGLE_SCOPES[3],'https://gmail.googleapis.com/gmail/v1/users/me/profile'],['calendar',GOOGLE_SCOPES[5],'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&fields=kind'],[isSecondaryGoogleOwner(id)?'backupDrive':'drive',GOOGLE_SCOPES[6],'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=kind']];
  for(const key of serviceKeys)serviceChecks[key]=serviceCheck('not_granted');
  if(access.scopes.includes(GOOGLE_SCOPES[4]))serviceChecks.gmailSend=serviceCheck('scope_recorded');
  for(const [key,scope,url] of probes){
   if(!access.scopes.includes(scope))continue;
   let response;
   try{response=await googleFetch(fetcher,url,{headers:{Authorization:'Bearer '+access.accessToken}});}
   catch(error){if(!(error instanceof GoogleError))throw error;serviceChecks[key]=serviceCheck('temporary_failure',error.code==='provider_redirect_rejected'?'provider_redirect_rejected':'provider_unavailable');continue;}
   if(response.status===401&&!forcedRefresh){await response.body?.cancel();await refreshRejectedAccess();await verifyIdentity();if(!access.scopes.includes(scope)){serviceChecks[key]=serviceCheck('not_granted');continue;}response=await googleFetch(fetcher,url,{headers:{Authorization:'Bearer '+access.accessToken}});}
   if(response.ok){await response.body?.cancel();serviceChecks[key]=serviceCheck('available');}else{let payload=null;try{payload=await responseJson(response);}catch{}serviceChecks[key]=providerCheckFailure(response.status,payload);}
  }
  for(const [key,scope] of [['gmailRead',GOOGLE_SCOPES[3]],['calendar',GOOGLE_SCOPES[5]],[isSecondaryGoogleOwner(id)?'backupDrive':'drive',GOOGLE_SCOPES[6]]])if(!access.scopes.includes(scope))serviceChecks[key]=serviceCheck('not_granted');
  serviceChecks.gmailSend=serviceCheck(access.scopes.includes(GOOGLE_SCOPES[4])?'scope_recorded':'not_granted');
  const current=await account(env,id);if(!current||current.status!=='connected'||current.google_sub!==snapshot.google_sub||current.token_cipher!==snapshot.token_cipher)throw new GoogleError(409,'connection_changed','Google connection changed; verify again');
  const status=await googleStatus(env,id,profileId);
  for(const key of serviceKeys)if(['permission_required','api_disabled','not_granted'].includes(serviceChecks[key].state))status.capabilities[key]=false;
  const failures=Object.values(serviceChecks).filter(check=>!['available','scope_recorded','not_granted'].includes(check.state));
  return result(status,failures.length?'partial':'verified',failures[0]?.code||null,failures.length?(failures.some(check=>check.state==='api_disabled')?'contact_administrator':failures.some(check=>check.state==='permission_required')?'approve_service_permission':'retry_verification'):'none',failures.some(check=>check.state==='temporary_failure'));
 }catch(error){
  if(!(error instanceof GoogleError))throw error;
  const current=await googleStatus(env,id,profileId);
  if(['reconnect_required','identity_mailbox_mismatch'].includes(error.code)&&!current.connected)return result(current,'reconnect_required',error.code,'reconnect_google');
  if(error.code==='not_connected')return result(current,'not_connected',error.code,'connect_google');
  if(['setup_required','google_client_setup_required'].includes(error.code))return result(current,'setup_required',error.code,'contact_administrator');
  return result(current,'temporary_failure',['reconnect_required','identity_mailbox_mismatch','connection_changed'].includes(error.code)?'connection_changed':error.code,'retry_verification',true);
 }
}
export async function handleGoogleRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url);const id=owner(context);
 if(request.method==='GET'&&url.pathname==='/api/google/status')return json(await googleStatus(env,id,context.profileId));
 if(request.method==='POST'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin&&!(url.pathname==='/api/google/start'&&googleStartOriginAllowed(request,env)))throw new GoogleError(403,'origin_rejected','Origin rejected');
 if(request.method==='POST'&&url.pathname==='/api/google/verify'){
  if(Number(request.headers.get('Content-Length')||0)>1024)throw new GoogleError(413,'payload_too_large','Connection verification accepts an empty object');
  const raw=await request.text();let input;try{if(bytes(raw).length>1024)throw Error();input=JSON.parse(raw||'{}');}catch{throw new GoogleError(400,'invalid_payload','Connection verification accepts an empty object');}
  if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length)throw new GoogleError(400,'invalid_payload','Connection verification accepts an empty object');
  return json(await verifyGoogleConnection(env,id,context.profileId,fetcher));
 }
 if(request.method==='POST'&&url.pathname==='/api/google/start'){
  const language=url.searchParams.has('language')?url.searchParams.get('language'):'fa';if(!['fa','en'].includes(language)||url.searchParams.getAll('language').length>1)throw new GoogleError(400,'invalid_language','Unsupported interface language');
  const purpose=url.searchParams.get('purpose');if(purpose!==null&&(!['backup','calendar'].includes(purpose)||!isSecondaryGoogleOwner(id)))throw new GoogleError(400,'invalid_purpose','Additional service authorization requires the secondary account owner');
  const redirect=configured(env);await encryptionKey(env);if(isSecondaryGoogleOwner(id)&&context.profileId==='amir')secondaryEmail(env);
  if(!googleStartOriginAllowed(request,env))throw new GoogleError(503,'oauth_domain_setup_required','Google OAuth must start from a configured application origin');
  // Only server-recorded existing optional grants survive a reconnect. The
  // requested list is encrypted into state and is never supplied by the browser.
  let requestedScopes=GOOGLE_SCOPES,expectedIdentity=null;
  if(isSecondaryGoogleOwner(id)){
   const previous=await account(env,id),previousScopes=previous?JSON.parse(previous.scopes_json):[];
   if(previous&&previous.profile_id!==context.profileId)throw new GoogleError(403,'owner_required','Secondary Google account does not belong to this workspace');
   expectedIdentity={email:context.profileId==='amir'?secondaryEmail(env):(previous?.email||null),subject:previous?.google_sub||null};
   requestedScopes=[...GOOGLE_SCOPES.slice(0,5),...([5,6].filter(index=>previousScopes.includes(GOOGLE_SCOPES[index])||(purpose==='calendar'&&index===5)||(purpose==='backup'&&index===6))).map(index=>GOOGLE_SCOPES[index])];
  }
  const parentOrigin=request.headers.get('Origin')||url.origin;
  const state=random(),binding=random(),verifier=random(),launchSecret=random(),callbackNonce=random(),stateHash=await hash(state);
  const bridge={tokenHash:await hash(launchSecret),binding,parentOrigin,callbackNonce};
  await env.GOOGLE_DB.prepare('DELETE FROM google_oauth_states WHERE expires_at<? OR owner_id=?').bind(now(),id).run();
  await env.GOOGLE_DB.prepare('INSERT INTO google_oauth_states(state_hash,owner_id,profile_id,browser_hash,verifier_cipher,expires_at) VALUES(?,?,?,?,?,?)').bind(stateHash,id,context.profileId,await hash(binding),await encryptGoogleSecret(env,'oauth:'+stateHash+':'+id,{verifier,bridge,parentOrigin,callbackNonce,purpose,requestedScopes,expectedIdentity,language}),now()+600000).run();
  return json({authorizationUrl:authorizationUrl(env,id,redirect,state,await hash(verifier),purpose,requestedScopes,expectedIdentity),launchUrl:redirect.origin+'/api/google/launch',launchTicket:state+'.'+launchSecret,callbackNonce,oauthOrigin:redirect.origin},200,{'Set-Cookie':COOKIE+'='+binding+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'});
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
// Top-level cross-origin form POST is intentional. An exact allowed Origin plus
// a single-use server-issued ticket prevents transferable GET-link account CSRF.
export async function handleGoogleLaunch(request,env){
 const redirect=configured(env),url=new URL(request.url),origin=request.headers.get('Origin');
 if(request.method!=='POST'||url.origin!==redirect.origin||url.pathname!=='/api/google/launch')throw new GoogleError(400,'invalid_launch','Invalid Google connection launch');
 if(!origin||!appOrigins(env,redirect).has(origin))throw new GoogleError(403,'origin_rejected','Google connection launch origin rejected');
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/x-www-form-urlencoded'))throw new GoogleError(400,'invalid_launch','Invalid Google connection launch');
 if(Number(request.headers.get('Content-Length')||0)>512)throw new GoogleError(413,'invalid_launch','Invalid Google connection launch');
 const body=await request.text();if(body.length>512)throw new GoogleError(413,'invalid_launch','Invalid Google connection launch');
 const entries=[...new URLSearchParams(body)];
 if(entries.length!==1||entries[0][0]!=='ticket'||!/^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.test(entries[0][1]))throw new GoogleError(400,'invalid_launch','Invalid Google connection launch');
 const [state,secret]=entries[0][1].split('.'),stateHash=await hash(state);
 const pending=await env.GOOGLE_DB.prepare('SELECT * FROM google_oauth_states WHERE state_hash=?').bind(stateHash).first();
 if(!pending||pending.expires_at<=now())throw new GoogleError(400,'invalid_launch','Google connection launch expired or already used');
 const stored=await decryptGoogleSecret(env,'oauth:'+stateHash+':'+pending.owner_id,pending.verifier_cipher);
 const bridge=stored.bridge;
 if(!bridge||bridge.parentOrigin!==origin||bridge.tokenHash!==await hash(secret)||!/^[A-Za-z0-9_-]{43}$/.test(bridge.binding))throw new GoogleError(400,'invalid_launch','Google connection launch expired or already used');
 const next=await encryptGoogleSecret(env,'oauth:'+stateHash+':'+pending.owner_id,{verifier:stored.verifier,parentOrigin:bridge.parentOrigin,callbackNonce:bridge.callbackNonce,purpose:stored.purpose||null,requestedScopes:stored.requestedScopes||null,expectedIdentity:stored.expectedIdentity||null,language:stored.language==='en'?'en':'fa'});
 const claimed=await env.GOOGLE_DB.prepare('UPDATE google_oauth_states SET verifier_cipher=? WHERE state_hash=? AND verifier_cipher=? AND expires_at>? RETURNING owner_id').bind(next,stateHash,pending.verifier_cipher,now()).first();
 if(!claimed)throw new GoogleError(400,'invalid_launch','Google connection launch expired or already used');
 return new Response(null,{status:303,headers:{Location:authorizationUrl(env,pending.owner_id,redirect,state,await hash(stored.verifier),stored.purpose,stored.requestedScopes,stored.expectedIdentity),'Set-Cookie':COOKIE+'='+bridge.binding+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"}});
}
const CALLBACK_STAGES=Object.freeze(['configuration','state','browser_binding','state_consume','token_exchange','identity','refresh_grant','account_store']);
const TOKEN_ERRORS=Object.freeze(['invalid_client','invalid_grant','redirect_uri_mismatch','access_denied','unauthorized_client','invalid_request']);
const CALLBACK_CODES=new Set(['setup_required','invalid_callback','invalid_state','state_not_found','state_expired','browser_binding_missing','browser_binding_invalid','browser_binding_mismatch','authorization_denied','provider_unavailable','identity_not_verified','identity_in_use','identity_mailbox_mismatch','secondary_setup_required','backup_permission_missing','calendar_permission_missing','offline_grant_missing','reconnect_required','token_exchange_rejected',...TOKEN_ERRORS.map(code=>'token_exchange_'+code),...CALLBACK_STAGES.map(stage=>stage+'_failed')]);
function callbackDiagnostic(stage,error){return {stage:CALLBACK_STAGES.includes(stage)?stage:'configuration',code:CALLBACK_CODES.has(error?.code)?error.code:(CALLBACK_STAGES.includes(stage)?stage:'configuration')+'_failed'};}
async function recordCallbackDiagnostic(env,ownerId,diagnostic){
 // Only fixed stage/code identifiers are retained. Never record provider bodies,
 // query strings, state hashes, cookies, authorization codes or credentials.
 if(!env.GOOGLE_DB)return;
 try{
  const at=now();
  await env.GOOGLE_DB.prepare('DELETE FROM google_oauth_diagnostics WHERE created_at<?').bind(at-7*86400000).run();
  await env.GOOGLE_DB.prepare('INSERT INTO google_oauth_diagnostics(id,owner_id,stage,code,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),ownerId||null,diagnostic.stage,diagnostic.code,at).run();
  await env.GOOGLE_DB.prepare('DELETE FROM google_oauth_diagnostics WHERE owner_id IS ? AND id NOT IN (SELECT id FROM google_oauth_diagnostics WHERE owner_id IS ? ORDER BY created_at DESC,rowid DESC LIMIT 50)').bind(ownerId||null,ownerId||null).run();
 }catch{/* Diagnostics are best effort and must not alter OAuth outcomes. */}
}
function finish(ok,status=200,diagnostic=null,notification=null,language='en'){
 const english=language==='en';
 const safe=diagnostic&&CALLBACK_STAGES.includes(diagnostic.stage)&&CALLBACK_CODES.has(diagnostic.code)?diagnostic:null;
 const channel=notification&&/^https:\/\//.test(notification.parentOrigin)&&/^[A-Za-z0-9_-]{43}$/.test(notification.callbackNonce)?notification:null;
 const nonce=random(),script=channel?'<script nonce="'+nonce+'">if(window.opener)window.opener.postMessage('+JSON.stringify({type:'immi-google-oauth',ok,nonce:channel.callbackNonce,code:safe?.code||null}).replaceAll('<','\\u003c')+','+JSON.stringify(channel.parentOrigin).replaceAll('<','\\u003c')+');</script>':'';
 const detail=!ok&&safe?'<p>'+(english?'Error code: ':'کد خطای قابل گزارش: ')+'<code dir="ltr">'+safe.stage+'/'+safe.code+'</code></p>':'';
 return new Response('<!doctype html><html lang="'+(english?'en':'fa')+'" dir="'+(english?'ltr':'rtl')+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+(english?'Google connection':'اتصال Google')+'</title><body><h1>'+(english?(ok?'Google connected':'Google connection failed'):(ok?'اتصال Google ثبت شد':'اتصال Google انجام نشد'))+'</h1><p>'+(english?(ok?'Return to your workspace. You may close this window.':'Return to your workspace and start the connection again.'):(ok?'به پنل اصلی برگردید. می‌توانید این پنجره را ببندید.':'به پنل اصلی برگردید و اتصال را دوباره آغاز کنید.'))+'</p>'+detail+script+'</body></html>',{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'nonce-"+nonce+"'; frame-ancestors 'none'; base-uri 'none'",'Set-Cookie':COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
}
export async function handleGoogleCallback(request,env,fetcher=fetch){
 let stage='configuration',ownerId=null,notification=null,language='en';
 try{
  const expected=configured(env),url=new URL(request.url);if(request.method!=='GET'||url.origin!==expected.origin||url.pathname!==expected.pathname)throw new GoogleError(400,'invalid_callback','Invalid callback');
  stage='state';
  const state=url.searchParams.get('state');if(!state||!/^[A-Za-z0-9_-]{43}$/.test(state))throw new GoogleError(400,'invalid_state','Invalid connection state');
  const stateHash=await hash(state);
  const stateInfo=await env.GOOGLE_DB.prepare('SELECT owner_id,browser_hash,expires_at FROM google_oauth_states WHERE state_hash=?').bind(stateHash).first();
  if(!stateInfo)throw new GoogleError(400,'state_not_found','Connection state was not found or already used');
  ownerId=stateInfo.owner_id;
  if(stateInfo.expires_at<=now())throw new GoogleError(400,'state_expired','Connection state expired');
  stage='browser_binding';
  const cookies=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim().split('='));const binding=cookies.find(([k])=>k===COOKIE)?.[1];
  if(!binding)throw new GoogleError(400,'browser_binding_missing','Connection browser binding is missing');
  if(!/^[A-Za-z0-9_-]{43}$/.test(binding))throw new GoogleError(400,'browser_binding_invalid','Connection browser binding is invalid');
  const browserHash=await hash(binding);
  if(stateInfo.browser_hash!==browserHash)throw new GoogleError(400,'browser_binding_mismatch','Connection browser binding does not match');
  stage='state_consume';
  const pending=await env.GOOGLE_DB.prepare('DELETE FROM google_oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *').bind(stateHash,browserHash,now()).first();
  if(!pending)throw new GoogleError(400,'state_not_found','Connection state expired or already used');
  const stored=await decryptGoogleSecret(env,'oauth:'+stateHash+':'+pending.owner_id,pending.verifier_cipher);const {verifier}=stored;language=stored.language==='en'?'en':'fa';
  const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code||code.length>4096)throw new GoogleError(400,'authorization_denied','Google connection was not authorized');

  if(appOrigins(env,expected).has(stored.parentOrigin)&&/^[A-Za-z0-9_-]{43}$/.test(stored.callbackNonce))notification={parentOrigin:stored.parentOrigin,callbackNonce:stored.callbackNonce};
  stage='token_exchange';
  const response=await googleFetch(fetcher,TOKEN_URL,form({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:expected.href}));const grant=await responseJson(response);
  if(!response.ok){const safeCode=TOKEN_ERRORS.includes(grant.error)?'token_exchange_'+grant.error:'token_exchange_rejected';throw new GoogleError(400,safeCode,'Google token exchange was rejected');}
  if(typeof grant.access_token!=='string'||!grant.access_token||!Number.isFinite(Number(grant.expires_in))||Number(grant.expires_in)<=0)throw new GoogleError(400,'token_exchange_rejected','Google connection could not be completed');
  stage='identity';
  const identityResponse=await googleFetch(fetcher,USERINFO_URL,{headers:{Authorization:'Bearer '+grant.access_token}});const identity=await responseJson(identityResponse);
  if(!identityResponse.ok||typeof identity.sub!=='string'||!identity.sub||identity.sub.length>255||typeof identity.email!=='string'||identity.email.length>320||![true,'true'].includes(identity.email_verified))throw new GoogleError(400,'identity_not_verified','Google identity could not be verified');
  assertMailboxIdentity(env,pending.owner_id,identity.email,pending.profile_id);
  if(isSecondaryGoogleOwner(pending.owner_id)&&stored.expectedIdentity&&((stored.expectedIdentity.email&&stored.expectedIdentity.email.toLowerCase()!==identity.email.toLowerCase())||(stored.expectedIdentity.subject&&stored.expectedIdentity.subject!==identity.sub)))throw new GoogleError(409,'identity_mailbox_mismatch','Disconnect the current secondary account before selecting a different Google account');
  const duplicate=await env.GOOGLE_DB.prepare('SELECT owner_id FROM google_accounts WHERE google_sub=? AND owner_id<>?').bind(identity.sub,pending.owner_id).first();if(duplicate)throw new GoogleError(409,'identity_in_use','This Google account is already connected to another workspace');
  stage='refresh_grant';
  const previous=await account(env,pending.owner_id);let refreshToken=grant.refresh_token;
  if(isSecondaryGoogleOwner(pending.owner_id)&&previous&&(previous.google_sub!==identity.sub||previous.email.toLowerCase()!==identity.email.toLowerCase()))throw new GoogleError(409,'identity_mailbox_mismatch','Disconnect the current secondary account before selecting a different Google account');
  if(!refreshToken&&previous?.google_sub===identity.sub){refreshToken=(await decryptGoogleSecret(env,pending.owner_id,previous.token_cipher)).refresh_token;}
  if(!refreshToken)throw new GoogleError(400,'offline_grant_missing','Reconnect Google with offline access permission');
  const scopes=scopeList(grant.scope);
  const required=Array.isArray(stored.requestedScopes)?stored.requestedScopes.filter(scope=>GOOGLE_SCOPES.slice(3).includes(scope)):(stored.purpose==='backup'?[GOOGLE_SCOPES[3],GOOGLE_SCOPES[4],GOOGLE_SCOPES[6]]:[]);
  if(isSecondaryGoogleOwner(pending.owner_id)&&!required.every(scope=>scopes.includes(scope)))throw new GoogleError(400,stored.purpose==='backup'?'backup_permission_missing':'calendar_permission_missing','Confirm the requested Google permissions; previous connection is unchanged');
  const cipher=await encryptGoogleSecret(env,pending.owner_id,{access_token:grant.access_token,refresh_token:refreshToken});
  stage='account_store';
  const pinnedUpdate=isSecondaryGoogleOwner(pending.owner_id)?' WHERE google_accounts.google_sub=excluded.google_sub AND lower(google_accounts.email)=lower(excluded.email) AND google_accounts.profile_id=excluded.profile_id':'';
  await env.GOOGLE_DB.prepare('INSERT INTO google_accounts(owner_id,profile_id,google_sub,email,scopes_json,token_cipher,expires_at,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET profile_id=excluded.profile_id,google_sub=excluded.google_sub,email=excluded.email,scopes_json=excluded.scopes_json,token_cipher=excluded.token_cipher,expires_at=excluded.expires_at,status=excluded.status,updated_at=excluded.updated_at'+pinnedUpdate).bind(pending.owner_id,pending.profile_id,identity.sub,identity.email.toLowerCase(),JSON.stringify(scopes),cipher,now()+Math.min(Number(grant.expires_in),86400)*1000,'connected',now()).run();
  if(isSecondaryGoogleOwner(pending.owner_id)){const saved=await account(env,pending.owner_id);if(!saved||saved.google_sub!==identity.sub||saved.email.toLowerCase()!==identity.email.toLowerCase())throw new GoogleError(409,'identity_mailbox_mismatch','Disconnect the current secondary account before selecting a different Google account');}
  return finish(true,200,null,notification,language);
 }catch(error){const diagnostic=callbackDiagnostic(stage,error);await recordCallbackDiagnostic(env,ownerId,diagnostic);return finish(false,error instanceof GoogleError?error.status:400,diagnostic,notification,language);}
}
