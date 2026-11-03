import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleLinkedInRequest,linkedinRecommendations,linkedInUrl} from '../cloud/linkedin-workspace.mjs';
const origin='https://immi.example';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../cloud/linkedin-schema.sql',import.meta.url),'utf8'));
 const env={GOOGLE_DB:{prepare(sql){return {bind(...values){const p=db.prepare(sql);return {async first(){return p.get(...values)||null;},async all(){return {results:p.all(...values)};},async run(){return {meta:p.run(...values)};}};}}}}};
 const context=profileId=>({userId:profileId+'-owner',profileId,rest:async()=>[{data:{id:profileId,linkedinUrl:'https://www.linkedin.com/in/synthetic-'+profileId+'/',planning:profileId==='amir'?{training:{currentStatus:'internal_medicine_resident'}}:{}}}]});
 const call=async(path,body,profile='arash',headers={})=>handleLinkedInRequest(new Request(origin+'/api/linkedin/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,context(profile),()=>{throw Error('This planning workspace must never contact LinkedIn');});
 return {db,env,context,call};
}
test('workspace is honest about absent platform connections and personalizes without fabricated achievements',async()=>{
 const {call}=fixture();const data=await(await call('workspace',undefined,'amir')).json();
 assert.equal(data.profileUrl,'https://www.linkedin.com/in/synthetic-amir/');assert.equal(data.capabilities.liveAnalytics,false);assert.equal(data.capabilities.automaticPublishing,false);assert.equal(data.capabilities.directProfileEdit,false);assert.equal(data.capabilities.connectionsSync,false);assert.deepEqual(data.metrics,[]);assert.equal(data.metricsSummary.asOf,null);assert.equal(data.analysis.providerDataFetched,false);assert.equal(data.postSuggestions.length,1);assert(data.recommendations[0].text.includes('Resident'));assert(!data.recommendations[0].text.includes('Board-certified'));
 const normal=linkedinRecommendations({cvText:'An old document vaguely mentions AMC and RACGP'});assert(!normal[0].text.includes('passed'));assert(normal.every(x=>x.requiresReview));
});
test('private sections and immutable draft revisions never leak across doctors',async()=>{
 const {call}=fixture();assert.equal((await call('sections',{section:'about',currentText:'<script>inert text</script>'})).status,200);
 const a=await(await call('drafts',{kind:'about',name:'Version',text:'First'})).json();const b=await(await call('drafts',{kind:'about',name:'Version',text:'Second'})).json();assert.equal(a.revision,1);assert.equal(b.revision,2);
 const own=await(await call('workspace')).json();assert.equal(own.sections[0].currentText,'<script>inert text</script>');assert.equal(own.drafts.length,2);assert.equal(own.analysis.sectionCoverage.provided,1);
 const other=await(await call('workspace',undefined,'amir')).json();assert.deepEqual(other.sections,[]);assert.deepEqual(other.drafts,[]);
});
test('scheduling is only manual-publication planning; a self-report never becomes provider evidence',async()=>{
 const {call}=fixture();const scheduledFor=new Date(Date.now()+86400000).toISOString();
 const created=await(await call('posts',{title:'Review',text:'Original discussion',scheduledFor,timezone:'Asia/Tehran'})).json();assert.equal(created.status,'scheduled_for_manual_publication');assert.equal(created.automaticPublishing,false);
 assert.equal((await call('posts/'+created.id+'/published',{},'amir')).status,404);
 const marked=await(await call('posts/'+created.id+'/published',{publishedUrl:'https://www.linkedin.com/feed/update/urn:li:activity:123456789/'})).json();assert.equal(marked.status,'published_by_user');assert.equal(marked.publicationEvidence,'user_reported_not_provider_verified');
 assert.equal((await call('posts/'+created.id+'/schedule',{scheduledFor,timezone:'Asia/Tehran'})).status,404);
});
test('date and payload limits fail before writes, and owners cannot be forged',async()=>{
 const {call,db}=fixture();const cases=[['posts',{title:'x',text:'x',scheduledFor:'2026-02-30T12:00:00Z',timezone:'Asia/Tehran'}],['posts',{title:'x',text:'x',scheduledFor:new Date(Date.now()+100000).toISOString()}],['posts',{title:'x',text:'x',scheduledFor:new Date(Date.now()+100000).toISOString(),timezone:'Not/AZone'}],['sections',{section:'about',currentText:'x',owner_id:'amir-owner'}],['drafts',{kind:'other',name:'x',text:'x'}],['metrics',{followers:1.5,asOf:new Date().toISOString()}]];
 for(const [route,body]of cases)assert.equal((await call(route,body)).status,400);
 assert.equal(db.prepare('select count(*)as n from linkedin_posts').get().n,0);
});
test('manual metrics retain missing values and calculate only measured deltas',async()=>{
 const {call}=fixture();const yesterday=new Date(Date.now()-86400000).toISOString(),today=new Date().toISOString();
 await call('metrics',{connections:10,profileViews:3,asOf:yesterday});await call('metrics',{connections:13,profileViews:5,asOf:today});
 const data=await(await call('workspace')).json();assert.equal(data.metrics[0].source,'manual');assert.equal('followers'in data.metrics[0],false);assert.deepEqual(data.metricsSummary.deltas,{connections:3,profileViews:2});assert.deepEqual((await(await call('metrics',undefined,'amir')).json()).metrics,[]);
 assert.equal((await call('metrics',{asOf:today})).status,400);assert.equal((await call('metrics',{connections:5,asOf:new Date(Date.now()+86400000).toISOString()})).status,400);
});
test('networking contacts remain private, unverified and user-controlled',async()=>{
 const {call}=fixture();const contact=await(await call('contacts',{name:'Synthetic supervisor',profileUrl:'https://www.linkedin.com/in/example-supervisor/',purpose:'supervision',status:'to_research'})).json();assert.equal(contact.connectionVerified,false);
 assert.equal((await call('contacts/'+contact.id,{status:'contacted'},'amir')).status,404);const updated=await(await call('contacts/'+contact.id,{status:'follow_up',notes:'Check public university role'})).json();assert.equal(updated.status,'follow_up');assert.equal(updated.connectionVerified,false);
 assert.deepEqual((await(await call('contacts',undefined,'amir')).json()).contacts,[]);assert.equal((await call('contacts',{name:'Bad',profileUrl:'javascript:alert(1)'})).status,400);
});
test('unknown routes and invalid contexts/origins do not touch provider or other profiles',async()=>{
 const {call,env,context}=fixture();assert.equal(await handleLinkedInRequest(new Request(origin+'/api/unrelated'),{},null),null);
 assert.equal((await call('sections',{section:'headline',currentText:'x'},'arash',{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await call('workspace?profile=amir')).status,403);
 assert.equal((await handleLinkedInRequest(new Request(origin+'/api/linkedin/workspace'),env,{...context('arash'),profileId:'admin'})).status,403);
});
test('safe external URLs require LinkedIn HTTPS without tracking or credentials',()=>{
 for(const url of ['https://linkedin.com.evil.example/in/x','http://www.linkedin.com/in/x','https://user:pass@www.linkedin.com/in/x','https://www.linkedin.com/in/x?tracking=1'])assert.throws(()=>linkedInUrl(url));
 assert.equal(linkedInUrl('https://linkedin.com/in/safe/'),'https://www.linkedin.com/in/safe/');
});

test('Connections CSV handles BOM, introductory notes, escaped commas/newlines and excludes email addresses',async()=>{
 const {call,db}=fixture();
 const csv='\uFEFFNotes:\r\nExport your Connections data privately\r\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\r\n"Ada, A.",Example,https://www.linkedin.com/in/ada/,private@example.invalid,"Clinic, North","Senior\nDoctor",01 Nov 2026\r\n"HTML <script>",Example,https://www.linkedin.com/in/html/,hidden@example.invalid,Hospital,Doctor,02 Nov 2026\r\n';
 const response=await call('contacts/import',{csv});assert.equal(response.status,201);const summary=await response.json();assert.equal(summary.imported,2);assert.equal(summary.totalRows,2);assert.equal(summary.emailsImported,false);assert.equal(summary.liveSync,false);
 const result=await(await call('contacts')).json();assert.equal(result.contacts[0].source,'linkedin_connections_csv');assert(result.contacts.some(x=>x.name==='Ada, A. Example'&&x.organization==='Clinic, North'&&x.role==='Senior\nDoctor'));
 const stored=JSON.stringify(db.prepare('select data from linkedin_contacts').all());assert(!stored.includes('private@example.invalid'));assert(!stored.includes('hidden@example.invalid'));assert(result.contacts.some(x=>x.name.includes('<script>')));assert(result.contacts.every(x=>x.connectionVerified===false));
});
test('CSV imports deduplicate within and between imports while preserving existing follow-up notes',async()=>{
 const {call}=fixture();const prior=await(await call('contacts',{name:'Keep original',profileUrl:'https://www.linkedin.com/in/ada/',status:'follow_up',notes:'Preserve this note'})).json();
 const csv='First Name,Last Name,URL,Company,Position\nAda,Updated,https://linkedin.com/in/ada,Other,Doctor\nBen,Example,https://www.linkedin.com/in/ben/,Hospital,Registrar\nBen,Duplicate,https://linkedin.com/in/ben,Hospital,Registrar';
 const first=await(await call('contacts/import',{csv})).json();assert.equal(first.imported,1);assert.equal(first.duplicates,2);assert.equal(first.reasons.duplicate_in_file,1);assert.equal(first.reasons.existing_contact,1);
 const repeated=await(await call('contacts/import',{csv})).json();assert.equal(repeated.imported,0);assert.equal(repeated.duplicates,3);
 const own=await(await call('contacts')).json();const original=own.contacts.find(x=>x.id===prior.id);assert.equal(original.notes,'Preserve this note');assert.equal(original.status,'follow_up');assert.equal(original.name,'Keep original');
 const other=await(await call('contacts/import',{csv},'amir')).json();assert.equal(other.imported,2);assert.equal(other.duplicates,1);
});
test('CSV malformed headers, quotes, row limits, owner injection and unsafe URLs are rejected or reported safely',async()=>{
 const {call}=fixture();
 for(const csv of ['Name,Company\nA,B','First Name,Last Name,URL\n"unterminated,Example,https://linkedin.com/in/a','First Name,Last Name,URL\n'+Array(1001).fill('A,B,https://www.linkedin.com/in/a').join('\n')])assert.equal((await call('contacts/import',{csv})).status,400);
 assert.equal((await call('contacts/import',{csv:'First Name,Last Name,URL\nA,B,https://linkedin.com/in/a',owner_id:'other'})).status,400);
 const bad=await(await call('contacts/import',{csv:'First Name,Last Name,URL\nA,B,javascript:alert(1)\n,,https://www.linkedin.com/in/missing/\nA,B,https://www.linkedin.com.evil.example/in/a'})).json();assert.equal(bad.imported,0);assert.equal(bad.skipped,3);assert.equal(bad.reasons.invalid_profile_url,2);assert.equal(bad.reasons.missing_name,1);
});

test('imported contacts beyond the workspace preview remain searchable and paginated within owner',async()=>{
 const {call}=fixture();await call('contacts/import',{csv:'First Name,Last Name,URL,Company,Position\nAda,A,https://linkedin.com/in/alpha,Clinic,Doctor\nBen,B,https://linkedin.com/in/beta,University,Professor\nCai,C,https://linkedin.com/in/gamma,Hospital,Registrar'});
 const first=await(await call('contacts?limit=1&offset=0')).json();const second=await(await call('contacts?limit=1&offset=1')).json();assert.equal(first.total,3);assert.equal(second.total,3);assert.notEqual(first.contacts[0].id,second.contacts[0].id);
 const search=await(await call('contacts?q=professor')).json();assert.equal(search.total,1);assert.equal(search.contacts[0].organization,'University');
 const other=await(await call('contacts?q=professor',undefined,'amir')).json();assert.equal(other.total,0);assert.equal((await call('contacts?limit=9999')).status,400);
});

for(const state of ['published','sending','delivery_unknown','unexpected'])test('provider '+state+' evidence suppresses manual duplicate tasks and state changes',async()=>{
 const {call,db}=fixture();db.exec(readFileSync(new URL('../cloud/linkedin-oauth-schema.sql',import.meta.url),'utf8'));
 const when=new Date(Date.now()+86400000).toISOString();const post=await(await call('posts',{title:'Do not duplicate',text:'Synthetic',scheduledFor:when,timezone:'Asia/Tehran'})).json();
 db.prepare('INSERT INTO linkedin_publish_attempts(id,owner_id,post_id,author_sub,content_hash,status,created_at,created_day,provider_urn) VALUES(?,?,?,?,?,?,?,?,?)').run('attempt-'+state,'arash-owner',post.id,'original-author','hash',state,new Date().toISOString(),'2026-11-03',state==='published'?'urn:li:share:123':null);
 const data=await(await call('workspace')).json();const shown=data.posts.find(x=>x.id===post.id);assert.equal(shown.manualActionsBlocked,true);assert.equal(shown.providerPublication.authorSubject,'original-author');assert.equal(shown.providerPublication.status,state==='unexpected'?'unknown':state);assert.equal(shown.providerPublication.source,state==='published'?'linkedin_api_acknowledgment':'linkedin_transport_attempt');assert(!data.tasks.some(x=>x.type==='manual_publication'&&x.id===post.id));
 assert.equal((await call('posts/'+post.id+'/published',{})).status,409);assert.equal((await call('posts/'+post.id+'/schedule',{scheduledFor:when,timezone:'Asia/Tehran'})).status,409);
 assert.equal((await(await call('workspace',undefined,'amir')).json()).posts.length,0);
});
test('failed transport is not fabricated publication and foreign attempts cannot affect own workflow',async()=>{
 const {call,db}=fixture();db.exec(readFileSync(new URL('../cloud/linkedin-oauth-schema.sql',import.meta.url),'utf8'));
 const when=new Date(Date.now()+86400000).toISOString();const post=await(await call('posts',{title:'Manual fallback',text:'Synthetic',scheduledFor:when,timezone:'Asia/Tehran'})).json();
 const insert=db.prepare('INSERT INTO linkedin_publish_attempts(id,owner_id,post_id,author_sub,content_hash,status,created_at,created_day) VALUES(?,?,?,?,?,?,?,?)');
 insert.run('foreign','amir-owner',post.id,'other-author','hash','published',new Date().toISOString(),'2026-11-03');
 let data=await(await call('workspace')).json();assert.equal(data.posts[0].providerPublication,null);assert.equal(data.posts[0].manualActionsBlocked,false);assert(data.tasks.some(x=>x.id===post.id));
 insert.run('failed','arash-owner',post.id,'own-author','hash','failed',new Date().toISOString(),'2026-11-03');
 data=await(await call('workspace')).json();assert.equal(data.posts[0].providerPublication.status,'failed');assert.equal(data.posts[0].providerPublication.providerUrn,null);assert.equal(data.posts[0].manualActionsBlocked,false);
 assert.equal((await call('posts/'+post.id+'/published',{})).status,200);
});
