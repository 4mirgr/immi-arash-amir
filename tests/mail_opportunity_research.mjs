import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dispatchMailOpportunityResearch as dispatch,mailResearchURL} from '../cloud/mail-opportunity-research.mjs';
import {prepareMailOpportunityDraft,prepareOwnedMailOpportunity,getOwnedMailOpportunityContext} from '../cloud/mail-opportunities.mjs';

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
 for(const file of ['google-schema.sql','mail-opportunities-schema.sql','mail-opportunity-research-schema.sql','mail-automation-schema.sql','clinic-bank-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
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
  return new Response(html('<p>'+clinical+'</p><a href="/contact">Contact recruitment</a><a href="/services">Clinical services</a>'),{headers:{'Content-Type':'text/html'}});
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
  const candidate=JSON.parse(row.data_json),draft=await prepareMailOpportunityDraft(candidate,writing());assert.equal(draft.readyForReview,true);f.db.prepare('UPDATE private_mail_opportunities SET draft_json=? WHERE id=?').run(JSON.stringify(draft),row.id);
  const result=await dispatch(f.env,{...f.options,...(mode==='throw'?{pageReader:async()=>{throw Error('untrusted provider failure');}}:{})});assert.equal(result.draftReady,false);const stored=f.db.prepare('SELECT * FROM private_mail_opportunities').get();assert.equal(JSON.parse(stored.data_json).sourceUnavailable,true);assert.equal(JSON.parse(stored.draft_json).readyForReview,false);assert.equal(stored.notification_eligible,0);
 }
});
