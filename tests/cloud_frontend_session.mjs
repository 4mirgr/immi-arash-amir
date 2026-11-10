import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionRenewal} from '../src/auth-session.mjs';
const owned={access_token:'old',refresh_token:'r1',expiresAt:120000,profileId:'arash',workspaceOwnerId:'owner-a'};
test('temporary refresh keeps valid session and locks at expiry without discarding it',async()=>{
 let at=61000,invalid=0,state;const c=createSessionRenewal({now:()=>at,requestTokens:async()=>{throw new TypeError('offline')},verifySession:async()=>{},onInvalid:()=>invalid++,onState:x=>state=x});c.replace(owned);
 assert.equal(await c.ensure(),'old');assert.equal(c.current(),owned);assert.equal(state.status,'retrying');at=120001;await assert.rejects(c.ensure(),/session_refresh_pending/);assert.equal(c.current(),owned);assert.equal(state.status,'locked');assert.equal(invalid,0);
});
test('rotated refresh is retained when owner verification temporarily fails',async()=>{
 let at=61000,requests=0,verifies=0;const c=createSessionRenewal({now:()=>at,requestTokens:async refresh=>{requests++;assert.equal(refresh,'r1');return {access_token:'new',refresh_token:'r2',expires_in:3600}},verifySession:async token=>{verifies++;assert.equal(token,'new');if(verifies===1)throw Object.assign(Error('busy'),{status:502});return {profileId:'arash',workspaceOwnerId:'owner-a'}}});c.replace(owned);
 assert.equal(await c.ensure(),'old');at+=3000;assert.equal(await c.ensure(),'new');assert.equal(requests,1);assert.equal(c.current().refresh_token,'r2');
});
test('concurrent requests share renewal and logout prevents late session restoration',async()=>{
 let release,requests=0,published=0;const c=createSessionRenewal({now:()=>61000,requestTokens:async()=>{requests++;await new Promise(r=>release=r);return {access_token:'new',expires_in:3600}},verifySession:async()=>({profileId:'arash',workspaceOwnerId:'owner-a'}),onSession:()=>published++});c.replace(owned);
 const one=c.ensure(),two=c.ensure();assert.equal(requests,1);c.clear();release();await Promise.allSettled([one,two]);assert.equal(published,0);assert.equal(c.current(),null);
});
test('revoked refresh and cross-owner bootstrap fail closed',async()=>{
 let invalid=0;const c=createSessionRenewal({now:()=>61000,requestTokens:async()=>{throw Object.assign(Error('invalid_grant'),{authTerminal:true})},verifySession:async()=>{},onInvalid:()=>invalid++});c.replace(owned);await assert.rejects(c.ensure(),/invalid_grant/);assert.equal(c.current(),null);assert.equal(invalid,1);
 const d=createSessionRenewal({now:()=>61000,requestTokens:async()=>({access_token:'new',expires_in:3600}),verifySession:async()=>({profileId:'amir',workspaceOwnerId:'owner-b'})});d.replace(owned);await assert.rejects(d.ensure(),/workspace_identity_changed/);assert.equal(d.current(),null);
});
test('too-short access never discards a rotated refresh credential',async()=>{
 let at=61000,verifies=0;const used=[];const c=createSessionRenewal({now:()=>at,requestTokens:async r=>{used.push(r);return {access_token:'new'+used.length,refresh_token:'r'+(used.length+1),expires_in:1}},verifySession:async()=>{if(++verifies===1)throw Error('busy');return {profileId:'arash',workspaceOwnerId:'owner-a'}}});c.replace(owned);await c.ensure();at+=3000;await c.ensure();at+=10000;await c.ensure();assert.deepEqual(used,['r1','r2','r3']);
});
test('API preflight sends a mutation once and never replays a failed transport',async()=>{
 const {apiResponse,setAccessToken,setSessionGuard}=await import('../src/api.js');const original=globalThis.fetch;let renewals=0,sends=0;
 try{
  setAccessToken('old');setSessionGuard(async()=>{renewals++;setAccessToken('fresh');});
  globalThis.fetch=async(path,options)=>{sends++;assert.equal(path,'/api/send');assert.equal(options.method,'POST');assert.equal(options.headers.Authorization,'Bearer fresh');return new Response(JSON.stringify({error:'ambiguous'}),{status:502});};
  await assert.rejects(apiResponse('send',{method:'POST',body:'{}'}),/ambiguous/);assert.equal(renewals,1);assert.equal(sends,1);
  setSessionGuard(async()=>{throw Error('session_refresh_pending')});await assert.rejects(apiResponse('send',{method:'POST'}),/session_refresh_pending/);assert.equal(sends,1);
 }finally{globalThis.fetch=original;setSessionGuard(null);setAccessToken('');}
});
test('explicit owner-bootstrap bearer bypasses preflight; bounded GET preserves caller signal',async()=>{
 const {apiResponse,setSessionGuard}=await import('../src/api.js');const original=globalThis.fetch,caller=new AbortController();let calls=0;
 try{
  setSessionGuard(async()=>{throw Error('must not recurse')});
  globalThis.fetch=async(path,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer verification');assert(options.signal instanceof AbortSignal);if(calls===2)assert.equal(options.signal,caller.signal);return new Response('{}');};
  await apiResponse('me',{headers:{Authorization:'Bearer verification'}});await apiResponse('me',{headers:{Authorization:'Bearer verification'},signal:caller.signal});assert.equal(calls,2);
 }finally{globalThis.fetch=original;setSessionGuard(null);}
});
test('only definitive site authentication rejection invokes the session invalidator',async()=>{
 const {apiResponse,setSessionGuard}=await import('../src/api.js');const original=globalThis.fetch;let invalid=0;
 try{
  setSessionGuard(async()=>{},()=>invalid++);
  for(const [status,error,expected] of [[401,'reconnect_required',0],[403,'gmail_scope_or_api_required',0],[503,'Authentication service temporarily unavailable',0],[401,'Session is invalid or expired',1],[403,'Account has not been provisioned for this workspace',2]]){
   globalThis.fetch=async()=>new Response(JSON.stringify({error}),{status});await assert.rejects(apiResponse('test'));assert.equal(invalid,expected);
  }
 }finally{globalThis.fetch=original;setSessionGuard(null);}
});
test('a late rejection from a former bearer cannot clear a newer owner session',async()=>{
 const {apiResponse,setSessionGuard,setAccessToken}=await import('../src/api.js');const original=globalThis.fetch;let release,invalid=0;
 try{
  setSessionGuard(async()=>{},()=>invalid++);setAccessToken('former-owner');globalThis.fetch=async()=>{await new Promise(r=>release=r);return new Response(JSON.stringify({error:'Session is invalid or expired'}),{status:401});};
  const response=apiResponse('private');await new Promise(r=>setImmediate(r));setAccessToken('new-owner');release();await assert.rejects(response);assert.equal(invalid,0);
 }finally{globalThis.fetch=original;setSessionGuard(null);setAccessToken('');}
});
test('verification crossing pending expiry never publishes unusable credentials',async()=>{
 let at=61000,published=0;const c=createSessionRenewal({now:()=>at,requestTokens:async()=>({access_token:'new',refresh_token:'r2',expires_in:30}),verifySession:async()=>{at+=15000;return {profileId:'arash',workspaceOwnerId:'owner-a'}},onSession:()=>published++});c.replace(owned);
 assert.equal(await c.ensure(),'old');assert.equal(published,0);assert.equal(c.current().access_token,'old');
});
test('near-expiry old credentials cannot be used as a transient fallback',async()=>{
 let state;const c=createSessionRenewal({now:()=>105000,requestTokens:async()=>{throw new TypeError('offline')},verifySession:async()=>{},onState:x=>state=x});c.replace(owned);await assert.rejects(c.ensure(),/session_refresh_pending/);assert.equal(state.status,'locked');assert.equal(c.current(),owned);
});
