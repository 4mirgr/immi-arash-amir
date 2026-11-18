import test from 'node:test';
import assert from 'node:assert/strict';
import {getAutomationWritingContext as read} from '../cloud/automation-writing-context.mjs';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',AUTOMATION_MEMBERSHIP_KEY:'synthetic_'+ 'A'.repeat(40)};
const good={ownerId:owner,profileId:'arash',profile:{name:'Synthetic Doctor',planning:{gpGoals:{}}},cv:{id,version:1,text:'Synthetic CV',isDefault:false},snapshotAt:'2026-11-18T00:00:00Z',transportApproved:false};
test('minimal background writing snapshot is server-key-gated and never constitutes a send approval',async()=>{
 let calls=0;const result=await read(env,owner,'arash',async(url,options)=>{calls++;assert.equal(new URL(url).pathname,'/rest/v1/rpc/immi_automation_writing_context');assert.equal(options.redirect,'manual');const body=JSON.parse(options.body);assert.equal(body.p_owner,owner);assert.equal(body.p_key,env.AUTOMATION_MEMBERSHIP_KEY);return Response.json(good);});
 assert.equal(calls,1);assert.equal(result.cvVersionId,id);assert.equal(result.transportApproved,false);assert.equal(result.isDefault,false);assert(!JSON.stringify(result).includes(env.AUTOMATION_MEMBERSHIP_KEY));
});
test('invalid server configuration, other profile, redirects and unexpected owner snapshots fail closed',async()=>{
 for(const [config,person,expected]of [[env,'amir',0],[{...env,AUTOMATION_MEMBERSHIP_KEY:''},'arash',0],[{...env,SUPABASE_URL:'http://localhost/'},'arash',0]]){let calls=0;assert.equal((await read(config,owner,person,async()=>{calls++;return Response.json(good);})).available,false);assert.equal(calls,expected);}
 for(const data of [{...good,ownerId:id},{...good,profileId:'amir'},{...good,transportApproved:true},{...good,cv:{...good.cv,id:'invalid'}},null])assert.equal((await read(env,owner,'arash',async()=>Response.json(data))).available,false);
 assert.equal((await read(env,owner,'arash',async()=>new Response(null,{status:302,headers:{Location:'https://elsewhere.invalid'}}))).available,false);
});
test('oversized or unavailable context does not disclose or invent CV data',async()=>{
 for(const response of [new Response('private upstream text',{status:503}),new Response('x',{headers:{'content-length':'1000001'}})]){const result=await read(env,owner,'arash',async()=>response);assert.deepEqual(result,{available:false,code:'writing_context_unavailable'});}
 const result=await read(env,owner,'arash',async()=>Response.json({...good,cv:null}));assert.equal(result.available,true);assert.equal(result.cvVersionId,null);assert.equal(result.cvText,'');
});
