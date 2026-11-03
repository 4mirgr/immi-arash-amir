import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../cloud/worker.mjs';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const request=(path,options={})=>new Request('https://immi.example'+path,{...options,headers:{Authorization:'Bearer valid-token',...options.headers}});
const response=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function mock({member='arash',userStatus=200}={}) {
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    assert.equal(options.headers.Authorization,'Bearer valid-token');
    assert.equal(options.headers.apikey,env.SUPABASE_PUBLISHABLE_KEY);
    if(url.endsWith('/auth/v1/user'))return response({id:'owner-123'},userStatus);
    if(url.includes('immi_memberships'))return response(member?[{profile_id:member}]:[]);
    if(url.includes('/rpc/immi_dataset_revision'))return response('2026-11-03T10:00:00+00:00');
    if(url.includes('immi_profiles'))return response([{data:{id:member,cvText:'own private CV'}}]);
    if(url.includes('immi_clinics'))return response([]);
    if(options.method==='POST')return response(null,204);
    return response([]);
  };
  return {calls,handle:createHandler(fetcher)};
}
test('unauthenticated request cannot query private database',async()=>{
  const m=mock();const res=await m.handle(new Request('https://immi.example/api/bootstrap'),env);assert.equal(res.status,401);assert.equal(m.calls.length,0);
});
test('invalid token and unprovisioned account are denied',async()=>{
  assert.equal((await mock({userStatus:401}).handle(request('/api/bootstrap'),env)).status,401);
  assert.equal((await mock({member:null}).handle(request('/api/bootstrap'),env)).status,403);
});
test('foreign profile query and draft owner are rejected before private access',async()=>{
  const m=mock();assert.equal((await m.handle(request('/api/bootstrap?profile=amir'),env)).status,403);
  assert.equal((await m.handle(request('/api/drafts',{method:'POST',body:JSON.stringify({profileId:'amir',clinicIds:[],subject:'hello',body:'body'})}),env)).status,403);
  assert.equal(m.calls.filter(c=>c.url.includes('immi_profiles')||c.url.includes('immi_drafts')).length,0);
});
test('bootstrap exposes only own profile and disconnected integrations',async()=>{
  const m=mock();const result=await(await m.handle(request('/api/bootstrap'),env)).json();assert.equal(result.currentProfileId,'arash');assert.equal(result.revision,'2026-11-03T10:00:00+00:00');assert.deepEqual(result.profiles,[{id:'arash',cvText:'own private CV'}]);assert.equal(result.integrations.gmail.connected,false);assert.equal(result.stations[0].official_exam_item,false);
});
test('public config exposes only publishable config and never reads auth',async()=>{
  const m=mock();const r=await m.handle(new Request('https://immi.example/api/public-config'),env);assert.deepEqual(await r.json(),{mode:'cloud',authRequired:true,supabaseUrl:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY});assert.equal(m.calls.length,0);
});
test('cross-origin write rejected and private response is not cached',async()=>{
  const m=mock();const res=await m.handle(request('/api/settings',{method:'PUT',headers:{Origin:'https://evil.example'},body:'{}'}),env);assert.equal(res.status,403);assert.equal(res.headers.get('Cache-Control'),'no-store');assert.equal(m.calls.length,0);
});
test('draft is permanently draft with server-selected owner',async()=>{
  const m=mock();const res=await m.handle(request('/api/drafts',{method:'POST',body:JSON.stringify({profileId:'arash',clinicIds:[],subject:'hello',body:'body',status:'sent',user_id:'someone-else'})}),env);assert.equal(res.status,201);const data=await res.json();assert.equal(data.status,'draft');const write=m.calls.find(c=>c.options.method==='POST');const stored=JSON.parse(write.options.body);assert.equal(stored.user_id,'owner-123');assert.equal(stored.profile_id,'arash');
});
test('invalid settings are rejected, preference does not activate integrations',async()=>{
  const m=mock();const res=await m.handle(request('/api/settings',{method:'PUT',body:JSON.stringify({emailPolicy:'send_now'})}),env);assert.equal(res.status,400);assert.equal(m.calls.filter(c=>c.options.method==='POST').length,0);
});
test('CV snapshot forbids client supplied content before RPC',async()=>{
  const m=mock();const res=await m.handle(request('/api/cv/versions',{method:'POST',body:JSON.stringify({name:'my CV',text:'invented achievement'})}),env);assert.equal(res.status,400);assert.equal(m.calls.some(c=>c.url.includes('/rpc/')),false);
});
test('foreign/missing CV version cannot be exported or made default',async()=>{
  const m=mock();const id='12345678-1234-4123-8123-123456789abc';
  assert.equal((await m.handle(request('/api/cv/export?id='+id),env)).status,404);
  assert.equal((await m.handle(request('/api/cv/default',{method:'POST',body:JSON.stringify({id})}),env)).status,404);
  assert.equal(m.calls.filter(c=>c.options.method==='POST').length,0);
  assert.equal((await m.handle(request('/api/cv/export?id='+id+'&format=docx'),env)).status,404);
});
test('presets reject multiline header and writes never accept owner override',async()=>{
  const m=mock();const res=await m.handle(request('/api/presets',{method:'POST',body:JSON.stringify({name:'intro',subject:'Hello\nBcc: bad',body:'body'})}),env);assert.equal(res.status,400);assert.equal(m.calls.some(c=>c.url.includes('/rpc/')),false);
});
test('owned CV metadata marks selected default without exposing text',async()=>{
  const id='12345678-1234-4123-8123-123456789abc';
  const fetcher=async(url)=>{
    if(url.endsWith('/auth/v1/user'))return response({id:'owner-123'});
    if(url.includes('immi_memberships'))return response([{profile_id:'arash'}]);
    if(url.includes('immi_cv_defaults'))return response([{version_id:id}]);
    if(url.includes('immi_cv_versions'))return response([{data:{id,version:2,name:'Verified source'}}]);
    throw Error('unexpected url');
  };
  const res=await createHandler(fetcher)(request('/api/cv/versions'),env);assert.equal(res.status,200);assert.deepEqual(await res.json(),[{id,version:2,name:'Verified source',isDefault:true}]);
});
test('secret keys are never exposed even if misconfigured as publishable',async()=>{
  const m=mock();const res=await m.handle(new Request('https://immi.example/api/public-config'),{...env,SUPABASE_PUBLISHABLE_KEY:'sb_secret_do_not_expose'});assert.equal(res.status,503);assert.equal((await res.text()).includes('sb_secret_do_not_expose'),false);
});
test('updates returns revision without downloading clinic or private profile rows',async()=>{
  const m=mock();const res=await m.handle(request('/api/updates'),env);assert.equal(res.status,200);assert.deepEqual(await res.json(),{revision:'2026-11-03T10:00:00+00:00'});assert.equal(m.calls.filter(c=>c.url.includes('/rest/v1/immi_clinics')||c.url.includes('immi_profiles')).length,0);assert.equal(m.calls.length,3);
});

test('public-source opportunities still require the authenticated workspace owner',async()=>{
 const m=mock();
 assert.equal((await m.handle(new Request('https://immi.example/api/opportunities'),env)).status,401);
 assert.equal(m.calls.length,0);
 assert.equal((await m.handle(request('/api/opportunities?profile=amir'),env)).status,403);
 assert.equal(m.calls.length,2);
});
