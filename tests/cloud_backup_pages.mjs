import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleOwnerBackupRequest} from '../cloud/owner-backup.mjs';
import {handleOwnerBackupPagesRequest} from '../cloud/owner-backup-pages.mjs';
const owner='11111111-1111-4111-8111-111111111111',peer='22222222-2222-4222-8222-222222222222',at=Date.parse('2026-11-13T09:00:00Z');
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['clinic-bank-schema.sql','google-send-schema.sql','team-board-schema.sql'])db.exec(readFileSync(new URL('../cloud/'+file,import.meta.url),'utf8'));
 db.exec('CREATE TABLE google_accounts(owner_id TEXT,token_cipher TEXT);CREATE TABLE mail_scheduled_approvals(owner_id TEXT,approval TEXT);');
 db.prepare('INSERT INTO google_accounts VALUES(?,?)').run(owner,'NEVER_EXPORT_OAUTH_CREDENTIAL');db.prepare('INSERT INTO mail_scheduled_approvals VALUES(?,?)').run(owner,'NEVER_EXPORT_SEND_APPROVAL');
 const calls=[],records={};
 const env={GOOGLE_TOKEN_KEY:'synthetic-existing-encryption-key-never-returned',GOOGLE_DB:{prepare(sql){return{bind(...args){const statement=db.prepare(sql);return{async first(){return statement.get(...args)||null;},async all(){return{results:statement.all(...args)};}};}};}}};
 const context={userId:owner,profileId:'arash',rest:async(table,q)=>{calls.push({table,q});const u=new URL('https://example.invalid/'+q),key=(u.searchParams.get('order')||'id.asc').split('.')[0],direction=u.searchParams.get('order')?.endsWith('.desc')?-1:1;return(records[table]||[]).filter(x=>x.user_id===u.searchParams.get('user_id')?.slice(3)&&x.profile_id===u.searchParams.get('profile_id')?.slice(3)&&u.searchParams.getAll(key).every(filter=>filter.startsWith('lte.')?x[key]<=filter.slice(4):filter.startsWith('gt.')?x[key]>filter.slice(3):true)).sort((a,b)=>(a[key]<b[key]?-1:a[key]>b[key]?1:0)*direction).slice(0,Number(u.searchParams.get('limit')||0));}};
 return{db,env,context,records,calls};
}
const request=(path,query={})=>new Request('https://site.example/api/backup/export/'+path+'?'+new URLSearchParams(query));
async function read(f,path='page',query={},context=f.context,now=at){return handleOwnerBackupPagesRequest(request(path,query),f.env,context,now);}
function seedBank(f,count=137){for(const who of [owner,peer])for(let i=0;i<count;i++)f.db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,created_at,updated_at) VALUES(?,?,'arash',?,?,?,?)").run(who+'-'+i,who,'https://synthetic-'+i+'.example.invalid/',(who===owner?'own':'foreign')+' synthetic '+i,'2026-11-13','2026-11-13');}
async function collect(f,id,context=f.context){let cursor,all=[],pages=[];do{const response=await read(f,'page',{collection:id,...(cursor?{cursor}:{})},context);assert.equal(response.status,200);const page=await response.json();pages.push(page);all.push(...page.rows);cursor=page.nextCursor;assert(pages.length<100);}while(cursor);return{all,pages};}
async function checksum(page){const payload={collection:page.collection,exportId:page.exportId,page:page.page,rows:page.rows,collectionComplete:page.collectionComplete};return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload))))].map(b=>b.toString(16).padStart(2,'0')).join('');}

test('manifest lists explicit recoverable scope without exporting credentials or claiming an atomic/full cloud backup',async()=>{
 const f=fixture();const response=await read(f,'manifest');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const data=await response.json();assert.equal(data.coverage.complete,false);assert.equal(data.coverage.atomicSnapshot,false);assert.equal(data.coverage.automaticCloudBackup,false);assert.equal(data.recovery.scheduledApprovalsExcluded,true);assert(data.collections.find(c=>c.id==='d1.clinic_bank_leads').available);assert.equal(data.collections.find(c=>c.id==='d1.linkedin_drafts').available,false);assert(!data.collections.some(c=>/accounts|approval|oauth|raw_mime/.test(c.id)));assert.equal(data.limits.pageRows,50);
});

test('keyset traversal exports every owned bank record beyond the former100 ceiling and supports inert isolated recovery',async()=>{
 const f=fixture();seedBank(f);const {all,pages}=await collect(f,'d1.clinic_bank_leads');assert.equal(all.length,137);assert.equal(new Set(all.map(r=>r.id)).size,137);assert(all.every(r=>r.owner_id===owner));assert.deepEqual(pages.map(p=>p.rowCount),[50,50,37]);assert.deepEqual(pages.map(p=>p.page),[0,1,2]);assert(pages.slice(0,-1).every(p=>p.collectionComplete===false&&p.nextCursor));assert.equal(pages.at(-1).collectionComplete,true);assert.equal(pages.at(-1).nextCursor,null);assert.equal(new Set(pages.map(p=>p.exportId)).size,1);
 for(const page of pages){assert.equal(page.sha256,await checksum(page));assert.equal(page.coverage.fullBackupComplete,false);assert.equal(page.recovery.productionRestoreImplemented,false);assert(!JSON.stringify(page).includes('foreign synthetic'));}
 // A recovery rehearsal into a new inert staging store proves row coverage and
 // owner preservation, not an application/production restore or RLS assessment.
 const stage=new DatabaseSync(':memory:');stage.exec('CREATE TABLE quarantined(owner_id TEXT,id TEXT PRIMARY KEY,data TEXT)');for(const row of all)stage.prepare('INSERT INTO quarantined VALUES(?,?,?)').run(row.owner_id,row.id,JSON.stringify(row));assert.equal(stage.prepare('SELECT count(*) n FROM quarantined WHERE owner_id=?').get(owner).n,137);assert.equal(stage.prepare('SELECT count(*) n FROM quarantined WHERE owner_id=?').get(peer).n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM clinic_bank_leads').get().n,274);
});

test('owner, profile, collection, integrity and expiry are bound to each cursor',async()=>{
 const f=fixture();seedBank(f,60);const first=await(await read(f,'page',{collection:'d1.clinic_bank_leads'})).json(),cursor=first.nextCursor;assert(cursor);
 assert.equal((await read(f,'page',{collection:'d1.clinic_bank_leads',cursor},{...f.context,userId:peer})).status,400);assert.equal((await read(f,'page',{collection:'d1.clinic_bank_leads',cursor},{...f.context,profileId:'amir'})).status,400);assert.equal((await read(f,'page',{collection:'d1.team_board_tasks',cursor})).status,400);assert.equal((await read(f,'page',{collection:'d1.clinic_bank_leads',cursor},f.context,at+31*60*1000)).status,400);
 const [body,signature]=cursor.split('.'),tampered=(body[0]==='a'?'b':'a')+body.slice(1)+'.'+signature;assert.equal((await read(f,'page',{collection:'d1.clinic_bank_leads',cursor:tampered})).status,400);assert.equal((await read(f,'page',{collection:'d1.google_accounts'})).status,400);assert.equal((await read(f,'page',{collection:'d1.clinic_bank_leads;DROP TABLE google_accounts'})).status,400);assert.equal((await read(f,'page',{collection:'d1.clinic_bank_leads',profile:'amir'})).status,403);assert.equal((await read(f,'manifest',{},{})).status,403);
});

test('primary and secondary transport receipts are owned, omit raw MIME, and do not include approval or grant tables',async()=>{
 const f=fixture();for(const who of [owner,owner+':secondary',peer,peer+':secondary']){f.db.prepare("INSERT INTO google_send_queue(id,owner_id,profile_id,google_subject,google_email,fingerprint,recipient,subject,raw_mime,status,created_at,created_day) VALUES(?,?,'arash',?,?,?,?,?,?,'queued',?,?)").run('q-'+who,who,'sub-'+who,'sender@example.invalid','fp-'+who,'recipient@example.invalid','Synthetic subject','NEVER_EXPORT_RAW_MIME','2026-11-13','2026-11-13');}
 const {all}=await collect(f,'d1.google_send_queue');assert.deepEqual(new Set(all.map(r=>r.owner_id)),new Set([owner,owner+':secondary']));assert(!JSON.stringify(all).includes('NEVER_EXPORT'));assert(!all.some(row=>Object.hasOwn(row,'raw_mime')));assert.equal((await read(f,'page',{collection:'d1.mail_scheduled_approvals'})).status,400);assert.equal((await read(f,'page',{collection:'d1.google_accounts'})).status,400);
});

test('Supabase export is owner/profile scoped and ordered with primary-key continuation',async()=>{
 const f=fixture();f.records.immi_cv_versions=[];for(const who of [owner,peer])for(let i=0;i<124;i++)f.records.immi_cv_versions.push({id:'cv_'+String(i).padStart(5,'0'),user_id:who,profile_id:'arash',data:{text:who===owner?'own synthetic CV':'foreign'}});const {all,pages}=await collect(f,'supabase.immi_cv_versions');assert.equal(all.length,124);assert.equal(pages.length,3);assert.equal(new Set(all.map(r=>r.id)).size,124);assert(all.every(r=>r.user_id===owner));assert(f.calls.every(c=>c.q.includes('user_id=eq.'+owner)&&c.q.includes('profile_id=eq.arash')));
 f.context.rest=async()=>[{id:'cv_bad',user_id:peer,profile_id:'arash'}];assert.equal((await read(f,'page',{collection:'supabase.immi_cv_versions'})).status,503);
});

test('byte-bounded pages continue without losing rows; oversized records fail explicitly rather than truncating a backup',async()=>{
 const f=fixture();seedBank(f,4);f.db.prepare('UPDATE clinic_bank_leads SET result_json=? WHERE owner_id=?').run('x'.repeat(180000),owner);const {all,pages}=await collect(f,'d1.clinic_bank_leads');assert.equal(all.length,4);assert.equal(pages.length,2);for(const page of pages)assert(new TextEncoder().encode(JSON.stringify(page)).length<500000);
 f.db.prepare('UPDATE clinic_bank_leads SET result_json=? WHERE owner_id=?').run('x'.repeat(500000),owner);const result=await read(f,'page',{collection:'d1.clinic_bank_leads'});assert.equal(result.status,413);assert.equal((await result.json()).error,'backup_record_too_large');
});

test('initial key upper bound excludes later inserts and authored shared tasks do not copy peer-authored tasks',async()=>{
 const f=fixture();seedBank(f,60);const first=await(await read(f,'page',{collection:'d1.clinic_bank_leads'})).json();f.db.prepare("INSERT INTO clinic_bank_leads(id,owner_id,profile_id,url,name,created_at,updated_at) VALUES(?,?,'arash',?,'later','2026-11-13','2026-11-13')").run('later',owner,'https://later.example.invalid');const second=await(await read(f,'page',{collection:'d1.clinic_bank_leads',cursor:first.nextCursor})).json();assert.equal(first.rowCount+second.rowCount,60);assert(!second.rows.some(r=>r.id==='later'));
 for(const who of [owner,peer])f.db.prepare("INSERT INTO team_board_tasks VALUES(?,?,'arash','Synthetic shared task','','both','todo',NULL,'2026-11-13','2026-11-13')").run(crypto.randomUUID(),who);const tasks=await collect(f,'d1.team_board_tasks');assert.equal(tasks.all.length,1);assert.equal(tasks.all[0].creator_id,owner);
});

test('legacy export stays compatible and new requests need the existing cursor secret without disclosing storage errors',async()=>{
 const f=fixture();const response=await handleOwnerBackupRequest(request('manifest'),f.env,f.context);assert.equal(response.status,200);delete f.env.GOOGLE_TOKEN_KEY;const result=await read(f,'page',{collection:'d1.clinic_bank_leads'});assert.equal(result.status,503);assert.equal((await result.json()).error,'backup_cursor_key_not_configured');
 const post=await handleOwnerBackupPagesRequest(new Request('https://site.example/api/backup/export/manifest',{method:'POST'}),f.env,f.context);assert.equal(post.status,405);
});
