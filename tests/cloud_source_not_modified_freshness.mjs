import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {collectRegisteredSources,SOURCE_REGISTRY} from '../cloud/source-collectors.mjs';
import {upsertOpportunityBatch} from '../cloud/opportunity-store.mjs';
const source=SOURCE_REGISTRY.find(x=>x.id==='tas-pageup-759');
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['opportunity-v2-schema.sql','source-registry-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const wrap=(sql,args=[])=>({bind(...v){return wrap(sql,v);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};},_run(){return {meta:db.prepare(sql).run(...args)};}});
 const binding={prepare:sql=>wrap(sql),async batch(items){db.exec('BEGIN');try{const result=items.map(x=>x._run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const at=Date.now()-4*86400000;
 for(const s of SOURCE_REGISTRY.filter(x=>x.executable).slice(0,3))db.prepare("INSERT INTO registered_source_checks(source_id,status,etag,last_success_at,next_check_at) VALUES(?,'updated',?,?,?)").run(s.id,'"synthetic-body"',at,s.id===source.id?0:Date.now()+86400000);
 async function add(id,values={},seen=at){const raw={externalId:id,title:'General Practitioner '+id,url:'https://careers.pageuppeople.com/759/cw/en/job/'+id,publishedAt:'2026-01-01T00:00:00Z',closingAt:'2099-01-01T00:00:00Z',organization:'Synthetic Hospital',...values};await upsertOpportunityBatch(binding,source,[raw],seen);return db.prepare('SELECT id FROM opportunity_editions WHERE external_id=? ORDER BY rowid DESC LIMIT 1').get(id).id;}
 const run=async(status=304)=>{db.exec("UPDATE source_collector_state SET position=0;UPDATE registered_source_checks SET next_check_at=0 WHERE source_id='tas-pageup-759'");return collectRegisteredSources({OPPORTUNITY_DB:binding},async(url,options)=>{assert.equal(url,source.feedUrl);return new Response(null,{status});});};
 const seen=id=>db.prepare('SELECT last_seen_at,status FROM opportunity_editions WHERE id=?').get(id);
 return {db,at,add,run,seen};
}
test('conditional304 renews only latest receipt current editions, never historical, removed or expired rows',async()=>{
 const f=fixture(),current=await f.add('current'),old=await f.add('same'),latest=await f.add('same',{title:'General Practitioner revised'}),absent=await f.add('absent',{},f.at-1000),closed=await f.add('closed',{closingAt:'2020-01-01T00:00:00Z'}),removed=await f.add('removed',{status:'source_removed'}),future=await f.add('future',{publishedAt:'2098-01-01T00:00:00Z'}),foreignFeed=await f.add('changed-feed');
 f.db.prepare("UPDATE opportunity_editions SET data=json_set(data,'$.sourceUrl','https://different.example.invalid/feed') WHERE id=?").run(foreignFeed);
 const initial=new Map([old,absent,closed,removed,future,foreignFeed].map(id=>[id,f.seen(id)]));
 const result=await f.run();assert.equal(result.sources[0].status,'not_modified');assert.equal(result.sources[0].refreshedObservations,2);assert.equal(result.sources[0].observationScope,'latest_receipt_current_editions_only');
 assert(Date.parse(f.seen(current).last_seen_at)>f.at);assert(Date.parse(f.seen(latest).last_seen_at)>f.at);
 for(const [id,row] of initial)assert.deepEqual(f.seen(id),row);
 const second=await f.run();assert.equal(second.sources[0].refreshedObservations,2,'successive304 receipts retain the same limited membership');
 assert.equal(f.db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,8);
});
test('unsolicited304 and prior failed/incomplete receipts cannot renew advertisements',async()=>{
 for(const update of ["etag=NULL","status='failed'","partial=1","record_cursor=40","last_success_at=NULL"]){
  const f=fixture(),id=await f.add('current'),before=f.seen(id);f.db.exec('UPDATE registered_source_checks SET '+update+" WHERE source_id='tas-pageup-759'");
  const result=await f.run();assert.equal(result.sources[0].status,'failed');assert.equal(result.sources[0].error,'source_unexpected_not_modified');assert.deepEqual(f.seen(id),before);
 }
});
test('failed source response and failed receipt transaction never renew opportunity freshness',async()=>{
 const f=fixture(),id=await f.add('current'),before=f.seen(id);
 const failed=await f.run(500);assert.equal(failed.sources[0].status,'failed');assert.deepEqual(f.seen(id),before);
 f.db.exec("UPDATE registered_source_checks SET status='updated' WHERE source_id='tas-pageup-759';CREATE TRIGGER reject_receipt BEFORE UPDATE OF status ON registered_source_checks WHEN NEW.status='not_modified' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure');END;");
 const rollback=await f.run();assert.equal(rollback.sources[0].status,'failed');assert.deepEqual(f.seen(id),before,'edition freshness and source receipt are atomic');
});
