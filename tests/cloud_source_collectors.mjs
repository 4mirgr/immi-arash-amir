import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {SOURCE_REGISTRY,normalizeSourceRecords,validateSourceUrl,collectRegisteredSources,handleRegisteredSourcesRequest,registeredSourceStatuses} from '../cloud/source-collectors.mjs';
const source=id=>SOURCE_REGISTRY.find(s=>s.id===id);
const smartrow=(id='744000000000001',extra={})=>({id,name:'PhD Scholarship in liver fibrosis biomarkers',company:{identifier:'GriffithUniversity'},visibility:'PUBLIC',releasedDate:'2026-11-03T06:00:00.000Z',location:{country:'au',region:'QLD',city:'Nathan',fullLocation:'Nathan, QLD, Australia'},department:{label:'Health'},...extra});
const smartbody=(rows=[smartrow()])=>JSON.stringify({offset:0,limit:100,totalFound:rows.length,content:rows});
const pageup=(id='1',extra={})=>({Id:id,Title:'Medical Registrar - Internal Medicine',CategoryList:['Medical'],Brand:'Synthetic Hospital',OpeningDateUtc:'/Date(1793491200000)/',ClosingDateUtc:'/Date(4102444800000)/',...extra});
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['opportunity-v2-schema.sql','source-registry-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const prepare=sql=>({bind(...args){const st=db.prepare(sql);return {async first(){return st.get(...args)||null;},async all(){return {results:st.all(...args)};},async run(){return {success:true,meta:st.run(...args)};},_run(){return st.run(...args);}};}});
 return {db,env:{OPPORTUNITY_DB:{prepare,async batch(items){db.exec('BEGIN');try{for(const item of items)item._run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}}};
}
const uwaHtml=(url='https://external.jobs.uwa.edu.au/jobs/synthetic-medical-educator',title='Senior Lecturer Medical Educator')=>`<html><body><article class="col-12 job-search-results-card-col"><a id="link_job_title_1" href="${url}">${title}</a><span id="category_icon_text_a">Health and Medical Sciences</span><span id="location_icon_text_a">Rural WA</span><p class="card-text job-search-results-summary">Synthetic teaching role, requirements need review.</p></article></body></html>`;
const ntBody=(rows=[{rtfId:356340,jobTitle:'Medical Education Registrar',agency:'Department of Health',dateAdded:'/Date(1793491200000)/',closingDateAsDateTime:'/Date(4102444800000)/',primaryObjective:'Synthetic physician role'}])=>JSON.stringify({success:true,data:rows});
const rss=(url='https://bandi.unibo.it/call/synthetic',extra='')=>`<?xml version="1.0"?><rss><channel><item><title>Borsa di studio in medicina</title><link>${url}</link><guid>${url}</guid><pubDate>Tue, 03 Nov 2026 10:00:00 +0100</pubDate><description>Fictional fixture only.</description>${extra}</item></channel></rss>`;
function fetchFixture(log=[]){return async(url,options)=>{log.push({url,options});if(url.includes('bandi.unipi.it'))return new Response('<html><table><tr><th>Selezione</th><th>Scadenza</th></tr></table></html>',{headers:{etag:'"pisa"'}});if(url.includes('unict.it'))return new Response('<html><table><tr><th>Oggetto</th><th>Scadenza</th></tr></table></html>',{headers:{etag:'"catania"'}});if(url.includes('smartjobs.qld.gov.au'))return new Response('<html><ol class="search-results jobs"><li><h3><a href="jncustomsearch.viewFullSingle?in_organid=14904&amp;in_jnCounter=123"><span class="result-title"><strong>Medical Officer</strong>, Queensland Health</span></a></h3><div class="search-description">Synthetic rural role.</div><div class="meta"><time class="date-closes" datetime="2099-11-30T23:59:59+10:00">closes 30-Nov-2099</time></div></li></ol></html>',{headers:{etag:'"qld"'}});if(url.includes('jobs.health.nsw.gov.au'))return new Response('<html><div id="job_list_123" class="job_list_row jlr_Odd"><a href="https://jobs.health.nsw.gov.au/JMO-ex/jobs/resident-medical-officer-123" class="job_link font_bold">Resident Medical Officer</a></div></html>',{headers:{etag:'"nsw"'}});if(url.includes('ruralhealthwest.com.au'))return new Response(JSON.stringify({page:'General Practitioners',count:1,data:[{id:9,title:'General Practitioner',isPublic:1,address:{countryCode:'AU',state:'Western Australia',city:'Synthetic town'},publicDescription:'Synthetic rural GP opportunity.'}]}),{headers:{etag:'"rhw"'}});if(url.includes('ntphn.org.au'))return new Response('<rss><channel><item><title>General Practitioner</title><link>https://ntphn.org.au/job/synthetic-gp-9/</link><description>Synthetic regional practice.</description></item></channel></rss>',{headers:{etag:'"ntphn"'}});if(url.includes('thepeopleproject.com.au'))return new Response('<html><a class="news-item occupations-gp" id="post-9" href="https://thepeopleproject.com.au/jobs/synthetic-gp/"><h3>General Practitioner</h3><p class="event-location">Synthetic rural town</p></a></html>',{headers:{etag:'"people"'}});if(url.includes('jobs.nt.gov.au'))return new Response(ntBody());if(url.includes('external.jobs.uwa.edu.au'))return new Response(uwaHtml(),{headers:{etag:'"uwa"'}});if(url.includes('api.smartrecruiters.com'))return new Response(smartbody(),{headers:{etag:'"smart"'}});if(url.includes('bandi.unibo'))return new Response(rss(),{headers:{etag:'"rss"'}});return new Response(JSON.stringify([(/\/(513|841|737)\//.test(url))?pageup('2',{Title:'Research Fellow (Inflammation and Immunology)',Brand:'Faculty of Medicine'}):pageup()]),{headers:{etag:'"json"'}});};}

test('registry covers all Australian jurisdictions honestly and Italy only Amir',()=>{
 assert.deepEqual([...new Set(SOURCE_REGISTRY.filter(s=>s.country==='AU'&&s.state!=='UNKNOWN').map(s=>s.state))].sort(),['ACT','NSW','NT','QLD','SA','TAS','VIC','WA']);
 assert.equal(SOURCE_REGISTRY.filter(s=>s.executable).length,35);
 assert(SOURCE_REGISTRY.filter(s=>s.country==='IT').every(s=>s.profileScope==='amir'));
 assert(SOURCE_REGISTRY.filter(s=>!s.executable).every(s=>s.reason&&s.configurationStatus!=='executable'));
});
test('fixed feed and record host restrictions reject SSRF, credentials and redirection targets',async()=>{
 const s=source('tas-pageup-759');
 for(const value of ['http://careers.pageuppeople.com/759/cw/en/jobs.json','https://127.0.0.1/','https://careers.pageuppeople.com.evil.invalid/','https://user:pw@careers.pageuppeople.com/','https://careers.pageuppeople.com:8443/','https://careers.pageuppeople.com/#fragment'])assert.throws(()=>validateSourceUrl(value,s));
 await assert.rejects(()=>normalizeSourceRecords({id:'unregistered',feedUrl:'https://127.0.0.1'},'[]'));
 await assert.rejects(()=>normalizeSourceRecords(source('unibo-research-contracts'),rss('https://127.0.0.1/call')));
 await assert.rejects(()=>normalizeSourceRecords(source('unibo-research-contracts'),'<!DOCTYPE rss [<!ENTITY x SYSTEM "http://127.0.0.1">]>'+rss()));
});
test('PageUp filters preserve actual advertised dates and never infer eligibility',async()=>{
 const rows=await normalizeSourceRecords(source('tas-pageup-759'),JSON.stringify([pageup(),pageup('2',{Title:'Nurse Practitioner'}),pageup('3',{Title:'Medical Registrar',CategoryList:['Administration']})]));
 assert.equal(rows.length,1);assert.equal(rows[0].externalId,'1');assert.equal(rows[0].opportunityType,'job');assert.equal(rows[0].closingAt,'2100-01-01T00:00:00.000Z');assert.equal(rows[0].sponsorship,undefined);
 await assert.rejects(()=>normalizeSourceRecords(source('tas-pageup-759'),JSON.stringify([pageup(),pageup('4',{ClosingDateUtc:'tomorrow'})])));
 assert.equal((await normalizeSourceRecords(source('tas-pageup-759'),'[]')).length,0);
});
test('Bologna RSS imports unknown deadline and stable URL-hash identity',async()=>{
 const a=await normalizeSourceRecords(source('unibo-scholarship-funding'),rss());
 assert.equal(a.length,1);assert.equal(a[0].opportunityType,'scholarship');assert.equal(a[0].closingAt,null);assert.match(a[0].externalId,/^rss_[a-f0-9]{64}$/);
 const b=await normalizeSourceRecords(source('unibo-scholarship-funding'),rss());assert.equal(a[0].externalId,b[0].externalId);
});
test('bounded three-source rotation, storage scope, and conditional ETags work',async()=>{
 const {db,env}=fixture(),log=[];
 let receipt=await collectRegisteredSources(env,fetchFixture(log));assert.equal(log.length,3);assert.equal(receipt.sources.length,3);assert(receipt.imported<=100);
 assert(log.every(v=>v.options.redirect==='manual'&&v.options.signal));
 await collectRegisteredSources(env,fetchFixture(log));assert.equal(log.length,6,'next invocation visits next three sources');
 await collectRegisteredSources(env,fetchFixture(log));assert.equal(log.length,9,'third invocation visits remaining three sources');
 await collectRegisteredSources(env,fetchFixture(log));assert.equal(log.length,12,'fourth invocation reaches new rural sources');
 await collectRegisteredSources(env,fetchFixture(log));assert.equal(log.length,15,'fifth invocation reaches Italy call streams');
 await collectRegisteredSources(env,fetchFixture(log));assert.equal(log.length,18,'sixth invocation reaches remaining official sources');
 db.exec("UPDATE source_collector_state SET position=0");
 const it=JSON.parse(db.prepare("SELECT data FROM opportunity_editions WHERE country='IT' LIMIT 1").get().data);assert.equal(it.profileScope,'amir');assert.equal(it.status,'unknown');
 db.exec('UPDATE registered_source_checks SET next_check_at=0');
 const conditional=[];await collectRegisteredSources(env,async(url,options)=>{conditional.push(options);return new Response(null,{status:304});});
 assert(conditional.every(o=>o.headers['If-None-Match']));
 assert.equal(db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,15);
});
test('source errors preserve previous snapshot and use cooldown',async()=>{
 const {db,env}=fixture();await collectRegisteredSources(env,fetchFixture());const before=db.prepare('SELECT count(*) n FROM opportunity_editions').get().n;
 db.exec('UPDATE registered_source_checks SET next_check_at=0');
 const log=[];const receipt=await collectRegisteredSources(env,async(url,options)=>{log.push(options);return new Response('[]',{status:302,headers:{location:'https://127.0.0.1/'}});});
 assert.equal(receipt.status,'partial_failure');assert(receipt.sources.every(s=>s.error==='source_redirect_rejected'));assert.equal(db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,before);
 assert(db.prepare("SELECT next_check_at,last_attempt_at FROM registered_source_checks WHERE status='failed' LIMIT 1").get().next_check_at>Date.now());
});
test('malformed and oversized source bodies are rejected without replacing records',async()=>{
 for(const body of ['<html>Login</html>','{"items":[]}',JSON.stringify([pageup(),pageup('bad')])])await assert.rejects(()=>normalizeSourceRecords(source('tas-pageup-759'),body));
 await assert.rejects(()=>normalizeSourceRecords(source('tas-pageup-759'),' '.repeat(3000001)));
});
test('large valid feed imports bounded slices with continuation and no absence deletion',async()=>{
 const {db,env}=fixture();db.exec("UPDATE source_collector_state SET position=0");
 const rows=Array.from({length:120},(_,i)=>pageup(String(i+1)));
 const receipt=await collectRegisteredSources(env,async(url)=>url.includes('/759/')?new Response(JSON.stringify(rows),{headers:{etag:'"many"'}}):url.includes('/513/')?new Response('[]'):new Response('<rss><channel></channel></rss>'));
 assert.equal(receipt.sources[0].imported,40);assert.equal(receipt.sources[0].partial,true);assert.equal(receipt.sources[0].nextCursor,40);
 db.exec('UPDATE registered_source_checks SET next_check_at=0');db.exec('UPDATE source_collector_state SET position=0');
 const seen=[];await collectRegisteredSources(env,async(url,options)=>{if(url.includes('/759/')){seen.push(options);return new Response(JSON.stringify(rows));}return url.includes('/513/')?new Response('[]'):new Response('<rss><channel></channel></rss>');});
 assert.equal(seen[0].headers['If-None-Match'],undefined);assert.equal(db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,80);
});
test('sources route enforces workspace, excludes Italy for Arash, rejects client endpoints',async()=>{
 const {env}=fixture();
 const request=(path,options={})=>new Request('https://app.example'+path,options);
 let res=await handleRegisteredSourcesRequest(request('/api/opportunities/sources'),env,{userId:'one',profileId:'arash'});const data=await res.json();assert(data.sources.every(s=>s.country!=='IT'));
 assert((await registeredSourceStatuses(env,'amir')).some(s=>s.country==='IT'));
 assert.equal((await handleRegisteredSourcesRequest(request('/api/opportunities/sources'),env,{})).status,403);
 assert.equal((await handleRegisteredSourcesRequest(request('/api/opportunities/refresh',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}),env,{userId:'one',profileId:'arash'})).status,403);
 assert.equal((await handleRegisteredSourcesRequest(request('/api/opportunities/refresh',{method:'POST',body:JSON.stringify({url:'http://127.0.0.1'})}),env,{userId:'one',profileId:'amir'})).status,400);
});
test('Arash refresh totals and errors cover visible sources only',async()=>{
 const {db,env}=fixture();db.exec('UPDATE source_collector_state SET position=1');
 const response=await handleRegisteredSourcesRequest(new Request('https://app.example/api/opportunities/refresh',{method:'POST',body:'{}'}),env,{userId:'arash-owner',profileId:'arash'},async(url)=>url.includes('bandi.unibo')?new Response('blocked',{status:403}):new Response(JSON.stringify([pageup('2',{Title:'Research Fellow in Clinical Medicine',Brand:'Faculty of Medicine'})])));
 const receipt=await response.json();assert.equal(receipt.status,'completed');assert.equal(receipt.imported,1);assert.equal(receipt.sources.length,1);assert.equal(receipt.sources[0].sourceId,'monash-pageup-513');
});

test('registered collectors use a Workers-supported redirect mode and never follow an unregistered target',async()=>{
 const {env,db}=fixture(),log=[],base=fetchFixture(log);const result=await collectRegisteredSources(env,async(url,options)=>{if(options.redirect==='error')throw new TypeError('Unsupported Workers redirect mode');assert.equal(options.redirect,'manual');return base(url,options);});assert(result.imported>0);assert(log.length>0);
 const before=db.prepare('SELECT count(*) n FROM opportunity_editions').get().n;db.prepare('UPDATE registered_source_checks SET next_check_at=0').run();let calls=0;const redirected=await collectRegisteredSources(env,async(url,options)=>{if(options.redirect==='error')throw new TypeError('Unsupported Workers redirect mode');assert.equal(options.redirect,'manual');calls++;return new Response(null,{status:302,headers:{Location:'https://unregistered.invalid/feed'}});});assert(calls>0&&calls<=3);assert(redirected.sources.every(s=>s.error==='source_redirect_rejected'));assert.equal(db.prepare('SELECT count(*) n FROM opportunity_editions').get().n,before);
});


test('NSW university uses its own publisher domain and excludes research administration titles',async()=>{
 const rows=await normalizeSourceRecords(source('unsw-pageup-841'),JSON.stringify([pageup('81',{Title:'Research Fellow in Clinical Medicine',Brand:'Medicine & Health'}),pageup('82',{Title:'EA & Project Officer - Cancer Research Centre',Brand:'Medicine & Health'})]));assert.equal(rows.length,1);assert.equal(rows[0].organizationDomain,'unsw.edu.au');assert.equal(rows[0].organization,'UNSW Sydney');assert.equal(rows[0].opportunityType,'university');assert.match(rows[0].url,/\/841\//);
});
test('Griffith public academic feed keeps unknown deadlines, scholarship type and fixed record URLs',async()=>{
 const rows=await normalizeSourceRecords(source('griffith-smartrecruiters'),smartbody([smartrow(),smartrow('744000000000002',{name:'Executive Officer - Digital Health'}),smartrow('744000000000003',{name:'Research Fellow in Medicine',visibility:'PRIVATE'}),smartrow('744000000000004',{name:'Research Fellow in Medicine',location:{country:'nz',region:'NZ'}})]));assert.equal(rows.length,1);assert.equal(rows[0].opportunityType,'scholarship');assert.equal(rows[0].closingAt,null);assert.equal(rows[0].state,'QLD');assert.equal(rows[0].organizationDomain,'griffith.edu.au');assert.equal(rows[0].url,'https://jobs.smartrecruiters.com/GriffithUniversity/744000000000001');
});
test('Griffith rejects foreign company rows, malformed identities and incomplete upstream pages',async()=>{
 for(const rows of [[smartrow('bad')],[smartrow('744000000000001',{company:{identifier:'ForeignUniversity'}})]])await assert.rejects(()=>normalizeSourceRecords(source('griffith-smartrecruiters'),smartbody(rows)));
 const incomplete=JSON.parse(smartbody());incomplete.totalFound=101;await assert.rejects(()=>normalizeSourceRecords(source('griffith-smartrecruiters'),JSON.stringify(incomplete)),/source_pagination_required/);
});

test('SA Health filtered public medical feed preserves source channel and excludes support jobs',async()=>{
 const rows=[pageup('953123',{Title:'Clinical Pharmacology Registrar',CategoryList:['SA Health|Medical']}),pageup('953124',{Title:'Team Leader, Trainee Medical Officer Unit',CategoryList:['SA Health|Medical']}),pageup('953125',{Title:'Medical Practitioner (Pool)',CategoryList:['SA Health|Medical']})];
 const data=await normalizeSourceRecords(source('sa-health-pageup-532'),JSON.stringify(rows));assert.equal(data.length,2);assert.equal(data[0].url,'https://careers.pageuppeople.com/532/caw/en/job/953123');assert.equal(data[0].organizationDomain,'sahealth.sa.gov.au');assert.equal(data[1].kind,'employment_register');assert(source('sa-health-pageup-532').feedUrl.includes('category=Medical'));
});
test('Canberra public academic health pool stays a register with unknown deadline',async()=>{
 const rows=[pageup('500808',{Title:'Casual Academic Staff Talent Pool - Faculty of Health',Brand:'',CategoryList:['Academic|Health'],ClosingDateUtc:null}),pageup('504882',{Title:'Postdoctoral Fellow',Brand:'Faculty of Business, Government & Law'})];const data=await normalizeSourceRecords(source('canberra-pageup-737'),JSON.stringify(rows));assert.equal(data.length,1);assert.equal(data[0].kind,'employment_register');assert.equal(data[0].closingAt,null);assert.equal(data[0].organizationDomain,'canberra.edu.au');
});
test('UWA bounded public HTML cards keep unknown dates and stable URL-derived identities',async()=>{
 const one=await normalizeSourceRecords(source('uwa-public-search'),uwaHtml()),two=await normalizeSourceRecords(source('uwa-public-search'),uwaHtml());assert.equal(one.length,1);assert.equal(one[0].externalId,two[0].externalId);assert.equal(one[0].publishedAt,null);assert.equal(one[0].closingAt,null);assert.equal(one[0].organizationDomain,'uwa.edu.au');assert.equal(one[0].state,'WA');assert.equal(source('uwa-public-search').coverageLimit,'first_public_search_page_only');assert.equal((await normalizeSourceRecords(source('uwa-public-search'),uwaHtml(undefined,'Senior Lecturer Optometry'))).length,0);
});
test('UWA HTML adapter rejects foreign/hidden URL destinations, incomplete schema and untrusted source overrides',async()=>{
 for(const url of ['https://untrusted.invalid/jobs/medical','https://external.jobs.uwa.edu.au/api/medical','https://external.jobs.uwa.edu.au/jobs/search?query=medical'])await assert.rejects(()=>normalizeSourceRecords(source('uwa-public-search'),uwaHtml(url)));await assert.rejects(()=>normalizeSourceRecords(source('uwa-public-search'),'<html>Not a listing</html>'));await assert.rejects(()=>normalizeSourceRecords(source('uwa-public-search'),uwaHtml().replace('</html>','')));
});

test('NT public search preserves medical criteria and excludes cancelled/allied records',async()=>{
 const rows=[{rtfId:1,jobTitle:'Resident Medical Officer',agency:'Department of Health',dateAdded:'/Date(1793491200000)/',closingDateAsDateTime:null,RecruitmentProgramId:16,primaryObjective:'Clinical duties',specialInstructions:'Competent Authority only; standard pathway applicants excluded.'},{rtfId:2,jobTitle:'Consultant Psychiatrist',agency:'Department of Health',isCanceled:true},{rtfId:3,jobTitle:'Nurse Clinical Specialist',agency:'Department of Health'},{rtfId:4,jobTitle:'Medical Registrar',agency:'Other department'}];const result=await normalizeSourceRecords(source('nt-health-public-search'),ntBody(rows));assert.equal(result.length,1);assert.equal(result[0].kind,'employment_register');assert.equal(result[0].closingAt,null);assert(result[0].fullText.includes('standard pathway applicants excluded'));assert.equal(result[0].url,'https://jobs.nt.gov.au/Home/JobDetails?rtfId=1');await assert.rejects(()=>normalizeSourceRecords(source('nt-health-public-search'),ntBody([{rtfId:'forged',jobTitle:'Medical Registrar'}])));
});
test('NT search uses only fixed public POST filters with no browser credentials',async()=>{
 const {db,env}=fixture();db.exec("UPDATE source_collector_state SET position=9");const log=[];await collectRegisteredSources(env,fetchFixture(log));const request=log.find(x=>x.url==='https://jobs.nt.gov.au/Home/Search');assert(request);assert.equal(request.options.method,'POST');assert.deepEqual(JSON.parse(request.options.body),{SelectedAgencyList:['22'],SelectedCategoryList:['2085']});assert.equal(request.options.headers['Content-Type'],'application/json');assert.equal(request.options.headers.Cookie,undefined);assert.equal(request.options.headers.Authorization,undefined);assert.equal(request.options.redirect,'manual');
});

test('NT date-only closing display is preserved without inventing an exact cutoff',async()=>{const rows=[{rtfId:55,jobTitle:'Medical Registrar',agency:'Department of Health',dateAdded:'/Date(1793491200000)/',closingDate:'08/11/2026',closingDateAsDateTime:'/Date(1794061800000)/',RecruitmentProgramId:1}];const [row]=await normalizeSourceRecords(source('nt-health-public-search'),ntBody(rows));assert.equal(row.closingAt,null);assert(row.fullText.includes('08/11/2026'));assert(row.fullText.includes('exact cutoff/time zone not verified'));assert.equal(row.kind,'vacancy');});

test('page queue receives stable content version and requests fresh reading when the same source URL changes',async()=>{
 const {db,env}=fixture();db.exec(readFileSync(new URL('../cloud/public-page-schema.sql',import.meta.url),'utf8'));env.PUBLIC_PAGE_READING_ENABLED='true';
 await collectRegisteredSources(env,fetchFixture());
 const row=db.prepare("SELECT * FROM public_page_queue WHERE json_extract(data,'$.sourceId')='tas-pageup-759'").get();assert(row);const firstVersion=JSON.parse(row.data).discoveryVersion;assert.match(firstVersion,/^[a-f0-9]{64}$/);
 const due=Date.now()+86400000;db.prepare("UPDATE public_page_queue SET status='read',available_at=?,read_at=? WHERE id=?").run(due,new Date().toISOString(),row.id);
 const reset=()=>db.exec('UPDATE source_collector_state SET position=0; UPDATE registered_source_checks SET next_check_at=0;');reset();await collectRegisteredSources(env,fetchFixture());
 assert.equal(db.prepare('SELECT available_at FROM public_page_queue WHERE id=?').get(row.id).available_at,due,'identical poll retains schedule');
 reset();const original=fetchFixture();await collectRegisteredSources(env,async(url,options)=>url.includes('/759/')?new Response(JSON.stringify([pageup('1',{Title:'Medical Registrar - Rural Medicine'})])):original(url,options));
 const changed=db.prepare('SELECT * FROM public_page_queue WHERE id=?').get(row.id);assert.equal(changed.status,'read');assert.equal(changed.available_at,0);assert.notEqual(JSON.parse(changed.data).discoveryVersion,firstVersion);assert.equal(JSON.parse(changed.data).refreshRequested,true);
});
test('collector always registers accepted public records even while page processing is disabled',async()=>{
 const {db,env}=fixture();db.exec(readFileSync(new URL('../cloud/public-page-schema.sql',import.meta.url),'utf8'));env.PUBLIC_PAGE_READING_ENABLED='false';const log=[];
 const result=await collectRegisteredSources(env,fetchFixture(log));assert.equal(log.length,3,'the collector fetches feeds only, never the queued record pages');
 assert(result.sources.filter(s=>s.imported>0).every(s=>s.readingQueue==='queued'));assert.equal(db.prepare('SELECT count(*) n FROM public_page_queue').get().n,db.prepare('SELECT count(DISTINCT url) n FROM opportunity_editions').get().n);assert.equal(db.prepare("SELECT count(*) n FROM public_page_queue WHERE status<>'pending'").get().n,0);
});
