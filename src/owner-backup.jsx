import React,{useLayoutEffect,useRef,useState} from 'react';
import {Download,ShieldCheck,FileCheck2} from 'lucide-react';
import {api} from './api';
import {MixedText} from './mixed-text';
import {backupSummary,decryptOwnerBackup,encryptOwnerExport,MAX_BACKUP_FILE_BYTES} from './backup-crypto.mjs';
const validOwner=value=>['amir','arash'].includes(value)?value:null;
const labels={amir:'امیر',arash:'آرش'};
const date=value=>new Date(value).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'});
function Summary({record}){return <div className="notice"><strong>خلاصهٔ فایلِ بررسی‌شده</strong><p>{labels[record.profileId]} · {record.tableCount.toLocaleString('fa-IR')} جدول · {record.rowCount.toLocaleString('fa-IR')} ردیف · {date(record.createdAt)}</p>{record.truncatedTables.length>0?<p role="status">خروجی محدود است و همهٔ ردیف‌های این جدول‌ها را ندارد: <MixedText>{record.truncatedTables.join('، ')}</MixedText></p>:<p>در این خروجی جدول بریده‌شده گزارش نشده است؛ این به معنی پشتیبان کامل همهٔ سرویس‌ها نیست.</p>}<p>این بررسی فقط رمزگشایی و کنترل قالب/مالک است؛ هیچ داده‌ای در سایت یا دیتابیس بازیابی نشده است.</p></div>;}
export function OwnerBackup({person,notify=()=>{}}){
 const owner=validOwner(typeof person==='string'?person:person?.id),identity=useRef({owner,epoch:0});
 if(identity.current.owner!==owner)identity.current={owner,epoch:identity.current.epoch+1};
 const [form,setForm]=useState({owner,password:'',confirm:''}),[operation,setOperation]=useState({owner,busy:'',error:'',summary:null}),[chosen,setChosen]=useState({owner,file:null});
 const password=form.owner===owner?form.password:'',confirm=form.owner===owner?form.confirm:'',file=chosen.owner===owner?chosen.file:null,state=operation.owner===owner?operation:{busy:'',error:'',summary:null};
 const input=useRef(null),sequence=useRef(0),mounted=useRef(true);
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
 return <section className="panel" aria-label="پشتیبان رمزگذاری‌شدهٔ همین کاربر"><div className="section-head"><div><h3><ShieldCheck size={19}/> پشتیبان خصوصی همین کاربر</h3><small>فضای اختصاصی {labels[owner]}</small></div></div>
  <p>دادهٔ مجاز همین حساب ابتدا دریافت و در مرورگر شما رمزگذاری می‌شود. گذرواژه، فایل رمزگشایی‌شده و محتوای بررسی محلی برای سرور ارسال نمی‌شوند.</p>
  <div className="notice">این خروجی محدود، پشتیبان کامل همهٔ سرویس‌ها نیست. متن پیام‌های دریافتی Gmail، توکن‌ها و اعتبارنامه‌های اتصال را ندارد؛ پیش‌نویس‌های مکاتبات ذخیره‌شده می‌توانند داخل آن باشند. برای اتصال دوبارهٔ ارائه‌دهندگان رضایت مستقل لازم است.</div>
  <div className="two-col"><div><label htmlFor={'backup-password-'+owner}>گذرواژهٔ پشتیبان؛ حداقل ۱۶ نویسه</label><input id={'backup-password-'+owner} type="password" autoComplete="off" maxLength={512} value={password} disabled={!!state.busy} onChange={event=>change('password',event.target.value)}/><label htmlFor={'backup-confirm-'+owner}>تکرار گذرواژه برای ساخت فایل جدید</label><input id={'backup-confirm-'+owner} type="password" autoComplete="off" maxLength={512} value={confirm} disabled={!!state.busy} onChange={event=>change('confirm',event.target.value)}/><button className="primary" type="button" disabled={!!state.busy||!password||!confirm} onClick={download}><Download size={16}/>{state.busy==='download'?'در حال ساخت فایل…':'دریافت پشتیبان رمزگذاری‌شده'}</button><p className="muted">گذرواژه را در مدیر رمز امن نگه دارید. سایت آن را ذخیره نمی‌کند و امکان بازیابی گذرواژهٔ فراموش‌شده ندارد.</p></div>
  <div><h4>بررسی محلی فایل قبلی؛ بدون بازیابی</h4><label htmlFor={'backup-file-'+owner}>فایل <bdi dir="ltr">.json.encrypted</bdi></label><input ref={input} id={'backup-file-'+owner} type="file" accept=".encrypted,application/octet-stream" disabled={!!state.busy} onChange={event=>setChosen({owner,file:event.target.files?.[0]||null})}/><p className="muted">گذرواژهٔ همان فایل را در کادر گذرواژه وارد کنید؛ برای بررسی، تکرار آن لازم نیست. فایل متعلق به پروفایل دیگر پذیرفته نمی‌شود.</p><button className="secondary" type="button" disabled={!!state.busy||!password||!file} onClick={verify}><FileCheck2 size={16}/>{state.busy==='verify'?'در حال بررسی…':'رمزگشایی و بررسی فقط در مرورگر'}</button></div></div>
  {state.error&&<p className="notice" role="alert"><MixedText>{state.error}</MixedText></p>}{state.summary&&<Summary record={state.summary}/>}
 </section>;
}
