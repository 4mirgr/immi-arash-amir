import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleOpportunityMailRequest} from '../cloud/opportunity-mail.mjs';
import {getGpApplicationPackage} from '../cloud/gp-application-package.mjs';
import {academicContextHash} from '../cloud/gp-academic-writing.mjs';
import {encryptGoogleSecret} from '../cloud/google-oauth.mjs';
const origin='https://app.example',presetId='11111111-1111-4111-8111-111111111111',cvVersionId='22222222-2222-4222-8222-222222222222',opp='opp_'+ '1'.repeat(32);
function binding(db){return {prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};}};}
async function fixture(){
 const privateDb=new DatabaseSync(':memory:'),publicDb=new DatabaseSync(':memory:');for(const file of ['google-schema.sql','google-send-schema.sql','mail-automation-schema.sql'])privateDb.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));publicDb.exec(readFileSync(new URL('../cloud/opportunity-v2-schema.sql',import.meta.url),'utf8'));
 const env={GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_REDIRECT_URI:origin+'/api/google/callback',GOOGLE_DB:binding(privateDb),OPPORTUNITY_DB:binding(publicDb),GOOGLE_TOKEN_KEY:Buffer.alloc(32,7).toString('base64')};
 publicDb.prepare('INSERT INTO opportunity_organizations VALUES(?,?,?,?,?,?,?,?)').run('org','synthetic organization','source.example','AU','NSW',JSON.stringify({name:'Synthetic organization'}),'2026-01-01','2026-01-01');
 const source={id:opp,country:'AU',title:'General Practitioner',organization:'Synthetic organization',summary:'Published contact recruit@example.invalid',fullText:'Apply via recruit@example.invalid',url:'https://source.example/jobs/1'};
 publicDb.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(opp,'source','1','org','edition-1','both','official','job','AU','NSW',source.title,source.url,null,'2099-01-01','open',JSON.stringify(source),new Date().toISOString(),new Date().toISOString());
 const own={preset:{data:{subject:'Synthetic application',body:'Reviewed saved body'}},cv:{text:'Synthetic CV',version:1}},calls=[],restReads=[];
 for(const profile of ['amir','arash']){const owner=profile+'-owner',cipher=await encryptGoogleSecret(env,owner,{access_token:'synthetic-token'});privateDb.prepare('INSERT INTO google_accounts VALUES(?,?,?,?,?,?,?,?,?)').run(owner,profile,'subject-'+profile,profile+'@example.invalid',JSON.stringify(['https://www.googleapis.com/auth/gmail.send']),cipher,Date.now()+3600000,'connected',Date.now());}
 const context=profile=>({userId:profile+'-owner',profileId:profile,rest:async(table,query)=>{restReads.push({table,query,profile});assert(query.includes('profile_id=eq.'+profile));if(table==='immi_profiles')return [{data:{name:'Synthetic Doctor',planning:{gpApplicationWriting:{openingParagraph:'I am an internationally trained GP seeking a supervised position in general practice.',closingParagraph:'I would welcome a discussion about your practice and the role.',writingVersion:'human-four-paragraph-v1',confirmedByOwner:true,signatureEmail:'synthetic-doctor@example.invalid',signaturePhone:'+00 123 456 789'}}}}];if(table==='immi_presets')return query.includes(presetId)&&own.preset?[own.preset]:[];if(table==='immi_cv_versions')return query.includes(cvVersionId)&&own.cv?[own.cv]:[];throw Error('No shared clinic read/write is needed');}});
 const payload={presetId,cvVersionId,mailbox:'primary',recipient:'recruit@example.invalid'};
 const call=(action='',input,profile='arash',headers={})=>handleOpportunityMailRequest(new Request(origin+'/api/opportunities/'+opp+'/mail'+(action?'/'+action:''),{method:input?'POST':'GET',headers:{Origin:origin,...headers},...(input?{body:JSON.stringify(input)}:{})}),env,context(profile),async url=>{calls.push(url);throw Error('Unexpected provider call');});
 return {privateDb,publicDb,own,calls,payload,call,env,context,restReads};
}
test('published contact preview and reviewed queue use selected own preset and CV without creating clinics or sending',async()=>{
 const f=await fixture();assert.deepEqual((await(await f.call()).json()).publishedRecipients,['recruit@example.invalid']);
 const preview=await(await f.call('preview',f.payload)).json();assert.equal(preview.sender,'arash@example.invalid');assert.match(preview.message.body,/attached my CV and cover letter/);assert.equal(preview.coverLetter,'Reviewed saved body');
 assert.deepEqual(preview.attachments.map(file=>file.name),['Dr Arash Entezar – CV.pdf','Dr Arash Entezar – Cover Letter – Synthetic organization.pdf']);
 assert(preview.attachments.every(file=>file.mimeType==='application/pdf'&&/^[a-f0-9]{64}$/.test(file.hash)&&file.size>0));
 assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);
 const queued=await(await f.call('queue',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash})).json();assert.equal(queued.items[0].status,'queued');assert.equal(queued.items[0].recipient,f.payload.recipient);assert.equal(queued.sent,false);
 const repeated=await(await f.call('queue',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash})).json();assert.equal(repeated.items[0].id,queued.items[0].id);assert.equal(repeated.items[0].reused,true);
 assert.equal(f.privateDb.prepare('SELECT owner_id FROM google_send_queue').get().owner_id,'arash-owner');assert.match(f.privateDb.prepare('SELECT raw_mime FROM google_send_queue').get().raw_mime,/^application-v1\./);assert.deepEqual(queued.attachments,preview.attachments);assert.equal(f.calls.length,0);
});
test('the GP application format does not change the other workspace mail preset or CV',async()=>{
 const f=await fixture(),preview=await(await f.call('preview',f.payload,'amir')).json();
 assert.equal(preview.message.body,'Reviewed saved body');assert.equal(preview.recipients[0].attachmentName,'cv-amir-v1.docx');assert.equal(preview.attachments,undefined);assert.equal(preview.coverLetter,undefined);
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
function seedLinkedServices(f,{foreign=false,stale=false}={}){
 for(const schema of ['public-page-schema.sql','public-page-enrichment-schema.sql'])f.publicDb.exec(readFileSync(new URL('../cloud/'+schema,import.meta.url),'utf8'));
 f.env.PUBLIC_PAGE_READING_ENABLED='true';
 const time=Date.now(),rootAt=new Date(time-2000).toISOString(),childAt=new Date(time-1000).toISOString(),page='page_'+'d'.repeat(32),childPage='page_'+'e'.repeat(32),rootURL='https://source.example/jobs/1',childURL=foreign?'https://foreign.example.invalid/services':'https://source.example/services';
 const clinicQuote='Our practice provides diabetes management and preventive care.',cvQuote='Managed diabetes patients and provided preventive care in general practice.';
 const source={id:opp,country:'AU',title:'General Practitioner',organization:'Synthetic Services Practice',url:rootURL,summary:'A supervised GP vacancy.',fullText:'Feed excerpt.'};
 f.publicDb.prepare('UPDATE opportunity_editions SET first_seen_at=?,data=? WHERE id=?').run(new Date(time-10000).toISOString(),JSON.stringify(source),opp);
 const parent={parentPageId:page,parentURL:rootURL,parentReadAt:stale?new Date(time-3000).toISOString():rootAt,depth:1};
 for(const [id,url,at,text,data]of [[page,rootURL,rootAt,'Synthetic Services Practice invites General Practitioner applications. Apply to recruit@example.invalid.',{officialBases:['source.example']}],[childPage,childURL,childAt,clinicQuote,{...parent,officialBases:[foreign?'foreign.example.invalid':'source.example']}]]){
  f.publicDb.prepare('INSERT INTO public_page_queue(id,url,country,profile_scope,data,status,read_at) VALUES(?,?,?,?,?,?,?)').run(id,url,'AU','both',JSON.stringify(data),'read',at);
  f.publicDb.prepare('INSERT INTO public_page_content VALUES(?,?,?,?,?,?,?,?)').run(id,at,'read','Public practice page','text/html',text,null,'[]');
  f.publicDb.prepare('INSERT INTO public_page_enrichment VALUES(?,?,?,?)').run(id,at,'AU',JSON.stringify({...data,sourceURL:url,readAt:at,contacts:[],people:[],organizations:[],followLinks:[],limitations:[]}));
 }
 f.own.preset.data.name='GP B — Independent practice enquiry';f.own.cv.text=cvQuote;
 return{rootAt,childAt,childPage,childURL,clinicQuote,cvQuote};
}
test('current linked services flow through GP selection, exact child provenance, reviewed preview and a single private queue',async()=>{
 const f=await fixture(),evidence=seedLinkedServices(f),application={variant:'B',subjectIndex:0,clinicQuote:evidence.clinicQuote,cvQuote:evidence.cvQuote,confirmCvQuote:true};
 const generated=await getGpApplicationPackage(f.env,f.context('arash'),opp,{...application,cvVersionId});assert.equal(generated.readyForReview,true);
 assert.equal(generated.factBasis.clinic[0].sourceURL,evidence.childURL);assert.equal(generated.provenance.find(item=>item.kind==='clinic_quote').readAt,evidence.childAt);
 const payload={...f.payload,application},response=await f.call('preview',payload),preview=await response.json();assert.equal(response.status,200);assert(preview.coverLetter.includes('diabetes management and preventive care'));
 assert.equal((await f.call('queue',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash})).status,201);assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,1);assert.equal(f.calls.length,0);
});
test('linked clinical fact receipt drift invalidates review and foreign or stale-parent text cannot become selected evidence',async()=>{
 const f=await fixture(),evidence=seedLinkedServices(f),application={variant:'B',subjectIndex:0,clinicQuote:evidence.clinicQuote,cvQuote:evidence.cvQuote,confirmCvQuote:true},payload={...f.payload,application};
 const preview=await(await f.call('preview',payload)).json(),at=new Date().toISOString();
 f.publicDb.prepare('UPDATE public_page_queue SET read_at=? WHERE id=?').run(at,evidence.childPage);f.publicDb.prepare('UPDATE public_page_content SET read_at=? WHERE page_id=?').run(at,evidence.childPage);f.publicDb.prepare("UPDATE public_page_enrichment SET read_at=?,data=json_set(data,'$.readAt',?) WHERE page_id=?").run(at,at,evidence.childPage);
 assert.equal((await f.call('queue',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash})).status,409);assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);
 for(const mode of [{foreign:true},{stale:true}]){
  const blocked=await fixture(),other=seedLinkedServices(blocked,mode),app={...application,clinicQuote:other.clinicQuote,cvQuote:other.cvQuote};
  assert.equal((await blocked.call('preview',{...blocked.payload,application:app})).status,409);assert.equal(blocked.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);
 }
});
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

test('source-personalized GP package uses exact own CV/source quotes and freezes the chosen subject in existing mail queue',async()=>{
 const f=await fixture(),clinicQuote='Our clinic provides community general practice and chronic disease care.',cvQuote='I provide chronic disease management and preventive care in community general practice.';
 const row=f.publicDb.prepare('SELECT data FROM opportunity_editions WHERE id=?').get(opp),source=JSON.parse(row.data);Object.assign(source,{organization:'Synthetic Practice',summary:clinicQuote,fullText:clinicQuote+'\nApply via recruit@example.invalid'});f.publicDb.prepare('UPDATE opportunity_editions SET data=? WHERE id=?').run(JSON.stringify(source),opp);
 f.own.preset.data.name='GP B — Independent practice enquiry';f.own.cv.text=cvQuote;
 const application={variant:'B',subjectIndex:0,clinicQuote,cvQuote,confirmCvQuote:true},payload={...f.payload,application};
 const response=await f.call('preview',payload);assert.equal(response.status,200);const preview=await response.json();assert(preview.message.body.includes('Synthetic Practice'));assert(preview.coverLetter.includes('chronic disease care'));assert(!preview.coverLetter.includes('Your published information states'));assert.equal(preview.coverLetter.trim().split(/\n\s*\n/).length,6);assert(preview.coverLetter.includes('chronic disease management'));assert(preview.coverLetter.includes('preventive care'));assert(!preview.coverLetter.includes('{{'));assert.notEqual(preview.coverLetter,'Reviewed saved body');assert.equal(f.own.preset.data.body,'Reviewed saved body');
 assert.equal((await f.call('queue',{...payload,application:{...application,subjectIndex:1},confirmReviewed:true,reviewHash:preview.reviewHash})).status,409);
 const queued=await f.call('queue',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash});assert.equal(queued.status,201);assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,1);assert.equal(f.calls.length,0);
});
test('each personalized preview and queue fetches source/CV once while every new action still revalidates fresh records',async()=>{
 const f=await fixture(),clinicQuote='Our clinic provides community general practice and chronic disease care.',cvQuote='I provide chronic disease management and preventive care in community general practice.';
 const row=f.publicDb.prepare('SELECT data FROM opportunity_editions WHERE id=?').get(opp),source=JSON.parse(row.data);Object.assign(source,{organization:'Synthetic Practice',summary:clinicQuote,fullText:clinicQuote+'\nApply via recruit@example.invalid'});f.publicDb.prepare('UPDATE opportunity_editions SET data=? WHERE id=?').run(JSON.stringify(source),opp);
 f.own.preset.data.name='GP B — Independent practice enquiry';f.own.cv.text=cvQuote;
 let editionReads=0;const prepare=f.env.OPPORTUNITY_DB.prepare.bind(f.env.OPPORTUNITY_DB);f.env.OPPORTUNITY_DB.prepare=sql=>{if(sql==='SELECT * FROM opportunity_editions WHERE id=?')editionReads++;return prepare(sql);};
 const payload={...f.payload,application:{variant:'B',subjectIndex:0,clinicQuote,cvQuote,confirmCvQuote:true}};
 const response=await f.call('preview',payload),preview=await response.json();assert.equal(response.status,200);
 assert.equal(editionReads,1);assert.equal(f.restReads.filter(x=>x.table==='immi_cv_versions').length,1);assert.equal(f.restReads.filter(x=>x.table==='immi_profiles').length,1);
 assert.equal((await f.call('queue',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash})).status,201);
 assert.equal(editionReads,2);assert.equal(f.restReads.filter(x=>x.table==='immi_cv_versions').length,2);assert.equal(f.restReads.filter(x=>x.table==='immi_profiles').length,2);
 assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,1);assert.equal(f.calls.length,0);
});
test('GP package transport rejects missing review, forged clinic/CV evidence, wrong template and other profile without queuing',async()=>{
 const f=await fixture(),application={variant:'B',subjectIndex:0,clinicQuote:'Invented clinic values and GP care.',cvQuote:'Invented clinical experience.',confirmCvQuote:true};
 for(const app of [application,{...application,subjectIndex:3},{...application,confirmCvQuote:false},{...application,body:'Forged body'}]){const response=await f.call('preview',{...f.payload,application:app});assert(response.status>=400);}
 assert.equal((await f.call('preview',{...f.payload,application},'amir')).status,400);assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);assert.deepEqual(f.calls,[]);
});

test('optional clinic contact remains owner-scoped and changing it invalidates mail review',async()=>{
 const f=await fixture(),clinicQuote='Our clinic provides community general practice and chronic disease care.',cvQuote='I provide chronic disease management and preventive care in community general practice.',contactId='33333333-3333-4333-8333-333333333333';
 const row=f.publicDb.prepare('SELECT data FROM opportunity_editions WHERE id=?').get(opp),source=JSON.parse(row.data);Object.assign(source,{organization:'Synthetic Practice',summary:clinicQuote,fullText:clinicQuote+'\nApply via recruit@example.invalid'});f.publicDb.prepare('UPDATE opportunity_editions SET data=? WHERE id=?').run(JSON.stringify(source),opp);
 f.own.preset.data.name='GP B — Independent practice enquiry';f.own.cv.text=cvQuote;
 f.privateDb.exec('CREATE TABLE linkedin_contacts(id TEXT PRIMARY KEY,owner_id TEXT,data TEXT,created_at TEXT)');
 const contact={name:'Synthetic Contact',organization:'Synthetic Practice',profileUrl:'https://www.linkedin.com/in/synthetic-contact/'};
 f.privateDb.prepare('INSERT INTO linkedin_contacts VALUES(?,?,?,?)').run(contactId,'arash-owner',JSON.stringify(contact),new Date().toISOString());
 const application={variant:'B',subjectIndex:0,clinicQuote,cvQuote,confirmCvQuote:true,connectionId:contactId,confirmConnection:true},payload={...f.payload,application};
 assert.equal((await f.call('preview',{...payload,application:{...application,confirmConnection:false}})).status,400);
 const response=await f.call('preview',payload);assert.equal(response.status,200);const preview=await response.json();assert(preview.coverLetter.includes(contact.name));assert(!preview.message.body.includes(contact.name));
 f.privateDb.prepare('UPDATE linkedin_contacts SET data=? WHERE id=?').run(JSON.stringify({...contact,name:'Changed Contact'}),contactId);
 assert.equal((await f.call('queue',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash})).status,409);
 f.privateDb.prepare('UPDATE linkedin_contacts SET owner_id=? WHERE id=?').run('foreign-owner',contactId);
 assert.equal((await f.call('preview',payload)).status,409);
 assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);assert.equal(f.calls.length,0);
});

function schedulingFixture(f,{mode='automatic'}={}){
 f.privateDb.exec(readFileSync(new URL('../cloud/mail-automation-scheduler-schema.sql',import.meta.url),'utf8'));
 f.publicDb.exec(readFileSync(new URL('../cloud/source-registry-schema.sql',import.meta.url),'utf8'));
 f.env.MAIL_SCHEDULER_ENABLED='true';
 f.publicDb.prepare("UPDATE opportunity_editions SET source_id='tas-pageup-759',closing_at='2099-01-01T00:00:00Z'").run();
 f.publicDb.prepare("INSERT INTO registered_source_checks(source_id,status,last_success_at) VALUES('tas-pageup-759','updated',?)").run(Date.now());
 f.privateDb.prepare('INSERT INTO mail_automation_settings VALUES(?,?,?,?,?)').run('arash-owner',mode,'primary',3,new Date().toISOString());
}
const after=()=>new Date(Date.now()+300000).toISOString();
test('reviewed opportunity can be explicitly scheduled in place without dispatch or changing owner policy',async()=>{
 const f=await fixture();schedulingFixture(f);const info=await(await f.call()).json();assert.equal(info.scheduling.enabled,true);assert.equal(info.scheduling.modeReady,true);assert.equal(info.scheduling.sourceEligible,true);
 const preview=await(await f.call('preview',f.payload)).json(),sendAfter=after();
 const response=await f.call('schedule',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash,sendAfter,confirmSend:true});assert.equal(response.status,201);const scheduled=await response.json();
 assert.equal(scheduled.approval.status,'approved');assert.equal(scheduled.approval.sendAfter,sendAfter);assert.equal(scheduled.approval.queueId,scheduled.items[0].id);assert.equal(scheduled.approval.cvVersionId,cvVersionId);assert.equal(scheduled.sent,false);assert.equal(f.calls.length,0);
 const job=f.privateDb.prepare('SELECT * FROM mail_automation_jobs').get(),snapshot=JSON.parse(job.snapshot_json);assert.equal(snapshot.kind,'opportunity_application_v1');assert.equal(snapshot.body,preview.message.body);assert.equal(snapshot.coverLetter,'Reviewed saved body');assert.deepEqual(snapshot.attachments,preview.attachments);assert.equal(snapshot.recipient,f.payload.recipient);assert.equal(job.owner_id,'arash-owner');assert.equal(job.mailbox,'primary');
 const repeat=await f.call('schedule',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash,sendAfter,confirmSend:true});assert.equal(repeat.status,200);assert.equal((await repeat.json()).approval.reused,true);assert.equal(f.privateDb.prepare('SELECT count(*) n FROM mail_scheduled_approvals').get().n,1);
 const listed=(await(await f.call()).json()).scheduling.approvals;assert.equal(listed.length,1);assert.equal(listed[0].message.body,preview.message.body);assert.equal(listed[0].coverLetter,'Reviewed saved body');assert.deepEqual(listed[0].attachments,preview.attachments);assert.equal(listed[0].attachmentName,preview.attachments[0].name);
 assert.equal(f.privateDb.prepare('SELECT requested_mode FROM mail_automation_settings').get().requested_mode,'automatic');
});
test('schedule requires enabled transport, mode, time and separate approval before any queue is created',async()=>{
 for(const scenario of ['mode','disabled','time','confirm']){
  const f=await fixture();schedulingFixture(f,{mode:scenario==='mode'?'draft_only':'automatic'});if(scenario==='disabled')f.env.MAIL_SCHEDULER_ENABLED='false';
  const preview=await(await f.call('preview',f.payload)).json();const r=await f.call('schedule',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash,sendAfter:scenario==='time'?new Date(Date.now()+2*86400000).toISOString():after(),confirmSend:scenario!=='confirm'});assert(r.status>=400,scenario);
  assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0,scenario);assert.equal(f.privateDb.prepare('SELECT count(*) n FROM mail_scheduled_approvals').get().n,0,scenario);assert.equal(f.calls.length,0);
 }
});
test('enriched selected recipient is frozen for scheduling and later public contact changes stop unattended transport',async()=>{
 const f=await fixture();schedulingFixture(f);seedRead(f);
 const payload={...f.payload,recipient:'read-contact@example.invalid'},preview=await(await f.call('preview',payload)).json();
 const r=await f.call('schedule',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash,sendAfter:after(),confirmSend:true});assert.equal(r.status,201);assert.equal(f.calls.length,0);
 const {dispatchScheduledMail}=await import('../cloud/mail-automation-scheduler.mjs');
 f.env.SUPABASE_URL='https://synthetic.supabase.co';f.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_synthetic';f.env.AUTOMATION_MEMBERSHIP_KEY='m'.repeat(43);
 f.privateDb.prepare("UPDATE mail_scheduled_approvals SET send_after=?,expires_at=? WHERE status='approved'").run(Date.now()-1000,Date.now()+600000);
 f.publicDb.prepare("UPDATE public_page_content SET text='Changed application contact: other@example.invalid'").run();
 const calls=[];const result=await dispatchScheduledMail(f.env,async(url)=>{calls.push(url);if(url.includes('/rpc/immi_automation_owner_active'))return Response.json(true);throw Error('No Google transport allowed after public evidence changed');});
 assert.equal(result.attempted,0);assert.equal(f.privateDb.prepare('SELECT status FROM mail_scheduled_approvals').get().status,'blocked');assert.equal(f.privateDb.prepare('SELECT reason FROM mail_scheduled_approvals').get().reason,'approved_message_changed');assert(calls.some(x=>x.includes('/rpc/immi_automation_owner_active')));assert(calls.every(x=>!x.includes('gmail')));
});
test('existing unrelated jobs are not overwritten by a new inline schedule',async()=>{
 const f=await fixture();schedulingFixture(f);const at=new Date().toISOString();f.privateDb.prepare('INSERT INTO mail_automation_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'arash-owner',opp,f.payload.recipient,'primary','draft',JSON.stringify({subject:'Prior draft',body:'Keep this draft'}),null,at,at.slice(0,10),at);
 const preview=await(await f.call('preview',f.payload)).json();const r=await f.call('schedule',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash,sendAfter:after(),confirmSend:true});assert.equal(r.status,409);assert.equal((await r.json()).error,'existing_application_job_requires_review');assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,0);assert.equal(JSON.parse(f.privateDb.prepare('SELECT snapshot_json FROM mail_automation_jobs').get().snapshot_json).body,'Keep this draft');
});

test('approval storage failure closes newly created queue and job without dispatch',async()=>{
 const f=await fixture();schedulingFixture(f);
 f.privateDb.exec("CREATE TRIGGER reject_test_approval BEFORE INSERT ON mail_scheduled_approvals BEGIN SELECT RAISE(ABORT,'synthetic approval storage failure'); END");
 const preview=await(await f.call('preview',f.payload)).json();
 const response=await f.call('schedule',{...f.payload,confirmReviewed:true,reviewHash:preview.reviewHash,sendAfter:after(),confirmSend:true});
 assert.equal(response.status,500);assert.equal(f.privateDb.prepare('SELECT status FROM google_send_queue').get().status,'failed');assert.equal(f.privateDb.prepare('SELECT status FROM mail_automation_jobs').get().status,'blocked');assert.equal(f.privateDb.prepare('SELECT count(*) n FROM mail_scheduled_approvals').get().n,0);assert.equal(f.calls.length,0);
});
test('reviewed enriched recipient dispatches once from own frozen queue with live membership and no private REST',async()=>{
 const f=await fixture();schedulingFixture(f);seedRead(f);const payload={...f.payload,recipient:'read-contact@example.invalid'},preview=await(await f.call('preview',payload)).json();
 assert.equal((await f.call('schedule',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash,sendAfter:after(),confirmSend:true})).status,201);
 f.env.SUPABASE_URL='https://synthetic.supabase.co';f.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_synthetic';f.env.AUTOMATION_MEMBERSHIP_KEY='m'.repeat(43);
 f.privateDb.prepare("UPDATE mail_scheduled_approvals SET send_after=?,expires_at=? WHERE status='approved'").run(Date.now()-1000,Date.now()+600000);
 const {dispatchScheduledMail}=await import('../cloud/mail-automation-scheduler.mjs');let sends=0,memberships=0;
 const fetcher=async(url,options)=>{if(url.includes('/rpc/immi_automation_owner_active')){memberships++;const input=JSON.parse(options.body);assert.equal(input.p_owner,'arash-owner');assert.equal(input.p_profile,'arash');return Response.json(true);}assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');assert.equal(options.headers.Authorization,'Bearer synthetic-token');sends++;return Response.json({id:'synthetic-ack'});};
 const result=await dispatchScheduledMail(f.env,fetcher);assert.equal(result.status,'sent',JSON.stringify({result,approval:f.privateDb.prepare('SELECT * FROM mail_scheduled_approvals').get()}));assert.equal(sends,1);assert(memberships>=2);assert.equal(f.privateDb.prepare('SELECT status FROM google_send_queue').get().status,'sent');assert.equal((await dispatchScheduledMail(f.env,fetcher)).attempted,0);assert.equal(sends,1);
});

test('academic letter receipt is private and revalidated before the exact reviewed wording enters a queue',async()=>{
 const f=await fixture(),clinicQuote='Our clinic provides community general practice and chronic disease care.',cvQuote='I provide chronic disease management and preventive care in community general practice.';
 const row=f.publicDb.prepare('SELECT data FROM opportunity_editions WHERE id=?').get(opp),source=JSON.parse(row.data);Object.assign(source,{organization:'Synthetic Practice',summary:clinicQuote,fullText:clinicQuote+'\nApply via recruit@example.invalid'});f.publicDb.prepare('UPDATE opportunity_editions SET data=? WHERE id=?').run(JSON.stringify(source),opp);
 f.own.preset.data.name='GP B — Independent practice enquiry';f.own.cv.text=cvQuote;
 const app={variant:'B',subjectIndex:0,clinicQuote,cvQuote,confirmCvQuote:true},generated=await getGpApplicationPackage(f.env,f.context('arash'),opp,{...app,cvVersionId});
 f.privateDb.exec(readFileSync(new URL('../cloud/ai-assistant-schema.sql',import.meta.url),'utf8'));
 const draft={clinicParagraph:"I am particularly interested in the continuity of care described at Synthetic Practice. I would value the opportunity to build long-term patient relationships through community general practice and chronic disease care.",valueParagraph:'My experience in chronic disease management and preventive care provides a relevant foundation for contributing to these services. I would bring that experience to routine consultations and follow-up, while working within the agreed supervision arrangements and local clinical protocols.',clinicFactIds:['clinic_1'],cvFactIds:['cv_1']},refinementId='academic_'+'a'.repeat(32);
 f.privateDb.prepare('INSERT INTO ai_assistant_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(refinementId,'arash-owner','arash',new Date().toISOString().slice(0,10),await academicContextHash(generated),'email','Synthetic private letter','completed',JSON.stringify({draft}),null,new Date().toISOString());
 const payload={...f.payload,application:{...app,refinementId}},response=await f.call('preview',payload),preview=await response.json();assert.equal(response.status,200);assert(preview.coverLetter.includes(draft.valueParagraph));assert(preview.coverLetter.includes('Phone: +00 123 456 789'));assert(preview.coverLetter.includes('Email: synthetic-doctor@example.invalid'));
 assert.equal((await f.call('queue',{...payload,application:{...app,refinementId:'academic_'+'b'.repeat(32)},confirmReviewed:true,reviewHash:preview.reviewHash})).status,409);
 assert.equal((await f.call('queue',{...payload,confirmReviewed:true,reviewHash:preview.reviewHash})).status,201);assert.equal(f.calls.length,0);
 source.summary=source.fullText='Our clinic now provides different services. Apply via recruit@example.invalid';f.publicDb.prepare('UPDATE opportunity_editions SET data=? WHERE id=?').run(JSON.stringify(source),opp);
 assert.equal((await f.call('preview',payload)).status,409);assert.equal(f.privateDb.prepare('SELECT count(*) n FROM google_send_queue').get().n,1);
});
