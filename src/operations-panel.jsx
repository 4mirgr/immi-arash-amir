import {googleAccountLabel} from './google-account-labels.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
import {MixedText} from './mixed-text';
const MAIN_SITE='https://drgerami-md.ir/aus';
const date=value=>{const parsed=new Date(value);return value&&Number.isFinite(parsed.getTime())?parsed.toLocaleString('fa-IR',{timeZone:'Asia/Tehran'}):'زمانی ثبت نشده';};
function pageLocation(){if(typeof window==='undefined')return {address:'',canonical:false};const {origin,pathname,hostname}=window.location;return {address:origin+pathname,canonical:hostname==='drgerami-md.ir'&&/^\/aus(?:\/|$)/.test(pathname)};}
const sourceLabel=source=>!source.executable?'فقط لینک مرجع؛ دریافت خودکار ندارد':({updated:'دریافت موفق ثبت شده',failed:'آخرین دریافت ناموفق بود',not_checked:'هنوز بررسی نشده',partial:'بخشی از نتایج دریافت شده',cooldown:'در انتظار نوبت بعد',paused:'دریافت موقتاً متوقف است'}[source.status]||'وضعیت دریافت نیازمند بررسی است');
export function OperationsPanel({person,notify=()=>{}}){
 const owner=useRef({person,epoch:0});if(owner.current.person!==person)owner.current={person,epoch:owner.current.epoch+1};
 const alive=useRef(true),loads=useRef(0),sourceLoads=useRef(0);
 const [data,setData]=useState(null),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[sourceRecord,setSourceRecord]=useState(null);
 const epoch=owner.current.epoch;const valid=()=>alive.current&&owner.current.person===person&&owner.current.epoch===epoch;
 async function load(){
  const sequence=++loads.current;setError('');
  const paths=['operations/status','google/status','linkedin/connection','telegram/status',...(person==='amir'?['google/status?mailbox=secondary']:[])];
  const results=await Promise.allSettled(paths.map(path=>api(path+(path.includes('?')?'&':'?')+'profile='+person)));
  if(!valid()||sequence!==loads.current)return;
  setData({person,operations:results[0].status==='fulfilled'?results[0].value:null,google:results[1].status==='fulfilled'?results[1].value:null,linkedin:results[2].status==='fulfilled'?results[2].value:null,telegram:results[3].status==='fulfilled'?results[3].value:null,secondary:results[4]?.status==='fulfilled'?results[4].value:null});
  if(results.some(r=>r.status==='rejected'))setError('برخی وضعیت‌ها دریافت نشد؛ آماده‌بودن آن بخش تأیید نشده است.');
 }
 useEffect(()=>{alive.current=true;setData(null);setConfirmed(false);setBusy(false);setError('');setSourceRecord(null);load();return()=>{alive.current=false;loads.current++;sourceLoads.current++;};},[person]);
 const current=data?.person===person?data:null,sourceState=sourceRecord?.person===person?sourceRecord:null,location=pageLocation();
 async function loadSources(){
  const sequence=++sourceLoads.current;setSourceRecord({person,loading:true,error:'',sources:[]});
  try{const result=await api('opportunities/sources?profile='+encodeURIComponent(person));if(!valid()||sequence!==sourceLoads.current)return;setSourceRecord({person,loading:false,error:'',sources:Array.isArray(result.sources)?result.sources:[]});}
  catch(e){if(valid()&&sequence===sourceLoads.current)setSourceRecord({person,loading:false,error:e.message||'وضعیت منابع دریافت نشد.',sources:[]});}
 }
 async function cancel(){
  if(!confirmed)return;setBusy(true);
  try{await api('operations/cancel-pending?profile='+person,{method:'POST',body:JSON.stringify({confirmCancel:true})});if(!valid())return;setConfirmed(false);notify('زمان‌بندی‌های منتظر همین حساب لغو و اعلان تلگرام خاموش شد؛ عملیات از قبل شروع‌شده ممکن است تکمیل شود.');await load();}
  catch(e){if(valid())setError(e.message);}finally{if(valid())setBusy(false);}
 }
 const sources=sourceState?.sources||[],configured=sources.filter(source=>source.executable).length,successful=sources.filter(source=>source.lastSuccessAt).length;
 return <section className="panel">
  <div className="section-head"><div><h3>وضعیت خدمات و کارهای باقی‌مانده</h3><p className="section-help">اتصال‌های همین حساب، دسترسی سایت و موارد نیازمند پیگیری.</p></div><button className="secondary" disabled={busy} onClick={load}>تازه‌سازی وضعیت</button></div>
  {error&&<p className="notice" role="alert"><MixedText>{error}</MixedText></p>}
  {!current?<p className="section-help">در حال بررسی اتصال‌های همین حساب…</p>:<>
   <details className="workspace-disclosure" open><summary>خلاصهٔ اتصال‌ها و زمان‌بندی‌ها</summary>
    <p className="section-help">«متصل» یعنی مجوزی در پرونده ثبت است؛ برای تأیید عملکرد هر خدمت، همان عملیات هم باید موفق اجرا شود.</p>
    <div className="cv-details">
     <span>{googleAccountLabel(person,'primary',current.google?.email)}</span><b>{current.google?.connected?'متصل؛ اعتبار مجوز هنگام استفاده بررسی می‌شود':'نیازمند اتصال یا بررسی مجوز'}</b>
     {person==='amir'&&<><span>{googleAccountLabel(person,'secondary',current.secondary?.email)}</span><b>{current.secondary?.connected?'متصل؛ صندوق و فرستندهٔ مستقل':'منتظر اتصال شخصی یا بررسی مجوز'}</b></>}
     <span>LinkedIn همین کاربر</span><b>{current.linkedin?.connected?'اتصال پایه برقرار است':'نیازمند اتصال شخصی'}؛ آمار پیشرفته و شبکهٔ کامل مجوز جدا می‌خواهند</b>
     <span>Telegram</span><b>{current.telegram?.connected?(current.telegram.enabled?'متصل و اعلان فعال':'متصل؛ اعلان خاموش'):current.telegram?.webhookRegistered?'دریافت پیام بات آماده است؛ چت شخصی هنوز متصل نشده':'راه‌اندازی دریافت پیام بات و اتصال چت شخصی لازم است'}</b>
     <span>زمان‌بندی‌های منتظر</span><b>{current.operations?`${current.operations.pending.mail} ایمیل و ${current.operations.pending.linkedin} پست`:'وضعیت دریافت نشده'}</b>
     <span>بررسی مجوز حساب پیش از ارسال</span><b>{current.operations?.membershipGateConfigured?'تنظیم شده؛ هنگام ارسال دوباره بررسی می‌شود':'آماده نیست؛ ارسال خودکار باید مسدود بماند'}</b>
    </div>
   </details>
   <details className="workspace-disclosure"><summary>دامنهٔ فعال و مشکل اینترنت همراه</summary>
    <p>دامنهٔ اصلی پروژه راه‌اندازی شده است: <a href={MAIN_SITE} target="_blank" rel="noreferrer"><bdi dir="ltr">{MAIN_SITE}</bdi></a></p>
    {location.address&&<p className="section-help">نشانی بازشدهٔ این صفحه: <bdi dir="ltr">{location.address}</bdi>{location.canonical?'؛ اکنون از دامنهٔ اصلی استفاده می‌کنید.':'؛ پیوند بالا نشانی اصلی پروژه است.'}</p>}
    <p>طبق گزارش شما، سایت با وای‌فای بدون VPN باز می‌شود، اما روی اینترنت همراه اول مشکل دارد. علت و گسترهٔ این مشکل هنوز با اندازه‌گیری از شبکه‌های مختلف تأیید نشده است.</p>
    <p className="section-help">بررسی بعدی: بازشدن همین نشانی روی همراه اول، متن خطای مرورگر و تفاوت ورود و دریافت اطلاعات با وای‌فای. از روی این گزارش به‌تنهایی نمی‌توان علت را فیلترینگ، DNS یا تنظیمات سرور دانست.</p>
   </details>
   <details className="workspace-disclosure"><summary>پشتیبان‌گیری: چه چیزی آماده است و چه چیزی مانده؟</summary>
    <p>دریافت فایل رمزگذاری‌شده از داده‌های همین حساب آماده است؛ بخش «پشتیبان خصوصی» در همین صفحه آن را روی دستگاه شما می‌سازد.</p>
    <p>پشتیبان خودکارِ سرور که در جای جداگانه نگه‌داری شود هنوز کامل نشده است. برای آن باید مقصد ذخیره‌سازی، نگه‌داری امن کلید و برنامهٔ منظم تهیهٔ نسخه مشخص شود.</p>
    <p className="section-help">پس از آن، لازم است با یک نسخهٔ جدا و آزمایشی امتحان کنیم داده‌ها واقعاً برمی‌گردند و اطلاعات دو نفر جدا می‌ماند. این آزمون نباید روی اطلاعات اصلی سایت انجام شود. دریافت یک فایل به‌تنهایی این کارها را انجام نمی‌دهد.</p>
   </details>
   <details className="workspace-disclosure"><summary>پوشش فرصت‌ها و وضعیت منابع</summary>
    <p>دریافت آگهی از منابع مشخصی مانند درگاه‌های دانشگاهی و کاریابی انجام می‌شود؛ پوشش همهٔ سایت‌ها، مراکز و شبکه‌های خصوصی کامل نیست. افزودن هر منبع به بررسی نشانی، شرایط دسترسی، متن آگهی و مهلت آن نیاز دارد.</p>
    <p className="section-help">دکمهٔ زیر وضعیت ذخیره‌شدهٔ منابع مجاز همین پنل را نشان می‌دهد؛ به‌تنهایی جست‌وجوی تازه در همهٔ وب انجام نمی‌دهد.</p>
    <button className="secondary" type="button" disabled={!!sourceState?.loading} onClick={loadSources}>{sourceState?.loading?'در حال دریافت وضعیت…':'مشاهدهٔ وضعیت منابع'}</button>
    {sourceState?.error&&<p className="notice" role="alert"><MixedText>{sourceState.error}</MixedText></p>}
    {sourceState&&!sourceState.loading&&!sourceState.error&&<><p>{configured.toLocaleString('fa-IR')} منبع برای دریافت خودکار تعریف شده؛ {successful.toLocaleString('fa-IR')} منبع سابقهٔ دریافت موفق دارد.</p>
     {sources.length?<ul>{sources.map(source=><li key={source.id}><strong><MixedText>{source.name||source.id}</MixedText></strong> — {sourceLabel(source)}{source.lastSuccessAt&&<small className="section-help"> آخرین موفقیت: {date(source.lastSuccessAt)}</small>}</li>)}</ul>:<p className="section-help">در این پاسخ منبعی ثبت نشده است؛ این نتیجه به معنی نبود فرصت نیست.</p>}
    </>}
   </details>
   <details className="workspace-disclosure"><summary>اقدام‌ها و مدارک باقی‌ماندهٔ همین حساب</summary><ul>
    {person==='amir'&&!current.secondary?.connected&&<li>اتصال حساب amirgr20 با رضایت صاحب حساب در تنظیمات.</li>}
    <li>مجوز رسمی آمار پیشرفته و کانکشن‌های LinkedIn؛ ایمیل دانشگاهی به‌تنهایی اختیار نمایندگی سازمان نیست.</li>
    <li><MixedText>{person==='arash'?'بازبینی بالینی کیس‌های PESCI و تأیید مدارک حرفه‌ای.':'تأیید مدارک و شرایط مسیر تخصصی.'}</MixedText> پیشنهاد یا تیک برنامه، دستاورد تأییدشدهٔ رزومه نیست.</li>
   </ul></details>
   <details className="workspace-disclosure"><summary>لغو گروهی زمان‌بندی‌های منتظر همین حساب</summary>
    <p>تأیید زمان‌بندی‌های منتظر لغو و اعلان تلگرام خاموش می‌شود. اتصال‌ها، پیش‌نویس‌ها و صف دستی حفظ می‌شوند. عملیات از قبل شروع‌شده ممکن است تکمیل شود؛ پیامِ در حال ارسال لزوماً همان لحظه متوقف نمی‌شود.</p>
    <label className="checkline"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>لغو زمان‌بندی‌های منتظر و خاموش‌شدن اعلان‌های همین حساب را تأیید می‌کنم.</label>
    <button className="secondary" disabled={!confirmed||busy||!current.operations} onClick={cancel}>{busy?'در حال لغو…':'لغو زمان‌بندی‌های منتظر همین حساب'}</button>
   </details>
  </>}
 </section>;
}
