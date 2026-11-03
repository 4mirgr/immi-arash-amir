import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Mail, RefreshCw, Link2, Unplug, Search, ArrowLeft, ExternalLink} from 'lucide-react';
import {api} from './api';

const setupURL='https://github.com/4mirgr/immi-arash-amir/blob/main/docs/GOOGLE.md';
export function useGoogleConnection(person, cloud) {
  const [state,setState]=useState({connected:false,configured:false,loading:cloud});
  const current=useRef(person); current.current=person;
  const refresh=useCallback(async()=>{
    if(!cloud){setState({connected:false,configured:false,local:true});return null;}
    try{const result=await api(`google/status?profile=${person}`);if(current.current===person)setState({...result,loading:false});return result;}
    catch(e){if(current.current===person)setState({connected:false,configured:false,loading:false,error:e.status===404?'اتصال Google در این نسخه هنوز آماده نشده است.':e.message});return null;}
  },[person,cloud]);
  useEffect(()=>{setState({connected:false,configured:false,loading:cloud});refresh();},[refresh,cloud]);
  return {state,refresh};
}

export function GoogleConnection({person,connection,notify}) {
  const {state,refresh}=connection;
  const [busy,setBusy]=useState(false);
  const popup=useRef(null),timer=useRef(null),epoch=useRef(0);
  useEffect(()=>()=>{epoch.current++;clearInterval(timer.current);try{popup.current?.close()}catch{}},[person]);
  async function connect(){
    // Open synchronously so browser popup protection preserves the existing session.
    const windowRef=window.open('about:blank','immi-google-'+person,'popup,width=560,height=740');
    if(!windowRef){notify('اجازهٔ بازکردن پنجرهٔ اتصال را در مرورگر فعال کنید.');return;}
    popup.current=windowRef;setBusy(true);const requestEpoch=epoch.current;
    try{
      const result=await api(`google/start?profile=${person}`,{method:'POST',body:'{}'});
      const target=new URL(result.authorizationUrl);
      if(target.protocol!=='https:'||target.hostname!=='accounts.google.com')throw Error('نشانی اتصال Google معتبر نیست.');
      if(requestEpoch!==epoch.current){windowRef.close();return;}
      windowRef.location.href=target.href;
      const started=Date.now();let inFlight=false;
      clearInterval(timer.current);
      timer.current=setInterval(async()=>{
        if(inFlight)return;
        if(requestEpoch!==epoch.current||Date.now()-started>10*60*1000){clearInterval(timer.current);setBusy(false);return;}
        inFlight=true;
        const status=await refresh();
        if(requestEpoch!==epoch.current)return;
        if(status?.connected){clearInterval(timer.current);setBusy(false);try{windowRef.close()}catch{}notify('حساب Google این پروفایل متصل شد.');}
        else if(windowRef.closed){clearInterval(timer.current);setBusy(false);}
        inFlight=false;
      },2500);
    }catch(e){try{windowRef.close()}catch{}setBusy(false);notify(e.message);}
  }
  async function disconnect(){setBusy(true);try{await api(`google/disconnect?profile=${person}`,{method:'POST',body:'{}'});await refresh();notify('اتصال Google همین پروفایل قطع شد.');}catch(e){notify(e.message);}finally{setBusy(false);}}
  return <div className="google-connection">
    <div className="integration"><span className="clinic-icon"><Mail size={21}/></span><div><strong>Google اختصاصی {person==='arash'?'آرش':'امیر'}</strong><small>Gmail، Drive و Calendar همین حساب</small></div><span className={'status '+(state.connected?'':'amber')}>{state.loading?'در حال بررسی':state.connected?'متصل':'متصل نیست'}</span></div>
    {state.connected?<><p className="google-mailbox" dir="ltr">{state.email}</p><p className="muted">پیام‌ها، مجوزها و صف ارسال این حساب از کاربر دیگر جدا هستند.</p><button className="secondary" disabled={busy} onClick={disconnect}><Unplug size={16}/> قطع اتصال همین حساب</button></>:<>
      <p className="muted">با حساب Google خودتان وارد شوید. اتصال حساب کاربر دیگر، دسترسی این پنل را فعال نمی‌کند.</p>
      {state.local?<div className="notice">اتصال Google از نسخهٔ آنلاین و پس از ورود امن انجام می‌شود.</div>:state.configured?<button className="primary" disabled={busy} onClick={connect}><Link2 size={16}/>{busy?'منتظر تأیید Google…':'اتصال Google همین کاربر'}</button>:<div className="notice">تنظیم اولیهٔ اتصال Google هنوز کامل نشده است. پس از آماده‌شدن، دکمهٔ اتصال مستقل برای هر پزشک فعال می‌شود. <a href={setupURL} target="_blank" rel="noreferrer">راهنمای راه‌اندازی <ExternalLink size={12}/></a></div>}
      {state.error&&<p className="muted" role="alert">{state.error}</p>}
      {state.status==='reconnect_required'&&<p className="notice">مجوز این حساب منقضی یا لغو شده؛ اتصال مجدد خودتان لازم است.</p>}
    </>}
    <button className="text-button" disabled={busy||state.loading} onClick={refresh}><RefreshCw size={14}/> بررسی وضعیت</button>
  </div>;
}

const priorityNames={strong:'قوی',medium:'متوسط',weak:'ضعیف'};
export function GoogleInbox({person,connection,onReply,onSettings,notify}) {
  const [messages,setMessages]=useState([]),[priority,setPriority]=useState('all'),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(null),[syncNote,setSyncNote]=useState(''),[autoSync,setAutoSync]=useState(false),[syncError,setSyncError]=useState('');
  const current=useRef(person);current.current=person;
  const connected=connection.state.connected;
  const canRead=connected&&connection.state.capabilities?.gmailRead===true;
  const mounted=useRef(true),syncLock=useRef(null),latestSync=useRef(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;syncLock.current=null;};},[]);
  const loadSequence=useRef(0);
  const contextKey=person+':'+Boolean(connected)+':'+Boolean(canRead)+':'+(connection.state.email||'');
  const currentContext=useRef(contextKey);currentContext.current=contextKey;
  const load=useCallback(async()=>{const sequence=++loadSequence.current;if(!canRead){setMessages([]);return false;}try{const result=await api(`google/mail/messages?profile=${person}&priority=${encodeURIComponent(priority)}&q=${encodeURIComponent(query)}`);if(current.current!==person||currentContext.current!==contextKey||sequence!==loadSequence.current)return;setMessages(Array.isArray(result)?result:result.messages||[]);setError('');return true;}catch(e){if(current.current===person&&currentContext.current===contextKey&&sequence===loadSequence.current){setError(e.message);setAutoSync(false);}return false;}},[person,connected,canRead,priority,query,contextKey]);
  useEffect(()=>{loadSequence.current++;setMessages([]);setExpanded(null);setError('');setSyncNote('');setSyncError('');setAutoSync(false);setBusy(false);},[contextKey]);
  useEffect(()=>{const timer=setTimeout(load,250);return()=>{clearTimeout(timer);loadSequence.current++;}},[load]);
  async function sync(automatic=false,reset=false){
    if(!canRead||!mounted.current||syncLock.current?.key===contextKey)return;
    if(automatic&&document.visibilityState!=='visible')return;
    const lock={key:contextKey};syncLock.current=lock;setBusy(true);setError('');setSyncError('');const requested=contextKey;
    try{const result=await api(`google/mail/sync?profile=${person}`,{method:'POST',body:JSON.stringify(reset?{reset:true}:{})});if(!mounted.current||currentContext.current!==requested)return;setSyncNote(result.note||'بخش محدودی از پیام‌های همین حساب همگام شد؛ این نتیجه پیمایش کامل صندوق نیست.');const loaded=await load();if(!mounted.current||currentContext.current!==requested)return;if(!loaded)setAutoSync(false);const status=await connection.refresh();if(!mounted.current||currentContext.current!==requested)return;if(!status?.connected){setAutoSync(false);setError('وضعیت اتصال Google نیازمند بررسی است؛ همگام‌سازی خودکار متوقف شد.');}}
    catch(e){if(mounted.current&&currentContext.current===requested){setAutoSync(false);setSyncError(e.message);const expired=e.message.includes('history_expired_retry_sync');const limited=e.message.includes('sync_volume_limit_reset_required');setError(expired?'سابقهٔ تغییرات Gmail منقضی شده است. همگام‌سازی خودکار متوقف شد؛ دکمهٔ دریافت پیام‌های تازه را بزنید تا از پیام‌های اخیر شروع شود.':limited?'حجم تغییرات از حد همگام‌سازی بیشتر است. همگام‌سازی خودکار متوقف شد؛ در صورت تمایل با دکمهٔ شروع دوباره، پیام‌های اخیر را دریافت کنید.':e.message);}}
    finally{if(syncLock.current===lock)syncLock.current=null;if(mounted.current&&currentContext.current===requested)setBusy(false);}
  }
  latestSync.current=sync;
  useEffect(()=>{if(!autoSync||!canRead)return;const timer=setInterval(()=>{if(document.visibilityState==='visible'&&syncLock.current?.key!==contextKey)latestSync.current?.(true);},60000);return()=>clearInterval(timer);},[autoSync,canRead,contextKey]);
  if(!connected)return <div className="empty"><Mail size={34}/><h3>صندوق Google همین حساب را متصل کنید</h3><p>دریافت، استخراج اطلاعات و اولویت‌بندی فقط روی ایمیل‌های کاربر واردشده انجام می‌شود.</p><button className="secondary" onClick={onSettings}>بررسی اتصال اختصاصی <ArrowLeft size={15}/></button></div>;
  if(!canRead)return <div className="notice">حساب Google متصل است ولی مجوز خواندن Gmail این حساب فعال نیست. برای اعطای مجوز، اتصال اختصاصی را بررسی کنید. <button className="text-button" onClick={onSettings}>بررسی اتصال</button></div>;
  return <section className="google-inbox"><div className="section-head"><div><h3>صندوق هوشمند شما</h3><small className="google-mailbox" dir="ltr">{connection.state.email}</small></div><button className="secondary" disabled={busy} onClick={()=>sync(false)}><RefreshCw size={15} className={busy?'spin':''}/>{busy?'در حال همگام‌سازی…':'دریافت پیام‌های تازه'}</button></div>
    <label className="checkline inbox-auto-sync"><input type="checkbox" checked={autoSync} onChange={e=>setAutoSync(e.target.checked)}/> همگام‌سازی خودکار هنگام بازبودن این پنل (هر ۶۰ ثانیه)</label><p className="muted">فقط هنگام قابل‌مشاهده‌بودن این پنل پیام‌ها خوانده می‌شوند؛ با بستن پنل، قطع اتصال یا بروز خطا متوقف می‌شود. این گزینه هیچ ایمیلی ارسال نمی‌کند و رویدادی در تقویم نمی‌سازد.</p>
    <div className="inbox-filters"><label className="inbox-search"><Search size={16}/><input aria-label="جست‌وجوی ایمیل‌های همین حساب" placeholder="موضوع، فرستنده یا متن…" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="اولویت ایمیل" value={priority} onChange={e=>setPriority(e.target.value)}><option value="all">همهٔ اولویت‌ها</option>{Object.entries(priorityNames).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></div>
    <p className="muted">اولویت‌ها با قواعد متنی و شواهد پیام مشخص می‌شوند؛ احتمال پذیرش یا نظر قطعی کارفرما نیستند.</p>
    {syncNote&&<div className="notice">{syncNote}</div>}{error&&<div className="notice" role="alert">{error}{syncError.includes('sync_volume_limit_reset_required')&&<button className="secondary" disabled={busy} onClick={()=>sync(false,true)}>شروع دوباره از پیام‌های اخیر</button>}</div>}
    {!messages.length&&!error&&<div className="empty"><Mail size={28}/><p>پیامی در نتایج فعلی نیست. برای دریافت محدود پیام‌های حساب خودتان همگام‌سازی را بزنید.</p></div>}
    {messages.map(message=><article className="inbox-message" key={message.id}><button className="message-summary" onClick={()=>setExpanded(expanded===message.id?null:message.id)} aria-expanded={expanded===message.id}><div><strong dir="auto">{message.subject||'بدون موضوع'}</strong><small dir="auto">{message.from||'فرستنده نامشخص'}</small></div><span className={'status '+(message.priority==='strong'?'':message.priority==='weak'?'red':'amber')}>{priorityNames[message.priority]||'بررسی‌نشده'}</span></button><p className="message-snippet" dir="auto">{message.snippet||''}</p>{expanded===message.id&&<div className="message-details"><small>{message.date?new Date(message.date).toLocaleString('fa-IR'):''}</small><pre dir="auto">{message.plainBody||message.body||message.snippet||'متن قابل نمایش دریافت نشده است.'}</pre><ul>{(message.reasons||message.priorityReasons||[]).map((reason,i)=><li key={i}>{typeof reason==='string'?reason:reason.text||reason.reason||'نشانهٔ متنی'}</li>)}</ul><button className="secondary" onClick={()=>{onReply(message);notify('متن پاسخ آماده شد؛ هیچ ایمیلی ارسال نشده است.');}}><ArrowLeft size={15}/> آماده‌کردن پیش‌نویس پاسخ</button></div>}</article>)}
  </section>;
}
