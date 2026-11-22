import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {syncClinicCorrespondence,getClinicCorrespondenceCoverage,isClinicApplicationMessage} from '../cloud/google-mail-correspondence-reader.mjs';
import {normalizeMessage} from '../cloud/google-mail.mjs';

const readScope='https://www.googleapis.com/auth/gmail.readonly',now=1795000000000;
const context={userId:'synthetic-arash',rootUserId:'synthetic-arash',profileId:'arash',mailbox:'primary'};
const raw=(id,body='I am a general practitioner seeking a GP position with Level 1 supervision.',options={})=>({id,threadId:options.threadId||'thread_'+id,internalDate:String(now-60000),labelIds:options.labels||['SENT'],payload:{mimeType:options.html?'text/html':'text/plain',headers:[{name:'From',value:options.from||'Arash <arash@example.invalid>'},{name:'To',value:options.to||'Practice Manager <clinic@example.invalid>'},{name:'Cc',value:options.cc||''},{name:'Bcc',value:options.bcc||''},{name:'Subject',value:options.subject||'GP application'},{name:'Message-ID',value:'<'+id+'@example.invalid>'}],body:{data:Buffer.from(body).toString('base64url')}}});
function fixture(){
 const db=new DatabaseSync(':memory:');for(const path of ['google-schema.sql','google-mail-schema.sql','google-mail-correspondence-schema.sql','google-mail-full-scan-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+path,import.meta.url),'utf8'));
 let queries=0;const binding={prepare(sql){return {bind(...params){const stmt=db.prepare(sql);return {async first(){queries++;return stmt.get(...params)||null;},async all(){queries++;return {results:stmt.all(...params)};},async run(){queries++;return {meta:stmt.run(...params)};}};}};}};
 for(const [owner,profile,sub] of [['synthetic-arash','arash','subject-arash'],['synthetic-amir','amir','subject-amir'],['synthetic-arash:secondary','arash','subject-arash-secondary']])db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,profile,sub,owner.replace(':','-')+'@example.invalid',JSON.stringify([readScope]),'private-cipher',now+3600000,'connected',now);
 const accessProvider=async(env,owner)=>({accessToken:'private-'+owner,email:owner.replace(':','-')+'@example.invalid',subject:owner==='synthetic-amir'?'subject-amir':owner.endsWith(':secondary')?'subject-arash-secondary':'subject-arash',scopes:[readScope]});
 const sync=(fetcher,ctx=context,options={})=>syncClinicCorrespondence({GOOGLE_DB:binding},ctx,fetcher,{now,accessProvider,...options});
 const lane=n=>db.prepare('UPDATE google_mail_full_scan SET next_lane=? WHERE owner_id=?').run(n,context.userId);
 const state=()=>db.prepare('SELECT * FROM google_mail_full_scan WHERE owner_id=?').get(context.userId);
 const cached=()=>db.prepare('SELECT owner_id,google_sub,gmail_id,data FROM google_mail_messages ORDER BY gmail_id').all();
 return {db,env:{GOOGLE_DB:binding},sync,cached,lane,state,queries:()=>queries,resetQueries:()=>{queries=0;}};
}
function provider(messages,{pageToken=null,history=null}={}){return async(url,init)=>{
 assert.equal(init.redirect,'manual');const parsed=new URL(url);
 if(parsed.pathname.endsWith('/profile'))return Response.json({historyId:'100'});
 if(parsed.pathname.endsWith('/history'))return Response.json(history||{historyId:'101',history:[]});
 if(parsed.pathname.endsWith('/messages')){assert.equal(parsed.searchParams.has('labelIds'),false);assert.equal(parsed.searchParams.get('includeSpamTrash'),'true');assert.equal(parsed.searchParams.get('q').includes('PESCI'),false);return Response.json({messages:messages.map(message=>({id:message.id})),...(pageToken?{nextPageToken:pageToken}:{})});}
 if(parsed.pathname.includes('/threads/')){const id=parsed.pathname.split('/').at(-1);return Response.json({id,messages:messages.filter(message=>message.threadId===id)});}
 const id=parsed.pathname.split('/').at(-1),message=messages.find(message=>message.id===id);return Response.json(message||{}, {status:message?200:404});
};}

test('scheduled sync advances the same cursors without aggregating the entire thread ledger',async()=>{
 const fullFixture=fixture(),scheduledFixture=fixture();
 const full=await fullFixture.sync(provider([raw('application')]));
 const scheduled=await scheduledFixture.sync(provider([raw('application')]),context,{includeCoverage:false});
 assert.equal(scheduled.status,'connected');
 assert.equal(scheduled.scannedMessageCount,full.scannedMessageCount);
 assert.equal(scheduled.archiveComplete,full.archiveComplete);
 assert.equal(scheduled.lastSyncedAt,full.lastSyncedAt);
 assert.equal(scheduled.threadCount,undefined);
 assert.equal(scheduled.readerQueries,full.readerQueries-1);
 const coverage=await getClinicCorrespondenceCoverage(scheduledFixture.env,context);
 assert.equal(coverage.threadCount,1);
 assert.equal(coverage.scannedMessageCount,1);
});

test('HTML-only normalization preserves quoted history but excludes it from current intent and link selection',()=>{
 const body='<p>Thank you. Please send your CV.</p><script>job offer</script><style>interview</style><a href="https://clinic.example.invalid/careers?a=1&amp;b=2">Current role</a><blockquote>We can offer sponsorship. <a href="https://old.example.invalid/role">Old role</a></blockquote>';
 const message=normalizeMessage(raw('htmlreply',body,{labels:['INBOX'],html:true,cc:'second@example.invalid',bcc:'third@example.invalid'}));
 assert.match(message.plainBody,/Please send your CV/);assert.match(message.plainBody,/We can offer sponsorship/);assert.equal(message.plainBody.includes('job offer'),false);assert.equal(message.plainBody.includes('<p>'),false);assert.notEqual(message.priority,'strong');assert.equal(message.bodySource,'html_as_inert_text');assert.equal(message.cc,'second@example.invalid');assert.equal(message.bcc,'third@example.invalid');
 assert.deepEqual(message.links.map(link=>[link.url,link.quoted]),[['https://clinic.example.invalid/careers?a=1&b=2',false],['https://old.example.invalid/role',true]]);
});
test('text attachments and forwarded parts cannot override the current HTML reply or provide links',()=>{
 const base=raw('multipart','',{labels:['INBOX']});base.payload={...base.payload,mimeType:'multipart/mixed',parts:[{mimeType:'text/html',body:{data:Buffer.from('<p>We cannot offer supervision.</p><a href="javascript:alert(1)">Bad</a><a href="https://user:pass@evil.invalid">Bad</a>').toString('base64url')}},{mimeType:'text/plain',filename:'attached-cv.txt',body:{data:Buffer.from('offer of employment; https://attachment.example.invalid').toString('base64url')}},{mimeType:'message/rfc822',parts:[{mimeType:'text/plain',body:{data:Buffer.from('job offer').toString('base64url')}}]}]};
 const message=normalizeMessage(base);assert.match(message.plainBody,/We cannot offer supervision/);assert.equal(message.priority,'weak');assert.equal(message.plainBody.includes('offer of employment'),false);assert.deepEqual(message.links,[]);
});
test('malformed HTML scans forward, excludes attributes and unclosed scripts, and marks body limits',()=>{
 const html='<p>Thank you for writing.</p><img alt="job offer > sponsorship is available"><script>'+Array(10000).fill('<script>').join('');
 const message=normalizeMessage(raw('malformed',html,{html:true,labels:['INBOX']}));assert.equal(message.plainBody,'Thank you for writing.');assert.equal(message.priority,'weak');assert.equal(message.bodyTruncated,true);
 assert.equal(normalizeMessage(raw('broken','Thank you.'+'<'.repeat(32768),{html:true,labels:['INBOX']})).plainBody,'Thank you.');
 assert.equal(normalizeMessage(raw('wrongclose','<p>Thank you.</p><script>code</scripted>job offer',{html:true,labels:['INBOX']})).plainBody,'Thank you.');
});
test('bounded body and link analysis is explicit rather than silently called a complete reading',()=>{
 const huge=normalizeMessage(raw('huge','x'.repeat(50000)));assert.equal(huge.bodyTruncated,true);assert.equal(huge.bodyAnalysisByteLimit,32768);assert.ok(new TextEncoder().encode(huge.plainBody).length<=32768);
 const html=Array.from({length:90},(_,i)=>'<a href="https://clinic.example.invalid/role/'+i+'">Role '+i+'</a>').join('');const many=normalizeMessage(raw('many',html,{html:true}));assert.equal(many.links.length,80);assert.equal(many.linksTruncated,true);
});
test('all Sent/received/archive/Spam/Trash messages are read; ignored labels cannot produce actionable cache entries',async()=>{
 const f=fixture(),messages=[raw('gp'),raw('incoming','A general practitioner job in Australia is available.',{labels:['INBOX']}),raw('personal','Coffee this weekend?',{subject:'Hello',labels:[]}),raw('spam','General practitioner job in Australia',{labels:['SPAM']}),raw('trash','General practitioner job in Australia',{labels:['TRASH']}),raw('draft','GP application',{labels:['DRAFT']})],seen=[];
 const result=await f.sync(provider(messages),context,{onMessages:async(values,ctx,identity)=>{assert.equal(ctx.userId,context.userId);assert.equal(identity.subject,'subject-arash');assert.equal(identity.source,'archive');seen.push(...values);}});
 assert.equal(result.scannedThisRun,6);assert.equal(result.scannedMessageCount,6);assert.equal(result.scannedSentCount,1);assert.equal(result.scannedReceivedCount,4);assert.equal(result.archiveComplete,true);assert.equal(result.fullReadingComplete,false);assert.equal(result.coverage,'all_mail_progressive_related_threads');assert.equal(seen.length,6);assert.deepEqual(f.cached().map(row=>row.gmail_id),['gp','incoming']);assert.equal(result.ignoredLabelCount,3);assert.equal(result.automaticSending,false);assert.ok(result.readerQueries<=20);
 assert.equal(isClinicApplicationMessage({...normalizeMessage(raw('x')),to:'',cc:'',bcc:''}),false);
});
test('irrelevant messages reach the authorized classifier ephemerally and their bodies are never retained',async()=>{
 const f=fixture(),body='SYNTHETIC PERSONAL BODY',seen=[];await f.sync(provider([raw('private',body,{labels:['INBOX'],subject:'Weekend'})]),context,{onMessages:async messages=>seen.push(...messages)});
 assert.equal(seen[0].plainBody,body);assert.equal(f.cached().length,0);assert.equal(JSON.stringify(f.state()).includes(body),false);
});
test('full archive cursor resumes all pending IDs and has no fixed first-N coverage window',async()=>{
 const f=fixture(),messages=Array.from({length:20},(_,i)=>raw('m'+i));let lists=0;const fetcher=async(url,init)=>{if(new URL(url).pathname.endsWith('/messages'))lists++;return provider(messages,{pageToken:'next-page'})(url,init);};
 const first=await f.sync(fetcher);assert.equal(first.scannedThisRun,8);assert.equal(first.pendingMessageCount,12);assert.equal(first.providerReads,10);assert.equal(lists,1);assert.ok(first.readerQueries<=20);
 f.lane(0);const next=await f.sync(fetcher);assert.equal(next.scannedThisRun,8);assert.equal(next.pendingMessageCount,4);assert.equal(lists,1);
 f.lane(0);const third=await f.sync(fetcher);assert.equal(third.scannedThisRun,4);assert.equal(third.pendingMessageCount,0);assert.equal(third.archiveComplete,false);assert.equal(third.scannedMessageCount,20);
 f.lane(0);const final=await f.sync(provider([raw('m20')]));assert.equal(final.archiveComplete,true);assert.equal(final.scannedMessageCount,21);
});
test('new received LinkedIn alerts are processed by history while a large archive remains incomplete',async()=>{
 const f=fixture(),old=Array.from({length:20},(_,i)=>raw('old'+i));await f.sync(provider(old,{pageToken:'next-page'}));
 const alert=raw('newalert','General Practitioner jobs in Queensland, Australia. https://www.linkedin.com/jobs/view/12345',{labels:['INBOX'],from:'jobs-noreply@linkedin.com',subject:'Jobs you may be interested in'}),seen=[];
 const result=await f.sync(provider([alert],{history:{historyId:'200',history:[{messagesAdded:[{message:{id:alert.id}}]}]}}),context,{onMessages:async(messages,ctx,identity)=>seen.push(...messages.map(message=>({id:message.id,source:identity.source})))});
 assert.equal(result.lane,'history');assert.equal(result.archiveComplete,false);assert.equal(result.pendingMessageCount,12);assert.equal(result.historyCaughtUp,true);assert.deepEqual(seen,[{id:'newalert',source:'history'}]);assert.equal(f.state().history_id,'200');assert.ok(f.cached().some(row=>row.gmail_id==='newalert'));
});
test('a large history page is drained durably before its watermark advances',async()=>{
 const f=fixture();await f.sync(provider([]));const messages=Array.from({length:27},(_,i)=>raw('h'+i,'General practitioner job in Australia',{labels:['INBOX']}));let historyReads=0;const observed=[];
 const fetcher=async(url,init)=>{if(new URL(url).pathname.endsWith('/history'))historyReads++;return provider(messages,{history:{historyId:'500',history:[{messagesAdded:messages.map(message=>({message:{id:message.id}}))}]}})(url,init);};
 const options={onMessages:async messages=>observed.push(...messages.map(message=>message.id))};
 const first=await f.sync(fetcher,context,options);assert.equal(first.historyPendingCount,19);assert.equal(f.state().history_id,'100');assert.equal(first.historyCaughtUp,false);
 for(let i=0;i<3;i++){f.lane(1);await f.sync(fetcher,context,options);}
 assert.equal(f.state().history_id,'500');assert.equal(f.state().history_caught_up,1);assert.equal(historyReads,1);assert.equal(new Set(observed).size,27);assert.equal(observed.length,27);
});
test('history pagination keeps the original watermark until all pages are processed',async()=>{
 const f=fixture();await f.sync(provider([]));const one=raw('h1','GP job in Australia',{labels:['INBOX']}),two=raw('h2','GP job in Australia',{labels:['INBOX']});let pages=0;
 const fetcher=async(url,init)=>{if(new URL(url).pathname.endsWith('/history')){pages++;const second=new URL(url).searchParams.get('pageToken')==='history-next';return Response.json({historyId:second?'300':'200',...(second?{}:{nextPageToken:'history-next'}),history:[{messagesAdded:[{message:{id:second?'h2':'h1'}}]}]});}return provider([one,two])(url,init);};
 await f.sync(fetcher);assert.equal(f.state().history_id,'100');f.lane(1);await f.sync(fetcher);assert.equal(f.state().history_id,'300');assert.equal(pages,2);
});
test('deletion and Spam/Trash label changes invalidate cached content and reach owner-scoped callbacks',async()=>{
 const f=fixture(),one=raw('one'),two=raw('two');await f.sync(provider([one,two]));const gone=[],observed=[];
 const trash={...one,labelIds:['SENT','TRASH']};const fetcher=provider([trash],{history:{historyId:'200',history:[{messagesDeleted:[{message:{id:'two'}}],labelsAdded:[{message:{id:'one'},labelIds:['TRASH']}]}]}});
 const result=await f.sync(fetcher,context,{onMessages:async messages=>observed.push(...messages),onDeleted:async(ids,ctx,identity)=>{assert.equal(ctx.userId,context.userId);assert.equal(identity.subject,'subject-arash');gone.push(...ids);}});
 assert.deepEqual(gone,['two']);assert.equal(observed[0].labels.includes('TRASH'),true);assert.equal(f.cached().length,0);assert.equal(result.historyCaughtUp,true);
});
test('classifier failure leaves the exact pending archive batch available for an idempotent retry',async()=>{
 const f=fixture(),messages=Array.from({length:10},(_,i)=>raw('m'+i));let fail=true,lists=0;const seen=new Set();
 const fetcher=async(url,init)=>{if(new URL(url).pathname.endsWith('/messages'))lists++;return provider(messages)(url,init);};
 const callback=async values=>{for(const value of values)seen.add(value.id);if(fail){fail=false;throw Error('PRIVATE FAILURE');}};
 await assert.rejects(f.sync(fetcher,context,{onMessages:callback}));assert.equal(f.state().archive_scanned_count,0);assert.equal(JSON.parse(f.state().archive_pending_ids).length,10);assert.equal(f.cached().length,0);assert.equal(f.state().lock_until,0);
 f.lane(0);const result=await f.sync(fetcher,context,{onMessages:callback});assert.equal(result.scannedThisRun,8);assert.equal(lists,1);assert.equal(seen.size,8);
});
test('a failed deletion callback does not advance the history watermark or discard its pending tombstone',async()=>{
 const f=fixture();await f.sync(provider([]));let fail=true,historyReads=0;const fetcher=async(url,init)=>{if(new URL(url).pathname.endsWith('/history'))historyReads++;return provider([],{history:{historyId:'900',history:[{messagesDeleted:[{message:{id:'gone'}}]}]}})(url,init);};
 const onDeleted=async()=>{if(fail){fail=false;throw Error('temporary failure');}};await assert.rejects(f.sync(fetcher,context,{onDeleted}));assert.equal(f.state().history_id,'100');assert.deepEqual(JSON.parse(f.state().history_deleted_ids),['gone']);
 f.lane(1);await f.sync(fetcher,context,{onDeleted});assert.equal(f.state().history_id,'900');assert.equal(historyReads,1);
});
test('a poisoned saved archive batch cannot starve fresh history and remains available for a lossless retry',async()=>{
 const f=fixture(),old=Array.from({length:9},(_,index)=>raw('pending'+index));
 // Reproduce the live cursor shape without using any private provider IDs.
 await f.sync(provider([]));
 f.db.prepare("UPDATE google_mail_full_scan SET archive_complete=0,archive_scanned_count=91,archive_pending_ids=?,archive_page_token='next-archive-page',next_lane=0,last_error='correspondence_sync_failed' WHERE owner_id=?").run(JSON.stringify(old.map(message=>message.id)),context.userId);
 const incoming=raw('new-reply','Please arrange a call about this GP position.',{labels:['INBOX']}),seen=[];
 const onMessages=async(messages,owner,identity)=>{
  if(identity.source==='archive')throw Error('PRIVATE exception content must never be retained');
  seen.push(...messages.map(message=>message.id));
 };
 await assert.rejects(f.sync(provider(old),context,{maxProviderReads:6,onMessages}),error=>error.code==='correspondence_message_analysis_failed');
 const failed=f.state();assert.equal(failed.next_lane,1);assert.equal(failed.archive_scanned_count,91);assert.deepEqual(JSON.parse(failed.archive_pending_ids),old.map(message=>message.id));assert.equal(failed.lock_until,0);assert.equal(failed.last_error,'correspondence_message_analysis_failed');assert(!JSON.stringify(failed).includes('PRIVATE'));
 const history={historyId:'200',history:[{messagesAdded:[{message:{id:incoming.id}}]}]};
 const result=await f.sync(provider([incoming],{history}),context,{maxProviderReads:6,onMessages});
 assert.equal(result.lane,'history');assert.equal(result.historyCaughtUp,true);assert.equal(f.state().history_id,'200');assert.deepEqual(seen,[incoming.id]);assert.deepEqual(JSON.parse(f.state().archive_pending_ids),old.map(message=>message.id));
 f.lane(0);const resumed=await f.sync(provider(old),context,{maxProviderReads:6});
 assert.equal(resumed.scannedThisRun,6);assert.equal(resumed.scannedMessageCount,97);assert.deepEqual(JSON.parse(f.state().archive_pending_ids),old.slice(6).map(message=>message.id));
});
test('deletion callback failure rotates to another lane without losing its safe category or tombstone',async()=>{
 const f=fixture();await f.sync(provider([]));
 const history={historyId:'300',history:[{messagesDeleted:[{message:{id:'gone'}}]}]};
 await assert.rejects(f.sync(provider([],{history}),context,{onDeleted:async()=>{throw Error('private provider details');}}),error=>error.code==='correspondence_deletion_analysis_failed');
 assert.equal(f.state().next_lane,2);assert.equal(f.state().history_id,'100');assert.deepEqual(JSON.parse(f.state().history_deleted_ids),['gone']);assert.equal(f.state().lock_until,0);
});
test('provider failures save earlier successfully classified IDs without skipping the failed ID',async()=>{
 const f=fixture(),messages=[raw('m1'),raw('m2'),raw('m3')];let failed=true;const counts={};
 const fetcher=async(url,init)=>{const id=new URL(url).pathname.split('/').at(-1);counts[id]=(counts[id]||0)+1;if(id==='m2'&&failed){failed=false;return Response.json({}, {status:503});}return provider(messages)(url,init);};
 await assert.rejects(f.sync(fetcher),error=>error.code==='gmail_unavailable');assert.deepEqual(JSON.parse(f.state().archive_pending_ids),['m2','m3']);assert.equal(f.state().archive_scanned_count,1);assert.equal(f.state().lock_until,0);
 f.lane(0);const result=await f.sync(fetcher);assert.equal(result.scannedThisRun,2);assert.equal(counts.m1,1);assert.equal(counts.m2,2);
});
test('related thread refresh includes current replies and removes obsolete snapshot entries only after a complete read',async()=>{
 const f=fixture(),out=raw('sent'),reply=raw('reply','Please send your CV.',{labels:['INBOX'],threadId:out.threadId}),draft=raw('draft','job offer',{labels:['DRAFT'],threadId:out.threadId});
 await f.sync(provider([out]));f.lane(2);const seen=[];const result=await f.sync(provider([out,reply,draft]),context,{onMessages:async messages=>seen.push(...messages)});assert.equal(result.readThreads,1);assert.equal(result.completeThreadCount,1);assert.deepEqual(f.cached().map(row=>row.gmail_id),['reply','sent']);assert.ok(seen.some(message=>message.labels.includes('DRAFT')));
 f.lane(2);await f.sync(provider([out]),context,{now:now+16*60000});assert.deepEqual(f.cached().map(row=>row.gmail_id),['sent']);
});
test('long staged threads do not block the independent history lane',async()=>{
 const f=fixture(),out=raw('sent');await f.sync(provider([out]));const messages=[out,...Array.from({length:24},(_,i)=>raw('reply'+i,'Thank you.',{labels:['INBOX'],threadId:out.threadId}))];let threadReads=0;
 const fetcher=async(url,init)=>{if(url.includes('/threads/'))threadReads++;return provider(messages)(url,init);};
 f.lane(2);const first=await f.sync(fetcher);assert.equal(first.synced,8);assert.equal(first.pendingThreadMessageCount,17);assert.equal(first.completeThreadCount,0);
 f.lane(1);const fresh=await f.sync(fetcher);assert.equal(fresh.lane,'history');assert.equal(fresh.pendingThreadMessageCount,17);
 for(let i=0;i<3;i++){f.lane(2);await f.sync(fetcher);}assert.equal(f.state().pending_thread_id,null);assert.equal(threadReads,1);
});
test('new history in a staged thread invalidates the older snapshot before it can erase that new reply',async()=>{
 const f=fixture(),out=raw('sent');await f.sync(provider([out]));const older=[out,...Array.from({length:12},(_,i)=>raw('old'+i,'Thank you.',{labels:['INBOX'],threadId:out.threadId}))];
 f.lane(2);await f.sync(provider(older));assert.equal(JSON.parse(f.state().pending_thread_messages).length,5);
 const fresh=raw('fresh','Please arrange a call.',{labels:['INBOX'],threadId:out.threadId});f.lane(1);await f.sync(provider([fresh],{history:{historyId:'200',history:[{messagesAdded:[{message:{id:'fresh'}}]}]}}));assert.equal(f.state().pending_thread_id,null);assert.ok(f.cached().some(row=>row.gmail_id==='fresh'));
 f.lane(2);await f.sync(provider([...older,fresh]));assert.ok(f.cached().some(row=>row.gmail_id==='fresh'));
});
test('cache-only coverage isolates profiles, slots and replacement Google identities',async()=>{
 const f=fixture();await f.sync(provider([raw('arashsent')]));assert.equal((await getClinicCorrespondenceCoverage(f.env,context)).threadCount,1);
 assert.equal((await getClinicCorrespondenceCoverage(f.env,{userId:'synthetic-amir',profileId:'amir'})).threadCount,0);
 assert.equal((await getClinicCorrespondenceCoverage(f.env,{...context,userId:context.userId+':secondary',mailbox:'secondary'})).threadCount,0);
 assert.equal((await getClinicCorrespondenceCoverage(f.env,{...context,profileId:'amir'})).status,'not_connected');await assert.rejects(f.sync(provider([]),{...context,userId:'synthetic-amir'}),error=>error.code==='mailbox_owner_mismatch');
 f.db.prepare('UPDATE google_accounts SET google_sub=? WHERE owner_id=?').run('replacement-subject',context.userId);assert.equal((await getClinicCorrespondenceCoverage(f.env,context)).threadCount,0);
});
test('401 refresh retries only the rejected own GET and retains the same Google subject',async()=>{
 const f=fixture(),messages=[raw('m1'),raw('m2')];let refreshed=0,failed=false,lists=0;const auth=[];
 const accessProvider=async(env,owner,fetcher,options)=>{if(options?.forceRefresh)refreshed++;return {accessToken:refreshed?'renewed-private':'initial-private',subject:'subject-arash',scopes:[readScope]};};
 const fetcher=async(url,init)=>{auth.push(init.headers.Authorization);if(new URL(url).pathname.endsWith('/messages'))lists++;if(url.includes('/messages/m2')&&!failed){failed=true;return Response.json({}, {status:401});}return provider(messages)(url,init);};
 const result=await f.sync(fetcher,context,{accessProvider});assert.equal(result.synced,2);assert.equal(refreshed,1);assert.equal(result.providerReads,5);assert.equal(lists,1);assert.equal(auth.at(-1),'Bearer renewed-private');
});
test('subject changes, scope loss and unexpected redirects fail closed without cross-owner fallback',async()=>{
 for(const fault of ['subject','scope','redirect']){const f=fixture();let calls=0;const accessProvider=async(env,owner,fetcher,options)=>({accessToken:'private',subject:options?.forceRefresh&&fault==='subject'?'other-subject':'subject-arash',scopes:options?.forceRefresh&&fault==='scope'?[]:[readScope]});
 await assert.rejects(f.sync(async()=>{calls++;return fault==='redirect'?new Response(null,{status:302,headers:{Location:'https://evil.example.invalid'}}):Response.json({}, {status:401});},context,{accessProvider}),error=>error.code===({subject:'connection_changed',scope:'gmail_read_scope_required',redirect:'gmail_redirect_rejected'}[fault]));assert.equal(calls,1);assert.equal(f.cached().length,0);}
});
test('exhausting the read budget on the initial watermark cannot mark an unread archive complete',async()=>{
 const f=fixture();const result=await f.sync(provider([]),context,{maxProviderReads:1});assert.equal(result.providerReads,1);assert.equal(result.archiveComplete,false);assert.equal(result.fullReadingComplete,false);
});
test('history expiry preserves archive progress, marks a gap, and retains recovery until a real recovery page is read',async()=>{
 const f=fixture(),messages=Array.from({length:20},(_,i)=>raw('old'+i));await f.sync(provider(messages,{pageToken:'older-page'}));const pending=f.state().archive_pending_ids;let gaps=0;
 const fetcher=async(url,init)=>url.includes('/history?')?Response.json({}, {status:404}):provider(messages)(url,init);
 const result=await f.sync(fetcher,context,{onHistoryGap:async(ctx,identity)=>{assert.equal(ctx.userId,context.userId);assert.equal(identity.subject,'subject-arash');gaps++;}});
 assert.equal(gaps,1);assert.equal(result.historyRecoveryActive,true);assert.equal(result.historyGapRequiresReview,true);assert.equal(result.historyCaughtUp,false);assert.equal(f.state().archive_pending_ids,pending);assert.equal(f.state().archive_page_token,'older-page');
 f.lane(1);let query='';await f.sync(async(url,init)=>{if(new URL(url).pathname.endsWith('/messages')){query=new URL(url).searchParams.get('q');return Response.json({});}return provider([])(url,init);});assert.match(query,/after:/);assert.equal(f.state().history_recovery_active,0);assert.ok(f.state().history_gap_since);
});
test('oversized messages and bounded bodies are explicit partial-reading receipts and cannot poison later messages',async()=>{
 const f=fixture(),big=raw('large','x'.repeat(50000)),normal=raw('normal');const result=await f.sync(provider([big,normal]));assert.equal(result.archiveComplete,true);assert.equal(result.unreadableMessageCount,1);assert.equal(result.fullReadingComplete,false);assert.equal(f.db.prepare('SELECT code FROM google_mail_full_scan_errors').get().code,'mail_body_analysis_limited');
 const g=fixture(),fetcher=async(url,init)=>url.includes('/messages/large')?new Response('{}',{headers:{'Content-Length':'1500001'}}):provider([big,normal])(url,init);
 const outcome=await g.sync(fetcher);assert.equal(outcome.scannedThisRun,2);assert.equal(outcome.unreadableMessageCount,1);assert.ok(g.cached().some(row=>row.gmail_id==='normal'));
});
test('active leases prevent duplicate reads and expired leases permit continuation',async()=>{
 const f=fixture();f.db.prepare('INSERT INTO google_mail_full_scan(owner_id,google_sub,archive_started_at,lock_token,lock_until) VALUES (?,?,?,?,?)').run(context.userId,'subject-arash',now,'other-operation',now+60000);let reads=0;
 const fetcher=async(url,init)=>{reads++;return provider([])(url,init);};await assert.rejects(f.sync(fetcher),error=>error.code==='sync_in_progress');assert.equal(reads,0);await f.sync(fetcher,context,{now:now+120000});assert.equal(f.state().lock_until,0);
});
test('an unsupported large thread cannot poison the full archive queue',async()=>{
 const f=fixture(),sent=Array.from({length:20},(_,i)=>raw('m'+i));await f.sync(provider(sent,{pageToken:'next-page'}));f.lane(2);const id='thread_m0';
 await assert.rejects(f.sync(async()=>Response.json({id,messages:Array.from({length:501},(_,i)=>raw('oversized'+i,'GP application',{threadId:id}))})),error=>error.code==='gmail_thread_requires_manual_review');const failed=f.db.prepare('SELECT complete,last_error,last_checked_at FROM google_mail_correspondence_threads WHERE thread_id=?').get(id);assert.equal(failed.complete,0);assert.equal(failed.last_checked_at,now);
 const result=await f.sync(provider(sent));assert.equal(result.lane,'archive');assert.equal(result.scannedThisRun,8);assert.equal(result.failedThreadCount,1);
});
test('fullReadingComplete requires an exhausted archive, caught-up history and no staged or unsupported work',async()=>{
 const f=fixture();const initial=await f.sync(provider([]));assert.equal(initial.archiveComplete,true);assert.equal(initial.fullReadingComplete,false);
 const current=await f.sync(provider([]));assert.equal(current.historyCaughtUp,true);assert.equal(current.fullReadingComplete,true);
 f.db.prepare('UPDATE google_mail_full_scan SET history_pending_ids=?,history_caught_up=1').run('["still_pending"]');assert.equal((await getClinicCorrespondenceCoverage(f.env,context)).fullReadingComplete,false);
});
test('a history gap triggers a full recheck even when no related correspondence threads exist',async()=>{
 const f=fixture();await f.sync(provider([]));await f.sync(async(url,init)=>url.includes('/history?')?Response.json({}, {status:404}):provider([])(url,init));assert.ok(f.state().history_gap_since);
 f.lane(1);await f.sync(provider([]));assert.equal(f.state().history_recovery_active,0);assert.ok(f.state().history_gap_since);
 f.lane(2);const rescan=await f.sync(provider([]));assert.equal(rescan.lane,'archive');assert.equal(rescan.archiveComplete,true);assert.equal(rescan.historyGapRequiresReview,false);assert.equal(rescan.fullReadingComplete,false);
 f.lane(1);const current=await f.sync(provider([]));assert.equal(current.fullReadingComplete,true);
});
test('a later complete version resolves an explicit partial-body receipt',async()=>{
 const f=fixture(),large=raw('large','GP application '+ 'x'.repeat(50000));await f.sync(provider([large]));assert.equal(f.db.prepare('SELECT count(*) n FROM google_mail_full_scan_errors').get().n,1);
 const changed=raw('large','GP application with full current body');f.lane(1);const result=await f.sync(provider([changed],{history:{historyId:'200',history:[{messagesAdded:[{message:{id:'large'}}]}]}}));assert.equal(result.unreadableMessageCount,0);assert.equal(f.db.prepare('SELECT count(*) n FROM google_mail_full_scan_errors').get().n,0);assert.ok(result.readerQueries<=20);
});
test('partial content discovered by a thread snapshot is also reported explicitly',async()=>{
 const f=fixture(),out=raw('sent');await f.sync(provider([out]));f.lane(2);const large=raw('sent','GP application '+ 'x'.repeat(50000));const result=await f.sync(provider([large]));assert.equal(result.unreadableMessageCount,1);assert.equal(result.fullReadingComplete,false);
});
test('a staged snapshot cannot purge a newer reply cached by the independent legacy inbox reader',async()=>{
 const f=fixture(),out=raw('sent');await f.sync(provider([out]));const snapshot=[out,...Array.from({length:8},(_,i)=>raw('old'+i,'Thank you.',{labels:['INBOX'],threadId:out.threadId}))];f.lane(2);await f.sync(provider(snapshot));
 const newer=normalizeMessage(raw('newer','Please arrange a call.',{labels:['INBOX'],threadId:out.threadId}));f.db.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(context.userId,'subject-arash',newer.id,newer.threadId,newer.dateTimestamp,newer.priority,JSON.stringify(newer),now+1000);
 f.lane(2);const deleted=[];await f.sync(provider(snapshot),context,{onDeleted:async ids=>deleted.push(...ids)});assert.ok(f.cached().some(message=>message.gmail_id==='newer'));assert.equal(deleted.includes('newer'),false);
});
test('an old staged message cannot overwrite newer labels on the same Gmail ID and callback age stays truthful',async()=>{
 const f=fixture(),out=raw('sent');await f.sync(provider([out]));const snapshot=[out,...Array.from({length:8},(_,i)=>raw('old'+i,'Thank you.',{labels:['INBOX'],threadId:out.threadId}))];f.lane(2);await f.sync(provider(snapshot));
 const fresh=normalizeMessage(raw('old7','Moved to trash after the snapshot.',{labels:['TRASH'],threadId:out.threadId}));f.db.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(context.userId,'subject-arash',fresh.id,fresh.threadId,fresh.dateTimestamp,fresh.priority,JSON.stringify(fresh),now+1000);
 const observed=[];f.lane(2);await f.sync(provider(snapshot),context,{now:now+60000,onMessages:async(messages,ctx,identity)=>observed.push(identity.observedAt)});const row=f.cached().find(message=>message.gmail_id==='old7');assert.equal(JSON.parse(row.data).labels.includes('TRASH'),true);assert.deepEqual(observed,[now]);
});
