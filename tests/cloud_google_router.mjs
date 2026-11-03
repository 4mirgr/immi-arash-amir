import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../cloud/worker.mjs';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fixture(){const calls=[];const fetcher=async(url,options)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return json({id:'owner-arash'});if(url.includes('/immi_memberships'))return json([{profile_id:'arash'}]);throw Error('Unexpected outbound request');};return {calls,handle:createHandler(fetcher)};}
const request=(path,body)=>new Request('https://site.example'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer valid-token','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
test('every Google operation remains behind verified app membership',async()=>{
 for(const path of ['/api/google/status','/api/google/mail/messages','/api/google/mail/dispatch','/api/google/calendar/events','/api/google/drive/files']){
  const m=fixture();const r=await m.handle(new Request('https://site.example'+path),env);assert.equal(r.status,401);assert.equal(m.calls.length,0);
 }
});
test('Google status is owner authenticated and honest about missing configuration',async()=>{
 const m=fixture();const r=await m.handle(request('/api/google/status?profile=arash'),env);assert.equal(r.status,200);const data=await r.json();assert.equal(data.connected,false);assert.equal(data.configured,false);assert.equal(m.calls.length,2);assert.equal(JSON.stringify(data).includes('valid-token'),false);
});
test('foreign Google profile cannot reach provider, storage, or queue',async()=>{
 const m=fixture();const r=await m.handle(request('/api/google/mail/messages?profile=amir'),env);assert.equal(r.status,403);assert.equal(m.calls.length,2);
});
test('Google consent start fails closed while client setup is absent',async()=>{
 const m=fixture();const r=await m.handle(request('/api/google/start',{}),env);assert.equal(r.status,503);const data=await r.json();assert.equal(data.code,'setup_required');assert.equal('authorizationUrl' in data,false);
});
test('callback has independent state verification and cannot leak any app data',async()=>{
 const m=fixture();const r=await m.handle(new Request('https://site.example/api/google/callback?state=bad&code=secret-code'),env);assert.equal(r.status,503);assert.equal(m.calls.length,0);const text=await r.text();assert.equal(text.includes('secret-code'),false);assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('cross-origin Google send rejected before auth or provider access',async()=>{
 const m=fixture();const r=await m.handle(new Request('https://site.example/api/google/mail/dispatch',{method:'POST',headers:{Origin:'https://untrusted.example',Authorization:'Bearer valid-token'},body:'{}'}),env);assert.equal(r.status,403);assert.equal(m.calls.length,0);
});
