import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleGoogleRequest,handleGoogleCallback,handleGoogleLaunch,googleStartOriginAllowed,getGoogleAccess,encryptGoogleSecret,decryptGoogleSecret,GOOGLE_SCOPES} from '../cloud/google-oauth.mjs';
const origin='https://immi-arash-amir.dr-gerami-md.workers.dev';
const arash={userId:'arash-user',profileId:'arash'},amir={userId:'amir-user',profileId:'amir'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/google-schema.sql',import.meta.url),'utf8'));
 const GOOGLE_DB={prepare(sql){return {bind(...args){const statement=db.prepare(sql);return {async first(){return statement.get(...args)||null;},async run(){return {success:true,meta:statement.run(...args)};},async all(){return {results:statement.all(...args)}}};}};}};
 const env={GOOGLE_DB,GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_KEY:Buffer.alloc(32,17).toString('base64'),GOOGLE_REDIRECT_URI:origin+'/api/google/callback'};
 return {env,db};
}
const req=(route,method='GET',headers={})=>new Request(origin+'/api/google/'+route,{method,headers:{Origin:origin,...headers}});
async function begin(env,context){const response=await handleGoogleRequest(req('start','POST'),env,context);const body=await response.json();return {response,body,url:new URL(body.authorizationUrl),cookie:response.headers.get('Set-Cookie').split(';')[0]};}
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

test('callback diagnostics distinguish missing/mismatched browser binding without consuming state',async()=>{
 const {env,db}=fixture();const p=await begin(env,arash);
 const callbackUrl=origin+'/api/google/callback?state='+p.url.searchParams.get('state')+'&code=secret-callback-code';
 const absent=await handleGoogleCallback(new Request(callbackUrl),env,google());
 const absentHtml=await absent.text();assert.match(absentHtml,/browser_binding\/browser_binding_missing/);
 assert.equal(db.prepare('select count(*) as n from google_oauth_states').get().n,1);
 const wrong=await handleGoogleCallback(new Request(callbackUrl,{headers:{Cookie:'__Host-immi_google_oauth='+'x'.repeat(43)}}),env,google());
 assert.match(await wrong.text(),/browser_binding\/browser_binding_mismatch/);
 assert.equal(db.prepare('select count(*) as n from google_oauth_states').get().n,1);
 const diagnostic=db.prepare('select owner_id,stage,code from google_oauth_diagnostics order by rowid desc').get();assert.deepEqual({...diagnostic},{owner_id:arash.userId,stage:'browser_binding',code:'browser_binding_mismatch'});
 for(const sensitive of ['secret-callback-code',p.cookie,p.url.searchParams.get('state'),env.GOOGLE_CLIENT_SECRET,env.GOOGLE_TOKEN_KEY])assert.equal(absentHtml.includes(sensitive),false);
 assert.equal((await finish(env,p)).status,200);
});
test('callback diagnostics distinguish expired state from already used or unknown state',async()=>{
 const {env,db}=fixture();let p=await begin(env,arash);db.prepare('update google_oauth_states set expires_at=0').run();
 assert.match(await(await finish(env,p)).text(),/state\/state_expired/);
 p=await begin(env,arash);assert.equal((await finish(env,p)).status,200);
 assert.match(await(await finish(env,p)).text(),/state\/state_not_found/);
});
for(const providerCode of ['invalid_client','invalid_grant']){
 test('token rejection diagnostic whitelists '+providerCode+' and never provider details',async()=>{
  const {env,db}=fixture();const p=await begin(env,arash);
  const r=await finish(env,p,async()=>Response.json({error:providerCode,error_description:'PRIVATE-provider-detail secret-callback-code',client_secret:'PRIVATE-secret'},{status:400}));
  const html=await r.text();assert.match(html,new RegExp('token_exchange/token_exchange_'+providerCode));assert.equal(html.includes('PRIVATE'),false);
  assert.equal(db.prepare('select count(*) as n from google_accounts').get().n,0);
  const rows=db.prepare('select * from google_oauth_diagnostics').all();assert.equal(rows[0].code,'token_exchange_'+providerCode);assert.equal(JSON.stringify(rows).includes('PRIVATE'),false);
 });
}
test('unknown provider code is replaced with fixed diagnostic identifier',async()=>{
 const {env,db}=fixture();const p=await begin(env,arash);
 const r=await finish(env,p,async()=>Response.json({error:'<script>PRIVATE-secret</script>'},{status:400}));
 const html=await r.text();assert.match(html,/token_exchange_rejected/);assert.equal(html.includes('PRIVATE-secret'),false);assert.equal(JSON.stringify(db.prepare('select * from google_oauth_diagnostics').all()).includes('PRIVATE-secret'),false);
});
test('storage failure diagnostics stay safe and optional diagnostic storage never changes OAuth outcomes',async()=>{
 const {env,db}=fixture();let p=await begin(env,arash);const prepare=env.GOOGLE_DB.prepare;
 env.GOOGLE_DB.prepare=sql=>{if(sql.startsWith('INSERT INTO google_accounts'))throw Error('PRIVATE-provider-detail with token');return prepare(sql);};
 const failure=await finish(env,p);const html=await failure.text();assert.match(html,/account_store\/account_store_failed/);assert.equal(html.includes('PRIVATE'),false);
 assert.equal(db.prepare('select count(*) as n from google_accounts').get().n,0);
 env.GOOGLE_DB.prepare=sql=>{if(sql.includes('google_oauth_diagnostics'))throw Error('PRIVATE-diagnostic-store');return prepare(sql);};
 p=await begin(env,arash);
 const noCookie=await handleGoogleCallback(new Request(origin+'/api/google/callback?state='+p.url.searchParams.get('state')+'&code=synthetic'),env,google());assert.equal(noCookie.status,400);assert.match(await noCookie.text(),/browser_binding_missing/);
 assert.equal((await finish(env,p)).status,200);
});
test('diagnostic retention is bounded per owner and expired entries are pruned',async()=>{
 const {env,db}=fixture();const p=await begin(env,arash);
 db.prepare('insert into google_oauth_diagnostics values(?,?,?,?,?)').run('old',arash.userId,'state','invalid_state',Date.now()-8*86400000);
 for(let i=0;i<55;i++)await handleGoogleCallback(new Request(origin+'/api/google/callback?state='+p.url.searchParams.get('state')+'&code=synthetic'),env,google());
 assert.equal(db.prepare('select count(*) as n from google_oauth_diagnostics where owner_id=?').get(arash.userId).n,50);
 assert.equal(db.prepare('select count(*) as n from google_oauth_diagnostics where id=?').get('old').n,0);
 assert.equal(db.prepare('select count(*) as n from google_oauth_states').get().n,1);
});

const appOrigin='https://drgerami-md.ir';
async function bridgeStart(env,context=amir){
 env.GOOGLE_APP_ORIGINS=appOrigin;
 const response=await handleGoogleRequest(new Request(origin+'/api/google/start',{method:'POST',headers:{Origin:appOrigin,'Content-Type':'application/json'},body:'{}'}),env,context);
 return {response,body:await response.json()};
}
function launchRequest(ticket,from=appOrigin,method='POST'){
 return new Request(origin+'/api/google/launch',{method,headers:{Origin:from,'Content-Type':'application/x-www-form-urlencoded'},...(method==='POST'?{body:new URLSearchParams({ticket}).toString()}:{})});
}
test('canonical bridge requires explicitly allowed app Origin and retains legacy same-origin consent',async()=>{
 const {env}=fixture();
 assert.equal(googleStartOriginAllowed(new Request(origin+'/api/google/start',{method:'POST',headers:{Origin:appOrigin}}),env),false);
 await assert.rejects(()=>handleGoogleRequest(new Request(origin+'/api/google/start',{method:'POST',headers:{Origin:appOrigin}}),env,amir),e=>e.status===403);
 const p=await bridgeStart(env);assert.equal(p.response.status,200);assert.equal(p.body.launchUrl,origin+'/api/google/launch');assert.match(p.body.launchTicket,/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
 assert.equal(googleStartOriginAllowed(new Request(origin+'/api/google/start',{method:'POST',headers:{Origin:'https://drgerami-md.ir.evil.invalid'}}),env),false);
 const legacy=await begin(env,arash);assert.equal((await finish(env,legacy)).status,200);
});
test('top-level POST launch sets canonical cookie once and callback targets actual app Origin',async()=>{
 const {env,db}=fixture();const p=await bridgeStart(env);
 const launch=await handleGoogleLaunch(launchRequest(p.body.launchTicket),env);
 assert.equal(launch.status,303);assert.equal(launch.headers.get('Referrer-Policy'),'no-referrer');
 const consent=new URL(launch.headers.get('Location'));assert.equal(consent.origin,'https://accounts.google.com');assert.equal(consent.searchParams.get('redirect_uri'),origin+'/api/google/callback');
 const cookie=launch.headers.get('Set-Cookie').split(';')[0];assert.match(launch.headers.get('Set-Cookie'),/__Host-immi_google_oauth=.*; Path=\/; HttpOnly; Secure; SameSite=Lax/);
 const callback=await handleGoogleCallback(new Request(origin+'/api/google/callback?state='+consent.searchParams.get('state')+'&code=synthetic-code',{headers:{Cookie:cookie}}),env,google('google-amir','amir@example.invalid'));
 assert.equal(callback.status,200);const html=await callback.text();assert.match(callback.headers.get('Content-Security-Policy'),/script-src 'nonce-/);assert.ok(html.includes('postMessage('));assert.ok(html.includes(JSON.stringify(appOrigin)));assert.ok(html.includes(p.body.callbackNonce));
 for(const value of [p.body.launchTicket,env.GOOGLE_CLIENT_SECRET,env.GOOGLE_TOKEN_KEY,'synthetic-access-google-amir','synthetic-refresh-google-amir'])assert.equal(html.includes(value),false);
 assert.equal(db.prepare('select google_sub from google_accounts where owner_id=?').get(amir.userId).google_sub,'google-amir');
 await assert.rejects(()=>handleGoogleLaunch(launchRequest(p.body.launchTicket),env),e=>e.code==='invalid_launch');
});
test('bridge refuses transferable GET links, forged/absent origins, token changes and expiry without consuming real launch',async()=>{
 const {env,db}=fixture();const p=await bridgeStart(env);
 await assert.rejects(()=>handleGoogleLaunch(launchRequest(p.body.launchTicket,appOrigin,'GET'),env),e=>e.code==='invalid_launch');
 for(const from of ['https://evil.invalid',origin,'null'])await assert.rejects(()=>handleGoogleLaunch(launchRequest(p.body.launchTicket,from),env),e=>['origin_rejected','invalid_launch'].includes(e.code));
 const noOrigin=new Request(origin+'/api/google/launch',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:p.body.launchTicket})});
 await assert.rejects(()=>handleGoogleLaunch(noOrigin,env),e=>e.code==='origin_rejected');
 const [state,secret]=p.body.launchTicket.split('.');const tampered=state+'.'+(secret[0]==='x'?'y':'x')+secret.slice(1);
 await assert.rejects(()=>handleGoogleLaunch(launchRequest(tampered),env),e=>e.code==='invalid_launch');
 assert.equal((await handleGoogleLaunch(launchRequest(p.body.launchTicket),env)).status,303);
 const expired=await bridgeStart(env);db.prepare('update google_oauth_states set expires_at=0').run();await assert.rejects(()=>handleGoogleLaunch(launchRequest(expired.body.launchTicket),env),e=>e.code==='invalid_launch');
});
test('secondary bridge does not replace either existing primary grant and keeps mailbox checks',async()=>{
 const {env,db}=fixture();env.GOOGLE_SECONDARY_EMAIL='secondary@example.invalid';
 await link(env,arash,'arash-primary','arash@example.invalid');await link(env,amir,'amir-primary','amir@example.invalid');
 const secondary={userId:amir.userId+':secondary',profileId:'amir'},p=await bridgeStart(env,secondary),launch=await handleGoogleLaunch(launchRequest(p.body.launchTicket),env),consent=new URL(launch.headers.get('Location'));
 assert.equal(consent.searchParams.get('login_hint'),'secondary@example.invalid');assert.equal(consent.searchParams.get('scope').includes('calendar.events'),false);
 const callback=await handleGoogleCallback(new Request(origin+'/api/google/callback?state='+consent.searchParams.get('state')+'&code=synthetic-code',{headers:{Cookie:launch.headers.get('Set-Cookie').split(';')[0]}}),env,google('amir-secondary','secondary@example.invalid'));
 assert.equal(callback.status,200);assert.equal((await getGoogleAccess(env,arash.userId)).subject,'arash-primary');assert.equal((await getGoogleAccess(env,amir.userId)).subject,'amir-primary');assert.equal((await getGoogleAccess(env,secondary.userId)).subject,'amir-secondary');assert.equal(db.prepare('select count(*) as n from google_accounts').get().n,3);
});
