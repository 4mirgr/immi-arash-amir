import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dispatchMailOpportunityNotifications as dispatchReal,dispatchTelegramNotifications,mailOpportunityAlertText} from '../cloud/telegram-notifications.mjs';
import {upsertOpportunityBatch} from '../cloud/opportunity-store.mjs';

const fixtures=new WeakMap();
const dispatch=(env,options={})=>dispatchReal(env,{sourceValidator:fixtures.get(env)?.sourceValidator,...options});
const NOW=Date.parse('2026-11-18T09:00:00Z');
const id=n=>'mop_'+n.toString(16).padStart(32,'0');
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
function binding(db,counters){return {async batch(items){db.exec('BEGIN');try{for(const item of items)await item.run();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}},prepare(sql){return {bind(...values){return {async first(){counters.queries++;return db.prepare(sql).get(...values)||null;},async all(){counters.queries++;return {results:db.prepare(sql).all(...values)};},async run(){counters.queries++;return {meta:db.prepare(sql).run(...values)};}};},async first(){counters.queries++;return db.prepare(sql).get()||null;}};}};}
async function fixture(){
 const db=new DatabaseSync(':memory:'),pub=new DatabaseSync(':memory:'),counters={queries:0,http:0};
 for(const file of ['telegram-notifications-schema.sql','google-schema.sql','mail-automation-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 // This test exercises the adapter's narrow storage contract independently of
 // the email parser, using synthetic rows and no real message content.
 db.exec(`CREATE TABLE private_mail_opportunities(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,root_owner_id TEXT NOT NULL,profile_id TEXT NOT NULL,google_sub TEXT NOT NULL,gmail_id TEXT,thread_id TEXT,source_url TEXT,title TEXT,clinic_name TEXT,status TEXT,fit_json TEXT,data_json TEXT,draft_json TEXT,created_at INTEGER,updated_at INTEGER,received_at INTEGER,read_at INTEGER,notification_eligible INTEGER,notification_claimed_at INTEGER,notification_sent_at INTEGER)`);
 pub.exec(readFileSync(new URL('../cloud/opportunity-v2-schema.sql',import.meta.url),'utf8'));
 const env={GOOGLE_DB:binding(db,counters),OPPORTUNITY_DB:binding(pub,counters),MAIL_OPPORTUNITY_ALERTS_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123456789:abcdefghijklmnopqrstuvwxyz_123456789',TELEGRAM_WEBHOOK_SECRET:'s'.repeat(40),SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',AUTOMATION_MEMBERSHIP_KEY:'m'.repeat(43)};
 const webhook='https://immi-arash-amir.dr-gerami-md.workers.dev/api/telegram/webhook';
 db.prepare("INSERT INTO telegram_bot_state(id,username,identity_hash,checked_at,registration_hash,webhook_registered_at) VALUES('bot','SyntheticBot',?,?,?,?)").run(await hash(env.TELEGRAM_BOT_TOKEN),NOW,await hash(env.TELEGRAM_BOT_TOKEN+'\n'+env.TELEGRAM_WEBHOOK_SECRET+'\n'+webhook),NOW);
 for(const [owner,profile,chat]of [['arash-owner','arash','23456'],['amir-owner','amir','12345']])db.prepare('INSERT INTO telegram_accounts(owner_id,profile_id,chat_id,enabled,enabled_since,quiet_start,quiet_end,linked_at,updated_at) VALUES(?,?,?,1,?,0,0,?,?)').run(owner,profile,chat,new Date(NOW-86400000).toISOString(),NOW-1000,NOW-1000);
 for(const [owner,profile,sub]of [['arash-owner','arash','arash-sub'],['arash-owner:secondary','arash','arash-second-sub'],['amir-owner','amir','amir-sub']])db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,profile,sub,'synthetic@example.invalid','[]','NOT_A_REAL_TOKEN',NOW+3600000,'connected',NOW);
 const calls=[];let membership=0;
 const fetcher=async(url,options)=>{counters.http++;if(url.includes('/rpc/immi_automation_owner_active')){membership++;assert.equal(JSON.parse(options.body).p_owner,'arash-owner');return Response.json(true);}calls.push({url,options});assert.equal(options.redirect,'manual');assert(url.endsWith('/sendMessage'));return Response.json({ok:true,result:{message_id:100+calls.length}});};
 const seed=(n=1,overrides={})=>{
  const row={id:id(n),owner_id:'arash-owner',root_owner_id:'arash-owner',profile_id:'arash',google_sub:'arash-sub',gmail_id:'synthetic-gmail-'+n,thread_id:'synthetic-thread-'+n,source_url:'https://jobs.example.invalid/gp/'+n,title:'General Practitioner – supervised opportunity',clinic_name:'Synthetic Community Practice',status:'suggested',fit_json:JSON.stringify({priority:'high',level1:'supported',sponsorship:'unknown'}),data_json:JSON.stringify({state:'NSW',privateBody:'NEVER_COPY_PRIVATE_MAIL_BODY'}),draft_json:JSON.stringify({status:'ready_for_review',readyForReview:true,cvVersionId:'33333333-3333-4333-8333-333333333333',recipients:['recruitment@clinic.example.org'],subject:'Synthetic GP application',body:'A'.repeat(200)}),created_at:NOW,updated_at:NOW,received_at:NOW-60000,read_at:null,notification_eligible:1,notification_claimed_at:null,notification_sent_at:null,...overrides};
  const fields=Object.keys(row);db.prepare('INSERT INTO private_mail_opportunities('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...fields.map(k=>row[k]));return row;
 };
 const sourceChecks=[];const sourceValidator=async(_env,owner,selection)=>{sourceChecks.push({owner,selection});assert.equal(owner.replace(/:secondary$/,''),'arash-owner');return {id:selection.id,googleSubject:owner.endsWith(':secondary')?'arash-second-sub':'arash-sub'};};
 fixtures.set(env,{sourceValidator});
 return {db,pub,env,counters,calls,fetcher,seed,sourceValidator,sourceChecks,get membership(){return membership;}};
}

test('disabled alerts read no account; missing schema or stale bot identity cannot send',async()=>{
 const env={MAIL_OPPORTUNITY_ALERTS_ENABLED:'false'};Object.defineProperty(env,'GOOGLE_DB',{get(){throw Error('Disabled must not read');}});assert.equal((await dispatch(env)).status,'disabled');
 const f=await fixture();f.db.exec('DROP TABLE private_mail_opportunities');assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).status,'mail_storage_required');assert.equal(f.calls.length,0);
 const g=await fixture();g.seed();g.db.prepare("UPDATE telegram_bot_state SET identity_hash='changed'").run();assert.equal((await dispatch(g.env,{fetcher:g.fetcher,now:NOW})).status,'bot_verification_required');assert.equal(g.calls.length,0);
});

test('one clear personalized alert links the exact private opportunity and exposes neither raw mail nor recipients',async()=>{
 const f=await fixture(),row=f.seed();f.seed(2,{owner_id:'amir-owner',root_owner_id:'amir-owner',profile_id:'amir',google_sub:'amir-sub'});
 const result=await dispatch(f.env,{fetcher:f.fetcher,now:NOW});assert.equal(result.attempted,1);assert.equal(result.status,'sent');assert.equal(f.membership,2);assert.equal(f.calls.length,1);
 const sent=JSON.parse(f.calls[0].options.body);assert.equal(sent.chat_id,'23456');assert(sent.text.startsWith('دکتر آرش انتظار عزیز،\n'));assert(sent.text.includes(row.clinic_name));assert(sent.text.includes('NSW'));assert(sent.text.includes('آمادهٔ بازبینی'));assert(!sent.text.includes('NEVER_COPY'));assert(!sent.text.includes('example.invalid'));assert(!sent.text.includes('احتمال بالایی'));assert(!sent.text.includes('دکتر امیر'));
 const link=new URL(sent.reply_markup.inline_keyboard[0][0].url);assert.equal(link.origin,'https://drgerami-md.ir');assert.equal(link.pathname,'/aus/');assert.equal(link.searchParams.get('mailOpportunity'),row.id);assert.equal(link.searchParams.get('mailbox'),'primary');
 assert.equal(f.db.prepare('SELECT status FROM telegram_notification_receipts').get().status,'sent');assert.equal(f.db.prepare('SELECT notification_sent_at FROM private_mail_opportunities WHERE id=?').get(row.id).notification_sent_at,NOW);assert(!JSON.stringify(result).includes('23456'));assert(!JSON.stringify(result).includes(f.env.TELEGRAM_BOT_TOKEN));assert(f.counters.queries+f.counters.http<=12);
});

test('both own Google slots use the same own private chat with a root cooldown and edition deduplication',async()=>{
 const f=await fixture();f.seed(1,{owner_id:'arash-owner:secondary',google_sub:'arash-second-sub'});f.seed(2);
 assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).attempted,1);assert.equal(new URL(JSON.parse(f.calls[0].options.body).reply_markup.inline_keyboard[0][0].url).searchParams.get('mailbox'),'secondary');
 assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW+60000})).attempted,0);assert.equal(f.calls.length,1);
 assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW+16*60000})).attempted,1);assert(f.calls.every(call=>JSON.parse(call.options.body).chat_id==='23456'));
 assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW+32*60000})).attempted,0);assert.equal(f.calls.length,2);
});

test('concurrent invocations claim one root cooldown and never duplicate or cross-send notifications',async()=>{
 const f=await fixture();f.seed(1);f.seed(2,{owner_id:'arash-owner:secondary',google_sub:'arash-second-sub'});
 const results=await Promise.all([dispatch(f.env,{fetcher:f.fetcher,now:NOW}),dispatch(f.env,{fetcher:f.fetcher,now:NOW})]);
 assert.equal(results.reduce((sum,result)=>sum+result.attempted,0),1);assert.equal(f.calls.length,1);assert.equal(f.db.prepare('SELECT count(*) n FROM telegram_notification_receipts').get().n,1);
});

test('removed or replaced Google identity, another doctor, expired or future mail and dismissed entries are not alerted',async()=>{
 const f=await fixture();f.seed(1,{google_sub:'former-google-sub'});f.seed(2,{owner_id:'amir-owner',root_owner_id:'amir-owner',profile_id:'amir',google_sub:'amir-sub'});f.seed(3,{received_at:NOW-15*86400000});f.seed(4,{received_at:NOW+120000});f.seed(5,{status:'dismissed'});assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).attempted,0);assert.equal(f.calls.length,0);
 f.seed(6);f.db.prepare("UPDATE google_accounts SET status='reconnect_required' WHERE owner_id='arash-owner'").run();assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).attempted,0);
});

test('known supervision or visa barriers and malformed rows never become positive alerts or injected links',async()=>{
 for(const overrides of [{fit_json:'not-json'},{fit_json:JSON.stringify({priority:'high',level1:'restricted',sponsorship:'supported'})},{fit_json:JSON.stringify({priority:'high',level1:'supported',sponsorship:'restricted'})},{id:'https://attacker.example.invalid/x'}]){
  const f=await fixture();f.seed(1,overrides);assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).attempted,0);assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT notification_eligible FROM private_mail_opportunities').get().notification_eligible,0);
 }
 const f=await fixture(),row=f.seed(1,{clinic_name:'Clinic https://attacker.invalid @attacker',data_json:JSON.stringify({panelUrl:'https://attacker.invalid',state:'WA'})});const text=mailOpportunityAlertText(row);assert(!text.text.includes('https://attacker'));assert(text.url.startsWith('https://drgerami-md.ir/aus/'));
});

test('a pending discovery remains unnotified until its own complete reviewed draft, recipient and CV are available',async()=>{
 const f=await fixture(),row=f.seed(1,{draft_json:JSON.stringify({status:'needs_contact',readyForReview:false,subject:'Not ready',body:''})});
 assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).attempted,0);assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT notification_eligible FROM private_mail_opportunities').get().notification_eligible,1);assert.equal(f.db.prepare('SELECT count(*) n FROM telegram_notification_receipts').get().n,0);
 const complete={status:'ready_for_review',readyForReview:true,cvVersionId:'33333333-3333-4333-8333-333333333333',recipients:['recruitment@clinic.example.org'],subject:'Reviewed GP application',body:'A'.repeat(200)};
 f.db.prepare('UPDATE private_mail_opportunities SET draft_json=? WHERE id=?').run(JSON.stringify(complete),row.id);assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW+1000})).status,'sent');assert.equal(f.calls.length,1);
});

test('notifications respect owner enablement and Tehran quiet hours without losing the opportunity',async()=>{
 const f=await fixture();f.seed();f.db.prepare("UPDATE telegram_accounts SET enabled=0 WHERE owner_id='arash-owner'").run();assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).attempted,0);
 f.db.prepare("UPDATE telegram_accounts SET enabled=1,quiet_start=12,quiet_end=14 WHERE owner_id='arash-owner'").run();assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).attempted,0);assert.equal(f.db.prepare('SELECT notification_eligible FROM private_mail_opportunities').get().notification_eligible,1);assert.equal(f.db.prepare('SELECT count(*) n FROM telegram_notification_receipts').get().n,0);
});

test('fresh membership denial creates no claim; revocation before transport cancels without a Telegram message',async()=>{
 const f=await fixture();f.seed();const denied=async()=>Response.json(false);assert.equal((await dispatch(f.env,{fetcher:denied,now:NOW})).status,'membership_unavailable');assert.equal(f.db.prepare('SELECT count(*) n FROM telegram_notification_receipts').get().n,0);assert.equal(f.db.prepare("SELECT last_dispatch_at FROM telegram_accounts WHERE owner_id='arash-owner'").get().last_dispatch_at,null);
 let checked=0;const revoked=async(url,options)=>url.includes('/rpc/immi_automation_owner_active')?Response.json(++checked===1):f.fetcher(url,options);const result=await dispatch(f.env,{fetcher:revoked,now:NOW});assert.equal(result.status,'cancelled');assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT status FROM telegram_notification_receipts').get().status,'cancelled');
});

test('a live source check is owner-bound and confirmed Gmail removal blocks the alert without consuming an event',async()=>{
 const f=await fixture(),row=f.seed();let checks=0;
 const sourceValidator=async(env,owner,selection,fetcher)=>{checks++;assert.equal(env,f.env);assert.equal(owner,'arash-owner');assert.deepEqual(selection,{id:row.id});assert.equal(fetcher,f.fetcher);throw Object.assign(Error('private source detail'),{code:'mail_opportunity_source_removed',status:409});};
 const result=await dispatch(f.env,{fetcher:f.fetcher,now:NOW,sourceValidator});assert.equal(checks,1);assert.equal(result.status,'source_review_required');assert.equal(result.attempted,0);assert.equal(f.calls.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM telegram_notification_receipts').get().n,0);assert.equal(f.db.prepare('SELECT status FROM private_mail_opportunities').get().status,'source_removed');
 const g=await fixture();g.seed();const deferred=await dispatch(g.env,{fetcher:g.fetcher,now:NOW,sourceValidator:async()=>{throw Object.assign(Error('private temporary details'),{code:'gmail_unavailable',status:502});}});assert.equal(deferred.status,'source_check_deferred');assert.equal(g.db.prepare('SELECT notification_eligible FROM private_mail_opportunities').get().notification_eligible,1);assert.equal(g.db.prepare("SELECT status FROM google_accounts WHERE owner_id='arash-owner'").get().status,'connected');assert.equal(g.calls.length,0);
});

test('a newly suppressed intended recipient cannot trigger a misleading ready-to-send alert',async()=>{
 const f=await fixture();f.seed();f.db.prepare('INSERT INTO mail_automation_suppressions VALUES(?,?,?,?)').run('arash-owner','recruitment@clinic.example.org','gmail_do_not_contact',new Date(NOW).toISOString());assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).attempted,0);assert.equal(f.calls.length,0);assert.equal(f.sourceChecks.length,0);
 const g=await fixture();g.seed();const sourceValidator=async(...args)=>{g.db.prepare('INSERT INTO mail_automation_suppressions VALUES(?,?,?,?)').run('arash-owner','recruitment@clinic.example.org','gmail_do_not_contact',new Date(NOW).toISOString());return g.sourceValidator(...args);};assert.equal((await dispatch(g.env,{fetcher:g.fetcher,now:NOW,sourceValidator})).attempted,0);assert.equal(g.calls.length,0);assert.equal(g.db.prepare('SELECT count(*) n FROM telegram_notification_receipts').get().n,0);
});

test('legacy ready flags without current public proof return to research without blocking other alerts',async()=>{
 const f=await fixture(),row=f.seed();
 const result=await dispatch(f.env,{fetcher:f.fetcher,now:NOW+1000,sourceValidator:async()=>{throw Object.assign(Error('not public employer proof'),{code:'mail_opportunity_public_evidence_required'});}});
 assert.equal(result.status,'source_review_required');assert.equal(result.code,'mail_opportunity_public_evidence_required');assert.equal(f.calls.length,0);
 const saved=f.db.prepare('SELECT notification_eligible,status,updated_at,draft_json FROM private_mail_opportunities WHERE id=?').get(row.id);
 assert.equal(saved.notification_eligible,0);assert.equal(saved.status,'suggested');assert.equal(saved.updated_at,NOW+1000);assert.equal(JSON.parse(saved.draft_json).readyForReview,false);
 assert.deepEqual(JSON.parse(saved.draft_json).missing,['public_employer_verification_required']);assert.equal(f.db.prepare('SELECT count(*) n FROM telegram_notification_receipts').get().n,0);
});

test('a changed owner edit yields its private alert turn without removing the opportunity',async()=>{
 const f=await fixture(),row=f.seed();
 const result=await dispatch(f.env,{fetcher:f.fetcher,now:NOW,sourceValidator:async()=>{throw Object.assign(Error('changed edit'),{code:'mail_opportunity_edit_context_changed'});}});
 assert.equal(result.status,'needs_owner_edit_review');assert.equal(f.calls.length,0);
 const saved=f.db.prepare('SELECT notification_eligible,status,data_json,draft_json FROM private_mail_opportunities WHERE id=?').get(row.id);
 assert.equal(saved.notification_eligible,0);assert.equal(saved.status,'suggested');assert.equal(saved.data_json,row.data_json);assert.equal(saved.draft_json,row.draft_json);
});

test('uncertain or redirected transport is terminal; no automatic replay and no token or provider body in result',async()=>{
 for(const redirect of [false,true]){
  const f=await fixture();f.seed();let sends=0;const failure=async(url,options)=>{if(url.includes('/rpc/immi_automation_owner_active'))return f.fetcher(url,options);sends++;assert.equal(options.redirect,'manual');if(redirect)return new Response(null,{status:302,headers:{Location:'https://attacker.invalid'}});throw Error('PRIVATE_PROVIDER_BODY');};
  const first=await dispatch(f.env,{fetcher:failure,now:NOW});assert.equal(first.status,'delivery_unknown');assert(!JSON.stringify(first).includes('PRIVATE_PROVIDER'));assert.equal((await dispatch(f.env,{fetcher:failure,now:NOW+86400000})).attempted,0);assert.equal(sends,1);
 }
});

test('shared daily cap stops private alerts, while public alerts reserve capacity for private mail suggestions',async()=>{
 const f=await fixture();f.seed();for(let n=0;n<10;n++)f.db.prepare("INSERT INTO telegram_notification_receipts(id,owner_id,event_key,kind,status,created_at,created_day) VALUES(?,?,?,'test','failed',?,'2026-11-18')").run('r'+n,'arash-owner','test:'+n,NOW);assert.equal((await dispatch(f.env,{fetcher:f.fetcher,now:NOW})).attempted,0);assert.equal(f.calls.length,0);
 const g=await fixture();g.seed();g.db.prepare("UPDATE telegram_accounts SET enabled=0 WHERE owner_id='amir-owner'").run();for(let n=0;n<6;n++)g.db.prepare("INSERT INTO telegram_notification_receipts(id,owner_id,event_key,kind,status,created_at,created_day) VALUES(?,?,?,'test','failed',?,'2026-11-18')").run('r'+n,'arash-owner','test:'+n,NOW);
 const source={id:'synthetic-mail-reserve',name:'Synthetic public feed',country:'AU',state:'NSW',trust:'official',allowedHosts:['jobs.example.invalid']};await upsertOpportunityBatch(g.env.OPPORTUNITY_DB,source,[1,2,3].map(n=>({externalId:String(n),title:'Synthetic GP role '+n,url:'https://jobs.example.invalid/public/'+n,opportunityType:'job'})),new Date(NOW).toISOString());
 assert.equal((await dispatchTelegramNotifications(g.env,g.fetcher,NOW)).attempted,1);assert.equal((await dispatchTelegramNotifications(g.env,g.fetcher,NOW+16*60000)).attempted,0);assert.equal((await dispatch(g.env,{fetcher:g.fetcher,now:NOW+16*60000})).attempted,1);
});
