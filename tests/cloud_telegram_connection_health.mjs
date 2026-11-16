import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleTelegramRequest,verifyTelegramConnection} from '../cloud/telegram-notifications.mjs';

const origin='https://immi-arash-amir.dr-gerami-md.workers.dev',arash={userId:'telegram-health-arash',profileId:'arash'},amir={userId:'telegram-health-amir',profileId:'amir'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/telegram-notifications-schema.sql',import.meta.url),'utf8'));
 const binding={prepare(sql){return {bind(...args){const s=db.prepare(sql);return {async first(){return s.get(...args)||null;},async run(){return {meta:s.run(...args)};},async all(){return {results:s.all(...args)};}};}};}};
 const env={GOOGLE_DB:binding,TELEGRAM_BOT_TOKEN:'123456789:abcdefghijklmnopqrstuvwxyz_123456789',TELEGRAM_WEBHOOK_SECRET:'s'.repeat(40)};
 const calls=[];const fetcher=async(url,options)=>{calls.push({method:url.split('/').at(-1),body:JSON.parse(options.body)});assert.equal(options.redirect,'manual');if(url.endsWith('/getMe'))return Response.json({ok:true,result:{is_bot:true,username:'SyntheticHealthBot'}});if(url.endsWith('/getWebhookInfo'))return Response.json({ok:true,result:{url:origin+'/api/telegram/webhook',pending_update_count:0}});if(url.endsWith('/getChat'))return Response.json({ok:true,result:{id:Number(JSON.parse(options.body).chat_id),type:'private',first_name:'PRIVATE'}});assert.fail('Unexpected Telegram operation');};
 const request=(path='verify',body='{}',headers={})=>new Request(origin+'/api/telegram/'+path,{method:path==='status'?'GET':'POST',headers:{Origin:origin,...headers},...(path==='status'?{}:{body})});
 const call=(context=arash,provider=fetcher)=>handleTelegramRequest(request(),env,context,provider);
 return {db,env,calls,fetcher,request,call};
}
function seed(f,context=arash,{chat='12345',enabled=1,profile=context.profileId}={}){f.db.prepare('INSERT OR REPLACE INTO telegram_accounts(owner_id,profile_id,chat_id,enabled,enabled_since,quiet_start,quiet_end,linked_at,updated_at) VALUES(?,?,?,?,?,22,8,?,?)').run(context.userId,profile,chat,enabled,enabled?new Date().toISOString():null,Date.now(),Date.now());}

test('Telegram stored link, disabled notifications and webhook setup have separate recovery states',async()=>{
 const f=fixture();seed(f,arash,{enabled:0});const data=await(await handleTelegramRequest(f.request('status'),f.env,arash,f.fetcher)).json();assert.equal(data.connected,true);assert.equal(data.notificationsActive,false);assert.equal(data.status,'webhook_setup_required');assert.equal(data.verification.recoveryAction,'contact_administrator');assert.equal(f.calls.length,0);
});
test('explicit Telegram check verifies the bot, webhook and own private chat with no sends or changes',async()=>{
 const f=fixture();seed(f);seed(f,amir,{chat:'23456'});const before=f.db.prepare('SELECT * FROM telegram_accounts ORDER BY owner_id').all();
 const data=await(await f.call()).json();assert.equal(data.verification.state,'verified');assert.equal(data.connected,true);assert.equal(data.notificationsActive,true);assert.equal(data.webhookRegistered,true);assert.equal(data.botUsername,'SyntheticHealthBot');assert.deepEqual(f.calls.map(c=>c.method),['getMe','getWebhookInfo','getChat']);assert.equal(f.calls[2].body.chat_id,'12345');assert.deepEqual(f.db.prepare('SELECT * FROM telegram_accounts ORDER BY owner_id').all(),before);assert.equal(f.db.prepare('SELECT count(*) n FROM telegram_notification_receipts').get().n,0);assert(!JSON.stringify(data).includes('PRIVATE'));assert(!JSON.stringify(data).includes('23456'));
});
test('Telegram network failure preserves the own link and never claims verified disconnect',async()=>{
 const f=fixture();seed(f);const data=await(await f.call(arash,async()=>{throw Error('PRIVATE');})).json();assert.equal(data.connected,true);assert.equal(data.verification.state,'temporary_failure');assert.equal(data.verification.recoveryAction,'retry_verification');assert.equal(f.db.prepare('SELECT enabled FROM telegram_accounts').get().enabled,1);assert(!JSON.stringify(data).includes('PRIVATE'));
});
test('wrong webhook destination requires administrator setup without deleting either private chat',async()=>{
 const f=fixture();seed(f);seed(f,amir,{chat:'23456'});const data=await(await f.call(arash,async(url,options)=>url.endsWith('/getWebhookInfo')?Response.json({ok:true,result:{url:'https://untrusted.invalid/PRIVATE'}}):f.fetcher(url,options))).json();assert.equal(data.connected,true);assert.equal(data.notificationsActive,false);assert.equal(data.verification.state,'partial');assert.equal(data.verification.code,'telegram_webhook_setup_required');assert.equal(data.verification.recoveryAction,'contact_administrator');assert.equal(f.db.prepare('SELECT count(*) n FROM telegram_accounts').get().n,2);assert(!JSON.stringify(data).includes('PRIVATE'));
});
test('a blocked own Telegram bot has an actionable restart state and cannot disable another owner',async()=>{
 const f=fixture();seed(f);seed(f,amir,{chat:'23456'});const data=await(await f.call(arash,async(url,options)=>url.endsWith('/getChat')?Response.json({ok:false,description:'PRIVATE'},{status:403}):f.fetcher(url,options))).json();assert.equal(data.verification.state,'partial');assert.equal(data.verification.code,'telegram_chat_unavailable');assert.equal(data.verification.recoveryAction,'restart_telegram_bot');assert.equal(data.notificationsActive,false);assert.equal(f.db.prepare('SELECT sum(enabled) n FROM telegram_accounts').get().n,2);assert(!JSON.stringify(data).includes('PRIVATE'));
});
test('recent webhook delivery errors expose only a safe retry code',async()=>{
 const f=fixture();seed(f);const data=await(await f.call(arash,async(url,options)=>url.endsWith('/getWebhookInfo')?Response.json({ok:true,result:{url:origin+'/api/telegram/webhook',last_error_date:Math.floor(Date.now()/1000),last_error_message:'PRIVATE secret'}}):f.fetcher(url,options))).json();assert.equal(data.verification.state,'partial');assert.equal(data.verification.code,'telegram_webhook_delivery_error');assert.equal(data.verification.retryable,true);assert(!JSON.stringify(data).includes('PRIVATE'));
});
test('missing own Telegram link never probes another owner chat',async()=>{
 const f=fixture();seed(f,amir,{chat:'23456'});const data=await verifyTelegramConnection(f.env,arash.userId,arash.profileId,f.fetcher);assert.equal(data.connected,false);assert.equal(data.verification.recoveryAction,'connect_telegram');assert.equal(f.calls.length,0);
});
test('wrong stored workspace cannot disclose chat hints, verify, or modify notification settings',async()=>{
 const f=fixture();seed(f,arash,{profile:'amir'});const data=await(await handleTelegramRequest(f.request('status'),f.env,arash,f.fetcher)).json();assert.equal(data.connected,false);assert.equal(data.chatHint,null);assert.equal(data.status,'identity_mismatch');assert.equal((await f.call()).status,403);const settings=await handleTelegramRequest(f.request('settings',JSON.stringify({enabled:false})),f.env,arash,f.fetcher);assert.equal(settings.status,403);assert.equal(f.db.prepare('SELECT enabled FROM telegram_accounts').get().enabled,1);assert.equal(f.calls.length,0);
});
test('verification is owner/origin bound and accepts no caller chat or identity',async()=>{
 const f=fixture();seed(f);assert.equal((await handleTelegramRequest(f.request('verify','{}',{Origin:'https://untrusted.invalid'}),f.env,arash,f.fetcher)).status,403);assert.equal((await handleTelegramRequest(f.request('verify',JSON.stringify({chat_id:'23456'})),f.env,arash,f.fetcher)).status,400);assert.equal((await f.call({...arash,profileId:'other'})).status,403);assert.equal(f.calls.length,0);
});
