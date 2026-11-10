import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {upsertOpportunityBatch,handleOpportunityV2Request} from '../cloud/opportunity-store.mjs';
const source={id:'synthetic-gp-priority',name:'Synthetic GP network',country:'AU',state:'NSW',trust:'official',allowedHosts:['clinic.example.invalid']};
const arash={userId:'arash-owner',profileId:'arash'},amir={userId:'amir-owner',profileId:'amir'};
function binding(db,onPrepare=()=>{}){return {prepare(sql){onPrepare(sql);return {bind(...args){const p=db.prepare(sql);return {async first(){return p.get(...args)||null;},async all(){return {results:p.all(...args)};},async run(){return {meta:p.run(...args)};},_run(){return p.run(...args);}};}};},async batch(items){db.exec('BEGIN');try{for(const item of items)item._run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};}
async function fixture({privateSchema=true}={}){
 const db=new DatabaseSync(':memory:'),privateDb=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/opportunity-v2-schema.sql',import.meta.url),'utf8'));
 if(privateSchema)privateDb.exec(readFileSync(new URL('../cloud/gp-workflow-schema.sql',import.meta.url),'utf8'));
 let privateReads=0;const env={OPPORTUNITY_DB:binding(db),GOOGLE_DB:binding(privateDb,()=>privateReads++)};const at=Date.now()-100000;
 const records=[
  ['old-strong','Level 1 supervision is available. International medical graduates are welcome. We provide clinical supervision for IMGs. PESCI support is available. Visa sponsorship is available.'],
  ['new-weak','General practice service. Supervision details have not been published.'],
  ['newest-restricted','No Level 1 supervision is available. PESCI support is available. International medical graduates are welcome.'],
 ];
 for(let index=0;index<records.length;index++){const [id,fullText]=records[index];await upsertOpportunityBatch(env.OPPORTUNITY_DB,source,[{externalId:id,title:'General Practitioner — '+id,url:'https://clinic.example.invalid/'+id,organization:'Synthetic Clinic',organizationDomain:'clinic.example.invalid',location:'MMM1 metropolitan, non-DPA',summary:fullText,fullText,publishedAt:'2026-01-01T00:00:00Z',closingAt:'2099-12-01T00:00:00Z',status:'open',country:'AU',opportunityType:'job'}],at+index*1000);}
 const get=(context=arash,query='sort=fit&limit=25')=>handleOpportunityV2Request(new Request('https://workspace.example/api/opportunities?'+query),env,context);
 return {env,db,privateDb,get,reads:()=>privateReads};
}
test('GP application priority uses own goal once per page, preserves MMM1 and orders explicit restrictions below positive evidence',async()=>{
 const f=await fixture();f.privateDb.prepare('INSERT INTO gp_workflow_settings VALUES(?,?,?,?)').run(arash.userId,'arash','employment',new Date().toISOString());f.privateDb.prepare('INSERT INTO gp_workflow_settings VALUES(?,?,?,?)').run('foreign-owner','arash','pesci_readiness',new Date().toISOString());
 const response=await f.get(),result=await response.json();assert.equal(response.status,200);assert.equal(result.goalMode,'employment');assert.equal(f.reads(),1);assert.equal(result.total,3);assert.equal(result.rankingScope,'current_page_evidence_priority');
 assert.equal(result.opportunities[0].gpApplicationPriority.tier,5);assert.equal(result.opportunities.at(-1).gpApplicationPriority.tier,1);assert(result.opportunities.every(x=>x.gpApplicationPriority.goalMode==='employment'));assert(result.opportunities.every(x=>x.location.includes('MMM1')));assert(result.opportunities.every(x=>x.gpApplicationPriority.eligibility==='not_assessed'));
 const before=f.reads(),amir=await(await f.get({userId:'amir-owner',profileId:'amir'})).json();assert.equal(f.reads(),before);assert(!('goalMode' in amir));assert(amir.opportunities.every(x=>!('gpApplicationPriority' in x)));
});
test('ranking is bounded to the returned newest page; missing private migration does not break public listings',async()=>{
 const f=await fixture({privateSchema:false});const result=await(await f.get(arash,'sort=fit&limit=2')).json();assert.equal(result.goalMode,'pesci_readiness');assert.equal(result.total,3);assert.equal(result.opportunities.length,2);assert(result.opportunities.every(x=>x.gpApplicationPriority.tier!==5));assert.equal(result.rankingScope,'current_page_evidence_priority');
 const later=await(await f.get(arash,'sort=fit&limit=2&offset=2')).json();assert.equal(later.opportunities.length,1);assert.equal(later.opportunities[0].gpApplicationPriority.tier,5);
});
