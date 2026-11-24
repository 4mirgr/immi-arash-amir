import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {normalizeMessage} from '../cloud/google-mail.mjs';
import {applyOwnedMailClinicBankProof} from '../cloud/mail-clinic-bank-proof.mjs';
import {assessMailOutreachEvidence,assessMailPublicEmployerEvidence,verifiedMailApplicationURL,mailInitialEnquiryKey} from '../cloud/mail-lead-discovery.mjs';
import {prepareMailOpportunityDraft,prepareOwnedMailOpportunity,getOwnedMailOpportunityContext,ingestMailOpportunities,handleMailOpportunitiesRequest} from '../cloud/mail-opportunities.mjs';
import {readClinicSourceRestrictions} from '../cloud/clinic-source-restrictions.mjs';
import {mailOpportunityEditContextHash} from '../cloud/mail-opportunity-edits.mjs';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',cv='33333333-3333-4333-8333-333333333333',now=Date.now(),at=new Date(now-60000).toISOString(),site='https://harbour.example.org/',name='Harbour Medical Centre';
const context={userId:owner,rootUserId:owner,profileId:'arash',mailbox:'primary'},identity={subject:'sub1',email:'candidate@example.org'};
const writing={profile:{name:'Synthetic Applicant',planning:{gpApplicationWriting:{confirmedByOwner:true,writingVersion:'human-four-paragraph-v1',openingParagraph:'I am a general practitioner seeking a long-term supervised GP role in Australia.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',signatureEmail:'candidate@example.org',signaturePhone:'+61000000000',clinicalStrengths:['I value teamwork and continuing professional development.']}}},cvText:'Managed acute presentations and chronic disease consultations in general practice.',cvVersionId:cv};
const raw=(id,date=now-1000)=>({id,threadId:'thread_'+id,internalDate:String(date),labelIds:['INBOX'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'jobs-noreply@linkedin.com'},{name:'Subject',value:'General Practitioner jobs in Australia'}],body:{data:Buffer.from('General Practitioner — Harbour Medical Centre, Australia. Job opportunity.').toString('base64url')}}});
const message=(id,date)=>({...normalizeMessage(raw(id,date)),links:[{url:site+'jobs/gp',label:'General Practitioner — '+name}]});
const bank=(changes={})=>({id:'bank_test',owner_id:owner,profile_id:'arash',name,url:site,status:'public_contacts_found',last_success_at:at,read_at:at,result:{sourceStatus:'read',sourceURL:site,title:name+' | Home',clinicalText:name+' provides community general practice care for local patients.',clinicalSourceURL:site,clinicalReadAt:at,contactsReadAt:at,lastAttempt:{status:'read',sourceURL:site,readAt:at},contacts:[{type:'email',value:'manager@harbour.example.org',quote:'Practice Manager: manager@harbour.example.org',sourceURL:site+'contact',sourceRelation:'linked_page'}],linkedReadings:[{sourceURL:site+'contact',status:'read',readAt:at}],research:{facts:[{category:'training',text:name+' supports medical student teaching and continuing clinical learning.',sourceURL:site,readAt:at}]}},...changes});
const lead={clinicName:name,title:'General Practitioner — '+name,sourceUrl:'https://www.linkedin.com/jobs/view/123/',candidateHosts:['linkedin.com'],gmailId:'mail1',receivedAt:now-1000,notificationEligible:true,clinicalFacts:[],clinicalFactBasis:'private_email_statement',fit:{level1:'unknown',sponsorship:'unknown',registration:'unknown'}};
const proof=(candidate=lead,rows=[bank()])=>applyOwnedMailClinicBankProof(candidate,rows,{rootOwnerId:owner,now});
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['google-schema.sql','mail-opportunities-schema.sql','clinic-bank-schema.sql','mail-automation-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const binding={prepare(sql){let args=[];return {bind(...values){assert(values.length<=100);args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};}};
 db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,'arash','sub1',identity.email,'[]','synthetic',0,'connected',now);
 return {db,env:{GOOGLE_DB:binding},putBank(row=bank()){db.prepare('INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,status,read_at,last_success_at,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(row.id,row.owner_id,row.profile_id,row.url,row.name,row.status,row.read_at,row.last_success_at,JSON.stringify(row.result),at,at);}};
}

test('one fresh published teaching fact and actual contact support a labelled enquiry without a verified vacancy or service match',async()=>{
 const row=bank();row.result.clinicalText='';row.result.clinicalSourceURL=null;const candidate=proof(lead,[row]);
 assert.equal(assessMailPublicEmployerEvidence(candidate,{now}).reason,'public_job_source_required');assert.equal(assessMailOutreachEvidence(candidate,{now}).verified,true);
 const draft=await prepareMailOpportunityDraft(candidate,writing,{now});assert.equal(draft.readyForReview,true,JSON.stringify(draft.missing));assert.equal(draft.outreachMode,'initial_enquiry');assert.equal(draft.subject,'GP enquiry — '+name);assert.equal(draft.body.split('\n\n').length,6);assert(draft.body.includes('Phone: +61000000000'));assert(draft.paragraphs.clinic.startsWith('I am particularly interested'));assert(!draft.body.includes('vacancy is available'));assert.equal(verifiedMailApplicationURL(candidate,{now}),null);assert.equal(candidate.research.verification.checkedAt,at);
});
test('imports, stale/failed reads, unpublished addresses, wrong owners/names/domains and ambiguous bank identities cannot provide enquiry proof',()=>{
 const cases=[row=>{row.status='queued';},row=>{row.owner_id=other;},row=>{row.profile_id='amir';},row=>{row.name='Different Medical Centre';},row=>{row.result.title='Recruiter Listing | '+name;row.result.title='A recruiter list of '+name;},row=>{row.last_success_at=new Date(now-8*86400000).toISOString();},row=>{row.result.lastAttempt.status='robots_blocked';},row=>{row.result.contacts[0].quote='Call our practice.';},row=>{row.result.contacts[0].sourceURL='https://other.example.org/contact';},row=>{row.result.linkedReadings[0].status='robots_blocked';},row=>{row.result.research.facts=[];row.result.clinicalText='';},row=>{delete row.result.lastAttempt;}];
 for(const change of cases){const row=bank();change(row);assert.equal(assessMailOutreachEvidence(proof(lead,[row]),{now}).verified,false,JSON.stringify(row));}
 assert.equal(assessMailOutreachEvidence(proof(lead,[bank(),bank({id:'ambiguous',url:'https://another.example.org/'})]),{now}).verified,false);
 assert.equal(assessMailOutreachEvidence(proof({...lead,sourceUrl:'https://different.example.org/jobs/gp'}),{now}).verified,false);
});
test('job-link-only failure may use fresh clinic proof but a later failed clinic reading still blocks',()=>{
 const original={sourceURL:lead.sourceUrl,status:'robots_blocked',readAt:new Date(now).toISOString()},candidate=proof({...lead,sourceUnavailable:true,sourceUnavailableAt:now,research:{originalAdvertisement:original}});
 assert.equal(assessMailOutreachEvidence(candidate,{now}).verified,true);assert.deepEqual(candidate.research.originalAdvertisement,original);assert.equal(candidate.applicationSourceVerified,false);
 const employerFailure=proof({...lead,sourceUnavailable:true,sourceUnavailableAt:now,research:{sourcePages:[{sourceURL:site,status:'robots_blocked',readAt:new Date(now).toISOString()}]}});assert.equal(assessMailOutreachEvidence(employerFailure,{now}).verified,false);
 const laterEmployerFailure=proof({...lead,sourceUnavailable:true,sourceUnavailableAt:now,research:{originalAdvertisement:{...original,readAt:new Date(now-300000).toISOString()}}});assert.equal(assessMailOutreachEvidence(laterEmployerFailure,{now}).verified,false,'an older blocked job URL cannot mask a newer unspecified/employer failure');
});
test('closed, no Level 1/no visa/VR-only, incomplete sources, missing signatures and nonclinical CVs remain blocked for enquiries',async()=>{
 const candidate=proof();for(const flags of [{publicationClosed:true},{sourceRestrictions:[{code:'source_level1_restricted'}]},{fit:{level1:'restricted'}},{fit:{sponsorship:'restricted'}},{fit:{registration:'restricted'}},{sourceIncomplete:true},{closesAt:new Date(now-1).toISOString()}])assert.equal((await prepareMailOpportunityDraft({...candidate,...flags},writing,{now})).readyForReview,false);
 assert.equal((await prepareMailOpportunityDraft(candidate,{...writing,profile:{}},{now})).readyForReview,false);assert.equal((await prepareMailOpportunityDraft(candidate,{...writing,cvText:'Research publications and administrative university experience.'},{now})).readyForReview,false);
 for(const code of ['source_level1_restricted','source_sponsorship_restricted','source_registration_restricted','source_applications_closed']){const row=bank();row.result.sourceRestrictions=[{code,quote:'Published recruitment eligibility restriction.',sourceURL:site+'careers',checkedAt:at}];const cached=proof({...lead,sourceUrl:site+'careers'},[row]);assert.equal(cached.sourceRestrictions[0].code,code);assert.equal((await prepareMailOpportunityDraft(cached,writing,{now})).readyForReview,false,'a new lead must retain a cached explicit '+code);}
});
test('old Gmail leads can prepare an initial enquiry from owned read cache, while live message and owner/source guards remain mandatory',async()=>{
 const f=fixture();f.putBank();const old=now-40*86400000,r=raw('old',old);r.payload.mimeType='text/html';r.payload.body.data=Buffer.from('<p>General Practitioner jobs in Australia.</p><a href="'+site+'jobs/gp">General Practitioner — '+name+'</a>').toString('base64url');
 await ingestMailOpportunities(f.env,context,[normalizeMessage(r)],identity,{writingContext:writing,now});const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get();
 const proposal=await prepareOwnedMailOpportunity(f.env,context,row.id,{}, {writingContext:writing,now});assert.equal(proposal.readyForReview,true,JSON.stringify(proposal.missing));assert.equal(proposal.outreachMode,'initial_enquiry');
 const access=async()=>({subject:'sub1',email:identity.email,accessToken:'synthetic',scopes:['https://www.googleapis.com/auth/gmail.readonly']});
 const owned=await getOwnedMailOpportunityContext(f.env,owner,{id:row.id},async()=>Response.json(r),access);assert.equal(owned.outreachMode,'initial_enquiry');assert.equal(owned.sourceGmailId,'old');
 f.db.prepare("UPDATE private_mail_opportunities SET data_json=json_set(data_json,'$.historyGap',json('true')) WHERE id=?").run(row.id);await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,owner,{id:row.id},async()=>Response.json(r),access),/requires_refresh/);
});
test('owner-wide opportunity orders keep readiness, fit groups, and newest distinct before pagination',async()=>{
 const f=fixture();for(let n=0;n<4;n++)await ingestMailOpportunities(f.env,context,[message('sort'+n,now-1000*n)],identity,{writingContext:writing,now});
 const rows=f.db.prepare('SELECT * FROM private_mail_opportunities ORDER BY received_at DESC').all();assert.equal(rows.length,1);
 // Distinct source IDs simulate several older owned findings; only the oldest
 // contains a fully prepared current-source draft.
 const template=rows[0];for(let n=1;n<=3;n++)f.db.prepare('INSERT INTO private_mail_opportunities(id,owner_id,root_owner_id,profile_id,google_sub,gmail_id,thread_id,source_url,title,clinic_name,status,fit_json,data_json,draft_json,received_at,created_at,updated_at,read_at,notification_eligible) SELECT ?,owner_id,root_owner_id,profile_id,google_sub,?,thread_id,source_url,title,clinic_name,status,fit_json,data_json,draft_json,?,created_at,updated_at,read_at,notification_eligible FROM private_mail_opportunities WHERE id=?').run('mop_'+String(n).padStart(32,'0'),'other'+n,now-n*86400000,template.id);
 const id='mop_'+String(3).padStart(32,'0'),data=proof({...lead,gmailId:'other3'}),draft=await prepareMailOpportunityDraft(data,writing,{now});f.db.prepare('UPDATE private_mail_opportunities SET data_json=?,draft_json=? WHERE id=?').run(JSON.stringify(data),JSON.stringify(draft),id);
 const list=async query=>(await handleMailOpportunitiesRequest(new Request('https://app.example.org/api/google/mail-opportunities?limit=1'+query),f.env,context)).json();
 const ready=await list('');assert.equal(ready.sort,'ready');assert.equal(ready.items[0].id,id);assert.equal(ready.more,true);assert.notEqual((await list('&sort=newest')).items[0].id,id);assert.notEqual((await list('&offset=1')).items[0].id,id);
 const newest=template.id,stronger='mop_'+String(1).padStart(32,'0'),olderStrong='mop_'+String(2).padStart(32,'0');
 const strongFit={level1:'supported',sponsorship:'supported',pesci:'unknown',registration:'unknown'};
 const setFit=f.db.prepare("UPDATE private_mail_opportunities SET fit_json=?,data_json=json_set(data_json,'$.fit',json(?)) WHERE id=?");
 for(const row of [stronger,olderStrong,newest])setFit.run(JSON.stringify(strongFit),JSON.stringify(strongFit),row);
 f.db.prepare("UPDATE private_mail_opportunities SET data_json=json_set(data_json,'$.closesAt',?) WHERE id=?").run(new Date(now-86400000).toISOString(),newest);
 assert.equal((await list('&sort=relevant')).items[0].id,stronger);
 assert.equal((await list('&sort=relevant&offset=1')).items[0].id,olderStrong);
 assert.equal((await list('&sort=relevant&offset=2')).items[0].id,id);
 assert.equal((await list('&sort=relevant&offset=3')).items[0].id,newest);
 assert.equal((await list('&sort=newest')).items[0].id,newest);
 const response=await handleMailOpportunitiesRequest(new Request('https://app.example.org/api/google/mail-opportunities?sort=invalid'),f.env,context);assert.equal(response.status,400);
});
test('initial enquiry and verified job application modes bind immutable owner-edit context independently',async()=>{
 const candidate=proof(),draft=await prepareMailOpportunityDraft(candidate,writing,{now}),base={...draft,id:'mop_'+'f'.repeat(32),googleSubject:'sub1',sender:identity.email};assert.notEqual(await mailOpportunityEditContextHash(base),await mailOpportunityEditContextHash({...base,outreachMode:'job_application'}));
});

test('cached negative wording stays tied to its role; explicit clinic-wide refusals block new enquiries without treating bio or hours as restrictions',async()=>{
 const pages=[{url:site,status:'read',title:name,text:'Our practice cannot provide visa sponsorship. We cannot provide Level 1 supervision. Closed on Saturdays. Dr Sample holds FRACGP.'},{url:site+'jobs/old',status:'read',title:'Old GP job',text:'Applications are closed. VR GPs only.'}];
 const entries=readClinicSourceRestrictions(pages,{now});assert(entries.some(item=>item.code==='source_sponsorship_restricted'&&item.scope==='clinic_policy'));assert(entries.some(item=>item.code==='source_level1_restricted'));assert(entries.some(item=>item.code==='source_applications_closed'&&item.scope==='current_role'));assert(!entries.some(item=>/Saturdays|Dr Sample/.test(item.quote)));
 const row=bank();row.result.sourceRestrictions=entries.filter(item=>item.sourceURL===site+'jobs/old');const prior=proof(lead,[row]);assert.equal(prior.sourceRestrictions.length,0);assert.equal(prior.priorRoleRestrictions.length,2);assert.equal((await prepareMailOpportunityDraft(prior,writing,{now})).readyForReview,true);
 row.result.sourceRestrictions=entries;assert.equal((await prepareMailOpportunityDraft(proof(lead,[row]),writing,{now})).readyForReview,false);
 const noPrerequisite=readClinicSourceRestrictions([{url:site,status:'read',title:name,text:'No visa sponsorship required. Closed on Saturdays. Dr Sample FRACGP.'}],{now});assert.equal(noPrerequisite.length,0);
});
test('same clinic enquiries deduplicate across different tracker notices and own mailbox slots while actual job editions remain separate',()=>{
 const first=proof({...lead,key:'https://tracker.example.org/one'}),second=proof({...lead,key:'https://tracker.example.org/two',gmailId:'second',mailbox:'secondary'});assert.equal(mailInitialEnquiryKey(first,{now}),mailInitialEnquiryKey(second,{now}));assert(mailInitialEnquiryKey(first,{now}).startsWith('clinic-enquiry:'));
 assert.equal(mailInitialEnquiryKey({...first,applicationSourceVerified:true},{now}),null);
});
test('explicit clinic-wide refusals override careers paths, VR-only wording remains role-scoped, and recruiter policy cannot become employer policy',async()=>{
 const policy=readClinicSourceRestrictions([{url:site+'careers',title:'GP recruitment',status:'read',text:'Our practice cannot provide visa sponsorship. Our practice cannot provide Level 1 supervision.'}],{now});assert(policy.length>=2);assert(policy.every(item=>item.scope==='clinic_policy'));
 const role=readClinicSourceRestrictions([{url:site+'join-us',title:'Join us',status:'read',text:'VR GPs only.'}],{now});assert(role.some(item=>item.code==='source_registration_restricted'));assert(role.every(item=>item.scope==='current_role'));
 const row=bank();row.result.sourceRestrictions=role;assert.equal((await prepareMailOpportunityDraft(proof(lead,[row]),writing,{now})).readyForReview,true);
 row.result.sourceRestrictions=policy.map(item=>({...item,sourceURL:'https://recruiter.example.org/careers'}));const external=proof(lead,[row]);assert.equal(external.sourceRestrictions.length,0);assert.equal(external.priorRoleRestrictions.length,policy.length);assert.equal((await prepareMailOpportunityDraft(external,writing,{now})).readyForReview,true);
 row.result.sourceRestrictions=policy;assert.equal((await prepareMailOpportunityDraft(proof(lead,[row]),writing,{now})).readyForReview,false);
});
