import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleTeamBoardRequest} from '../cloud/team-board.mjs';
const owner='11111111-1111-4111-8111-111111111111',peer='22222222-2222-4222-8222-222222222222',origin='https://site.example';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/team-board-schema.sql',import.meta.url),'utf8'));
 const env={GOOGLE_DB:{prepare(sql){return{bind(...args){return{
  async first(){return db.prepare(sql).get(...args)||null;},
  async all(){return{results:db.prepare(sql).all(...args)};}
 };}};}}};
 return{db,env};
}
async function call(env,{profileId='arash',userId=owner,path='',body,originHeader=origin}={}){return handleTeamBoardRequest(new Request(origin+'/api/team-board'+path,{method:body?'POST':'GET',headers:{Origin:originHeader,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{profileId,userId});}
const draft={title:'Synthetic shared literature review',description:'Public sources only; no patient data.',assignee:'amir',dueAt:'2026-12-01T09:00:00Z',confirmShared:true};
test('explicitly published tasks are shared with the two doctors without returning owner identifiers',async()=>{
 const {env}=fixture();const made=await call(env,{path:'/tasks',body:draft});assert.equal(made.status,201);const created=(await made.json()).task;assert.equal(created.creatorProfile,'arash');assert.equal(created.canUpdate,true);
 const other=await(await call(env,{profileId:'amir',userId:peer})).json();assert.equal(other.tasks.length,1);assert.equal(other.tasks[0].canUpdate,true);assert.equal(other.providerConnectionsShared,false);assert(!JSON.stringify(other).includes(owner));assert(!JSON.stringify(other).includes(peer));assert.equal(other.sharing,'explicit_tasks_only');
});
test('workspace, origin, explicit consent and forged ownership inputs fail closed',async()=>{
 const {env}=fixture();assert.equal((await call(env,{userId:'missing'})).status,403);assert.equal((await call(env,{profileId:'other'})).status,403);assert.equal((await call(env,{path:'?profile=amir'})).status,403);
 assert.equal((await call(env,{path:'/tasks',body:{...draft,confirmShared:false}})).status,400);assert.equal((await call(env,{path:'/tasks',body:draft,originHeader:'https://evil.example'})).status,403);assert.equal((await call(env,{path:'/tasks',body:{...draft,creator_id:peer}})).status,400);
 assert.equal((await(await call(env)).json()).tasks.length,0);
});
test('only creator or assigned doctor can update, with no reassignment or private action side effects',async()=>{
 const {env}=fixture();const made=(await(await call(env,{path:'/tasks',body:{...draft,assignee:'arash'}})).json()).task;
 assert.equal((await call(env,{path:'/tasks/'+made.id,profileId:'amir',userId:peer,body:{status:'done'}})).status,404);
 assert.equal((await call(env,{path:'/tasks/'+made.id,body:{status:'in_progress'}})).status,200);
 assert.equal((await call(env,{path:'/tasks/'+made.id,body:{status:'done',assignee:'amir'}})).status,400);
 const joint=(await(await call(env,{path:'/tasks',body:{...draft,assignee:'both'}})).json()).task;assert.equal((await call(env,{path:'/tasks/'+joint.id,profileId:'amir',userId:peer,body:{status:'done'}})).status,200);
});
test('calendar timestamps and task sizes are bounded, impossible dates never normalize into another day',async()=>{
 const {env}=fixture();for(const dueAt of ['2026-02-31T09:00:00Z','2026-11-12T25:00:00Z','2026-11-12T09:00','not a date'])assert.equal((await call(env,{path:'/tasks',body:{...draft,dueAt}})).status,400,dueAt);
 assert.equal((await call(env,{path:'/tasks',body:{...draft,title:'x'.repeat(181)}})).status,400);assert.equal((await call(env,{path:'/tasks',body:{...draft,description:'x'.repeat(1001)}})).status,400);
});
test('forty-task capacity is enforced atomically by the insert, not a browser count',async()=>{
 const {env,db}=fixture();for(let i=0;i<40;i++)assert.equal((await call(env,{path:'/tasks',body:{...draft,title:'Synthetic '+i}})).status,201);
 assert.equal((await call(env,{path:'/tasks',body:draft})).status,409);assert.equal(db.prepare('SELECT count(*) AS n FROM team_board_tasks').get().n,40);assert.equal((await(await call(env)).json()).canCreate,false);
});
