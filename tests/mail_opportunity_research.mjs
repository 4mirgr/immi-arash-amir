import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dispatchMailOpportunityResearch as dispatch,mailResearchURL,assessMailResearchSource} from '../cloud/mail-opportunity-research.mjs';
import {prepareMailOpportunityDraft,prepareOwnedMailOpportunity,getOwnedMailOpportunityContext} from '../cloud/mail-opportunities.mjs';
import {hasFreshMailPublicEmployerEvidence,inferMailLeadEmployerName,mailPublicEmployerHints,selectMailEmployerLinks,discoverMailClinicSocialLinks} from '../cloud/mail-lead-discovery.mjs';

const NOW=Date.parse('2026-11-18T09:00:00Z'),OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const ID=n=>'mop_'+n.toString(16).padStart(32,'0');
const CV='33333333-3333-4333-8333-333333333333';
const clinic='Synthetic Medical Centre',origin='https://clinic.example.org';
const clinical='Synthetic Medical Centre provides chronic disease management and preventive care in a community general practice setting.';
const html=(body,title=clinic)=>'<html><head><title>'+title+'</title></head><body><main>'+body+'</main></body></html>';
function binding(db,counters){return{prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){counters.queries++;return db.prepare(sql).get(...args)||null;},async all(){counters.queries++;return{results:db.prepare(sql).all(...args)};},async run(){counters.queries++;return{meta:db.prepare(sql).run(...args)};}};}};}
function writing(){return {profile:{name:'Dr Synthetic Candidate',planning:{gpApplicationWriting:{confirmedByOwner:true,writingVersion:'human-four-paragraph-v1',openingParagraph:'I am a general practitioner with extensive experience in community general practice and chronic disease management.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',signatureEmail:'candidate@example.org',signaturePhone:'+12345678901'}}},cvText:'Managed chronic disease and preventive care in general practice, supporting continuity of patient care within a community clinic.',cvVersionId:CV};}
function fixture(){
 const db=new DatabaseSync(':memory:'),counts={queries:0,http:0,membership:0,writing:0};
 for(const file of ['google-schema.sql','mail-opportunities-schema.sql','mail-opportunity-research-schema.sql','mail-automation-schema.sql','clinic-bank-schema.sql','mail-lead-discovery-schema.sql','mail-lead-search-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const env={GOOGLE_DB:binding(db,counts),MAIL_OPPORTUNITY_RESEARCH_ENABLED:'true'};Object.defineProperty(env,'OPPORTUNITY_DB',{get(){throw Error('Private mail research must not access shared opportunity storage');}});
 for(const [owner,profile,subject]of [[OWNER,'arash','arash-sub'],[OWNER+':secondary','arash','arash-second-sub'],[OTHER,'amir','amir-sub']])db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,profile,subject,'synthetic@example.org','[]','NOT_A_TOKEN',NOW+3600000,'connected',NOW);
 const seed=(n=1,extra={})=>{
  const data={key:origin+'/jobs/gp',title:'General practitioner position',clinicName:clinic,sourceUrl:origin+'/jobs/gp',sourceKind:'job_notice',recipient:null,recipients:[],contactBasis:null,fit:{priority:'review',level1:'unknown',sponsorship:'unknown'},receivedAt:NOW-60000,gmailId:'mail-'+n,threadId:'thread-'+n,messageFingerprint:'synthetic-original-mail-fingerprint',clinicalFacts:[],clinicalFactBasis:'private_email_statement',provenance:{gmailId:'mail-'+n,kind:'private_email_statement'},...extra.data};
  const row={id:ID(n),owner_id:OWNER,root_owner_id:OWNER,profile_id:'arash',google_sub:'arash-sub',gmail_id:'mail-'+n,thread_id:'thread-'+n,source_url:origin+'/jobs/gp',title:data.title,clinic_name:data.clinicName,status:'suggested',fit_json:JSON.stringify(data.fit),data_json:JSON.stringify(data),draft_json:null,received_at:NOW-60000,created_at:NOW-1000,updated_at:NOW-1000,notification_eligible:1,...extra};delete row.data;
  const keys=Object.keys(row);db.prepare('INSERT INTO private_mail_opportunities('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key]));return row;
 };
 const calls=[],membership=async(_env,owner,profile)=>{counts.membership++;assert.equal(owner,OWNER);assert.equal(profile,'arash');return{active:true};};
 const writer=async(_env,context)=>{counts.writing++;assert.equal(context.rootUserId,OWNER);return writing();};
 const fetcher=async(url,options={})=>{counts.http++;calls.push({url,options});assert.equal(options.redirect,'manual');assert(!options.headers?.Authorization);assert(!options.headers?.Cookie);
  const u=new URL(url);if(u.pathname==='/robots.txt')return new Response('',{status:404});
  if(u.pathname==='/contact')return new Response(html('<h1>'+clinic+'</h1><p>For GP applications, email our recruitment team at manager@clinic.example.org.</p>','Contact '+clinic),{headers:{'Content-Type':'text/html'}});
  if(u.pathname==='/services')return new Response(html('<h1>'+clinic+'</h1><p>'+clinical+'</p>'),{headers:{'Content-Type':'text/html'}});
  return new Response(html('<p>'+clinical+'</p>'+(u.pathname==='/jobs/gp'?'<p>General Practitioner position: apply here for the role.</p>':'')+'<a href="/contact">Contact recruitment</a><a href="/services">Clinical services</a>'),{headers:{'Content-Type':'text/html'}});
 };
 return {db,env,counts,calls,seed,membership,writer,fetcher,options:{now:NOW,membership,writingContextProvider:writer,fetcher,sleep:async()=>{}}};
}

test('public research rejects authenticated/social/tracking/private targets and removes only known tracking parameters',()=>{
 for(const url of ['http://clinic.example.org/jobs','https://user:password@clinic.example.org/jobs','https://127.0.0.1/jobs','https://172.16.0.1/jobs','https://[::1]/jobs','https://169.254.169.254/jobs','https://clinic.local/jobs','https://clinic.example.org/account','https://clinic.example.org/%61uth/token','https://www.linkedin.com/jobs/view/123/','https://clinic.example.org/jobs?secret=hidden','https://clinic.example.org/jobs?return=https://attacker.org'])assert.equal(mailResearchURL(url),null,url);
 assert.equal(mailResearchURL('https://clinic.example.org/jobs?utm_source=mail&email=private&id=123#fragment'),origin+'/jobs?id=123');
});

test('disabled, missing schema and inactive owners perform no public research or CV reads',async()=>{
 const absent={MAIL_OPPORTUNITY_RESEARCH_ENABLED:'false'};Object.defineProperty(absent,'GOOGLE_DB',{get(){throw Error('Disabled must not read');}});assert.equal((await dispatch(absent)).status,'disabled');
 const f=fixture();f.seed();f.db.exec('DROP TABLE private_mail_opportunity_research');assert.equal((await dispatch(f.env,f.options)).status,'research_storage_required');assert.equal(f.calls.length,0);
 const g=fixture();g.seed();assert.equal((await dispatch(g.env,{...g.options,membership:async()=>({active:false})})).status,'membership_unavailable');assert.equal(g.calls.length,0);assert.equal(g.counts.writing,0);
});

test('main and same-host contact/service pages produce current published contacts and a full evidence-bound own CV draft',async()=>{
 const f=fixture(),row=f.seed(),result=await dispatch(f.env,f.options);assert.equal(result.status,'read');assert.equal(result.draftReady,true);assert(result.contacts>=1);assert.equal(result.publicRequests,f.calls.length);assert(result.publicRequests<=6);assert(f.counts.queries+f.counts.http+f.counts.membership<=25);
 const saved=f.db.prepare('SELECT * FROM private_mail_opportunities WHERE id=?').get(row.id),data=JSON.parse(saved.data_json),draft=JSON.parse(saved.draft_json);
 assert.equal(data.messageFingerprint,'synthetic-original-mail-fingerprint');assert.equal(data.contactBasis.kind,'source_published_research_contact');assert.equal(data.contactBasis.sourceUrl,origin+'/contact');assert(data.research.contactEvidence.some(contact=>contact.value==='manager@clinic.example.org'&&contact.sourceURL===origin+'/contact'));assert.equal(data.research.validUntil,NOW+7*86400000);assert.equal(data.clinicalFactBasis,'source_published_statement');
 assert.equal(draft.cvVersionId,CV);assert.equal(draft.readyForReview,true);assert(draft.body.includes('Kind regards,\nDr Synthetic Candidate\nPhone: +12345678901\nEmail: candidate@example.org'));assert(draft.body.includes(writing().profile.planning.gpApplicationWriting.openingParagraph));assert(draft.body.includes(writing().profile.planning.gpApplicationWriting.closingParagraph));assert(!draft.body.includes('visa guaranteed'));assert.equal(f.counts.membership,2);assert(f.calls.every(call=>new URL(call.url).hostname==='clinic.example.org'));
 const ledger=f.db.prepare('SELECT * FROM private_mail_opportunity_research').get();assert.equal(ledger.lease_until,0);assert.equal(ledger.source_updated_at,NOW);assert.equal((await dispatch(f.env,{...f.options,now:NOW+1000})).status,'idle');
});

test('missing own profile context is honest and cannot create a ready draft or borrow another owner CV',async()=>{
 const f=fixture();f.seed();const result=await dispatch(f.env,{...f.options,writingContextProvider:undefined});assert.equal(result.status,'read');assert.equal(result.draftReady,false);
 const saved=f.db.prepare('SELECT data_json,draft_json FROM private_mail_opportunities').get(),draft=JSON.parse(saved.draft_json);assert.equal(draft.readyForReview,false);assert.equal(draft.body,'');assert(draft.missing.includes('owner_writing_profile_required'));assert(JSON.parse(saved.data_json).research.contactEvidence.length>0);
});

test('LinkedIn is never fetched; only exact unique own-bank clinic evidence can provide a public fallback',async()=>{
 const f=fixture();f.seed(1,{source_url:'https://www.linkedin.com/jobs/view/123/',data:{sourceUrl:'https://www.linkedin.com/jobs/view/123/'}});
 const values=(owner,url,title=clinic)=>['lead-'+owner+'-'+url,owner,'arash',url,clinic,'{}','public_page_read',0,0,0,new Date(NOW).toISOString(),new Date(NOW).toISOString(),JSON.stringify({title,sourceURL:url}),0,new Date(NOW).toISOString(),new Date(NOW).toISOString()];
 f.db.prepare('INSERT INTO clinic_bank_leads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values(OTHER,origin+'/'));
 assert.equal((await dispatch(f.env,f.options)).code,'public_employer_source_required');assert.equal(f.calls.length,0);
 f.db.prepare('INSERT INTO clinic_bank_leads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values(OWNER,origin+'/'));
 f.db.prepare('UPDATE private_mail_opportunity_research SET next_attempt_at=0').run();const result=await dispatch(f.env,f.options);assert.equal(result.status,'read');assert(f.calls.every(call=>!call.url.includes('linkedin')));assert(JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json).research.matchedOwnBankLeadId);
 const g=fixture();g.seed(1,{source_url:'https://www.linkedin.com/jobs/view/123/'});g.db.prepare('INSERT INTO clinic_bank_leads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values(OWNER,origin+'/'));g.db.prepare('INSERT INTO clinic_bank_leads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values(OWNER,'https://other.example.org/'));assert.equal((await dispatch(g.env,g.options)).code,'public_employer_source_required');assert.equal(g.calls.length,0);
});

test('robots refusal and redirect restrictions back off without poisoning later candidates',async()=>{
 const f=fixture();f.seed(1,{source_url:origin+'/blocked'});f.seed(2,{source_url:origin+'/good',received_at:NOW-120000});
 const guarded=async(url,options)=>new URL(url).pathname==='/robots.txt'?new Response('User-agent: *\nDisallow: /blocked',{headers:{'Content-Type':'text/plain'}}):f.fetcher(url,options);
 const first=await dispatch(f.env,{...f.options,fetcher:guarded});assert.equal(first.code,'robots_blocked');assert.equal(f.db.prepare('SELECT lease_until FROM private_mail_opportunity_research WHERE opportunity_id=?').get(ID(1)).lease_until,0);assert(f.db.prepare('SELECT next_attempt_at FROM private_mail_opportunity_research WHERE opportunity_id=?').get(ID(1)).next_attempt_at>NOW);
 const next=await dispatch(f.env,{...f.options,fetcher:guarded});assert.equal(next.status,'read');assert.equal(f.db.prepare('SELECT count(*) n FROM private_mail_opportunity_research').get().n,2);
 const g=fixture();g.seed();const urls=[];const redirect=async(url)=>{urls.push(url);return new URL(url).pathname==='/robots.txt'?new Response('',{status:404}):new Response(null,{status:302,headers:{Location:'https://other.example.org/stolen'}});};const result=await dispatch(g.env,{...g.options,fetcher:redirect});assert.equal(result.code,'invalid_url');assert(urls.every(url=>!url.includes('other.example.org')));
});

test('a fresh page without old published contacts or clinic facts does not renew stale evidence',async()=>{
 const f=fixture();f.seed(1,{data:{recipient:'old@clinic.example.org',recipients:['old@clinic.example.org'],contactBasis:{kind:'source_published_research_contact',sourceUrl:origin+'/old-contact'},clinicalFacts:[clinical],clinicalFactBasis:'source_published_statement',research:{validUntil:NOW-1}}});
 const plain=async(url)=>new URL(url).pathname==='/robots.txt'?new Response('',{status:404}):new Response(html('<p>Opening hours are 9 am to 5 pm.</p>'),{headers:{'Content-Type':'text/html'}});
 const result=await dispatch(f.env,{...f.options,fetcher:plain});assert.equal(result.draftReady,false);const data=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert.deepEqual(data.recipients,[]);assert.equal(data.contactBasis,null);assert.deepEqual(data.clinicalFacts,[]);
});

test('published but owner-suppressed contacts cannot become a ready-to-email recommendation',async()=>{
 const f=fixture();f.seed();f.db.prepare('INSERT INTO mail_automation_suppressions VALUES(?,?,?,?)').run(OWNER,'manager@clinic.example.org','do_not_contact',new Date(NOW).toISOString());
 const result=await dispatch(f.env,f.options);assert.equal(result.draftReady,false);const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get();assert.equal(row.notification_eligible,0);assert.deepEqual(JSON.parse(row.data_json).recipients,[]);assert(JSON.parse(row.draft_json).missing.includes('recruitment_contact_required'));
});

test('concurrent owner edits, dismissed records and changed Google identities block stale background writes',async()=>{
 for(const mode of ['edit','dismiss','identity']){
  const f=fixture(),row=f.seed();const writer=async()=>{if(mode==='edit')f.db.prepare('UPDATE private_mail_opportunities SET updated_at=? WHERE id=?').run(NOW+1000,row.id);if(mode==='dismiss')f.db.prepare("UPDATE private_mail_opportunities SET status='dismissed' WHERE id=?").run(row.id);if(mode==='identity')f.db.prepare("UPDATE google_accounts SET google_sub='replaced-sub' WHERE owner_id=?").run(OWNER);return writing();};
  const result=await dispatch(f.env,{...f.options,writingContextProvider:writer});assert.equal(result.code,'source_changed',mode);assert.equal(f.db.prepare('SELECT draft_json FROM private_mail_opportunities').get().draft_json,null,mode);assert.equal(f.db.prepare('SELECT lease_until FROM private_mail_opportunity_research').get().lease_until,0);
 }
});

test('current own secondary mailbox is isolated and another doctor cannot supply its source or profile',async()=>{
 const f=fixture();f.seed(1,{owner_id:OWNER+':secondary',google_sub:'arash-second-sub'});const result=await dispatch(f.env,f.options);assert.equal(result.status,'read');assert.equal(f.db.prepare('SELECT owner_id FROM private_mail_opportunity_research').get().owner_id,OWNER+':secondary');
 const g=fixture();g.seed(1,{owner_id:OTHER,root_owner_id:OTHER,profile_id:'arash',google_sub:'amir-sub'});assert.equal((await dispatch(g.env,g.options)).status,'idle');assert.equal(g.calls.length,0);
});

test('fresh primary GP application closure or expiry blocks a polished draft despite good services and manager contact',async()=>{
 for(const restriction of ['Applications are now closed.','This GP position has been filled.','Application deadline: 1 November 2026.']){
  const f=fixture();f.seed();const fetched=async(url,options)=>new URL(url).pathname==='/jobs/gp'?new Response(html('<h1>General Practitioner position at '+clinic+'</h1><p>'+restriction+'</p><p>'+clinical+'</p><a href="/contact">Recruitment contact</a><a href="/services">Services</a>'),{headers:{'Content-Type':'text/html'}}):f.fetcher(url,options);
  const result=await dispatch(f.env,{...f.options,fetcher:fetched});assert.equal(result.status,'read');assert.equal(result.draftReady,false,restriction);
  const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),data=JSON.parse(row.data_json),draft=JSON.parse(row.draft_json);assert.equal(row.notification_eligible,0);assert.equal(data.sourceReviewRequired,true);assert.equal(data.publicationClosed,true);assert.equal(data.notificationEligible,false);assert.equal(draft.status,'needs_source_review');assert.equal(draft.readyForReview,false);assert(data.sourceRestrictions.some(item=>item.sourceURL===origin+'/jobs/gp'));assert(data.research.contactEvidence.length>0);
 }
});

test('current primary Level 1, employer-visa and VR-only restrictions replace stale positive email fit',async()=>{
 for(const [restriction,field]of [['Level 1 supervision is not available.','level1'],['Visa sponsorship is not available.','sponsorship'],['FRACGP or FACRRM only.','registration']]){
  const f=fixture();f.seed(1,{fit_json:JSON.stringify({priority:'high',level1:'supported',sponsorship:'supported'}),data:{fit:{priority:'high',level1:'supported',sponsorship:'supported'}}});
  const fetched=async(url,options)=>new URL(url).pathname==='/jobs/gp'?new Response(html('<p>'+restriction+'</p><p>'+clinical+'</p><a href="/contact">Recruitment contact</a>'),{headers:{'Content-Type':'text/html'}}):f.fetcher(url,options);
  const result=await dispatch(f.env,{...f.options,fetcher:fetched});assert.equal(result.draftReady,false,restriction);const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),data=JSON.parse(row.data_json),fit=JSON.parse(row.fit_json);assert.equal(row.notification_eligible,0);assert.equal(data.sourceReviewRequired,true);assert(data.sourceRestrictions.some(item=>item.code==='source_'+field+'_restricted'));if(field!=='registration')assert.equal(fit[field],'restricted');
 }
});

test('ordinary opening hours do not close an application, and later generic pages cannot reopen a previously closed edition',async()=>{
 const f=fixture();f.seed();const fetched=async(url,options)=>new URL(url).pathname==='/jobs/gp'?new Response(html('<p>Closed on Saturdays and Sundays.</p><p>'+clinical+'</p><a href="/contact">Contact recruitment</a>'),{headers:{'Content-Type':'text/html'}}):f.fetcher(url,options);
 const result=await dispatch(f.env,{...f.options,fetcher:fetched});assert.equal(result.draftReady,true);assert.equal(JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json).publicationClosed,false);
 const g=fixture();g.seed(1,{data:{sourceUnavailable:true,sourceUnavailableReason:'robots_blocked',sourceUnavailableAt:NOW-1000,sourceReviewRequired:true,publicationClosed:true,notificationEligible:false,sourceRestrictions:[{code:'source_applications_closed',sourceURL:origin+'/jobs/gp',quote:'Applications are closed.',checkedAt:new Date(NOW-1000).toISOString()}]}});assert.equal((await dispatch(g.env,g.options)).draftReady,false);const row=g.db.prepare('SELECT * FROM private_mail_opportunities').get();assert.equal(row.notification_eligible,0);assert.equal(JSON.parse(row.data_json).sourceUnavailable,false);assert.equal(JSON.parse(row.data_json).publicationClosed,true);assert.equal(JSON.parse(row.draft_json).readyForReview,false);
});

test('an ordinary no-sponsorship-required statement is not falsely treated as employer refusal',async()=>{
 const f=fixture();f.seed();const fetched=async(url,options)=>new URL(url).pathname==='/jobs/gp'?new Response(html('<p>No visa sponsorship required.</p><p>'+clinical+'</p><a href="/contact">Contact recruitment</a>'),{headers:{'Content-Type':'text/html'}}):f.fetcher(url,options);
 assert.equal((await dispatch(f.env,{...f.options,fetcher:fetched})).draftReady,true);const fit=JSON.parse(f.db.prepare('SELECT fit_json FROM private_mail_opportunities').get().fit_json);assert.equal(fit.sponsorship,'unknown');assert.equal(fit.sourceReviewRequired,false);
});

test('a latest 404 or robots denial invalidates an older ready draft and blocks manual preparation and fresh transport',async()=>{
 for(const failure of ['404','robots']){
  const f=fixture(),seeded=f.seed();assert.equal((await dispatch(f.env,f.options)).draftReady,true);
  f.db.prepare('UPDATE private_mail_opportunity_research SET next_attempt_at=0').run();
  const fetcher=async(url)=>new URL(url).pathname==='/robots.txt'?(failure==='robots'?new Response('User-agent: *\nDisallow: /',{headers:{'Content-Type':'text/plain'}}):new Response('',{status:404})):new Response('Not found',{status:404,headers:{'Content-Type':'text/plain'}});
  const failed=await dispatch(f.env,{...f.options,fetcher,now:NOW+60000});assert.equal(failed.draftReady,false,failure);const row=f.db.prepare('SELECT * FROM private_mail_opportunities').get(),data=JSON.parse(row.data_json),draft=JSON.parse(row.draft_json);
  assert.equal(data.sourceUnavailable,true);assert.equal(data.sourceReviewRequired,false);assert.equal(draft.readyForReview,false);assert.equal(draft.status,'needs_source_review');assert.equal(row.notification_eligible,0);assert.equal(f.db.prepare('SELECT source_updated_at FROM private_mail_opportunity_research').get().source_updated_at,row.updated_at);
  const context={userId:OWNER,rootUserId:OWNER,profileId:'arash',mailbox:'primary'};
  const prepared=await prepareOwnedMailOpportunity(f.env,context,seeded.id,{}, {writingContext:writing(),now:NOW+61000});assert.equal(prepared.readyForReview,false);assert(prepared.missing.includes('source_unavailable_requires_review'));
  await assert.rejects(()=>getOwnedMailOpportunityContext(f.env,OWNER,{id:seeded.id},async()=>{throw Error('Unavailable source must block before Gmail');},async()=>({subject:'arash-sub',email:'synthetic@example.org',accessToken:'synthetic',scopes:['https://www.googleapis.com/auth/gmail.readonly']})),error=>error.code==='mail_opportunity_source_unavailable');
  f.db.prepare('UPDATE private_mail_opportunity_research SET next_attempt_at=0').run();const restored=await dispatch(f.env,{...f.options,now:NOW+120000});assert.equal(restored.draftReady,true);const recovered=f.db.prepare('SELECT * FROM private_mail_opportunities').get();assert.equal(JSON.parse(recovered.data_json).sourceUnavailable,false);assert.equal(JSON.parse(recovered.data_json).sourceUnavailableReason,null);assert.equal(recovered.notification_eligible,1);
 }
});

test('no public target and unexpected reader failures cannot leave legacy ready drafts active',async()=>{
 for(const mode of ['no-target','throw']){
  const f=fixture(),row=f.seed(1,{...(mode==='no-target'?{source_url:null}:{}),data:{sourceUrl:mode==='no-target'?null:origin+'/jobs/gp',clinicalFacts:[clinical],recipient:'manager@clinic.example.org',recipients:['manager@clinic.example.org'],contactBasis:{kind:'private_email_reply_address',gmailId:'mail-1'}}});
  const draft={status:'ready_for_review',readyForReview:true,body:'Legacy email-only draft',missing:[]};f.db.prepare('UPDATE private_mail_opportunities SET draft_json=? WHERE id=?').run(JSON.stringify(draft),row.id);
  const result=await dispatch(f.env,{...f.options,...(mode==='throw'?{pageReader:async()=>{throw Error('untrusted provider failure');}}:{})});assert.equal(result.draftReady,false);const stored=f.db.prepare('SELECT * FROM private_mail_opportunities').get();assert.equal(JSON.parse(stored.data_json).sourceUnavailable,true);assert.equal(JSON.parse(stored.draft_json).readyForReview,false);assert.equal(stored.notification_eligible,0);
 }
});

test('an unread own-bank lead is a lookup seed; only a newly read matching public employer may verify it',async()=>{
 const f=fixture();f.seed(1,{source_url:'https://www.linkedin.com/jobs/view/123/',data:{sourceUrl:'https://www.linkedin.com/jobs/view/123/'}});
 f.db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,created_at,updated_at) VALUES(?,?,'arash',?,?,?,?)").run('imported-own-lead',OWNER,origin+'/',clinic,new Date(NOW).toISOString(),new Date(NOW).toISOString());
 const result=await dispatch(f.env,f.options);assert.equal(result.draftReady,false);const candidate=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert.equal(candidate.research.publicEmployerVerified,true);assert.equal(candidate.applicationSourceVerified,false);assert.equal(candidate.research.matchedOwnBankLeadId,'imported-own-lead');assert.equal(f.db.prepare('SELECT count(*) n FROM clinic_bank_leads WHERE owner_id=?').get(OWNER).n,1);
 const bank=JSON.parse(f.db.prepare('SELECT result_json FROM clinic_bank_leads WHERE owner_id=?').get(OWNER).result_json);assert.equal(bank.sourceStatus,'read');assert(bank.contacts.some(contact=>contact.value==='manager@clinic.example.org'));assert(!JSON.stringify(bank).includes('messageFingerprint'));assert(!JSON.stringify(bank).includes('candidate@example.org'));assert(!JSON.stringify(bank).includes('mail-1'));
 const g=fixture();g.seed(1,{source_url:'https://www.linkedin.com/jobs/view/123/'});g.db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,created_at,updated_at) VALUES(?,?,'arash',?,?,?,?)").run('wrong-source',OWNER,origin+'/',clinic,new Date(NOW).toISOString(),new Date(NOW).toISOString());
 const wrong=async url=>new URL(url).pathname==='/robots.txt'?new Response('',{status:404}):new Response(html('<p>Different Clinic provides general practice and chronic disease care.</p>','Different Clinic'),{headers:{'Content-Type':'text/html'}});
 assert.equal((await dispatch(g.env,{...g.options,fetcher:wrong})).draftReady,false);assert.equal(JSON.parse(g.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json).research.publicEmployerVerified,false);assert.equal(g.db.prepare('SELECT status FROM clinic_bank_leads').get().status,'pending');
});

test('public proof rejects email-only readiness, invented contacts, stale/failed sources and cross-clinic facts',async()=>{
 const f=fixture();f.seed();await dispatch(f.env,f.options);const candidate=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert(hasFreshMailPublicEmployerEvidence(candidate,{now:NOW}));
 const changes=[
  c=>{c.research.publicEmployerVerified=false;},c=>{c.clinicalFactBasis='private_email_statement';},c=>{c.clinicName='Different Clinic';},
  c=>{c.research.verification.checkedAt=new Date(NOW-8*86400000).toISOString();},c=>{c.research.contactEvidence[0].quote='Call the practice.';},
  c=>{c.recipients.push('private-only@clinic.example.org');},c=>{c.research.facts.forEach(fact=>fact.sourceURL='https://other.example.org/services');},
  c=>{c.research.sourcePages.push({sourceURL:c.research.verification.officialSourceURL,status:'robots_blocked',readAt:new Date(NOW).toISOString()});},
 ];
 for(const change of changes){const changed=structuredClone(candidate);change(changed);assert.equal(hasFreshMailPublicEmployerEvidence(changed,{now:NOW}),false);}
});

test('a public jobboard is a lead; a distinct official employer page must corroborate clinic, services and contacts',async()=>{
 const f=fixture();f.seed(1,{source_url:'https://www.seek.com.au/job/123',data:{sourceUrl:'https://www.seek.com.au/job/123'}});
 const fetcher=async(url,options)=>new URL(url).hostname==='www.seek.com.au'?(new URL(url).pathname==='/robots.txt'?new Response('',{status:404}):new Response(html('<h1>'+clinic+'</h1><p>'+clinical+'</p><p>For job enquiries: private@recruiter.example.org</p><a href="'+origin+'/">Official clinic website</a>'),{headers:{'Content-Type':'text/html'}})):f.fetcher(url,options);
 const result=await dispatch(f.env,{...f.options,fetcher});assert.equal(result.draftReady,true,JSON.stringify({result,calls:f.calls.map(call=>call.url),row:f.db.prepare('SELECT data_json,draft_json FROM private_mail_opportunities').get()}));assert(result.publicRequests<=6);const data=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert.equal(data.research.verification.officialSourceURL,origin+'/');assert(!data.recipients.includes('private@recruiter.example.org'));assert(data.research.sourcePages.some(page=>page.sourceURL==='https://www.seek.com.au/job/123'));assert(f.counts.queries+f.counts.http+f.counts.membership<=50);
 const g=fixture();g.seed(1,{source_url:'https://www.seek.com.au/job/123'});const isolated=async url=>new URL(url).pathname==='/robots.txt'?new Response('',{status:404}):new Response(html('<p>'+clinical+'</p><p>Recruitment manager@clinic.example.org</p>'),{headers:{'Content-Type':'text/html'}});assert.equal((await dispatch(g.env,{...g.options,fetcher:isolated})).draftReady,false);
});

test('discovered social business URLs have separate receipts and never authorize login or personal-profile scraping',()=>{
 const page={url:origin+'/',status:'read',enrichment:{contacts:[{type:'social',value:'https://www.linkedin.com/company/synthetic-clinic/',sourceURL:origin+'/',quote:'Our LinkedIn page'},{type:'social',value:'https://www.linkedin.com/in/person/',sourceURL:origin+'/',quote:'Personal profile'},{type:'social',value:'https://www.facebook.com/ClinicPublic',sourceURL:'https://other.example.org/',quote:'Unrelated page'}]}};
 const social=discoverMailClinicSocialLinks([page],origin+'/');assert.equal(social.length,1);assert.equal(social[0].status,'discovered_not_read');assert.equal(social[0].readAt,null);assert.equal(discoverMailClinicSocialLinks([{...page,status:'robots_blocked'}],origin+'/').length,0);
 assert.equal(selectMailEmployerLinks({...page,enrichment:{contacts:[{type:'website',value:'https://other.example.org/',sourceURL:origin+'/',quote:'Terms and conditions'}]}},clinic).length,0);
});

test('unverified public job titles supply an employer search label without turning a job alert into proof',()=>{
 assert.equal(inferMailLeadEmployerName({title:'General Practitioner Role at Example GP Example GP and Health Hub &middot; Ascot, QLD'}),'Example GP and Health Hub');
 assert.equal(inferMailLeadEmployerName({title:'Mental Health General Practitioner AlphaCo &middot; NSW'}),'AlphaCo');
 assert.equal(inferMailLeadEmployerName({title:'General Practitioner position'}),'');assert.equal(hasFreshMailPublicEmployerEvidence({clinicName:'AlphaCo'},{now:NOW}),false);
 assert.deepEqual(mailPublicEmployerHints({publicEmployerHints:[{url:origin+'/',clinicName:clinic,checkedAt:new Date(NOW-8*86400000).toISOString(),discoveryMethod:'connected_public_search'}]},NOW),[]);
});

test('role labels and their common alert typo are removed from clinic lookup names without changing practice brands',()=>{
 for(const prefix of ['General Practitioner\n','General Practioner\n','GP position: ','General Practioner '])assert.equal(inferMailLeadEmployerName({clinicName:prefix+clinic}),clinic);
 for(const name of ['General Practice Medical Centre','General Practitioner Clinic','General Medical Centre','General Practice Plus'])assert.equal(inferMailLeadEmployerName({clinicName:name}),name);
 assert.equal(inferMailLeadEmployerName({clinicName:'General Practitioner\n'+clinic,title:'Unrelated notification'}),clinic);
});

test('discovery version gradually repairs old research receipts and exact bank lookups use the owner/name index',async()=>{
 const f=fixture();f.seed();await dispatch(f.env,f.options);f.db.prepare("UPDATE private_mail_opportunity_research SET receipt_json='{}',next_attempt_at=?").run(NOW+86400000);
 assert.equal((await dispatch(f.env,{...f.options,now:NOW+60000})).status,'read');assert.equal((await dispatch(f.env,{...f.options,now:NOW+61000})).status,'idle');
 const plan=f.db.prepare("EXPLAIN QUERY PLAN SELECT id,name,url,status,result_json FROM clinic_bank_leads WHERE owner_id=? AND profile_id='arash' AND name=? COLLATE NOCASE ORDER BY last_success_at DESC,id LIMIT 4").all(OWNER,clinic);assert(plan.some(row=>row.detail.includes('clinic_bank_owner_name_nocase')));
});

test('formal fellowship and Australian-residence requirements in a public job listing block Level 1 recommendations',()=>{
 for(const text of ['We are seeking a Vocationally Registered (VR) GP to join our professional team.','About You:\nVocational Registration with AHPRA (FRACGP or FACRRM)\nEligible to practice independently as a GP in Australia','Requirements:\nAHPRA Registration\nFRACGP / FACRRM\nReside in Australia\nApply here']){
  const review=assessMailResearchSource({url:origin+'/jobs/gp',title:clinic,text},{title:'General Practitioner'},NOW);assert(review.restrictions.some(item=>item.code==='source_registration_restricted'));assert.equal(review.assessment.signals.registration.status,'restricted');if(text.includes('Reside in Australia'))assert(review.restrictions.some(item=>item.code==='source_australian_residence_required'));
 }
 const neutral=assessMailResearchSource({url:origin+'/jobs/gp',text:'Requirements:\nFRACGP preferred, but not required.\nNon-VR GPs with supervision may apply.'},{title:'General Practitioner'},NOW);assert(!neutral.restrictions.some(item=>item.code==='source_registration_restricted'));
});

test('optional free-plan search fills an absent clinic source then independently reads it within the shared request cap',async()=>{
 const f=fixture();f.env.MAIL_LEAD_SEARCH_ENABLED='true';f.env.TAVILY_API_KEY='SYNTHETIC_NOT_A_REAL_SEARCH_KEY';f.seed(1,{source_url:'https://www.linkedin.com/jobs/view/123/',data:{sourceUrl:'https://www.linkedin.com/jobs/view/123/',clinicName:'',title:'General Practitioner at Synthetic Medical Centre · NSW'}});
 const fetcher=async(url,options)=>{
  if(url.startsWith('https://api.tavily.com/')){
   f.counts.http++;assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer SYNTHETIC_NOT_A_REAL_SEARCH_KEY');
   if(url.endsWith('/usage'))return Response.json({key:{usage:0,limit:1000},account:{current_plan:'Researcher',plan_usage:0,plan_limit:1000,paygo_usage:0,paygo_limit:0}});
   assert(!options.body.includes('messageFingerprint'));return Response.json({results:[{url:origin+'/jobs/gp',title:clinic+' GP job',content:'Source snippets cannot verify a vacancy.'}]});
  }
  return f.fetcher(url,options);
 };
 const result=await dispatch(f.env,{...f.options,fetcher});assert.equal(result.draftReady,true);assert.equal(result.publicRequests,6);assert.equal(f.counts.http,6);assert(f.counts.queries+f.counts.http+f.counts.membership<=50);
 const row=f.db.prepare('SELECT data_json FROM private_mail_opportunities').get(),data=JSON.parse(row.data_json);assert.equal(data.clinicName,clinic);assert(hasFreshMailPublicEmployerEvidence(data,{now:NOW}));assert.equal(data.research.discovery.searchStatus,'searched');assert(data.research.discovery.employerCandidates.some(item=>item.status==='read'));assert(!row.data_json.includes('Source snippets cannot verify a vacancy.'));assert.equal(f.db.prepare('SELECT count(*) n FROM clinic_bank_leads WHERE owner_id=?').get(OWNER).n,1);
});

test('a clinic mentioned by an unlisted recruiter is not the publisher and cannot refresh the clinic bank',async()=>{
 const f=fixture();f.seed(1,{source_url:'https://recruiter.example.org/jobs/gp'});
 const fetcher=async url=>new URL(url).pathname==='/robots.txt'?new Response('',{status:404}):new Response(html('<p>'+clinical+'</p><p>Recruitment agency email recruiter@recruiter.example.org.</p><script type="application/ld+json">'+JSON.stringify({'@type':'JobPosting',hiringOrganization:{name:clinic},publisher:{'@type':'Organization',name:'Unlisted Recruitment',url:'https://recruiter.example.org/'}})+'</script>','General Practitioner at '+clinic+' | Unlisted Recruitment'),{headers:{'Content-Type':'text/html'}});
 assert.equal((await dispatch(f.env,{...f.options,fetcher})).draftReady,false);const data=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert.equal(data.research.publicEmployerVerified,false);assert.deepEqual(data.recipients,[]);assert.equal(f.db.prepare('SELECT count(*) n FROM clinic_bank_leads').get().n,0);
});

test('a directory/recruiter article cannot use its subject heading or title segment as an employer brand',async()=>{
 for(const publisher of ['Unlisted Recruitment','Medical Directory']){
  const f=fixture();f.seed(1,{source_url:'https://thirdparty.example.org/clinics/subject'});const fetcher=async url=>new URL(url).pathname==='/robots.txt'?new Response('',{status:404}):new Response(html('<h1>'+clinic+'</h1><p>'+clinical+'</p><p>Contact listing@thirdparty.example.org</p>',clinic+' | '+publisher),{headers:{'Content-Type':'text/html'}});
  assert.equal((await dispatch(f.env,{...f.options,fetcher})).draftReady,false);assert.equal(f.db.prepare('SELECT count(*) n FROM clinic_bank_leads').get().n,0);
 }
});

test('a role-only title can establish the employer brand from an actual same-site contact heading',async()=>{
 const f=fixture();f.seed();const fetcher=async(url,options)=>{
  const path=new URL(url).pathname;if(path==='/jobs/gp')return new Response(html('<p>Our practice provides chronic disease management and preventive care in community general practice.</p><p>General Practitioner position: apply here for the role.</p><a href="/contact">Contact</a>','General Practitioner'),{headers:{'Content-Type':'text/html'}});
  if(path==='/contact')return new Response(html('<h1>'+clinic+'</h1><p>Email the Practice Manager at manager@clinic.example.org for applications.</p>','Contact'),{headers:{'Content-Type':'text/html'}});
  return f.fetcher(url,options);
 };
 const result=await dispatch(f.env,{...f.options,fetcher});assert.equal(result.draftReady,true);assert(result.publicRequests<=6);const data=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert(data.research.verification.identityEvidence.some(item=>item.authority==='visible_brand_heading'));assert(hasFreshMailPublicEmployerEvidence(data,{now:NOW}));
});

test('actual employer restrictions override positive board wording and retain their own source URL',async()=>{
 const f=fixture();f.seed(1,{source_url:'https://www.seek.com.au/job/123'});
 const fetcher=async(url,options)=>{
  const parsed=new URL(url);if(parsed.hostname==='www.seek.com.au')return parsed.pathname==='/robots.txt'?new Response('',{status:404}):new Response(html('<p>Level 1 supervision available.</p><p>'+clinical+'</p><a href="'+origin+'/">Official clinic website</a>'),{headers:{'Content-Type':'text/html'}});
  if(parsed.pathname==='/')return new Response(html('<p>'+clinical+'</p><p>Level 1 supervision is not available.</p><p>Visa sponsorship is not available.</p><a href="/contact">Contact</a>'),{headers:{'Content-Type':'text/html'}});
  return f.fetcher(url,options);
 };
 const result=await dispatch(f.env,{...f.options,fetcher});assert.equal(result.draftReady,false);const data=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert.equal(data.fit.level1,'restricted');assert.equal(data.fit.sponsorship,'restricted');assert(data.sourceRestrictions.some(item=>item.code==='source_level1_restricted'&&item.sourceURL===origin+'/'));
});

test('bank refresh preserves separate clinic paths and never overwrites a differently named row on the same host',async()=>{
 const f=fixture();f.seed(1,{source_url:origin+'/clinics/branch-a'});f.db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,created_at,updated_at) VALUES(?,?,'arash',?,?,?,?)").run('headquarters',OWNER,origin+'/','Unrelated Network Headquarters',new Date(NOW).toISOString(),new Date(NOW).toISOString());
 await dispatch(f.env,f.options);assert.equal(f.db.prepare('SELECT name FROM clinic_bank_leads WHERE id=\'headquarters\'').get().name,'Unrelated Network Headquarters');assert.equal(f.db.prepare('SELECT name FROM clinic_bank_leads WHERE url=?').get(origin+'/clinics/branch-a').name,clinic);assert.equal(f.db.prepare('SELECT count(*) n FROM clinic_bank_leads').get().n,2);
 const g=fixture();g.seed(1,{source_url:origin+'/clinics/branch-a'});g.db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,created_at,updated_at) VALUES(?,?,'arash',?,?,?,?)").run('other-identity',OWNER,origin+'/clinics/branch-a','Different Branch Clinic',new Date(NOW).toISOString(),new Date(NOW).toISOString());await dispatch(g.env,g.options);assert.equal(g.db.prepare('SELECT name FROM clinic_bank_leads').get().name,'Different Branch Clinic');
});

test('a blocked original ad can enrich the employer bank without claiming the old vacancy is verified',async()=>{
 const f=fixture();f.seed(1,{source_url:'https://www.seek.com.au/job/123'});f.db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,created_at,updated_at) VALUES(?,?,'arash',?,?,?,?)").run('own-clinic',OWNER,origin+'/',clinic,new Date(NOW).toISOString(),new Date(NOW).toISOString());
 const fetcher=async(url,options)=>new URL(url).hostname==='www.seek.com.au'?new Response('User-agent: *\nDisallow: /',{headers:{'Content-Type':'text/plain'}}):f.fetcher(url,options);
 const result=await dispatch(f.env,{...f.options,fetcher});assert.equal(result.status,'read');assert.equal(result.draftReady,false);const data=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert.equal(data.research.originalAdvertisement.status,'robots_blocked');assert.equal(data.applicationSourceVerified,false);assert.equal(data.publicationBasis,'clinic_enquiry_unverified_vacancy');assert.equal(data.research.publicEmployerVerified,true);assert.equal(f.db.prepare('SELECT status FROM clinic_bank_leads').get().status,'public_contacts_found');assert(result.publicRequests<=6);
});

test('a blocked original ad may use a separately read explicit public GP position while keeping the failure receipt',async()=>{
 const f=fixture();f.seed(1,{source_url:'https://www.seek.com.au/job/123',data:{publicEmployerHints:[{url:origin+'/jobs/gp',clinicName:clinic,discoveryMethod:'connected_public_search',checkedAt:new Date(NOW).toISOString()}]}});
 const fetcher=async(url,options)=>new URL(url).hostname==='www.seek.com.au'?new Response('User-agent: *\nDisallow: /',{headers:{'Content-Type':'text/plain'}}):f.fetcher(url,options);
 const result=await dispatch(f.env,{...f.options,fetcher});assert.equal(result.draftReady,true);const data=JSON.parse(f.db.prepare('SELECT data_json FROM private_mail_opportunities').get().data_json);assert.equal(data.research.originalAdvertisement.status,'robots_blocked');assert.equal(data.applicationSourceVerified,true);assert.equal(data.sourceUnavailable,false);assert(result.publicRequests<=6);
});

test('durable failed-source receipts let a later untried employer hint run before repeated failures',async()=>{
 const f=fixture(),hints=['first','second','third'].map(path=>({url:origin+'/'+path,clinicName:clinic,discoveryMethod:'connected_public_search',checkedAt:new Date(NOW).toISOString()}));f.seed(1,{source_url:'https://www.linkedin.com/jobs/view/123/',data:{publicEmployerHints:hints}});
 const requested=[],fetcher=async(url,options)=>{requested.push(url);return /^\/(?:first|second|third)$/.test(new URL(url).pathname)?new Response('Not found',{status:404,headers:{'Content-Type':'text/plain'}}):f.fetcher(url,options);};
 assert.equal((await dispatch(f.env,{...f.options,fetcher})).draftReady,false);const receipt=JSON.parse(f.db.prepare('SELECT receipt_json FROM private_mail_opportunity_research').get().receipt_json);assert.equal(receipt.sourceAttempts.length,3);assert(receipt.sourceAttempts.every(item=>item.failures===1));
 const row=f.db.prepare('SELECT data_json FROM private_mail_opportunities').get(),data=JSON.parse(row.data_json);data.publicEmployerHints.push({url:origin+'/jobs/gp',clinicName:clinic,discoveryMethod:'connected_public_search',checkedAt:new Date(NOW).toISOString()});f.db.prepare('UPDATE private_mail_opportunities SET data_json=?,updated_at=?').run(JSON.stringify(data),NOW+60000);requested.length=0;
 const result=await dispatch(f.env,{...f.options,fetcher,now:NOW+60000});assert.equal(result.draftReady,true);assert.equal(requested.find(url=>!url.endsWith('/robots.txt')),origin+'/jobs/gp');assert(result.publicRequests<=6);
});

test('persistently failed or identity-unverified bank URLs reserve a later attempt for wider search before public reads',async()=>{
 for(const mode of ['http-failed','unverified']){
  const f=fixture();f.seed(1,{source_url:'https://www.linkedin.com/jobs/view/123/'});f.db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,created_at,updated_at) VALUES(?,?,'arash',?,?,?,?)").run('known-but-unusable',OWNER,origin+'/bad-home',clinic,new Date(NOW).toISOString(),new Date(NOW).toISOString());
  const requested=[],fetcher=async(url,options)=>{
   requested.push(url);
   if(url==='https://api.tavily.com/usage')return Response.json({key:{usage:0,limit:1000},account:{current_plan:'Researcher',plan_usage:0,plan_limit:1000,paygo_usage:0,paygo_limit:0}});
   if(url==='https://api.tavily.com/search')return Response.json({results:[{url:origin+'/jobs/gp',title:clinic+' GP position'}]});
   if(new URL(url).pathname==='/bad-home')return mode==='http-failed'?new Response('Not found',{status:404,headers:{'Content-Type':'text/plain'}}):new Response(html('<h1>'+clinic+'</h1><p>'+clinical+'</p>',clinic+' | Medical Directory'),{headers:{'Content-Type':'text/html'}});
   return f.fetcher(url,options);
  };
  assert.equal((await dispatch(f.env,{...f.options,fetcher})).draftReady,false);const receipt=JSON.parse(f.db.prepare('SELECT receipt_json FROM private_mail_opportunity_research').get().receipt_json);assert(receipt.sourceAttempts.some(item=>item.url===origin+'/bad-home'&&item.failures>0));
  f.env.MAIL_LEAD_SEARCH_ENABLED='true';f.env.TAVILY_API_KEY='SYNTHETIC_NOT_A_REAL_SEARCH_KEY';f.db.prepare('UPDATE private_mail_opportunity_research SET next_attempt_at=0').run();requested.length=0;
  const result=await dispatch(f.env,{...f.options,fetcher,now:NOW+60000});assert.equal(result.draftReady,true,mode);assert.deepEqual(requested.slice(0,2),['https://api.tavily.com/usage','https://api.tavily.com/search']);assert(!requested.includes(origin+'/bad-home'));assert.equal(result.publicRequests,6);
 }
});
