// Explicitly linked private chats only. Public opportunities never contain mail/CV content.
import {checkAutomationMembership} from './automation-membership.mjs';
import {getOwnedMailOpportunityContext} from './mail-opportunities.mjs';
const WEBHOOK_PATH='/api/telegram/webhook';
const DEFAULT_WEBHOOK='https://immi-arash-amir.dr-gerami-md.workers.dev'+WEBHOOK_PATH;
const DAILY_LIMIT=10,GLOBAL_RUN_LIMIT=3;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results||[];
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
class TelegramError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new TelegramError(status,code);};
function missing(env){return ['GOOGLE_DB','TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET'].filter(name=>!env[name]);}
function config(env){if(missing(env).length)fail(503,'telegram_setup_required');if(!/^\d{5,20}:[A-Za-z0-9_-]{20,150}$/.test(env.TELEGRAM_BOT_TOKEN)||!/^[-A-Za-z0-9_]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET))fail(503,'telegram_setup_required');let u;try{u=new URL(env.TELEGRAM_WEBHOOK_URL||DEFAULT_WEBHOOK);}catch{}if(!u||u.protocol!=='https:'||u.pathname!==WEBHOOK_PATH||u.username||u.password||u.port||u.hash||u.search)fail(503,'telegram_setup_required');return {webhook:u.href,origin:u.origin};}
const account=(env,owner)=>stmt(env.GOOGLE_DB,'SELECT * FROM telegram_accounts WHERE owner_id=?',owner).first();
async function boundedJSON(response){if(Number(response.headers.get('Content-Length')||0)>65536)fail(502,'telegram_invalid_response');const reader=response.body?.getReader();if(!reader)fail(502,'telegram_invalid_response');const chunks=[];let n=0;for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>65536){await reader.cancel();fail(502,'telegram_invalid_response');}chunks.push(value);}const bytes=new Uint8Array(n);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(502,'telegram_invalid_response');}}
async function provider(env,method,payload,fetcher){let response;try{response=await fetcher('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{fail(502,'telegram_unavailable');}if(response.status>=300&&response.status<400){await response.body?.cancel();fail(502,'telegram_redirect_rejected');}const data=await boundedJSON(response);return {status:response.status,ok:response.ok&&data?.ok===true,result:data?.result};}
async function getBot(env,fetcher,now){const result=await provider(env,'getMe',{},fetcher);if(!result.ok||result.result?.is_bot!==true||!/^\w{5,32}$/.test(result.result?.username||''))fail(502,'telegram_identity_invalid');const username=result.result.username,identity=await hash(env.TELEGRAM_BOT_TOKEN);await stmt(env.GOOGLE_DB,"INSERT INTO telegram_bot_state(id,username,identity_hash,checked_at) VALUES('bot',?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,identity_hash=excluded.identity_hash,checked_at=excluded.checked_at",username,identity,now).run();return username;}
const registrationHash=(env,webhook)=>hash(env.TELEGRAM_BOT_TOKEN+'\n'+env.TELEGRAM_WEBHOOK_SECRET+'\n'+webhook);
function owner(context){if(typeof context?.userId!=='string'||!context.userId||!['amir','arash'].includes(context.profileId))fail(403,'workspace_required');return context.userId;}
async function input(request,max=5000){if(Number(request.headers.get('Content-Length')||0)>max)fail(413,'payload_too_large');const raw=await request.text();if(new TextEncoder().encode(raw).length>max)fail(413,'payload_too_large');let body;try{body=JSON.parse(raw||'{}');}catch{fail(400,'invalid_json');}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'invalid_payload');return body;}
function exactKeys(body,keys){if(Object.keys(body).some(key=>!keys.includes(key)))fail(400,'unexpected_field');}
function tehranParts(now){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).filter(v=>v.type!=='literal').map(v=>[v.type,v.value]));}
function createdDay(now){const p=tehranParts(now);return p.year+'-'+p.month+'-'+p.day;}
export function telegramQuiet(row,now){const hour=Number(tehranParts(now).hour),start=row.quiet_start,end=row.quiet_end;return start===end?false:start<end?hour>=start&&hour<end:hour>=start||hour<end;}
async function claim(env,row,eventKey,kind,now,limit=DAILY_LIMIT){return stmt(env.GOOGLE_DB,"INSERT INTO telegram_notification_receipts(id,owner_id,event_key,kind,status,created_at,created_day) SELECT ?,?,?,?,'sending',?,? WHERE (SELECT count(*) FROM telegram_notification_receipts WHERE owner_id=? AND created_day=?)<? ON CONFLICT(owner_id,event_key) DO NOTHING RETURNING *",crypto.randomUUID(),row.owner_id,eventKey,kind,now,createdDay(now),row.owner_id,createdDay(now),limit).first();}
async function sendClaim(env,row,receipt,text,fetcher,automatic=false,buttonUrl=null){
 const current=await account(env,row.owner_id);let status='delivery_unknown',messageId=null;
 if(!current||current.chat_id!==row.chat_id||current.profile_id!==row.profile_id||!['amir','arash'].includes(current.profile_id)||!current.enabled||current.updated_at!==row.updated_at)status='cancelled';
 else if(automatic&&!(await checkAutomationMembership(env,row.owner_id,row.profile_id,fetcher)).active)status='cancelled';
 else{try{const result=await provider(env,'sendMessage',{chat_id:row.chat_id,text:(current.profile_id==='arash'?'دکتر آرش انتظار عزیز،':'دکتر امیر هوشنگ گرامی عزیز،')+'\n'+text,link_preview_options:{is_disabled:true},protect_content:true,...(buttonUrl?{reply_markup:{inline_keyboard:[[{text:'بازکردن همین موقعیت در پنل',url:buttonUrl}]]}}:{})},fetcher);if(result.ok&&Number.isSafeInteger(result.result?.message_id)){status='sent';messageId=result.result.message_id;}else if(result.status>=400&&result.status<500){status='failed';if(result.status===403)await stmt(env.GOOGLE_DB,'UPDATE telegram_accounts SET enabled=0,updated_at=? WHERE owner_id=? AND chat_id=?',Date.now(),row.owner_id,row.chat_id).run();}}catch{/* Unknown acceptance is terminal; there is no automatic retry. */}}
 try{await stmt(env.GOOGLE_DB,"UPDATE telegram_notification_receipts SET status=?,telegram_message_id=? WHERE id=? AND owner_id=? AND status='sending'",status,messageId,receipt.id,row.owner_id).run();}catch{status='delivery_unknown';}
 return {id:receipt.id,status};
}
async function telegramStatus(env,id,profileId){
 const absent=missing(env);let ready=!absent.length;try{config(env);}catch{ready=false;}
 const stored=env.GOOGLE_DB?await account(env,id):null,identityMismatch=Boolean(stored&&stored.profile_id!==profileId),row=identityMismatch?null:stored;
 const bot=env.GOOGLE_DB?await stmt(env.GOOGLE_DB,"SELECT * FROM telegram_bot_state WHERE id='bot'").first():null;
 const cfg=ready?config(env):null,validRegistration=Boolean(ready&&bot?.registration_hash===await registrationHash(env,cfg.webhook));
 const status=!ready?'setup_required':identityMismatch?'identity_mismatch':!row?'not_connected':!validRegistration?'webhook_setup_required':!row.enabled?'notifications_disabled':'linked';
 const recoveryAction=!ready||identityMismatch?'contact_administrator':!validRegistration?(profileId==='amir'?'setup_webhook':'contact_administrator'):!row?'connect_telegram':!row.enabled?'enable_notifications':'verify_connection';
 return {profileId,configured:ready,missing:absent,connected:Boolean(row),enabled:Boolean(row?.enabled),notificationsActive:Boolean(ready&&row?.enabled&&validRegistration),status,chatHint:row?'••••'+row.chat_id.slice(-4):null,quietStart:row?.quiet_start??22,quietEnd:row?.quiet_end??8,timeZone:'Asia/Tehran',dailyLimit:DAILY_LIMIT,perRunLimit:GLOBAL_RUN_LIMIT,botUsername:ready&&bot?.identity_hash===await hash(env.TELEGRAM_BOT_TOKEN)?bot.username:null,webhookRegistered:validRegistration,canSetupWebhook:profileId==='amir',scope:env.MAIL_OPPORTUNITY_ALERTS_ENABLED==='true'&&profileId==='arash'?'public_and_own_mail_opportunities':'new_public_opportunities_only',mailOpportunityAlertsEnabled:env.MAIL_OPPORTUNITY_ALERTS_ENABLED==='true'&&profileId==='arash',automaticEmailSending:false,verification:{state:ready&&!identityMismatch?'not_checked':'setup_required',checkedAt:null,code:status==='linked'?null:status,retryable:false,recoveryAction}};
}
// Three read-only Bot API checks at most, with no chat messages, webhook writes,
// token logging or changes to an owner's existing notification preferences.
export async function verifyTelegramConnection(env,id,profileId,fetcher=fetch){
 owner({userId:id,profileId});
 const initial=await telegramStatus(env,id,profileId),checkedAt=new Date().toISOString(),serviceChecks={bot:{state:'not_checked',code:null},webhook:{state:'not_checked',code:null},chat:{state:'not_checked',code:null}};
 if(initial.status==='identity_mismatch')fail(403,'profile_access_denied');
 const result=(status,state,code,recoveryAction,retryable=false)=>({...status,serviceChecks,verification:{state,checkedAt,code,retryable,recoveryAction}});
 if(!initial.configured)return result(initial,'setup_required','telegram_setup_required','contact_administrator');
 if(!initial.connected)return result(initial,'not_connected','telegram_not_connected','connect_telegram');
 const snapshot=await account(env,id),cfg=config(env);
 try{
  const bot=await provider(env,'getMe',{},fetcher);
  if(!bot.ok){if([401,404].includes(bot.status))return result({...initial,notificationsActive:false},'setup_required','telegram_bot_credentials_invalid','contact_administrator');fail(502,'telegram_unavailable');}
  if(bot.result?.is_bot!==true||!/^\w{5,32}$/.test(bot.result?.username||''))fail(502,'telegram_identity_invalid');
  serviceChecks.bot={state:'available',code:null};
  const webhook=await provider(env,'getWebhookInfo',{},fetcher);
  if(!webhook.ok)fail(502,'telegram_unavailable');
  const validWebhook=webhook.result?.url===cfg.webhook;
  const errorAt=Number(webhook.result?.last_error_date)*1000,recentWebhookError=validWebhook&&Number.isFinite(errorAt)&&errorAt>Date.now()-86400000&&errorAt<=Date.now()+60000;
  serviceChecks.webhook=!validWebhook?{state:'setup_required',code:'telegram_webhook_setup_required'}:recentWebhookError?{state:'temporary_failure',code:'telegram_webhook_delivery_error'}:{state:'available',code:null};
  const beforeChat=await account(env,id);if(!beforeChat||beforeChat.chat_id!==snapshot.chat_id||beforeChat.profile_id!==profileId)fail(409,'connection_changed');
  const chat=await provider(env,'getChat',{chat_id:snapshot.chat_id},fetcher);
  if(chat.ok&&String(chat.result?.id)===snapshot.chat_id&&chat.result?.type==='private')serviceChecks.chat={state:'available',code:null};
  else if([400,403,404].includes(chat.status))serviceChecks.chat={state:'unavailable',code:'telegram_chat_unavailable'};
  else fail(502,'telegram_unavailable');
  const current=await telegramStatus(env,id,profileId),currentRow=await account(env,id);
  if(!currentRow||currentRow.chat_id!==snapshot.chat_id||currentRow.profile_id!==profileId)fail(409,'connection_changed');
  const healthyChat=serviceChecks.chat.state==='available',active=healthyChat&&validWebhook&&!recentWebhookError&&current.enabled;
  const status={...current,botUsername:bot.result.username,webhookRegistered:validWebhook,notificationsActive:active,status:!validWebhook?'webhook_setup_required':!healthyChat?'chat_unavailable':!current.enabled?'notifications_disabled':'linked'};
  if(!validWebhook)return result(status,'partial','telegram_webhook_setup_required',profileId==='amir'?'setup_webhook':'contact_administrator');
  if(!healthyChat)return result(status,'partial','telegram_chat_unavailable','restart_telegram_bot');
  if(recentWebhookError)return result(status,'partial','telegram_webhook_delivery_error','retry_verification',true);
  return result(status,'verified',null,current.enabled?'none':'enable_notifications');
 }catch(error){if(!(error instanceof TelegramError))throw error;const current=await telegramStatus(env,id,profileId);return result(current,'temporary_failure',error.code,'retry_verification',true);}
}
export async function handleTelegramRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname;if(!path.startsWith('/api/telegram/'))return null;if(path===WEBHOOK_PATH)return null;
 try{
  const id=owner(context);if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)fail(403,'profile_access_denied');
  if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail(403,'origin_rejected');
  if(path==='/api/telegram/status'&&request.method==='GET'){
   return json(await telegramStatus(env,id,context.profileId));
  }
  if(request.method!=='POST')fail(405,'method_not_allowed');const body=await input(request);
  if(path==='/api/telegram/verify'){exactKeys(body,[]);return json(await verifyTelegramConnection(env,id,context.profileId,fetcher));}
  if(path==='/api/telegram/disconnect'){exactKeys(body,[]);if(!env.GOOGLE_DB)fail(503,'telegram_setup_required');await stmt(env.GOOGLE_DB,'DELETE FROM telegram_accounts WHERE owner_id=?',id).run();await stmt(env.GOOGLE_DB,'DELETE FROM telegram_link_states WHERE owner_id=?',id).run();return json({connected:false,enabled:false,providerRevocationConfirmed:false});}
  const cfg=config(env);
  if(path==='/api/telegram/setup-webhook'){
   exactKeys(body,[]);if(context.profileId!=='amir')fail(403,'bot_setup_owner_required');if(url.origin!==cfg.origin)fail(403,'webhook_origin_mismatch');
   const username=await getBot(env,fetcher,Date.now()),result=await provider(env,'setWebhook',{url:cfg.webhook,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message'],drop_pending_updates:true,max_connections:1},fetcher);
   if(!result.ok||result.result!==true)fail(502,'telegram_webhook_registration_failed');await stmt(env.GOOGLE_DB,"UPDATE telegram_bot_state SET registration_hash=?,webhook_registered_at=? WHERE id='bot'",await registrationHash(env,cfg.webhook),Date.now()).run();return json({registered:true,botUsername:username,messagesSent:false});
  }
  if(path==='/api/telegram/link-code'){
   exactKeys(body,[]);const now=Date.now(),username=await getBot(env,fetcher,now),nonce=random();await stmt(env.GOOGLE_DB,'DELETE FROM telegram_link_states WHERE owner_id=? OR expires_at<?',id,now).run();await stmt(env.GOOGLE_DB,'INSERT INTO telegram_link_states(nonce_hash,owner_id,profile_id,expires_at) VALUES(?,?,?,?)',await hash(nonce),id,context.profileId,now+600000).run();return json({profileId:context.profileId,deepLink:'https://t.me/'+username+'?start='+nonce,expiresAt:new Date(now+600000).toISOString(),messagesSent:false});
  }
  const row=await account(env,id);if(!row)fail(409,'telegram_not_connected');if(row.profile_id!==context.profileId)fail(403,'profile_access_denied');
  if(path==='/api/telegram/settings'){
   exactKeys(body,['enabled','quietStart','quietEnd']);if(typeof body.enabled!=='boolean'||body.quietStart!==undefined&&(!Number.isInteger(body.quietStart)||body.quietStart<0||body.quietStart>23)||body.quietEnd!==undefined&&(!Number.isInteger(body.quietEnd)||body.quietEnd<0||body.quietEnd>23))fail(400,'invalid_notification_settings');
   const at=Date.now(),since=body.enabled&&!row.enabled?new Date(at).toISOString():row.enabled_since;await stmt(env.GOOGLE_DB,'UPDATE telegram_accounts SET enabled=?,enabled_since=?,quiet_start=?,quiet_end=?,updated_at=? WHERE owner_id=?',body.enabled?1:0,since,body.quietStart??row.quiet_start,body.quietEnd??row.quiet_end,at,id).run();return json({enabled:body.enabled,quietStart:body.quietStart??row.quiet_start,quietEnd:body.quietEnd??row.quiet_end,messagesSent:false});
  }
  if(path==='/api/telegram/test'){
   exactKeys(body,[]);if(!row.enabled)fail(409,'telegram_notifications_disabled');const now=Date.now(),receipt=await claim(env,row,'test:'+crypto.randomUUID(),'test',now);if(!receipt)fail(429,'telegram_daily_limit');return json(await sendClaim(env,row,receipt,'پیام آزمایشی Masir؛ اتصال اعلان‌های همین حساب فعال است. این پیام ایمیل یا درخواست شغلی ارسال نمی‌کند.',fetcher));
  }
  fail(404,'not_found');
 }catch(error){return json({error:error instanceof TelegramError?error.code:'telegram_request_failed'},error instanceof TelegramError?error.status:500);}
}
export async function handleTelegramWebhook(request,env){
 try{
  const cfg=config(env),url=new URL(request.url);if(url.pathname!==WEBHOOK_PATH)return json({error:'not_found'},404);if(url.origin!==cfg.origin)return json({error:'webhook_origin_mismatch'},403);if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==env.TELEGRAM_WEBHOOK_SECRET)return json({error:'webhook_access_denied'},403);
  const body=await input(request,131072),message=body.message;
  if(!Number.isSafeInteger(body.update_id)||body.update_id<0||!message||message.chat?.type!=='private'||!Number.isSafeInteger(message.chat?.id)||message.chat.id<=0||message.from?.id!==message.chat.id||message.from?.is_bot===true)return json({accepted:true,linked:false});
  if(/^\/(?:stop|unsubscribe)(?:@[A-Za-z0-9_]{5,32})?\s*$/.test(message.text||'')){await stmt(env.GOOGLE_DB,'DELETE FROM telegram_accounts WHERE chat_id=?',String(message.chat.id)).run();return json({accepted:true,disconnected:true,messagesSent:false});}
  const match=/^\/start(?:@[A-Za-z0-9_]{5,32})?\s+([A-Za-z0-9_-]{43})\s*$/.exec(message.text||'');if(!match)return json({accepted:true,linked:false});
  const nonceHash=await hash(match[1]),now=Date.now(),pending=await stmt(env.GOOGLE_DB,'SELECT * FROM telegram_link_states WHERE nonce_hash=? AND expires_at>?',nonceHash,now).first();if(!pending)return json({accepted:true,linked:false});
  const chat=String(message.chat.id),other=await stmt(env.GOOGLE_DB,'SELECT owner_id FROM telegram_accounts WHERE chat_id=? AND owner_id<>?',chat,pending.owner_id).first();if(other)return json({accepted:true,linked:false});
  const consumed=await stmt(env.GOOGLE_DB,'DELETE FROM telegram_link_states WHERE nonce_hash=? AND expires_at>? RETURNING *',nonceHash,now).first();if(!consumed)return json({accepted:true,linked:false});
  await stmt(env.GOOGLE_DB,"INSERT INTO telegram_accounts(owner_id,profile_id,chat_id,enabled,enabled_since,quiet_start,quiet_end,linked_at,updated_at) VALUES(?,?,?,0,NULL,22,8,?,?) ON CONFLICT(owner_id) DO UPDATE SET profile_id=excluded.profile_id,chat_id=excluded.chat_id,enabled=0,enabled_since=NULL,linked_at=excluded.linked_at,updated_at=excluded.updated_at",pending.owner_id,pending.profile_id,chat,now,now).run();return json({accepted:true,linked:true,messagesSent:false});
 }catch(error){return json({error:error instanceof TelegramError?error.code:'telegram_webhook_failed'},error instanceof TelegramError?error.status:500);}
}
function opportunityText(row){let data={};try{data=JSON.parse(row.data);}catch{}const organization=typeof data.organization==='string'?data.organization:'';const clean=v=>String(v||'').replace(/[\u0000-\u001f]/g,' ').slice(0,400);let url='';try{const u=new URL(row.url);if(u.protocol==='https:'&&!u.username&&!u.password)url=u.href;}catch{}return ['فرصت تازه در Masir',clean(row.title),organization?clean(organization):'',clean(row.country)+' · '+clean(row.state),row.closing_at?'مهلت منبع: '+clean(row.closing_at):'مهلت نامشخص؛ نیازمند بررسی',url].filter(Boolean).join('\n').slice(0,3500);}
export async function dispatchTelegramNotifications(env,fetcher=fetch,now=Date.now()){
 if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_WEBHOOK_SECRET)return {configured:false,attempted:0};
 try{config(env);}catch{return {configured:false,attempted:0};}if(!env.OPPORTUNITY_DB)return {configured:true,attempted:0,status:'public_sources_missing'};
 const publicLimit=row=>env.MAIL_OPPORTUNITY_ALERTS_ENABLED==='true'&&row.profile_id==='arash'?DAILY_LIMIT-3:DAILY_LIMIT;
 const accounts=(await all(env.GOOGLE_DB,'SELECT a.*,(SELECT count(*) FROM telegram_notification_receipts r WHERE r.owner_id=a.owner_id AND r.created_day=?) AS today_count FROM telegram_accounts a WHERE a.enabled=1 AND a.enabled_since IS NOT NULL ORDER BY COALESCE(a.last_dispatch_at,0),a.owner_id LIMIT 2',createdDay(now))).filter(row=>['amir','arash'].includes(row.profile_id)&&row.today_count<publicLimit(row)&&!telegramQuiet(row,now));
 const queues=[];let membershipSkipped=0;
 for(const row of accounts){if(!(await checkAutomationMembership(env,row.owner_id,row.profile_id,fetcher)).active){membershipSkipped++;continue;}const sent=await all(env.GOOGLE_DB,"SELECT event_key FROM telegram_notification_receipts WHERE owner_id=? AND kind='opportunity' AND created_at>=? LIMIT 200",row.owner_id,now-8*86400000);const excluded=sent.map(r=>r.event_key.slice('opportunity:'.length));const since=new Date(Math.max(Date.parse(row.enabled_since),now-7*86400000)).toISOString();const editions=await all(env.OPPORTUNITY_DB,"SELECT * FROM opportunity_editions WHERE first_seen_at>=? AND first_seen_at<=? AND status NOT IN ('closed','source_removed') AND (closing_at IS NULL OR closing_at>?) AND (published_at IS NULL OR published_at<=?) AND id NOT IN (SELECT value FROM json_each(?)) AND (?<>'arash' OR opportunity_type='job') AND ((country='AU' AND profile_scope='both') OR (?='amir' AND country='IT' AND profile_scope='amir')) ORDER BY first_seen_at,id LIMIT 10",since,new Date(now).toISOString(),new Date(now).toISOString(),new Date(now).toISOString(),JSON.stringify(excluded),row.profile_id,row.profile_id);queues.push({row,editions});}
 let attempted=0,claimChecks=0;const receipts=[],touched=new Set();
 for(let pass=0;pass<10&&claimChecks<GLOBAL_RUN_LIMIT;pass++)for(const queue of queues){if(claimChecks>=GLOBAL_RUN_LIMIT)break;const edition=queue.editions[pass];if(!edition)continue;claimChecks++;const receipt=await claim(env,queue.row,'opportunity:'+edition.id,'opportunity',now,publicLimit(queue.row));if(!receipt)continue;attempted++;receipts.push(await sendClaim(env,queue.row,receipt,opportunityText(edition),fetcher,true));touched.add(queue.row.owner_id);}
 for(const id of touched)await stmt(env.GOOGLE_DB,'UPDATE telegram_accounts SET last_dispatch_at=? WHERE owner_id=?',now,id).run();
 return {configured:true,attempted,receipts,membershipSkipped,scope:'new_public_opportunities_only'};
}

const MAIL_ALERT_COOLDOWN=15*60000,MAIL_ALERT_WINDOW=14*86400000;
const MAIL_CV_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const mailOpportunityId=value=>typeof value==='string'&&/^mop_[a-f0-9]{32}$/.test(value);
const alertField=(value,maximum=180)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/(?:https?:\/\/|www\.|t\.me\/)[^\s]+/gi,'').replace(/[^\s<>]+@[^\s<>]+/g,'').replace(/\s+/g,' ').trim().slice(0,maximum):'';
function privateMailLink(row){
 if(!mailOpportunityId(row.id))return null;
 const secondary=row.owner_id===row.root_owner_id+':secondary';
 if(row.owner_id!==row.root_owner_id&&!secondary)return null;
 const url=new URL('https://drgerami-md.ir/aus/');
 url.searchParams.set('mailOpportunity',row.id);url.searchParams.set('mailbox',secondary?'secondary':'primary');return url.href;
}
export function mailOpportunityAlertText(row){
 let fit={},data={},draft=null;
 try{fit=JSON.parse(row.fit_json||'{}');data=JSON.parse(row.data_json||'{}');draft=row.draft_json?JSON.parse(row.draft_json):null;}catch{return null;}
 if(!fit||typeof fit!=='object'||Array.isArray(fit)||!['high','review'].includes(fit.priority)||['restricted','negative'].includes(fit.level1)||['restricted','negative'].includes(fit.sponsorship)||['restricted','negative'].includes(fit.registration))return null;
 const url=privateMailLink(row),title=alertField(row.title),clinic=alertField(row.clinic_name,120),state=alertField(data.state||data.region,50);
 if(!url||!title||draft?.status!=='ready_for_review'||draft.readyForReview!==true||!MAIL_CV_ID.test(draft.cvVersionId||'')||typeof draft.subject!=='string'||!draft.subject.trim()||typeof draft.body!=='string'||draft.body.trim().length<100||!Array.isArray(draft.recipients)||!draft.recipients.length||draft.recipients.some(email=>typeof email!=='string'||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)))return null;
 const supported=value=>['supported','positive'].includes(value),enquiry=draft.outreachMode==='initial_enquiry';
 const lines=[enquiry?'برای این مرکز، یک ایمیل اولیهٔ پرس‌وجوی همکاری آماده شده است.':fit.priority==='high'?'یک موقعیت مرتبط با مسیر GP شما پیدا شده که در اولویت بررسی است.':'یک موقعیت مرتبط با مسیر GP شما پیدا شده که ارزش بررسی دارد.',clinic?'مرکز: '+clinic:null,enquiry?'وجود جای خالی فعلی در این مرکز هنوز تأیید نشده است.':'موقعیت: '+title,state?'ایالت یا منطقه: '+state:null,
  !enquiry&&supported(fit.level1)?'نظارت Level 1 در متن ایمیل مطرح شده؛ ظرفیت فعلی را از مرکز تأیید می‌کنیم.':'امکان نظارت Level 1 هنوز در اطلاعات دریافتی روشن نیست.',
  !enquiry&&supported(fit.sponsorship)?'حمایت کارفرما برای ویزای کار در متن مطرح شده؛ شرایط آن نیاز به تأیید دارد.':'اسپانسرشیپ ویزای کار هنوز باید از کارفرما پرسیده شود.',
  'پیش‌نویس اختصاصی این مورد در پنل آمادهٔ بازبینی است.',
  enquiry?'وارد پنل شوید و کارت این مرکز را باز کنید. پس از بررسی متن، گیرنده و رزومه، «تأیید و ارسال» را بزنید.':'وارد پنل شوید و همین موقعیت را باز کنید. پس از بررسی متن، گیرنده و رزومه، «تأیید و ارسال» را بزنید.',url];
 return {text:lines.filter(Boolean).join('\n').slice(0,3200),url};
}

/** One owner-private mail alert per invocation. This never sends an application. */
export async function dispatchMailOpportunityNotifications(env,{fetcher=fetch,now=Date.now(),sourceValidator=getOwnedMailOpportunityContext}={}){
 if(env.MAIL_OPPORTUNITY_ALERTS_ENABLED!=='true')return {configured:false,attempted:0,status:'disabled'};
 try{config(env);}catch{return {configured:false,attempted:0,status:'setup_required'};}
 if(!Number.isSafeInteger(now)||now<0)return {configured:true,attempted:0,status:'invalid_scheduled_time'};
 const db=env.GOOGLE_DB;
 const exists=await stmt(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='private_mail_opportunities'").first();
 if(!exists)return {configured:true,attempted:0,status:'mail_storage_required'};
 const bot=await stmt(db,"SELECT identity_hash,registration_hash FROM telegram_bot_state WHERE id='bot'").first(),cfg=config(env);
 if(!bot||bot.identity_hash!==await hash(env.TELEGRAM_BOT_TOKEN)||bot.registration_hash!==await registrationHash(env,cfg.webhook))return {configured:true,attempted:0,status:'bot_verification_required'};
 const rows=await all(db,`SELECT o.*,a.chat_id,a.enabled,a.enabled_since,a.quiet_start,a.quiet_end,a.linked_at,a.updated_at AS telegram_updated_at,a.last_dispatch_at
  FROM private_mail_opportunities o JOIN telegram_accounts a ON a.owner_id=o.root_owner_id AND a.profile_id=o.profile_id
  JOIN google_accounts g ON g.owner_id=o.owner_id AND g.profile_id=o.profile_id AND g.google_sub=o.google_sub AND g.status='connected'
  WHERE o.profile_id='arash' AND a.enabled=1 AND a.enabled_since IS NOT NULL AND o.notification_eligible=1
  AND (CASE WHEN json_valid(o.draft_json) THEN json_extract(o.draft_json,'$.status')='ready_for_review' AND json_extract(o.draft_json,'$.readyForReview')=1 ELSE 0 END)
  AND o.status IN ('suggested','reviewed') AND o.received_at>=? AND o.received_at<=? AND o.created_at<=?
  AND (a.last_dispatch_at IS NULL OR a.last_dispatch_at<=?)
  AND (SELECT count(*) FROM telegram_notification_receipts r WHERE r.owner_id=a.owner_id AND r.created_day=?)<?
  AND NOT EXISTS(SELECT 1 FROM mail_automation_suppressions s JOIN json_each(CASE WHEN json_valid(o.draft_json) THEN json_extract(o.draft_json,'$.recipients') ELSE '[]' END) recipient ON lower(s.email)=lower(recipient.value) WHERE s.owner_id=a.owner_id)
  AND NOT EXISTS(SELECT 1 FROM telegram_notification_receipts r WHERE r.owner_id=a.owner_id AND r.event_key='mail_opportunity:'||o.id)
  ORDER BY CASE WHEN json_valid(o.fit_json) THEN CASE WHEN json_extract(o.fit_json,'$.priority')='high' THEN 0 ELSE 1 END ELSE 1 END,coalesce(a.last_dispatch_at,0),o.created_at,o.id LIMIT 5`,now-MAIL_ALERT_WINDOW,now+60000,now+60000,now-MAIL_ALERT_COOLDOWN,createdDay(now),DAILY_LIMIT);
 const candidate=rows.find(row=>!telegramQuiet(row,now));
 if(!candidate)return {configured:true,attempted:0,status:'idle'};
 const message=mailOpportunityAlertText(candidate);
 if(!message){await stmt(db,'UPDATE private_mail_opportunities SET notification_eligible=0 WHERE id=? AND owner_id=? AND google_sub=?',candidate.id,candidate.owner_id,candidate.google_sub).run();return {configured:true,attempted:0,status:'invalid_candidate'};}
 if(!(await checkAutomationMembership(env,candidate.root_owner_id,'arash',fetcher)).active)return {configured:true,attempted:0,status:'membership_unavailable'};
 try{
  const source=await sourceValidator(env,candidate.owner_id,{id:candidate.id},fetcher);
  if(!source||source.id!==candidate.id||source.googleSubject!==candidate.google_sub)throw Object.assign(Error('source_identity_changed'),{code:'source_identity_changed'});
 }catch(error){
  const code=/^[a-z_]{3,80}$/.test(error?.code||'')?error.code:'source_temporarily_unavailable';
  if(['mail_opportunity_source_removed','mail_opportunity_source_changed'].includes(code)){
   await stmt(db,"UPDATE private_mail_opportunities SET status='source_removed',notification_eligible=0 WHERE id=? AND owner_id=? AND google_sub=?",candidate.id,candidate.owner_id,candidate.google_sub).run();
   return {configured:true,attempted:0,status:'source_review_required',code};
  }
  if(code==='mail_opportunity_public_evidence_required'){
   // A legacy/stale ready flag is not public employer proof. Release this
   // notification candidate and make the research queue revisit the source;
   // do not keep it in front of other already-corroborated opportunities.
   await stmt(db,"UPDATE private_mail_opportunities SET notification_eligible=0,draft_json=json_set(CASE WHEN json_valid(draft_json) THEN draft_json ELSE '{}' END,'$.status','needs_source_review','$.readyForReview',json('false'),'$.missing',json('[\"public_employer_verification_required\"]')),updated_at=max(updated_at,?) WHERE id=? AND owner_id=? AND google_sub=? AND updated_at=? AND draft_json IS ?",now,candidate.id,candidate.owner_id,candidate.google_sub,candidate.updated_at,candidate.draft_json).run();
   return {configured:true,attempted:0,status:'source_review_required',code};
  }
  if(code==='mail_opportunity_edit_context_changed'){
   await stmt(db,'UPDATE private_mail_opportunities SET notification_eligible=0 WHERE id=? AND owner_id=? AND google_sub=? AND updated_at=? AND draft_json IS ?',candidate.id,candidate.owner_id,candidate.google_sub,candidate.updated_at,candidate.draft_json).run();
   return {configured:true,attempted:0,status:'needs_owner_edit_review',code};
  }
  return {configured:true,attempted:0,status:'source_check_deferred',code};
 }
 const row=await stmt(db,"UPDATE telegram_accounts SET last_dispatch_at=? WHERE owner_id=? AND profile_id='arash' AND enabled=1 AND chat_id=? AND updated_at=? AND (last_dispatch_at IS NULL OR last_dispatch_at<=?) RETURNING *",now,candidate.root_owner_id,candidate.chat_id,candidate.telegram_updated_at,now-MAIL_ALERT_COOLDOWN).first();
 if(!row)return {configured:true,attempted:0,status:'changed_or_concurrent'};
 const receipt=await stmt(db,`INSERT INTO telegram_notification_receipts(id,owner_id,event_key,kind,status,created_at,created_day)
  SELECT ?,?,?,'opportunity','sending',?,? WHERE
  (SELECT count(*) FROM telegram_notification_receipts WHERE owner_id=? AND created_day=?)<?
  AND EXISTS(SELECT 1 FROM private_mail_opportunities o JOIN google_accounts g ON g.owner_id=o.owner_id AND g.google_sub=o.google_sub AND g.profile_id=o.profile_id AND g.status='connected'
   WHERE o.id=? AND o.root_owner_id=? AND o.owner_id=? AND o.google_sub=? AND o.profile_id='arash' AND o.status IN ('suggested','reviewed') AND o.notification_eligible=1
   AND NOT EXISTS(SELECT 1 FROM mail_automation_suppressions s JOIN json_each(CASE WHEN json_valid(o.draft_json) THEN json_extract(o.draft_json,'$.recipients') ELSE '[]' END) recipient ON lower(s.email)=lower(recipient.value) WHERE s.owner_id=o.root_owner_id))
  ON CONFLICT(owner_id,event_key) DO NOTHING RETURNING *`,crypto.randomUUID(),row.owner_id,'mail_opportunity:'+candidate.id,now,createdDay(now),row.owner_id,createdDay(now),DAILY_LIMIT,candidate.id,row.owner_id,candidate.owner_id,candidate.google_sub).first();
 if(!receipt)return {configured:true,attempted:0,status:'claim_not_acquired'};
 const result=await sendClaim(env,row,receipt,message.text,fetcher,true,message.url);
 let metadataUpdated=true;
 try{await stmt(db,'UPDATE private_mail_opportunities SET notification_claimed_at=?,notification_sent_at=? WHERE id=? AND root_owner_id=? AND owner_id=? AND google_sub=?',now,result.status==='sent'?now:null,candidate.id,row.owner_id,candidate.owner_id,candidate.google_sub).run();}
 catch{metadataUpdated=false;}
 return {configured:true,attempted:1,status:result.status,receipts:[result],metadataUpdated,scope:'own_mail_opportunities_only',automaticEmailSending:false};
}
