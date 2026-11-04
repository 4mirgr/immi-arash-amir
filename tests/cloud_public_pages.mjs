import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {enqueuePublicPages,storePublicReading,handlePublicPagesRequest} from '../cloud/public-page-store.mjs';
import {robotsAllows,readQueuedPage,dispatchPublicPageReading,visiblePageText} from '../cloud/public-page-worker.mjs';
function fixture(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/public-page-schema.sql',import.meta.url),'utf8'));let queries=0;const binding={prepare(sql){queries++;return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},run(){return {meta:db.prepare(sql).run(...args)};}};}};},async batch(items){db.exec('BEGIN');try{const results=items.map(s=>s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};return {db,env:{OPPORTUNITY_DB:binding,PUBLIC_PAGE_READING_ENABLED:'true'},queries:()=>queries};}
const row=(n=1,country='IT')=>({id:'page_'+String(n).padStart(32,'0'),url:'https://example.invalid/call-'+n,country,institutionIds:['university-1'],officialBases:['example.invalid'],labels:['Clinical research call']});
const body='Clinical research scholarship. Applications are invited for a doctoral programme in medicine. Applicants must hold a relevant degree. Funding is subject to the full published call. Applications close on 30 November 2026. Read the full requirements before applying.';
test('only actual reading produces owner-scoped extracted evidence; queued links do not',async()=>{const f=fixture(),r=row();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[r]);assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_evidence').get().n,0);await storePublicReading(f.env.OPPORTUNITY_DB,{...r,status:'read',readAt:new Date().toISOString(),title:'Clinical scholarship',text:body});const a=f.db.prepare('SELECT * FROM public_page_evidence').all();assert.equal(a.length,1);assert.equal(a[0].profile_id,'amir');assert.equal(JSON.parse(a[0].analysis).eligibility,'not_assessed');assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_content').get().n,1);});
test('repeat discovery keeps provenance and reading state, and unreadable replacement invalidates old claims',async()=>{const f=fixture(),r=row();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[r]);await storePublicReading(f.env.OPPORTUNITY_DB,{...r,status:'read_partial',readAt:new Date().toISOString(),text:body});await enqueuePublicPages(f.env.OPPORTUNITY_DB,[{...r,institutionIds:['university-2']}]);const q=f.db.prepare('SELECT * FROM public_page_queue').get();assert.deepEqual(JSON.parse(q.data).institutionIds,['university-1','university-2']);assert.equal(q.status,'read_partial');await storePublicReading(f.env.OPPORTUNITY_DB,{...r,status:'robots_blocked',readAt:new Date().toISOString()});assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_evidence').get().n,0);});
test('Italy results cannot cross into Arash and section filtering uses actual evidence',async()=>{const f=fixture(),r=row();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[r]);await storePublicReading(f.env.OPPORTUNITY_DB,{...r,status:'read',readAt:new Date().toISOString(),text:body});const req=q=>new Request('https://app.example/api/research/pages?'+q);assert.equal((await handlePublicPagesRequest(req('country=IT'),f.env,{userId:'b',profileId:'arash'})).status,403);const result=await(await handlePublicPagesRequest(req('country=IT&section=study'),f.env,{userId:'a',profileId:'amir'})).json();assert.equal(result.total,1);assert.equal(result.queue.read,1);assert(!JSON.stringify(result).includes('public_page_content'));assert.equal((await handlePublicPagesRequest(req('country=AU&profile=amir'),f.env,{userId:'b',profileId:'arash'})).status,403);});
test('robots precedence and hidden navigation are not mistaken for source content',()=>{assert.equal(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/open','https://example.invalid/private/open').allowed,true);assert.equal(robotsAllows('User-agent: *\nDisallow: /','https://example.invalid/call').allowed,false);assert.equal(robotsAllows('User-agent: Masir\nAllow: /\nUser-agent: MasirUniversityDiscovery\nDisallow: /','https://example.invalid/call').allowed,false);const text=visiblePageText('<html><title>Clinical</title><nav>Funding guaranteed</nav><main>Actual admission requirements.</main><script>attack()</script></html>').text;assert(text.includes('Actual admission'));assert(!text.includes('Funding guaranteed'));assert(!text.includes('attack()'));});
test('scheduled reader uses no private grants, processes at most two and never bypasses robots',async()=>{const f=fixture();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[row(1),row(2),row(3)]);Object.defineProperty(f.env,'GOOGLE_DB',{get(){throw Error('No private storage');}});let calls=0;const fetcher=async(url,opts)=>{calls++;assert.equal(opts.redirect,'manual');assert(!opts.headers.Authorization);return url.endsWith('/robots.txt')?new Response('User-agent: *\nDisallow: /',{headers:{'Content-Type':'text/plain'}}):new Response(body,{headers:{'Content-Type':'text/plain'}});};const result=await dispatchPublicPageReading(f.env,fetcher);assert.equal(result.processed,2);assert.equal(calls,2);assert.equal(f.db.prepare("SELECT count(*) n FROM public_page_queue WHERE status='pending'").get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_evidence').get().n,0);assert(f.queries()<20);});
test('reader rejects PDF-as-HTML and foreign/private redirects rather than inventing content',async()=>{const r={...row(),data:JSON.stringify(row())};for(const kind of ['pdf','foreign']){const out=await readQueuedPage(r,async(url)=>url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /',{headers:{'Content-Type':'text/plain'}}):kind==='pdf'?new Response('not parsed',{headers:{'Content-Type':'application/pdf'}}):new Response(null,{status:302,headers:{Location:'https://foreign.invalid/login'}}));assert.equal(out.status,kind==='pdf'?'pdf_reader_required':'invalid_url');assert.equal(out.text,'');}});
const DAY=24*60*60*1000;
const readable=async url=>url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /',{headers:{'Content-Type':'text/plain'}}):new Response(body,{headers:{'Content-Type':'text/plain'}});
test('successful pages refresh after seven days; evidence remains while leased and is replaced on result',async()=>{
 const f=fixture(),r=row(),now=Date.now();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[r]);
 await storePublicReading(f.env.OPPORTUNITY_DB,{...r,status:'read',readAt:new Date(now).toISOString(),text:body},now);
 assert.equal(f.db.prepare('SELECT available_at FROM public_page_queue').get().available_at,now+7*DAY);
 assert.equal((await dispatchPublicPageReading(f.env,readable,now+7*DAY-1)).processed,0);
 let observed=false;
 const refresh=async url=>{if(!observed){observed=true;assert.equal(f.db.prepare('SELECT status FROM public_page_queue').get().status,'read');assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_evidence').get().n,1);assert.equal((await dispatchPublicPageReading(f.env,readable,now+7*DAY)).processed,0);}return readable(url);};
 assert.equal((await dispatchPublicPageReading(f.env,refresh,now+7*DAY)).processed,1);
 const saved=f.db.prepare('SELECT * FROM public_page_queue').get();assert.equal(saved.status,'read');assert.equal(saved.attempts,0);assert.equal(saved.available_at,now+14*DAY);
 assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_evidence').get().n,1);
});
test('transient failures retry after 24h up to three attempts and recovery starts a new successful cycle',async()=>{
 const f=fixture(),now=Date.now();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[row()]);let calls=0;
 const unavailable=async()=>{calls++;return new Response('Unavailable',{status:503});};
 for(let attempt=1;attempt<=3;attempt++){
  assert.equal((await dispatchPublicPageReading(f.env,unavailable,now+(attempt-1)*DAY)).processed,1);
  const state=f.db.prepare('SELECT * FROM public_page_queue').get();assert.equal(state.attempts,attempt);assert.equal(state.status,'robots_unavailable');
  assert.equal((await dispatchPublicPageReading(f.env,unavailable,now+attempt*DAY-1)).processed,0);
 }
 assert.equal((await dispatchPublicPageReading(f.env,unavailable,now+30*DAY)).processed,0);assert.equal(calls,3);
 const recovered=fixture();await enqueuePublicPages(recovered.env.OPPORTUNITY_DB,[row()]);await dispatchPublicPageReading(recovered.env,unavailable,now);
 assert.equal((await dispatchPublicPageReading(recovered.env,readable,now+DAY)).processed,1);
 assert.equal(recovered.db.prepare('SELECT attempts FROM public_page_queue').get().attempts,0);
});
test('refresh failure invalidates old evidence and permanent robots denial is never automatically retried',async()=>{
 const f=fixture(),r=row(),now=Date.now();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[r]);await storePublicReading(f.env.OPPORTUNITY_DB,{...r,status:'read_partial',readAt:new Date(now).toISOString(),text:body},now);
 const denied=async()=>new Response('User-agent: *\nDisallow: /',{headers:{'Content-Type':'text/plain'}});
 assert.equal((await dispatchPublicPageReading(f.env,denied,now+7*DAY)).processed,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_evidence').get().n,0);
 assert.equal(f.db.prepare('SELECT status FROM public_page_queue').get().status,'robots_blocked');
 assert.equal((await dispatchPublicPageReading(f.env,readable,now+90*DAY)).processed,0);
});
test('legacy read rows honor seven-day age even before available_at has been initialized',async()=>{
 const f=fixture(),r=row(),now=Date.now();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[r]);
 f.db.prepare("UPDATE public_page_queue SET status='read',read_at=?,available_at=0").run(new Date(now).toISOString());
 assert.equal((await dispatchPublicPageReading(f.env,readable,now+DAY)).processed,0);
 assert.equal((await dispatchPublicPageReading(f.env,readable,now+7*DAY)).processed,1);
});
test('permanent HTTP rejection does not consume repeated fetch budget, but rate limits retry',async()=>{
 for(const [code,status,retry] of [[404,'http_rejected',false],[429,'http_error',true]]){
  const f=fixture(),now=Date.now();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[row()]);
  const fetcher=async url=>url.endsWith('/robots.txt')?new Response('User-agent: *\nAllow: /'):new Response('Unavailable',{status:code});
  await dispatchPublicPageReading(f.env,fetcher,now);assert.equal(f.db.prepare('SELECT status FROM public_page_queue').get().status,status);
  assert.equal((await dispatchPublicPageReading(f.env,fetcher,now+DAY)).processed,retry?1:0);
 }
});
test('storage failure invalidates previous evidence and schedules a bounded retry',async()=>{
 const f=fixture(),r=row(),now=Date.now();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[r]);await storePublicReading(f.env.OPPORTUNITY_DB,{...r,status:'read',readAt:new Date(now).toISOString(),text:body},now);
 const batch=f.env.OPPORTUNITY_DB.batch;let fail=true;
 f.env.OPPORTUNITY_DB.batch=async items=>{if(fail){fail=false;throw Error('Synthetic storage interruption');}return batch(items);};
 assert.equal((await dispatchPublicPageReading(f.env,readable,now+7*DAY)).receipts[0].status,'reading_storage_failed');
 assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_evidence').get().n,0);
 assert.equal((await dispatchPublicPageReading(f.env,readable,now+8*DAY-1)).processed,0);
 assert.equal((await dispatchPublicPageReading(f.env,readable,now+8*DAY)).processed,1);
 assert.equal(f.db.prepare('SELECT attempts FROM public_page_queue').get().attempts,0);
});
test('versioned rediscovery requests an immediate reread while identical polls retain schedule and evidence',async()=>{
 const f=fixture(),r={...row(),discoveryVersion:'edition-1'},now=Date.now();await enqueuePublicPages(f.env.OPPORTUNITY_DB,[r]);
 await storePublicReading(f.env.OPPORTUNITY_DB,{...r,status:'read',readAt:new Date(now).toISOString(),text:body},now);
 await enqueuePublicPages(f.env.OPPORTUNITY_DB,[r]);assert.equal((await dispatchPublicPageReading(f.env,readable,now+1)).processed,0);
 await enqueuePublicPages(f.env.OPPORTUNITY_DB,[{...r,discoveryVersion:'edition-2'}]);
 const queued=f.db.prepare('SELECT * FROM public_page_queue').get();assert.equal(queued.status,'read');assert.equal(queued.available_at,0);assert.equal(queued.attempts,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_evidence').get().n,1);
 assert.equal((await dispatchPublicPageReading(f.env,readable,now+1)).processed,1);
 assert.equal(JSON.parse(f.db.prepare('SELECT data FROM public_page_queue').get().data).refreshRequested,undefined);
 await enqueuePublicPages(f.env.OPPORTUNITY_DB,[{...r,discoveryVersion:'edition-2'}]);assert.equal((await dispatchPublicPageReading(f.env,readable,now+2)).processed,0);
});
test('static hidden nested elements cannot contribute claims; visible sibling survives',()=>{
 const parsed=visiblePageText('<main>Visible requirements.<div hidden><div>Guaranteed funding.</div>Secret offer</div><p aria-hidden="true">Automatic registration.</p><section style="display: none !important"><b>Visa guaranteed.</b></section><div style="visibility:hidden">No exams.</div><p title="hidden">Visible deadline.</p></main>');
 assert(parsed.text.includes('Visible requirements.'));assert(parsed.text.includes('Visible deadline.'));
 for(const hidden of ['Guaranteed funding','Secret offer','Automatic registration','Visa guaranteed','No exams'])assert(!parsed.text.includes(hidden));
});
