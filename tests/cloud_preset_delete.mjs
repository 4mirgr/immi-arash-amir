import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../cloud/worker.mjs';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const id='12345678-1234-4123-8123-123456789abc';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function fixture({found=true}={}){
 const calls=[];
 const fetcher=async(url,options={})=>{
  calls.push({url,options});
  if(url.endsWith('/auth/v1/user'))return json({id:'owner-123'});
  if(url.includes('immi_memberships'))return json([{profile_id:'arash'}]);
  if(url.includes('immi_presets')){
   assert.equal(options.method,'DELETE');assert.equal(options.headers.Authorization,'Bearer owner-token');
   assert.equal(new URL(url).searchParams.get('user_id'),'eq.owner-123');
   assert.equal(new URL(url).searchParams.get('profile_id'),'eq.arash');
   assert.equal(new URL(url).searchParams.get('id'),'eq.'+id);
   assert.equal(options.headers.Prefer,'return=representation');
   return json(found?[{id}]:[]);
  }
  throw Error('Unexpected provider call');
 };
 const run=(body={id},query='arash',token=true)=>createHandler(fetcher)(new Request('https://immi.example/api/presets/delete?profile='+query,{method:'POST',headers:{...(token?{Authorization:'Bearer owner-token'}:{}),Origin:'https://immi.example'},body:JSON.stringify(body)}),env);
 return{run,calls};
}
test('template deletion uses authenticated owner/profile/id and never changes queues or other defaults',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.status,200);assert.deepEqual(await r.json(),{deleted:true,id,profileId:'arash'});assert.equal(f.calls.length,3);assert.equal(f.calls.filter(c=>c.options.method==='DELETE').length,1);
});
test('missing or foreign template fails without claiming deletion',async()=>{
 const f=fixture({found:false});assert.equal((await f.run()).status,404);
});
test('template deletion rejects unauthenticated, foreign profile and invalid payload before mutation',async()=>{
 for(const [body,profile,token,status] of [[{id},'arash',false,401],[{id},'amir',true,403],[{id:'bad'},'arash',true,400],[{id,user_id:'foreign'},'arash',true,400]]){
  const f=fixture();assert.equal((await f.run(body,profile,token)).status,status);assert.equal(f.calls.filter(c=>c.options.method==='DELETE').length,0);
 }
});
