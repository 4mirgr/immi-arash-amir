import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRecipientBatch,sendRecipientBatch,scheduleRecipientBatch} from '../src/opportunity-recipient-batch.mjs';
const opportunityId='opp_'+'a'.repeat(32),otherOpportunity='opp_'+'b'.repeat(32),presetId='11111111-1111-4111-8111-111111111111',cvVersionId='22222222-2222-4222-8222-222222222222';
const plan=(recipients=['one@example.invalid','two@example.invalid'],extra={})=>({opportunityId,presetId,cvVersionId,mailbox:'primary',recipients,...extra});
function fixture(overrides={}){
 const calls=[];let queueCount=0;
 const api=async(path,options={})=>{
  const body=JSON.parse(options.body||'{}');calls.push({path,body,method:options.method||'GET'});
  if(overrides.call){const value=await overrides.call(path,body,calls);if(value!==undefined)return value;}
  if(path.startsWith('google/status?'))return {connected:true,email:'sender@example.invalid',capabilities:{gmailSend:true}};
  if(path.includes('/mail/preview'))return {opportunityId:path.includes(otherOpportunity)?otherOpportunity:opportunityId,presetId:body.presetId,cvVersionId:body.cvVersionId,mailbox:body.mailbox,sender:'sender@example.invalid',url:'https://example.invalid/current',lastSeenAt:'2026-11-10T00:00:00Z',message:{subject:'Synthetic clinic application',body:'Synthetic reviewed letter.'},reviewHash:'hash-'+body.recipient,recipients:[{recipient:body.recipient,subject:'Synthetic clinic application',cvVersionId:body.cvVersionId,attachmentName:'own-cv.docx',status:'preview',existingId:null}],excluded:[],dailyLimit:20,reservedToday:0};
  if(path.includes('/mail/queue'))return {opportunityId:path.includes(otherOpportunity)?otherOpportunity:opportunityId,mailbox:body.mailbox,items:[{id:'queue-'+(++queueCount),recipient:body.recipient,sender:'sender@example.invalid',subject:'Synthetic clinic application',cvVersionId:body.cvVersionId,attachmentName:'own-cv.docx',status:'queued',reused:false}],excluded:[]};
  if(path.startsWith('google/mail/dispatch?'))return {items:[{id:body.ids[0],status:'sent',gmailMessageId:'gmail-'+body.ids[0]}]};
  if(path.includes('/mail/schedule'))return {opportunityId,mailbox:body.mailbox,items:[{id:'queue-scheduled-'+body.recipient,recipient:body.recipient,sender:'sender@example.invalid',subject:'Synthetic clinic application',cvVersionId:body.cvVersionId,attachmentName:'own-cv.docx',status:'queued',reused:false}],approval:{id:'approval-'+body.recipient,queueId:'queue-scheduled-'+body.recipient,opportunityId,mailbox:body.mailbox,recipient:body.recipient,sender:'sender@example.invalid',cvVersionId:body.cvVersionId,status:'approved',sendAfter:body.sendAfter,message:{subject:'Synthetic clinic application',body:'Synthetic reviewed letter.'}}};
  throw Error('unexpected test request '+path);
 };
 return {api,calls};
}
test('preview normalizes and deduplicates exact selected recipients without creating queues',async()=>{
 const f=fixture(),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan([' One@example.invalid ','one@example.invalid','two@example.invalid']),plan(['two@example.invalid'],{opportunityId:otherOpportunity})]});
 assert.deepEqual(prepared.entries.map(e=>e.recipient),['one@example.invalid','two@example.invalid']);assert.equal(prepared.duplicates.length,2);assert.equal(prepared.blocked.length,0);assert(f.calls.every(c=>c.path.includes('/mail/preview')));assert(Object.isFrozen(prepared.entries[0].plan));
});
test('a changing source or message invalidates the complete opportunity preview',async()=>{
 const f=fixture({call:(path,body)=>path.includes('/preview')&&body.recipient.startsWith('two')?{opportunityId,presetId,cvVersionId,mailbox:'primary',sender:'sender@example.invalid',message:{subject:'Changed',body:'Changed source'},recipients:[{recipient:body.recipient,cvVersionId,attachmentName:'own-cv.docx'}],reviewHash:'changed'}:undefined});
 const prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});assert.equal(prepared.entries.length,0);assert.equal(prepared.blocked.length,2);assert(prepared.blocked.every(e=>e.reason==='application_changed_review_required'));
});
test('send requires explicit review, pins every queued message, and consumes approval once',async()=>{
 const f=fixture(),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});
 await assert.rejects(sendRecipientBatch({api:f.api,person:'arash',prepared}),/explicit_review_required/);assert.equal(f.calls.filter(c=>c.path.includes('/queue')).length,0);
 const result=await sendRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true});assert.deepEqual(result.results.map(e=>e.status),['sent','sent']);assert.equal(result.unknown,false);assert.equal(f.calls.filter(c=>c.path.includes('/dispatch')).length,2);
 for(const c of f.calls.filter(c=>c.path.includes('/queue'))){assert.equal(c.body.confirmReviewed,true);assert.equal(c.body.reviewHash,'hash-'+c.body.recipient);assert.equal(c.body.cvVersionId,cvVersionId);}
 await assert.rejects(sendRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true}),/batch_already_consumed/);assert.equal(f.calls.filter(c=>c.path.includes('/dispatch')).length,2);
});
test('queue-only remains a separate explicit action and never dispatches',async()=>{
 const f=fixture(),prepared=await prepareRecipientBatch({api:f.api,person:'amir',plans:[plan()]});const result=await sendRecipientBatch({api:f.api,person:'amir',prepared,confirmReviewed:true,queueOnly:true});assert.deepEqual(result.results.map(e=>e.status),['queued','queued']);assert(f.calls.every(c=>!c.path.includes('/dispatch')));
});
test('an owner change after queueing stops transport and all remaining writes',async()=>{
 let active=true;const f=fixture({call:(path)=>{if(path.includes('/queue'))active=false;}}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});const result=await sendRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true,isActive:()=>active});assert.equal(result.stopped,true);assert.equal(f.calls.filter(c=>c.path.includes('/queue')).length,1);assert(f.calls.every(c=>!c.path.includes('/dispatch')));
});
test('ambiguous Gmail delivery is terminal for that batch and never retries another recipient',async()=>{
 const f=fixture({call:path=>{if(path.includes('/dispatch'))throw Object.assign(Error('temporary transport issue'),{status:502});}}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});const result=await sendRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true});assert.equal(result.results[0].status,'delivery_unknown');assert.equal(result.stopped,true);assert.equal(result.unknown,true);assert.equal(f.calls.filter(c=>c.path.includes('/dispatch')).length,1);assert.equal(f.calls.filter(c=>c.path.includes('/queue')).length,1);
});
test('reused queue entries cannot become new send approval',async()=>{
 const f=fixture({call:(path,body)=>path.includes('/queue')?{opportunityId,mailbox:'primary',items:[{id:'existing',recipient:body.recipient,sender:'sender@example.invalid',subject:'Synthetic clinic application',cvVersionId,attachmentName:'own-cv.docx',status:'queued',reused:true}],excluded:[]}:undefined}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});const result=await sendRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true});assert(result.results.every(e=>e.status==='reused'));assert(f.calls.every(c=>!c.path.includes('/dispatch')));
});
test('quota and identity rejection stop the batch before any later queue is attempted',async()=>{
 const f=fixture({call:path=>{if(path.includes('/queue'))throw Object.assign(Error('daily_quota_reached'),{status:409});}}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});const result=await sendRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true});assert.equal(result.stopped,true);assert.equal(result.results[0].reason,'daily_quota_reached');assert.equal(f.calls.filter(c=>c.path.includes('/queue')).length,1);assert(f.calls.every(c=>!c.path.includes('/dispatch')));
 const changed=fixture({call:path=>path.startsWith('google/status?')?{connected:true,email:'different@example.invalid',capabilities:{gmailSend:true}}:undefined}),prepared2=await prepareRecipientBatch({api:changed.api,person:'arash',plans:[plan()]});await sendRecipientBatch({api:changed.api,person:'arash',prepared:prepared2,confirmReviewed:true});assert(changed.calls.every(c=>!c.path.includes('/queue')));
});
test('schedule pins each recipient and instant, requires both approvals, and never dispatches immediately',async()=>{
 const f=fixture(),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]}),sendAfter=new Date(Date.now()+3600000).toISOString();await assert.rejects(scheduleRecipientBatch({api:f.api,person:'arash',prepared,sendAfter,confirmReviewed:true}),/explicit_send_approval_required/);
 const result=await scheduleRecipientBatch({api:f.api,person:'arash',prepared,sendAfter,confirmReviewed:true,confirmSend:true});assert.equal(result.results.length,2);assert(result.results.every(e=>e.approval.status==='approved'));assert(f.calls.every(c=>!c.path.includes('/dispatch')&&!c.path.includes('/queue')));assert.equal(f.calls.filter(c=>c.path.includes('/schedule')).length,2);
});
test('schedule uncertainty stops further recipients and marks the batch consumed',async()=>{
 const f=fixture({call:path=>{if(path.includes('/schedule'))throw Object.assign(Error('unknown'),{status:502});}}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});const result=await scheduleRecipientBatch({api:f.api,person:'arash',prepared,sendAfter:new Date(Date.now()+3600000).toISOString(),confirmReviewed:true,confirmSend:true});assert.equal(result.results[0].status,'schedule_unknown');assert.equal(result.unknown,true);assert.equal(f.calls.filter(c=>c.path.includes('/schedule')).length,1);
});
test('oversized selections report blocked extras while limiting preview work to twenty messages',async()=>{
 const f=fixture(),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan(Array.from({length:23},(_,i)=>'person'+i+'@example.invalid'))]});assert.equal(prepared.entries.length,20);assert.equal(prepared.blocked.length,3);assert(prepared.blocked.every(e=>e.reason==='batch_limit_reached'));assert.equal(f.calls.length,20);
});
test('forged, cloned or cross-owner preparations cannot authorize any mutation',async()=>{
 const f=fixture(),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});for(const [person,value] of [['amir',prepared],['arash',structuredClone(prepared)]])await assert.rejects(sendRecipientBatch({api:f.api,person,prepared:value,confirmReviewed:true}),/batch_review_not_available/);assert(f.calls.every(c=>c.path.includes('/preview')));
});
test('a failed first source does not hide a valid later clinic using the same mailbox',async()=>{
 const f=fixture({call:path=>{if(path.includes(opportunityId)&&path.includes('/preview'))throw Object.assign(Error('source_observation_stale'),{status:409});}}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan(['one@example.invalid']),plan(['one@example.invalid'],{opportunityId:otherOpportunity})]});assert.equal(prepared.entries.length,1);assert.equal(prepared.entries[0].opportunityId,otherOpportunity);assert.equal(prepared.blocked.length,1);assert.equal(prepared.duplicates.length,0);
});
test('remaining recipients receive an explicit not-attempted receipt after a stop',async()=>{
 const f=fixture({call:path=>{if(path.includes('/dispatch'))throw Object.assign(Error('network'),{status:502});}}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});const result=await sendRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true});assert.deepEqual(result.results.map(e=>e.status),['delivery_unknown','not_attempted']);assert.equal(result.results[1].reason,'batch_stopped');
});
test('scope changes after a submitted Gmail or scheduler operation never claim cancellation',async()=>{
 let active=true;const f=fixture({call:path=>{if(path.includes('/dispatch'))active=false;}}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan()]});const delivery=await sendRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true,isActive:()=>active});assert.equal(delivery.results[0].status,'delivery_unknown');assert.equal(delivery.unknown,true);
 active=true;const g=fixture({call:path=>{if(path.includes('/schedule'))active=false;}}),prepared2=await prepareRecipientBatch({api:g.api,person:'arash',plans:[plan()]});const scheduled=await scheduleRecipientBatch({api:g.api,person:'arash',prepared:prepared2,confirmReviewed:true,confirmSend:true,sendAfterISO:new Date(Date.now()+3600000).toISOString(),isActive:()=>active});assert.equal(scheduled.results[0].status,'schedule_unknown');assert.equal(scheduled.unknown,true);
});
test('fresh schedule review may reuse a cancelled exact pending queue without manually dispatching it',async()=>{
 const f=fixture({call:(path,body)=>path.includes('/preview')?{opportunityId,presetId,cvVersionId,mailbox:'primary',sender:'sender@example.invalid',message:{subject:'Synthetic clinic application',body:'Synthetic reviewed letter.'},reviewHash:'hash-'+body.recipient,recipients:[{recipient:body.recipient,subject:'Synthetic clinic application',cvVersionId,attachmentName:'own-cv.docx',existingId:'previous-queue',status:'queued'}],excluded:[],dailyLimit:20,reservedToday:20}:undefined}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan(['one@example.invalid'])]});assert.equal(prepared.entries.length,1);assert.equal(prepared.entries[0].queuedExisting,true);
 const result=await scheduleRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true,confirmSend:true,sendAfterISO:new Date(Date.now()+3600000).toISOString()});assert.equal(result.results[0].status,'scheduled');assert(f.calls.every(c=>!c.path.includes('/dispatch')));
});
test('scheduling more than three recipients or conflicting date aliases never writes',async()=>{
 const f=fixture(),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan(['a@example.invalid','b@example.invalid','c@example.invalid','d@example.invalid'])]});await assert.rejects(scheduleRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true,confirmSend:true,sendAfterISO:new Date(Date.now()+3600000).toISOString()}),/schedule_recipient_limit_reached/);assert(f.calls.every(c=>c.path.includes('/preview')));
 const g=fixture(),p=await prepareRecipientBatch({api:g.api,person:'arash',plans:[plan(['a@example.invalid'])]});await assert.rejects(scheduleRecipientBatch({api:g.api,person:'arash',prepared:p,confirmReviewed:true,confirmSend:true,sendAfter:new Date(Date.now()+3600000).toISOString(),sendAfterISO:new Date(Date.now()+7200000).toISOString()}),/invalid_schedule_time/);assert(g.calls.every(c=>c.path.includes('/preview')));
});
test('a previously queued preview can never authorize a fresh manual queue or transport',async()=>{
 const f=fixture({call:(path,body)=>path.includes('/preview')?{opportunityId,presetId,cvVersionId,mailbox:'primary',sender:'sender@example.invalid',message:{subject:'Synthetic clinic application',body:'Synthetic reviewed letter.'},reviewHash:'hash-'+body.recipient,recipients:[{recipient:body.recipient,subject:'Synthetic clinic application',cvVersionId,attachmentName:'own-cv.docx',existingId:'previous-queue',status:'queued'}],excluded:[],dailyLimit:20,reservedToday:1}:undefined}),prepared=await prepareRecipientBatch({api:f.api,person:'arash',plans:[plan(['one@example.invalid'])]});const result=await sendRecipientBatch({api:f.api,person:'arash',prepared,confirmReviewed:true});assert.equal(result.results[0].status,'reused');assert.equal(result.results[0].queueId,'previous-queue');assert(f.calls.every(c=>c.path.includes('/preview')));
});
