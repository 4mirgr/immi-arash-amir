import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleGoogleRequest,encryptGoogleSecret,decryptGoogleSecret,getGoogleAccess,GOOGLE_SCOPES} from '../cloud/google-oauth.mjs';

const origin='https://connection.example.invalid';
const arash={userId:'health-arash',profileId:'arash'},amir={userId:'health-amir',profileId:'amir'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/google-schema.sql',import.meta.url),'utf8'));
 const binding={prepare(sql){return {bind(...args){const s=db.prepare(sql);return {async first(){return s.get(...args)||null;},async run(){return {meta:s.run(...args)};},async all(){return {results:s.all(...args)};}};}};}};
 const env={GOOGLE_DB:binding,GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_KEY:Buffer.alloc(32,8).toString('base64'),GOOGLE_REDIRECT_URI:origin+'/api/google/callback'};
 const calls=[];
 const fetcher=async(url,options)=>{calls.push({url,options});assert.equal(options.redirect,'manual');if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'renewed-private-access',expires_in:3600});if(url==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:'google-arash',email:'arash@example.invalid',email_verified:true});return Response.json({kind:'safe-metadata'});};
 const request=(route='verify',body='{}',headers={})=>new Request(origin+'/api/google/'+route,{method:route==='status'?'GET':'POST',headers:{Origin:origin,...headers},...(route==='status'?{}:{body})});
 const call=(context=arash,provider=fetcher)=>handleGoogleRequest(request(),env,context,provider);
 return {db,env,calls,fetcher,request,call};
}
async function seed(f,context=arash,{scopes=GOOGLE_SCOPES,expires=Date.now()+3600000,status='connected',subject='google-'+context.profileId,tokens={access_token:'private-access-'+context.profileId,refresh_token:'private-refresh-'+context.profileId}}={}){
 const cipher=await encryptGoogleSecret(f.env,context.userId,tokens);
 f.db.prepare('INSERT OR REPLACE INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(context.userId,context.profileId,subject,context.profileId+'@example.invalid',JSON.stringify(scopes),cipher,expires,status,Date.now());return cipher;
}

test('stored revoked permissions cannot advertise active Gmail or Calendar capabilities',async()=>{
 const f=fixture();await seed(f,arash,{status:'reconnect_required'});
 const status=await(await handleGoogleRequest(f.request('status'),f.env,arash)).json();
 assert.equal(status.connected,false);assert(Object.values(status.capabilities).every(v=>v===false));assert.equal(status.verification.recoveryAction,'reconnect_google');assert.equal(f.calls.length,0);
});
test('explicit connection check refreshes an expired own grant and verifies identity and scoped services without sends',async()=>{
 const f=fixture();await seed(f,arash,{expires:0});await seed(f,amir);const other=f.db.prepare('SELECT token_cipher FROM google_accounts WHERE owner_id=?').get(amir.userId).token_cipher;
 const data=await(await f.call()).json();assert.equal(data.verification.state,'verified');assert.equal(data.connected,true);assert.equal(data.serviceChecks.calendar.state,'available');assert.equal(data.serviceChecks.gmailRead.state,'available');assert.equal(data.serviceChecks.gmailSend.state,'scope_recorded');
 assert.equal(f.calls.length,5);assert(f.calls.every(c=>!c.url.includes('send')&&!c.url.includes('revoke')));assert(f.calls.filter(c=>!c.url.endsWith('/token')).every(c=>!c.options.method||c.options.method==='GET'));
 assert.equal(f.db.prepare('SELECT token_cipher FROM google_accounts WHERE owner_id=?').get(amir.userId).token_cipher,other);assert(!JSON.stringify(data).includes('private-'));assert(!JSON.stringify(data).includes('google-arash'));
});
test('provider failure during refresh preserves stored grant and distinguishes retry from reconnect',async()=>{
 for(const failure of ['network','server','rate']){const f=fixture();const cipher=await seed(f,arash,{expires:0});const data=await(await f.call(arash,async()=>{if(failure==='network')throw Error('PRIVATE network');return Response.json({error:failure==='rate'?'temporarily_unavailable':'server_error',error_description:'PRIVATE'},{status:failure==='rate'?429:503});})).json();assert.equal(data.connected,true,failure);assert.equal(data.verification.state,'temporary_failure',failure);assert.equal(data.verification.recoveryAction,'retry_verification');assert.equal(f.db.prepare('SELECT token_cipher FROM google_accounts').get().token_cipher,cipher);assert.equal(f.db.prepare('SELECT status FROM google_accounts').get().status,'connected');assert(!JSON.stringify(data).includes('PRIVATE'));}
});
test('terminal refresh rejection disables only its own capabilities and retains encrypted grant for explicit reconnect',async()=>{
 const f=fixture();const cipher=await seed(f,arash,{expires:0});await seed(f,amir);
 const data=await(await f.call(arash,async()=>Response.json({error:'invalid_grant',error_description:'PRIVATE'},{status:400}))).json();
 assert.equal(data.connected,false);assert.equal(data.verification.state,'reconnect_required');assert.equal(data.verification.recoveryAction,'reconnect_google');assert(Object.values(data.capabilities).every(v=>v===false));assert.equal(f.db.prepare('SELECT token_cipher FROM google_accounts WHERE owner_id=?').get(arash.userId).token_cipher,cipher);assert.equal((await getGoogleAccess(f.env,amir.userId)).subject,'google-amir');assert(!JSON.stringify(data).includes('PRIVATE'));
});
test('a rejected access token is refreshed once before demanding new consent',async()=>{
 const f=fixture();await seed(f);let identities=0;
 const data=await(await f.call(arash,async(url,options)=>{if(url.endsWith('/userinfo')&&++identities===1)return Response.json({error:'invalid_token'},{status:401});return f.fetcher(url,options);})).json();
 assert.equal(data.verification.state,'verified');assert.equal(identities,2);assert.equal(f.calls.filter(c=>c.url.endsWith('/token')).length,1);
});
test('a service-only rejected access token refreshes once, rechecks identity and recovers the read without consent',async()=>{
 const f=fixture();await seed(f);let gmail=0,identities=0;const data=await(await f.call(arash,async(url,options)=>{if(url.endsWith('/userinfo'))identities++;if(url.includes('/gmail/')&&++gmail===1)return Response.json({error:'invalid_token'},{status:401});return f.fetcher(url,options);})).json();assert.equal(data.verification.state,'verified');assert.equal(data.serviceChecks.gmailRead.state,'available');assert.equal(gmail,2);assert.equal(identities,2);assert.equal(f.calls.filter(c=>c.url.endsWith('/token')).length,1);
});
test('repeated service authorization failures cannot refresh indefinitely or erase the linked grant',async()=>{
 const f=fixture();await seed(f);let services=0;const data=await(await f.call(arash,async(url,options)=>{if(!url.endsWith('/userinfo')&&!url.endsWith('/token')){services++;return Response.json({error:'invalid_token'},{status:401});}return f.fetcher(url,options);})).json();assert.equal(data.verification.state,'partial');assert.equal(data.connected,true);assert.equal(data.serviceChecks.gmailRead.code,'google_access_rejected');assert.equal(f.calls.filter(c=>c.url.endsWith('/token')).length,1);assert.equal(services,4);assert.equal(f.db.prepare('SELECT status FROM google_accounts').get().status,'connected');
});
test('a same-owner identity mismatch fails closed and never checks mailbox contents',async()=>{
 const f=fixture();await seed(f);let calls=0;const data=await(await f.call(arash,async()=>{calls++;return Response.json({sub:'google-other',email:'other@example.invalid',email_verified:true});})).json();
 assert.equal(calls,1);assert.equal(data.connected,false);assert.equal(data.verification.state,'reconnect_required');assert.equal(data.verification.code,'identity_mailbox_mismatch');assert.equal(f.db.prepare('SELECT status FROM google_accounts').get().status,'reconnect_required');
});
test('a scoped service denial remains separate from a valid Google identity and transient quota failures',async()=>{
 const f=fixture();await seed(f);
 const data=await(await f.call(arash,async(url,options)=>{if(url.includes('/calendar/'))return Response.json({error:{errors:[{reason:'insufficientPermissions'}],message:'PRIVATE'}},{status:403});if(url.includes('/gmail/'))return Response.json({error:{errors:[{reason:'rateLimitExceeded'}],message:'PRIVATE'}},{status:403});return f.fetcher(url,options);})).json();
 assert.equal(data.connected,true);assert.equal(data.verification.state,'partial');assert.equal(data.serviceChecks.calendar.state,'permission_required');assert.equal(data.serviceChecks.gmailRead.state,'temporary_failure');assert.equal(data.capabilities.calendar,false);assert.equal(f.db.prepare('SELECT status FROM google_accounts').get().status,'connected');assert(!JSON.stringify(data).includes('PRIVATE'));
});
test('ungranted services and an absent secondary slot never fall back or make provider requests',async()=>{
 const f=fixture();await seed(f,arash,{scopes:GOOGLE_SCOPES.slice(0,3)});
 const data=await(await f.call()).json();assert.equal(f.calls.length,1);assert.equal(data.serviceChecks.calendar.state,'not_granted');assert.equal(data.capabilities.calendar,false);
 const second=await(await f.call({...arash,userId:arash.userId+':secondary'})).json();assert.equal(second.connected,false);assert.equal(second.verification.recoveryAction,'connect_google');assert.equal(f.calls.length,1);
});
test('verification rejects foreign profile, origin and caller-provided identity without provider access',async()=>{
 const f=fixture();await seed(f);
 for(const context of [{...arash,profileId:'amir'},{...arash,profileId:'admin'}])await assert.rejects(()=>f.call(context),e=>e.status===403);
 await assert.rejects(()=>handleGoogleRequest(f.request('verify','{}',{Origin:'https://foreign.invalid'}),f.env,arash,f.fetcher),e=>e.status===403);
 await assert.rejects(()=>handleGoogleRequest(f.request('verify',JSON.stringify({owner_id:amir.userId})),f.env,arash,f.fetcher),e=>e.status===400);assert.equal(f.calls.length,0);
});
test('rotating a token while an old identity failure is in flight does not invalidate the new grant',async()=>{
 const f=fixture();const old=await seed(f);
 const data=await(await f.call(arash,async()=>{await seed(f,arash,{tokens:{access_token:'new-private-access',refresh_token:'new-private-refresh'}});return Response.json({sub:'wrong',email:'wrong@example.invalid',email_verified:true});})).json();
 const row=f.db.prepare('SELECT * FROM google_accounts').get();assert.equal(row.status,'connected');assert.notEqual(row.token_cipher,old);assert.equal((await decryptGoogleSecret(f.env,arash.userId,row.token_cipher)).access_token,'new-private-access');assert.equal(data.verification.state,'temporary_failure');assert.equal(data.verification.code,'connection_changed');
});
test('client configuration errors require administrator attention without invalidating owner grants',async()=>{
 const f=fixture();const cipher=await seed(f,arash,{expires:0});const data=await(await f.call(arash,async()=>Response.json({error:'invalid_client',error_description:'PRIVATE'},{status:401}))).json();assert.equal(data.verification.state,'setup_required');assert.equal(data.verification.code,'google_client_setup_required');assert.equal(data.verification.recoveryAction,'contact_administrator');assert.equal(data.connected,true);assert.equal(f.db.prepare('SELECT token_cipher FROM google_accounts').get().token_cipher,cipher);assert.equal(f.db.prepare('SELECT status FROM google_accounts').get().status,'connected');assert(!JSON.stringify(data).includes('PRIVATE'));
});
test('malformed or redirected provider responses cannot revoke a stored connection or forward credentials',async()=>{
 for(const mode of ['incomplete_identity','non_object','oversized','redirect']){const f=fixture();const cipher=await seed(f);let calls=0;const data=await(await f.call(arash,async(url,options)=>{calls++;assert.equal(options.redirect,'manual');if(mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/PRIVATE'}});if(mode==='incomplete_identity')return Response.json({sub:'not-enough'});if(mode==='non_object')return Response.json(null);return Response.json({value:'x'.repeat(65537)});})).json();assert.equal(data.verification.state,'temporary_failure',mode);assert.equal(data.connected,true,mode);assert.equal(calls,1);assert.equal(f.db.prepare('SELECT token_cipher FROM google_accounts').get().token_cipher,cipher);assert.equal(f.db.prepare('SELECT status FROM google_accounts').get().status,'connected');assert(!JSON.stringify(data).includes('PRIVATE'));}
});
test('a verified secondary health check uses only its own scopes and leaves primary and the other doctor unchanged',async()=>{
 const f=fixture(),secondary={...arash,userId:arash.userId+':secondary'};await seed(f,arash);await seed(f,amir);await seed(f,secondary,{subject:'google-arash-secondary',scopes:[...GOOGLE_SCOPES.slice(0,5),GOOGLE_SCOPES[6]],tokens:{access_token:'secondary-private-access',refresh_token:'secondary-private-refresh'}});const primary=f.db.prepare('SELECT token_cipher FROM google_accounts WHERE owner_id=?').get(arash.userId).token_cipher;
 const calls=[];const data=await(await f.call(secondary,async(url,options)=>{calls.push(url);assert.equal(options.headers.Authorization,'Bearer secondary-private-access');if(url.endsWith('/userinfo'))return Response.json({sub:'google-arash-secondary',email:'arash@example.invalid',email_verified:true});return Response.json({kind:'safe'});})).json();
 assert.equal(data.verification.state,'verified');assert.equal(data.capabilities.calendar,false);assert.equal(data.capabilities.drive,false);assert.equal(data.capabilities.backupDrive,true);assert.equal(data.serviceChecks.backupDrive.state,'available');assert(!calls.some(url=>url.includes('/calendar/')));assert.equal(f.db.prepare('SELECT token_cipher FROM google_accounts WHERE owner_id=?').get(arash.userId).token_cipher,primary);assert.equal(f.db.prepare('SELECT count(*) n FROM google_accounts').get().n,3);assert(!JSON.stringify(data).includes('secondary-private'));
});
