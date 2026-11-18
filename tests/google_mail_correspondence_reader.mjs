import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {syncClinicCorrespondence,getClinicCorrespondenceCoverage,isClinicApplicationMessage} from '../cloud/google-mail-correspondence-reader.mjs';
import {normalizeMessage} from '../cloud/google-mail.mjs';

const readScope='https://www.googleapis.com/auth/gmail.readonly';
const context={userId:'synthetic-arash',rootUserId:'synthetic-arash',profileId:'arash',mailbox:'primary'};
const now=1795000000000;
const raw=(id,body='I am a general practitioner seeking a GP position with Level 1 supervision.',options={})=>({id,threadId:options.threadId||'thread_'+id,internalDate:String(now-60000),labelIds:options.labels||['SENT'],payload:{mimeType:options.html?'text/html':'text/plain',headers:[{name:'From',value:options.from||'Arash <arash@example.invalid>'},{name:'To',value:options.to||'Practice Manager <clinic@example.invalid>'},{name:'Cc',value:options.cc||''},{name:'Bcc',value:options.bcc||''},{name:'Subject',value:options.subject||'GP application'},{name:'Message-ID',value:'<'+id+'@example.invalid>'}],body:{data:Buffer.from(body).toString('base64url')}}});
function fixture(){
 const db=new DatabaseSync(':memory:');for(const path of ['google-schema.sql','google-mail-schema.sql','google-mail-correspondence-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+path,import.meta.url),'utf8'));
 let queries=0;
 const binding={prepare(sql){return {bind(...params){const stmt=db.prepare(sql);return {async first(){queries++;return stmt.get(...params)||null;},async all(){queries++;return {results:stmt.all(...params)};},async run(){queries++;return {meta:stmt.run(...params)};}};}};}};
 for(const [owner,profile,sub] of [['synthetic-arash','arash','subject-arash'],['synthetic-amir','amir','subject-amir'],['synthetic-arash:secondary','arash','subject-arash-secondary']])db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,profile,sub,owner.replace(':','-')+'@example.invalid',JSON.stringify([readScope]),'private-cipher',now+3600000,'connected',now);
 const accessProvider=async(env,owner)=>({accessToken:'private-'+owner,subject:owner==='synthetic-amir'?'subject-amir':owner.endsWith(':secondary')?'subject-arash-secondary':'subject-arash',scopes:[readScope]});
 const sync=(fetcher,ctx=context,options={})=>syncClinicCorrespondence({GOOGLE_DB:binding},ctx,fetcher,{now,accessProvider,...options});
 const cached=()=>db.prepare('SELECT owner_id,google_sub,gmail_id,data FROM google_mail_messages ORDER BY gmail_id').all();
 return {db,env:{GOOGLE_DB:binding},sync,cached,queries:()=>queries,resetQueries:()=>{queries=0;}};
}
function provider(messages,{pageToken=null}={}){return async(url,init)=>{assert.equal(init.redirect,'manual');const parsed=new URL(url);if(parsed.pathname.endsWith('/messages')){assert.equal(parsed.searchParams.get('labelIds'),'SENT');assert.match(parsed.searchParams.get('q'),/-in:drafts/);assert.equal(parsed.searchParams.get('q').includes('PESCI'),false);return Response.json({messages:messages.map(message=>({id:message.id})),...(pageToken?{nextPageToken:pageToken}:{})});}if(parsed.pathname.includes('/threads/')){const id=parsed.pathname.split('/').at(-1);return Response.json({id,messages:messages.filter(message=>message.threadId===id)});}return Response.json(messages.find(message=>message.id===parsed.pathname.split('/').at(-1))||{}, {status:messages.some(message=>message.id===parsed.pathname.split('/').at(-1))?200:404});};}

test('normalization reads safe HTML-only replies and preserves recipient ambiguity metadata',()=>{
 const message=normalizeMessage(raw('htmlreply','<p>Thank you. Please send your CV.</p><script>job offer</script><style>interview</style><blockquote>We can offer sponsorship.</blockquote>',{labels:['INBOX'],html:true,cc:'second@example.invalid',bcc:'third@example.invalid'}));
 assert.match(message.plainBody,/Please send your CV/);assert.equal(message.plainBody.includes('<p>'),false);assert.equal(message.plainBody.includes('job offer'),false);assert.equal(message.plainBody.includes('sponsorship'),false);assert.equal(message.bodySource,'html_as_inert_text');assert.equal(message.cc,'second@example.invalid');assert.equal(message.bcc,'third@example.invalid');assert.notEqual(message.priority,'strong');
});
test('text attachments and forwarded message parts cannot override the current HTML reply',()=>{
 const base=raw('multipart','',{labels:['INBOX']});base.payload={...base.payload,mimeType:'multipart/mixed',parts:[{mimeType:'text/html',body:{data:Buffer.from('<p>We cannot offer supervision.</p>').toString('base64url')}},{mimeType:'text/plain',filename:'attached-cv.txt',body:{data:Buffer.from('offer of employment; sponsorship is available').toString('base64url')}},{mimeType:'text/plain',headers:[{name:'Content-Disposition',value:'attachment'}],body:{data:Buffer.from('Please schedule an interview').toString('base64url')}},{mimeType:'message/rfc822',parts:[{mimeType:'text/plain',body:{data:Buffer.from('job offer').toString('base64url')}}]}]};
 const message=normalizeMessage(base);assert.equal(message.plainBody,'We cannot offer supervision.');assert.equal(message.priority,'weak');assert.equal(message.bodySource,'html_as_inert_text');
});
test('malformed repeated HTML tags are bounded and attributes or unclosed scripts do not become employer intent',()=>{
 const html='<p>Thank you for writing.</p><img alt="job offer > sponsorship is available"><script>'+Array(10000).fill('<script>').join('');
 const message=normalizeMessage(raw('malformed',html,{html:true,labels:['INBOX']}));assert.equal(message.plainBody,'Thank you for writing.');assert.equal(message.priority,'weak');assert.ok(new TextEncoder().encode(message.plainBody).length<=32768);
 const broken=normalizeMessage(raw('broken','Thank you.'+'<'.repeat(32768),{html:true,labels:['INBOX']}));assert.equal(broken.plainBody,'Thank you.');
 const wrongClose=normalizeMessage(raw('wrongclose','<p>Thank you.</p><script>code</scripted>job offer',{html:true,labels:['INBOX']}));assert.equal(wrongClose.plainBody,'Thank you.');
});
test('the full Sent scan retains only application/enquiry candidates and never labels a Sent pitch as employer intent',async()=>{
 const f=fixture(),messages=[raw('gp1'),raw('personal','Let us meet for coffee',{subject:'Weekend',to:'friend@example.invalid'}),raw('patient','Please review this patient record',{subject:'Clinical referral'}),raw('draft','GP position',{labels:['SENT','DRAFT']})];
 const result=await f.sync(provider(messages));assert.equal(result.scannedThisRun,4);assert.equal(result.matchedThisRun,1);assert.equal(result.backfillComplete,true);assert.equal(result.coverage,'all_sent_progressive_related_threads');assert.equal(result.automaticSending,false);assert.equal(f.cached().length,1);assert.equal(JSON.parse(f.cached()[0].data).priority,'weak');assert.ok(f.queries()<=25);
 const withoutRecipient={...normalizeMessage(raw('x')),to:'',cc:'',bcc:''};assert.equal(isClinicApplicationMessage(withoutRecipient),false);
});
test('all-Sent pagination is progressive, within provider/query budgets, and resumes pending IDs without re-listing',async()=>{
 const f=fixture(),messages=Array.from({length:20},(_,i)=>raw('m'+i));let lists=0;
 const fetcher=async(url,init)=>{if(new URL(url).pathname.endsWith('/messages'))lists++;return provider(messages,{pageToken:'next-private-page'})(url,init);};
 const first=await f.sync(fetcher);assert.equal(first.scannedThisRun,10);assert.equal(first.pendingSentCount,10);assert.equal(first.providerReads,11);assert.equal(lists,1);assert.ok(f.queries()<=25);
 // Process an employer thread between Sent chunks, then resume that same page.
 await f.sync(fetcher);f.resetQueries();const next=await f.sync(fetcher);assert.equal(next.scannedThisRun,10);assert.equal(next.pendingSentCount,0);assert.equal(next.providerReads,10);assert.equal(lists,1);assert.equal(next.backfillComplete,false);assert.ok(f.queries()<=25);
});
test('a provider failure saves already read IDs and releases its lease without skipping the failed ID',async()=>{
 const f=fixture(),messages=[raw('m1'),raw('m2'),raw('m3')];let failed=true;
 const fetcher=async(url,init)=>{if(url.includes('/messages/m2')&&failed){failed=false;return Response.json({error:'PRIVATE'},{status:503});}return provider(messages)(url,init);};
 await assert.rejects(f.sync(fetcher),error=>error.code==='gmail_unavailable');let state=f.db.prepare('SELECT pending_sent_ids,scanned_count,lock_until FROM google_mail_correspondence_scan').get();assert.deepEqual(JSON.parse(state.pending_sent_ids),['m2','m3']);assert.equal(state.scanned_count,1);assert.equal(state.lock_until,0);assert.equal(f.cached().length,1);
 const next=await f.sync(fetcher);assert.equal(next.scannedThisRun,2);assert.equal(next.backfillComplete,true);
});
test('related threads include replies, discard draft/trash messages, and update old snapshots after deletion',async()=>{
 const f=fixture(),out=raw('sent'),reply=raw('reply','Please send us your CV and availability.',{labels:['INBOX'],from:'clinic@example.invalid',to:'arash@example.invalid',threadId:out.threadId}),draft=raw('draft','job offer',{labels:['DRAFT'],threadId:out.threadId});
 await f.sync(provider([out]));let payload=[out,reply,draft];const fetcher=async(url,init)=>url.includes('/threads/')?Response.json({id:out.threadId,messages:payload}):provider([out])(url,init);
 const result=await f.sync(fetcher);assert.equal(result.readThreads,1);assert.equal(result.completeThreadCount,1);assert.deepEqual(f.cached().map(row=>row.gmail_id),['reply','sent']);
 payload=[out];await f.sync(fetcher,context,{now:now+16*60000});await f.sync(fetcher,context,{now:now+16*60000});assert.deepEqual(f.cached().map(row=>row.gmail_id),['sent']);
});
test('long thread snapshots stay incomplete until their final staged messages are cached',async()=>{
 const f=fixture(),out=raw('sent');await f.sync(provider([out]));f.resetQueries();const messages=[out,...Array.from({length:24},(_,i)=>raw('reply'+i,'Thank you.',{labels:['INBOX'],threadId:out.threadId}))];let reads=0;
 const fetcher=async()=>{reads++;return Response.json({id:out.threadId,messages});};
 const first=await f.sync(fetcher);assert.equal(first.synced,10);assert.equal(first.pendingThreadMessageCount,15);assert.equal(first.completeThreadCount,0);assert.ok(f.queries()<=25);f.resetQueries();
 const second=await f.sync(fetcher);assert.equal(second.synced,10);assert.equal(second.pendingThreadMessageCount,5);assert.equal(second.completeThreadCount,0);assert.ok(f.queries()<=25);
 const third=await f.sync(fetcher);assert.equal(third.synced,5);assert.equal(third.pendingThreadMessageCount,0);assert.equal(third.completeThreadCount,1);assert.equal(reads,1);
});
test('cache-only coverage cannot expose another profile, mailbox slot or replaced Google subject',async()=>{
 const f=fixture();await f.sync(provider([raw('arashsent')]));
 const own=await getClinicCorrespondenceCoverage(f.env,context);assert.equal(own.threadCount,1);
 const other=await getClinicCorrespondenceCoverage(f.env,{userId:'synthetic-amir',profileId:'amir'});assert.equal(other.threadCount,0);
 const second=await getClinicCorrespondenceCoverage(f.env,{...context,userId:context.userId+':secondary',mailbox:'secondary'});assert.equal(second.threadCount,0);
 assert.equal((await getClinicCorrespondenceCoverage(f.env,{...context,profileId:'amir'})).status,'not_connected');
 await assert.rejects(f.sync(provider([]),{...context,userId:'synthetic-amir'}),error=>error.code==='mailbox_owner_mismatch');
 f.db.prepare('UPDATE google_accounts SET google_sub=? WHERE owner_id=?').run('replacement-subject',context.userId);assert.equal((await getClinicCorrespondenceCoverage(f.env,context)).threadCount,0);
});
test('rejected Gmail GET refreshes once, stays on the same subject, and never replays earlier Sent reads',async()=>{
 const f=fixture(),messages=[raw('m1'),raw('m2')];let refreshed=0,failed=false,lists=0;const auth=[];
 const accessProvider=async(env,owner,fetcher,options)=>{if(options?.forceRefresh)refreshed++;return {accessToken:refreshed?'renewed-private':'initial-private',subject:'subject-arash',scopes:[readScope]};};
 const fetcher=async(url,init)=>{auth.push(init.headers.Authorization);if(new URL(url).pathname.endsWith('/messages'))lists++;if(url.includes('/messages/m2')&&!failed){failed=true;return Response.json({}, {status:401});}return provider(messages)(url,init);};
 const result=await f.sync(fetcher,context,{accessProvider});assert.equal(result.synced,2);assert.equal(refreshed,1);assert.equal(result.providerReads,4);assert.equal(lists,1);assert.equal(auth.at(-1),'Bearer renewed-private');
});
test('subject changes, scope removal and unexpected redirects stop reads without cross-owner fallback',async()=>{
 for(const fault of ['subject','scope','redirect']){
  const f=fixture();let calls=0;
  const accessProvider=async(env,owner,fetcher,options)=>({accessToken:'private',subject:options?.forceRefresh&&fault==='subject'?'other-subject':'subject-arash',scopes:options?.forceRefresh&&fault==='scope'?[]:[readScope]});
  await assert.rejects(f.sync(async()=>{calls++;return fault==='redirect'?new Response(null,{status:302,headers:{Location:'https://evil.example.invalid'}}):Response.json({}, {status:401});},context,{accessProvider}),error=>error.code===({subject:'connection_changed',scope:'gmail_read_scope_required',redirect:'gmail_redirect_rejected'}[fault]));assert.equal(calls,1);assert.equal(f.cached().length,0);
 }
});
test('a completed Sent archive starts only a recent overlap scan after its cadence, while preserving historic completion',async()=>{
 const f=fixture();await f.sync(provider([]));let q='';const fetcher=async url=>{q=new URL(url).searchParams.get('q');return Response.json({});};
 const early=await f.sync(fetcher,context,{now:now+5*60000});assert.equal(early.providerReads,0);assert.equal(early.backfillComplete,true);
 const due=await f.sync(fetcher,context,{now:now+16*60000});assert.match(q,/after:/);assert.equal(due.backfillComplete,true);assert.equal(due.providerReads,1);
});
test('a live reader lease prevents duplicate provider reads and an expired lease resumes safely',async()=>{
 const f=fixture();f.db.prepare('INSERT INTO google_mail_correspondence_scan(owner_id,google_sub,scan_started_at,lock_token,lock_until) VALUES (?,?,?,?,?)').run(context.userId,'subject-arash',now,'other-operation',now+60000);let reads=0;
 const fetcher=async()=>{reads++;return Response.json({});};await assert.rejects(f.sync(fetcher),error=>error.code==='sync_in_progress');assert.equal(reads,0);
 await f.sync(fetcher,context,{now:now+120000});assert.equal(reads,1);assert.equal(f.db.prepare('SELECT lock_until FROM google_mail_correspondence_scan').get().lock_until,0);
});
test('a failed thread read keeps old content and is deferred so another clinic thread can progress',async()=>{
 const f=fixture(),one=raw('one'),two=raw('two');await f.sync(provider([one,two]));
 const fetcher=async(url,init)=>url.includes('/threads/'+one.threadId)?Response.json({}, {status:503}):provider([one,two])(url,init);
 await assert.rejects(f.sync(fetcher),error=>error.code==='gmail_unavailable');assert.equal(f.cached().length,2);assert.equal(f.db.prepare('SELECT complete,last_error FROM google_mail_correspondence_threads WHERE thread_id=?').get(one.threadId).last_error,'gmail_unavailable');
 const result=await f.sync(fetcher);assert.equal(result.readThreads,1);assert.equal(result.completeThreadCount,1);assert.equal(result.failedThreadCount,1);
});
test('a thread beyond the supported message cap cannot poison the Sent queue',async()=>{
 const f=fixture(),sent=Array.from({length:20},(_,i)=>raw('m'+i));await f.sync(provider(sent,{pageToken:'next-page'}));
 const id='thread_m0';await assert.rejects(f.sync(async()=>Response.json({id,messages:Array.from({length:501},(_,i)=>raw('oversized'+i,'GP application',{threadId:id}))})),error=>error.code==='gmail_thread_requires_manual_review');
 const failed=f.db.prepare('SELECT complete,last_error,last_checked_at FROM google_mail_correspondence_threads WHERE thread_id=?').get(id);assert.equal(failed.complete,0);assert.equal(failed.last_error,'gmail_thread_requires_manual_review');assert.equal(failed.last_checked_at,now);
 const result=await f.sync(provider(sent));assert.equal(result.scannedThisRun,10);assert.equal(result.pendingSentCount,0);assert.equal(result.failedThreadCount,1);
});
