import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {upsertOpportunityBatch,handleOpportunityV2Request,ingestLegacyTasmania} from '../cloud/opportunity-store.mjs';
const time=Date.UTC(2026,10,3,12);
const source={id:'synthetic-au',name:'Synthetic publisher',country:'AU',state:'NSW',trust:'official',allowedHosts:['jobs.example.invalid']};
const italy={id:'synthetic-it',name:'Synthetic University',country:'IT',state:'Lazio',trust:'official',allowedHosts:['university.example.invalid'],profileScope:'both',opportunityType:'university'};
const owner={userId:'synthetic-owner',profileId:'amir'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/opportunity-v2-schema.sql',import.meta.url),'utf8'));
 const prepare=sql=>({bind(...args){const statement=db.prepare(sql);return {async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return {success:true,meta:statement.run(...args)};},_run(){return statement.run(...args);}};}});
 return {db,env:{OPPORTUNITY_DB:{prepare,async batch(items){db.exec('BEGIN');try{for(const item of items)item._run();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}}}};
}
const record=(extra={})=>({externalId:'job-123',title:'Medical Registrar — Internal Medicine',url:'https://jobs.example.invalid/123',organization:'Example Hospital',organizationDomain:'hospital.example.invalid',publishedAt:'2026-11-01T00:00:00Z',closingAt:'2099-11-10T00:00:00Z',summary:'A synthetic listing.',...extra});
const req=(path,options={})=>new Request('https://app.example'+path,options);
const get=(env,path='/api/opportunities',context=owner)=>handleOpportunityV2Request(req(path),env,context);

test('repeat publication becomes a separate edition under the same organization',async()=>{
 const {db,env}=fixture();
 assert.equal((await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record()],time)).inserted,1);
 assert.equal((await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record({publishedAt:'2026-11-02T00:00:00Z',closingAt:'2099-12-10T00:00:00Z'})],time+1000)).inserted,1);
 assert.equal(db.prepare('select count(*) n from opportunity_editions').get().n,2);
 assert.equal(db.prepare('select count(*) n from opportunity_organizations').get().n,1);
 const listed=await (await get(env)).json();const id=listed.opportunities[0].organizationId;
 const history=await (await get(env,'/api/opportunities/organizations/'+id)).json();
 assert.equal(history.total,2);assert.equal(history.organization.name,'Example Hospital');
});
test('identical polls and description-only corrections update current edition without duplicates',async()=>{
 const {db,env}=fixture();await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record()],time);
 const first=db.prepare('select first_seen_at from opportunity_editions').get().first_seen_at;
 const result=await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record({summary:'Corrected overview, no new recruitment.'})],time+1000);
 assert.equal(result.inserted,0);assert.equal(result.updated,1);assert.equal(db.prepare('select count(*) n from opportunity_editions').get().n,1);
 const row=db.prepare('select * from opportunity_editions').get();assert.equal(row.first_seen_at,first);assert.equal(JSON.parse(row.data).summary,'Corrected overview, no new recruitment.');
});
test('material title change is a new edition while closed historical publications remain available',async()=>{
 const {db,env}=fixture();await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record({closingAt:'2020-01-01T00:00:00Z'})],time);
 await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record({title:'Senior Medical Registrar — General Medicine'})],time);
 assert.equal(db.prepare('select count(*) n from opportunity_editions').get().n,2);
 assert.equal((await(await get(env)).json()).total,1);
 assert.equal((await(await get(env,'/api/opportunities?includeClosed=true')).json()).total,2);
});
test('official/unofficial and opportunity-type filters do not fabricate coverage',async()=>{
 const {env}=fixture();
 await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record()],time);
 await upsertOpportunityBatch(env.OPPORTUNITY_DB,{...source,id:'synthetic-community',trust:'unofficial'},[record({externalId:'2',opportunityType:'grant'})],time);
 await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record({externalId:'3',opportunityType:'scholarship'})],time);
 const filtered=await(await get(env,'/api/opportunities?trust=unofficial&types=grant,scholarship')).json();assert.equal(filtered.total,1);assert.equal(filtered.opportunities[0].trust,'unofficial');
 assert.equal((await(await get(env,'/api/opportunities?types=scholarship')).json()).total,1);
 assert.equal((await get(env,'/api/opportunities?trust=trusted')).status,400);
});
test('Italy is forcibly Amir-only even if server source requests both',async()=>{
 const {env}=fixture();await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record()],time);
 await upsertOpportunityBatch(env.OPPORTUNITY_DB,italy,[record({externalId:'it1',country:'IT',state:'Lazio',url:'https://university.example.invalid/call/1',organization:'Synthetic Italian University',opportunityType:'scholarship'})],time);
 const arash={userId:'other-synthetic-owner',profileId:'arash'};
 assert.equal((await(await get(env,'/api/opportunities',arash)).json()).total,1);
 assert.equal((await get(env,'/api/opportunities?country=IT',arash)).status,403);
 const rows=(await(await get(env,'/api/opportunities?country=IT')).json()).opportunities;assert.equal(rows.length,1);assert.equal(rows[0].profileScope,'amir');assert.equal(rows[0].state,'IT-Lazio');
 assert.equal((await get(env,'/api/opportunities/organizations/'+rows[0].organizationId,arash)).status,403);
 const groups=await(await get(env,'/api/opportunities/organizations',arash)).json();assert.equal(groups.organizations.length,1);assert(groups.organizations.every(x=>x.country!=='IT'));
});
test('organization listing safely supports type, trust and text filters',async()=>{
 const {env}=fixture();await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record()],time);
 const groups=await(await get(env,'/api/opportunities/organizations?q=hospital&types=job&trust=official')).json();assert.equal(groups.organizations.length,1);assert.equal(groups.organizations[0].editionCount,1);
});
test('unregistered hosts, forged source countries, malformed batches fail before any mutation',async()=>{
 const {db,env}=fixture();
 for(const bad of [record({url:'javascript:alert(1)'}),record({url:'https://private.example.invalid/1'}),record({url:'https://user:pass@jobs.example.invalid/1'}),record({country:'IT'}),record({closingAt:'tomorrow'}),record({closingAt:'01/02/2026'}),record({closingAt:'2026-02-31T00:00:00Z'}),record({opportunityType:'visa_guarantee'})])await assert.rejects(()=>upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record(),bad],time));
 assert.equal(db.prepare('select count(*) n from opportunity_editions').get().n,0);
 await assert.rejects(()=>upsertOpportunityBatch(env.OPPORTUNITY_DB,{...source,allowedHosts:['127.0.0.1']},[],time));
 await assert.rejects(()=>upsertOpportunityBatch(env.OPPORTUNITY_DB,source,Array(501).fill(record()),time));
});
test('read-only API rejects forged owner, foreign profile and posted owner overrides',async()=>{
 const {env}=fixture();
 assert.equal((await get(env,'/api/opportunities',{userId:'x',profileId:'admin'})).status,403);
 assert.equal((await get(env,'/api/opportunities?profile=arash')).status,403);
 assert.equal((await handleOpportunityV2Request(req('/api/opportunities',{method:'POST',body:JSON.stringify({owner_id:'other',url:'https://evil.invalid'})}),env,owner)).status,405);
 assert.equal(await handleOpportunityV2Request(req('/api/unrelated'),env,owner),null);
});
test('HTML is inert text, unproved eligibility stays unknown, missing deadline is not verified open',async()=>{
 const {env}=fixture();await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record({title:'<b>Medical Registrar</b>',summary:'<script>secret()</script><p>Public information.</p>',closingAt:null,sponsorship:true})],time);
 const item=(await(await get(env)).json()).opportunities[0];assert.equal(item.status,'unknown');assert.equal(item.sponsorship,null);assert(!item.summary.includes('secret()'));assert(!item.title.includes('<b>'));assert.equal(item.match.meaning,'known_text_signals_not_acceptance_probability');
});
test('legacy Tasmania ingestion preserves source identity and is repeatable',async()=>{
 const {db,env}=fixture();db.exec('create table job_opportunities(source_id text,data text,status text)');
 db.prepare('insert into job_opportunities values(?,?,?)').run('tas-pageup-759',JSON.stringify(record({id:'job_tas_123',externalId:undefined,state:'TAS',url:'https://careers.pageuppeople.com/759/cw/en/job/123'})),'open');
 assert.equal((await ingestLegacyTasmania(env.OPPORTUNITY_DB,time)).inserted,1);assert.equal((await ingestLegacyTasmania(env.OPPORTUNITY_DB,time+1000)).inserted,0);
 assert.equal(db.prepare('select external_id from opportunity_editions').get().external_id,'123');
});


test('bulk import keeps SQL query count bounded for many records and rejects oversized normalized payloads atomically',async()=>{
 const {db,env}=fixture();let preparedQueries=0;const base=env.OPPORTUNITY_DB.prepare;
 env.OPPORTUNITY_DB.prepare=sql=>{preparedQueries++;return base(sql);};
 await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,Array.from({length:100},(_,i)=>record({externalId:String(i),url:'https://jobs.example.invalid/'+i})),time);
 assert.equal(db.prepare('select count(*) n from opportunity_editions').get().n,100);
 assert(preparedQueries<=4,'Bulk JSON writes must avoid one SQL statement per record');
 const before=db.prepare('select count(*) n from opportunity_editions').get().n;
 await assert.rejects(()=>upsertOpportunityBatch(env.OPPORTUNITY_DB,source,Array.from({length:200},(_,i)=>record({externalId:'large-'+i,fullText:'ا'.repeat(20000)})),time),error=>error.code==='opportunity_normalized_batch_limit');
 assert.equal(db.prepare('select count(*) n from opportunity_editions').get().n,before);
});

test('GP/medical and rural text filters apply before pagination and retain unknown eligibility',async()=>{
 const {env}=fixture();await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[record({externalId:'gp',title:'General Practitioner',summary:'Regional practice. MMM 5. DPA status requires confirmation.'}),record({externalId:'nurse',title:'General Practice Nurse',summary:'Rural practice.'}),record({externalId:'mo',title:'Medical Officer'}),record({externalId:'reg',title:'Medical Registrar'})],time);
 let data=await(await get(env,'/api/opportunities?clinicalFocus=gp&ruralOnly=true&sort=newest',{userId:'arash-owner',profileId:'arash'})).json();assert.equal(data.total,1);assert.equal(data.opportunities[0].externalId,'gp');assert.deepEqual(data.opportunities[0].gpSignals.monashMentioned,[5]);assert.equal(data.opportunities[0].gpSignals.eligibility,'not_assessed');
 data=await(await get(env,'/api/opportunities?clinicalFocus=medical')).json();assert.equal(data.total,2);
 assert.equal((await get(env,'/api/opportunities?clinicalFocus=arbitrary')).status,400);assert.equal((await get(env,'/api/opportunities?ruralOnly=yes')).status,400);assert.equal((await get(env,'/api/opportunities?sort=random')).status,400);
});
