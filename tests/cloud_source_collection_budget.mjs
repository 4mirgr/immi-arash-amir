import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {collectRegisteredSources} from '../cloud/source-collectors.mjs';
import {runScheduledCollection} from '../cloud/source-automation.mjs';

function meteredFixture(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['opportunity-v2-schema.sql','source-registry-schema.sql','public-page-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const cost={queries:0,bindings:0};
 const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values);},async first(){cost.queries++;cost.bindings++;return db.prepare(sql).get(...args)||null;},async all(){cost.queries++;cost.bindings++;return{results:db.prepare(sql).all(...args)};},async run(){cost.queries++;cost.bindings++;return{meta:db.prepare(sql).run(...args)};},_run(){return{meta:db.prepare(sql).run(...args)};}});
 const binding={prepare:sql=>wrap(sql),async batch(items){cost.bindings++;cost.queries+=items.length;db.exec('BEGIN');try{const out=items.map(x=>x._run());db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}}};
 return{db,cost,env:{OPPORTUNITY_DB:binding}};
}
function densePageup(academic=false){return JSON.stringify(Array.from({length:40},(_,i)=>({Id:String(i+1),Title:(academic?'Research Fellow in Clinical Medicine ':'General Practitioner ')+('漢'.repeat(500)),CategoryList:['Medical'],Brand:'Synthetic '+i+' '+('漢'.repeat(300)),OpeningDateUtc:'/Date(1767225600000)/',ClosingDateUtc:'/Date(4070908800000)/',Summary:'漢'.repeat(2500),Overview:'漢'.repeat(16000),Locations:'漢'.repeat(500),SiteSuburb:'漢'.repeat(200)})));}
const denseRSS=()=>'<rss><channel>'+Array.from({length:60},(_,i)=>'<item><title>Borsa di studio in medicina '+i+' '+('漢'.repeat(500))+'</title><link>https://bandi.unibo.it/call/synthetic-'+i+'</link><description>'+('漢'.repeat(3000))+'</description></item>').join('')+'</channel></rss>';

test('hourly maximum100record import uses bounded JSON statements under free limits and retains partial cursor',async t=>{
 const f=meteredFixture();const medical=densePageup(),academic=densePageup(true),rss=denseRSS();let http=0;
 const fetcher=async url=>{http++;return new Response(url.includes('/759/')?medical:url.includes('/513/')?academic:rss,{headers:{etag:'"synthetic-dense-body"'}});};
 const result=await runScheduledCollection({scheduledTime:Date.now()},f.env,env=>collectRegisteredSources(env,fetcher));
 assert.equal(result.imported,100);assert.deepEqual(result.sources.map(row=>row.imported),[40,40,20]);
 assert.equal(result.sources[2].partial,true);assert.equal(result.sources[2].nextCursor,20);
 assert.equal(f.db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,100);
 assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_queue').get().n,100);
 assert(f.cost.queries<=45,JSON.stringify(f.cost));assert(f.cost.bindings+http<50,JSON.stringify({...f.cost,http}));
 assert.equal(f.db.prepare("SELECT status FROM source_scheduler_state WHERE id='public_collector'").get().status,'completed');
 t.diagnostic(JSON.stringify({d1Queries:f.cost.queries,bindingRequests:f.cost.bindings,httpRequests:http}));
});
