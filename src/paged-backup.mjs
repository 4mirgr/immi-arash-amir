// Owner-only, manual browser export. Every page and its manifest are encrypted
// before download; this module neither stores plaintext nor writes to providers.
import {encryptOwnerExport,decryptOwnerBackup,validateOwnerExport} from './backup-crypto.mjs';
export const MAX_PAGED_BACKUP_BYTES=64*1024*1024,MAX_PAGED_BACKUP_PAGES=300;
const FORMAT='masir-paged-browser-backup',OWNER=new Set(['amir','arash']);
const COLLECTION=/^(d1|supabase)\.([a-z][a-z0-9_]{0,100})$/,HASH=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder(),object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw Error(message);};
const bytes=value=>encoder.encode(JSON.stringify(value)).length;
const digest=async(value,provider)=>[...new Uint8Array(await provider.subtle.digest('SHA-256',encoder.encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
const active=isCurrent=>{if(!isCurrent())fail('دریافت یا بررسی متوقف شد؛ فایل کامل ساخته نشد.');};
function identity(profileId,password){if(!OWNER.has(profileId))fail('مالک معتبر همین پنل لازم است.');if(typeof password!=='string'||password.length<16||encoder.encode(password).length>1024)fail('گذرواژه باید حداقل ۱۶ نویسه و حداکثر ۱۰۲۴ بایت باشد.');}
function recovery(value){return value?.providerReconnectRequired===true&&value?.scheduledApprovalsExcluded===true&&value?.automaticJobsRequireReview===true&&value?.transportRecordsReferenceOnly===true&&value?.productionRestoreImplemented===false;}
function wrapper(profileId,collections,coverage,createdAt){return{format:'masir-owner-export',version:1,profileId,createdAt,credentialsIncluded:false,providerReconnectRequired:true,scheduledApprovalsExcluded:true,collections,coverage:{truncatedTables:[],includesReceivedMailBodies:false,includesMailDrafts:true,automaticCloudBackup:false,...coverage}};}
function manifestReady(value,profileId){
 if(!object(value)||value.format!=='masir-owner-paged-export'||value.version!==2||value.profileId!==profileId||!Number.isFinite(Date.parse(value.generatedAt))||!Array.isArray(value.collections)||!value.collections.length||value.collections.length>100||!Array.isArray(value.exclusions)||!recovery(value.recovery)||value.coverage?.atomicSnapshot!==false||value.coverage?.automaticCloudBackup!==false)fail('فهرست بخش‌های پشتیبان معتبر نیست.');
 const seen=new Set();for(const item of value.collections){if(!object(item)||!COLLECTION.test(item.id)||seen.has(item.id)||typeof item.available!=='boolean')fail('فهرست بخش‌های پشتیبان معتبر نیست.');seen.add(item.id);}
 if(!Number.isInteger(value.limits?.pageRows)||value.limits.pageRows<1||value.limits.pageRows>50||!Number.isInteger(value.limits?.pageBytes)||value.limits.pageBytes<1||value.limits.pageBytes>500000)fail('سقف صفحه‌های پشتیبان معتبر نیست.');
 return value;
}
function pageReady(page,{profileId,collection,index,exportId,startedAt,limit},provider){
 if(!object(page)||page.format!=='masir-owner-paged-export'||page.version!==2||page.profileId!==profileId||page.collection!==collection||page.page!==index||typeof page.exportId!=='string'||!/^[-a-zA-Z0-9_]{1,128}$/.test(page.exportId)||!Number.isFinite(Date.parse(page.startedAt))||!Array.isArray(page.rows)||page.rows.some(row=>!object(row))||page.rows.length>limit.pageRows||page.rowCount!==page.rows.length||typeof page.collectionComplete!=='boolean'||!HASH.test(page.sha256)||!recovery(page.recovery)||page.coverage?.atomicSnapshot!==false||page.coverage?.automaticCloudBackup!==false||bytes(page)>limit.pageBytes)fail('صفحهٔ پشتیبان با درخواست همین حساب مطابقت ندارد.');
 if(index>0&&(page.exportId!==exportId||page.startedAt!==startedAt))fail('شناسهٔ دورهٔ خروجی میان صفحه‌ها تغییر کرد.');
 if(page.collectionComplete?page.nextCursor!==null:typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor.length>2048||!page.rows.length)fail('پایان بخش یا نشانگر صفحهٔ بعد معتبر نیست.');
 return digest({collection:page.collection,exportId:page.exportId,page:page.page,rows:page.rows,collectionComplete:page.collectionComplete},provider).then(hash=>{if(hash!==page.sha256)fail('محتوای صفحه با اثرانگشت اعلام‌شده یکسان نیست.');return page;});
}
export async function createPagedBackup({profileId,password,fetchJSON,onProgress=()=>{},isCurrent=()=>true,provider=globalThis.crypto,maxPages=MAX_PAGED_BACKUP_PAGES,maxBytes=MAX_PAGED_BACKUP_BYTES}){
 identity(profileId,password);active(isCurrent);if(typeof fetchJSON!=='function'||!provider?.subtle)fail('ابزار دریافت یا رمزگذاری در دسترس نیست.');
 const source=manifestReady(await fetchJSON('backup/export/manifest?profile='+encodeURIComponent(profileId)),profileId);active(isCurrent);
 const parts=[],receipts=[],collections=[];let size=0,totalRows=0;
 for(const descriptor of source.collections.filter(item=>item.available)){
  let cursor=null,index=0,exportId=null,startedAt=null,rows=0;const cursors=new Set();
  do{
   active(isCurrent);if(parts.length>=Math.min(maxPages,MAX_PAGED_BACKUP_PAGES))fail('سقف تعداد صفحه‌های این دریافت پر شد؛ فایل کامل ساخته نشد.');
   const query=new URLSearchParams({profile:profileId,collection:descriptor.id});if(cursor)query.set('cursor',cursor);
   const page=await pageReady(await fetchJSON('backup/export/page?'+query),{profileId,collection:descriptor.id,index,exportId,startedAt,limit:source.limits},provider);active(isCurrent);
   if(!exportId){exportId=page.exportId;startedAt=page.startedAt;}
   const [,group,table]=COLLECTION.exec(descriptor.id),data={supabase:{},d1:{}};data[group][table]=page.rows;
   const part={collection:descriptor.id,exportId,index,rowCount:page.rowCount,sourceSha256:page.sha256,collectionComplete:page.collectionComplete};
   const envelope=await encryptOwnerExport(wrapper(profileId,data,{pagedPart:part,atomicSnapshot:false},page.startedAt),password,profileId,provider);active(isCurrent);
   size+=bytes(envelope);if(size>Math.min(maxBytes,MAX_PAGED_BACKUP_BYTES))fail('سقف حجم این دریافت پر شد؛ فایل کامل ساخته نشد.');
   receipts.push({...part,envelopeSha256:await digest(envelope,provider)});parts.push(envelope);rows+=page.rowCount;totalRows+=page.rowCount;index++;
   onProgress({pages:parts.length,rows:totalRows,collections:collections.length,stage:'receiving'});active(isCurrent);
   cursor=page.nextCursor;if(cursor){if(cursors.has(cursor))fail('نشانگر صفحه تکرار شد؛ دریافت کامل تأیید نمی‌شود.');cursors.add(cursor);}
  }while(cursor);
  collections.push({id:descriptor.id,exportId,startedAt,pages:index,rows,complete:true});
 }
 if(!collections.length)fail('هیچ بخش قابل دریافت در این حساب ثبت نشده است.');
 const record={format:'masir-paged-backup-manifest',version:1,profileId,createdAt:new Date().toISOString(),sourceGeneratedAt:source.generatedAt,collections,unavailable:source.collections.filter(item=>!item.available).map(item=>item.id),exclusions:source.exclusions,parts:receipts,totalRows,allAvailableCollectionsComplete:true,atomicSnapshot:false,automaticCloudBackup:false,recovery:source.recovery};
 const manifest=await encryptOwnerExport(wrapper(profileId,{supabase:{},d1:{backup_manifest:[record]}},{pagedManifest:true,atomicSnapshot:false},record.createdAt),password,profileId,provider);active(isCurrent);
 const container={format:FORMAT,version:1,parts,manifest};if(bytes(container)>Math.min(maxBytes,MAX_PAGED_BACKUP_BYTES))fail('سقف حجم این دریافت پر شد؛ فایل کامل ساخته نشد.');
 return{container,summary:{profileId,pages:parts.length,rows:totalRows,collections:collections.length,unavailable:record.unavailable.length,atomicSnapshot:false,automaticCloudBackup:false,completeSupportedCollections:true}};
}
export async function verifyPagedBackup(container,password,profileId,{provider=globalThis.crypto,isCurrent=()=>true,onProgress=()=>{}}={}){
 identity(profileId,password);active(isCurrent);
 if(!object(container)||Object.keys(container).sort().join(',')!=='format,manifest,parts,version'||container.format!==FORMAT||container.version!==1||!Array.isArray(container.parts)||!container.parts.length||container.parts.length>MAX_PAGED_BACKUP_PAGES||bytes(container)>MAX_PAGED_BACKUP_BYTES)fail('قالب یا حجم فایل چندبخشی معتبر نیست.');
 const decoded=await decryptOwnerBackup(container.manifest,password,profileId,provider);active(isCurrent);
 const record=decoded.collections.d1.backup_manifest?.[0];
 if(decoded.coverage.pagedManifest!==true||Object.keys(decoded.collections.supabase).length||Object.keys(decoded.collections.d1).join(',')!=='backup_manifest'||decoded.collections.d1.backup_manifest.length!==1||record?.format!=='masir-paged-backup-manifest'||record.version!==1||record.profileId!==profileId||record.allAvailableCollectionsComplete!==true||record.atomicSnapshot!==false||record.automaticCloudBackup!==false||!recovery(record.recovery)||!Array.isArray(record.parts)||record.parts.length!==container.parts.length||!Array.isArray(record.collections)||!record.collections.length||!Array.isArray(record.unavailable)||!Array.isArray(record.exclusions))fail('فهرست رمزگذاری‌شدهٔ فایل کامل یا معتبر نیست.');
 const collected=new Map();let totalRows=0;
 for(let i=0;i<container.parts.length;i++){
  active(isCurrent);const expected=record.parts[i],envelope=container.parts[i];if(!object(expected)||!COLLECTION.test(expected.collection)||!HASH.test(expected.sourceSha256)||!HASH.test(expected.envelopeSha256)||await digest(envelope,provider)!==expected.envelopeSha256)fail('یک بخش حذف، جابه‌جا یا تغییر کرده است.');
  const part=await decryptOwnerBackup(envelope,password,profileId,provider);active(isCurrent);validateOwnerExport(part,profileId);
  const info=part.coverage.pagedPart,{envelopeSha256,...expectedPart}=expected;if(!object(info)||JSON.stringify(info)!==JSON.stringify(expectedPart))fail('اطلاعات یک بخش با فهرست فایل تطبیق ندارد.');
  const [,group,table]=COLLECTION.exec(expected.collection),other=group==='d1'?'supabase':'d1';
  if(Object.keys(part.collections[other]).length||Object.keys(part.collections[group]).join(',')!==table)fail('یک بخش حاوی مجموعهٔ پیش‌بینی‌نشده است.');
  const rows=part.collections[group][table],prior=collected.get(expected.collection)||{pages:0,rows:0,complete:false,exportId:expected.exportId};
  if(prior.complete||expected.index!==prior.pages||expected.exportId!==prior.exportId||expected.rowCount!==rows.length||typeof expected.collectionComplete!=='boolean')fail('ترتیب یا تعداد صفحه‌های فایل معتبر نیست.');
  const hash=await digest({collection:expected.collection,exportId:expected.exportId,page:expected.index,rows,collectionComplete:expected.collectionComplete},provider);if(hash!==expected.sourceSha256)fail('محتوای صفحه با اثرانگشت اعلام‌شده یکسان نیست.');
  collected.set(expected.collection,{pages:prior.pages+1,rows:prior.rows+rows.length,complete:expected.collectionComplete,exportId:expected.exportId});totalRows+=rows.length;onProgress({pages:i+1,rows:totalRows,stage:'verifying'});
 }
 const names=new Set();for(const collection of record.collections){const actual=collected.get(collection.id);if(names.has(collection.id)||!actual||!actual.complete||collection.complete!==true||collection.pages!==actual.pages||collection.rows!==actual.rows||collection.exportId!==actual.exportId)fail('تمام صفحه‌های بخش‌های اعلام‌شده داخل فایل نیست.');names.add(collection.id);}
 if(names.size!==collected.size||totalRows!==record.totalRows)fail('جمع اطلاعات فایل کامل نیست.');active(isCurrent);
 return{profileId,pages:container.parts.length,rows:totalRows,collections:collected.size,unavailable:record.unavailable.length,atomicSnapshot:false,automaticCloudBackup:false,completeSupportedCollections:true,restored:false};
}
