import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleGoogleRequest,handleGoogleCallback,getGoogleAccess,encryptGoogleSecret,decryptGoogleSecret,GOOGLE_SCOPES} from '../cloud/google-oauth.mjs';
const origin='https://immi-arash-amir.dr-gerami-md.workers.dev';
const arash={userId:'arash-user',profileId:'arash'},amir={userId:'amir-user',profileId:'amir'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/google-schema.sql',import.meta.url),'utf8'));
 const GOOGLE_DB={prepare(sql){return {bind(...args){const statement=db.prepare(sql);return {async first(){return statement.get(...args)||null;},async run(){return {success:true,meta:statement.run(...args)};},async all(){return {results:statement.all(...args)}}};}};}};
 const env={GOOGLE_DB,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_KEY:Buffer.alloc(32,17).toString('base64'),GOOGLE_REDIRECT_URI:origin+'/api/google/callback'};
 return {env,db};
}
const req=(route,method='GET',headers={})=>new Request(origin+'/api/google/'+route,{method,headers:{Origin:origin,...headers}});
async function begin(env,context){const response=await handleGoogleRequest(req('start','POST'),env,context);const body=await response.json();return {response,url:new URL(body.authorizationUrl),cookie:response.headers.get('Set-Cookie').split(';')[0]};}
function google(subject='google-arash',email='arash@example.invalid',tokenExtra={}){return async(url,options)=>{
 if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access-'+subject,refresh_token:'synthetic-refresh-'+subject,expires_in:3600,scope:GOOGLE_SCOPES.join(' '),...tokenExtra});
 if(url==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:subject,email,email_verified:true});
 if(url==='https://oauth2.googleapis.com/revoke')return new Response(null,{status:200});
 throw Error('Unexpected external request');
};}
async function finish(env,pending,fetcher=google()){return handleGoogleCallback(new Request(origin+'/api/google/callback?state='+pending.url.searchParams.get('state')+'&code=synthetic-code',{headers:{Cookie:pending.cookie}}),env,fetcher);}
async function link(env,context,subject,email){const pending=await begin(env,context);const response=await finish(env,pending,google(subject,email));assert.equal(response.status,200);return pending;}

test('missing setup is explicit and cannot create consent URL',async()=>{const result=await handleGoogleRequest(req('status'),{},arash);assert.equal((await result.json()).configured,false);await assert.rejects(()=>handleGoogleRequest(req('start','POST'),{},arash),e=>e.code==='setup_required');});
test('encryption uses random IV and rejects another owner binding',async()=>{const {env}=fixture();const a=await encryptGoogleSecret(env,'ownerA',{refresh_token:'not-real'}),b=await encryptGoogleSecret(env,'ownerA',{refresh_token:'not-real'});assert.notEqual(a,b);assert(!a.includes('not-real'));assert.deepEqual(await decryptGoogleSecret(env,'ownerA',a),{refresh_token:'not-real'});await assert.rejects(()=>decryptGoogleSecret(env,'ownerB',a),e=>e.code==='reconnect_required');});
test('start uses PKCE, offline consent and browser-only secure binding',async()=>{const {env,db}=fixture();const p=await begin(env,arash);assert.equal(p.url.origin,'https://accounts.google.com');assert.equal(p.url.searchParams.get('code_challenge_method'),'S256');assert.equal(p.url.searchParams.get('access_type'),'offline');assert.equal(p.url.searchParams.get('prompt'),'consent select_account');assert.match(p.response.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);const row=db.prepare('select * from google_oauth_states').get();assert.notEqual(row.state_hash,p.url.searchParams.get('state'));assert(!p.response.headers.get('Set-Cookie').includes('synthetic-secret'));assert(!row.verifier_cipher.includes('verifier'));});
test('callback rejects absent/wrong browser cookie without consuming valid state; replay fails',async()=>{const {env}=fixture();const p=await begin(env,arash);const bad=await finish(env,{...p,cookie:'__Host-immi_google_oauth='+'x'.repeat(43)});assert.equal(bad.status,400);const ok=await finish(env,p);assert.equal(ok.status,200);assert.equal((await finish(env,p)).status,400);});
test('expired state, denied authorization and unverified identity never connect',async()=>{const {env,db}=fixture();let p=await begin(env,arash);db.prepare('update google_oauth_states set expires_at=0').run();assert.equal((await finish(env,p)).status,400);p=await begin(env,arash);const badIdentity=async(url,options)=>url.endsWith('/userinfo')?Response.json({sub:'bad',email:'bad@example.invalid',email_verified:false}):google()(url,options);assert.equal((await finish(env,p,badIdentity)).status,400);assert.equal(db.prepare('select count(*) as n from google_accounts').get().n,0);});
test('distinct owner status and access never falls back to another Google account',async()=>{const {env,db}=fixture();await link(env,arash,'google-a','a@example.invalid');assert.equal((await (await handleGoogleRequest(req('status'),env,amir)).json()).connected,false);await assert.rejects(()=>getGoogleAccess(env,amir.userId),e=>e.code==='not_connected');const own=await getGoogleAccess(env,arash.userId);assert.equal(own.subject,'google-a');const stored=db.prepare('select token_cipher from google_accounts').get().token_cipher;assert(!stored.includes(own.accessToken));const status=await (await handleGoogleRequest(req('status'),env,arash)).json();assert.equal(status.email,'a@example.invalid');assert(!JSON.stringify(status).includes('access_token'));});
test('one Google subject cannot be linked to both doctors',async()=>{const {env}=fixture();await link(env,arash,'same-google','a@example.invalid');const p=await begin(env,amir);assert.equal((await finish(env,p,google('same-google','a@example.invalid'))).status,409);assert.equal((await getGoogleAccess(env,arash.userId)).subject,'same-google');await assert.rejects(()=>getGoogleAccess(env,amir.userId),e=>e.code==='not_connected');});
test('refresh revocation marks only its owner reconnect_required',async()=>{const {env,db}=fixture();await link(env,arash,'google-a','a@example.invalid');await link(env,amir,'google-b','b@example.invalid');db.prepare('update google_accounts set expires_at=0 where owner_id=?').run(arash.userId);await assert.rejects(()=>getGoogleAccess(env,arash.userId,async()=>Response.json({error:'invalid_grant'},{status:400})),e=>e.code==='reconnect_required');assert.equal(db.prepare('select status from google_accounts where owner_id=?').get(arash.userId).status,'reconnect_required');assert.equal((await getGoogleAccess(env,amir.userId)).subject,'google-b');});
test('successful refresh encrypts new token and preserves refresh token',async()=>{const {env,db}=fixture();await link(env,arash,'google-a','a@example.invalid');db.prepare('update google_accounts set expires_at=0').run();const refreshed=await getGoogleAccess(env,arash.userId,async()=>Response.json({access_token:'new-access',expires_in:3600}));assert.equal(refreshed.accessToken,'new-access');const row=db.prepare('select * from google_accounts').get();assert.equal((await decryptGoogleSecret(env,arash.userId,row.token_cipher)).refresh_token,'synthetic-refresh-google-a');assert(!row.token_cipher.includes('new-access'));});
test('disconnect does not remove another owner and fails closed during provider outage',async()=>{const {env}=fixture();await link(env,arash,'google-a','a@example.invalid');await link(env,amir,'google-b','b@example.invalid');const result=await handleGoogleRequest(req('disconnect','POST'),env,arash,async()=>{throw Error('private network detail');});assert.deepEqual(await result.json(),{connected:false,status:'not_connected',revocationConfirmed:false});await assert.rejects(()=>getGoogleAccess(env,arash.userId),e=>e.code==='not_connected');assert.equal((await getGoogleAccess(env,amir.userId)).subject,'google-b');});
test('cross-origin and forged owner contexts are refused',async()=>{const {env}=fixture();await assert.rejects(()=>handleGoogleRequest(req('start','POST',{Origin:'https://evil.example'}),env,arash),e=>e.status===403);await assert.rejects(()=>handleGoogleRequest(req('status'),env,{userId:'x',profileId:'admin'}),e=>e.status===403);});
for (const nextSubject of ['google-new','google-original']) {
 test('stale invalid_grant cannot invalidate a newly linked grant: '+nextSubject,async()=>{
  const {env,db}=fixture();
  await link(env,arash,'google-original','original@example.invalid');
  db.prepare('update google_accounts set expires_at=0 where owner_id=?').run(arash.userId);
  await assert.rejects(()=>getGoogleAccess(env,arash.userId,async()=>{
   // User completes a fresh consent while the old refresh response is in flight.
   await link(env,arash,nextSubject,'renewed@example.invalid');
   return Response.json({error:'invalid_grant'},{status:400});
  }),e=>e.code==='reconnect_required');
  const current=db.prepare('select status,google_sub from google_accounts where owner_id=?').get(arash.userId);
  assert.equal(current.status,'connected');
  assert.equal(current.google_sub,nextSubject);
  assert.equal((await getGoogleAccess(env,arash.userId)).subject,nextSubject);
 });
}
