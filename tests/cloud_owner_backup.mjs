import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleOwnerBackupRequest} from '../cloud/owner-backup.mjs';
function fixture(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE linkedin_drafts(owner_id TEXT,text TEXT);CREATE TABLE google_accounts(owner_id TEXT,token_cipher TEXT)');db.prepare('INSERT INTO linkedin_drafts VALUES(?,?)').run('a','own synthetic draft');db.prepare('INSERT INTO linkedin_drafts VALUES(?,?)').run('b','foreign synthetic draft');db.prepare('INSERT INTO google_accounts VALUES(?,?)').run('a','NEVER_EXPORT_PROVIDER_CREDENTIAL');const calls=[];const env={GOOGLE_DB:{prepare(sql){return{bind(...args){const p=db.prepare(sql);return{async all(){return{results:p.all(...args)}}};}}}}};const context={userId:'a',profileId:'arash',rest:async(table,q)=>{calls.push({table,q});return[{profile_id:'arash',user_id:'a',data:{text:'own synthetic CV'}}];}};return{db,calls,env,context};}
const req=(suffix='',method='GET')=>new Request('https://site.example/api/backup/export'+suffix,{method});
test('export contains only trusted own data and never provider credentials',async()=>{const {calls,env,context}=fixture();const r=await handleOwnerBackupRequest(req(),env,context);assert.equal(r.status,200);const body=await r.json(),text=JSON.stringify(body);assert(text.includes('own synthetic draft'));assert(!text.includes('foreign synthetic draft'));assert(!text.includes('NEVER_EXPORT_PROVIDER_CREDENTIAL'));assert.equal(body.credentialsIncluded,false);assert.equal(body.providerReconnectRequired,true);assert.equal(calls.length,7);assert(calls.every(x=>x.q.includes('profile_id=eq.arash')&&x.q.includes('user_id=eq.a')));assert.equal(r.headers.get('Cache-Control'),'no-store');});
test('forged profile, missing owner and write requests cannot export',async()=>{const {calls,env,context}=fixture();assert.equal((await handleOwnerBackupRequest(req('?profile=amir'),env,context)).status,403);assert.equal((await handleOwnerBackupRequest(req(),env,{})).status,403);assert.equal((await handleOwnerBackupRequest(req('','POST'),env,context)).status,405);assert.equal(calls.length,0);});
test('bounded exports explicitly report truncation rather than claiming completeness',async()=>{const {db,env,context}=fixture();for(let i=0;i<110;i++)db.prepare('INSERT INTO linkedin_drafts VALUES(?,?)').run('a','Synthetic '+i);const body=await(await handleOwnerBackupRequest(req(),env,context)).json();assert.equal(body.collections.d1.linkedin_drafts.length,100);assert(body.coverage.truncatedTables.includes('d1.linkedin_drafts'));assert.equal(body.coverage.automaticCloudBackup,false);});
test('oversized private export fails without partial backup',async()=>{const {env,context}=fixture();context.rest=async()=>[{data:'x'.repeat(400000)}];const r=await handleOwnerBackupRequest(req(),env,context);assert.equal(r.status,413);assert(!JSON.stringify(await r.json()).includes('x'.repeat(100)));});


test('each doctor export includes only their own primary and secondary sending records, without MIME or grants',async()=>{
 const {db,env,context}=fixture();db.exec(readFileSync(new URL('../cloud/google-send-schema.sql',import.meta.url),'utf8'));
 for(const [owner,profile]of [['a','arash'],['a:secondary','arash'],['b','amir'],['b:secondary','amir']]){
  db.prepare('INSERT INTO google_send_queue(id,owner_id,profile_id,google_subject,google_email,fingerprint,recipient,subject,raw_mime,status,created_at,created_day) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('queue-'+owner,owner,profile,'sub-'+owner,'sender-'+owner.replace(':','-')+'@example.invalid','fp-'+owner,'recipient@example.invalid','Synthetic '+owner,'NEVER_EXPORT_RAW_MIME','queued','2026-11-05T00:00:00Z','2026-11-05');
  db.prepare('INSERT INTO google_send_suppressions VALUES(?,?,?)').run(owner,'recipient@example.invalid','2026-11-05T00:00:00Z');
 }
 const arash=await(await handleOwnerBackupRequest(req(),env,context)).json();assert.deepEqual(new Set(arash.collections.d1.google_send_queue.map(x=>x.owner_id)),new Set(['a','a:secondary']));assert.deepEqual(new Set(arash.collections.d1.google_send_suppressions.map(x=>x.owner_id)),new Set(['a','a:secondary']));
 const amir=await(await handleOwnerBackupRequest(req(),env,{userId:'b',profileId:'amir',rest:async()=>[]})).json();assert.deepEqual(new Set(amir.collections.d1.google_send_queue.map(x=>x.owner_id)),new Set(['b','b:secondary']));
 for(const data of [arash,amir]){const text=JSON.stringify(data);assert(!text.includes('NEVER_EXPORT_RAW_MIME'));assert(!text.includes('NEVER_EXPORT_PROVIDER_CREDENTIAL'));assert.equal(data.scheduledApprovalsExcluded,true);assert.equal(data.coverage.automaticCloudBackup,false);}
 assert.equal((await handleOwnerBackupRequest(req(),env,{...context,userId:'a:secondary'})).status,403);
});

test('GP goal and preparation notes export only the authenticated owner records',async()=>{
 const {db,env,context}=fixture();db.exec(readFileSync(new URL('../cloud/gp-workflow-schema.sql',import.meta.url),'utf8'));
 for(const owner of ['a','b']){db.prepare('INSERT INTO gp_workflow_settings VALUES(?,?,?,?)').run(owner,'arash','pesci_readiness','2026-11-05');db.prepare('INSERT INTO gp_opportunity_progress VALUES(?,?,?,?,?,?,?)').run(owner,'opp_'+owner,'arash','clinic_identified','Synthetic '+owner,'','2026-11-05');}
 const data=await(await handleOwnerBackupRequest(req(),env,context)).json();assert.equal(data.collections.d1.gp_workflow_settings.length,1);assert.equal(data.collections.d1.gp_workflow_settings[0].owner_id,'a');assert.equal(data.collections.d1.gp_opportunity_progress[0].note,'Synthetic a');assert(!JSON.stringify(data).includes('Synthetic b'));
});
