import test from 'node:test';
import assert from 'node:assert/strict';
import {createPagedBackup,verifyPagedBackup} from '../src/paged-backup.mjs';
const password='Synthetic private export password 123';
const recovery={providerReconnectRequired:true,scheduledApprovalsExcluded:true,automaticJobsRequireReview:true,transportRecordsReferenceOnly:true,productionRestoreImplemented:false};
const digest=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))).toString('hex');
function fixture({profileId='amir',count=120,alterPage}={}){
 const calls=[],rows=Array.from({length:count},(_,id)=>({id:'synthetic-'+id,name:'Private clinic '+id}));
 const manifest={format:'masir-owner-paged-export',version:2,profileId,generatedAt:'2026-11-13T12:00:00Z',collections:[{id:'d1.clinic_bank_leads',available:true},{id:'supabase.immi_profiles',available:true},{id:'d1.unavailable_table',available:false}],exclusions:['provider_credentials_and_oauth_state','received_mail_bodies_and_sync_tokens'],limits:{pageRows:50,pageBytes:500000,cursorMinutes:30},coverage:{complete:false,atomicSnapshot:false,automaticCloudBackup:false},recovery};
 async function fetchJSON(path){calls.push(path);const url=new URL(path,'https://synthetic.example/');if(url.pathname.endsWith('/manifest'))return structuredClone(manifest);assert.equal(url.searchParams.get('profile'),'amir');const collection=url.searchParams.get('collection'),page=Number(url.searchParams.get('cursor')||0),actual=collection==='d1.clinic_bank_leads'?rows.slice(page*50,page*50+50):[],complete=collection!=='d1.clinic_bank_leads'||(page+1)*50>=rows.length;
 const payload={collection,exportId:collection==='d1.clinic_bank_leads'?'bank-export-synthetic':'profile-export-synthetic',page,rows:actual,collectionComplete:complete};
 const response={format:'masir-owner-paged-export',version:2,profileId,startedAt:'2026-11-13T12:00:00Z',...payload,rowCount:actual.length,sha256:await digest(payload),nextCursor:complete?null:String(page+1),coverage:{atomicSnapshot:false,fullBackupComplete:false,automaticCloudBackup:false},recovery};return alterPage?alterPage(response):response;
 }
 return{fetchJSON,calls,manifest};
}
test('all supported collection pages encrypt and verify with exact totals, while unavailable scopes remain excluded',async()=>{
 const source=fixture(),progress=[];const output=await createPagedBackup({profileId:'amir',password,fetchJSON:source.fetchJSON,onProgress:p=>progress.push(p)});
 assert.deepEqual(output.summary,{profileId:'amir',pages:4,rows:120,collections:2,unavailable:1,atomicSnapshot:false,automaticCloudBackup:false,completeSupportedCollections:true});assert.equal(source.calls.length,5);assert(source.calls.every(path=>typeof path==='string'&&!path.includes(password)));
 assert.deepEqual(Object.keys(output.container),['format','version','parts','manifest']);const raw=JSON.stringify(output.container);assert(!raw.includes('Private clinic'));assert(!raw.includes('clinic_bank_leads'));assert(!raw.includes(password));assert(progress.length>=4);
 const result=await verifyPagedBackup(output.container,password,'amir');assert.equal(result.restored,false);assert.equal(result.rows,120);assert.equal(result.pages,4);assert.equal(result.completeSupportedCollections,true);
});
test('page omission, reordering, ciphertext tampering, wrong password and wrong owner never verify',async()=>{
 const output=await createPagedBackup({profileId:'amir',password,fetchJSON:fixture().fetchJSON});
 const missing=structuredClone(output.container);missing.parts.pop();await assert.rejects(()=>verifyPagedBackup(missing,password,'amir'));
 const reordered=structuredClone(output.container);[reordered.parts[0],reordered.parts[1]]=[reordered.parts[1],reordered.parts[0]];await assert.rejects(()=>verifyPagedBackup(reordered,password,'amir'),/حذف، جابه‌جا/);
 const changed=structuredClone(output.container);changed.parts[0].ciphertext='A'+changed.parts[0].ciphertext.slice(1);await assert.rejects(()=>verifyPagedBackup(changed,password,'amir'));
 await assert.rejects(()=>verifyPagedBackup(output.container,'A wrong synthetic password 123','amir'),/گذرواژه/);
 await assert.rejects(()=>verifyPagedBackup(output.container,password,'arash'),/پروفایل/);
});
test('server profile, hash, collection cursor, export identity and completion inconsistencies fail before a complete file exists',async()=>{
 await assert.rejects(()=>createPagedBackup({profileId:'amir',password,fetchJSON:fixture({profileId:'arash'}).fetchJSON}),/فهرست/);
 await assert.rejects(()=>createPagedBackup({profileId:'amir',password,fetchJSON:fixture({alterPage:p=>({...p,sha256:'0'.repeat(64)})}).fetchJSON}),/اثرانگشت/);
 await assert.rejects(()=>createPagedBackup({profileId:'amir',password,fetchJSON:fixture({alterPage:p=>p.page?({...p,exportId:'changed-export'}):p}).fetchJSON}),/شناسه/);
 await assert.rejects(()=>createPagedBackup({profileId:'amir',password,fetchJSON:fixture({alterPage:p=>({...p,nextCursor:p.collectionComplete?'unexpected':p.nextCursor})}).fetchJSON}),/نشانگر/);
});
test('cancellation and hard page/byte limits stop with no partial complete download',async()=>{
 const source=fixture();let current=true;await assert.rejects(()=>createPagedBackup({profileId:'amir',password,fetchJSON:source.fetchJSON,isCurrent:()=>current,onProgress:()=>{current=false;}}),/متوقف/);assert.equal(source.calls.length,2);
 const capped=fixture();await assert.rejects(()=>createPagedBackup({profileId:'amir',password,fetchJSON:capped.fetchJSON,maxPages:1}),/سقف تعداد/);assert.equal(capped.calls.length,2);
 await assert.rejects(()=>createPagedBackup({profileId:'amir',password,fetchJSON:fixture().fetchJSON,maxBytes:100}),/سقف حجم/);
});
test('weak passwords do not initiate private export and unexpected top-level plaintext is rejected',async()=>{
 const source=fixture();await assert.rejects(()=>createPagedBackup({profileId:'amir',password:'short',fetchJSON:source.fetchJSON}));assert.equal(source.calls.length,0);
 const output=await createPagedBackup({profileId:'amir',password,fetchJSON:fixture({count:0}).fetchJSON});await assert.rejects(()=>verifyPagedBackup({...output.container,plaintext:'private'},password,'amir'),/قالب/);
});
