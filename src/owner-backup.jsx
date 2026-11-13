import {PagedBackup} from './paged-backup.jsx';
import {interfaceLocale} from './interface-locale.mjs';
import {googleAccountLabel} from './google-account-labels.mjs';
import React,{useLayoutEffect,useRef,useState} from 'react';
import {Download,ShieldCheck,FileCheck2,CloudUpload,RefreshCw,ExternalLink} from 'lucide-react';
import {api} from './api';
import {MixedText} from './mixed-text';
import {GoogleConnection,useGoogleConnection} from './google-tools';
import {backupSummary,decryptOwnerBackup,encryptOwnerExport,MAX_BACKUP_FILE_BYTES} from './backup-crypto.mjs';
const validOwner=value=>['amir','arash'].includes(value)?value:null;
const labels={amir:'امیر',arash:'آرش'};
const date=value=>new Date(value).toLocaleString(interfaceLocale('fa-IR'),{timeZone:'Asia/Tehran'});
function Summary({record}){return <div className="notice"><strong>خلاصهٔ نسخهٔ پشتیبان</strong><p>{labels[record.profileId]} · {record.tableCount.toLocaleString(interfaceLocale('fa-IR'))} بخش از اطلاعات · {record.rowCount.toLocaleString(interfaceLocale('fa-IR'))} مورد · {date(record.createdAt)}</p>{record.truncatedTables.length>0?<p role="status">بخشی از اطلاعات به‌دلیل سقف خروجی داخل این فایل نیست؛ این نسخه کامل نیست.</p>:<p>در این خروجی محدودشدن تعداد موارد گزارش نشده؛ با این حال فایل، پشتیبان همهٔ سرویس‌ها و مدارک شما نیست.</p>}<p className="section-help">اطلاعات سایت تغییری نکرده است. بررسی فایل روی دستگاه، داده‌ها را به سایت برنمی‌گرداند.</p>{record.truncatedTables.length>0&&<details className="workspace-disclosure"><summary>بخش‌هایی که خروجی آن‌ها محدود شده است</summary><p><MixedText>{record.truncatedTables.join('، ')}</MixedText></p></details>}</div>;}

export function OwnerBackup({person,notify=()=>{}}){
 const owner=validOwner(typeof person==='string'?person:person?.id),identity=useRef({owner,epoch:0});
 if(identity.current.owner!==owner)identity.current={owner,epoch:identity.current.epoch+1};
 const [form,setForm]=useState({owner,password:'',confirm:''}),[operation,setOperation]=useState({owner,busy:'',error:'',summary:null}),[chosen,setChosen]=useState({owner,file:null});
 const password=form.owner===owner?form.password:'',confirm=form.owner===owner?form.confirm:'',file=chosen.owner===owner?chosen.file:null,state=operation.owner===owner?operation:{busy:'',error:'',summary:null};
 const input=useRef(null),sequence=useRef(0),mounted=useRef(true);
 const secondary=useGoogleConnection(owner,Boolean(owner),'secondary');
 const [drive,setDrive]=useState({owner,loading:Boolean(owner),error:'',record:null}),[receipt,setReceipt]=useState({owner,file:null});
 const driveSequence=useRef(0),driveState=drive.owner===owner?drive:{loading:Boolean(owner),error:'',record:null},uploaded=receipt.owner===owner?receipt.file:null;
 async function refreshDrive(){
  if(!owner)return;const who=owner,epoch=identity.current.epoch,seq=++driveSequence.current;
  const active=()=>mounted.current&&identity.current.owner===who&&identity.current.epoch===epoch&&driveSequence.current===seq;
  setDrive({owner:who,loading:true,error:'',record:null});
  try{const result=await api('backup/drive/status?profile='+encodeURIComponent(who));if(active())setDrive({owner:who,loading:false,error:'',record:result});}
  catch(error){if(active())setDrive({owner:who,loading:false,error:error.message||'وضعیت مقصد دریافت نشد.',record:null});}
 }
 useLayoutEffect(()=>{setReceipt({owner,file:null});setDrive({owner,loading:Boolean(owner),error:'',record:null});refreshDrive();return()=>{driveSequence.current++;};},[owner]);
 useLayoutEffect(()=>{mounted.current=true;setForm({owner,password:'',confirm:''});setChosen({owner,file:null});setOperation({owner,busy:'',error:'',summary:null});if(input.current)input.current.value='';return()=>{mounted.current=false;sequence.current++;};},[owner]);
 const current=(who,epoch,seq)=>mounted.current&&identity.current.owner===who&&identity.current.epoch===epoch&&sequence.current===seq;
 const change=(key,value)=>setForm(previous=>({owner,password:previous.owner===owner?previous.password:'',confirm:previous.owner===owner?previous.confirm:'',[key]:value}));
 async function download(){
  if(!owner||state.busy)return;
  if(password!==confirm){setOperation({owner,busy:'',error:'دو گذرواژه یکسان نیستند.',summary:null});return;}
  if(password.length<16){setOperation({owner,busy:'',error:'گذرواژهٔ یکتا با حداقل ۱۶ نویسه انتخاب کنید.',summary:null});return;}
  const who=owner,epoch=identity.current.epoch,seq=++sequence.current;setOperation({owner,busy:'download',error:'',summary:null});
  try{
   // Only owner identity is sent. The passphrase stays in this browser closure.
   const exported=await api('backup/export?profile='+encodeURIComponent(who));if(!current(who,epoch,seq))return;
   const envelope=await encryptOwnerExport(exported,password,who);if(!current(who,epoch,seq))return;
   const summary=backupSummary(exported,who),blob=new Blob([JSON.stringify(envelope)],{type:'application/octet-stream'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
   anchor.href=url;anchor.download='masir-'+who+'-'+new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(exported.createdAt))+'.json.encrypted';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setForm({owner:who,password:'',confirm:''});setOperation({owner:who,busy:'',error:'',summary});notify('فایل رمزگذاری‌شده دریافت شد؛ گذرواژه را جدا و امن نگه دارید.');
  }catch(error){if(current(who,epoch,seq))setOperation({owner:who,busy:'',error:error.message||'ساخت پشتیبان انجام نشد.',summary:null});}
 }
 async function upload(){
  if(!owner||state.busy||!driveState.record?.backupDrive)return;
  if(password!==confirm){setOperation({owner,busy:'',error:'دو گذرواژه یکسان نیستند.',summary:null});return;}
  if(password.length<16){setOperation({owner,busy:'',error:'گذرواژهٔ یکتا با حداقل ۱۶ نویسه انتخاب کنید.',summary:null});return;}
  const who=owner,epoch=identity.current.epoch,seq=++sequence.current;setOperation({owner:who,busy:'upload',error:'',summary:null});setReceipt({owner:who,file:null});
  try{
   const exported=await api('backup/export?profile='+encodeURIComponent(who));if(!current(who,epoch,seq))return;
   const envelope=await encryptOwnerExport(exported,password,who);if(!current(who,epoch,seq))return;
   // Only authenticated ciphertext leaves this browser. Never send the export,
   // password, selected local file or any other doctor's data to this endpoint.
   const result=await api('backup/drive/upload?profile='+encodeURIComponent(who),{method:'POST',body:JSON.stringify({envelope})});if(!current(who,epoch,seq))return;
   if(result.transportVerified!==true)throw Error('تأیید یکسان‌بودن فایل منتقل‌شده دریافت نشد؛ ذخیرهٔ موفق را نمی‌توان تأیید کرد.');
   setForm({owner:who,password:'',confirm:''});setReceipt({owner:who,file:result.file||{}});setOperation({owner:who,busy:'',error:'',summary:backupSummary(exported,who)});
   notify('نسخهٔ رمزگذاری‌شده در Drive ذخیره و تطبیق فایل بررسی شد؛ زمان‌بندی خودکار هنوز فعال نیست.');refreshDrive();
  }catch(error){if(current(who,epoch,seq))setOperation({owner:who,busy:'',error:error.message||'ذخیرهٔ نسخه در Drive انجام نشد.',summary:null});}
 }
 async function verify(){
  if(!owner||state.busy)return;
  if(!file){setOperation({owner,busy:'',error:'ابتدا فایل رمزگذاری‌شده را انتخاب کنید.',summary:null});return;}
  const who=owner,epoch=identity.current.epoch,seq=++sequence.current;setOperation({owner,busy:'verify',error:'',summary:null});
  try{
   if(file.size<=0||file.size>MAX_BACKUP_FILE_BYTES)throw Error('حجم فایل مجاز نیست؛ سقف فایل پشتیبان مرورگر ۵ مگابایت است.');
   const raw=await file.text();if(!current(who,epoch,seq))return;let envelope;try{envelope=JSON.parse(raw);}catch{throw Error('فایل پشتیبان JSON رمزگذاری‌شدهٔ معتبر نیست.');}
   const restored=await decryptOwnerBackup(envelope,password,who);if(!current(who,epoch,seq))return;
   setForm({owner:who,password:'',confirm:''});setOperation({owner:who,busy:'',error:'',summary:backupSummary(restored,who)});notify('رمزگشایی محلی موفق بود؛ هیچ بازیابی در سایت انجام نشده است.');
  }catch(error){if(current(who,epoch,seq))setOperation({owner:who,busy:'',error:error.message||'بررسی فایل انجام نشد.',summary:null});}
 }
 if(!owner)return null;
 return <section className="panel" aria-label="پشتیبان رمزگذاری‌شدهٔ همین کاربر">
  <div className="section-head"><div><h3><ShieldCheck size={19}/> نسخهٔ پشتیبان خصوصی</h3><p className="section-help">فایل رمزدار از اطلاعات مجاز {labels[owner]}؛ روی دستگاه خودتان نگه دارید.</p></div></div>
  <p className="section-help">فایل در مرورگر شما رمزگذاری می‌شود. گذرواژه برای سرور ارسال یا در حساب ذخیره نمی‌شود.</p>
  <label htmlFor={'backup-password-'+owner}>گذرواژهٔ فایل؛ برای ساخت یا بررسی نسخه</label>
  <input id={'backup-password-'+owner} type="password" autoComplete="off" maxLength={512} value={password} disabled={!!state.busy} onChange={event=>change('password',event.target.value)}/>
  <p className="section-help">حداقل ۱۶ نویسه انتخاب کنید و آن را جدا از فایل، در جای امن نگه دارید. اگر فراموش شود، سایت نمی‌تواند آن را بازیابی کند.</p>
  <label htmlFor={'backup-confirm-'+owner}>تکرار گذرواژه برای ساخت فایل جدید</label>
  <input id={'backup-confirm-'+owner} type="password" autoComplete="off" maxLength={512} value={confirm} disabled={!!state.busy} onChange={event=>change('confirm',event.target.value)}/>
  {owner&&<details className="workspace-disclosure neon-cyan" open><summary><CloudUpload size={16}/> ذخیرهٔ رمزگذاری‌شده در Drive {googleAccountLabel(owner,'secondary',secondary.state.email)}</summary>
   <p className="section-help">با انتخاب شما، Drive حساب {googleAccountLabel(owner,'secondary',secondary.state.email)} مقصد این نسخه است. فقط اطلاعات مجاز همین پنل، پس از رمزگذاری در مرورگر، منتقل می‌شود؛ گذرواژه برای سرور یا Google فرستاده نمی‌شود.</p>
   <GoogleConnection person={owner} connection={secondary} notify={notify} purpose="backup" onConnected={refreshDrive}/>
   <div className="form-actions"><button type="button" className="secondary" disabled={!!state.busy||driveState.loading} onClick={refreshDrive}><RefreshCw size={15}/> بررسی مقصد پشتیبان</button><span className={'status '+(driveState.record?.backupDrive?'':'amber')}>{driveState.loading?'در حال بررسی…':driveState.record?.backupDrive?'مجوز Drive آماده است':'مجوز جداگانهٔ Drive لازم است'}</span></div>
   {driveState.record?.email&&<p className="google-mailbox" dir="ltr">{driveState.record.email}</p>}
   {driveState.error&&<p className="notice" role="alert"><MixedText>{driveState.error}</MixedText></p>}
   <button className="primary" type="button" disabled={!!state.busy||!driveState.record?.backupDrive||!password||!confirm} onClick={upload}><CloudUpload size={16}/>{state.busy==='upload'?'در حال رمزگذاری و بررسی انتقال…':'ساخت و ذخیرهٔ نسخهٔ رمزگذاری‌شده در Drive'}</button>
   {uploaded&&<p className="notice" role="status">فایل بارگذاری‌شده دوباره دریافت و یکسان‌بودن بایت‌های آن بررسی شد؛ رمزگشایی یا بازیابی دیتابیس انجام نشده است. گذرواژه را جداگانه نگه دارید.{/^[A-Za-z0-9_-]{10,200}$/.test(uploaded.id||'')&&<a href={'https://drive.google.com/file/d/'+encodeURIComponent(uploaded.id)+'/view'} target="_blank" rel="noreferrer"> مشاهدهٔ فایل در Drive <ExternalLink size={13}/></a>}</p>}
   <p className="section-help">این دکمه فقط با درخواست شما یک نسخهٔ محدود می‌سازد؛ نسخه‌برداری روزانه، پشتیبان کامل سرور و آزمون بازیابی دیتابیس هنوز فعال نیستند. اطلاعات کاربر دیگر از این مسیر منتقل نمی‌شود. اتصالِ ایمیل دوم برای Gmail حفظ می‌شود؛ در صفحهٔ Google همان حساب مقصد را انتخاب کنید.</p>
  </details>}
  <details className="workspace-disclosure" open><summary>دریافت فایل پشتیبان روی دستگاه</summary>
   <button className="primary" type="button" disabled={!!state.busy||!password||!confirm} onClick={download}><Download size={16}/>{state.busy==='download'?'در حال آماده‌کردن فایل…':'دریافت فایل رمزگذاری‌شده'}</button>
   <p className="section-help">این فایل خودکار به جای دیگری فرستاده نمی‌شود. نگه‌داشتن یک کپی جداگانه به عهدهٔ شماست.</p>
  </details>
  <details className="workspace-disclosure"><summary>بررسی فایل قبلی، بدون تغییر اطلاعات سایت</summary>
   <p className="section-help">گذرواژهٔ همان فایل را در کادر بالای این بخش وارد کنید، سپس فایل را انتخاب کنید. برای بررسی، تکرار گذرواژه لازم نیست.</p>
   <label htmlFor={'backup-file-'+owner}>فایل پشتیبان با پسوند <bdi dir="ltr">.json.encrypted</bdi></label>
   <input ref={input} id={'backup-file-'+owner} type="file" accept=".encrypted,application/octet-stream" disabled={!!state.busy} onChange={event=>setChosen({owner,file:event.target.files?.[0]||null})}/>
   <button className="secondary" type="button" disabled={!!state.busy||!password||!file} onClick={verify}><FileCheck2 size={16}/>{state.busy==='verify'?'در حال بررسی فایل…':'بررسی فایل فقط در همین مرورگر'}</button>
   <p className="section-help">فایل برای سرور ارسال نمی‌شود. فقط بازشدن با گذرواژه، قالب فایل و پروفایل ثبت‌شدهٔ آن بررسی می‌شود؛ اطلاعات از فایل به سایت برگردانده نمی‌شود.</p>
  </details>
  <details className="workspace-disclosure"><summary>این فایل چه چیزهایی دارد و چه چیزهایی ندارد؟</summary>
   <p>بخش‌های انتخاب‌شده از اطلاعات همین حساب و پیش‌نویس‌های ذخیره‌شده می‌توانند داخل فایل باشند. متن پیام‌های دریافتی Gmail، رمزها و توکن‌های اتصال، همهٔ فایل‌های Drive و تمام داده‌های سرویس‌های بیرونی داخل این خروجی نیستند.</p>
   <p className="section-help">خروجی سقف حجم و تعداد دارد؛ اگر بخشی محدود شود، در خلاصهٔ فایل نشان داده می‌شود. پس از بازیابی مستقل، اتصال سرویس‌هایی مانند Google ممکن است دوباره به رضایت شما نیاز داشته باشد.</p>
  </details>
  <details className="workspace-disclosure"><summary>پشتیبان خودکار سرور هنوز چه کاری نیاز دارد؟</summary>
   <p>مقصد این پنل، Drive حساب {googleAccountLabel(owner,'secondary',secondary.state.email)} است؛ اتصال مقصد و ذخیرهٔ دستیِ رمزگذاری‌شده با نسخه‌برداری خودکار سرور تفاوت دارد. برای حالت خودکار، خروجی کامل، حفاظت از کلید بازیابی و برنامهٔ منظم تهیهٔ نسخه هنوز باید آماده شوند.</p>
   <p className="section-help">سپس باید روی یک نسخهٔ جدا و آزمایشی امتحان کنیم که اطلاعات واقعاً برمی‌گردند و دو حساب جدا می‌مانند. این کار با بررسی فایل در مرورگر فرق دارد و نباید روی اطلاعات اصلی سایت انجام شود.</p>
  </details>
  {state.error&&<p className="notice" role="alert"><MixedText>{state.error}</MixedText></p>}{state.summary&&<Summary record={state.summary}/>}
 <PagedBackup key={owner} person={owner} notify={notify}/>
 </section>;
}
