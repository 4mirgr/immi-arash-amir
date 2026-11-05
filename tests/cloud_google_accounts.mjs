import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {googleAccountContext} from '../cloud/google-account-scope.mjs';
import {handleGoogleRequest,handleGoogleCallback,getGoogleAccess,decryptGoogleSecret,encryptGoogleSecret,googleStatus,handleGoogleLaunch,GOOGLE_SCOPES} from '../cloud/google-oauth.mjs';
import {handleGoogleMailRequest} from '../cloud/google-mail.mjs';
const origin='https://immi.example',primary={userId:'synthetic-amir',profileId:'amir'},arash={userId:'synthetic-arash',profileId:'arash'};
const request=(route,method='GET',headers={})=>new Request(origin+'/api/google/'+route,{method,headers:{Origin:origin,...headers}});
const scoped=(route,context=primary)=>googleAccountContext(request(route),context);
function fixture(){const db=new DatabaseSync(':memory:');for(const path of ['google-schema.sql','google-mail-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+path,import.meta.url),'utf8'));const GOOGLE_DB={prepare(sql){return {bind(...values){const stmt=db.prepare(sql);return {async first(){return stmt.get(...values)||null;},async all(){return {results:stmt.all(...values)};},async run(){return {meta:stmt.run(...values)};}};}}}};return {db,env:{GOOGLE_DB,GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_KEY:Buffer.alloc(32,23).toString('base64'),GOOGLE_REDIRECT_URI:origin+'/api/google/callback',GOOGLE_SECONDARY_EMAIL:'second@example.invalid'}};}
async function start(env,route='start',context=primary){const req=request(route,'POST'),response=await handleGoogleRequest(req,env,googleAccountContext(req,context));const body=await response.json();return {response,url:new URL(body.authorizationUrl),cookie:response.headers.get('Set-Cookie').split(';')[0]};}
const provider=(sub,email)=>async url=>url.endsWith('/userinfo')?Response.json({sub,email,email_verified:true}):url.endsWith('/token')?Response.json({access_token:'access-'+sub,refresh_token:'refresh-'+sub,expires_in:3600,scope:GOOGLE_SCOPES.join(' ')}):new Response(null,{status:200});
async function finish(env,pending,sub,email){return handleGoogleCallback(new Request(origin+'/api/google/callback?state='+pending.url.searchParams.get('state')+'&code=synthetic-code',{headers:{Cookie:pending.cookie}}),env,provider(sub,email));}
async function connect(env,route,sub,email,context=primary){const pending=await start(env,route,context),response=await finish(env,pending,sub,email);assert.equal(response.status,200);return pending;}

test('secondary slot is derived from each authenticated owner, never a browser-selected owner',()=>{assert.equal(scoped('status').userId,primary.userId);const secondary=scoped('status?mailbox=secondary');assert.equal(secondary.userId,primary.userId+':secondary');assert.equal(secondary.rootUserId,primary.userId);assert.equal(secondary.profileId,'amir');for(const route of ['status?mailbox=other','status?mailbox=secondary&mailbox=primary'])assert.throws(()=>scoped(route),e=>e.code==='invalid_mailbox');assert.equal(scoped('status?mailbox=secondary',arash).userId,arash.userId+':secondary');assert.throws(()=>scoped('status',{...primary,userId:primary.userId+':secondary'}),e=>e.status===403);assert.equal(scoped('calendar/events?mailbox=secondary').userId,primary.userId+':secondary');assert.throws(()=>scoped('drive/files?mailbox=secondary'),e=>e.code==='mailbox_service_not_enabled');});
test('primary grant remains unchanged while secondary uses separate encryption and least requested scopes',async()=>{const {env,db}=fixture();await connect(env,'start','primary-sub','primary@example.invalid');const before=db.prepare('SELECT * FROM google_accounts WHERE owner_id=?').get(primary.userId);const pending=await connect(env,'start?mailbox=secondary','secondary-sub','second@example.invalid');assert.equal(pending.url.searchParams.get('login_hint'),'second@example.invalid');const scope=pending.url.searchParams.get('scope');assert(scope.includes('gmail.readonly'));assert(scope.includes('gmail.send'));assert(!scope.includes('calendar'));assert(!scope.includes('drive'));assert.deepEqual({...db.prepare('SELECT * FROM google_accounts WHERE owner_id=?').get(primary.userId)},{...before});const second=await getGoogleAccess(env,primary.userId+':secondary');assert.equal(second.subject,'secondary-sub');assert.equal((await getGoogleAccess(env,primary.userId)).subject,'primary-sub');const row=db.prepare('SELECT * FROM google_accounts WHERE owner_id=?').get(primary.userId+':secondary');await assert.rejects(()=>decryptGoogleSecret(env,primary.userId,row.token_cipher),e=>e.code==='reconnect_required');});
test('secondary wrong verified email is rejected without replacing either primary grant',async()=>{const {env,db}=fixture();await connect(env,'start','primary-sub','primary@example.invalid');const pending=await start(env,'start?mailbox=secondary'),bad=await finish(env,pending,'other-sub','other@example.invalid');assert.equal(bad.status,409);assert.match(await bad.text(),/identity_mailbox_mismatch/);assert.equal(db.prepare('SELECT count(*) n FROM google_accounts').get().n,1);assert.equal((await getGoogleAccess(env,primary.userId)).subject,'primary-sub');});
test('secondary setup is explicit and a missing grant never falls back to primary',async()=>{const {env}=fixture();await connect(env,'start','primary-sub','primary@example.invalid');await assert.rejects(()=>getGoogleAccess(env,primary.userId+':secondary'),e=>e.code==='not_connected');const without={...env};delete without.GOOGLE_SECONDARY_EMAIL;await assert.rejects(()=>start(without,'start?mailbox=secondary'),e=>e.code==='secondary_setup_required');assert.equal((await (await handleGoogleRequest(request('status?mailbox=secondary'),without,scoped('status?mailbox=secondary'))).json()).configured,false);assert.equal((await getGoogleAccess(without,primary.userId)).subject,'primary-sub');});
test('Google subject uniqueness applies across both slots and foreign workspaces',async()=>{const {env}=fixture();await connect(env,'start','subject-already-bound','second@example.invalid',arash);const pending=await start(env,'start?mailbox=secondary');assert.equal((await finish(env,pending,'subject-already-bound','second@example.invalid')).status,409);assert.equal((await getGoogleAccess(env,arash.userId)).subject,'subject-already-bound');await assert.rejects(()=>getGoogleAccess(env,primary.userId+':secondary'),e=>e.code==='not_connected');});
test('cached messages with identical Gmail IDs are isolated between slots',async()=>{const {env,db}=fixture();await connect(env,'start','primary-sub','primary@example.invalid');await connect(env,'start?mailbox=secondary','secondary-sub','second@example.invalid');for(const [id,sub,email]of [[primary.userId,'primary-sub','private-primary@example.invalid'],[primary.userId+':secondary','secondary-sub','private-secondary@example.invalid']])db.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(id,sub,'abc1','thread1',1,'medium',JSON.stringify({id:'abc1',extractedEmails:[email]}),1);for(const [slot,expected]of [['primary','private-primary@example.invalid'],['secondary','private-secondary@example.invalid']]){const req=new Request(origin+'/api/google/mail/extract-contact?mailbox='+slot,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'abc1'})}),result=await handleGoogleMailRequest(req,env,googleAccountContext(req,primary),()=>{throw Error('no provider request expected');});assert.equal(result.status,200);assert.deepEqual((await result.json()).emails,[expected]);}});
test('secondary revocation and disconnect leave primary and other doctor intact',async()=>{const {env,db}=fixture();await connect(env,'start','primary-sub','primary@example.invalid');await connect(env,'start?mailbox=secondary','secondary-sub','second@example.invalid');await connect(env,'start','arash-sub','arash@example.invalid',arash);db.prepare('UPDATE google_accounts SET expires_at=0 WHERE owner_id=?').run(primary.userId+':secondary');await assert.rejects(()=>getGoogleAccess(env,primary.userId+':secondary',async()=>Response.json({error:'invalid_grant'},{status:400})),e=>e.code==='reconnect_required');assert.equal((await getGoogleAccess(env,primary.userId)).subject,'primary-sub');const req=request('disconnect?mailbox=secondary','POST');await handleGoogleRequest(req,env,googleAccountContext(req,primary),async()=>new Response(null,{status:200}));assert.equal((await getGoogleAccess(env,primary.userId)).subject,'primary-sub');assert.equal((await getGoogleAccess(env,arash.userId)).subject,'arash-sub');await assert.rejects(()=>getGoogleAccess(env,primary.userId+':secondary'),e=>e.code==='not_connected');});


test('Arash can self-connect a verified own secondary without the Amir email configuration',async()=>{
 const {env,db}=fixture();delete env.GOOGLE_SECONDARY_EMAIL;
 const context=scoped('status?mailbox=secondary',arash);
 const before=await(await handleGoogleRequest(request('status?mailbox=secondary'),env,context)).json();assert.equal(before.configured,true);assert.equal(before.connected,false);
 const unidentified=await googleStatus(env,context.userId);assert.equal(unidentified.configured,false);assert.deepEqual(unidentified.missing,['trusted_profile']);
 await connect(env,'start','arash-primary','arash@example.invalid',arash);
 const primaryBefore={...db.prepare('SELECT * FROM google_accounts WHERE owner_id=?').get(arash.userId)};
 const pending=await start(env,'start?mailbox=secondary',arash);assert.equal(pending.url.searchParams.has('login_hint'),false);
 assert.equal((await finish(env,pending,'arash-secondary','own-other@example.invalid')).status,200);
 assert.equal((await getGoogleAccess(env,context.userId)).email,'own-other@example.invalid');assert.equal((await googleStatus(env,context.userId)).connected,true);
 assert.deepEqual({...db.prepare('SELECT * FROM google_accounts WHERE owner_id=?').get(arash.userId)},primaryBefore);
 await assert.rejects(()=>getGoogleAccess(env,primary.userId+':secondary'),e=>e.code==='not_connected');
});
test('Arash secondary cannot claim another doctor Google identity or replace the bound account during consent',async()=>{
 const {env,db}=fixture();await connect(env,'start','amir-primary','amir@example.invalid');
 let pending=await start(env,'start?mailbox=secondary',arash);let result=await finish(env,pending,'amir-primary','amir@example.invalid');assert.equal(result.status,409);assert.match(await result.text(),/identity_in_use/);
 await connect(env,'start?mailbox=secondary','arash-secondary','own-other@example.invalid',arash);
 const before={...db.prepare('SELECT * FROM google_accounts WHERE owner_id=?').get(arash.userId+':secondary')};
 pending=await start(env,'start?mailbox=secondary&purpose=calendar',arash);assert.equal(pending.url.searchParams.get('login_hint'),'own-other@example.invalid');
 result=await finish(env,pending,'replacement-sub','replacement@example.invalid');assert.equal(result.status,409);assert.match(await result.text(),/identity_mailbox_mismatch/);
 assert.deepEqual({...db.prepare('SELECT * FROM google_accounts WHERE owner_id=?').get(arash.userId+':secondary')},before);
 const disconnect=request('disconnect?mailbox=secondary','POST');await handleGoogleRequest(disconnect,env,googleAccountContext(disconnect,arash),provider('unused','unused@example.invalid'));
 pending=await start(env,'start?mailbox=secondary',arash);assert.equal((await finish(env,pending,'replacement-sub','replacement@example.invalid')).status,200);assert.equal((await getGoogleAccess(env,arash.userId+':secondary')).subject,'replacement-sub');
 assert.equal((await getGoogleAccess(env,primary.userId)).subject,'amir-primary');
});
test('Arash secondary expected identity and optional permissions survive the canonical launch',async()=>{
 const {env,db}=fixture();await connect(env,'start?mailbox=secondary','arash-secondary','own-other@example.invalid',arash);
 const pending=await start(env,'start?mailbox=secondary&purpose=calendar',arash);
 const state= db.prepare('SELECT * FROM google_oauth_states WHERE owner_id=?').get(arash.userId+':secondary');
 const stored=await decryptGoogleSecret(env,'oauth:'+state.state_hash+':'+state.owner_id,state.verifier_cipher);
 assert.deepEqual(stored.expectedIdentity,{email:'own-other@example.invalid',subject:'arash-secondary'});
 // Use a fresh start response for the real one-use ticket below.
 const fresh=await handleGoogleRequest(request('start?mailbox=secondary&purpose=backup','POST'),env,scoped('start?mailbox=secondary',arash)),body=await fresh.json();
 const launched=await handleGoogleLaunch(new Request(origin+'/api/google/launch',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:body.launchTicket})}),env);
 const url=new URL(launched.headers.get('Location'));assert.equal(url.searchParams.get('login_hint'),'own-other@example.invalid');assert(url.searchParams.get('scope').includes('calendar.events'));assert(url.searchParams.get('scope').includes('drive.file'));
 const bad=await finish(env,{url,cookie:launched.headers.get('Set-Cookie').split(';')[0]},'other-sub','other@example.invalid');assert.equal(bad.status,409);assert.match(await bad.text(),/identity_mailbox_mismatch/);
 assert.equal((await getGoogleAccess(env,arash.userId+':secondary')).subject,'arash-secondary');
});


test('a stale first secondary callback cannot overwrite a different identity linked immediately before account storage',async()=>{
 const {env,db}=fixture(),pending=await start(env,'start?mailbox=secondary',arash),id=arash.userId+':secondary';
 const original=env.GOOGLE_DB.prepare.bind(env.GOOGLE_DB);let injected=false;
 env.GOOGLE_DB.prepare=sql=>{
  const statement=original(sql);if(!sql.startsWith('INSERT INTO google_accounts'))return statement;
  return {bind(...values){const bound=statement.bind(...values);return {...bound,async run(){
   if(!injected){injected=true;const cipher=await encryptGoogleSecret(env,id,{access_token:'racing-linked-private-access',refresh_token:'racing-linked-private-refresh'});db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(id,'arash','racing-linked-sub','racing-linked@example.invalid',JSON.stringify(GOOGLE_SCOPES),cipher,Date.now()+3600000,'connected',Date.now());}
   return bound.run();
  }}}};
 };
 const response=await finish(env,pending,'stale-callback-sub','stale-callback@example.invalid');assert.equal(response.status,409);assert.match(await response.text(),/identity_mailbox_mismatch/);
 assert.equal(db.prepare('SELECT google_sub FROM google_accounts WHERE owner_id=?').get(id).google_sub,'racing-linked-sub');assert.equal((await getGoogleAccess(env,id)).accessToken,'racing-linked-private-access');
});
