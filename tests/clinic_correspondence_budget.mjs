import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runCorrespondenceMailCycle} from '../cloud/clinic-correspondence-cycle.mjs';
import {handleGoogleSendRequest} from '../cloud/google-send.mjs';
import {encryptGoogleSecret} from '../cloud/google-oauth.mjs';
import {normalizeMessage} from '../cloud/google-mail.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const origin='https://immi-arash-amir.dr-gerami-md.workers.dev';
const scopes=['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'];
function rawMessage(id,at=Date.now()-9*86400000){return {id,threadId:'thread_'+id,internalDate:String(at),labelIds:['SENT'],payload:{mimeType:'text/plain',headers:[{name:'From',value:'arash@example.invalid'},{name:'To',value:id+'@clinic.example.invalid'},{name:'Subject',value:'GP application'},{name:'Message-ID',value:'<'+id+'@example.invalid>'}],body:{data:Buffer.from('I am applying for a general practitioner job position with appropriate Level 1 supervision.').toString('base64url')}}};}
async function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['google-schema.sql','google-mail-schema.sql','google-mail-correspondence-schema.sql','google-mail-full-scan-schema.sql','mail-opportunities-schema.sql','clinic-correspondence-batch-schema.sql','clinic-correspondence-cycle-schema.sql','clinic-correspondence-stops-schema.sql','google-send-schema.sql','mail-automation-schema.sql','mail-automation-scheduler-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 const counts={queries:0,http:0,gmail:0,tokens:0,sends:0};
 function statement(sql,args=[]){return {bind(...values){assert(values.length<=100,'D1 binding limit');return statement(sql,values);},async first(){counts.queries++;return db.prepare(sql).get(...args)||null;},async all(){counts.queries++;return {results:db.prepare(sql).all(...args)};},async run(){counts.queries++;return {meta:db.prepare(sql).run(...args)};}};}
 const env={GOOGLE_DB:{prepare:sql=>statement(sql)},OPPORTUNITY_DB:{},GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_KEY:Buffer.alloc(32,1).toString('base64'),GOOGLE_REDIRECT_URI:origin+'/api/google/callback',MAIL_SCHEDULER_ENABLED:'true',MAIL_CORRESPONDENCE_ENABLED:'true',AUTOMATION_MEMBERSHIP_KEY:'s'.repeat(40),SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'};
 const state={rejectNextGmail:true,rejectEachThread:false,rejectedThreads:new Set(),currentToken:'synthetic-initial',threadMessages:null};
 const cipher=await encryptGoogleSecret(env,owner,{access_token:state.currentToken,refresh_token:'synthetic-refresh'});
 db.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,'arash','synthetic-sub','arash@example.invalid',JSON.stringify(scopes),cipher,0,'connected',Date.now());
 const fetcher=async(url,options={})=>{
  counts.http++;
  if(url.includes('/rpc/'))return Response.json(true);
  if(url.includes('/token')){counts.tokens++;state.currentToken='synthetic-refreshed-'+counts.tokens;return Response.json({access_token:state.currentToken,expires_in:3600,scope:scopes.join(' ')});}
  if(!url.startsWith('https://gmail.googleapis.com/'))throw Error('Unexpected provider route');
  counts.gmail++;const parsed=new URL(url);
  if(parsed.pathname.endsWith('/messages/send')){counts.sends++;assert.equal(options.headers.Authorization,'Bearer '+state.currentToken,'send must use a grant refreshed during its live follow-up check');return Response.json({id:'ack-'+counts.sends});}
  if(state.rejectEachThread&&parsed.pathname.includes('/threads/')&&!state.rejectedThreads.has(parsed.pathname)){state.rejectedThreads.add(parsed.pathname);return Response.json({},{status:401});}
  if(state.rejectNextGmail){state.rejectNextGmail=false;return Response.json({},{status:401});}
  if(parsed.pathname.endsWith('/profile'))return Response.json({historyId:'100'});
  if(parsed.pathname.endsWith('/history'))return Response.json({historyId:'101',history:[]});
  if(parsed.pathname.endsWith('/messages'))return Response.json(Number(parsed.searchParams.get('maxResults'))>1?{messages:Array.from({length:20},(_,i)=>({id:'sent'+i})),nextPageToken:'synthetic-next-page'}:{messages:[]});
  if(parsed.pathname.includes('/threads/')){const threadId=parsed.pathname.split('/').at(-1);return Response.json({id:threadId,messages:state.threadMessages||[rawMessage(threadId.replace(/^thread_/,''))]});}
  return Response.json(rawMessage(parsed.pathname.split('/').at(-1)));
 };
 const context={userId:owner,rootUserId:owner,profileId:'arash',mailbox:'primary',rest:async(table,query)=>table==='immi_clinics'?[1,2,3].map(i=>({id:'cl_'+String(i).padStart(20,'0'),data:{email:'normal'+i+'@clinic.example.invalid'}})).filter(row=>query.includes(row.id)):[]};
 const cache=raw=>{const message=normalizeMessage(raw);db.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(owner,'synthetic-sub',message.id,message.threadId,message.dateTimestamp,message.priority,JSON.stringify(message),Date.now());};
 const reset=()=>{for(const key of Object.keys(counts))counts[key]=0;};
 const call=async(path,body)=>handleGoogleSendRequest(new Request(origin+'/api/google/mail/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),env,context,fetcher);
 return {db,env,fetcher,state,counts,cache,reset,call};
}

for(const lane of ['archive','long_thread'])test('free-tier invocation counts include real token refresh and membership paths: '+lane,async()=>{
 const f=await fixture();
 if(lane==='long_thread'){const original=rawMessage('sent0');f.cache(original);const at=Date.now();f.db.prepare('INSERT INTO google_mail_correspondence_threads(owner_id,google_sub,thread_id,discovered_at) VALUES(?,?,?,?)').run(owner,'synthetic-sub',original.threadId,at);f.db.prepare('INSERT INTO google_mail_full_scan(owner_id,google_sub,archive_started_at,history_id,next_lane) VALUES(?,?,?,?,2)').run(owner,'synthetic-sub',at,'100');f.state.threadMessages=Array.from({length:30},(_,i)=>({...rawMessage('sent'+i),threadId:original.threadId}));}
 const result=await runCorrespondenceMailCycle(f.env,{now:Date.now(),fetcher:f.fetcher});
 assert.equal(result.mail.idle,true);assert.equal(result.correspondence.status,'connected');assert(result.correspondence.synced>0&&result.correspondence.synced<=8);
 assert.equal(f.counts.tokens,2,'expired grant plus rejected Gmail GET exercise both refresh paths');assert.equal(f.counts.sends,0);
 assert(f.counts.queries<=50,JSON.stringify(f.counts));assert(f.counts.queries+f.counts.http<=50,JSON.stringify(f.counts));
 if(lane==='archive'){assert(result.correspondence.scannedThisRun>0&&result.correspondence.scannedThisRun<=8);assert(f.counts.gmail<=8);}
 else assert(result.correspondence.pendingThreadMessageCount>0);
});

test('two explicit follow-ups stay within limits including router overhead and use refreshed credentials',async()=>{
 const f=await fixture();f.state.rejectNextGmail=false;
 const ids=[];
 for(const id of ['application1','application2']){
  const raw=rawMessage(id);f.cache(raw);
  const response=await f.call('queue',{followUpContext:{messageId:id,threadId:raw.threadId,to:id+'@clinic.example.invalid'},subject:'Re: GP application',body:'Synthetic reviewed follow-up; this test sends no real mail.'});
  assert.equal(response.status,201);ids.push(...(await response.json()).items.map(item=>item.id));
 }
 assert.equal(ids.length,2);
 f.db.prepare('UPDATE google_accounts SET expires_at=0 WHERE owner_id=?').run(owner);f.state.rejectNextGmail=false;f.state.rejectEachThread=true;f.reset();
 const dispatched=await f.call('dispatch',{ids});assert.equal(dispatched.status,200);const result=await dispatched.json();
 assert.deepEqual(result.items.map(item=>item.status),Array(2).fill('sent'));assert.equal(f.counts.sends,2);assert.equal(f.counts.tokens,3,'initial expired grant and one rejected GET in each follow-up');
 // Auth /auth/v1/user and fresh membership GET occur outside this adapter.
 const routerRequests=2;
 assert(f.counts.queries<=50,JSON.stringify(f.counts));assert(f.counts.queries+f.counts.http+routerRequests<=50,JSON.stringify(f.counts));
});

test('mixed batches larger than two containing a follow-up are rejected before any Gmail transport',async()=>{
 const f=await fixture();f.state.rejectNextGmail=false;const raw=rawMessage('mixedapplication');f.cache(raw);
 const followUp=await f.call('queue',{followUpContext:{messageId:raw.id,threadId:raw.threadId,to:raw.id+'@clinic.example.invalid'},subject:'Re: GP application',body:'Synthetic reviewed follow-up.'});assert.equal(followUp.status,201);
 const normal=await f.call('queue',{clinicIds:[1,2,3].map(i=>'cl_'+String(i).padStart(20,'0')),subject:'GP application',body:'Synthetic reviewed application.'});assert.equal(normal.status,201);
 const ids=[...(await followUp.json()).items,...(await normal.json()).items].map(item=>item.id);assert.equal(ids.length,4);f.reset();
 const result=await f.call('dispatch',{ids});assert.equal(result.status,400);assert.equal(f.counts.sends,0);assert.equal(f.db.prepare("SELECT count(*) n FROM google_send_queue WHERE status<>'queued'").get().n,0);
});
