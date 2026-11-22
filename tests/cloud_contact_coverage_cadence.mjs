import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {contactCoverageRepairDue,reconcileScheduledContactCoverage} from '../cloud/contact-coverage.mjs';
import {dispatchPublicPageReading} from '../cloud/public-page-worker.mjs';

const at=value=>Date.parse('2026-11-22T'+value+'Z');
function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const name of ['public-page-schema.sql','public-page-enrichment-schema.sql','opportunity-v2-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+name,import.meta.url),'utf8'));
 let coverageScans=0;
 const binding={prepare(sql){if(sql.startsWith('WITH missing AS'))coverageScans++;return {bind(...args){const statement=db.prepare(sql);return {async all(){return {results:statement.all(...args)};},async first(){return statement.get(...args)||null;},run(){return {meta:statement.run(...args)};}};}};},async batch(statements){db.exec('BEGIN');try{const result=statements.map(statement=>statement.run());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
 db.prepare('INSERT INTO opportunity_organizations VALUES(?,?,?,?,?,?,?,?)').run('org','Synthetic','clinic.example','AU','NSW','{}','2020-01-01','2020-01-01');
 return {db,env:{PUBLIC_PAGE_READING_ENABLED:'true',OPPORTUNITY_DB:binding},coverageScans:()=>coverageScans};
}
function legacy(db,n){db.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('opp_'+String(n).padStart(32,'0'),'source','external-'+n,'org','edition-'+n,'both','official','job','AU','NSW','General Practitioner '+n,'https://clinic.example/jobs/'+n,null,'2020-01-01','closed','{}','2020-01-01','2020-01-01');}

test('repair selects the :00/:30 scheduled reader slots across hour and day boundaries',()=>{
 for(const value of ['00:00:00','12:00:00','12:30:00','23:30:00'])assert.equal(contactCoverageRepairDue(at(value)),true,value);
 for(const value of ['00:05:00','12:05:00','12:25:00','12:35:00','12:55:00','23:55:00'])assert.equal(contactCoverageRepairDue(at(value)),false,value);
 for(const value of [NaN,Infinity,-1,undefined,'2026-11-22T12:00:00Z'])assert.equal(contactCoverageRepairDue(value),false);
});

test('intervening scheduled slots and disabled jobs spend no D1 query on coverage repair',async()=>{
 const env={PUBLIC_PAGE_READING_ENABLED:'true',OPPORTUNITY_DB:{prepare(){assert.fail('Cadence-skipped repair must not touch D1');}}};
 const result=await reconcileScheduledContactCoverage(env,at('12:05:00'));
 assert.equal(result.status,'cadence_skipped');assert.equal(result.registered,0);assert.equal(result.refreshMarked,0);assert.equal(result.nextRepairAt,at('12:30:00'));assert.equal(result.repairIntervalMinutes,30);
 assert.equal((await reconcileScheduledContactCoverage({...env,PUBLIC_PAGE_READING_ENABLED:'false'},at('12:00:00'))).enabled,false);
 assert.equal((await reconcileScheduledContactCoverage(env,NaN)).status,'invalid_time');
});

test('legacy repair stays progressive twice hourly while normal two-page reading continues every five minutes',async()=>{
 const f=fixture();for(let n=1;n<=30;n++)legacy(f.db,n);
 let requests=0;
 const fetcher=async url=>{requests++;assert(url.endsWith('/robots.txt'));return new Response('User-agent: *\nDisallow: /',{headers:{'Content-Type':'text/plain'}});};
 const results=[];
 for(let slot=0;slot<12;slot++)results.push(await dispatchPublicPageReading(f.env,fetcher,at('12:00:00')+slot*5*60000));
 assert.equal(f.coverageScans(),2,'The corpus scan runs 48 rather than 288 times per day');
 assert.equal(results[0].contactCoverage.registered,25);assert.equal(results[6].contactCoverage.registered,5);
 assert(results.filter((_,i)=>i!==0&&i!==6).every(result=>result.contactCoverage.status==='cadence_skipped'));
 assert(results.every(result=>result.processed===2),'The reader cadence and per-run work allowance are unchanged');
 assert.equal(requests,24);assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_queue').get().n,30);
 assert.equal(f.db.prepare("SELECT count(*) n FROM opportunity_editions WHERE status='closed'").get().n,30,'Backfill must not reopen historical advertisements');
});
