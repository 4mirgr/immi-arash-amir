import React,{useEffect,useRef,useState} from 'react';
import {Download,FileCheck2,ShieldCheck,Square} from 'lucide-react';
import {api} from './api';
import {interfaceLocale,useInterfaceLanguage} from './interface-locale.mjs';
import {createPagedBackup,verifyPagedBackup,MAX_PAGED_BACKUP_BYTES} from './paged-backup.mjs';
import './paged-backup.css';

export function PagedBackup({person,notify=()=>{}}){
 useInterfaceLanguage();
 const owner=typeof person==='string'?person:person?.id,identity=useRef({owner,epoch:0}),mounted=useRef(true),sequence=useRef(0),fileInput=useRef(null);
 if(identity.current.owner!==owner)identity.current={owner,epoch:identity.current.epoch+1};
 const backendErrors={backup_record_too_large:'یک رکورد از سقف مجاز این خروجی بزرگ‌تر است؛ دریافت کامل متوقف شد.',invalid_backup_cursor:'نشانگر دریافت منقضی یا نامعتبر است؛ دریافت را از ابتدا شروع کنید.',backup_cursor_key_not_configured:'تنظیم امن دریافت صفحه‌های پشتیبان در سرور کامل نیست.',backup_collection_unavailable:'یکی از بخش‌ها در سرور در دسترس نیست؛ فایل کامل ساخته نشد.',backup_page_export_failed:'دریافت صفحهٔ پشتیبان کامل نشد؛ فایل کامل ساخته نشد.'};
 const [form,setForm]=useState({owner,password:'',confirm:''}),[result,setResult]=useState({owner,busy:'',error:'',summary:null,progress:null}),[choice,setChoice]=useState({owner,file:null});
 const state=result.owner===owner?result:{busy:'',error:'',summary:null,progress:null},fields=form.owner===owner?form:{password:'',confirm:''},selected=choice.owner===owner?choice.file:null;
 useEffect(()=>{mounted.current=true;setForm({owner,password:'',confirm:''});setResult({owner,busy:'',error:'',summary:null,progress:null});setChoice({owner,file:null});if(fileInput.current)fileInput.current.value='';return()=>{mounted.current=false;sequence.current++;};},[owner]);
 const update=(key,value)=>setForm(current=>({owner,password:current.owner===owner?current.password:'',confirm:current.owner===owner?current.confirm:'',[key]:value}));
 function cancel(){sequence.current++;setResult({owner,busy:'',error:'دریافت یا بررسی متوقف شد؛ فایل کامل ساخته نشد.',summary:null,progress:null});setForm({owner,password:'',confirm:''});}
 async function run(mode){
  if(!['amir','arash'].includes(owner)||state.busy)return;
  if(mode==='download'&&fields.password!==fields.confirm){setResult({owner,busy:'',error:'دو گذرواژه یکسان نیستند.',summary:null,progress:null});return;}
  if(fields.password.length<16){setResult({owner,busy:'',error:'گذرواژهٔ یکتا با حداقل ۱۶ نویسه انتخاب کنید.',summary:null,progress:null});return;}
  if(mode==='verify'&&(!selected||selected.size>MAX_PAGED_BACKUP_BYTES)){setResult({owner,busy:'',error:'فایل چندبخشی را انتخاب کنید؛ سقف حجم ۶۴ مگابایت است.',summary:null,progress:null});return;}
  const who=owner,epoch=identity.current.epoch,seq=++sequence.current,current=()=>mounted.current&&identity.current.owner===who&&identity.current.epoch===epoch&&sequence.current===seq;
  setResult({owner:who,busy:mode,error:'',summary:null,progress:{pages:0,rows:0}});
  const onProgress=progress=>{if(current())setResult(old=>({...old,progress}));};
  try{
   let summary;
   if(mode==='download'){
    const output=await createPagedBackup({profileId:who,password:fields.password,fetchJSON:path=>api(path),isCurrent:current,onProgress});if(!current())return;
    const blob=new Blob([JSON.stringify(output.container)],{type:'application/octet-stream'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download='masir-'+who+'-paged-'+new Date().toISOString().slice(0,10)+'.json.encrypted';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);summary=output.summary;
    notify('خروجی چندبخشی رمزگذاری شد؛ گذرواژه را جدا و امن نگه دارید.');
   }else{
    const text=await selected.text();if(!current())return;let container;try{container=JSON.parse(text);}catch{throw Error('قالب یا حجم فایل چندبخشی معتبر نیست.');}
    summary=await verifyPagedBackup(container,fields.password,who,{isCurrent:current,onProgress});if(!current())return;
    notify('تمام بخش‌های فایل روی دستگاه بررسی شدند؛ اطلاعات سایت تغییر نکرد.');
   }
   setResult({owner:who,busy:'',error:'',summary,progress:null});setForm({owner:who,password:'',confirm:''});
  }catch(error){if(current())setResult({owner:who,busy:'',error:backendErrors[error.message]||error.message||'دریافت یا بررسی فایل انجام نشد.',summary:null,progress:null});}
 }
 const number=value=>Number(value||0).toLocaleString(interfaceLocale('fa-IR'));
 return <details className="panel paged-backup-panel"><summary><ShieldCheck size={18}/>خروجی چندبخشی؛ همهٔ صفحه‌های بخش‌های پشتیبانی‌شده</summary><div className="paged-backup-content">
  <p className="section-help">برخلاف خروجی کوتاه، این روش به ۱۰۰ مورد هر جدول محدود نیست. اطلاعات همین حساب صفحه‌به‌صفحه دریافت و در مرورگر رمزگذاری می‌شوند.</p>
  <p className="notice">این فایل، پشتیبان کامل همهٔ سرویس‌ها نیست: رمزها، اتصال‌های Google و LinkedIn، فایل‌های پیوست و متن پیام‌های دریافتی داخل آن نیستند. هنگام دریافت، اطلاعات سایت ممکن است تغییر کنند؛ این نسخه یک تصویر اتمیک از دیتابیس نیست.</p>
  <p className="section-help">دریافت را دستی شروع کنید و تا پایان در همین حساب بمانید. فایل خودکار در Drive ذخیره نمی‌شود؛ گذرواژه هم ارسال یا ذخیره نمی‌شود.</p>
  <div className="paged-backup-inputs"><label>گذرواژهٔ فایل چندبخشی<input type="password" autoComplete="new-password" minLength={16} maxLength={1024} value={fields.password} disabled={!!state.busy} onChange={e=>update('password',e.target.value)}/></label><label>تکرار گذرواژه برای دریافت<input type="password" autoComplete="new-password" minLength={16} maxLength={1024} value={fields.confirm} disabled={!!state.busy} onChange={e=>update('confirm',e.target.value)}/></label></div>
  <div className="paged-backup-actions"><button type="button" className="primary" disabled={!!state.busy} onClick={()=>run('download')}><Download size={16}/>دریافت رمزگذاری‌شدهٔ همهٔ صفحه‌ها</button>{state.busy&&<button type="button" className="secondary" onClick={cancel}><Square size={15}/>توقف این دریافت یا بررسی</button>}</div>
  <details><summary>بررسی فایل چندبخشی روی دستگاه</summary><label>انتخاب فایل چندبخشی<input ref={fileInput} type="file" accept=".encrypted,.json,application/octet-stream,application/json" disabled={!!state.busy} onChange={e=>{setChoice({owner,file:e.target.files?.[0]||null});setResult({owner,busy:'',error:'',summary:null,progress:null});}}/></label><button type="button" className="secondary" disabled={!!state.busy||!selected} onClick={()=>run('verify')}><FileCheck2 size={16}/>بررسی تمام بخش‌های فایل</button><p className="section-help">این بررسی فقط رمزگذاری، تعداد و اثرانگشت بخش‌ها را کنترل می‌کند؛ چیزی به سایت برنمی‌گرداند و صف ارسال را فعال نمی‌کند.</p></details>
  {state.progress&&<p className="section-help" role="status">{state.busy==='verify'?'در حال بررسی فایل…':'در حال دریافت و رمزگذاری…'} {number(state.progress.pages)} صفحهٔ خروجی · {number(state.progress.rows)} مورد</p>}
  {state.error&&<p className="notice" role="alert">{state.error}</p>}
  {state.summary&&<div className="notice" role="status"><strong>همهٔ صفحه‌های بخش‌های در دسترس بررسی شدند.</strong><p>{number(state.summary.collections)} بخش پشتیبان · {number(state.summary.pages)} صفحهٔ خروجی · {number(state.summary.rows)} مورد</p>{state.summary.unavailable>0&&<p>{number(state.summary.unavailable)} بخش در سرور موجود نبود و داخل این خروجی نیست.</p>}<p className="section-help">این نتیجه، کامل‌بودن پشتیبان همهٔ سرویس‌ها یا آزمون بازیابی دیتابیس نیست.</p></div>}
 </div></details>;
}
