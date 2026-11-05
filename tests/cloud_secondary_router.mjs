import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHandler} from '../cloud/worker.mjs';
import {encryptGoogleSecret,GOOGLE_SCOPES} from '../cloud/google-oauth.mjs';
const origin='https://workspace.example';
async function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['google-schema.sql','google-mail-schema.sql','google-send-schema.sql','mail-automation-schema.sql','google-mail-project-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const binding={prepare(sql){return {bind(...values){const p=db.prepare(sql);return {async first(){return p.get(...values)||null;},async all(){return {results:p.all(...values)};},async run(){return {meta:p.run(...values)};},_run(){return p.run(...values);}};}};},async batch(items){db.exec('BEGIN');try{for(const item of items)item._run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};
 const env={GOOGLE_DB:binding,SUPABASE_URL:'https://auth.example',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_KEY:Buffer.alloc(32,21).toString('base64'),GOOGLE_REDIRECT_URI:origin+'/api/google/callback',GOOGLE_SECONDARY_EMAIL:'second@example.invalid'};
 for(const [id,profile,subject,email]of [['owner-amir','amir','first-sub','first@example.invalid'],['owner-amir:secondary','amir','second-sub','second@example.invalid'],['owner-arash','arash','arash-sub','arash@example.invalid']]){
  const cipher=await encryptGoogleSecret(env,id,{access_token:'synthetic-'+subject,refresh_token:'synthetic-refresh-'+subject});
  db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(id,profile,subject,email,JSON.stringify(GOOGLE_SCOPES),cipher,Date.now()+3600000,'connected',Date.now());
  const message={id:'abc1',threadId:'thread1',direction:'received',from:subject+'@contact.example.invalid',subject:'Project reply',rfcMessageId:'<'+subject+'@contact.example.invalid>',extractedEmails:[subject+'@contact.example.invalid']};
  db.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(id,subject,message.id,message.threadId,Date.now(),'medium',JSON.stringify(message),Date.now());
 }
 const writes=[],providerCalls=[];
 const fetcher=async(url,options={})=>{
  if(!url.startsWith(env.SUPABASE_URL)){providerCalls.push(url);throw Error('No external Google transport permitted in isolation fixture');}
  const token=options.headers.Authorization,profile=token==='Bearer synthetic-amir'?'amir':token==='Bearer synthetic-arash'?'arash':null;assert(profile);
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'owner-'+profile});
  const u=new URL(url),table=u.pathname.split('/').at(-1);
  if(table==='immi_memberships')return Response.json([{profile_id:profile}]);
  if(table==='immi_drafts'&&options.method==='POST'){writes.push(JSON.parse(options.body));return new Response(null,{status:204});}
  if(table==='immi_clinics')return Response.json([]);
  throw Error('Unexpected fixture REST call '+table);
 };
 const handle=createHandler(fetcher),call=(profile,path,body)=>handle(new Request(origin+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer synthetic-'+profile,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 return {db,call,writes,providerCalls,env};
}
const reply={replyContext:{messageId:'abc1',threadId:'thread1'},subject:'Re: Project reply',body:'Synthetic reply for review only'};

test('authenticated secondary status and draft reply use only the chosen grant and retain actual application owner',async()=>{
 const {call,writes}=await fixture();
 const primary=await(await call('amir','google/status')).json(),secondary=await(await call('amir','google/status?mailbox=secondary')).json();
 assert.equal(primary.email,'first@example.invalid');assert.equal(secondary.email,'second@example.invalid');
 const response=await call('amir','drafts',{...reply,clinicIds:[],mailbox:'secondary'});assert.equal(response.status,201);const draft=await response.json();
 assert.equal(draft.mailbox,'secondary');assert.equal(draft.replyContext.googleSubject,'second-sub');assert.equal(draft.replyContext.to,'second-sub@contact.example.invalid');assert.equal(writes[0].user_id,'owner-amir');assert.equal(writes[0].profile_id,'amir');assert(!JSON.stringify(writes[0]).includes('first-sub'));
});
test('queues and recipient derivation are separate even when both Gmail accounts reuse a message ID',async()=>{
 const {call,providerCalls}=await fixture(),ids={};
 for(const mailbox of ['primary','secondary']){
  const response=await call('amir','google/mail/queue?mailbox='+mailbox,reply);assert.equal(response.status,201);const result=await response.json();ids[mailbox]=result.items[0].id;
  const data=await(await call('amir','google/mail/queue?mailbox='+mailbox)).json();assert.equal(data.items.length,1);assert.equal(data.items[0].sender,mailbox==='primary'?'first@example.invalid':'second@example.invalid');assert.equal(data.items[0].recipient,mailbox==='primary'?'first-sub@contact.example.invalid':'second-sub@contact.example.invalid');
 }
 assert.equal((await call('amir','google/mail/dispatch?mailbox=secondary',{ids:[ids.primary]})).status,404);assert.equal((await call('amir','google/mail/dispatch?mailbox=primary',{ids:[ids.secondary]})).status,404);assert.deepEqual(providerCalls,[]);
});
test('unconnected Arash secondary is available for consent but cannot reuse Amir or a primary grant',async()=>{
 const {call,writes,providerCalls}=await fixture();const response=await call('arash','google/status?mailbox=secondary');assert.equal(response.status,200);const status=await response.json();assert.equal(status.configured,true);assert.equal(status.connected,false);assert.equal(status.email,null);
 for(const [path,body]of [['google/mail/messages?mailbox=secondary',undefined],['google/mail/queue?mailbox=secondary',reply],['google/mail/dispatch?mailbox=secondary',{ids:[]}],['drafts',{...reply,clinicIds:[],mailbox:'secondary'}]])assert.equal((await call('arash',path,body)).status,path.startsWith('google/mail/dispatch')?400:409,path); // Empty dispatch is rejected before token lookup.
 assert.equal((await call('arash','google/status?profile=amir&mailbox=secondary')).status,403);assert.equal(writes.length,0);assert.deepEqual(providerCalls,[]);
});
test('authenticated Arash second mailbox replies use his own cached identity and actual application owner',async()=>{
 const {db,env,call,writes,providerCalls}=await fixture(),id='owner-arash:secondary';
 const cipher=await encryptGoogleSecret(env,id,{access_token:'arash-second-token',refresh_token:'synthetic-arash-refresh'});
 db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(id,'arash','arash-second-sub','arash-second@example.invalid',JSON.stringify(GOOGLE_SCOPES),cipher,Date.now()+3600000,'connected',Date.now());
 const message={id:'abc1',threadId:'thread1',direction:'received',from:'arash-target@contact.example.invalid',subject:'Project reply',rfcMessageId:'<arash-target@example.invalid>',extractedEmails:['arash-target@contact.example.invalid']};
 db.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(id,'arash-second-sub',message.id,message.threadId,Date.now(),'medium',JSON.stringify(message),Date.now());
 const own=await(await call('arash','google/status?mailbox=secondary')).json();assert.equal(own.email,'arash-second@example.invalid');assert.equal((await(await call('amir','google/status?mailbox=secondary')).json()).email,'second@example.invalid');
 const response=await call('arash','drafts',{...reply,clinicIds:[],mailbox:'secondary'});assert.equal(response.status,201);const draft=await response.json();assert.equal(draft.replyContext.googleSubject,'arash-second-sub');assert.equal(draft.replyContext.to,'arash-target@contact.example.invalid');assert.equal(writes[0].user_id,'owner-arash');assert.equal(writes[0].profile_id,'arash');assert(!JSON.stringify(writes).includes('second-sub@contact.example.invalid'));assert.deepEqual(providerCalls,[]);
});
test('missing selected secondary connection never falls back to existing primary for draft or reply preview',async()=>{
 const {call,db,writes,providerCalls}=await fixture();db.prepare('DELETE FROM google_accounts WHERE owner_id=?').run('owner-amir:secondary');
 assert.equal((await call('amir','drafts',{...reply,clinicIds:[],mailbox:'secondary'})).status,409);assert.equal((await call('amir','google/mail/preview?mailbox=secondary',reply)).status,409);assert.equal(writes.length,0);assert.deepEqual(providerCalls,[]);assert.equal((await(await call('amir','google/status')).json()).email,'first@example.invalid');
});
