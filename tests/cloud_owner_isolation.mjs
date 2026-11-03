import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHandler} from '../cloud/worker.mjs';
import {upsertOpportunityBatch} from '../cloud/opportunity-store.mjs';
const origin='https://workspace.example';
const ids={arash:'12345678-1234-4123-8123-123456789abc',amir:'22345678-1234-4123-8123-123456789abc'};
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['linkedin-schema.sql','linkedin-oauth-schema.sql','opportunity-v2-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const database={prepare(sql){return {bind(...args){const statement=db.prepare(sql);return {async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {success:true,meta:statement.run(...args)};},_run(){return statement.run(...args);}};}};},async batch(items){db.exec('BEGIN');try{for(const item of items)item._run();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}};
 const writes=[],reads=[];
 const env={SUPABASE_URL:'https://auth.example',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',GOOGLE_DB:database,OPPORTUNITY_DB:database};
 const response=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const fetcher=async(url,options)=>{
  const owner=options.headers.Authorization==='Bearer synthetic-amir'?'amir':options.headers.Authorization==='Bearer synthetic-arash'?'arash':null;assert(owner,'No unrecognized bearer may reach backend');
  if(url.endsWith('/auth/v1/user'))return response({id:'owner-'+owner});
  const u=new URL(url),table=u.pathname.split('/').at(-1);reads.push({owner,table,search:u.search});
  if(table==='immi_memberships'){assert.equal(u.searchParams.get('user_id'),'eq.owner-'+owner);return response([{profile_id:owner}]);}
  if(options.method==='POST'){const body=JSON.parse(options.body);writes.push({owner,table,body});return response(null,204);}
  if(table==='immi_dataset_revision')return response('synthetic-revision');
  if(table==='immi_clinics')return response([]);
  assert.equal(u.searchParams.get('profile_id'),'eq.'+owner,'Private reads must filter trusted profile');
  if(table==='immi_profiles')return response([{data:{id:owner,cvText:'SYNTHETIC-'+owner,linkedinUrl:'https://www.linkedin.com/in/synthetic-'+owner+'/'}}]);
  if(table==='immi_cv_versions'){const id=u.searchParams.get('id');return response(id&&id!=='eq.'+ids[owner]?[]:[{text:'SYNTHETIC-'+owner,version:1,data:{id:ids[owner],version:1,name:'Own synthetic'}}]);}
  if(table==='immi_settings')return response([{data:{emailPolicy:'approval_required',defaultTemplate:owner}}]);
  return response([]);
 };
 const handler=createHandler(fetcher);
 const call=(owner,path,body,method=body===undefined?'GET':'POST')=>handler(new Request(origin+'/api/'+path,{method,headers:{Authorization:'Bearer synthetic-'+owner,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 return {db,env,call,writes,reads};
}
test('two authenticated workspaces receive only their own profile, CV, settings and private query scope',async()=>{
 const {call,reads}=fixture();
 for(const owner of ['arash','amir']){
  const data=await(await call(owner,'bootstrap')).json();assert.equal(data.currentProfileId,owner);assert.deepEqual(data.profiles.map(x=>x.id),[owner]);assert.equal(data.profiles[0].cvText,'SYNTHETIC-'+owner);assert.equal(data.settings.defaultTemplate,owner);
  assert.equal(await(await call(owner,'cv/export?id='+ids[owner])).text(),'SYNTHETIC-'+owner);
  assert.equal((await call(owner,'cv/export?id='+ids[owner==='arash'?'amir':'arash'])).status,404);
 }
 assert(reads.some(x=>x.table==='immi_profiles'&&x.owner==='amir'));assert(reads.some(x=>x.table==='immi_profiles'&&x.owner==='arash'));
});
test('cross-profile URLs fail before any private module reads or writes',async()=>{
 const {call,db}=fixture();
 for(const owner of ['arash','amir'])for(const route of ['bootstrap','cv/versions','drafts','google/status','google/mail/messages','google/mail/dispatch','google/calendar/events','google/drive/files','linkedin/workspace','linkedin/contacts','linkedin/connection','linkedin/publish','opportunities']){
  const other=owner==='arash'?'amir':'arash';assert.equal((await call(owner,route+'?profile='+other,route.endsWith('/dispatch')||route.endsWith('/publish')?{}:undefined)).status,403,route);
 }
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM linkedin_posts').get().n,0);
});
test('CV defaults and settings persist only server-derived profile and user identity',async()=>{
 const {call,writes}=fixture();
 for(const owner of ['arash','amir']){
  const foreign=owner==='arash'?'amir':'arash';assert.equal((await call(owner,'cv/default',{id:ids[foreign]})).status,404);
  assert.equal((await call(owner,'cv/default',{id:ids[owner],user_id:'forged',profile_id:foreign})).status,403);
  assert.equal((await call(owner,'cv/default',{id:ids[owner],user_id:'forged'})).status,200);
  assert.equal((await call(owner,'settings',{defaultTemplate:'new-'+owner,user_id:'forged',profile_id:foreign},'PUT')).status,403);
  assert.equal((await call(owner,'settings',{defaultTemplate:'new-'+owner,user_id:'forged'},'PUT')).status,200);
 }
 for(const write of writes){assert.equal(write.body.user_id,'owner-'+write.owner);assert.equal(write.body.profile_id,write.owner);}
});
test('LinkedIn drafts, sections, posts, metrics and contacts remain isolated through main authenticated router',async()=>{
 const {call}=fixture();
 const post=await(await call('arash','linkedin/posts',{title:'Synthetic private post',text:'Only first owner'})).json();
 assert.equal((await call('arash','linkedin/sections',{section:'about',currentText:'Private first owner'})).status,200);
 assert.equal((await call('arash','linkedin/drafts',{kind:'about',name:'Own',text:'Own draft'})).status,201);
 assert.equal((await call('arash','linkedin/metrics',{followers:10,asOf:new Date().toISOString()})).status,201);
 const contact=await(await call('arash','linkedin/contacts',{name:'Synthetic supervisor',profileUrl:'https://www.linkedin.com/in/synthetic-contact/'})).json();
 const other=await(await call('amir','linkedin/workspace')).json();for(const field of ['sections','drafts','posts','metrics','contacts'])assert.deepEqual(other[field],[],field);assert.equal(other.profileUrl,'https://www.linkedin.com/in/synthetic-amir/');
 assert.equal((await call('amir','linkedin/posts/'+post.id+'/published',{})).status,404);
 assert.equal((await call('amir','linkedin/contacts/'+contact.id,{status:'contacted'})).status,404);
 assert.equal((await call('amir','linkedin/sections',{section:'about',currentText:'forged',owner_id:'owner-arash'})).status,400);
 const own=await(await call('arash','linkedin/workspace')).json();assert.equal(own.posts.length,1);assert.equal(own.contacts.length,1);assert.equal(own.drafts.length,1);
});
test('Italy stays Amir-only at list, filter and direct organization-history routes behind trusted membership',async()=>{
 const {call,env}=fixture();
 await upsertOpportunityBatch(env.OPPORTUNITY_DB,{id:'synthetic-it',name:'Synthetic university',country:'IT',state:'Lazio',trust:'official',allowedHosts:['university.example.invalid'],profileScope:'both'},[{externalId:'call1',title:'Synthetic scholarship',url:'https://university.example.invalid/call1',organization:'Synthetic University',opportunityType:'scholarship',country:'IT',state:'Lazio'}],Date.now());
 const own=await(await call('amir','opportunities?country=IT')).json();assert.equal(own.opportunities.length,1);const id=own.opportunities[0].organizationId;
 assert.equal((await call('arash','opportunities?country=IT')).status,403);assert.equal((await call('arash','opportunities/organizations/'+id)).status,403);
 assert.equal((await(await call('arash','opportunities?includeClosed=true')).json()).opportunities.length,0);
});
