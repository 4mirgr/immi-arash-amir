import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {deriveClinicCorrespondence,correspondenceReplyText,getOwnedClinicFollowUpContext,handleClinicCorrespondenceRequest,recordClinicCorrespondenceStops} from '../cloud/clinic-correspondence.mjs';

const DAY=86400000,at=Date.now(),old=at-10*DAY;
const owner={userId:'correspondence-arash',profileId:'arash',mailbox:'primary'};
const other={userId:'correspondence-amir',profileId:'amir',mailbox:'primary'};
const account={accessToken:'synthetic-access',subject:'subject-arash',email:'applicant@example.invalid',scopes:['https://www.googleapis.com/auth/gmail.readonly']};
const sent=(changes={})=>({id:'sent1',threadId:'thread1',from:account.email,to:'Synthetic Practice <manager@practice.example.invalid>',cc:'',bcc:'',subject:'GP position application',plainBody:'I am applying for a GP position and appropriate Level 1 supervision. Please find my CV.',snippet:'',dateTimestamp:old,date:new Date(old).toISOString(),direction:'sent',labels:['SENT'],rfcMessageId:'<sent1@example.invalid>',...changes});
const reply=(plainBody,changes={})=>({id:'reply1',threadId:'thread1',from:'Manager <manager@practice.example.invalid>',to:account.email,subject:'Re: GP position application',plainBody,snippet:'',dateTimestamp:old+DAY,date:new Date(old+DAY).toISOString(),direction:'received',labels:['INBOX'],rfcMessageId:'<reply1@practice.example.invalid>',...changes});
const coverage=(changes={})=>[{thread_id:'thread1',complete:1,last_checked_at:at,...changes}];
const derive=(messages,options={})=>deriveClinicCorrespondence(messages,{ownEmail:account.email,now:at,threadCoverage:coverage(),...options});
const raw=message=>({id:message.id,threadId:message.threadId,internalDate:String(message.dateTimestamp),labelIds:message.labels,payload:{mimeType:'text/plain',headers:[{name:'From',value:message.from},{name:'To',value:message.to},{name:'Cc',value:message.cc||''},{name:'Bcc',value:message.bcc||''},{name:'Subject',value:message.subject},{name:'Message-ID',value:message.rfcMessageId}],body:{data:Buffer.from(message.plainBody).toString('base64url')}}});
function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const name of ['google-schema.sql','google-mail-schema.sql','google-mail-correspondence-schema.sql','clinic-correspondence-stops-schema.sql','mail-automation-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+name,import.meta.url),'utf8'));
 const binding={prepare(sql){return {bind(...params){const statement=db.prepare(sql);return {async first(){return statement.get(...params)||null;},async all(){return {results:statement.all(...params)};},async run(){return {meta:statement.run(...params)};}};}};}};
 const env={GOOGLE_DB:binding};
 const save=(message,context=owner,subject=account.subject)=>db.prepare('INSERT OR REPLACE INTO google_mail_messages VALUES (?,?,?,?,?,?,?,?)').run(context.userId,subject,message.id,message.threadId,message.dateTimestamp,'weak',JSON.stringify(message),at);
 const link=(context=owner,subject=account.subject,email=account.email)=>db.prepare('INSERT INTO google_accounts VALUES (?,?,?,?,?,?,?,?,?)').run(context.userId,context.profileId,subject,email,JSON.stringify(account.scopes),'synthetic-encrypted',at+DAY,'connected',at);
 const mark=()=>db.prepare('INSERT OR REPLACE INTO google_mail_correspondence_threads(owner_id,google_sub,thread_id,discovered_at,last_checked_at,complete,last_error) VALUES (?,?,?,?,?,?,?)').run(owner.userId,account.subject,'thread1',at,at,1,null);
 const provider=async()=>account;
 const fetcher=async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.method,undefined);if(url.includes('/messages?')){assert.equal(new URL(url).searchParams.get('maxResults'),'1');return Response.json({messages:[]});}assert.match(url,/\/threads\/thread1\?format=full$/);return Response.json({id:'thread1',messages:[raw(sent())]});};
 return {db,env,save,link,mark,provider,fetcher};
}

test('clinic cases originate from actual Sent applications and do not treat unrelated mail as applications',()=>{
 const cases=derive([reply('We can offer you an interview.'),sent({threadId:'personal',subject:'Dinner',plainBody:'See you this evening.'})]);
 assert.equal(cases.length,0);
 const [item]=derive([sent()]);assert.equal(item.name,'Synthetic Practice');assert.equal(item.recipient,'manager@practice.example.invalid');assert.equal(item.status,'waiting');assert.equal(item.followUp.eligible,true);assert.equal(item.followUp.reason,'due');assert.equal(item.automaticSending,false);
});
test('missing, incomplete or stale thread readings never enable follow-up',()=>{
 for(const threadCoverage of [[],coverage({complete:0}),coverage({last_checked_at:at-2*DAY}),coverage({last_checked_at:at+2*DAY})])assert.equal(derive([sent()],{threadCoverage})[0].followUp.eligible,false);
 const item=derive([sent({dateTimestamp:at-DAY,date:new Date(at-DAY).toISOString()})])[0];assert.equal(item.followUp.reason,'not_due');
});
test('quoted applicant pitch and old forwarded correspondence cannot become employer support or an offer',()=>{
 const body='Thank you for your email.\n\nOn Monday, Synthetic Applicant\n<applicant@example.invalid> wrote:\n> We can offer sponsorship and Level 1 supervision.\n> We would like to offer you a formal job offer.';
 assert.equal(correspondenceReplyText(body),'Thank you for your email.');
 const [item]=derive([sent(),reply(body)]);assert.equal(item.status,'acknowledgement');assert.equal(item.signals.sponsorship.status,'unknown');assert.equal(item.signals.level1.status,'unknown');assert.equal(item.followUp.reason,'reply_received');
 assert.equal(correspondenceReplyText('We received your email.\n-----Original Message-----\nWe can provide sponsorship.'),'We received your email.');
});
test('clinical Level 1 and employer visa sponsorship remain independent unverified statements',()=>{
 const [item]=derive([sent(),reply('We can provide Level 1 supervision, but we cannot offer visa sponsorship.')]);
 assert.equal(item.signals.level1.status,'positive');assert.equal(item.signals.sponsorship.status,'negative');assert.equal(item.signals.level1.verified,false);assert.equal(item.status,'rejected');assert.equal(item.followUp.eligible,false);
 const [question]=derive([sent(),reply('Can you provide visa sponsorship? You must complete PESCI.')]);assert.equal(question.signals.sponsorship.status,'unknown');assert.equal(question.signals.pesci.status,'unknown');
 for(const body of ['We can provide Level 1 supervision, no visa sponsorship is available.','We can provide Level 1 supervision and do not offer visa sponsorship.']){const [split]=derive([sent(),reply(body)]);assert.equal(split.signals.level1.status,'positive');assert.equal(split.signals.sponsorship.status,'negative');}
 for(const body of ['We have no objection to providing Level 1 supervision.','We do not rule out visa sponsorship.']){const [uncertain]=derive([sent(),reply(body)]);assert.notEqual(uncertain.signals.level1.status,'negative');assert.notEqual(uncertain.signals.sponsorship.status,'negative');}
});
test('substantive employer responses stop unanswered-application follow-up and explain the next step',()=>{
 const fixtures=[['Please send your CV and registration certificate.','documents_requested'],['We would like to arrange an interview with you.','interview'],['We are pleased to offer you a GP position.','offer_mentioned'],['Out of office until next week.','out_of_office'],['Thank you for applying. We have received your application.','acknowledgement'],['We need to discuss the scope of supervision.','reply_received']];
 for(const [body,status]of fixtures){const [item]=derive([sent(),reply(body)]);assert.equal(item.status,status,body);assert.equal(item.followUp.eligible,false);assert.equal(item.followUp.reason,'reply_received');assert.ok(item.nextAction);}
});
test('denied requests and hypothetical offers cannot become offer, document or interview requests',()=>{
 for(const [body,status]of [['We cannot issue an offer of employment.','rejected'],['We are not in a position to offer a GP role.','rejected'],['Please do not send your CV or registration documents.','reply_received'],['We cannot arrange an interview with you.','reply_received'],['If we are pleased to offer you a position, we will write again.','reply_received'],['For example, we are pleased to offer you a GP position.','reply_received'],['We have not received your application.','reply_received']])assert.equal(derive([sent(),reply(body)])[0].status,status,body);
});
test('the newest thread for a clinic supersedes old unanswered applications and repetition is bounded',()=>{
 const newer=sent({id:'newersent',threadId:'newerthread',dateTimestamp:old+DAY,date:new Date(old+DAY).toISOString()});
 const cases=derive([sent(),newer],{threadCoverage:[...coverage(),{...coverage()[0],thread_id:'newerthread'}]});
 assert.equal(cases.find(item=>item.id==='thread1').followUp.reason,'newer_application_exists');assert.equal(cases.find(item=>item.id==='newerthread').followUp.eligible,true);
 const [repeated]=derive([sent(),sent({id:'sent2',dateTimestamp:old+DAY})]);assert.equal(repeated.followUp.reason,'follow_up_limit');assert.equal(repeated.followUp.eligible,false);
 const stopped=derive([sent(),reply('Please do not contact us again.'),newer],{threadCoverage:[...coverage(),{...coverage()[0],thread_id:'newerthread'}]});assert.equal(stopped.find(item=>item.id==='newerthread').followUp.reason,'contact_stopped_do_not_contact');
});
test('refusal, failed delivery and do-not-contact survive later outgoing mail and cannot restart a follow-up loop',()=>{
 for(const [message,status]of [[reply('Please do not contact us again.'),'do_not_contact'],[reply('We are not currently recruiting.'),'rejected'],[reply('The recipient address was rejected.',{from:'mailer-daemon@practice.example.invalid',subject:'Delivery failure'}),'bounced']]){
  const [item]=derive([sent(),message,sent({id:'sent2',dateTimestamp:old+2*DAY})]);assert.equal(item.status,status);assert.equal(item.followUp.eligible,false);assert.equal(item.followUp.reason,'stopped_'+status);
 }
});
test('multiple clinic recipients in To, CC or BCC prevent automatic follow-up targeting',()=>{
 for(const changed of [{to:'one@practice.example.invalid, two@other.example.invalid'},{cc:'two@other.example.invalid'},{bcc:'two@other.example.invalid'}]){
  const [item]=derive([sent(changed)]);assert.equal(item.recipient,null);assert.equal(item.followUp.reason,'ambiguous_recipients');assert.equal(item.followUp.eligible,false);
 }
});
test('spam, trash, draft messages and invalid thread IDs are excluded',()=>{
 assert.equal(derive([sent({labels:['SENT','TRASH']})]).length,0);
 assert.equal(derive([sent({threadId:'../invalid'})]).length,0);
 const [item]=derive([sent(),reply('We would like to offer you a GP position.',{labels:['SPAM']})]);assert.equal(item.status,'waiting');
});
test('GET correspondence enforces exact owner and verified Google subject, including same Gmail IDs',async()=>{
 const f=fixture();f.link();f.save(sent());f.mark();f.save(sent({plainBody:'Private Amir GP application.',to:'other@amir.example.invalid'}),other,'subject-amir');f.save(reply('Private old connection'),owner,'previous-google-subject');
 const response=await handleClinicCorrespondenceRequest(new Request('https://app.example.invalid/api/google/clinic-correspondence'),f.env,owner,f.fetcher,f.provider);
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.items.length,1);assert.equal(data.items[0].recipient,'manager@practice.example.invalid');assert.doesNotMatch(JSON.stringify(data),/Private Amir|Private old connection|synthetic-access|synthetic-encrypted/);assert.equal(data.automaticSending,false);
});
test('missing Gmail read scope, cross-profile selection and cross-origin mutations fail closed',async()=>{
 const f=fixture();
 const forbidden=await handleClinicCorrespondenceRequest(new Request('https://app.example.invalid/api/google/clinic-correspondence?profile=amir'),f.env,owner,f.fetcher,f.provider);assert.equal(forbidden.status,403);
 const scope=await handleClinicCorrespondenceRequest(new Request('https://app.example.invalid/api/google/clinic-correspondence'),f.env,owner,f.fetcher,async()=>({...account,scopes:['https://www.googleapis.com/auth/gmail.send']}));assert.equal(scope.status,403);
 const origin=await handleClinicCorrespondenceRequest(new Request('https://app.example.invalid/api/google/clinic-correspondence/draft',{method:'POST',headers:{Origin:'https://foreign.example.invalid'},body:'{}'}),f.env,owner,f.fetcher,f.provider);assert.equal(origin.status,403);
});
test('a follow-up context is tied to a stored own Sent message and rechecks the actual Gmail thread',async()=>{
 const f=fixture();f.save(sent());let gets=0;
 const result=await getOwnedClinicFollowUpContext(f.env,owner.userId,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'},async(...args)=>{gets++;return f.fetcher(...args);},f.provider);
 assert.equal(gets,3);assert.equal(result.to,'manager@practice.example.invalid');assert.equal(result.rfcMessageId,'<sent1@example.invalid>');assert.equal(result.subject,'Re: GP position application');
 await assert.rejects(getOwnedClinicFollowUpContext(f.env,other.userId,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'},f.fetcher,f.provider),{code:'message_not_found'});
 await assert.rejects(getOwnedClinicFollowUpContext(f.env,owner.userId,{messageId:'sent1',threadId:'thread1',to:'changed@practice.example.invalid'},f.fetcher,f.provider),{code:'follow_up_context_mismatch'});
});
test('a reply received during draft review blocks live follow-up even when the cached case says waiting',async()=>{
 const f=fixture();f.save(sent());
 await assert.rejects(getOwnedClinicFollowUpContext(f.env,owner.userId,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'},async()=>Response.json({id:'thread1',messages:[raw(sent()),raw(reply('Thank you for your email.'))]}),f.provider),{code:'follow_up_reply_received'});
 assert.equal(f.db.prepare('SELECT count(*) n FROM google_mail_messages').get().n,1);
});
test('late outgoing messages, hidden recipients and old refusal cannot bypass live thread review',async()=>{
 const f=fixture();f.save(sent());const body={messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'};
 for(const messages of [[sent(),sent({id:'sent2',dateTimestamp:old+DAY})],[sent({cc:'other@practice.example.invalid'})],[sent(),reply('We cannot offer visa sponsorship.'),sent({id:'sent2',dateTimestamp:old+2*DAY})]])await assert.rejects(getOwnedClinicFollowUpContext(f.env,owner.userId,body,async()=>Response.json({id:'thread1',messages:messages.map(raw)}),f.provider));
});
test('a rejected provider GET refreshes once for the same identity and rejects redirects or changed identities',async()=>{
 const f=fixture();f.save(sent());const body={messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'};let reads=0,refreshes=0;
 const access=async(env,id,fetcher,options)=>{if(options?.forceRefresh){refreshes++;return {...account,accessToken:'renewed'};}return account;};
 const result=await getOwnedClinicFollowUpContext(f.env,owner.userId,body,async(url,options)=>{reads++;if(reads===1)return Response.json({},{status:401});assert.equal(options.headers.Authorization,'Bearer renewed');return url.includes('/messages?')?Response.json({messages:[]}):Response.json({id:'thread1',messages:[raw(sent())]});},access);
 assert.equal(reads,4);assert.equal(refreshes,1);assert.equal(result.googleSubject,account.subject);
 await assert.rejects(getOwnedClinicFollowUpContext(f.env,owner.userId,body,async()=>new Response(null,{status:302,headers:{Location:'https://foreign.example.invalid/private'}}),f.provider),{code:'gmail_redirect_rejected'});
 await assert.rejects(getOwnedClinicFollowUpContext(f.env,owner.userId,body,async()=>Response.json({},{status:401}),async(env,id,fetcher,options)=>options?.forceRefresh?{...account,subject:'other-subject'}:account),{code:'connection_changed'});
});
test('new-thread replies or delivery failures block follow-up even when the original thread remains unanswered',async()=>{
 for(const bounce of [false,true]){
  const f=fixture();f.save(sent());let searches=0;
  await assert.rejects(getOwnedClinicFollowUpContext(f.env,owner.userId,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'},async(url,options)=>{
   if(!url.includes('/messages?'))return f.fetcher(url,options);
   searches++;const query=new URL(url).searchParams.get('q');assert.match(query,/after:\d+/);assert.match(query,/-in:sent -in:drafts -in:spam -in:trash/);
   if(bounce)assert.equal(query.includes('mailer-daemon'),searches===2);
   return Response.json({messages:searches===(bounce?2:1)?[{id:'unread_new_thread'}]:[]});
  },f.provider),{code:'follow_up_new_correspondence_requires_review'});
  assert.equal(searches,bounce?2:1);
 }
});
test('the entire live follow-up check refreshes at most once across thread and new-message searches',async()=>{
 const f=fixture();f.save(sent());let refreshes=0,reads=0;
 await assert.rejects(getOwnedClinicFollowUpContext(f.env,owner.userId,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'},async(url,options)=>{reads++;if(reads===1||url.includes('/messages?'))return Response.json({},{status:401});return f.fetcher(url,options);},async(env,id,fetcher,options)=>{if(options?.forceRefresh)refreshes++;return {...account,accessToken:options?.forceRefresh?'renewed':account.accessToken};}),{code:'reconnect_required'});
 assert.equal(refreshes,1);assert.equal(reads,3);
});
test('a reviewed draft includes the owner signature, keeps sponsorship separate, and creates no transport',async()=>{
 const f=fixture();f.save(sent());f.mark();let restCalls=0;
 const context={...owner,rest:async(table,query)=>{restCalls++;assert.equal(table,'immi_profiles');assert.match(query,/user_id=eq.correspondence-arash/);return [{data:{name:'Synthetic Applicant',planning:{gpApplicationWriting:{confirmedByOwner:true,writingVersion:'human-four-paragraph-v1',openingParagraph:'I am a general practitioner applying for an appropriately supervised medical position.',closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',signaturePhone:'+61 200000000',signatureEmail:'applicant@example.invalid'}}}}];}};
 const response=await handleClinicCorrespondenceRequest(new Request('https://app.example.invalid/api/google/clinic-correspondence/draft',{method:'POST',body:JSON.stringify({threadId:'thread1'})}),f.env,context,f.fetcher,f.provider);
 assert.equal(response.status,200);const data=await response.json();assert.equal(restCalls,1);assert.equal(data.kind,'follow_up');assert.equal(data.reviewRequired,true);assert.equal(data.automaticSending,false);assert.equal(data.replyContext,null);assert.deepEqual(data.followUpContext,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'});assert.match(data.body,/Level 1 clinical supervision and employer-sponsored work visa arrangements/);assert.match(data.body,/Phone: \+61 200000000\nEmail: applicant@example.invalid/);
 const tables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);assert.ok(!tables.includes('google_send_queue'));
});
test('a reply found during live drafting returns a safe blocking code and never reads or borrows a profile signature',async()=>{
 const f=fixture();f.save(sent());f.mark();let profiles=0;
 const response=await handleClinicCorrespondenceRequest(new Request('https://app.example.invalid/api/google/clinic-correspondence/draft',{method:'POST',body:JSON.stringify({threadId:'thread1'})}),f.env,{...owner,rest:async()=>{profiles++;return [];}},async()=>Response.json({id:'thread1',messages:[raw(sent()),raw(reply('Please send your CV.'))]}),f.provider);
 assert.equal(response.status,409);assert.equal((await response.json()).error,'follow_up_reply_received');assert.equal(profiles,0);
});
test('minimal stop receipts survive raw-mail expiry and grant replacement while raw mail remains private',async()=>{
 const f=fixture();f.link();f.save(sent());f.save(reply('Please do not contact us again.'));
 const recorded=await recordClinicCorrespondenceStops(f.env,owner);assert.equal(recorded.recorded,1);
 const row=f.db.prepare('SELECT * FROM clinic_correspondence_stops').get();assert.equal(row.recipient,'manager@practice.example.invalid');assert.equal(row.reason,'do_not_contact');assert.ok(!JSON.stringify(row).includes('Please do not contact'));
 assert.equal((await recordClinicCorrespondenceStops(f.env,owner)).recorded,0);
 f.db.prepare('DELETE FROM google_mail_messages').run();f.save(sent());
 await assert.rejects(getOwnedClinicFollowUpContext(f.env,owner.userId,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'},f.fetcher,f.provider),{code:'follow_up_contact_stopped_do_not_contact'});
 f.save(sent(),other,'subject-amir');const otherAccount={...account,subject:'subject-amir'};
 const own=await getOwnedClinicFollowUpContext(f.env,other.userId,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'},f.fetcher,async()=>otherAccount);assert.equal(own.googleSubject,'subject-amir');
 f.save(sent(),owner,'new-google-subject');await assert.rejects(getOwnedClinicFollowUpContext(f.env,owner.userId,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'},f.fetcher,async()=>({...account,subject:'new-google-subject'})),{code:'follow_up_contact_stopped_do_not_contact'});
 const secondary={...owner,userId:owner.userId+':secondary',rootUserId:owner.userId,mailbox:'secondary'};f.save(sent(),secondary,'secondary-subject');await assert.rejects(getOwnedClinicFollowUpContext(f.env,secondary.userId,{messageId:'sent1',threadId:'thread1',to:'manager@practice.example.invalid'},f.fetcher,async()=>({...account,subject:'secondary-subject'})),{code:'follow_up_contact_stopped_do_not_contact'});
 // No private primary body or credentials are consulted to enforce this code.
 const receipt=f.db.prepare('SELECT recipient,reason FROM clinic_correspondence_stops').get();assert.deepEqual({...receipt},{recipient:'manager@practice.example.invalid',reason:'do_not_contact'});
});
test('stop receipt recording is bounded and never downgrades a do-not-contact request',async()=>{
 const f=fixture();f.link();
 for(let i=0;i<13;i++){f.save(sent({id:'s'+i,threadId:'t'+i,to:'manager'+i+'@practice.example.invalid'}));f.save(reply('We are not currently recruiting.',{id:'r'+i,threadId:'t'+i,from:'manager'+i+'@practice.example.invalid'}));}
 const first=await recordClinicCorrespondenceStops(f.env,owner);assert.equal(first.recorded,10);assert.equal(first.more,true);const second=await recordClinicCorrespondenceStops(f.env,owner);assert.equal(second.recorded,3);assert.equal(second.more,false);
 f.save(reply('Please do not contact us again.',{id:'severe',threadId:'t0',from:'manager0@practice.example.invalid'}));await recordClinicCorrespondenceStops(f.env,owner);assert.equal(f.db.prepare("SELECT reason FROM clinic_correspondence_stops WHERE recipient='manager0@practice.example.invalid'").get().reason,'do_not_contact');
 f.db.prepare("DELETE FROM google_mail_messages WHERE gmail_id='severe'").run();await recordClinicCorrespondenceStops(f.env,owner);assert.equal(f.db.prepare("SELECT reason FROM clinic_correspondence_stops WHERE recipient='manager0@practice.example.invalid'").get().reason,'do_not_contact');
});
test('do-not-contact receipts suppress all outbound for that person and repair missing suppression independently',async()=>{
 const f=fixture();f.link();f.save(sent());f.save(reply('Please do not contact us again.'));
 await recordClinicCorrespondenceStops(f.env,owner);let suppression=f.db.prepare('SELECT owner_id,email,reason FROM mail_automation_suppressions').all();assert.equal(suppression.length,1);assert.equal(suppression[0].owner_id,owner.userId);assert.equal(suppression[0].reason,'gmail_do_not_contact');
 f.db.prepare('DELETE FROM mail_automation_suppressions').run();f.db.prepare('DELETE FROM google_mail_messages').run();const repaired=await recordClinicCorrespondenceStops(f.env,owner);assert.equal(repaired.recorded,0);suppression=f.db.prepare('SELECT owner_id,email FROM mail_automation_suppressions').all();assert.equal(suppression.length,1);assert.equal(suppression[0].email,'manager@practice.example.invalid');
 assert.equal(f.db.prepare('SELECT count(*) n FROM mail_automation_suppressions WHERE owner_id=?').get(other.userId).n,0);
});
test('background activity exposes only safe owner-scoped status and error codes',async()=>{
 const f=fixture();f.link();f.save(sent());f.mark();f.db.exec(readFileSync(new URL('../cloud/clinic-correspondence-cycle-schema.sql',import.meta.url),'utf8'));
 f.db.prepare('INSERT INTO google_mail_correspondence_activity VALUES(?,?,?,?,?,?)').run(owner.userId,account.subject,at,'blocked','gmail_rate_limited','{"private":"never expose"}');f.db.prepare('INSERT INTO google_mail_correspondence_activity VALUES(?,?,?,?,?,?)').run(other.userId,'subject-amir',at,'blocked','PRIVATE_OTHER','{}');
 const response=await handleClinicCorrespondenceRequest(new Request('https://app.example.invalid/api/google/clinic-correspondence'),f.env,owner,f.fetcher,f.provider);const data=await response.json();assert.deepEqual(data.coverage.activity,{status:'blocked',code:'gmail_rate_limited',checkedAt:at});assert.doesNotMatch(JSON.stringify(data),/never expose|PRIVATE_OTHER/);
});
