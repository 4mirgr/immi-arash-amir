import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleGoogleSendRequest} from '../cloud/google-send.mjs';
import {encryptGoogleSecret} from '../cloud/google-oauth.mjs';
const origin='https://immi-arash-amir.dr-gerami-md.workers.dev';
const clinic=i=>'cl_'+i.toString(16).padStart(20,'0');
const ownCV='11111111-1111-4111-8111-111111111111';
const foreignCV='22222222-2222-4222-8222-222222222222';
function sqlDb(db){
 function wrap(sql,args=[]){return {bind(...params){return wrap(sql,params);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {success:true,meta:db.prepare(sql).run(...args)};}};}
 return {prepare:sql=>wrap(sql),async batch(statements){db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
async function fixture(count=3){
 const db=new DatabaseSync(':memory:');
 for(const file of ['google-schema.sql','google-send-schema.sql','google-mail-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const env={GOOGLE_DB:sqlDb(db),GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_KEY:Buffer.alloc(32,23).toString('base64'),GOOGLE_REDIRECT_URI:origin+'/api/google/callback'};
 const data=Array.from({length:count},(_,i)=>({id:clinic(i+1),data:{email:'clinic'+i+'@example.invalid'}}));
 const calls=[];let sequence=0;
 const fetcher=async(url,options)=>{calls.push({url,options});return Response.json({id:'gmail-ack-'+(++sequence)});};
 async function context(profileId){const userId=profileId+'-user';const cipher=await encryptGoogleSecret(env,userId,{access_token:'synthetic-'+profileId,refresh_token:'synthetic-refresh'});db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(userId,profileId,'google-'+profileId,profileId+'@example.invalid',JSON.stringify(['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/gmail.readonly']),cipher,Date.now()+3600000,'connected',Date.now());return {userId,profileId,rest:async(table,query)=>{
  if(table==='immi_clinics')return data.filter(row=>query.includes(row.id));
  if(table==='immi_cv_versions')return query.includes('profile_id=eq.'+profileId)&&query.includes('id=eq.'+ownCV)&&profileId==='arash'?[{text:'Synthetic CV & no fabricated achievement',version:1}]:[];
  if(table==='immi_presets')return query.includes('profile_id=eq.'+profileId)&&query.includes('id=eq.'+ownCV)&&profileId==='arash'?[{data:{subject:'Preset subject',body:'Preset body'}}]:[];
  throw Error('Unexpected table');
 }};}
 const arash=await context('arash'),amir=await context('amir');
 const request=(path,body,method=body?'POST':'GET')=>new Request(origin+'/api/google/mail/'+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const call=async(path,body,owner=arash,transport=fetcher)=>handleGoogleSendRequest(request(path,body),env,owner,transport);
 return {db,env,data,calls,arash,amir,call};
}
const payload=(ids=[clinic(1)])=>({clinicIds:ids,subject:'Expression of interest',body:'Synthetic application. This test sends no real mail.'});
test('queue resolves recipients and attachments server-side; no send during prepare; repeated enqueue idempotent',async()=>{
 const f=await fixture();let response=await f.call('preview',{...payload(),cvVersionId:ownCV});assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.sender,'arash@example.invalid');assert.equal(preview.recipients[0].attachmentName,'cv-arash-v1.docx');assert.equal(f.db.prepare('select count(*) n from google_send_queue').get().n,0);
 const first=await(await f.call('queue',{...payload(),cvVersionId:ownCV})).json();const again=await(await f.call('queue',{...payload(),cvVersionId:ownCV})).json();assert.equal(first.items[0].id,again.items[0].id);assert.equal(again.items[0].reused,true);assert.equal(f.db.prepare('select count(*) n from google_send_queue').get().n,1);assert.equal(f.calls.length,0);
 const mime=f.db.prepare('select raw_mime from google_send_queue').get().raw_mime;assert.match(mime,/From: arash@example.invalid/);assert.match(mime,/To: clinic0@example.invalid/);assert.match(mime,/cv-arash-v1.docx/);assert(!JSON.stringify(first).includes('raw_mime'));assert(!JSON.stringify(first).includes('synthetic-arash'));
});
test('owner queue isolation and foreign queue IDs cannot dispatch even alongside a valid ID',async()=>{
 const f=await fixture();const arash=(await(await f.call('queue',payload())).json()).items[0];const amir=(await(await f.call('queue',payload(),f.amir)).json()).items[0];const listed=await(await f.call('queue',undefined,f.amir)).json();assert.equal(listed.items.length,1);assert.equal(listed.items[0].id,amir.id);
 assert.equal((await f.call('dispatch',{ids:[arash.id,amir.id]})).status,404);assert.equal(f.calls.length,0);
 const sent=await(await f.call('dispatch',{ids:[arash.id]})).json();assert.equal(sent.items[0].status,'sent');assert.equal(f.calls[0].options.headers.Authorization,'Bearer synthetic-arash');await f.call('dispatch',{ids:[arash.id]});assert.equal(f.calls.length,1);
});
test('caller cannot inject owner, sender, recipient, foreign preset or CV',async()=>{
 const f=await fixture();for(const field of ['userId','profileId','sender','to','recipient','status'])assert.equal((await f.call('queue',{...payload(),[field]:'attacker@example.invalid'})).status,400);
 assert.equal((await f.call('queue',{...payload(),cvVersionId:foreignCV})).status,404);
 assert.equal((await f.call('queue',{clinicIds:[clinic(1)],presetId:foreignCV})).status,404);
 assert.equal((await f.call('queue',{...payload(),subject:'Hello\r\nBcc: attacker@example.invalid'})).status,400);
 assert.equal(f.db.prepare('select count(*) n from google_send_queue').get().n,0);
});
test('normalized mailbox deduplication, suppression and atomic daily reservations cap twenty',async()=>{
 const f=await fixture(23);f.data[1].data.email=f.data[0].data.email.toUpperCase();f.data[2].data.email='-';
 let prepared=await(await f.call('queue',payload(f.data.map(row=>row.id)))).json();assert.equal(prepared.items.length,20);assert.equal(prepared.excluded.some(v=>v.reason==='missing_or_invalid_email'),true);assert.equal(f.db.prepare('select count(*) n from google_send_queue').get().n,20);
 const limit=await(await f.call('queue',{...payload([clinic(1)]),body:'A different prepared message'})).json();assert.equal(limit.items.length,0);assert.equal(limit.excluded[0].reason,'daily_quota_reached');
 await f.call('suppress',{email:f.data[0].data.email});const row=f.db.prepare('select * from google_send_queue where recipient=?').get(f.data[0].data.email);assert.equal(row.status,'suppressed');await f.call('dispatch',{ids:[row.id]});assert.equal(f.calls.length,0);
});
test('ambiguous Gmail failure is terminal delivery_unknown and never retried; provider details sanitized',async()=>{
 const f=await fixture();const item=(await(await f.call('queue',payload())).json()).items[0];let sends=0;
 const failure=async()=>{sends++;throw Error('synthetic secret provider failure');};
 const result=await(await f.call('dispatch',{ids:[item.id]},f.arash,failure)).json();assert.equal(result.items[0].status,'delivery_unknown');assert(!JSON.stringify(result).includes('secret'));await f.call('dispatch',{ids:[item.id]},f.arash,failure);assert.equal(sends,1);
});
test('partial batch preserves individual Gmail acknowledgments and terminal rejection status',async()=>{
 const f=await fixture();const items=(await(await f.call('queue',payload([clinic(1),clinic(2),clinic(3)]))).json()).items;let n=0;
 const transport=async()=>{n++;return n===2?Response.json({error:{message:'private-provider-details'}},{status:403}):Response.json({id:'ack-'+n});};
 const result=await(await f.call('dispatch',{ids:items.map(x=>x.id)},f.arash,transport)).json();assert.deepEqual(result.items.map(x=>x.status),['sent','failed','sent']);assert(!JSON.stringify(result).includes('private-provider-details'));await f.call('dispatch',{ids:items.map(x=>x.id)},f.arash,transport);assert.equal(n,3);
});
test('disconnect/reconnect never switches a prepared queue to a different Google identity',async()=>{
 const f=await fixture();const item=(await(await f.call('queue',payload())).json()).items[0];f.db.prepare("update google_accounts set status='reconnect_required' where owner_id=?").run(f.arash.userId);assert.equal((await f.call('dispatch',{ids:[item.id]})).status,409);assert.equal(f.calls.length,0);
 f.db.prepare("update google_accounts set status='connected',google_sub='new-google-account' where owner_id=?").run(f.arash.userId);const result=await(await f.call('dispatch',{ids:[item.id]})).json();assert.equal(result.items[0].status,'blocked_account_changed');assert.equal(f.calls.length,0);
});
test('concurrent explicit dispatch claims only once and validates batch size',async()=>{
 const f=await fixture();const item=(await(await f.call('queue',payload())).json()).items[0];await Promise.all([f.call('dispatch',{ids:[item.id]}),f.call('dispatch',{ids:[item.id]})]);assert.equal(f.calls.length,1);assert.equal((await f.call('dispatch',{ids:Array(6).fill(item.id)})).status,400);
});
test('sender email is pinned even when Google subject remains the same',async()=>{
 const f=await fixture();const item=(await(await f.call('queue',payload())).json()).items[0];assert.equal(item.sender,'arash@example.invalid');f.db.prepare('update google_accounts set email=? where owner_id=?').run('changed@example.invalid',f.arash.userId);const result=await(await f.call('dispatch',{ids:[item.id]})).json();assert.equal(result.items[0].status,'blocked_account_changed');assert.equal(f.calls.length,0);
});
test('disconnect during dispatch blocks remaining items instead of using cached account token',async()=>{
 const f=await fixture();const items=(await(await f.call('queue',payload([clinic(1),clinic(2),clinic(3)]))).json()).items;let sends=0;
 const transport=async()=>{sends++;f.db.prepare("update google_accounts set status='reconnect_required' where owner_id=?").run(f.arash.userId);return Response.json({id:'only-first-ack'});};
 const result=await(await f.call('dispatch',{ids:items.map(item=>item.id)},f.arash,transport)).json();assert.equal(sends,1);assert.deepEqual(result.items.map(item=>item.status),['sent','blocked_google_connection','blocked_google_connection']);
});
test('Unicode mail subject encoded words are folded safely and raw MIME has only one recipient',async()=>{
 const f=await fixture();await f.call('queue',{...payload(),subject:'معرفی پزشک '.repeat(30)});const raw=f.db.prepare('select raw_mime from google_send_queue').get().raw_mime;const words=raw.match(/=\?UTF-8\?B\?[^?]+\?=/g);assert(words.length>1);assert(words.every(word=>word.length<=75));assert.equal((raw.match(/^To:/gm)||[]).length,1);assert.equal((raw.match(/^Bcc:/gm)||[]).length,0);
});
function seedReply(f,owner=f.arash,overrides={}){
 const message={id:'original-inbox-id',threadId:'original-thread-id',from:'Clinic <clinic-replies@example.invalid>',replyTo:'Practice Team <recruiter@example.invalid>',subject:'Your application',rfcMessageId:'<original.123@clinic.example.invalid>',direction:'received',...overrides};
 f.db.prepare('INSERT INTO google_mail_messages(owner_id,google_sub,gmail_id,thread_id,message_date,priority,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(owner.userId,'google-'+owner.profileId,message.id,message.threadId,Date.now(),'strong',JSON.stringify(message),Date.now());return message;
}
const replyPayload=(message,extra={})=>({replyContext:{messageId:message.id},subject:'Re: '+message.subject,body:'Synthetic reply; no real email.',...extra});
test('reply recipient, references and Gmail thread are derived from the active owner original',async()=>{
 const f=await fixture(),message=seedReply(f);
 const preview=await(await f.call('preview',replyPayload(message))).json();assert.equal(preview.recipients[0].recipient,'recruiter@example.invalid');assert.equal(preview.recipients[0].replyThreadId,message.threadId);assert.equal(f.calls.length,0);
 const first=await(await f.call('queue',replyPayload(message))).json(),again=await(await f.call('queue',replyPayload(message))).json();assert.equal(first.items[0].id,again.items[0].id);assert.equal(first.items[0].replyThreadId,message.threadId);assert.equal(f.calls.length,0);
 const raw=f.db.prepare('SELECT raw_mime FROM google_send_queue').get().raw_mime;assert.match(raw,/^In-Reply-To: <original\.123@clinic\.example\.invalid>$/m);assert.match(raw,/^References: <original\.123@clinic\.example\.invalid>$/m);assert.match(raw,/^To: recruiter@example.invalid$/m);
 const result=await(await f.call('dispatch',{ids:[first.items[0].id]})).json();assert.equal(result.items[0].status,'sent');const gmailBody=JSON.parse(f.calls[0].options.body);assert.equal(gmailBody.threadId,message.threadId);const delivered=Buffer.from(gmailBody.raw,'base64url').toString('utf8');assert.match(delivered,/^In-Reply-To: <original\.123@clinic\.example\.invalid>$/m);await f.call('dispatch',{ids:[first.items[0].id]});assert.equal(f.calls.length,1);
});
test('forged reply thread, recipient, other owner message and mixed clinic/reply fields are rejected',async()=>{
 const f=await fixture(),message=seedReply(f);
 assert.equal((await f.call('queue',replyPayload(message),f.amir)).status,404);
 for(const context of [{messageId:message.id,threadId:'forged-thread'},{messageId:message.id,to:'attacker@example.invalid'},{messageId:message.id,googleSubject:'google-amir'}]){
  const response=await f.call('queue',replyPayload(message,{replyContext:context}));assert([400,403].includes(response.status));
 }
 assert.equal((await f.call('queue',replyPayload(message,{clinicIds:[clinic(1)]}))).status,400);
 assert.equal((await f.call('queue',replyPayload(message,{presetId:ownCV}))).status,400);
 assert.equal((await f.call('queue',replyPayload(message,{subject:'Different thread subject'}))).status,400);
 assert.equal(f.db.prepare('select count(*) n from google_send_queue').get().n,0);assert.equal(f.calls.length,0);
});
test('missing or injectable original RFC headers and outbound messages cannot be threaded',async()=>{
 for(const overrides of [{rfcMessageId:null},{rfcMessageId:'<x@example.invalid>\r\nBcc: attacker@example.invalid'},{rfcMessageId:'not-an-rfc-id'},{direction:'sent'}]){
  const f=await fixture(),message=seedReply(f,f.arash,overrides);assert.equal((await f.call('queue',replyPayload(message))).status,400);assert.equal(f.calls.length,0);
 }
});
test('reconnecting to another Google identity does not expose old reply cache or dispatch old thread',async()=>{
 const f=await fixture(),message=seedReply(f);const first=await(await f.call('queue',replyPayload(message))).json();f.db.prepare('update google_accounts set google_sub=? where owner_id=?').run('replacement-google',f.arash.userId);
 assert.equal((await f.call('queue',replyPayload(message))).status,404);const result=await(await f.call('dispatch',{ids:[first.items[0].id]})).json();assert.equal(result.items[0].status,'blocked_account_changed');assert.equal(f.calls.length,0);
});
test('normal clinic messages do not acquire reply headers or Gmail thread routing',async()=>{
 const f=await fixture();const queued=await(await f.call('queue',payload())).json();assert.equal(queued.items[0].replyThreadId,null);const raw=f.db.prepare('select raw_mime from google_send_queue').get().raw_mime;assert(!raw.includes('In-Reply-To:'));assert(!raw.includes('References:'));await f.call('dispatch',{ids:[queued.items[0].id]});assert.equal(JSON.parse(f.calls[0].options.body).threadId,undefined);
});
test('reply-column upgrade preserves an existing pre-reply queue schema',()=>{
 const db=new DatabaseSync(':memory:');const schema=readFileSync(new URL('../cloud/google-send-schema.sql',import.meta.url),'utf8').replace('  reply_thread_id TEXT,\n','');db.exec(schema);db.exec(readFileSync(new URL('../cloud/google-send-replies.sql',import.meta.url),'utf8'));assert.equal(db.prepare('pragma table_info(google_send_queue)').all().filter(column=>column.name==='reply_thread_id').length,1);
});
