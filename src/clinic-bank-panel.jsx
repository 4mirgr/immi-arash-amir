import {ClinicEnquiry} from './clinic-enquiry';
import React,{useEffect,useRef,useState} from 'react';
import {Search,ExternalLink,Database,RefreshCw} from 'lucide-react';
import {api,apiRetryAt,storageDailyReadLimitNotice} from './api';
import {interfaceLocale,useInterfaceLanguage} from './interface-locale.mjs';
import {dualCalendarInstant} from './calendar-result-dates.mjs';
import {MixedText} from './mixed-text';
import './clinic-bank-panel.css';
const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const stateLabels={pending:'در صف بررسی',reading:'در حال خواندن',public_contacts_found:'تماس منتشرشده پیدا شد',public_page_read:'صفحه خوانده شد؛ تماس پیدا نشد',robots_blocked:'خواندن خودکار مجاز نیست',access_denied:'دسترسی محدود است',membership_check_unavailable:'بررسی دسترسی حساب موقتاً ممکن نیست',owner_inactive:'حساب غیرفعال است',pdf_reader_required:'نیازمند خواندن PDF',invalid_url:'نشانی قابل بررسی نیست',request_budget_exhausted:'سقف بررسی این نوبت پر شد؛ بررسی دوباره زمان‌بندی می‌شود.',robots_unavailable:'قواعد دسترسی سایت موقتاً دریافت نشد.',fetch_failed:'ارتباط با سایت برقرار نشد.',http_error:'سایت موقتاً پاسخ معتبر نداد.',http_rejected:'صفحه در این نشانی قابل دریافت نیست.',body_too_large:'حجم صفحه از سقف پردازش بیشتر است.',redirect_limit:'تغییر مسیر سایت نیازمند بررسی است.'};
const clinicDate=value=>dualCalendarInstant(value)?.jalali||null;
const POLL_MS=5*60000;
export function ClinicBankPanel({person,ownerId='',onSearch}){
 const language=useInterfaceLanguage(),en=language==='en',t=(fa,english)=>en?english:fa;
 const [open,setOpen]=useState(false),[filter,setFilter]=useState('contacts'),[page,setPage]=useState(0),[snapshot,setSnapshot]=useState(null),[failed,setFailed]=useState(null),[busy,setBusy]=useState(false),epoch=useRef(0),refresh=useRef(null),nextAutomatic=useRef({scope:null,at:0}),retry=useRef({account:null,until:0,error:null});
 const account=ownerId+':'+person,scope=account+':'+filter+':'+page;
 if(retry.current.account!==account)retry.current={account,until:0,error:null};
 useEffect(()=>{
  if(!open){refresh.current=null;return;}
  let mounted=true,flight=false,requestController=null;const seq=++epoch.current;
  setBusy(false);
  setSnapshot(previous=>previous?.scope===scope?previous:null);setFailed(retry.current.until>Date.now()?{scope,error:retry.current.error}:null);
  if(nextAutomatic.current.scope!==scope)nextAutomatic.current={scope,at:0};
  const foreground=()=>document.visibilityState==='visible'&&navigator.onLine!==false&&(typeof document.hasFocus!=='function'||document.hasFocus());
  async function load(manual=false){
   if(flight||!mounted||!foreground())return;
   const now=Date.now();if(retry.current.until>now){setFailed({scope,error:retry.current.error});return;}
   if(!manual&&now<nextAutomatic.current.at)return;
   flight=true;nextAutomatic.current={scope,at:now+POLL_MS};setBusy(true);
   const controller=new AbortController();requestController=controller;const timeout=setTimeout(()=>controller.abort(),20000);
   try{
    const [status,rows]=await Promise.all([api('clinic-bank/status?profile='+person,{signal:controller.signal}),api('clinic-bank/items?'+new URLSearchParams({profile:person,status:filter,limit:'10',offset:String(page*10)}),{signal:controller.signal})]);
    if(mounted&&seq===epoch.current){setSnapshot({scope,status,items:rows.items||[]});setFailed(null);retry.current={account,until:0,error:null};}
   }catch(error){if(mounted&&seq===epoch.current){const until=apiRetryAt(error);if(until>now)retry.current={account,until,error};setFailed({scope,error});}}
   finally{clearTimeout(timeout);controller.abort();if(requestController===controller)requestController=null;flight=false;if(mounted&&seq===epoch.current)setBusy(false);}
  }
  refresh.current=()=>load(true);const tick=()=>load();tick();
  const timer=setInterval(tick,POLL_MS);window.addEventListener('focus',tick);window.addEventListener('online',tick);document.addEventListener('visibilitychange',tick);
  return()=>{mounted=false;refresh.current=null;requestController?.abort();clearInterval(timer);window.removeEventListener('focus',tick);window.removeEventListener('online',tick);document.removeEventListener('visibilitychange',tick);};
 },[open,person,ownerId,filter,page]);
 const data=snapshot?.scope===scope?snapshot:null,counts=data?.status.counts||{},num=n=>Number(n||0).toLocaleString(interfaceLocale('fa-IR'));
 const failure=failed?.scope===scope?failed.error:null,quotaNotice=storageDailyReadLimitNotice(failure,en);
 return <details className="arash-fold neon-cyan clinic-bank-panel" onToggle={e=>setOpen(e.currentTarget.open)}><summary><Database size={17}/>بانک خصوصی کلینیک‌ها؛ بررسی خودکار وب‌سایت‌ها</summary>{open&&<div className="arash-fold-body">
  <p className="section-help">وب‌سایت‌های فایل‌های اکسل به‌تدریج خوانده می‌شوند تا اطلاعات تماس منتشرشده به‌روز شود. این مراکز سرنخ‌اند؛ داشتن ایمیل به معنی آگهی استخدام یا امکان سوپرویژن نیست.</p>
  {data&&<div className="clinic-bank-counts"><span>وب‌سایت‌ها <strong>{num(counts.total)}</strong></span><span>بررسی‌شده <strong>{num(counts.read)}</strong></span><span>دارای تماس <strong>{num(counts.withContacts)}</strong></span><span>در صف بررسی <strong>{num(counts.pending)}</strong></span></div>}
  {data&&<p className="section-help">{data.status.enabled?(data.status.lastRunAt?'چرخهٔ خودکار فعال است؛ هر نوبت حداکثر دو وب‌سایت بررسی می‌شود.':'بانک برای بررسی زمان‌بندی شده؛ هنوز اجرایی ثبت نشده است.'):'چرخهٔ خودکار این بانک هنوز فعال نشده است.'} هدف بازبینی هفت‌روزه است؛ زمان واقعی به طول صف و محدودیت سایت‌ها بستگی دارد.</p>}
  {data&&clinicDate(data.status.lastRunAt)&&<p className="section-help">آخرین بررسی ثبت‌شده، به وقت تهران: <time dateTime={data.status.lastRunAt}><bdi>{clinicDate(data.status.lastRunAt)}</bdi></time></p>}
  <div className="clinic-bank-controls"><label>نمایش<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="contacts">دارای اطلاعات تماس</option><option value="pending">منتظر بررسی</option><option value="blocked">نیازمند رسیدگی</option><option value="all">همهٔ مراکز</option></select></label><button className="secondary" type="button" disabled={busy} onClick={()=>refresh.current?.()}><RefreshCw size={14} className={busy?'spin':''}/>{t('تازه‌سازی بانک','Refresh clinic bank')}</button><span className="muted">{busy?'در حال دریافت…':''}</span></div>
  {failure&&<p className="notice" role="status">{quotaNotice||t('وضعیت تازهٔ بانک دریافت نشد؛ اطلاعات قبلی حفظ شده و دوباره بررسی می‌شود.','The latest clinic bank information could not be loaded. Existing information is preserved and will be checked again.')}</p>}
  <div className="clinic-bank-items">{data?.items.map(item=><article key={item.id}><strong dir="auto"><MixedText>{item.name||new URL(item.url).hostname}</MixedText></strong><small><MixedText>{stateLabels[item.status]||'بررسی سایت هنوز کامل نشده است'}</MixedText></small>{safeLink(item.url)&&<a href={item.url} target="_blank" rel="noreferrer">وب‌سایت مرکز <ExternalLink size={12}/></a>}{item.stale&&<span className="section-help">تماس‌ها نیازمند بررسی تازه‌اند.</span>}{clinicDate(item.lastAttemptAt||item.readAt)&&<small>آخرین تلاش، تهران: <time dateTime={item.lastAttemptAt||item.readAt}><bdi>{clinicDate(item.lastAttemptAt||item.readAt)}</bdi></time></small>}{clinicDate(item.lastSuccessAt)&&<small>آخرین دریافت موفق، تهران: <time dateTime={item.lastSuccessAt}><bdi>{clinicDate(item.lastSuccessAt)}</bdi></time></small>}<details><summary>اطلاعات منتشرشده و منبع</summary>{item.contacts?.length?item.contacts.map((contact,index)=><div className="clinic-bank-contact" key={index}><bdi dir="ltr">{contact.value}</bdi>{contact.quote&&<blockquote dir="auto" data-no-translate>{contact.quote}</blockquote>}{safeLink(contact.sourceURL)&&<a href={contact.sourceURL} target="_blank" rel="noreferrer">منبع تماس</a>}</div>):<p className="section-help">هنوز اطلاعات تماسی از صفحهٔ عمومی ثبت نشده است.</p>}</details><button className="secondary" type="button" onClick={()=>onSearch(item.name||new URL(item.url).hostname)}><Search size={14}/>جست‌وجوی آگهی‌های این مرکز</button><ClinicEnquiry key={person+':'+item.id} person={person} itemId={item.id}/></article>)}</div>
  {data&&!data.items.length&&<p className="section-help">در این گروه هنوز مرکزی ثبت نشده است.</p>}
  <div className="clinic-bank-paging"><button className="secondary" disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>قبلی</button><span>{num(page+1)}</span><button className="secondary" disabled={busy||!data||data.items.length<10} onClick={()=>setPage(p=>p+1)}>بعدی</button></div>
 </div>}</details>;
}
