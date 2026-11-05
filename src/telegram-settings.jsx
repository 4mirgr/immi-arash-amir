import React,{useEffect,useRef,useState} from 'react';
import {Bell,Link2,RefreshCw,Send,Unplug} from 'lucide-react';
import {api} from './api';
import {MixedText} from './mixed-text';
const hourOptions=Array.from({length:24},(_,i)=>i);
export function TelegramSettings({person,notify=()=>{}}){
 const identity=useRef({person,epoch:0});if(identity.current.person!==person)identity.current={person,epoch:identity.current.epoch+1};const epoch=identity.current.epoch;
 const [record,setRecord]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[link,setLink]=useState(null),[settings,setSettings]=useState(null);const sequence=useRef(0);
 const valid=(who,e)=>identity.current.person===who&&identity.current.epoch===e;
 const suffix='?profile='+encodeURIComponent(person),status=record?.person===person?record.data:null;
 async function load(){const number=++sequence.current,who=person,e=epoch;try{const data=await api('telegram/status'+suffix);if(!valid(who,e)||number!==sequence.current)return;setRecord({person:who,data});setSettings({person:who,enabled:data.enabled,quietStart:data.quietStart,quietEnd:data.quietEnd});setError('');if(data.connected)setLink(null);}catch(err){if(valid(who,e)&&number===sequence.current)setError(err.message);}}
 useEffect(()=>{setRecord(null);setLink(null);setSettings(null);setError('');setBusy('');load();return()=>{sequence.current++;};},[person]);
 useEffect(()=>{if(!link||link.person!==person)return;const timer=setInterval(()=>{if(Date.now()>Date.parse(link.expiresAt)){setLink(null);clearInterval(timer);return;}load();},3000);return()=>clearInterval(timer);},[link,person]);
 async function action(path,body={},label=''){const who=person,e=epoch;setBusy(path);setError('');try{const result=await api('telegram/'+path+suffix,{method:'POST',body:JSON.stringify(body)});if(!valid(who,e))return null;if(label)notify(label);return result;}catch(err){if(valid(who,e))setError(err.message);return null;}finally{if(valid(who,e))setBusy('');}}
 async function begin(){
  // Open during the user's click; browsers may block a window created after fetch.
  let popup=null;try{popup=window.open('about:blank','_blank');if(popup)popup.opener=null;}catch{}
  const result=await action('link-code');if(!result){if(popup&&!popup.closed)popup.close();return;}
  let u;try{u=new URL(result.deepLink);}catch{}
  if(!u||u.protocol!=='https:'||u.hostname!=='t.me'||u.username||u.password||u.port){if(popup&&!popup.closed)popup.close();setError('نشانی اتصال معتبر دریافت نشد.');return;}
  setLink({person,...result});
  if(popup&&!popup.closed){try{popup.location.replace(u.href);}catch{popup.close();}}
 }
 async function setup(){const result=await action('setup-webhook',{},'وب‌هوک بات روی همین سایت ثبت شد؛ پیامی ارسال نشد.');if(result)load();}
 async function save(){if(!settings||settings.person!==person)return;const result=await action('settings',{enabled:settings.enabled,quietStart:settings.quietStart,quietEnd:settings.quietEnd},'تنظیم اعلان‌های همین مالک ذخیره شد.');if(result)load();}
 async function test(){const result=await action('test');if(result)notify(result.status==='sent'?'Telegram دریافت پیام آزمایشی را تأیید کرد.':result.status==='delivery_unknown'?'نتیجهٔ ارسال نامشخص است؛ آن را خودکار تکرار نکنید.':'پیام آزمایشی ارسال نشد؛ وضعیت اتصال را بررسی کنید.');}
 const draft=settings?.person===person?settings:null;
 return <section className="panel" style={{gridColumn:'1 / -1'}}><div className="section-head"><h3><Bell size={19}/> اعلان‌های تلگرام همین کاربر</h3><button type="button" className="secondary" disabled={!!busy} onClick={load}><RefreshCw size={15}/> بررسی وضعیت</button></div>
 <p className="muted">هر پزشک از داخل حساب خودش به چت خصوصی تلگرام خودش متصل می‌شود؛ بات مشترک است، اما اتصال و تنظیم اعلان‌های آرش و امیر جداست.</p>
 <p className="muted">فرصت‌های عمومی تازه با خلاصه و لینک منبع؛ این بخش ایمیل، رزومه یا متن خصوصی مکاتبات را به تلگرام نمی‌فرستد و ایمیل خودکار ارسال نمی‌کند.</p>
 {error&&<p className="notice" role="alert"><MixedText>{error}</MixedText></p>}
 {!status?<p className="muted">در حال بررسی اتصال…</p>:!status.configured?<div className="notice"><p>ابتدا مدیر پروژه باید بات مشترک را یک‌بار در BotFather بسازد و توکن بات و کلید وب‌هوک را در Secretهای سرور ثبت کند. توکن را در چت نفرستید.</p><button type="button" className="primary" disabled><Link2 size={15}/> اتصال تلگرام من</button><p>پس از آماده‌شدن بات، آرش و امیر هرکدام فقط همین دکمه را در پنل خود می‌زنند و در تلگرام خود Start را انتخاب می‌کنند؛ به توکن جداگانه نیاز ندارند.</p></div>:<>
 <p>بات: <bdi dir="ltr">{status.botUsername?'@'+status.botUsername:'پس از ثبت وب‌هوک مشخص می‌شود'}</bdi> · {status.connected?'چت اختصاصی متصل است':'چت هنوز متصل نیست'} {status.chatHint&&<bdi dir="ltr">{status.chatHint}</bdi>}</p>
 {!status.webhookRegistered&&<div className="notice"><p>ابتدا وب‌هوک بات باید به نشانی ثابت همین سایت متصل شود. ثبت آن پیامی ارسال نمی‌کند.</p>{status.canSetupWebhook?<button type="button" className="secondary" disabled={!!busy} onClick={setup}>ثبت وب‌هوک همین سایت</button>:<p>مدیر پروژه این مرحله را انجام می‌دهد.</p>}</div>}
 {!status.connected?<><button type="button" className="primary" disabled={!!busy||!status.webhookRegistered} onClick={begin}><Link2 size={15}/> {busy==='link-code'?'در حال بازکردن تلگرام…':'اتصال تلگرام من'}</button>{link?.person===person&&<div className="notice"><p>۱. بات را در تلگرام شخصی خود باز کنید. ۲. دکمهٔ Start را بزنید. ۳. به این صفحه برگردید و «بررسی وضعیت» را بزنید؛ صفحه هنگام انتظار هم وضعیت را بررسی می‌کند.</p><a className="primary link" href={link.deepLink} target="_blank" rel="noopener noreferrer">اگر تلگرام باز نشد، اینجا بزنید</a><p>لینک یک‌بارمصرف و ده دقیقه معتبر است؛ آن را برای دیگری نفرستید. پس از اتصال، دریافت اعلان را جداگانه فعال و ذخیره کنید.</p></div>}</>:<>
 {draft&&<div style={{display:'grid',gap:'.8rem'}}><label><input type="checkbox" checked={draft.enabled} onChange={e=>setSettings({...draft,enabled:e.target.checked})}/> دریافت اعلان فرصت‌های تازهٔ همین پنل</label><div style={{display:'flex',gap:'1rem',flexWrap:'wrap'}}><label>شروع سکوت به وقت تهران<select value={draft.quietStart} onChange={e=>setSettings({...draft,quietStart:Number(e.target.value)})}>{hourOptions.map(v=><option value={v} key={v}>{String(v).padStart(2,'0')}:00</option>)}</select></label><label>پایان سکوت<select value={draft.quietEnd} onChange={e=>setSettings({...draft,quietEnd:Number(e.target.value)})}>{hourOptions.map(v=><option value={v} key={v}>{String(v).padStart(2,'0')}:00</option>)}</select></label></div><small className="muted">یکسان‌بودن دو ساعت، سکوت را غیرفعال می‌کند. پیش‌فرض ۲۲ تا ۸ صبح تهران است.</small><button type="button" className="primary" disabled={!!busy} onClick={save}>ذخیرهٔ تنظیمات اعلان</button></div>}
 <div style={{display:'flex',gap:'.8rem',flexWrap:'wrap',marginTop:'1rem'}}><button type="button" className="secondary" disabled={!!busy||!status.enabled} onClick={test}><Send size={15}/> ارسال یک پیام آزمایشی به چت خودم</button><button type="button" className="secondary" disabled={!!busy} onClick={async()=>{if(await action('disconnect',{},'اتصال تلگرام همین مالک قطع شد.'))load();}}><Unplug size={15}/> قطع اتصال همین چت</button></div>
 <p className="muted">اعلان‌های خودکار از زمان فعال‌سازی، با پنجرهٔ بازیابی هفت‌روزه، سقف روزانهٔ {status.dailyLimit} برای هر مالک و حداکثر {status.perRunLimit} ارسال در هر نوبت زمان‌بندی اجرا می‌شوند. تأخیر به زمان دریافت منابع و نوبت سرور وابسته است؛ اعلان فوری تضمین نشده است. پیام آزمایشی هم جزو سقف روزانه است.</p>
 </>}
 </>}
 </section>;
}
