import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedClinicFixture} from './helpers/linked-clinic-fixture.mjs';
import {dispatchPublicPageReading} from '../cloud/public-page-worker.mjs';
test('current linked services reach the opportunity as separate source-bound evidence with no extra queries',async()=>{
 const f=await linkedClinicFixture(),before=f.queries,view=await f.view();assert.equal(f.queries-before,4);assert.equal(view.reading.pageId,f.parentId);assert.equal(view.clinicEvidence.length,2);
 for(const fact of view.clinicEvidence){assert.equal(fact.sourceURL,f.child.url);assert.equal(fact.readAt,f.childAt);assert.equal(fact.parentPageId,f.parentId);assert.equal(fact.parentReadAt,f.parentAt);}
 assert(view.clinicEvidence.some(x=>x.text===f.service));assert(view.clinicEvidence.some(x=>x.text===f.training));assert(!view.fullText.includes(f.service));
});
test('unreadable, stale, mismatched, foreign or unbound linked pages cannot become clinic evidence',async()=>{
 const changes=[
  f=>f.db.prepare("UPDATE public_page_queue SET status='fetch_failed' WHERE id=?").run(f.child.id),
  f=>f.db.prepare("UPDATE public_page_content SET read_at=? WHERE page_id=?").run(new Date(f.now-40000).toISOString(),f.child.id),
  f=>f.db.prepare("UPDATE public_page_enrichment SET data=json_remove(data,'$.parentReadAt') WHERE page_id=?").run(f.child.id),
  f=>f.db.prepare("UPDATE public_page_queue SET data=json_remove(data,'$.parentReadAt') WHERE id=?").run(f.child.id),
  f=>f.db.prepare("UPDATE public_page_enrichment SET data=json_set(data,'$.parentPageId',?) WHERE page_id=?").run('page_'+'2'.repeat(32),f.child.id),
  f=>f.db.prepare("UPDATE public_page_enrichment SET data=json_set(data,'$.sourceURL','https://other.clinic.example/services') WHERE page_id=?").run(f.child.id),
  f=>f.db.prepare("UPDATE public_page_enrichment SET data=json_set(data,'$.sourceURL','https://foreign.example/services') WHERE page_id=?").run(f.child.id),
 ];
 for(const change of changes){const f=await linkedClinicFixture();change(f);assert.deepEqual((await f.view()).clinicEvidence,[]);}
 const stale=await linkedClinicFixture();assert.deepEqual((await stale.view(stale.now+8*86400000)).clinicEvidence,[]);
});
test('a later publication boundary blocks newer child wording from the older advertisement',async()=>{
 const f=await linkedClinicFixture(),nextAt=new Date(f.now-55000).toISOString();
 f.db.prepare("INSERT INTO opportunity_editions SELECT ?,source_id,external_id,organization_id,'next',profile_scope,trust,opportunity_type,country,state,title,url,published_at,closing_at,status,data,?,? FROM opportunity_editions WHERE id=?").run('opp_'+'b'.repeat(32),nextAt,nextAt,f.id);
 const view=await f.view();assert.equal(view.reading.status,'read');assert.deepEqual(view.clinicEvidence,[]);
});
test('parent refresh renews existing child links even at the three-child cap and requires a fresh child receipt',async()=>{
 const f=await linkedClinicFixture(),nextParent=new Date(f.now-30000).toISOString(),nextChild=new Date(f.now-20000).toISOString();assert.equal(f.db.prepare("SELECT count(*) n FROM public_page_queue WHERE json_extract(data,'$.parentPageId')=?").get(f.parentId).n,3);
 await f.storePage({id:f.parentId,url:f.root},f.rootHTML,nextParent);
 let child=f.db.prepare('SELECT * FROM public_page_queue WHERE id=?').get(f.child.id);assert.equal(JSON.parse(child.data).parentReadAt,nextParent);assert.equal(JSON.parse(child.data).refreshRequested,true);assert.equal(child.available_at,0);assert.deepEqual((await f.view()).clinicEvidence,[]);
 await f.storePage(child,f.childHTML,nextChild,nextParent);
 const view=await f.view();assert.equal(view.clinicEvidence.length,2);assert(view.clinicEvidence.every(x=>x.parentReadAt===nextParent&&x.readAt===nextChild));
 await f.storePage({id:f.parentId,url:f.root},f.rootHTML,nextParent);child=f.db.prepare('SELECT * FROM public_page_queue WHERE id=?').get(f.child.id);assert(!JSON.parse(child.data).refreshRequested);assert.equal(f.db.prepare("SELECT count(*) n FROM public_page_queue WHERE json_extract(data,'$.parentPageId')=?").get(f.parentId).n,3);
});
test('an old in-flight child cannot erase the newer parent refresh request or claim its new relationship',async()=>{
 const f=await linkedClinicFixture(),newParent=new Date(f.now-30000).toISOString(),oldChildStart=new Date(f.now-40000).toISOString();f.db.prepare('UPDATE public_page_queue SET lease_until=?,attempts=2 WHERE id=?').run(f.now+60000,f.child.id);
 await f.storePage({id:f.parentId,url:f.root},f.rootHTML,newParent);
 await f.storePage(f.child,f.childHTML,oldChildStart,f.parentAt);
 const child=f.db.prepare('SELECT * FROM public_page_queue WHERE id=?').get(f.child.id),metadata=JSON.parse(child.data);assert.equal(metadata.parentReadAt,newParent);assert.equal(metadata.refreshRequested,true);assert.equal(child.available_at,0);assert.equal(child.attempts,0);assert.equal(child.lease_until,0);assert.deepEqual((await f.view()).clinicEvidence,[]);
 await f.storePage(child,f.childHTML,new Date(f.now-10000).toISOString(),newParent);assert.equal((await f.view()).clinicEvidence.length,2);
});
test('shared child URLs cannot be rebound to another parent and import-supplied evidence is never trusted',async()=>{
 const f=await linkedClinicFixture();f.db.prepare("UPDATE public_page_queue SET data=json_set(data,'$.parentPageId',?) WHERE id=?").run('page_'+'2'.repeat(32),f.child.id);
 await f.storePage({id:f.parentId,url:f.root},f.rootHTML,new Date(f.now-30000).toISOString());assert.equal(JSON.parse(f.db.prepare('SELECT data FROM public_page_queue WHERE id=?').get(f.child.id).data).parentPageId,'page_'+'2'.repeat(32));assert.deepEqual((await f.view()).clinicEvidence,[]);
 f.db.prepare("UPDATE opportunity_editions SET data=json_set(data,'$.clinicEvidence',json('[{\"text\":\"Invented statement\"}]')) WHERE id=?").run(f.id);assert.deepEqual((await f.view()).clinicEvidence,[]);
});
test('a crashed final child attempt preserves a newer parent generation instead of exhausting its fresh request',async()=>{
 const f=await linkedClinicFixture(),newParent=new Date(f.now-30000).toISOString();
 await f.storePage({id:f.parentId,url:f.root},f.rootHTML,newParent);
 f.db.prepare("UPDATE public_page_queue SET status='reading',attempts=3,lease_until=?,data=json_set(data,'$.leasedParentReadAt',?) WHERE id=?").run(f.now-1,f.parentAt,f.child.id);
 f.db.prepare("UPDATE public_page_queue SET available_at=? WHERE id<>? AND json_extract(data,'$.parentPageId')=?").run(f.now+86400000,f.child.id,f.parentId);
 const requests=[],result=await dispatchPublicPageReading(f.env,async url=>{requests.push(url);return url.endsWith('/robots.txt')?new Response(null,{status:404}):new Response(f.childHTML,{headers:{'Content-Type':'text/html'}});},f.now);
 assert.equal(result.processed,2);assert.equal(result.receipts[0].recovery,'lease_expired_after_attempt_limit');assert.equal(result.receipts[1].status,'read');assert.equal(requests.length,2);
 const child=f.db.prepare('SELECT * FROM public_page_queue WHERE id=?').get(f.child.id),metadata=JSON.parse(child.data);assert.equal(child.status,'read');assert.equal(child.attempts,0);assert.equal(metadata.parentReadAt,newParent);assert(!metadata.refreshRequested);assert(!metadata.leasedParentReadAt);assert.equal((await f.view()).clinicEvidence.length,2);
});
