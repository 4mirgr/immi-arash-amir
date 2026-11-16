import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleGoogleMailRequest} from '../cloud/google-mail.mjs';
import {encryptGoogleSecret,GOOGLE_SCOPES} from '../cloud/google-oauth.mjs';
const origin='https://mail-recovery.example.invalid',arash={userId:'mail-recovery-arash',profileId:'arash'},amir={userId:'mail-recovery-amir',profileId:'amir'};
async function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['google-schema.sql','google-mail-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const binding={prepare(sql){return {bind(...params){const s=db.prepare(sql);return {async first(){return s.get(...params)||null;},async all(){return {results:s.all(...params)};},async run(){return {meta:s.run(...params)};}};}};}};
 const env={GOOGLE_DB:binding,GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_KEY:Buffer.alloc(32,7).toString('base64'),GOOGLE_REDIRECT_URI:origin+'/api/google/callback'};
 for(const owner of [arash,amir]){const cipher=await encryptGoogleSecret(env,owner.userId,{access_token:'private-access-'+owner.profileId,refresh_token:'private-refresh-'+owner.profileId});db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner.userId,owner.profileId,'subject-'+owner.profileId,owner.profileId+'@example.invalid',JSON.stringify(GOOGLE_SCOPES),cipher,Date.now()+3600000,'connected',Date.now());}
 const call=(fetcher,owner=arash,path='sync')=>handleGoogleMailRequest(new Request(origin+'/api/google/mail/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}),env,owner,fetcher);
 return {env,db,call};
}
const message=id=>({id,threadId:'thread_'+id,internalDate:'1700000000000',labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Application received'}],body:{data:Buffer.from('Synthetic private message').toString('base64url')}}});

test('Gmail refreshes a rejected unexpired access token and keeps subsequent reads on the renewed own token',async()=>{
 const f=await fixture(),other=f.db.prepare('SELECT token_cipher FROM google_accounts WHERE owner_id=?').get(amir.userId).token_cipher;let profiles=0,refreshes=0;const auth=[];
 const result=await f.call(async(url,options)=>{assert.equal(options.redirect,'manual');if(url==='https://oauth2.googleapis.com/token'){refreshes++;assert.equal(new URLSearchParams(options.body).get('refresh_token'),'private-refresh-arash');return Response.json({access_token:'renewed-private-access',expires_in:3600});}auth.push(options.headers.Authorization);if(url.endsWith('/profile')){if(++profiles===1)return Response.json({error:'invalid_token'},{status:401});return Response.json({historyId:'100'});}if(url.includes('/messages?'))return Response.json({messages:[{id:'message1'}]});return Response.json(message('message1'));});
 assert.equal(result.status,200);assert.equal((await result.json()).synced,1);assert.equal(refreshes,1);assert.equal(profiles,2);assert.deepEqual(auth,['Bearer private-access-arash',...Array(3).fill('Bearer renewed-private-access')]);assert.equal(f.db.prepare('SELECT token_cipher FROM google_accounts WHERE owner_id=?').get(amir.userId).token_cipher,other);assert.equal(f.db.prepare('SELECT history_id FROM google_mail_sync').get().history_id,'100');
});
test('a rejected message read does not replay earlier reads, cache writes or the overall mailbox sync',async()=>{
 const f=await fixture(),reads={};let refreshes=0;
 const result=await f.call(async(url,options)=>{if(url==='https://oauth2.googleapis.com/token'){refreshes++;return Response.json({access_token:'renewed-private-access',expires_in:3600});}if(url.endsWith('/profile')){reads.profile=(reads.profile||0)+1;return Response.json({historyId:'100'});}if(url.includes('/messages?')){reads.list=(reads.list||0)+1;return Response.json({messages:[{id:'message1'},{id:'message2'}]});}const id=new URL(url).pathname.split('/').at(-1);reads[id]=(reads[id]||0)+1;if(id==='message2'&&reads[id]===1)return Response.json({error:'invalid_token'},{status:401});return Response.json(message(id));});
 assert.equal(result.status,200);assert.equal((await result.json()).synced,2);assert.equal(refreshes,1);assert.deepEqual(reads,{profile:1,list:1,message1:1,message2:2});assert.equal(f.db.prepare('SELECT count(*) n FROM google_mail_messages').get().n,2);assert.equal(f.db.prepare('SELECT history_id,lock_until FROM google_mail_sync').get().history_id,'100');assert.equal(f.db.prepare('SELECT lock_until FROM google_mail_sync').get().lock_until,0);
});
test('temporary refresh failure preserves grant and history cursor while releasing the mailbox lease',async()=>{
 const f=await fixture(),cipher=f.db.prepare('SELECT token_cipher FROM google_accounts WHERE owner_id=?').get(arash.userId).token_cipher;f.db.prepare('INSERT INTO google_mail_sync(owner_id,google_sub,history_id) VALUES(?,?,?)').run(arash.userId,'subject-arash','100');let histories=0;
 const result=await f.call(async(url)=>{if(url==='https://oauth2.googleapis.com/token')return Response.json({error:'temporarily_unavailable',error_description:'PRIVATE'},{status:503});histories++;return Response.json({error:'invalid_token'},{status:401});});assert.equal(result.status,502);assert.equal((await result.json()).error,'provider_unavailable');assert.equal(histories,1);const row=f.db.prepare('SELECT status,token_cipher FROM google_accounts WHERE owner_id=?').get(arash.userId);assert.equal(row.status,'connected');assert.equal(row.token_cipher,cipher);const state=f.db.prepare('SELECT history_id,lock_until FROM google_mail_sync').get();assert.equal(state.history_id,'100');assert.equal(state.lock_until,0);
});
test('rejected Gmail reads refresh at most once and cannot reuse a removed read scope',async()=>{
 for(const dropScope of [false,true]){const f=await fixture();let refreshes=0,reads=0;const result=await f.call(async url=>{if(url==='https://oauth2.googleapis.com/token'){refreshes++;return Response.json({access_token:'renewed-private-access',expires_in:3600,...(dropScope?{scope:'openid email profile'}:{})});}reads++;return Response.json({error:'invalid_token'},{status:401});});assert.equal(result.status,dropScope?403:401);assert.equal((await result.json()).error,dropScope?'gmail_read_scope_required':'reconnect_required');assert.equal(refreshes,1);assert.equal(reads,dropScope?1:2);}
});
test('a changed Google subject cannot be read under the former mailbox cache or lock',async()=>{
 const f=await fixture();let reads=0,refreshes=0;const result=await handleGoogleMailRequest(new Request(origin+'/api/google/mail/sync',{method:'POST',body:'{}'}),f.env,arash,async()=>{reads++;return Response.json({error:'invalid_token'},{status:401});},async(env,owner,fetcher,options)=>{if(options?.forceRefresh)refreshes++;return {accessToken:options?.forceRefresh?'different-token':'original-token',subject:options?.forceRefresh?'changed-subject':'original-subject',scopes:[GOOGLE_SCOPES[3]]};});assert.equal(result.status,409);assert.equal((await result.json()).error,'connection_changed');assert.equal(reads,1);assert.equal(refreshes,1);assert.equal(f.db.prepare('SELECT count(*) n FROM google_mail_messages').get().n,0);assert.equal(f.db.prepare('SELECT lock_until FROM google_mail_sync').get().lock_until,0);
});
test('Gmail read redirects are rejected without forwarding bearer credentials or replaying requests',async()=>{
 const f=await fixture();let reads=0;const result=await f.call(async(url,options)=>{reads++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/PRIVATE'}});});assert.equal(result.status,502);assert.equal((await result.json()).error,'gmail_redirect_rejected');assert.equal(reads,1);
});
