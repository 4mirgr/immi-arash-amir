import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleOpportunityMailRequest} from '../cloud/opportunity-mail.mjs';
import {encryptGoogleSecret} from '../cloud/google-oauth.mjs';
const origin='https://app.example',presetId='11111111-1111-4111-8111-111111111111',cvVersionId='22222222-2222-4222-8222-222222222222',opp='opp_'+ '1'.repeat(32);
function binding(db){return {prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};}};}
async function fixture(){
 const privateDb=new DatabaseSync(':memory:'),publicDb=new DatabaseSync(':memory:');for(const file of ['google-schema.sql','google-send-schema.sql','mail-automation-schema.sql'])privateDb.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));publicDb.exec(readFileSync(new URL('../cloud/opportunity-v2-schema.sql',import.meta.url),'utf8'));
 const env={GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_REDIRECT_URI:origin+'/api/google/callback',GOOGLE_DB:binding(privateDb),OPPORTUNITY_DB:binding(publicDb),GOOGLE_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
 publicDb.prepare('INSERT INTO opportunity_organizations VALUES(?,?,?,?,?,?,?,?)').run('org','Synthetic organization','source.example','AU','NSW','{}','2026-01-01','2026-01-01');
 const source={id:opp,country:'AU',title:'General Practitioner',summary:'Published contact recruit@example.invalid',fullText:'Apply via recruit@example.invalid',url:'https://source.example/jobs/1'};
 publicDb.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(opp,'source','1','org','edition-1','both','official','job','AU','NSW',source.title,source.url,null,'2099-01-01','open',JSON.stringify(source),new Date().toISOString(),new Date().toISOString());
 const own={preset:{data:{subject:'Synthetic application',body:'Reviewed saved body'}},cv:{text:'Synthetic CV',version:1}},calls=[];
 for(const profile of ['amir','arash']){const owner=profile+'-owner',cipher=await encryptGoogleSecret(env,owner,{access_token:'synthetic-token'});privateDb.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,profile,'subject-'+profile,profile+'@example.invalid',JSON.stringify(['https://www.googleapis.com/auth/gmail.send']),cipher,Date.now()+3600000,'connected',Date.now());}
 const context=profile=>({userId:profile+'-owner',profileId:profile,rest:async(table,query)=>{assert(query.includes('profile_id=eq.'+profile));if(table==='immi_presets')return query.includes(presetId)&&own.preset?[own.preset]:[];if(table==='immi_cv_versions')return query.includes(cvVersionId)&&own.cv?[own.cv]:[];throw Error('No shared clinic read/write is needed');}});
 const payload={presetId,cvVersionId,mailbox:'primary',recipient:'recruit@example.invalid'};
 const call=(action='',input,profile='arash',headers={})=>handleOpportunityMailRequest(new Request(origin+'/api/opportunities/'+opp+'/mail'+(action?'/'+action:''),{method:input?'POST':'GET',headers:{Origin:origin,...headers},...(input?{body:JSON.stringify(input)}:{})}),env,context(profile),async url=>{calls.push(url);throw Error('Unexpected provider call');});
 return {privateDb,publicDb,own,calls,payload,call,env};
}
test('published contact preview and reviewed queue use selected own preset and CV without creating clinics or sending',async()=>{
 const f=await fixture();assert.deepEqual((await(await f.call()).json()).publishedRecipients,['recruit@example.invalid']);
 const preview=await(await f.call('preview',f.payload)).json();assert.equal(preview.sender,'arash@example.invalid');assert.equal(preview.message.body,'Reviewed saved body');assert.equal(preview.recipients[0].attachmentName,'cv-arash-v1.docx');
 assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);
 const queued=await(await f.call('queue',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash})).json();assert.equal(queued.items[0].status,'queued');assert.equal(queued.items[0].recipient,f.payload.recipient);assert.equal(queued.sent,false);
 const repeated=await(await f.call('queue',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash})).json();assert.equal(repeated.items[0].id,queued.items[0].id);assert.equal(repeated.items[0].reused,true);
 assert.equal(f.privateDb.prepare('SELECT owner_id FROM google_send_queue').get().owner_id,'arash-owner');assert.match(f.privateDb.prepare('SELECT raw_mime FROM google_send_queue').get().raw_mime,/cv-arash-v1.docx/);assert.equal(f.calls.length,0);
});
test('explicit review, exact published recipient, own selections and mailbox scope fail closed',async()=>{
 const f=await fixture();for(const override of [{recipient:'attacker@example.invalid'},{cvVersionId:'33333333-3333-4333-8333-333333333333'},{presetId:'33333333-3333-4333-8333-333333333333'},{mailbox:'secondary'},{owner:'amir-owner'}])assert((await f.call('preview',{...f.payload,...override})).status>=400);
 assert.equal((await f.call('queue',f.payload)).status,409);assert.equal((await f.call('preview',f.payload,'arash',{Origin:'https://evil.example'})).status,403);assert.equal(f.calls.length,0);
});
test('source, CV, template, identity or owner change invalidates a reviewed application',async()=>{
 for(const mutation of ['cv','preset','source','identity','owner']){
  const f=await fixture(),preview=await(await f.call('preview',f.payload)).json();
  if(mutation==='cv')f.own.cv.text+=' changed';if(mutation==='preset')f.own.preset.data.body+=' changed';
  if(mutation==='source')f.publicDb.prepare('UPDATE opportunity_editions SET edition_key=?').run('edition-2');
  if(mutation==='identity')f.privateDb.prepare("UPDATE google_accounts SET google_sub='replacement-subject' WHERE owner_id='arash-owner'").run();
  const response=await f.call('queue',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash},mutation==='owner'?'amir':'arash');assert.equal(response.status,409);assert.equal((await response.json()).error,'application_changed_review_required');assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);
 }
});
test('missing contacts, source expiry, owner-only countries and suppression do not produce sendable queue entries',async()=>{
 for(const mode of ['missing','closed','stale','private','suppressed']){
  const f=await fixture();
  if(mode==='missing')f.publicDb.prepare('UPDATE opportunity_editions SET data=?').run(JSON.stringify({title:'No address'}));
  if(mode==='closed')f.publicDb.prepare("UPDATE opportunity_editions SET status='closed'").run();
  if(mode==='stale')f.publicDb.prepare('UPDATE opportunity_editions SET last_seen_at=?').run('2000-01-01T00:00:00Z');
  if(mode==='private')f.publicDb.prepare("UPDATE opportunity_editions SET country='IT',profile_scope='amir'").run();
  if(mode==='suppressed')f.privateDb.prepare('INSERT INTO mail_automation_suppressions VALUES(?,?,?,?)').run('arash-owner',f.payload.recipient,'owner_suppressed',new Date().toISOString());
  const response=await f.call('preview',f.payload),preview=await response.json();if(mode==='suppressed'){assert.equal(preview.recipients.length,0);assert.equal((await f.call('queue',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash})).status,409);}else assert(response.status>=400);
  assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);assert.equal(f.calls.length,0);
 }
});
function seedRead(f,{offset=0,scope='both',mismatch=false}={}){
 f.publicDb.exec(readFileSync(new URL('../cloud/public-page-schema.sql',import.meta.url),'utf8'));f.env.PUBLIC_PAGE_READING_ENABLED='true';
 const now=Date.now(),at=new Date(now+offset).toISOString();
 f.publicDb.prepare('UPDATE opportunity_editions SET first_seen_at=?,data=?').run(new Date(now-10000).toISOString(),JSON.stringify({id:opp,country:'AU',title:'General Practitioner',url:'https://source.example/jobs/1',fullText:'Feed excerpt with no contact.'}));
 f.publicDb.prepare('INSERT INTO public_page_queue(id,url,country,profile_scope,data,status,read_at) VALUES(?,?,?,?,?,?,?)').run('read-page','https://source.example/jobs/1','AU',scope,'{}','read',at);
 f.publicDb.prepare('INSERT INTO public_page_content VALUES(?,?,?,?,?,?,?,?)').run('read-page',mismatch?new Date(now-5000).toISOString():at,'read','Public page','text/html','Apply to read-contact@example.invalid',null,'[]');
 return {at,now};
}
test('verified current page content supplies published recipient and its receipt is bound to review',async()=>{
 const f=await fixture();seedRead(f);
 const info=await(await f.call()).json();assert.deepEqual(info.publishedRecipients,['read-contact@example.invalid']);assert.equal(info.reading.status,'read');
 const payload={...f.payload,recipient:'read-contact@example.invalid'},preview=await(await f.call('preview',payload)).json();assert.equal(preview.recipients[0].recipient,payload.recipient);
 f.publicDb.prepare("UPDATE public_page_content SET text='Updated page: read-contact@example.invalid with changed application terms'").run();
 assert.equal((await f.call('queue',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash})).status,409);
 assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);
});
test('old, mismatched, future and different-owner readings cannot supply a contact for this edition',async()=>{
 for(const mode of ['old','mismatch','future','private','successor']){
  const f=await fixture(),{now}=seedRead(f,{offset:mode==='old'?-20000:mode==='future'?120000:0,scope:mode==='private'?'amir':'both',mismatch:mode==='mismatch'});
  if(mode==='successor')f.publicDb.prepare('INSERT INTO opportunity_editions SELECT ?,source_id,external_id,organization_id,?,profile_scope,trust,opportunity_type,country,state,title,url,published_at,closing_at,status,data,?,last_seen_at FROM opportunity_editions WHERE id=?').run('opp_'+'2'.repeat(32),'edition-2',new Date(now-1000).toISOString(),opp);
  const info=await(await f.call()).json();assert.deepEqual(info.publishedRecipients,[],mode);assert.equal(info.blockedReason,'published_recipient_missing',mode);
  assert.equal((await f.call('preview',{...f.payload,recipient:'read-contact@example.invalid'})).status,409,mode);
 }
});

test('source-linked contact metadata is bound to review and cannot outlive its reading receipt',async()=>{
 const f=await fixture(),{at}=seedRead(f);f.publicDb.exec(readFileSync(new URL('../cloud/public-page-enrichment-schema.sql',import.meta.url),'utf8'));
 f.publicDb.prepare("UPDATE public_page_content SET text='Clinical recruitment office. Select the published email link to apply.'").run();
 const metadata={sourceURL:'https://source.example/jobs/1',readAt:at,contacts:[{type:'email',value:'linked-contact@example.invalid',method:'visible_link',contactRole:'application',sourceRelation:'same_page',sourceURL:'https://source.example/jobs/1',quote:'Email your CV to linked-contact@example.invalid'}],organizations:[],followLinks:[],limitations:[]};
 f.publicDb.prepare('INSERT INTO public_page_enrichment VALUES(?,?,?,?)').run('read-page',at,'AU',JSON.stringify(metadata));
 const info=await(await f.call()).json();assert(info.publishedRecipients.includes('linked-contact@example.invalid'));assert.equal(info.recipientDetails[0].contactRole,'application');
 const payload={...f.payload,recipient:'linked-contact@example.invalid'},preview=await(await f.call('preview',payload)).json();assert(preview.reviewHash);
 f.publicDb.prepare("UPDATE public_page_enrichment SET read_at='2020-01-01T00:00:00Z'").run();
 const stale=await(await f.call()).json();assert(!stale.publishedRecipients.includes(payload.recipient));assert.equal((await f.call('queue',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash})).status,409);assert.equal(f.calls.length,0);
});
