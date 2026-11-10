import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {reconcileContactCoverage,CONTACT_COVERAGE_LIMIT,CONTACT_COVERAGE_POLICY} from '../cloud/contact-coverage.mjs';

function fixture({complete=true}={}){
 const db=new DatabaseSync(':memory:');
 for(const name of ['public-page-schema.sql','public-page-enrichment-schema.sql',...(complete?['opportunity-v2-schema.sql']:[])])db.exec(readFileSync(new URL('../cloud/'+name,import.meta.url),'utf8'));
 let queries=0;
 const binding={prepare(sql){queries++;return{bind(...args){return{async all(){return{results:db.prepare(sql).all(...args)};},run(){return{meta:db.prepare(sql).run(...args)};}};}};},async batch(statements){db.exec('BEGIN');try{const r=statements.map(s=>s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
 if(complete)db.prepare('INSERT INTO opportunity_organizations VALUES(?,?,?,?,?,?,?,?)').run('org','Synthetic','clinic.example','AU','NSW','{}','2026-01-01','2026-01-01');
 return{db,env:{OPPORTUNITY_DB:binding,PUBLIC_PAGE_READING_ENABLED:'true'},queries:()=>queries};
}
function opportunity(db,n,{country='AU',status='closed',url='https://clinic.example/jobs/'+n}={}){
 db.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('opp_'+String(n).padStart(32,'0'),'source','external-'+n,'org','edition-'+n,country==='IT'?'amir':'both','official','job',country,country==='AU'?'NSW':'UNKNOWN','General Practitioner '+n,url,null,'2020-01-01',status,'{}','2020-01-01','2020-01-01');
}
function page(db,n,{url='https://clinic.example/jobs/'+n,country='AU',status='read',version=2,metadata={},receipt='2026-01-01T00:00:00.000Z'}={}){
 const id='page_'+String(n).padStart(32,'0'),data={officialBases:['clinic.example'],labels:['GP role'],...metadata};
 db.prepare('INSERT INTO public_page_queue(id,url,country,profile_scope,data,status,read_at,available_at,attempts) VALUES(?,?,?,?,?,?,?,?,?)').run(id,url,country,country==='IT'?'amir':'both',JSON.stringify(data),status,receipt,9999999999999,2);
 db.prepare('INSERT INTO public_page_content VALUES(?,?,?,?,?,?,?,?)').run(id,receipt,status,'Synthetic','text/html','Clinical public information',null,'[]');
 db.prepare('INSERT INTO public_page_enrichment VALUES(?,?,?,?)').run(id,receipt,country,JSON.stringify({extractorVersion:version,readAt:receipt,contacts:[{value:'public@example.invalid'}]}));
 return id;
}
const now=Date.parse('2026-11-10T12:00:00Z');

test('old/closed and new editions are all covered with bounded, idempotent URL registration and Italian scope',async()=>{
 const f=fixture();for(let i=1;i<=30;i++)opportunity(f.db,i,{country:i%2?'AU':'IT',status:i%3?'closed':'open'});
 opportunity(f.db,31,{url:'https://clinic.example/jobs/1'});
 Object.defineProperty(f.env,'GOOGLE_DB',{get(){throw Error('No private storage permitted');}});
 const a=await reconcileContactCoverage(f.env,now);assert.equal(a.registered,CONTACT_COVERAGE_LIMIT);assert.equal(a.missingBefore,30);assert.equal(f.queries(),2);
 const b=await reconcileContactCoverage(f.env,now);assert.equal(b.registered,5);assert.equal(b.missingBefore,5);
 const c=await reconcileContactCoverage(f.env,now);assert.equal(c.registered,0);assert.equal(c.missingBefore,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_queue').get().n,30);
 assert.equal(f.db.prepare("SELECT count(*) n FROM public_page_queue WHERE country='IT' AND profile_scope<>'amir'").get().n,0);
 const row=f.db.prepare('SELECT * FROM public_page_queue LIMIT 1').get();assert.match(row.id,/^page_[a-f0-9]{32}$/);assert.equal(row.status,'pending');assert.equal(row.read_at,null);assert.equal(JSON.parse(row.data).contactCoveragePolicy,CONTACT_COVERAGE_POLICY);assert.equal(JSON.parse(row.data).requiredExtractorVersion,3);
 assert.equal(f.db.prepare("SELECT count(*) n FROM opportunity_editions WHERE status='closed'").get().n,21);
});

test('obsolete related roots and children get bounded refresh flags while existing receipts, metadata and blockers survive',async()=>{
 const f=fixture();for(let i=1;i<=30;i++){opportunity(f.db,i);page(f.db,i,{metadata:{custom:'preserve'}});}
 opportunity(f.db,31);const blocked=page(f.db,31,{status:'robots_blocked'});
 const parent='page_'+String(1).padStart(32,'0'),child=page(f.db,32,{url:'https://clinic.example/contact',metadata:{parentPageId:parent,parentURL:'https://clinic.example/jobs/1',depth:1,custom:'child-preserve'}});
 const a=await reconcileContactCoverage(f.env,now);assert.equal(a.refreshMarked,25);assert.equal(a.obsoleteBefore,31);assert.equal(f.queries(),2);
 const b=await reconcileContactCoverage(f.env,now);assert.equal(b.refreshMarked,6);assert.equal(b.obsoleteBefore,6);
 const c=await reconcileContactCoverage(f.env,now);assert.equal(c.refreshMarked,0);assert.equal(c.obsoleteBefore,0);
 const saved=f.db.prepare('SELECT * FROM public_page_queue WHERE id=?').get(child);assert.equal(saved.status,'read');assert.equal(saved.read_at,'2026-01-01T00:00:00.000Z');assert.equal(saved.available_at,0);assert.equal(saved.attempts,0);assert.equal(JSON.parse(saved.data).parentPageId,parent);assert.equal(JSON.parse(saved.data).custom,'child-preserve');assert.equal(JSON.parse(saved.data).refreshRequested,true);
 const unchanged=f.db.prepare('SELECT * FROM public_page_queue WHERE id=?').get(blocked);assert.equal(unchanged.status,'robots_blocked');assert.equal(unchanged.attempts,2);assert.equal(JSON.parse(unchanged.data).refreshRequested,undefined);
 assert.equal(f.db.prepare('SELECT read_at FROM public_page_enrichment WHERE page_id=?').get(child).read_at,saved.read_at);
});

test('current extractor, unrelated readings, active leases and mismatched receipts are not force-refreshed',async()=>{
 const f=fixture();for(let i=1;i<=4;i++)opportunity(f.db,i);
 page(f.db,1,{version:3});page(f.db,2);f.db.prepare('UPDATE public_page_queue SET lease_until=? WHERE url=?').run(now+10000,'https://clinic.example/jobs/2');
 page(f.db,3);f.db.prepare('UPDATE public_page_content SET read_at=? WHERE page_id=?').run('2025-01-01','page_'+String(3).padStart(32,'0'));
 page(f.db,4,{metadata:{refreshRequested:true}});page(f.db,5);
 const r=await reconcileContactCoverage(f.env,now);assert.equal(r.refreshMarked,0);assert.equal(r.obsoleteBefore,0);assert.equal(f.queries(),1);
});

test('registration and refresh together use at most three statements and never overwrite a pre-existing queue',async()=>{
 const f=fixture();opportunity(f.db,1);opportunity(f.db,2);page(f.db,2,{metadata:{parentPageId:'keep-existing-parent'}});
 const r=await reconcileContactCoverage(f.env,now);assert.equal(r.registered,1);assert.equal(r.refreshMarked,1);assert.equal(f.queries(),3);assert.equal(JSON.parse(f.db.prepare('SELECT data FROM public_page_queue WHERE url=?').get('https://clinic.example/jobs/2').data).parentPageId,'keep-existing-parent');
});

test('disabled, missing-schema, invalid target and conflicting country records fail safely without cross-owner inference',async()=>{
 const f=fixture();assert.equal((await reconcileContactCoverage({...f.env,PUBLIC_PAGE_READING_ENABLED:'false'},now)).enabled,false);assert.equal(f.queries(),0);
 assert.equal((await reconcileContactCoverage(fixture({complete:false}).env,now)).status,'storage_not_configured');
 opportunity(f.db,1,{url:'https://clinic.example/login?token=secret'});opportunity(f.db,2,{url:'https://same.example/ad',country:'AU'});opportunity(f.db,3,{url:'https://same.example/ad',country:'IT'});
 const r=await reconcileContactCoverage(f.env,now);assert.equal(r.registered,1);assert.equal(r.invalidTargets,1);assert.equal(r.scopeConflicts,1);assert.equal(r.status,'partial');assert.equal(f.db.prepare('SELECT status FROM public_page_queue').get().status,'invalid_url');
});

test('invalid legacy URLs get explicit blocked records and never starve later valid URLs or become fetchable',async()=>{
 const f=fixture();for(let i=1;i<=30;i++)opportunity(f.db,i,{url:'https://clinic.example/a-login-'+i+'/login?token=do-not-use'});opportunity(f.db,31,{url:'https://clinic.example/z-valid'});
 const first=await reconcileContactCoverage(f.env,now);assert.equal(first.registered,25);assert.equal(first.invalidTargets,25);
 const second=await reconcileContactCoverage(f.env,now);assert.equal(second.registered,6);assert.equal(second.invalidTargets,5);
 const target=f.db.prepare('SELECT * FROM public_page_queue WHERE url=?').get('https://clinic.example/z-valid');assert.equal(target.status,'pending');
 assert.equal(f.db.prepare("SELECT count(*) n FROM public_page_queue WHERE status='invalid_url'").get().n,30);
 const blocked=f.db.prepare("SELECT * FROM public_page_queue WHERE status='invalid_url' LIMIT 1").get();const metadata=JSON.parse(blocked.data);assert.equal(metadata.contactCoverageBlocked,true);assert.equal(metadata.blockedReason,'unsafe_legacy_url');assert.deepEqual(metadata.officialBases,[]);assert.equal(blocked.read_at,null);
 assert.equal((await reconcileContactCoverage(f.env,now)).registered,0);
});

test('oversized legacy URLs stay explicit exceptions without crowding the bounded valid-target batch',async()=>{
 const f=fixture();opportunity(f.db,1,{url:'https://clinic.example/a'+ 'x'.repeat(4100)});opportunity(f.db,2,{url:'https://clinic.example/z-valid'});
 const r=await reconcileContactCoverage(f.env,now);assert.equal(r.status,'partial');assert.equal(r.oversizedTargets,1);assert.equal(r.registered,1);assert.equal(f.db.prepare('SELECT url FROM public_page_queue').get().url,'https://clinic.example/z-valid');
});

test('a failed reconciliation batch cannot leave a partial registration or claim successful refresh',async()=>{
 const f=fixture();opportunity(f.db,1);opportunity(f.db,2);page(f.db,2);
 f.db.exec("CREATE TRIGGER reject_refresh BEFORE UPDATE ON public_page_queue BEGIN SELECT RAISE(ABORT,'Synthetic reconciliation failure'); END;");
 const r=await reconcileContactCoverage(f.env,now);assert.equal(r.status,'coverage_write_failed');assert.equal(r.registered,0);assert.equal(r.refreshMarked,0);assert.equal(f.db.prepare('SELECT count(*) n FROM public_page_queue').get().n,1);assert.equal(JSON.parse(f.db.prepare('SELECT data FROM public_page_queue').get().data).refreshRequested,undefined);
});
