import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleMailAutomationRequest} from '../cloud/mail-automation.mjs';
function binding(db){const wrap=(sql,args=[])=>({bind(...v){return wrap(sql,v);},async all(){return {results:db.prepare(sql).all(...args)};},async first(){return db.prepare(sql).get(...args)||null;},async run(){throw Error('Suggestions must be read-only');}});return {prepare:sql=>wrap(sql)};}
function fixture(){
 const pub=new DatabaseSync(':memory:'),priv=new DatabaseSync(':memory:');
 pub.exec(readFileSync(new URL('../cloud/opportunity-v2-schema.sql',import.meta.url),'utf8'));
 for(const schema of ['mail-automation-schema.sql','google-schema.sql','google-send-schema.sql'])priv.exec(readFileSync(new URL('../cloud/'+schema,import.meta.url),'utf8'));
 pub.prepare('INSERT INTO opportunity_organizations VALUES(?,?,?,?,?,?,?,?)').run('org_synthetic','Synthetic Clinic','clinic.example.invalid','AU','NSW',JSON.stringify({domainEvidence:'source_provided'}),'2026-01-01','2026-01-01');
 const env={GOOGLE_DB:binding(priv),OPPORTUNITY_DB:binding(pub)};
 let seq=0;
 const ad=(values={})=>{const id='opp_'+(++seq).toString(16).padStart(32,'0'),title=values.title||'General Practitioner',email=values.email||'jobs'+seq+'@example.invalid',url='https://clinic.example.invalid/jobs/'+seq;const data={id,title,url,organization:'Synthetic Clinic',organizationDomain:'clinic.example.invalid',kind:values.kind||'vacancy',fullText:values.fullText||'General practitioner role. Apply to '+email,...values};pub.prepare('INSERT INTO opportunity_editions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'synthetic-source','external-'+seq,'org_synthetic','edition-'+seq,values.profileScope||'both',values.trust||'official','job',values.country||'AU','NSW',title,url,values.publishedAt===undefined?new Date(Date.now()-3600000).toISOString():values.publishedAt,values.closingAt||'2099-01-01T00:00:00Z',values.status||'open',JSON.stringify(data),values.firstSeenAt||new Date(Date.now()-3600000).toISOString(),values.seenAt||new Date().toISOString());return id;};
 const call=(query='profile=arash',owner='arash-owner',profileId='arash')=>handleMailAutomationRequest(new Request('https://app.example.invalid/api/mail-automation/suggestions?'+query),env,{userId:owner,profileId,rest:()=>{throw Error('No profile/CV/provider access during suggestions');}},()=>{throw Error('No provider requests');});
 function sent(email,owner='arash-owner',status='sent'){priv.prepare('INSERT INTO google_send_queue(id,owner_id,profile_id,google_subject,google_email,fingerprint,recipient,subject,raw_mime,status,created_at,created_day) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),owner,'arash','synthetic-sub','arash@example.invalid',crypto.randomUUID(),email,'Synthetic','Synthetic',status,new Date().toISOString(),new Date().toISOString().slice(0,10));}
 return {pub,priv,env,ad,call,sent};
}
test('daily and weekly suggested batches are deterministic read-only current public ads, never approvals',async()=>{
 const f=fixture();f.ad();f.ad();f.ad();f.ad();
 const daily=await (await f.call()).json(),again=await (await f.call()).json(),weekly=await (await f.call('profile=arash&cadence=weekly')).json();
 assert.deepEqual(daily.suggestions,again.suggestions);assert.equal(daily.suggestions.length,3);assert.equal(daily.availableCount,4);assert.equal(daily.automaticSending,false);assert.equal(daily.reviewRequired,true);assert.equal(daily.importedClinicLeadsIncluded,false);assert.equal(daily.suggestions[0].firstParty,true);assert.equal(daily.refresh,'recomputed_on_read_from_scheduled_discovery');assert.equal(daily.periodKey.length,10);assert.equal(weekly.timeZone,'Asia/Tehran');assert.equal(Date.parse(weekly.windowEnd)-Date.parse(weekly.windowStart),7*86400000);assert.equal(Date.parse(daily.windowEnd)-Date.parse(daily.windowStart),86400000);assert(daily.suggestions.every(x=>x.reviewRequired&&!('recipients' in x)));
 assert.equal(f.priv.prepare('SELECT count(*) n FROM mail_automation_jobs').get().n,0);
});
test('suggestions exclude both own sender histories and suppressions but never borrow another owner history',async()=>{
 const f=fixture();f.ad({email:'primary@example.invalid'});f.ad({email:'secondary@example.invalid'});f.ad({email:'suppressed@example.invalid'});f.ad({email:'provider-suppressed@example.invalid'});const other=f.ad({email:'other-owner@example.invalid'});
 f.sent('primary@example.invalid');f.sent('secondary@example.invalid','arash-owner:secondary','delivery_unknown');f.sent('other-owner@example.invalid','amir-owner');
 f.priv.prepare('INSERT INTO mail_automation_suppressions VALUES(?,?,?,?)').run('arash-owner','suppressed@example.invalid','','2026-01-01');f.priv.prepare('INSERT INTO google_send_suppressions VALUES(?,?,?)').run('arash-owner:secondary','provider-suppressed@example.invalid','2026-01-01');
 const response=await (await f.call()).json();assert.deepEqual(response.suggestions.map(x=>x.id),[other]);
});
test('registers, unsupported jurisdictions, stale/closed ads and explicit Level 1 barriers are not suggested',async()=>{
 const f=fixture();f.ad({kind:'employment_register'});f.ad({title:'General Practitioner expression of interest'});f.ad({country:'IT'});f.ad({profileScope:'amir'});f.ad({trust:'unofficial'});f.ad({seenAt:'2020-01-01T00:00:00Z'});f.ad({closingAt:'2020-01-01T00:00:00Z'});f.ad({title:'GP Practice Manager'});f.ad({fullText:'General practitioner vacancy. We cannot provide Level 1 supervision. jobs@example.invalid'});const okay=f.ad();
 const response=await (await f.call()).json();assert.deepEqual(response.suggestions.map(x=>x.id),[okay]);
});
test('central network recipients and existing preparations do not repeat in a suggested batch',async()=>{
 const f=fixture();f.ad({email:'network@example.invalid'});f.ad({email:'network@example.invalid'});const prepared=f.ad({email:'prepared@example.invalid'});
 f.priv.prepare('INSERT INTO mail_automation_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),'arash-owner',prepared,'prepared@example.invalid','primary','draft','{}',null,'2026-01-01','2026-01-01','2026-01-01');
 const response=await (await f.call()).json();assert.equal(response.suggestions.length,1);assert.equal(response.suggestions[0].publishedRecipientCount,1);
});
test('suggestion owner/profile, cadence validation and source ownership fail closed',async()=>{
 const f=fixture();f.ad();assert.equal((await f.call('profile=amir')).status,403);assert.equal((await f.call('profile=amir','amir-owner','amir')).status,403);assert.equal((await f.call('profile=arash&cadence=every-second')).status,400);
});

test('related public-page contacts and imported lead email fields never become advertisement recipients',async()=>{
 const f=fixture();f.ad({fullText:'General practitioner opportunity with no ad email.',email:null,contactEvidence:[{type:'email',value:'child@example.invalid',sourceRelation:'linked_page'}],contacts:[{email:'private-import@example.invalid'}]});
 const response=await (await f.call()).json();assert.equal(response.suggestions.length,0);
});

test('daily24hour and weekly7day windows use publication age, never source re-observation age',async()=>{
 const f=fixture(),recent=f.ad(),threeDays=f.ad({publishedAt:new Date(Date.now()-3*86400000).toISOString()}),unknown=f.ad({publishedAt:null,firstSeenAt:new Date(Date.now()-2*86400000).toISOString()});
 f.ad({publishedAt:new Date(Date.now()-8*86400000).toISOString()});f.ad({publishedAt:null,firstSeenAt:new Date(Date.now()-8*86400000).toISOString()});
 const daily=await (await f.call()).json(),weekly=await (await f.call('profile=arash&cadence=weekly')).json();
 assert.deepEqual(daily.suggestions.map(x=>x.id),[recent]);assert.deepEqual(new Set(weekly.suggestions.map(x=>x.id)),new Set([recent,threeDays,unknown]));assert.equal(weekly.publicationFallback,'first_seen_only_when_publication_missing');
});
test('suggestion period labels and next daily refresh follow Tehran date across UTC midnight boundary',async()=>{
 const original=Date.now;Date.now=()=>Date.UTC(2026,10,10,21,30);
 try{const f=fixture();f.ad();const value=await (await f.call()).json();assert.equal(value.periodKey,'2026-11-11');assert.equal(value.nextRefreshAt,'2026-11-11T20:30:00.000Z');assert.equal(value.timeZone,'Asia/Tehran');}finally{Date.now=original;}
});
