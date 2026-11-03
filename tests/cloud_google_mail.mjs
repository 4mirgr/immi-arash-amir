import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleGoogleMailRequest,normalizeMessage,rankMessage,extractEmails,getOwnedMailReplyContext} from '../cloud/google-mail.mjs';
class D1 {
 constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec(readFileSync(new URL('../cloud/google-mail-schema.sql',import.meta.url),'utf8'));}
 prepare(sql){const db=this.sqlite;let values=[];const self={bind(...v){values=v;return self;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};return self;}
 close(){this.sqlite.close();}
}
const context={userId:'user-arash',profileId:'arash'};
const access=async(_,owner)=>({accessToken:'private-token',email:owner+'@example.invalid',subject:'subject-'+owner,scopes:['https://www.googleapis.com/auth/gmail.readonly']});
const request=(path,body)=>new Request('https://app.example'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const mime=(id,body,extra={})=>({id,threadId:'thread1',internalDate:'1700000000000',snippet:'Visible snippet',labelIds:['INBOX'],payload:{mimeType:'multipart/alternative',headers:[{name:'From',value:'Clinic <clinic@example.invalid>'},{name:'Subject',value:'Interview invitation'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from(body).toString('base64url')}}]},...extra});
const runRequest=async(db,path,body,fetcher,who=context,provider=access)=>handleGoogleMailRequest(request(path,body),{GOOGLE_DB:db},who,fetcher,provider);
test('MIME reads plain text only, bounds content and extracts private contacts',()=>{
 const message=mime('abc1','Please arrange an interview. Reply hr@example.invalid');message.payload.parts.push({mimeType:'text/html',body:{data:Buffer.from('<script>steal()</script>').toString('base64url')}});
 const normalized=normalizeMessage(message);assert.equal(normalized.priority,'strong');assert.equal(normalized.plainBody.includes('steal'),false);assert.deepEqual(normalized.extractedEmails,['clinic@example.invalid','hr@example.invalid']);
 const huge=normalizeMessage(mime('abc2','x'.repeat(50000)));assert.ok(new TextEncoder().encode(huge.plainBody).length<=32768);
 const html=normalizeMessage({...mime('abc3',''),payload:{mimeType:'text/html',body:{data:Buffer.from('<b>not plain</b>').toString('base64url')}}});assert.equal(html.plainBody,'');
});
test('ranking never treats rejection as a positive offer or predicts probability',()=>{
 assert.equal(rankMessage('We cannot offer sponsorship despite your interview').priority,'weak');
 assert.equal(rankMessage('No vacancies. We will interview next year').priority,'weak');
 assert.equal(rankMessage('Please send your CV').priority,'medium');
 assert.equal(rankMessage('Job offer available').priority,'strong');
 assert.equal(rankMessage('Job offer','sent').priority,'weak');
 assert.equal('probability'in rankMessage('Interview'),false);
 assert.deepEqual(extractEmails('A@example.com a@example.com'),['a@example.com']);
});
test('initial sync is bounded and later history updates are incremental',async()=>{
 const db=new D1();try{
  const calls=[];let phase=0;
  const fetcher=async url=>{calls.push(url);assert.equal(url.includes('private-token'),false);if(url.endsWith('/profile'))return response({historyId:'100'});if(url.includes('/messages?'))return response({messages:[{id:'abc1'}],nextPageToken:'older-ignored'});if(url.includes('/history?'))return response({historyId:'110',history:[{messagesAdded:[{message:{id:'abc2'}}]}]});if(url.includes('abc2'))return response(mime('abc2','Your application received'));return response(mime('abc1','Interview tomorrow'));};
  let r=await runRequest(db,'/api/google/mail/sync',{},fetcher);assert.equal(r.status,200);assert.equal((await r.json()).synced,1);assert.equal(calls.length,3);
  r=await runRequest(db,'/api/google/mail/messages',undefined,fetcher);const data=await r.json();assert.equal(data.messages.length,1);assert.equal(data.analysis,'rule_based');assert.equal(JSON.stringify(data).includes('private-token'),false);
  calls.length=0;r=await runRequest(db,'/api/google/mail/sync',{},fetcher);assert.equal(r.status,200);assert.equal(calls.length,2);assert.match(calls[0],/startHistoryId=100/);
  const state=db.sqlite.prepare('select * from google_mail_sync').get();assert.equal(state.history_id,'110');
 }finally{db.close();}
});
test('owner and replacement Google identity never see another cache',async()=>{
 const db=new D1();try{
  const fetcher=async url=>url.endsWith('/profile')?response({historyId:'100'}):url.includes('/messages?')?response({messages:[{id:'abc1'}]}):response(mime('abc1','Interview'));
  await runRequest(db,'/api/google/mail/sync',{},fetcher);
  const own=await (await runRequest(db,'/api/google/mail/messages',undefined,fetcher)).json();assert.equal(own.messages.length,1);
  const other=await (await runRequest(db,'/api/google/mail/messages',undefined,fetcher,{userId:'user-amir',profileId:'amir'})).json();assert.equal(other.messages.length,0);
  const changed=await (await runRequest(db,'/api/google/mail/messages',undefined,fetcher,context,async()=>({accessToken:'new',subject:'other-google',scopes:['https://www.googleapis.com/auth/gmail.readonly']}))).json();assert.equal(changed.messages.length,0);
  const foreign=await runRequest(db,'/api/google/mail/messages?profile=amir',undefined,fetcher);assert.equal(foreign.status,403);
  const extracted=await (await runRequest(db,'/api/google/mail/extract-contact',{id:'abc1'},fetcher,{userId:'user-amir',profileId:'amir'})).json();assert.equal(extracted.error,'message_not_found');
 }finally{db.close();}
});
test('history queue keeps overflow for later bounded passes and cursor advances only once drained',async()=>{
 const db=new D1();try{
  db.sqlite.prepare("insert into google_mail_sync(owner_id,google_sub,history_id) values(?,?,?)").run(context.userId,'subject-'+context.userId,'100');
  let histories=0;
  const fetcher=async url=>{if(url.includes('/history?')){histories++;return response({historyId:'200',history:[{messagesAdded:Array.from({length:25},(_,i)=>({message:{id:'m'+i}}))}]});}const id=new URL(url).pathname.split('/').pop();return response(mime(id,'Hello'));};
  const first=await (await runRequest(db,'/api/google/mail/sync',{},fetcher)).json();assert.equal(first.synced,20);assert.equal(first.pendingCount,5);assert.equal(db.sqlite.prepare('select history_id from google_mail_sync').get().history_id,'100');
  const second=await (await runRequest(db,'/api/google/mail/sync',{},fetcher)).json();assert.equal(second.synced,5);assert.equal(second.pendingCount,0);assert.equal(histories,1);assert.equal(db.sqlite.prepare('select history_id from google_mail_sync').get().history_id,'200');
 }finally{db.close();}
});
test('history expiration requests bounded reset, locks avoid concurrent sync and provider errors are sanitized',async()=>{
 const db=new D1();try{
  db.sqlite.prepare('insert into google_mail_sync(owner_id,google_sub,history_id) values(?,?,?)').run(context.userId,'subject-'+context.userId,'1');
  let result=await runRequest(db,'/api/google/mail/sync',{},async()=>new Response('secret provider details',{status:404}));assert.equal(result.status,409);assert.equal((await result.json()).error,'history_expired_retry_sync');
  assert.equal(db.sqlite.prepare('select history_id from google_mail_sync').get().history_id,null);
  db.sqlite.prepare('update google_mail_sync set lock_until=?').run(Date.now()+60000);
  result=await runRequest(db,'/api/google/mail/sync',{},async()=>{throw Error('should not call');});assert.equal(result.status,409);assert.equal((await result.json()).error,'sync_in_progress');
  db.sqlite.prepare('update google_mail_sync set lock_until=0').run();
  result=await runRequest(db,'/api/google/mail/sync',{},async()=>{throw Error('accessToken=do-not-expose');});assert.equal(result.status,502);assert.equal((await result.text()).includes('do-not-expose'),false);
 }finally{db.close();}
});
test('search and priority parameters are private and invalid state does not escape',async()=>{
 const db=new D1();try{
  const message=normalizeMessage(mime('a1','Interview at clinic'));
  db.sqlite.prepare('insert into google_mail_messages values(?,?,?,?,?,?,?,?)').run(context.userId,'subject-'+context.userId,message.id,message.threadId,message.dateTimestamp,message.priority,JSON.stringify(message),Date.now());
  const result=await runRequest(db,'/api/google/mail/messages?priority=strong&q=interview',undefined,async()=>{throw Error('no network');});assert.equal((await result.json()).messages.length,1);
  assert.equal((await runRequest(db,'/api/google/mail/messages?priority=bogus',undefined,()=>{})).status,400);
  assert.equal((await runRequest(db,'/api/google/mail/messages?limit=1000',undefined,()=>{})).status,400);
  assert.equal((await runRequest(db,'/api/google/mail/sync',{profileId:'amir'},()=>{})).status,400);
  const disconnected=await runRequest(db,'/api/google/mail/messages',undefined,()=>{},context,async()=>{throw Object.assign(Error('private'),{status:401,code:'reconnect_required'});});assert.equal(disconnected.status,401);
 }finally{db.close();}
});

test('read scope is required and reply routing derives from owned cached verified account',async()=>{
 const db=new D1();try{
  const raw=mime('reply1','We can schedule an interview');raw.payload.headers.push({name:'Reply-To',value:'Hiring <hiring@example.invalid>'});
  const message=normalizeMessage(raw);
  db.sqlite.prepare('insert into google_mail_messages values(?,?,?,?,?,?,?,?)').run(context.userId,'subject-'+context.userId,message.id,message.threadId,message.dateTimestamp,message.priority,JSON.stringify(message),Date.now());
  const result=await getOwnedMailReplyContext({GOOGLE_DB:db},context.userId,{messageId:'reply1',threadId:'thread1',to:'hiring@example.invalid'},()=>{},access);
  assert.equal(result.to,'hiring@example.invalid');assert.equal(result.googleSubject,'subject-'+context.userId);
  await assert.rejects(()=>getOwnedMailReplyContext({GOOGLE_DB:db},context.userId,{messageId:'reply1',to:'attacker@example.invalid'},()=>{},access),e=>e.code==='reply_context_mismatch');
  await assert.rejects(()=>getOwnedMailReplyContext({GOOGLE_DB:db},'user-amir',{messageId:'reply1'},()=>{},access),e=>e.code==='message_not_found');
  const denied=await runRequest(db,'/api/google/mail/messages',undefined,()=>{},context,async()=>({accessToken:'not-relevant',subject:'subject-'+context.userId,scopes:[]}));assert.equal(denied.status,403);assert.equal((await denied.json()).error,'gmail_read_scope_required');
  const unknown=await runRequest(db,'/api/google/mail/queue',undefined,()=>{},context,async()=>{throw Error('must not refresh');});assert.equal(unknown,null);
 }finally{db.close();}
});
test('ranking uses only latest reply, excludes quoted history and rejects negated invitations',()=>{
 assert.equal(rankMessage('We are unable to interview you at this stage.').priority,'weak');
 const neutral='Thanks for contacting us.\nOn Tuesday Dr Arash wrote:\n> I would like to arrange a call and discuss a job offer.';
 assert.notEqual(rankMessage(neutral).priority,'strong');
 const positive='We would like to schedule a call and offer supervision.\nOn Monday someone wrote:\n> Unfortunately no vacancies.';
 assert.equal(rankMessage(positive).priority,'strong');
 const signature='Thank you for your email.\n-- \nRecruitment services\nJob offer and interview coordination';
 assert.notEqual(rankMessage(signature).priority,'strong');
 const raw=mime('rank-quote',neutral);raw.snippet='I would like to arrange a call and discuss a job offer.';raw.payload.headers.find(h=>h.name==='Subject').value='Re: Your enquiry';
 const normalized=normalizeMessage(raw);assert.notEqual(normalized.priority,'strong');assert.equal(normalized.plainBody,neutral);assert.ok(normalized.reasons.includes('quoted_history_excluded_from_analysis'));
 assert.equal(rankMessage('We cannot arrange an interview or offer a job.').priority,'weak');
});
