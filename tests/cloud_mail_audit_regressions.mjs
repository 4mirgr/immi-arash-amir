import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {rankMessage,handleGoogleMailRequest,refreshCachedReplyRank} from '../cloud/google-mail.mjs';
import {prepareRecipientBatch,sendRecipientBatch} from '../src/opportunity-recipient-batch.mjs';
const opportunityId='opp_'+'a'.repeat(32),presetId='11111111-1111-4111-8111-111111111111',cvVersionId='22222222-2222-4222-8222-222222222222',queueId='33333333-3333-4333-8333-333333333333';
function fixture(changeAt){
 let alive=true,statusCalls=0;const calls=[];
 const isActive=()=>alive;
 const api=async(path,options={})=>{
  calls.push(path);const body=JSON.parse(options.body||'{}');
  if(path.includes('/preview'))return{opportunityId,presetId,cvVersionId,mailbox:'primary',sender:'owner@example.invalid',reviewHash:'synthetic-review',message:{subject:'Synthetic application',body:'Synthetic reviewed body'},recipients:[{recipient:body.recipient,cvVersionId,attachmentName:'synthetic-cv.docx',subject:'Synthetic application',status:'preview'}],excluded:[],dailyLimit:20,reservedToday:0};
  if(path.startsWith('google/status')){statusCalls++;if(changeAt==='preflight'&&statusCalls===1||changeAt==='pre_dispatch'&&statusCalls===2)alive=false;return{connected:true,email:'owner@example.invalid',capabilities:{gmailSend:true}};}
  if(path.includes('/queue')){if(changeAt==='queue'||changeAt==='queue_error')alive=false;if(changeAt==='queue_error')throw Object.assign(Error('request_failed'),{status:503});return{opportunityId,mailbox:'primary',items:[{id:queueId,recipient:body.recipient,sender:'owner@example.invalid',cvVersionId,subject:'Synthetic application',attachmentName:'synthetic-cv.docx',status:'queued',reused:false}],excluded:[]};}
  if(path.startsWith('google/mail/dispatch')){if(changeAt==='dispatch')alive=false;return{items:[{id:queueId,status:'sent'}]};}
  throw Error('unexpected synthetic request');
 };
 return{api,isActive,calls};
}
async function run(changeAt,person='arash'){
 const f=fixture(changeAt),prepared=await prepareRecipientBatch({api:f.api,person,plans:[{opportunityId,presetId,cvVersionId,mailbox:'primary',recipients:['one@example.invalid','two@example.invalid']}]});
 const result=await sendRecipientBatch({api:f.api,person,prepared,isActive:f.isActive,confirmReviewed:true});
 await assert.rejects(sendRecipientBatch({api:f.api,person,prepared,confirmReviewed:true}),/batch_already_consumed/);
 return{...f,result};
}
test('a lost owner context while queue creation is in flight is uncertain, never cancelled',async()=>{
 for(const kind of ['queue','queue_error'])for(const person of ['arash','amir']){const f=await run(kind,person);assert.equal(f.result.items[0].status,'queue_unknown');assert.equal(f.result.unknown,true);assert.equal(f.result.stopped,true);assert.equal(f.result.items[1].status,'not_attempted');assert(!f.calls.some(x=>x.includes('/dispatch')));assert.equal(f.calls.filter(x=>x.includes('/queue')).length,1);}
});
test('a confirmed queue remains queued when context is lost before dispatch',async()=>{
 const f=await run('pre_dispatch');assert.equal(f.result.items[0].status,'queued');assert.equal(f.result.items[0].queueId,queueId);assert.equal(f.result.unknown,false);assert(!f.calls.some(x=>x.includes('/dispatch')));assert.equal(f.result.items[1].status,'not_attempted');
});
test('context lost before any mutation can cancel; submitted delivery remains uncertain',async()=>{
 const before=await run('preflight');assert.equal(before.result.items[0].status,'cancelled');assert(!before.calls.some(x=>x.includes('/queue')||x.includes('/dispatch')));
 const after=await run('dispatch');assert.equal(after.result.items[0].status,'delivery_unknown');assert.equal(after.result.unknown,true);assert.equal(after.calls.filter(x=>x.includes('/dispatch')).length,1);
});
test('explicit unavailable supervision and sponsorship cannot become positive reply signals',()=>{
 for(const text of ['No supervision is available.','No visa sponsorship is available.','No Level 1 supervision is currently available.','Neither sponsorship nor supervision is available.','Neither supervision nor visa sponsorship is available.']){
  const result=rankMessage(text);assert.equal(result.priority,'weak',text);assert(!result.reasons.some(x=>x.startsWith('positive_')),text);assert(result.reasons.includes('rule_based_review_required'));
 }
 for(const text of ['Supervision is available.','Visa sponsorship is available.','No worries, supervision is available.'])assert.equal(rankMessage(text).priority,'strong',text);
});


test('affected cached refusals are reevaluated before filtering without provider reads or cross-owner data',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../cloud/google-mail-schema.sql',import.meta.url),'utf8'));
 const writes=[];const binding={prepare(sql){return{bind(...args){return{async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async run(){writes.push(sql);return{meta:sqlite.prepare(sql).run(...args)};}};}};}};
 const seed=(owner,id,body,priority,subject='sub-'+owner)=>{const value={id,threadId:'thread-'+id,subject:'GP recruitment',plainBody:body,snippet:body,priority,reasons:['obsolete-rule'],direction:'received',from:'clinic@example.invalid',labels:[],dateTimestamp:100};sqlite.prepare('INSERT INTO google_mail_messages VALUES(?,?,?,?,?,?,?,?)').run(owner,subject,id,value.threadId,100,priority,JSON.stringify(value),100);};
 for(const owner of ['arash-owner','amir-owner']){seed(owner,'refusal-'+owner,'No supervision is available.','strong');seed(owner,'invitation-'+owner,'Please arrange a call to discuss the GP position.','strong');}
 seed('arash-owner','old-google-identity','Please arrange a call.','strong','replaced-subject');
 for(const person of ['arash','amir']){
  const context={userId:person+'-owner',profileId:person},provider=async()=>({accessToken:'synthetic-only',subject:'sub-'+context.userId,scopes:['https://www.googleapis.com/auth/gmail.readonly']});
  const get=async priority=>{const r=await handleGoogleMailRequest(new Request('https://app.example/api/google/mail/messages?scope=all&priority='+priority),{GOOGLE_DB:binding},context,()=>{throw Error('No provider call allowed');},provider);assert.equal(r.status,200);return r.json();};
  const strong=await get('strong');assert.deepEqual(strong.messages.map(x=>x.id),['invitation-'+context.userId]);
  const weak=await get('weak');assert.deepEqual(weak.messages.map(x=>x.id),['refusal-'+context.userId]);assert(!weak.messages[0].reasons.some(x=>x.startsWith('positive_')));
 }
 assert.equal(writes.length,0);sqlite.close();
});


test('cache migration does not rerank unaffected rows and limits analysis to suspect strong messages',()=>{
 let calls=0;const analyze=(text,direction)=>{calls++;return rankMessage(text,direction);};
 const unaffected=Array.from({length:500},(_,i)=>({priority:i%2?'weak':'strong',subject:'GP recruitment',plainBody:'General medical information. '.repeat(300),reasons:['persisted']}));
 for(const message of unaffected)assert.equal(refreshCachedReplyRank(message,analyze),message);
 const weakNegative={priority:'weak',plainBody:'No supervision is available.'};assert.equal(refreshCachedReplyRank(weakNegative,analyze),weakNegative);assert.equal(calls,0);
 const refusal={priority:'strong',plainBody:'No supervision is available.'};assert.equal(refreshCachedReplyRank(refusal,analyze).priority,'weak');assert.equal(calls,1);
 const quoted={priority:'strong',plainBody:'Please arrange a call.\nOn Tuesday Applicant wrote:\n> No supervision is available.'};const result=refreshCachedReplyRank(quoted,analyze);assert.equal(result.priority,'strong');assert(result.reasons.includes('quoted_history_excluded_from_analysis'));assert.equal(calls,2);
 const outOfWindow={priority:'strong',plainBody:'x'.repeat(8000)+' No supervision is available.'};assert.equal(refreshCachedReplyRank(outOfWindow,analyze),outOfWindow);assert.equal(calls,2);
});
