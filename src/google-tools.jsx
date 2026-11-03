import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Mail, RefreshCw, Link2, Unplug, Search, ArrowLeft, ExternalLink} from 'lucide-react';
import {api} from './api';
import {MixedText} from './mixed-text';

const setupURL='https://github.com/4mirgr/immi-arash-amir/blob/main/docs/GOOGLE.md';
const mailboxSuffix = mailbox => mailbox==='secondary'?'&mailbox=secondary':'';
export function useGoogleConnection(person, cloud, mailbox='primary') {
  const key=person+':'+mailbox+':'+Boolean(cloud);
  const [state,setState]=useState({_scopeKey:key,connected:false,configured:false,loading:cloud});
  const current=useRef({key,epoch:0}),mounted=useRef(true);
  if(current.current.key!==key)current.current={key,epoch:current.current.epoch+1};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;current.current.epoch++;};},[]);
  const refresh=useCallback(async()=>{
    const epoch=current.current.epoch,active=()=>mounted.current&&current.current.key===key&&current.current.epoch===epoch;
    if(!cloud){if(active())setState({_scopeKey:key,connected:false,configured:false,local:true});return null;}
    if(mailbox==='secondary'&&person!=='amir'){if(active())setState({_scopeKey:key,connected:false,configured:false,forbidden:true});return null;}
    try{const result=await api(`google/status?profile=${person}${mailboxSuffix(mailbox)}`);if(!active())return null;setState({_scopeKey:key,...result,loading:false});return result;}
    catch(e){if(active())setState({_scopeKey:key,connected:false,configured:false,loading:false,error:e.status===404?'اتصال Google در این نسخه هنوز آماده نشده است.':e.message});return null;}
  },[person,cloud,mailbox,key]);
  useEffect(()=>{setState({_scopeKey:key,connected:false,configured:false,loading:cloud});refresh();},[refresh,cloud]);
  return {state:state._scopeKey===key?state:{connected:false,configured:false,loading:cloud},refresh,mailbox};
}

export function GoogleConnection({person,connection,notify}) {
  const {state,refresh}=connection,mailbox=connection.mailbox||'primary',secondary=mailbox==='secondary';
  const [busy,setBusy]=useState(false);
  const popup=useRef(null),timer=useRef(null),epoch=useRef(0);
  useEffect(()=>()=>{epoch.current++;clearInterval(timer.current);try{popup.current?.close()}catch{}},[person,mailbox]);
  async function connect(){
    // Open synchronously so browser popup protection preserves the existing session.
    const windowRef=window.open('about:blank','immi-google-'+person+'-'+mailbox,'popup,width=560,height=740');
    if(!windowRef){notify('اجازهٔ بازکردن پنجرهٔ اتصال را در مرورگر فعال کنید.');return;}
    popup.current=windowRef;setBusy(true);const requestEpoch=epoch.current;
    try{
      const result=await api(`google/start?profile=${person}${mailboxSuffix(mailbox)}`,{method:'POST',body:'{}'});
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
  async function disconnect(){setBusy(true);try{await api(`google/disconnect?profile=${person}${mailboxSuffix(mailbox)}`,{method:'POST',body:'{}'});await refresh();notify('اتصال Google همین پروفایل قطع شد.');}catch(e){notify(e.message);}finally{setBusy(false);}}
  return <div className="google-connection">
    <div className="integration"><span className="clinic-icon"><Mail size={21}/></span><div><strong>{secondary?'ایمیل دوم امیر':`Google اختصاصی ${person==='arash'?'آرش':'امیر'}`}</strong><small>{secondary?'فقط Gmail این ایمیل؛ مستقل از حساب اصلی':'Gmail، Drive و Calendar همین حساب'}</small></div><span className={'status '+(state.connected?'':'amber')}>{state.loading?'در حال بررسی':state.connected?'متصل':'متصل نیست'}</span></div>
    {state.connected?<><p className="google-mailbox" dir="ltr">{state.email}</p><p className="muted">پیام‌ها، مجوزها و صف ارسال این حساب از کاربر دیگر جدا هستند.</p><button className="secondary" disabled={busy} onClick={disconnect}><Unplug size={16}/> قطع اتصال همین حساب</button></>:<>
      <p className="muted">{secondary?'برای ایمیل دوم فقط حساب دومِ پیکربندی‌شدهٔ امیر را انتخاب کنید؛ حساب اصلی و آرش تغییر نمی‌کنند.':'با حساب Google خودتان وارد شوید. اتصال حساب کاربر دیگر، دسترسی این پنل را فعال نمی‌کند.'}</p>
      {state.local?<div className="notice">اتصال Google از نسخهٔ آنلاین و پس از ورود امن انجام می‌شود.</div>:state.configured?<button className="primary" disabled={busy} onClick={connect}><Link2 size={16}/>{busy?'منتظر تأیید Google…':'اتصال Google همین کاربر'}</button>:<div className="notice">تنظیم اولیهٔ اتصال Google هنوز کامل نشده است. پس از آماده‌شدن، دکمهٔ اتصال مستقل برای هر پزشک فعال می‌شود. <a href={setupURL} target="_blank" rel="noreferrer">راهنمای راه‌اندازی <ExternalLink size={12}/></a></div>}
      {state.error&&<p className="muted" role="alert">{state.error}</p>}
      {state.status==='reconnect_required'&&<p className="notice">مجوز این حساب منقضی یا لغو شده؛ اتصال مجدد خودتان لازم است.</p>}
    </>}
    <button className="text-button" disabled={busy||state.loading} onClick={refresh}><RefreshCw size={14}/> بررسی وضعیت</button>
  </div>;
}

const priorityNames={strong:'قوی',medium:'متوسط',weak:'ضعیف'};
const relevanceNames={medical_registration_or_assessment:'ثبت پزشکی یا ارزیابی مدارک',migration_or_sponsorship:'مهاجرت یا حمایت ویزا',medical_career_or_supervision:'کار پزشکی یا نظارت',research_study_or_funding:'تحصیل پژوهشی یا تأمین مالی',language_or_exam_preparation:'زبان یا آمادگی آزمون',medical_learning_or_scientific_event:'آموزش یا رویداد پزشکی',application_process_requires_context_review:'نشانهٔ فرایند درخواست؛ نیازمند بررسی زمینه',sender_matches_imported_clinic_email:'ایمیل فرستنده با فهرست مراکز تطبیق دارد',sender_matches_imported_clinic_website_domain:'دامنهٔ فرستنده با وب‌سایت مرکز تطبیق دارد',unrelated_transactional_or_retail_content:'محتوای خرید یا تراکنش نامرتبط',no_project_signal_in_reviewed_content:'نشانهٔ مشخصی از ارتباط با پروژه پیدا نشد'};
export function GoogleInbox({person,connection,onReply,onSettings,notify,cloud=true}) {
  const [mailbox,setMailbox]=useState('primary');
  const secondaryConnection=useGoogleConnection(person,cloud&&person==='amir'&&!connection.state.local,'secondary');
  const selectedMailbox=person==='amir'&&mailbox==='secondary'?'secondary':'primary';
  const activeConnection=selectedMailbox==='secondary'?secondaryConnection:connection;
  const [messages,setMessages]=useState([]),[messagesContext,setMessagesContext]=useState(null),[priority,setPriority]=useState('all'),[scope,setScope]=useState('project'),[order,setOrder]=useState('relevant'),[page,setPage]=useState(0),[stats,setStats]=useState(null),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(null),[syncNote,setSyncNote]=useState(''),[autoSync,setAutoSync]=useState(false),[syncError,setSyncError]=useState('');
  const current=useRef(person);current.current=person;
  const connected=activeConnection.state.connected;
  const canRead=connected&&activeConnection.state.capabilities?.gmailRead===true;
  const mounted=useRef(true),syncLock=useRef(null),latestSync=useRef(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;syncLock.current=null;};},[]);
  useEffect(()=>{setMailbox('primary');},[person]);
  const loadSequence=useRef(0);
  const contextKey=person+':'+selectedMailbox+':'+Boolean(connected)+':'+Boolean(canRead)+':'+(activeConnection.state.email||'');
  const currentContext=useRef(contextKey);currentContext.current=contextKey;
  const suffix=mailboxSuffix(selectedMailbox),visibleMessages=messagesContext===contextKey?messages:[];
  const load=useCallback(async()=>{const sequence=++loadSequence.current;if(!canRead){setMessages([]);return false;}try{const result=await api(`google/mail/messages?profile=${person}${suffix}&priority=${encodeURIComponent(priority)}&scope=${scope}&order=${order}&offset=${page*50}&q=${encodeURIComponent(query)}`);if(!mounted.current||current.current!==person||currentContext.current!==contextKey||sequence!==loadSequence.current)return;setMessages(Array.isArray(result)?result:result.messages||[]);setMessagesContext(contextKey);setStats(result);setError('');return true;}catch(e){if(mounted.current&&current.current===person&&currentContext.current===contextKey&&sequence===loadSequence.current){setError(e.message);setAutoSync(false);}return false;}},[person,canRead,priority,query,scope,order,page,contextKey,suffix]);
  useEffect(()=>{loadSequence.current++;setMessages([]);setMessagesContext(null);setStats(null);setExpanded(null);setError('');setSyncNote('');setSyncError('');setAutoSync(false);setBusy(false);setPage(0);setScope('project');setOrder('relevant');},[contextKey]);
  useEffect(()=>{const timer=setTimeout(load,250);return()=>{clearTimeout(timer);loadSequence.current++;}},[load]);
  async function sync(automatic=false,reset=false,older=false){
    if(!canRead||!mounted.current||syncLock.current?.key===contextKey)return;
    if(automatic&&document.visibilityState!=='visible')return;
    const lock={key:contextKey};syncLock.current=lock;setBusy(true);setError('');setSyncError('');const requested=contextKey;
    try{const result=await api(`google/mail/${older?'project-search':'sync'}?profile=${person}${suffix}`,{method:'POST',body:JSON.stringify(older?{}:reset?{reset:true}:{})});if(!mounted.current||currentContext.current!==requested)return;setSyncNote(result.note||'بخش محدودی از پیام‌های همین حساب همگام شد؛ این نتیجه پیمایش کامل صندوق نیست.');const loaded=await load();if(!mounted.current||currentContext.current!==requested)return;if(!loaded)setAutoSync(false);const status=await activeConnection.refresh();if(!mounted.current||currentContext.current!==requested)return;if(!status?.connected){setAutoSync(false);setError('وضعیت اتصال Google نیازمند بررسی است؛ همگام‌سازی خودکار متوقف شد.');}}
    catch(e){if(mounted.current&&currentContext.current===requested){setAutoSync(false);setSyncError(e.message);const expired=e.message.includes('history_expired_retry_sync');const limited=e.message.includes('sync_volume_limit_reset_required');setError(expired?'سابقهٔ تغییرات Gmail منقضی شده است. همگام‌سازی خودکار متوقف شد؛ دکمهٔ دریافت پیام‌های تازه را بزنید تا از پیام‌های اخیر شروع شود.':limited?'حجم تغییرات از حد همگام‌سازی بیشتر است. همگام‌سازی خودکار متوقف شد؛ در صورت تمایل با دکمهٔ شروع دوباره، پیام‌های اخیر را دریافت کنید.':e.message);}}
    finally{if(syncLock.current===lock)syncLock.current=null;if(mounted.current&&currentContext.current===requested)setBusy(false);}
  }
  latestSync.current=sync;
  useEffect(()=>{if(!autoSync||!canRead)return;const timer=setInterval(()=>{if(document.visibilityState==='visible'&&syncLock.current?.key!==contextKey)latestSync.current?.(true);},60000);return()=>clearInterval(timer);},[autoSync,canRead,contextKey]);
  const mailboxBar=person==='amir'?<div className="inbox-filters"><label>صندوق مستقل این پنل <select aria-label="انتخاب ایمیل امیر" value={selectedMailbox} onChange={e=>setMailbox(e.target.value)}><option value="primary">ایمیل اصلی امیر</option><option value="secondary">ایمیل دوم امیر</option></select></label></div>:null;
  if(!connected)return <section className="google-inbox">{mailboxBar}{selectedMailbox==='secondary'?<GoogleConnection person={person} connection={secondaryConnection} notify={notify}/>:<div className="empty"><Mail size={34}/><h3>صندوق Google همین حساب را متصل کنید</h3><p>دریافت، استخراج اطلاعات و اولویت‌بندی فقط روی ایمیل‌های کاربر واردشده انجام می‌شود.</p><button className="secondary" onClick={onSettings}>بررسی اتصال اختصاصی <ArrowLeft size={15}/></button></div>}</section>;
  if(!canRead)return <section>{mailboxBar}<div className="notice">حساب Google متصل است ولی مجوز خواندن Gmail این حساب فعال نیست. برای اعطای مجوز، اتصال اختصاصی را بررسی کنید. <button className="text-button" onClick={onSettings}>بررسی اتصال</button></div></section>;
  return <section className="google-inbox">{mailboxBar}<div className="section-head"><div><h3>مکاتبات مرتبط با پروژه</h3><small className="google-mailbox" dir="ltr">{activeConnection.state.email}</small></div><button className="secondary" disabled={busy} onClick={()=>sync(false)}><RefreshCw size={15} className={busy?'spin':''}/>{busy?'در حال همگام‌سازی…':'دریافت پیام‌های تازه'}</button></div>
    <label className="checkline inbox-auto-sync"><input type="checkbox" checked={autoSync} onChange={e=>setAutoSync(e.target.checked)}/> همگام‌سازی خودکار هنگام بازبودن این پنل (هر ۶۰ ثانیه)</label>
    <div className="inbox-filters"><label className="inbox-search"><Search size={16}/><input aria-label="جست‌وجوی ایمیل‌های همین حساب" placeholder="موضوع، فرستنده یا متن…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label><select aria-label="محدودهٔ ارتباط ایمیل" value={scope} onChange={e=>{setScope(e.target.value);setPage(0);}}><option value="project">مرتبط با پروژه</option><option value="all">همهٔ پیام‌های همگام‌شده</option></select><select aria-label="چینش ایمیل" value={order} onChange={e=>{setOrder(e.target.value);setPage(0);}}><option value="relevant">مرتبط‌ترین</option><option value="newest">جدیدترین</option><option value="special">ویژه و اقدام‌پذیر</option></select><select aria-label="اولویت پاسخ کارفرما" value={priority} onChange={e=>{setPriority(e.target.value);setPage(0);}}><option value="all">همهٔ اولویت‌ها</option>{Object.entries(priorityNames).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></div>
    <p className="muted">ارتباط با محتوا و تطبیق محدود فرستنده با فهرست مراکز سنجیده می‌شود؛ این امتیاز، احتمال پذیرش نیست. «ویژه» نشانهٔ دعوت، مهلت یا علامت اهمیت Gmail است. فقط پنجرهٔ حداکثر ۵۰۰ پیام همگام‌شده بررسی می‌شود.</p>
    <button className="text-button" disabled={busy} onClick={()=>sync(false,false,true)}>جست‌وجو و ادامهٔ مکاتبات قدیمی‌تر مرتبط</button>
    {stats?.sourceMatching?.status==='lookup_unavailable_content_analysis_only'&&<p className="muted">تطبیق فهرست مراکز اکنون در دسترس نیست؛ تحلیل محتوا ادامه دارد.</p>}
    {syncNote&&<div className="notice">{syncNote}</div>}{error&&<div className="notice" role="alert">{error}{syncError.includes('sync_volume_limit_reset_required')&&<button className="secondary" disabled={busy} onClick={()=>sync(false,true)}>شروع دوباره از پیام‌های اخیر</button>}</div>}
    {!visibleMessages.length&&!error&&<div className="empty"><Mail size={28}/><p>پیام مرتبطی در نتایج فعلی نیست. دریافت پیام‌های تازه یا بررسی صفحهٔ بعد از پیام‌های قدیمی‌تر را بزنید؛ نبود نتیجه به معنی خالی‌بودن صندوق نیست.</p></div>}
    {visibleMessages.map(message=><article className="inbox-message" key={selectedMailbox+':'+message.id}><button className="message-summary" onClick={()=>setExpanded(expanded===message.id?null:message.id)} aria-expanded={expanded===message.id}><div><strong dir="auto"><MixedText>{message.subject||'بدون موضوع'}</MixedText></strong><small dir="auto">{message.from||'فرستنده نامشخص'}</small></div><span className={'status '+(message.priority==='strong'?'':message.priority==='weak'?'red':'amber')}>{message.projectRelevance?.special?'ویژه':priorityNames[message.priority]||'بررسی‌نشده'}</span></button><p className="message-snippet" dir="auto"><MixedText>{message.snippet||''}</MixedText></p>{expanded===message.id&&<div className="message-details"><small>{message.date?new Date(message.date).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'}):''}</small><pre dir="auto">{message.plainBody||message.body||message.snippet||'متن قابل نمایش دریافت نشده است.'}</pre><h4>علت ارتباط با پروژه</h4><ul>{(message.projectRelevance?.reasons||[]).map((reason,i)=><li key={'project-'+i}><MixedText>{relevanceNames[reason]||reason}</MixedText></li>)}</ul><details><summary>نشانه‌های پاسخ و محدودیت تحلیل</summary><ul>{(message.reasons||message.priorityReasons||[]).map((reason,i)=><li key={i} dir="auto">{typeof reason==='string'?reason:reason.text||reason.reason||'نشانهٔ متنی'}</li>)}</ul></details>{message.direction!=='sent'&&<button className="secondary" onClick={()=>{onReply({...message,mailbox:selectedMailbox});notify('متن پاسخ با زمینهٔ همین صندوق آماده شد؛ هیچ ایمیلی ارسال نشده است.');}}><ArrowLeft size={15}/> آماده‌کردن پیش‌نویس پاسخ از همین ایمیل</button>}</div>}</article>)}
    <div className="inbox-filters"><button className="secondary" disabled={!page||busy} onClick={()=>setPage(p=>p-1)}>صفحهٔ قبل</button><span>صفحهٔ {(page+1).toLocaleString('fa-IR')}</span><button className="secondary" disabled={!stats?.more||busy} onClick={()=>setPage(p=>p+1)}>صفحهٔ بعد</button></div>
  </section>;
}
