// Owner-only browser backup. Passphrases and decrypted files never leave this module.
const FORMAT='masir-browser-backup',VERSION=1,ITERATIONS=250000;
const encoder=new TextEncoder(),AAD=encoder.encode('masir-browser-backup:v1');
const OWNERS=new Set(['amir','arash']);
export const MAX_EXPORT_BYTES=3*1024*1024;
export const MAX_BACKUP_FILE_BYTES=5*1024*1024;
export class BackupCryptoError extends Error{constructor(message){super(message);this.name='BackupCryptoError';}}
const fail=message=>{throw new BackupCryptoError(message);};
function cryptoReady(provider){if(!provider?.subtle||typeof provider.getRandomValues!=='function')fail('رمزگذاری امن در این مرورگر در دسترس نیست؛ از HTTPS و مرورگر به‌روز استفاده کنید.');return provider;}
function ownerReady(owner){if(!OWNERS.has(owner))fail('مالک معتبر همین پنل لازم است.');}
function passwordBytes(password){if(typeof password!=='string'||password.length<16||encoder.encode(password).length>1024)fail('گذرواژه باید حداقل ۱۶ نویسه و حداکثر ۱۰۲۴ بایت باشد.');return encoder.encode(password);}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateOwnerExport(data,expectedOwner){
 ownerReady(expectedOwner);
 if(!object(data)||data.format!=='masir-owner-export'||data.version!==1||!OWNERS.has(data.profileId)||data.profileId!==expectedOwner)fail('فایل متعلق به همین پروفایل نیست یا قالب آن پشتیبانی نمی‌شود.');
 if(typeof data.createdAt!=='string'||!Number.isFinite(Date.parse(data.createdAt))||data.credentialsIncluded!==false||data.providerReconnectRequired!==true)fail('مشخصات ایمنی خروجی معتبر نیست.');
 if(!object(data.collections)||!object(data.collections.supabase)||!object(data.collections.d1)||!object(data.coverage)||!Array.isArray(data.coverage.truncatedTables)||data.coverage.truncatedTables.some(v=>typeof v!=='string'||v.length>200))fail('ساختار خروجی پشتیبان معتبر نیست.');
 const excluded=data.coverage.includesReceivedMailBodies===false||data.coverage.includesMailBodies===false;
 if(!excluded||data.coverage.includesReceivedMailBodies===true||data.coverage.includesMailBodies===true)fail('این قالب برای خروجی بدون متن پیام‌های دریافتی Gmail است.');
 for(const tables of [data.collections.supabase,data.collections.d1])for(const [name,rows] of Object.entries(tables))if(name.length>200||!Array.isArray(rows))fail('مجموعه‌های خروجی باید جدول‌های ردیفی باشند.');
 return data;
}
function toBase64(bytes){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
function fromBase64(value,maximum){if(typeof value!=='string'||!value||value.length>Math.ceil(maximum/3)*4+4||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('فایل رمزگذاری‌شده معتبر نیست.');try{const raw=atob(value);if(raw.length>maximum)fail('فایل از سقف حجم مجاز بزرگ‌تر است.');return Uint8Array.from(raw,c=>c.charCodeAt(0));}catch(error){if(error instanceof BackupCryptoError)throw error;fail('فایل رمزگذاری‌شده معتبر نیست.');}}
async function derive(provider,password,salt,usage){const material=await provider.subtle.importKey('raw',passwordBytes(password),'PBKDF2',false,['deriveKey']);return provider.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:ITERATIONS,salt},material,{name:'AES-GCM',length:256},false,[usage]);}
export async function encryptOwnerExport(data,password,expectedOwner,provider=globalThis.crypto){
 validateOwnerExport(data,expectedOwner);cryptoReady(provider);passwordBytes(password);
 let raw;try{raw=encoder.encode(JSON.stringify(data));}catch{fail('خروجی JSON قابل رمزگذاری نیست.');}
 if(raw.length>MAX_EXPORT_BYTES)fail('خروجی از سقف حجم پشتیبان مرورگر بزرگ‌تر است.');
 const salt=provider.getRandomValues(new Uint8Array(16)),iv=provider.getRandomValues(new Uint8Array(12)),key=await derive(provider,password,salt,'encrypt');
 const ciphertext=await provider.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128},key,raw);
 return {format:FORMAT,version:VERSION,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,cipher:'AES-256-GCM',salt:toBase64(salt),iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(ciphertext))};
}
export async function decryptOwnerBackup(envelope,password,expectedOwner,provider=globalThis.crypto){
 ownerReady(expectedOwner);cryptoReady(provider);passwordBytes(password);
 const fields=['format','version','kdf','iterations','cipher','salt','iv','ciphertext'];
 if(!object(envelope)||Object.keys(envelope).length!==fields.length||fields.some(key=>!Object.hasOwn(envelope,key))||envelope.format!==FORMAT||envelope.version!==VERSION||envelope.kdf!=='PBKDF2-SHA256'||envelope.iterations!==ITERATIONS||envelope.cipher!=='AES-256-GCM')fail('قالب رمزگذاری یا نسخهٔ فایل پشتیبانی نمی‌شود.');
 const salt=fromBase64(envelope.salt,16),iv=fromBase64(envelope.iv,12),ciphertext=fromBase64(envelope.ciphertext,MAX_EXPORT_BYTES+16);
 if(salt.length!==16||iv.length!==12||ciphertext.length<=16)fail('فایل رمزگذاری‌شده معتبر نیست.');
 const key=await derive(provider,password,salt,'decrypt');let raw;
 try{raw=await provider.subtle.decrypt({name:'AES-GCM',iv,additionalData:AAD,tagLength:128},key,ciphertext);}catch{fail('گذرواژه نادرست است یا فایل تغییر کرده است.');}
 if(raw.byteLength>MAX_EXPORT_BYTES)fail('خروجی از سقف حجم مجاز بزرگ‌تر است.');
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('محتوای رمزگشایی‌شده JSON معتبر نیست.');}
 return validateOwnerExport(data,expectedOwner);
}
export function backupSummary(data,expectedOwner){validateOwnerExport(data,expectedOwner);const tables=[...Object.values(data.collections.supabase),...Object.values(data.collections.d1)];return {profileId:data.profileId,createdAt:data.createdAt,tableCount:tables.length,rowCount:tables.reduce((n,rows)=>n+rows.length,0),truncatedTables:[...data.coverage.truncatedTables],includesMailDrafts:data.coverage.includesMailDrafts===true,includesReceivedMailBodies:false,credentialsIncluded:false,providerReconnectRequired:true};}
