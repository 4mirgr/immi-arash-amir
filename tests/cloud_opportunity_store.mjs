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


function readingFixture(){const f=fixture();f.db.exec(readFileSync(new URL('../cloud/public-page-schema.sql',import.meta.url),'utf8'));f.db.exec(readFileSync(new URL('../cloud/public-page-enrichment-schema.sql',import.meta.url),'utf8'));f.env.PUBLIC_PAGE_READING_ENABLED='true';return f;}
function seedReading(f,{url='https://jobs.example.invalid/123',country='AU',scope='both',at=new Date(time+5000).toISOString(),status='read',text='Visa sponsorship is available. Clinical supervision is provided for the successful applicant. Applicants must review the complete position description.',analysis=JSON.stringify({summary:'Exact reviewed public description.',category:'career'}),evidenceAt=at,contentAt=at,contentStatus=status}={}){f.db.prepare('INSERT INTO public_page_queue(id,url,country,profile_scope,data,status,read_at) VALUES(?,?,?,?,?,?,?)').run('page-a',url,country,scope,'{}',status,at);f.db.prepare('INSERT INTO public_page_content(page_id,read_at,status,title,content_type,text,limitations) VALUES(?,?,?,?,?,?,?)').run('page-a',contentAt,contentStatus,'Synthetic read page','text/html',text,'[]');for(const profile of ['amir','arash'])f.db.prepare('INSERT INTO public_page_evidence(page_id,profile_id,category,sections,analysis,read_at) VALUES(?,?,?,?,?,?)').run('page-a',profile,'career','[]',analysis,evidenceAt);}
test('actual read content enriches screening without changing stored edition evidence or eligibility',async()=>{const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({title:'General Practitioner',fullText:'Original publisher overview.'})],time);seedReading(f);const result=(await(await get(f.env,'/api/opportunities', {userId:'arash-owner',profileId:'arash'})).json()).opportunities[0];assert.match(result.fullText,/Visa sponsorship is available/);assert.equal(result.screening.fields.sponsorship.status,'supported');assert.equal(result.screening.fields.supervision.status,'supported');assert.equal(result.reading.status,'read');assert.equal(result.reading.summary,'Exact reviewed public description.');assert.equal(result.reading.eligibility,'not_assessed');assert.equal(JSON.parse(f.db.prepare('SELECT data FROM opportunity_editions').get().data).fullText,'Original publisher overview.');});
test('a read before a new publication enriches only the earlier edition, including organization history',async()=>{const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({title:'First advertised role',fullText:'First listing text.'})],time);await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({title:'Second advertised role',fullText:'Second listing text.'})],time+10000);seedReading(f);const list=(await(await get(f.env,'/api/opportunities?includeClosed=true')).json()).opportunities;const first=list.find(x=>x.title==='First advertised role'),second=list.find(x=>x.title==='Second advertised role');assert.equal(first.reading.status,'read');assert.equal(second.reading.status,'before_current_edition');assert.equal(second.fullText,'Second listing text.');const history=(await(await get(f.env,'/api/opportunities/organizations/'+first.organizationId)).json()).opportunities;assert.equal(history.find(x=>x.title==='Second advertised role').reading.status,'before_current_edition');});
test('current URL content cannot overwrite historical editions after a successor publication',async()=>{for(const simultaneous of [false,true]){const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({title:'Historical role',fullText:'Historical source evidence.'})],time);await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({title:'Current role',fullText:'Current source evidence.'})],time+(simultaneous?0:10000));seedReading(f,{at:new Date(time+20000).toISOString()});const list=(await(await get(f.env,'/api/opportunities?includeClosed=true')).json()).opportunities;const old=list.find(x=>x.title==='Historical role'),current=list.find(x=>x.title==='Current role');assert.equal(old.fullText,'Historical source evidence.');assert.equal(old.reading.status,'after_current_edition');assert.equal(current.reading.status,'read');assert.match(current.fullText,/Visa sponsorship is available/);}});
test('invalid timestamps, mismatched receipts and stale analysis fail closed without breaking a valid listing',async()=>{for(const change of [{at:'invalid'},{at:'2099-01-01T00:00:00Z'},{contentAt:new Date(time+6000).toISOString()},{contentStatus:'pending'}]){const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({fullText:'Original evidence.'})],time);seedReading(f,change);const response=await get(f.env);assert.equal(response.status,200);const row=(await response.json()).opportunities[0];assert.equal(row.fullText,'Original evidence.');assert(['invalid_reading_timestamp','content_receipt_mismatch'].includes(row.reading.status));}for(const change of [{analysis:'not json'},{evidenceAt:new Date(time-1000).toISOString()}]){const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record()],time);seedReading(f,change);const row=(await(await get(f.env)).json()).opportunities[0];assert.equal(row.reading.status,'read');assert.equal(row.reading.summary,'');assert.match(row.fullText,/Visa sponsorship/);}});
test('partial readings retain partial and display truncation flags, and owner scope does not borrow Amir-only content',async()=>{const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({fullText:'Original evidence.'})],time);seedReading(f,{scope:'amir',status:'read_partial',text:'Public read evidence. '.repeat(1000)});const amir=(await(await get(f.env)).json()).opportunities[0];assert.equal(amir.reading.partialReading,true);assert.equal(amir.reading.textTruncatedForDisplay,true);assert.equal(amir.fullText.length,20000);const arash=(await(await get(f.env,'/api/opportunities',{userId:'arash-owner',profileId:'arash'})).json()).opportunities[0];assert.equal(arash.reading,undefined);assert.equal(arash.fullText,'Original evidence.');});

function seedEnrichment(f,overrides={}){const at=new Date(time+5000).toISOString(),url='https://jobs.example.invalid/123';const data={sourceURL:url,readAt:at,contacts:[{type:'email',value:'apply@example.invalid',sourceURL:url,quote:'Please email apply@example.invalid',method:'visible_text',contactRole:'application'}],organizations:[{name:'Source clinic identity',sourceURL:url,quote:'Employer: Source clinic identity',method:'jsonld_jobposting'}],...overrides};f.db.prepare('INSERT INTO public_page_enrichment(page_id,read_at,country,data) VALUES(?,?,?,?)').run('page-a',at,'AU',JSON.stringify(data));}
test('direct evidence preserves original publisher, real redirect provenance and exact AI quotes',async()=>{const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record()],time);seedReading(f);const sourceURL='https://jobs.example.invalid/actual-final';const quote='Visa sponsorship is available.';seedEnrichment(f,{sourceURL,contacts:[{type:'email',value:'apply@example.invalid',sourceURL,quote:'Email apply@example.invalid',method:'visible_text',contactRole:'application'}],ai:{model:'@cf/meta/llama-3.1-8b-instruct-fp8',readAt:new Date(time+5000).toISOString(),selectedAt:new Date(time+6000).toISOString(),quotes:[quote],meaning:'machine_selected_verbatim_quotes_requires_review'}});const row=(await(await get(f.env)).json()).opportunities[0];assert.equal(row.organization,'Example Hospital');assert.equal(row.enrichment.sourceURL,sourceURL);assert.equal(row.contactEvidence[0].sourceURL,sourceURL);assert.equal(row.contactEvidence[0].sourceRelation,'same_page');assert.deepEqual(row.enrichment.ai.quotes,[quote]);});
test('mismatched country, profile, URL and receipt cannot create contact evidence',async()=>{for(const overrides of [{country:'IT'},{profileId:'arash'},{sourceURL:'https://foreign.example.invalid/a'},{readAt:'2020-01-01T00:00:00Z'}]){const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record()],time);seedReading(f);seedEnrichment(f,overrides);const row=(await(await get(f.env)).json()).opportunities[0];assert.equal(row.enrichment,undefined);assert.equal(row.reading.status,'read');}});
test('invented AI quotation is dropped while valid public contact remains',async()=>{const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record()],time);seedReading(f);seedEnrichment(f,{ai:{model:'@cf/meta/llama-3.1-8b-instruct-fp8',readAt:new Date(time+5000).toISOString(),selectedAt:new Date(time+6000).toISOString(),quotes:['This person is definitely eligible for registration.'],meaning:'machine_selected_verbatim_quotes_requires_review'}});const row=(await(await get(f.env)).json()).opportunities[0];assert.equal(row.enrichment.ai,undefined);assert.equal(row.contactEvidence.length,1);});
test('linked child contacts retain actual source and do not cross publication editions',async()=>{const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record()],time);seedReading(f);seedEnrichment(f);const at=new Date(time+6000).toISOString(),url='https://jobs.example.invalid/contact';f.db.prepare('INSERT INTO public_page_queue(id,url,country,profile_scope,data,status,read_at) VALUES(?,?,?,?,?,?,?)').run('page-child',url,'AU','both','{}','read',at);f.db.prepare('INSERT INTO public_page_content(page_id,read_at,status,title,content_type,text,limitations) VALUES(?,?,?,?,?,?,?)').run('page-child',at,'read','Contact','text/html','General inquiries: hello@example.invalid','[]');f.db.prepare('INSERT INTO public_page_enrichment VALUES(?,?,?,?)').run('page-child',at,'AU',JSON.stringify({sourceURL:url,readAt:at,parentPageId:'page-a',parentURL:'https://jobs.example.invalid/123',depth:1,contacts:[{type:'email',value:'hello@example.invalid',sourceURL:url,quote:'General inquiries: hello@example.invalid',method:'visible_text',contactRole:'organization_general'}]}));let row=(await(await get(f.env)).json()).opportunities[0];assert.equal(row.contactEvidence.length,2);assert.equal(row.contactEvidence[1].sourceRelation,'linked_page');assert.equal(row.contactEvidence[1].sourceURL,url);await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({title:'New edition'})],time+5500);row=(await(await get(f.env,'/api/opportunities?includeClosed=true')).json()).opportunities.find(x=>x.title!=='New edition');assert.equal(row.contactEvidence.length,1);});
test('authenticated profile read is once per list, private and cannot alter source priority',async()=>{const f=fixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({title:'General Practitioner'})],time);let calls=0;const context={...owner,async rest(table,query){calls++;assert.equal(table,'immi_profiles');assert.equal(query,'?select=data&profile_id=eq.amir');return [{data:{id:'amir',cvText:'PRIVATE_CV AMC MCQ passed. IELTS.'}}];}};const data=await(await get(f.env,'/api/opportunities?sort=fit',context)).json();assert.equal(calls,1);assert.equal(data.rankingScope,'current_page_evidence_priority');assert.equal(data.opportunities[0].fit.profileReadiness.amcMcq,'self_reported_pass');assert.equal(data.opportunities[0].fit.priority,'clarification');assert(!JSON.stringify(data).includes('PRIVATE_CV'));const foreign=await(await get(f.env,'/api/opportunities',{...owner,rest:async()=>[{data:{id:'arash',cvText:'PRIVATE_CV AMC MCQ passed.'}}]})).json();assert.equal(foreign.opportunities[0].fit.profileReadiness.hasCV,false);});

test('automatic contact discovery distinguishes unqueued, queued and actually extracted named contacts',async()=>{
 const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({title:'General Practitioner'})],time);
 let item=(await(await get(f.env)).json()).opportunities[0];assert.equal(item.contactDiscovery.status,'not_queued');assert.equal(item.contactDiscovery.pendingPages,0);
 const at=new Date().toISOString(),url='https://jobs.example.invalid/123';seedReading(f,{at,text:'General practice. Practice Manager: Jane Smith. Apply via apply@example.invalid'});
 const person={name:'Jane Smith',role:'practice_manager',sourceURL:url,quote:'Practice Manager: Jane Smith',method:'visible_role_label',sourceRelation:'same_page'};
 seedEnrichment(f,{readAt:at,people:[person]});f.db.prepare('UPDATE public_page_enrichment SET read_at=?').run(at);
 item=(await(await get(f.env)).json()).opportunities[0];assert.equal(item.contactDiscovery.status,'found');assert.equal(item.contactDiscovery.peopleFound,1);assert.equal(item.namedContactEvidence[0].name,'Jane Smith');assert.equal(item.namedContactEvidence[0].readAt,at);
 f.db.prepare("UPDATE public_page_queue SET data=json_set(data,'$.refreshRequested',json('true'))").run();
 item=(await(await get(f.env)).json()).opportunities[0];assert.equal(item.contactDiscovery.status,'queued');assert.equal(item.contactDiscovery.pendingPages,1);
 f.db.prepare("UPDATE public_page_enrichment SET read_at='2000-01-01T00:00:00Z'").run();
 item=(await(await get(f.env)).json()).opportunities[0];assert.equal(item.namedContactEvidence,undefined);assert.equal(item.contactDiscovery.peopleFound,0);
});

test('linked named contacts retain source, current edition boundary and same-clinic-page receipts',async()=>{
 const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record()],time);const parentAt=new Date(time+5000).toISOString();seedReading(f,{at:parentAt});seedEnrichment(f);
 const at=new Date(time+6000).toISOString(),url='https://jobs.example.invalid/team';
 f.db.prepare('INSERT INTO public_page_queue(id,url,country,profile_scope,data,status,read_at) VALUES(?,?,?,?,?,?,?)').run('page-manager',url,'AU','both',JSON.stringify({parentPageId:'page-a'}),'read',at);
 f.db.prepare('INSERT INTO public_page_content(page_id,read_at,status,title,content_type,text,limitations) VALUES(?,?,?,?,?,?,?)').run('page-manager',at,'read','Team','text/html','Practice Manager: Jane Smith','[]');
 f.db.prepare('INSERT INTO public_page_enrichment VALUES(?,?,?,?)').run('page-manager',at,'AU',JSON.stringify({sourceURL:url,readAt:at,parentPageId:'page-a',parentURL:'https://jobs.example.invalid/123',depth:1,contacts:[],people:[{name:'Jane Smith',role:'practice_manager',sourceURL:url,quote:'Practice Manager: Jane Smith',method:'visible_role_label',sourceRelation:'same_page'}]}));
 let item=(await(await get(f.env)).json()).opportunities[0];assert.equal(item.namedContactEvidence[0].name,'Jane Smith');assert.equal(item.namedContactEvidence[0].sourceRelation,'linked_page');assert.equal(item.namedContactEvidence[0].sourceURL,url);
 await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record({title:'New edition'})],time+5500);
 item=(await(await get(f.env,'/api/opportunities?includeClosed=true')).json()).opportunities.find(x=>x.title!=='New edition');assert.equal(item.namedContactEvidence.length,0);
 f.db.prepare("UPDATE public_page_content SET read_at='2000-01-01T00:00:00Z' WHERE page_id='page-manager'").run();
 item=(await(await get(f.env,'/api/opportunities?includeClosed=true')).json()).opportunities.find(x=>x.title==='New edition');assert.equal(item.namedContactEvidence,undefined);
});


test('decoded public display email keeps receipt and source constraints in opportunity contact evidence',async()=>{
 const f=readingFixture();await upsertOpportunityBatch(f.env.OPPORTUNITY_DB,source,[record()],time);seedReading(f);const url='https://jobs.example.invalid/123';
 seedEnrichment(f,{contacts:[{type:'email',value:'decoded@example.invalid',sourceURL:url,quote:'Email the practice manager',method:'visible_cfemail',contactRole:'application',sourceRelation:'same_page'}]});
 let item=(await(await get(f.env)).json()).opportunities[0];assert.equal(item.contactEvidence[0].value,'decoded@example.invalid');assert.equal(item.contactEvidence[0].method,'visible_cfemail');assert.equal(item.contactEvidence[0].sourceURL,url);
 f.db.prepare("UPDATE public_page_enrichment SET read_at='2000-01-01T00:00:00Z'").run();item=(await(await get(f.env)).json()).opportunities[0];assert.equal(item.contactEvidence,undefined);
});
