// Explicitly linked private chats only. Public opportunities never contain mail/CV content.
import {checkAutomationMembership} from './automation-membership.mjs';
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
async function claim(env,row,eventKey,kind,now){return stmt(env.GOOGLE_DB,"INSERT INTO telegram_notification_receipts(id,owner_id,event_key,kind,status,created_at,created_day) SELECT ?,?,?,?,'sending',?,? WHERE (SELECT count(*) FROM telegram_notification_receipts WHERE owner_id=? AND created_day=?)<? ON CONFLICT(owner_id,event_key) DO NOTHING RETURNING *",crypto.randomUUID(),row.owner_id,eventKey,kind,now,createdDay(now),row.owner_id,createdDay(now),DAILY_LIMIT).first();}
async function sendClaim(env,row,receipt,text,fetcher,automatic=false){
 const current=await account(env,row.owner_id);let status='delivery_unknown',messageId=null;
 if(!current||current.chat_id!==row.chat_id||current.profile_id!==row.profile_id||!['amir','arash'].includes(current.profile_id)||!current.enabled||current.updated_at!==row.updated_at)status='cancelled';
 else if(automatic&&!(await checkAutomationMembership(env,row.owner_id,row.profile_id,fetcher)).active)status='cancelled';
 else{try{const result=await provider(env,'sendMessage',{chat_id:row.chat_id,text:(current.profile_id==='arash'?'دکتر آرش انتظار عزیز،':'دکتر امیر هوشنگ گرامی عزیز،')+'\n'+text,link_preview_options:{is_disabled:true},protect_content:true},fetcher);if(result.ok&&Number.isSafeInteger(result.result?.message_id)){status='sent';messageId=result.result.message_id;}else if(result.status>=400&&result.status<500){status='failed';if(result.status===403)await stmt(env.GOOGLE_DB,'UPDATE telegram_accounts SET enabled=0,updated_at=? WHERE owner_id=? AND chat_id=?',Date.now(),row.owner_id,row.chat_id).run();}}catch{/* Unknown acceptance is terminal; there is no automatic retry. */}}
 try{await stmt(env.GOOGLE_DB,"UPDATE telegram_notification_receipts SET status=?,telegram_message_id=? WHERE id=? AND owner_id=? AND status='sending'",status,messageId,receipt.id,row.owner_id).run();}catch{status='delivery_unknown';}
 return {id:receipt.id,status};
}
export async function handleTelegramRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname;if(!path.startsWith('/api/telegram/'))return null;if(path===WEBHOOK_PATH)return null;
 try{
  const id=owner(context);if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)fail(403,'profile_access_denied');
  if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail(403,'origin_rejected');
  if(path==='/api/telegram/status'&&request.method==='GET'){
   const absent=missing(env);let ready=!absent.length;try{config(env);}catch{ready=false;}
   const row=env.GOOGLE_DB?await account(env,id):null,bot=env.GOOGLE_DB?await stmt(env.GOOGLE_DB,"SELECT * FROM telegram_bot_state WHERE id='bot'").first():null;
   const cfg=ready?config(env):null,validRegistration=Boolean(ready&&bot?.registration_hash===await registrationHash(env,cfg.webhook));
   return json({profileId:context.profileId,configured:ready,missing:absent,connected:Boolean(row),enabled:Boolean(row?.enabled),chatHint:row?'••••'+row.chat_id.slice(-4):null,quietStart:row?.quiet_start??22,quietEnd:row?.quiet_end??8,timeZone:'Asia/Tehran',dailyLimit:DAILY_LIMIT,perRunLimit:GLOBAL_RUN_LIMIT,botUsername:ready&&bot?.identity_hash===await hash(env.TELEGRAM_BOT_TOKEN)?bot.username:null,webhookRegistered:validRegistration,canSetupWebhook:context.profileId==='amir',scope:'new_public_opportunities_only',automaticEmailSending:false});
  }
  if(request.method!=='POST')fail(405,'method_not_allowed');const body=await input(request);
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
  const row=await account(env,id);if(!row)fail(409,'telegram_not_connected');
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
 const accounts=(await all(env.GOOGLE_DB,'SELECT a.*,(SELECT count(*) FROM telegram_notification_receipts r WHERE r.owner_id=a.owner_id AND r.created_day=?) AS today_count FROM telegram_accounts a WHERE a.enabled=1 AND a.enabled_since IS NOT NULL ORDER BY COALESCE(a.last_dispatch_at,0),a.owner_id LIMIT 2',createdDay(now))).filter(row=>['amir','arash'].includes(row.profile_id)&&row.today_count<DAILY_LIMIT&&!telegramQuiet(row,now));
 const queues=[];let membershipSkipped=0;
 for(const row of accounts){if(!(await checkAutomationMembership(env,row.owner_id,row.profile_id,fetcher)).active){membershipSkipped++;continue;}const sent=await all(env.GOOGLE_DB,"SELECT event_key FROM telegram_notification_receipts WHERE owner_id=? AND kind='opportunity' AND created_at>=? LIMIT 200",row.owner_id,now-8*86400000);const excluded=sent.map(r=>r.event_key.slice('opportunity:'.length));const since=new Date(Math.max(Date.parse(row.enabled_since),now-7*86400000)).toISOString();const editions=await all(env.OPPORTUNITY_DB,"SELECT * FROM opportunity_editions WHERE first_seen_at>=? AND first_seen_at<=? AND status NOT IN ('closed','source_removed') AND (closing_at IS NULL OR closing_at>?) AND (published_at IS NULL OR published_at<=?) AND id NOT IN (SELECT value FROM json_each(?)) AND (?<>'arash' OR opportunity_type='job') AND ((country='AU' AND profile_scope='both') OR (?='amir' AND country='IT' AND profile_scope='amir')) ORDER BY first_seen_at,id LIMIT 10",since,new Date(now).toISOString(),new Date(now).toISOString(),new Date(now).toISOString(),JSON.stringify(excluded),row.profile_id,row.profile_id);queues.push({row,editions});}
 let attempted=0,claimChecks=0;const receipts=[],touched=new Set();
 for(let pass=0;pass<10&&claimChecks<GLOBAL_RUN_LIMIT;pass++)for(const queue of queues){if(claimChecks>=GLOBAL_RUN_LIMIT)break;const edition=queue.editions[pass];if(!edition)continue;claimChecks++;const receipt=await claim(env,queue.row,'opportunity:'+edition.id,'opportunity',now);if(!receipt)continue;attempted++;receipts.push(await sendClaim(env,queue.row,receipt,opportunityText(edition),fetcher,true));touched.add(queue.row.owner_id);}
 for(const id of touched)await stmt(env.GOOGLE_DB,'UPDATE telegram_accounts SET last_dispatch_at=? WHERE owner_id=?',now,id).run();
 return {configured:true,attempted,receipts,membershipSkipped,scope:'new_public_opportunities_only'};
}
