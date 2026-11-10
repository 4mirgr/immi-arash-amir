import {googleAccountLabel} from './google-account-labels.mjs';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Mail, RefreshCw, Link2, Unplug, Search, ArrowLeft, ExternalLink} from 'lucide-react';
import {api} from './api';
import {MixedText} from './mixed-text';
import './google-inbox.css';

const setupURL='https://github.com/4mirgr/immi-arash-amir/blob/main/docs/GOOGLE.md';
const mailboxSuffix = mailbox => mailbox==='secondary'?'&mailbox=secondary':'';
export function useGoogleConnection(person, cloud, mailbox='primary') {
  const key=person+':'+mailbox+':'+Boolean(cloud);
  const [state,setState]=useState({_scopeKey:key,connected:false,configured:false,loading:cloud});
  const current=useRef({key,epoch:0}),mounted=useRef(true),statusFlight=useRef(null);
  if(current.current.key!==key)current.current={key,epoch:current.current.epoch+1};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;current.current.epoch++;};},[]);
  const refresh=useCallback(()=>{
    if(statusFlight.current?.key===key&&statusFlight.current.epoch===current.current.epoch)return statusFlight.current.promise;
    const epoch=current.current.epoch,active=()=>mounted.current&&current.current.key===key&&current.current.epoch===epoch;
    const flight={key,epoch,promise:null};statusFlight.current=flight;
    flight.promise=(async()=>{
      if(!cloud){if(active())setState({_scopeKey:key,connected:false,configured:false,local:true});return null;}
      try{const result=await api(`google/status?profile=${person}${mailboxSuffix(mailbox)}`);if(!active())return null;setState({_scopeKey:key,...result,loading:false,stale:false,failureCount:0,lastCheckedAt:Date.now()});return result;}
      catch(e){if(active())setState(previous=>({...((previous._scopeKey===key)?previous:{_scopeKey:key,connected:false,configured:false}),loading:false,stale:true,failureCount:(previous._scopeKey===key?previous.failureCount||0:0)+1,error:'وضعیت تازهٔ Google دریافت نشد؛ اطلاعات آخرین بررسی حفظ شده است. اتصال مجدد لازم نیست مگر Google لغو مجوز را تأیید کند.'}));return null;}
      finally{if(statusFlight.current===flight)statusFlight.current=null;}
    })();return flight.promise;
  },[person,cloud,mailbox,key]);
  useEffect(()=>{setState({_scopeKey:key,connected:false,configured:false,loading:cloud});refresh();},[refresh,cloud]);
  useEffect(()=>{
    if(!cloud||state._scopeKey!==key||!state.stale)return;
    const retry=()=>{if(document.visibilityState==='visible'&&navigator.onLine!==false)refresh();};
    const timer=setTimeout(retry,Math.min(300000,30000*2**Math.min(Math.max(0,(state.failureCount||1)-1),4)));
    window.addEventListener('online',retry);document.addEventListener('visibilitychange',retry);
    return()=>{clearTimeout(timer);window.removeEventListener('online',retry);document.removeEventListener('visibilitychange',retry);};
  },[cloud,key,state._scopeKey,state.stale,state.failureCount,refresh]);
  return {state:state._scopeKey===key?state:{connected:false,configured:false,loading:cloud},refresh,mailbox};
}

export function GoogleConnection({person,connection,notify,purpose=null,onConnected}) {
  const backup=purpose==='backup',calendar=purpose==='calendar';
  const {state,refresh}=connection,mailbox=connection.mailbox||'primary',secondary=mailbox==='secondary';
  const [busy,setBusy]=useState(false),[connectError,setConnectError]=useState('');
  const popup=useRef(null),timer=useRef(null),epoch=useRef(0),messageListener=useRef(null);
  function stopListening(){if(messageListener.current){window.removeEventListener('message',messageListener.current);messageListener.current=null;}}
  useEffect(()=>{setBusy(false);setConnectError('');return()=>{epoch.current++;clearInterval(timer.current);stopListening();try{popup.current?.close()}catch{}};},[person,mailbox,purpose]);
  async function connect(){
    const ready=status=>status?.connected&&(!backup||status.capabilities?.backupDrive===true)&&(!calendar||status.capabilities?.calendar===true);
    // Open synchronously so browser popup protection preserves the existing session.
    const popupName='immi-google-'+person+'-'+mailbox;
    const windowRef=window.open('about:blank',popupName,'popup,width=560,height=740');
    if(!windowRef){notify('اجازهٔ بازکردن پنجرهٔ اتصال را در مرورگر فعال کنید.');return;}
    popup.current=windowRef;setBusy(true);setConnectError('');stopListening();const requestEpoch=epoch.current;
    try{
      const result=await api(`google/start?profile=${person}${mailboxSuffix(mailbox)}${backup?'&purpose=backup':calendar?'&purpose=calendar':''}`,{method:'POST',body:'{}'});
      const target=new URL(result.authorizationUrl);
      if(target.protocol!=='https:'||target.hostname!=='accounts.google.com')throw Error('نشانی اتصال Google معتبر نیست.');
      if(requestEpoch!==epoch.current){windowRef.close();return;}
      if(result.launchUrl&&result.launchTicket){
        const launch=new URL(result.launchUrl),callback=new URL(target.searchParams.get('redirect_uri'));
        if(launch.protocol!=='https:'||callback.protocol!=='https:'||launch.origin!==callback.origin||launch.pathname!=='/api/google/launch'||launch.search||launch.hash||callback.pathname!=='/api/google/callback'||!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(result.launchTicket)||!/^[A-Za-z0-9_-]{43}$/.test(result.callbackNonce))throw Error('نشانی آغاز امن اتصال Google معتبر نیست.');
        const listener=async event=>{
          if(event.origin!==launch.origin||event.source!==windowRef||requestEpoch!==epoch.current||event.data?.type!=='immi-google-oauth'||event.data?.nonce!==result.callbackNonce)return;
          if(event.data.ok===true){const status=await refresh();if(requestEpoch!==epoch.current)return;if(ready(status)){clearInterval(timer.current);stopListening();setBusy(false);try{windowRef.close()}catch{}notify(calendar?'مجوز تقویم این حساب تأیید شد.':backup?'مجوز ذخیرهٔ پشتیبان در Drive تأیید شد.':'حساب Google این پروفایل متصل شد.');onConnected?.(status);}}
          else if(event.data.ok===false){clearInterval(timer.current);stopListening();setBusy(false);const code=typeof event.data.code==='string'&&/^[a-z_]{1,80}$/.test(event.data.code)?event.data.code:'callback_failed';setConnectError('Google اتصال را کامل نکرد. کد بررسی: '+code);}
        };
        messageListener.current=listener;window.addEventListener('message',listener);
        // POST, never a transferable GET link: canonical host verifies the actual
        // allowed browser Origin, consumes the one-use ticket and sets its cookie.
        const form=document.createElement('form');form.method='POST';form.action=launch.href;form.target=popupName;form.style.display='none';
        const ticket=document.createElement('input');ticket.type='hidden';ticket.name='ticket';ticket.value=result.launchTicket;form.append(ticket);document.body.append(form);
        try{form.submit();}finally{form.remove();}
      }else{
        if(new URL(target.searchParams.get('redirect_uri')).origin!==location.origin)throw Error('برای اتصال در این دامنه، مسیر امن OAuth باید در سرور آماده شود.');
        windowRef.location.href=target.href;
      }
      const started=Date.now();let inFlight=false;
      clearInterval(timer.current);
      timer.current=setInterval(async()=>{
        if(inFlight)return;
        if(requestEpoch!==epoch.current||Date.now()-started>10*60*1000){clearInterval(timer.current);stopListening();setBusy(false);return;}
        inFlight=true;
        const status=await refresh();
        if(requestEpoch!==epoch.current)return;
        if(ready(status)){clearInterval(timer.current);stopListening();setBusy(false);try{windowRef.close()}catch{}notify(calendar?'مجوز تقویم این حساب تأیید شد.':backup?'مجوز ذخیرهٔ پشتیبان در Drive تأیید شد.':'حساب Google این پروفایل متصل شد.');onConnected?.(status);}
        else if(windowRef.closed){clearInterval(timer.current);stopListening();setBusy(false);}
        inFlight=false;
      },2500);
    }catch(e){try{windowRef.close()}catch{}stopListening();setBusy(false);const message=e.message?.includes('oauth_domain_setup_required')?'این دامنه هنوز مسیر امن اتصال Google را دریافت نکرده است؛ مجوز حساب‌های فعلی حفظ شده و تنظیم مسیر دامنه باید تکمیل شود.':e.message;setConnectError(message);notify(message);}
  }
  async function disconnect(){setBusy(true);try{await api(`google/disconnect?profile=${person}${mailboxSuffix(mailbox)}`,{method:'POST',body:'{}'});await refresh();notify('اتصال Google همین پروفایل قطع شد.');}catch(e){notify(e.message);}finally{setBusy(false);}}
  const testerHint=secondary&&!state.connected?<p className="section-help">برنامهٔ Google فعلاً در حالت آزمایشی است؛ ایمیل جدید باید در فهرست Test users پروژهٔ Google اضافه شده باشد. <a href="https://console.cloud.google.com/auth/audience?project=aus-arash-and-amir" target="_blank" rel="noreferrer">مدیریت کاربران آزمایشی</a></p>:null;
  if(state.stale&&!state.connected&&!state.configured)return <div className="google-connection"><p className="notice" role="status">وضعیت حساب Google موقتاً دریافت نشد؛ هنوز نمی‌توان گفت اتصال قطع شده است. بررسی خودکار دوباره انجام می‌شود.</p><button type="button" className="secondary" onClick={refresh}><RefreshCw size={14}/>بررسی دوبارهٔ وضعیت</button></div>;
  if(calendar)return <div className="google-connection calendar-connection">{testerHint}<p className="section-help">برای دیدن و ثبت برنامه‌ها در تقویم <bdi dir="ltr">{googleAccountLabel(person,mailbox,state.email)}</bdi>، مجوز Calendar همین حساب را در Google تأیید کنید. اتصال حساب دیگر جایگزین نمی‌شود.</p>{state.capabilities?.calendar?<span className="status">مجوز تقویم فعال است</span>:<button className="primary" type="button" disabled={busy||state.loading||!state.configured||state.local||!['amir','arash'].includes(person)||!secondary} onClick={connect}><Link2 size={16}/>{busy?'منتظر تأیید Google…':'اتصال تقویم '+googleAccountLabel(person,mailbox,state.email)}</button>}{connectError&&<p className="notice" role="alert">{connectError}</p>}{state.error&&<p className="notice" role="alert">{state.error}</p>}</div>;
  if(backup)return <div className="google-connection backup-drive-connection">{testerHint}<p className="section-help">برای ذخیرهٔ فایل رمزگذاری‌شده، اجازهٔ ساخت و خواندن فایل‌های همین برنامه در Drive حساب {googleAccountLabel(person,mailbox,state.email)} را تأیید کنید. دسترسی عمومی به همهٔ فایل‌های Drive درخواست نمی‌شود.</p>{state.connected&&<p className="google-mailbox" dir="ltr">{state.email}</p>}{state.capabilities?.backupDrive?<p className="status">مجوز Drive برای پشتیبان فعال است</p>:<button className="primary" type="button" disabled={busy||state.loading||!state.configured||state.local||!['amir','arash'].includes(person)||!secondary} onClick={connect}><Link2 size={16}/>{busy?'منتظر تأیید Google…':'اجازهٔ ذخیرهٔ پشتیبان در Drive'}</button>}{connectError&&<p className="notice" role="alert">{connectError}</p>}{state.error&&<p className="notice" role="alert">{state.error}</p>}</div>;
  return <div className="google-connection">{testerHint}
    <div className="integration"><span className="clinic-icon"><Mail size={21}/></span><div><strong>{googleAccountLabel(person,mailbox,state.email)}</strong><small>{secondary?'Gmail این صندوق؛ مجوز ذخیرهٔ پشتیبان جداگانه است':'Gmail، Drive و Calendar همین حساب'}</small></div><span className={'status '+(state.connected?'':'amber')}>{state.loading?'در حال بررسی':state.stale?'وضعیت تازه دریافت نشد':state.connected?'متصل':'متصل نیست'}</span></div>
    {state.connected?<><p className="google-mailbox" dir="ltr">{state.email}</p><p className="muted">پیام‌ها، مجوزها و صف ارسال این حساب از کاربر دیگر جدا هستند.</p><button className="secondary" disabled={busy} onClick={disconnect}><Unplug size={16}/> قطع اتصال همین حساب</button></>:<>
      <p className="muted">{secondary?(person==='amir'?'حساب amirgr20 را انتخاب کنید؛ حساب dr.gerami.md و اتصال آرش تغییر نمی‌کنند.':'یک حساب Google دیگر متعلق به خودتان را انتخاب کنید. صندوق اصلی شما و تمام اتصال‌های امیر جدا می‌مانند.'):'با حساب Google خودتان وارد شوید. اتصال حساب کاربر دیگر، دسترسی این پنل را فعال نمی‌کند.'}</p>
      {state.local?<div className="notice">اتصال Google از نسخهٔ آنلاین و پس از ورود امن انجام می‌شود.</div>:state.configured?<button className="primary" disabled={busy} onClick={connect}><Link2 size={16}/>{busy?'منتظر تأیید Google…':'اتصال Google همین کاربر'}</button>:<div className="notice">تنظیم اولیهٔ اتصال Google هنوز کامل نشده است. پس از آماده‌شدن، دکمهٔ اتصال مستقل برای هر پزشک فعال می‌شود. <a href={setupURL} target="_blank" rel="noreferrer">راهنمای راه‌اندازی <ExternalLink size={12}/></a></div>}
      {connectError&&<p className="notice" role="alert">{connectError}</p>}
      {state.error&&<p className="muted" role="alert">{state.error}</p>}
      {state.status==='reconnect_required'&&<p className="notice">مجوز این حساب منقضی یا لغو شده؛ اتصال مجدد خودتان لازم است.</p>}
    </>}
    {state.connected&&state.stale&&<p className="notice" role="status">{state.error}</p>}
    <button className="text-button" disabled={busy||state.loading} onClick={refresh}><RefreshCw size={14}/> بررسی وضعیت</button>
  </div>;
}

const topicNames={career:'کار و استخدام پزشکی',supervision:'سوپروایزر و نظارت',pesci:'آمادگی PESCI',registration:'ثبت پزشکی و ارزیابی',migration:'ویزا و اسپانسرشیپ',study:'تحصیل و پذیرش',funding:'فاند و بورسیه',research:'پژوهش و مقاله',language:'زبان و آزمون',development:'دوره و رویداد علمی',application:'پیگیری درخواست',known_source:'فرستندهٔ آشنا در فهرست مراکز'};
const topicTones={career:'green',supervision:'cyan',pesci:'amber',registration:'cyan',migration:'amber',study:'violet',funding:'violet',research:'violet',language:'cyan',development:'green',application:'amber',known_source:'cyan'};
const priorityNames={strong:'قوی',medium:'متوسط',weak:'ضعیف'};
const relevanceNames={medical_registration_or_assessment:'ثبت پزشکی یا ارزیابی مدارک',migration_or_sponsorship:'مهاجرت یا حمایت ویزا',medical_career_or_supervision:'کار پزشکی یا نظارت',research_study_or_funding:'تحصیل پژوهشی یا تأمین مالی',language_or_exam_preparation:'زبان یا آمادگی آزمون',medical_learning_or_scientific_event:'آموزش یا رویداد پزشکی',application_process_requires_context_review:'نشانهٔ فرایند درخواست؛ نیازمند بررسی زمینه',sender_matches_imported_clinic_email:'ایمیل فرستنده با فهرست مراکز تطبیق دارد',sender_matches_imported_clinic_website_domain:'دامنهٔ فرستنده با وب‌سایت مرکز تطبیق دارد',unrelated_transactional_or_retail_content:'محتوای خرید یا تراکنش نامرتبط',no_project_signal_in_reviewed_content:'نشانهٔ مشخصی از ارتباط با پروژه پیدا نشد'};
export function GoogleInbox({person,connection,onReply,onSettings,notify,cloud=true}) {
  const [mailboxSelection,setMailboxSelection]=useState({owner:person,mailbox:'primary'});
  const mailbox=mailboxSelection.owner===person?mailboxSelection.mailbox:'primary';
  const setMailbox=value=>setMailboxSelection({owner:person,mailbox:value});
  const secondaryConnection=useGoogleConnection(person,cloud&&!connection.state.local,'secondary');
  const selectedMailbox=mailbox==='secondary'?'secondary':'primary';
  const activeConnection=selectedMailbox==='secondary'?secondaryConnection:connection;
  const [messages,setMessages]=useState([]),[messagesContext,setMessagesContext]=useState(null),[priority,setPriority]=useState('all'),[scope,setScope]=useState('project'),[order,setOrder]=useState('relevant'),[page,setPage]=useState(0),[pageSize,setPageSize]=useState(25),[topic,setTopic]=useState('all'),[stats,setStats]=useState(null),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(null),[syncNote,setSyncNote]=useState(''),[autoSync,setAutoSync]=useState(false),[syncError,setSyncError]=useState('');
  const current=useRef(person);current.current=person;
  const connected=activeConnection.state.connected;
  const canRead=connected&&activeConnection.state.capabilities?.gmailRead===true;
  const mounted=useRef(true),syncLock=useRef(null),latestSync=useRef(null),syncRetry=useRef({key:'',failures:0,after:0});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;syncLock.current=null;};},[]);
  useEffect(()=>{setMailbox('primary');},[person]);
  const loadSequence=useRef(0);
  const contextKey=person+':'+selectedMailbox+':'+Boolean(connected)+':'+Boolean(canRead)+':'+(activeConnection.state.email||'');
  const currentContext=useRef(contextKey);currentContext.current=contextKey;
  const suffix=mailboxSuffix(selectedMailbox),visibleMessages=messagesContext===contextKey?messages:[];
  const load=useCallback(async()=>{const sequence=++loadSequence.current;if(!canRead){setMessages([]);return false;}try{const result=await api(`google/mail/messages?profile=${person}${suffix}&priority=${encodeURIComponent(priority)}&scope=${scope}&order=${order}&topic=${encodeURIComponent(topic)}&limit=${pageSize}&offset=${page*pageSize}&q=${encodeURIComponent(query)}`);if(!mounted.current||current.current!==person||currentContext.current!==contextKey||sequence!==loadSequence.current)return;setMessages(Array.isArray(result)?result:result.messages||[]);setMessagesContext(contextKey);setStats(result);setError('');return true;}catch(e){if(mounted.current&&current.current===person&&currentContext.current===contextKey&&sequence===loadSequence.current){setError('پیام‌های تازه دریافت نشدند؛ پیام باز و نتیجهٔ قبلی حفظ شده‌اند. '+e.message);}return false;}},[person,canRead,priority,query,scope,order,page,pageSize,topic,contextKey,suffix]);
  useEffect(()=>{loadSequence.current++;setMessages([]);setMessagesContext(null);setStats(null);setExpanded(null);setError('');setSyncNote('');setSyncError('');setAutoSync(false);syncRetry.current={key:contextKey,failures:0,after:0};setBusy(false);setPage(0);setScope('project');setOrder('relevant');setTopic('all');},[contextKey]);
  useEffect(()=>{const timer=setTimeout(load,250);return()=>{clearTimeout(timer);loadSequence.current++;}},[load]);
  async function sync(automatic=false,reset=false,older=false){
    if(!canRead||!mounted.current||syncLock.current?.key===contextKey)return;
    if(automatic&&(document.visibilityState!=='visible'||syncRetry.current.key===contextKey&&Date.now()<syncRetry.current.after))return;
    const lock={key:contextKey};syncLock.current=lock;setBusy(true);setError('');setSyncError('');const requested=contextKey;
    try{const result=await api(`google/mail/${older?'project-search':'sync'}?profile=${person}${suffix}`,{method:'POST',body:JSON.stringify(older?{}:reset?{reset:true}:{})});if(!mounted.current||currentContext.current!==requested)return;setSyncNote(result.note||'بخش محدودی از پیام‌های همین حساب همگام شد؛ این نتیجه پیمایش کامل صندوق نیست.');await load();if(!mounted.current||currentContext.current!==requested)return;const status=await activeConnection.refresh();if(!mounted.current||currentContext.current!==requested)return;if(status?.connected===false){setAutoSync(false);setError('Google قطع اتصال این حساب را تأیید کرد؛ اتصال اختصاصی را بررسی کنید.');}else if(!status){syncRetry.current={key:contextKey,failures:1,after:Date.now()+60000};setError('وضعیت تازهٔ اتصال دریافت نشد؛ پیام‌ها و تنظیم دریافت خودکار حفظ شده‌اند.');}else syncRetry.current={key:contextKey,failures:0,after:0};}
    catch(e){if(mounted.current&&currentContext.current===requested){setSyncError(e.message);const expired=e.message.includes('history_expired_retry_sync'),limited=e.message.includes('sync_volume_limit_reset_required'),transient=!e.status||e.status===408||e.status===429||e.status>=500||e.status===401;if(expired||limited||!transient)setAutoSync(false);else{const failures=(syncRetry.current.key===contextKey?syncRetry.current.failures:0)+1;syncRetry.current={key:contextKey,failures,after:Date.now()+Math.min(300000,60000*2**Math.min(failures-1,3))};}setError(expired?'سابقهٔ تغییرات Gmail منقضی شده است. همگام‌سازی خودکار متوقف شد؛ دکمهٔ دریافت پیام‌های تازه را بزنید تا از پیام‌های اخیر شروع شود.':limited?'حجم تغییرات از حد همگام‌سازی بیشتر است. همگام‌سازی خودکار متوقف شد؛ در صورت تمایل با دکمهٔ شروع دوباره، پیام‌های اخیر را دریافت کنید.':transient?'دریافت تازه موقتاً انجام نشد؛ پیام باز و تنظیمات شما حفظ شده‌اند و نوبت بعدی با فاصلهٔ بیشتر بررسی می‌شود.':e.message);}}
    finally{if(syncLock.current===lock)syncLock.current=null;if(mounted.current&&currentContext.current===requested)setBusy(false);}
  }
  latestSync.current=sync;
  useEffect(()=>{if(!autoSync||!canRead)return;const timer=setInterval(()=>{if(document.visibilityState==='visible'&&syncLock.current?.key!==contextKey)latestSync.current?.(true);},60000);return()=>clearInterval(timer);},[autoSync,canRead,contextKey]);
  const mailboxBar=<div className="mailbox-picker"><label>صندوق ایمیل <select aria-label={person==='amir'?'انتخاب ایمیل امیر':'انتخاب ایمیل آرش'} value={selectedMailbox} onChange={e=>setMailbox(e.target.value)}><option value="primary">{googleAccountLabel(person,'primary',connection.state.email)}</option><option value="secondary">{googleAccountLabel(person,'secondary',secondaryConnection.state.email)}</option></select></label></div>;
  if(!connected&&activeConnection.state.stale)return <section className="google-inbox">{mailboxBar}<p className="notice" role="status">وضعیت اتصال موقتاً دریافت نشد؛ برای بررسی دوباره نیازی به اتصال مجدد Google نیست.</p><button type="button" className="secondary" onClick={activeConnection.refresh}>بررسی دوبارهٔ وضعیت</button></section>;
  if(!connected)return <section className="google-inbox">{mailboxBar}{selectedMailbox==='secondary'?<GoogleConnection person={person} connection={secondaryConnection} notify={notify}/>:<div className="empty"><Mail size={34}/><h3>صندوق Google همین حساب را متصل کنید</h3><p>دریافت، استخراج اطلاعات و اولویت‌بندی فقط روی ایمیل‌های کاربر واردشده انجام می‌شود.</p><button className="secondary" onClick={onSettings}>بررسی اتصال اختصاصی <ArrowLeft size={15}/></button></div>}</section>;
  if(!canRead)return <section>{mailboxBar}<div className="notice">حساب Google متصل است ولی مجوز خواندن Gmail این حساب فعال نیست. برای اعطای مجوز، اتصال اختصاصی را بررسی کنید. <button className="text-button" onClick={onSettings}>بررسی اتصال</button></div></section>;
  return <section className="google-inbox inbox-workspace">
    <div className="inbox-control-panel glass-panel">
      <div className="section-head"><div><span className="eyebrow">تنظیم نمایش و دریافت</span><h3>مکاتبات مرتبط با مسیر شما</h3><small className="google-mailbox" dir="ltr">{activeConnection.state.email}</small></div><button className="secondary" disabled={busy} onClick={()=>sync(false)}><RefreshCw size={15} className={busy?'spin':''}/>{busy?'در حال همگام‌سازی…':'دریافت پیام‌های تازه'}</button></div>
      <p className="section-help">اول صندوق و موضوع را انتخاب کنید؛ پیام‌ها در پایین همین بخش نمایش داده می‌شوند. برچسب موضوع با اولویت پاسخ فرق دارد و هر دو از متن بررسی‌شده به دست می‌آیند.</p>
      {mailboxBar}
      {activeConnection.state.stale&&<p className="notice" role="status">وضعیت تازهٔ اتصال دریافت نشد؛ پیام‌های آخرین دریافت نمایش داده می‌شوند.</p>}
      <div className="inbox-control-grid">
        <label className="inbox-search-control">جست‌وجو در پیام‌ها<span className="inbox-search"><Search size={16}/><input aria-label="جست‌وجوی ایمیل‌های همین حساب" placeholder="موضوع، فرستنده یا متن…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></span></label>
        <label>موضوع پیام<select aria-label="موضوع پیام" value={topic} onChange={e=>{setTopic(e.target.value);setPage(0);}}><option value="all">همهٔ موضوع‌ها</option>{Object.entries(topicNames).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
        <label>محدودهٔ نمایش<select aria-label="محدودهٔ ارتباط ایمیل" value={scope} onChange={e=>{setScope(e.target.value);setPage(0);}}><option value="project">مرتبط با پروژه</option><option value="all">همهٔ پیام‌های همگام‌شده</option></select></label>
        <label>ترتیب نمایش<select aria-label="چینش ایمیل" value={order} onChange={e=>{setOrder(e.target.value);setPage(0);}}><option value="relevant">مرتبط‌ترین</option><option value="newest">جدیدترین</option><option value="special">ویژه و اقدام‌پذیر</option></select></label>
        <label>اولویت پاسخ<select aria-label="اولویت پاسخ کارفرما" value={priority} onChange={e=>{setPriority(e.target.value);setPage(0);}}><option value="all">همهٔ اولویت‌ها</option>{Object.entries(priorityNames).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
        <label>تعداد در هر صفحه<select aria-label="تعداد ایمیل در هر صفحه" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0);}}>{[10,25,50,100].map(n=><option key={n} value={n}>{n.toLocaleString('fa-IR')} پیام</option>)}</select></label>
      </div>
      <div className="inbox-sync-tools"><label className="checkline inbox-auto-sync"><input type="checkbox" checked={autoSync} onChange={e=>setAutoSync(e.target.checked)}/> دریافت خودکار تغییرات هنگام بازبودن پنل؛ هر ۶۰ ثانیه</label><button className="secondary" disabled={busy} onClick={()=>sync(false,false,true)}>جست‌وجوی پیام‌های قدیمی‌تر مرتبط</button></div>
      <details className="inbox-analysis-help"><summary>معنی برچسب‌ها و محدودهٔ بررسی</summary><p className="section-help">موضوع‌ها مانند کار، سوپرویژن، فاند یا آزمون، بر اساس واژه‌ها و زمینهٔ متن دسته‌بندی می‌شوند؛ این دسته‌بندی تشخیص قطعی نیست. «قوی، متوسط و ضعیف» نشانهٔ پاسخ کارفرماست و احتمال پذیرش را پیش‌بینی نمی‌کند. «ویژه» نشانهٔ دعوت، مهلت یا اهمیت Gmail است. حداکثر ۵۰۰ پیام از حافظهٔ همگام‌شده بررسی می‌شود؛ تعداد انتخابی شما فقط اندازهٔ هر صفحه را تعیین می‌کند.</p></details>
      {stats?.sourceMatching?.status==='lookup_unavailable_content_analysis_only'&&<p className="section-help">تطبیق فهرست مراکز اکنون در دسترس نیست؛ تحلیل محتوا ادامه دارد.</p>}
      {syncNote&&<div className="notice">{syncNote}</div>}{error&&<div className="notice" role="alert">{error}{syncError.includes('sync_volume_limit_reset_required')&&<button className="secondary" disabled={busy} onClick={()=>sync(false,true)}>شروع دوباره از پیام‌های اخیر</button>}</div>}
    </div>
    <div className="inbox-results" aria-label="نتیجهٔ جست‌وجوی ایمیل">
      <div className="inbox-results-heading"><h4>پیام‌های این صفحه</h4><span>{visibleMessages.length.toLocaleString('fa-IR')} پیام{typeof stats?.matchedWithinWindow==='number'?' از '+stats.matchedWithinWindow.toLocaleString('fa-IR')+' نتیجه در محدودهٔ بررسی':''}</span></div>
      {!visibleMessages.length&&!error&&<div className="empty"><Mail size={28}/><p>پیامی با این فیلترها پیدا نشد. موضوع یا محدوده را تغییر دهید، یا پیام‌های تازه و قدیمی‌تر را دریافت کنید؛ نبود نتیجه به معنی خالی‌بودن صندوق نیست.</p></div>}
      <div className="inbox-message-list">{visibleMessages.map(message=><article className="inbox-message" key={selectedMailbox+':'+message.id}>
        <button className="message-summary" onClick={()=>setExpanded(expanded===message.id?null:message.id)} aria-expanded={expanded===message.id}><div><strong dir="auto"><MixedText>{message.subject||'بدون موضوع'}</MixedText></strong><small dir="auto">{message.from||'فرستنده نامشخص'}</small></div><span className="message-expand-indicator" aria-hidden="true">{expanded===message.id?'−':'+'}</span></button>
        <div className="inbox-message-meta"><span className={'status '+(message.priority==='strong'?'':message.priority==='weak'?'red':'amber')}>{'اولویت پاسخ: '+(priorityNames[message.priority]||'بررسی‌نشده')}</span>{message.projectRelevance?.special&&<span className="inbox-topic topic-amber">ویژه</span>}{message.date&&<time dateTime={message.date}>{new Date(message.date).toLocaleDateString('fa-IR',{timeZone:'Asia/Tehran'})}</time>}</div>
        <div className="inbox-topic-list" aria-label="موضوع‌های تشخیص‌داده‌شده">{(message.projectRelevance?.topics||message.projectRelevance?.categories||[]).filter(code=>topicNames[code]).map(code=><span key={code} className={'inbox-topic topic-'+(topicTones[code]||'cyan')}>{topicNames[code]}</span>)}{!(message.projectRelevance?.topics||message.projectRelevance?.categories||[]).length&&<span className="inbox-topic">موضوع مشخص نشده</span>}</div>
        <p className="message-snippet" dir="auto"><MixedText>{message.snippet||''}</MixedText></p>
        {expanded===message.id&&<div className="message-details"><small>{message.date?new Date(message.date).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'}):''}</small><pre dir="auto">{message.plainBody||message.body||message.snippet||'متن قابل نمایش دریافت نشده است.'}</pre><h4>علت ارتباط با پروژه</h4><ul>{(message.projectRelevance?.reasons||[]).map((reason,i)=><li key={'project-'+i}><MixedText>{relevanceNames[reason]||reason}</MixedText></li>)}</ul><details><summary>نشانه‌های پاسخ و محدودیت تحلیل</summary><ul>{(message.reasons||message.priorityReasons||[]).map((reason,i)=><li key={i} dir="auto">{typeof reason==='string'?reason:reason.text||reason.reason||'نشانهٔ متنی'}</li>)}</ul></details>{message.direction!=='sent'&&<button className="secondary" onClick={()=>{onReply({...message,mailbox:selectedMailbox});notify('متن پاسخ با زمینهٔ همین صندوق آماده شد؛ هیچ ایمیلی ارسال نشده است.');}}><ArrowLeft size={15}/> آماده‌کردن پیش‌نویس پاسخ از همین ایمیل</button>}</div>}
      </article>)}</div>
      <div className="inbox-pagination"><button className="secondary" disabled={!page||busy} onClick={()=>setPage(p=>p-1)}>صفحهٔ قبل</button><span>صفحهٔ {(page+1).toLocaleString('fa-IR')}</span><button className="secondary" disabled={!stats?.more||busy} onClick={()=>setPage(p=>p+1)}>صفحهٔ بعد</button></div>
    </div>
  </section>;
}
