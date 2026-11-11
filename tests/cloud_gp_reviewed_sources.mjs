import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {GP_REVIEWED_SOURCE_DEFINITIONS as defs,normalizeReviewedGpSourceRecords as normalize} from '../cloud/gp-reviewed-source-adapter.mjs';
import {SOURCE_REGISTRY,normalizeSourceRecords,collectRegisteredSources} from '../cloud/source-collectors.mjs';
const active=defs.filter(s=>s.executable),allActive=SOURCE_REGISTRY.filter(s=>s.executable);
const html=body=>'<html><head><title>Synthetic clinic careers</title></head><body>'+body+'</body></html>';
function content(source,negative=false){return html(source.id==='reviewed-hwq-wembley-level1'?'<p>Publisher headquarters email publisher@example.invalid.</p><h2>Position Highlights:</h2><p>General Practitioner opportunity for International Medical Graduates requiring Level 1-2 supervision. AMC Certificate required. Eligibility for RACGP PESCI assessment.</p><h3>Practice Contact Details:</h3><p>Practice: Wembley Rd Medical Centre Contact: Synthetic contact Phone: 07 1234 5678 Email: apply@wrmc.au Website: www.wrmc.au</p><button>APPLY NOW!</button><p>Publisher elsewhere email publisher@example.invalid.</p>':'<h1>General Practitioner employment and training</h1><p>Our practice invites GP enquiries and international medical graduates to discuss the requirements of supervised general practice.</p><p>'+(negative?'We currently do not have any positions for PESCI or Level 1 supervision.':'IMG support may be available, subject to registration requirements.')+'</p><p>Email your CV to <a href="mailto:recruit@example.invalid">our recruitment team</a>.</p>');}
function fixture(position){
 const db=new DatabaseSync(':memory:');for(const file of ['opportunity-v2-schema.sql','source-registry-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 db.prepare("UPDATE source_collector_state SET position=? WHERE id='rotation'").run(position);
 const binding={prepare(sql){return{bind(...args){const st=db.prepare(sql);return{async first(){return st.get(...args)||null;},async all(){return{results:st.all(...args)};},async run(){return{success:true,meta:st.run(...args)};},_run(){return st.run(...args);}};}};},async batch(items){db.exec('BEGIN');try{for(const item of items)item._run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};return{db,env:{OPPORTUNITY_DB:binding}};
}
test('only reviewed successful collector HTTP pages activate; unavailable restriction source stays manual',()=>{
 assert.equal(active.length,7);assert.equal(new Set(defs.map(s=>s.id)).size,defs.length);assert.equal(defs.find(s=>s.id==='reviewed-ararat-level1-restriction').executable,false);
 for(const source of defs){assert.equal(new URL(source.feedUrl).protocol,'https:');assert.deepEqual(source.allowedHosts,[new URL(source.feedUrl).hostname]);assert(source.reason);assert.equal(source.evidenceQuotes,undefined);assert.equal(source.publishedContacts,undefined);assert(SOURCE_REGISTRY.some(s=>s.id===source.id));}
});
test('dynamic text preserves negative requirements and ignores old research quotes and hidden claims',async()=>{
 const source=active.find(s=>s.id==='reviewed-alba-health-img');const body=content(source,true).replace('</body>','<p hidden>Level 1 supervision is available.</p><script>apply("evil@example.invalid")</script></body>');
 const [row]=await normalizeSourceRecords(source,body);assert.match(row.fullText,/do not have any positions for PESCI or Level 1/);assert(!row.fullText.includes('Level 1 supervision is available'));assert(!row.fullText.includes('evil@example.invalid'));assert(!row.fullText.includes('We can provide support and supervision to eligible'));
 assert.match(row.fullText,/recruit@example.invalid/);assert.equal(row.kind,'employment_register');assert.equal(row.closingAt,null);assert.equal(row.publishedAt,null);assert.equal(row.sponsorship,undefined);
});
test('referral adapter isolates the practice contact and retains AMC/PESCI requirements',()=>{
 const source=active[0],[row]=normalize(source,content(source));assert.match(row.fullText,/AMC Certificate required/);assert.match(row.fullText,/Level 1-2 supervision/);assert.match(row.fullText,/apply@wrmc.au/);assert(!row.fullText.includes('publisher@example.invalid'));assert.equal(row.kind,'vacancy');assert.equal(row.url,source.feedUrl);
 assert.throws(()=>normalize(source,html('General Practitioner jobs with no identifiable current practice section.')),e=>e.code==='reviewed_gp_job_section_missing');
});
test('network pages remain enquiry registers and cannot widen their host or fabricate a current vacancy',()=>{
 for(const source of active.filter(s=>s.kind==='employment_register')){const [row]=normalize({...source,feedUrl:'https://evil.invalid/',allowedHosts:['evil.invalid']},content(source));assert.equal(row.kind,'employment_register');assert.equal(row.url,source.feedUrl);assert.match(row.title,/expression of interest/);assert.equal(row.contactEvidence[0].sourceURL,source.feedUrl);}
 assert.throws(()=>normalize({...active[0],id:'unregistered'},content(active[0])));assert.throws(()=>normalize({...active[0],adapter:'other'},content(active[0])));assert.throws(()=>normalize(defs.find(s=>s.id==='reviewed-ararat-level1-restriction'),content(defs.find(s=>s.id==='reviewed-ararat-level1-restriction'))));
 for(const bad of ['Not HTML',html('Access denied'), html('General Practitioner careers — verify you are human. '+ 'This page requires a browser challenge. '.repeat(8)), 'x'.repeat(1000001)])assert.throws(()=>normalize(active[1],bad));
});
test('registered rotation obeys robots before body fetch and keeps source/record budgets bounded',async()=>{
 const start=allActive.findIndex(s=>s.id===active[0].id),f=fixture(start),calls=[];
 const receipt=await collectRegisteredSources(f.env,async(url,options)=>{calls.push({url,options});assert.equal(options.redirect,'manual');if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nDisallow: /');throw Error('No feed should be fetched after robots deny');});
 assert.equal(receipt.sourceBudget,3);assert.equal(receipt.recordBudget,100);assert.equal(receipt.sources.length,3);assert.equal(calls.length,3);assert(receipt.sources.every(s=>s.error==='source_robots_blocked'));assert.equal(f.db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,0);
});
test('fresh source pages flow through normal collection while missing HTTP pages never import',async()=>{
 const start=allActive.findIndex(s=>s.id===active[0].id),f=fixture(start),calls=[];
 const receipt=await collectRegisteredSources(f.env,async(url,options)=>{calls.push({url,options});if(url.endsWith('/robots.txt'))return new Response('',{status:404});const source=active.find(s=>s.feedUrl===url);return source.id===active[1].id?new Response('Not found',{status:404}):new Response(content(source),{headers:{etag:'"synthetic"'}});});
 assert.equal(receipt.sources.length,3);assert.equal(receipt.sourceBudget,3);assert.equal(calls.length,6);assert.equal(receipt.imported,2);assert.equal(receipt.sources[1].status,'failed');assert.equal(f.db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,2);
 const rows=f.db.prepare('SELECT data FROM opportunity_editions').all().map(r=>JSON.parse(r.data));assert(rows.every(row=>row.status==='unknown'));assert(rows.some(row=>row.kind==='employment_register'));
});

test('unavailable, redirected, HTML or excessive-delay robots receipts never fetch a page',async()=>{
 const start=allActive.findIndex(s=>s.id===active[0].id);
 for(const response of [()=>new Response('Denied',{status:403}),()=>new Response(null,{status:302,headers:{Location:'https://evil.invalid'}}),()=>new Response('<html>Bot check</html>'),()=>new Response('User-agent: *\nCrawl-delay: 31')]){const f=fixture(start),calls=[];const receipt=await collectRegisteredSources(f.env,async url=>{calls.push(url);assert(url.endsWith('/robots.txt'));return response();});assert.equal(calls.length,3);assert.equal(receipt.imported,0);assert(receipt.sources.every(s=>s.status==='failed'));}
});
