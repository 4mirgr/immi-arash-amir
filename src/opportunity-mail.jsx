import {interfaceLocale} from './interface-locale.mjs';
import {googleAccountLabel} from './google-account-labels.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {Mail,Eye,Send,X,ExternalLink,RefreshCw,FileText,CalendarClock,ArrowRight} from 'lucide-react';
import {api,apiResponse} from './api';
import {MixedText} from './mixed-text';
import {DualCalendar} from './dual-calendar';
import './opportunity-mail-compact.css';
import './send-action-dock.css';
import {prepareRecipientBatch,sendRecipientBatch,scheduleRecipientBatch} from './opportunity-recipient-batch.mjs';

const reasons={gp_application_template_mismatch:'قالب نامه با بستهٔ انتخاب‌شده هماهنگ نیست؛ پروندهٔ کلینیک را دوباره باز کنید.',gp_application_evidence_required:'شواهد نامه یا رزومه تغییر کرده یا ناقص است؛ بسته را دوباره آماده کنید.',invalid_gp_application:'انتخاب‌های نامهٔ اختصاصی معتبر نیست؛ پرونده را دوباره باز کنید.',published_recipient_missing:'در متن همین آگهی ایمیلی منتشر نشده است؛ از لینک درخواست رسمی استفاده کنید.',recipient_not_published:'گیرنده در نسخهٔ جاری آگهی نیست؛ دوباره بازبینی کنید.',source_observation_stale:'مشاهدهٔ منبع قدیمی است؛ ابتدا دریافت تازهٔ آگهی لازم است.',opportunity_closed_or_future:'این آگهی اکنون قابل اقدام نیست؛ مهلت و اصل منبع را بررسی کنید.',preset_and_cv_required:'قالب ایمیل و نسخهٔ رزومهٔ همین پروفایل را انتخاب کنید.',template_placeholders_require_review:'متغیرهای قالب هنوز تکمیل نشده‌اند؛ قالب را در مرکز مکاتبات ویرایش کنید.',application_changed_review_required:'قالب، رزومه، منبع یا اتصال تغییر کرده است؛ بازبینی تازه لازم است.',recipient_suppressed:'گیرنده در فهرست عدم مکاتبهٔ شماست.',daily_quota_reached:'سهمیهٔ امروز تکمیل شده است.',sender_connection_changed:'اتصال فرستنده تغییر کرده است؛ دوباره بازبینی کنید.',recipient_unavailable:'گیرنده برای آماده‌سازی در دسترس نیست.',google_connection_required:'اتصال Google همین صندوق لازم است.',preset_not_found:'قالب انتخاب‌شده دیگر در دسترس نیست.',cv_not_found:'نسخهٔ رزومهٔ انتخاب‌شده در دسترس نیست.'};
const scheduleStatuses={scheduled:'زمان‌بندی شد',approved:'زمان‌بندی شد',sending:'در حال ارسال؛ دوباره اقدام نکنید',sent:'ارسال با تأیید Gmail',delivery_unknown:'نتیجه نامشخص؛ Sent را بررسی کنید',failed:'ارسال ناموفق',blocked:'ارسال متوقف شد',cancelled:'زمان‌بندی لغو شد',expired:'زمان اجازه به پایان رسید'};
const statuses={queued:'در صف؛ هنوز ارسال نشده',sent:'Gmail ارسال را تأیید کرد',sending:'نتیجه در حال بررسی است؛ دوباره ارسال نکنید',delivery_unknown:'نتیجه نامشخص است؛ پوشهٔ Sent همین حساب را بررسی کنید',failed:'ارسال ناموفق؛ تلاش مجدد خودکار انجام نمی‌شود',suppressed:'گیرنده در فهرست عدم ارسال است',blocked_google_connection:'اتصال Google در دسترس نیست',blocked_account_changed:'حساب Google تغییر کرده است؛ ارسال متوقف شد',not_claimed:'ارسال نشد؛ وضعیت، سهمیه یا اجازه تغییر کرده است',reused:'پیام قبلی پیدا شد؛ دوباره ارسال نشد',queue_unknown:'ثبت صف تأیید نشد؛ پیش از اقدام دیگر مرکز مکاتبات را بررسی کنید',schedule_unknown:'ثبت زمان‌بندی تأیید نشد؛ وضعیت را بازخوانی کنید',cancelled:'عملیات متوقف شد',not_attempted:'این گیرنده اجرا نشد؛ عملیات پیش از رسیدن به آن متوقف شد'};
Object.assign(reasons,{source_no_longer_actionable:'این منبع اکنون شرایط ارسال زمان‌بندی‌شده را ندارد؛ تازگی و اعتبار آگهی را بررسی کنید.',existing_application_job_requires_review:'برای این فرصت پیام قبلیِ متفاوتی ثبت شده است؛ ابتدا آن را در مرکز مکاتبات بررسی کنید.',reviewed_queue_required:'پیام ثابتِ قابل زمان‌بندی آماده نشد؛ پیش‌نمایش تازه بگیرید.',schedule_approval_failed:'زمان‌بندی ثبت نشد؛ وضعیت را بازخوانی کنید.',invalid_schedule_time:'تاریخ یا ساعت انتخاب‌شده معتبر نیست.',scheduled_queue_requires_scheduler:'این پیام زمان‌بندی شده است؛ برای ارسال فوری، ابتدا زمان‌بندی آن را لغو کنید.',scheduled_dispatch_not_authorized:'اجازهٔ زمان‌بندی معتبر نیست؛ وضعیت پیام را دوباره بررسی کنید.',scheduler_storage_not_configured:'زیرساخت زمان‌بندی این حساب در دسترس نیست؛ دوباره وضعیت را بخوانید.',policy_active_approvals_require_settings:'پیام زمان‌بندی‌شدهٔ فعال دارید؛ برای بررسی آن‌ها و تغییر اجازهٔ حساب، تنظیمات را باز کنید.',scheduling_preference_not_verified:'وضعیت زمان‌بندی حساب تأیید نشد؛ دوباره وضعیت را بخوانید.',scheduler_not_enabled:'زمان‌بندی در سرور فعال نیست.',scheduled_mode_required:'برای زمان‌بندی، ابتدا اجازهٔ آن را در تنظیمات همین حساب فعال کنید.',schedule_must_be_within_next_23_5_hours:'زمان را از ۱۵ ثانیه تا ۲۳٫۵ ساعت آینده انتخاب کنید.',active_approval_exists_cancel_before_rescheduling:'این پیام زمان‌بندی فعال دارد؛ ابتدا آن را لغو کنید.',explicit_send_approval_required:'اجازهٔ ارسال همین پیام در زمان انتخابی را تأیید کنید.',approval_already_started_or_terminal:'ارسال شروع شده یا به نتیجه رسیده است؛ لغو ممکن نیست.',opportunity_schedule_active:'برای این درخواست زمان‌بندی فعال وجود دارد؛ ابتدا وضعیت آن را بررسی کنید.',scheduled_dispatch_only:'این پیام زمان‌بندی شده است و از این مسیر دوباره ارسال نمی‌شود.'});
const rows=value=>Array.isArray(value)?value:value?.versions||value?.items||[];
const safeURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const email=value=>String(value||'').toLowerCase();
const roleLabels={application:'درخواست همکاری',organization_general:'تماس عمومی مجموعه',unknown:'نقش گیرنده روشن نیست'};
const recipientRole=(source,address)=>source?.recipientDetails?.filter(item=>email(item.value)===address).sort((a,b)=>({application:0,organization_general:1,unknown:2}[a.contactRole]??3)-({application:0,organization_general:1,unknown:2}[b.contactRole]??3))[0]?.contactRole||'unknown';
const recipientOptions=source=>[...new Set((source?.publishedRecipients||[]).map(email))].sort((a,b)=>({application:0,organization_general:1,unknown:2}[recipientRole(source,a)]??3)-({application:0,organization_general:1,unknown:2}[recipientRole(source,b)]??3));

export function OpportunityMail({person,opportunity,onClose=()=>{},notify=()=>{},onOpenSettings=()=>{},gpApplication=null,compact=false}){
 const application=person==='arash'&&gpApplication?{variant:gpApplication.variant,subjectIndex:gpApplication.subjectIndex,clinicQuote:gpApplication.clinicQuote,cvQuote:gpApplication.cvQuote,confirmCvQuote:gpApplication.confirmCvQuote,...(gpApplication.connectionId?{connectionId:gpApplication.connectionId,confirmConnection:gpApplication.confirmConnection===true}:{})}:null;
 const oppId=opportunity?.id||'',scope=person+':'+oppId+':'+JSON.stringify(application);
 const identity=useRef({scope,epoch:0});if(identity.current.scope!==scope)identity.current={scope,epoch:identity.current.epoch+1};
 const epoch=identity.current.epoch,alive=useRef(true),operation=useRef(0),lock=useRef(false),reviewTarget=useRef(null);
 const [stored,setStored]=useState(null),[form,setForm]=useState(null),[review,setReview]=useState(null),[checked,setChecked]=useState(false),[queued,setQueued]=useState(null),[result,setResult]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const [policyConfirmed,setPolicyConfirmed]=useState(false),[transportUnknown,setTransportUnknown]=useState(false);
 const [when,setWhen]=useState(null),[zone,setZone]=useState('Australia/Sydney'),[invalidTime,setInvalidTime]=useState(false),[scheduleConfirmed,setScheduleConfirmed]=useState(false),[scheduleRecord,setScheduleRecord]=useState(null),[scheduleUnknown,setScheduleUnknown]=useState(false);
 const valid=()=>alive.current&&identity.current.scope===scope&&identity.current.epoch===epoch;
 const data=stored?.epoch===epoch&&stored.scope===scope?stored.data:null;
 const selection=form?.epoch===epoch&&form.scope===scope?form.value:{presetId:'',cvVersionId:'',mailbox:'primary',recipients:[]};
 const payloadKey=JSON.stringify({selection,application}),latest=useRef(payloadKey);latest.current=payloadKey;
 const preview=review?.scope===scope&&review.epoch===epoch&&review.payloadKey===payloadKey?review:null;
 const queue=queued?.scope===scope&&queued.epoch===epoch&&queued.payloadKey===payloadKey?queued:null;
 const localSchedules=scheduleRecord?.scope===scope&&scheduleRecord.epoch===epoch?scheduleRecord.approvals:[];
 const scheduleRecords=[...(data?.source?.scheduling?.approvals||[]).filter(item=>!localSchedules.some(local=>local.id===item.id)),...localSchedules];
 const activeSchedule=scheduleRecords.find(item=>['approved','sending'].includes(item.status));
 const scheduleLocked=Boolean(activeSchedule)||scheduleUnknown||transportUnknown;
 const scheduling=data?.source?.scheduling;
 const timeValue=when?Date.parse(when):NaN,timeInvalid=!Number.isFinite(timeValue)||timeValue<=Date.now()+15000||timeValue>Date.now()+23.5*3600000;
 const last=result?.scope===scope&&result.epoch===epoch?result.items:[];
 const reviewedReady=Boolean(preview?.prepared.entries.length&&preview.prepared.entries.length===selection.recipients.length&&!preview.prepared.blocked.length);
 const containsExistingQueue=Boolean(preview?.prepared.entries.some(entry=>entry.queuedExisting));
 const recipientsLocked=!!busy||!!queue||scheduleLocked;
 const sourceURL=safeURL(data?.source?.url||opportunity?.url||opportunity?.sourceUrl);
 const publishedAddresses=recipientOptions(data?.source);
 const account=data?.accounts?.[selection.mailbox],canSend=account?.connected&&account.capabilities?.gmailSend===true;
 const path=action=>'opportunities/'+encodeURIComponent(oppId)+'/mail'+(action?'/'+action:'')+'?profile='+encodeURIComponent(person);
 const message=value=>({batch_limit_reached:'در هر دسته حداکثر ۲۰ گیرنده قابل آماده‌سازی است.',preview_unavailable:'پیش‌نمایش این گیرنده آماده نشد.',recipient_already_queued:'پیام قبلی این گیرنده در صف است.',recipient_already_sent:'برای این گیرنده قبلاً ارسال ثبت شده است.',duplicate_recipient:'این ایمیل تکراری است و جداگانه دوباره ارسال نمی‌شود.',batch_already_consumed:'این دسته قبلاً اجرا شده است؛ نتیجهٔ همان اجرا را بررسی کنید.',recipient_batch_not_current:'انتخاب‌ها تغییر کرده‌اند؛ پیش‌نمایش تازه بگیرید.',schedule_batch_limit_reached:'زمان‌بندی فعلی حداکثر سه گیرنده در هر نوبت دارد.',schedule_recipient_limit_reached:'زمان‌بندی فعلی حداکثر سه گیرنده در هر نوبت دارد.',previous_application_exists:'برای این گیرنده پیام قبلی در صف یا در سابقهٔ ارسال ثبت شده است.',recipient_request_failed:'درخواست این گیرنده کامل نشد؛ دوباره وضعیت را بررسی کنید.',batch_context_changed:'حساب یا انتخاب‌های فرم تغییر کرده‌اند؛ عملیات متوقف شد.',batch_stopped:'عملیات پیش از این گیرنده متوقف شد.'}[value]||reasons[value]||value);
 function resetReview(){setReview(null);setChecked(false);setScheduleConfirmed(false);setQueued(null);setResult(null);}
 function change(key,value){operation.current++;setForm({scope,epoch,value:{...selection,[key]:value}});resetReview();setError('');}
 async function load(){
  if(lock.current)return;lock.current=true;const request=++operation.current;setBusy('load');setError('');resetReview();
  try{
   const accountError=e=>({connected:false,error:message(e.message)});
   const [source,presets,cvs,primary,secondary]=await Promise.all([api(path('')),api('presets?profile='+encodeURIComponent(person)),api('cv/versions?profile='+encodeURIComponent(person)),api('google/status?profile='+encodeURIComponent(person)+'&mailbox=primary').catch(accountError),api('google/status?profile='+encodeURIComponent(person)+'&mailbox=secondary').catch(accountError)]);
   if(!valid()||request!==operation.current)return;
   const templates=rows(presets),versions=rows(cvs);if(source.scheduling&&Array.isArray(source.scheduling.approvals)){setScheduleRecord(null);setScheduleUnknown(false);}setStored({scope,epoch,data:{source,presets:templates,cvs:versions,accounts:{primary,secondary}}});
   setForm({scope,epoch,value:{presetId:(application?templates.find(x=>x.name===gpApplication.templateName):templates.find(x=>x.isDefault||x.is_default))?.id||'',cvVersionId:(application?versions.find(x=>x.id===gpApplication.cvVersionId):versions.find(x=>x.isDefault||x.is_default))?.id||'',mailbox:'primary',recipients:recipientOptions(source)}});
  }catch(e){if(valid()&&request===operation.current)setError(message(e.message));}
  finally{if(valid()){lock.current=false;setBusy('');}}
 }
 useEffect(()=>{alive.current=true;lock.current=false;setWhen(null);setPolicyConfirmed(false);setScheduleConfirmed(false);setScheduleRecord(null);setScheduleUnknown(false);setTransportUnknown(false);setStored(null);setForm(null);setError('');load();return()=>{alive.current=false;operation.current++;};},[scope]);
 useEffect(()=>{setScheduleConfirmed(false);},[payloadKey,when,zone]);
 async function action(kind){
  if(lock.current||scheduleLocked||!data||!selection.presetId||!selection.cvVersionId||!selection.recipients.length||!canSend||queue)return;
  if(kind!=='preview'&&(!preview||!checked||!reviewedReady))return;
  const selectedKey=payloadKey,request=++operation.current,plan={opportunityId:oppId,...selection,...(application?{application}:{})},expected=account.email;
  const fresh=()=>valid()&&operation.current===request&&latest.current===selectedKey;
  lock.current=true;setBusy(kind);setError('');
  try{
   if(kind==='preview'){
    const prepared=await prepareRecipientBatch({api,person,plans:[plan],isActive:fresh});if(!fresh())return;
    if(prepared.entries.some(entry=>email(entry.sender)!==email(expected)))throw Error('sender_connection_changed');
    setReview({scope,epoch,payloadKey:selectedKey,prepared,data:prepared.entries[0]?.preview||null});setChecked(false);setQueued(null);setResult(null);return;
   }
   // A reviewed preparation is consumed before transport. Never replay a partial batch.
   setQueued({scope,epoch,payloadKey:selectedKey,consumed:true});setChecked(false);setScheduleConfirmed(false);
   const sent=await sendRecipientBatch({api,person,prepared:preview.prepared,isActive:fresh,confirmReviewed:true,queueOnly:kind==='queue',onProgress:(item,items)=>{if(fresh())setResult({scope,epoch,items:[...items]});}});
   if(!fresh())return;
   setResult({scope,epoch,items:sent.results});if(sent.unknown)setTransportUnknown(true);
   const count=sent.results.filter(item=>item.status==='sent').length;
   notify(kind==='queue'?'نتیجهٔ ثبت پیام‌های انتخاب‌شده در صف آماده است؛ ایمیلی ارسال نشد.':count?`${count.toLocaleString(interfaceLocale('fa-IR'))} ایمیل ارسال شد؛ نتیجهٔ هر گیرنده را ببینید.`:'ارسال تازه‌ای تأیید نشد؛ نتیجهٔ هر گیرنده را بررسی کنید.');
  }catch(e){if(fresh()){setError(message(e.message));if(kind==='preview')resetReview();else setTransportUnknown(true);}}
  finally{if(valid()){lock.current=false;setBusy('');}}
 }
 async function enableSchedulePolicy(){
  if(lock.current||!policyConfirmed||!scheduling?.enabled)return;
  lock.current=true;const request=++operation.current;setBusy('policy');setError('');
  try{
   const status=await api('mail-automation/scheduler?profile='+encodeURIComponent(person));
   if(!valid()||request!==operation.current)return;
   if(!Array.isArray(status.approvals))throw Error('scheduling_preference_not_verified');
   if(status.approvals.some(item=>['approved','sending'].includes(item.status)))throw Error('policy_active_approvals_require_settings');
   await api('mail-automation/settings?profile='+encodeURIComponent(person),{method:'POST',body:JSON.stringify({mode:'automatic'})});
   if(!valid()||request!==operation.current)return;
   const source=await api(path(''));if(!valid()||request!==operation.current)return;
   setStored({scope,epoch,data:{...data,source}});setPolicyConfirmed(false);setChecked(false);setScheduleConfirmed(false);
   notify('امکان زمان‌بندی فعال شد؛ ارسال هر پیام همچنان تأیید جداگانه می‌خواهد.');
  }catch(e){if(valid()&&request===operation.current)setError(message(e.message));}
  finally{if(valid()){lock.current=false;setBusy('');}}
 }
 async function schedule(){
  if(lock.current||scheduleLocked||!preview||!checked||!reviewedReady||queue||!canSend||!scheduling?.enabled||!scheduling?.modeReady||scheduling.sourceEligible===false||!scheduleConfirmed||invalidTime||timeInvalid||selection.recipients.length>3)return;
  const request=++operation.current,selectedKey=payloadKey,fixedWhen=when;
  const fresh=()=>valid()&&operation.current===request&&latest.current===selectedKey;
  lock.current=true;setBusy('schedule');setError('');setQueued({scope,epoch,payloadKey:selectedKey,consumed:true});setChecked(false);setScheduleConfirmed(false);
  try{
   const scheduled=await scheduleRecipientBatch({api,person,prepared:preview.prepared,isActive:fresh,confirmReviewed:true,confirmSend:true,sendAfterISO:fixedWhen,onProgress:(item,items)=>{if(fresh())setResult({scope,epoch,items:[...items]});}});
   if(!fresh())return;
   const approvals=scheduled.results.map(item=>item.approval).filter(Boolean);
   setScheduleRecord({scope,epoch,approvals});setResult({scope,epoch,items:scheduled.results});if(scheduled.unknown)setScheduleUnknown(true);
   notify(approvals.length?`${approvals.length.toLocaleString(interfaceLocale('fa-IR'))} زمان‌بندی ثبت شد؛ وضعیت هر گیرنده را ببینید.`:'زمان‌بندی تازه‌ای تأیید نشد؛ وضعیت را بازخوانی کنید.');
  }catch(e){if(fresh()){setError(message(e.message));setScheduleUnknown(true);}}
  finally{if(valid()){lock.current=false;setBusy('');}}
 }
 async function cancelSchedule(approval){
  if(lock.current||approval.status!=='approved')return;
  lock.current=true;const request=++operation.current;setBusy('cancel');setError('');
  try{
   const result=await api('mail-automation/scheduler/cancel?profile='+encodeURIComponent(person),{method:'POST',body:JSON.stringify({approvalId:approval.id})});
   if(!valid()||request!==operation.current)return;
   if(result.id!==approval.id||result.status!=='cancelled')throw Error('application_changed_review_required');
   setScheduleRecord({scope,epoch,approvals:[...localSchedules.filter(item=>item.id!==approval.id),{...approval,...result}]});setChecked(false);setScheduleConfirmed(false);resetReview();
   const source=await api(path(''));if(!valid()||request!==operation.current)return;
   setStored({scope,epoch,data:{...data,source}});setScheduleRecord(null);setScheduleUnknown(false);notify('زمان‌بندی لغو شد. برای ارسال دیگر، پیش‌نمایش تازه بگیرید.');
  }catch(e){if(valid()&&request===operation.current){setError(message(e.message));setScheduleUnknown(true);}}
  finally{if(valid()){lock.current=false;setBusy('');}}
 }
 const scheduleDate=value=>{try{return new Intl.DateTimeFormat(interfaceLocale('fa-IR-u-ca-persian'),{timeZone:'Asia/Tehran',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch{return 'زمان نیازمند بررسی';}};
 async function downloadCV(){if(!selection.cvVersionId||lock.current)return;lock.current=true;setBusy('cv');const request=++operation.current;try{const response=await apiResponse('cv/export?profile='+encodeURIComponent(person)+'&id='+encodeURIComponent(selection.cvVersionId)+'&format=docx'),blob=await response.blob();if(!valid()||request!==operation.current)return;const href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download=person+'-application-cv.docx';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}catch(e){if(valid())setError(message(e.message));}finally{if(valid()){lock.current=false;setBusy('');}}}
 const contacts=(data?.source?.recipientDetails||[]).filter(item=>selection.recipients.includes(email(item.value)));
 const cvLabel=data?.cvs.find(item=>item.id===selection.cvVersionId)?.name||'رزومهٔ انتخاب‌شده';
 const schedulePanel=<details className="opportunity-mail-schedule"><summary><CalendarClock size={17}/> زمان‌بندی ارسال</summary>
  {!scheduling?.enabled?<p className="notice">زمان‌بندی در سرور فعال نیست؛ ارسال دستی در دسترس است.</p>:scheduling.sourceEligible===false?<p className="notice">این منبع هنوز شرایط زمان‌بندی خودکار را ندارد؛ تازگی و اعتبار آن باید در سرور تأیید شود. ارسال دستی پس از بازبینی در دسترس است.</p>:!scheduling.modeReady?<div className="notice"><p>زمان‌بندی برای حساب شما خاموش است. فعال‌کردن این گزینه به‌تنهایی ایمیلی ارسال نمی‌کند؛ هر پیام را جداگانه تأیید می‌کنید.</p><label className="checkline"><input type="checkbox" checked={policyConfirmed} disabled={!!busy} onChange={e=>setPolicyConfirmed(e.target.checked)}/>اجازه می‌دهم پیام‌هایی که جداگانه تأیید می‌کنم، در زمان انتخابی ارسال شوند.</label><button type="button" className="secondary" disabled={!!busy||!policyConfirmed} onClick={enableSchedulePolicy}>{busy==='policy'?'در حال فعال‌سازی…':'فعال‌کردن زمان‌بندیِ تأییدشده برای حساب من'}</button><button type="button" className="text-button" onClick={onOpenSettings}>تنظیمات زمان‌بندی</button></div>:<fieldset disabled={!!busy} className="opportunity-mail-calendar">
   <legend>چه زمانی ارسال شود؟</legend><button type="button" className="text-button" onClick={()=>setWhen(new Date(Date.now()+3600000).toISOString())}>یک ساعت دیگر</button>
   <DualCalendar value={when} onChange={setWhen} timezone={zone} onTimezoneChange={setZone} onValidityChange={setInvalidTime}/>
   {selection.recipients.length>3&&<p className="notice">زمان‌بندی فعلی حداکثر سه گیرنده در هر نوبت دارد و سقف روزانهٔ حساب هم بررسی می‌شود؛ تعداد گیرندگان را کاهش دهید.</p>}{when&&(timeInvalid||invalidTime)&&<p className="notice" role="alert">زمان را بین ۱۵ ثانیه و ۲۳٫۵ ساعت آینده انتخاب کنید.</p>}
   <p className="section-help">ارسال در نوبت سرور پس از زمان انتخابی انجام می‌شود؛ حداکثر ۳۰ دقیقه فرصت دارد.</p>
   <label className="checkline"><input type="checkbox" checked={scheduleConfirmed} disabled={!checked||timeInvalid||invalidTime||selection.recipients.length>3} onChange={e=>setScheduleConfirmed(e.target.checked)}/>اجازه می‌دهم همین متن و رزومه، از همین صندوق به گیرندگان انتخاب‌شده، در زمان انتخابی ارسال شود.</label>
   <button type="button" className="primary" disabled={!!busy||!checked||!scheduleConfirmed||timeInvalid||invalidTime||scheduleLocked||!canSend||selection.recipients.length>3} onClick={schedule}><CalendarClock size={16}/>{busy==='schedule'?'در حال ثبت…':'ثبت زمان‌بندی ایمیل‌های انتخاب‌شده'}</button>
  </fieldset>}
 </details>;
 const additionalInfo=<>
  {application&&<p className="muted">{!compact&&'این درخواست از بستهٔ اختصاصی آماده شده است. '}متن از شواهد همین کلینیک و نسخهٔ رزومهٔ انتخاب‌شده ساخته شده است؛ برای تغییر آن، به متن نامه برگردید.{data&&!selection.presetId&&' قالب A/B/C مرتبط در حساب پیدا نشد؛ آن را از تنظیمات اضافه کنید.'}</p>}
  {data?.source.trust!=='official'&&<p className="muted">منبع رسمی تأیید نشده است؛ هویت مرکز را پیش از ارسال بررسی کنید.</p>}
  {contacts.map(contact=><div key={contact.value} className="opportunity-mail-contact"><bdi dir="ltr">{contact.value}</bdi><p>{contact.sourceRelation==='linked_page'?'ایمیل از صفحهٔ مرتبط مجموعه استخراج شده است.':'ایمیل از همین صفحهٔ آگهی استخراج شده است.'} {contact.contactRole==='application'?'برای درخواست همکاری منتشر شده است.':contact.contactRole==='organization_general'?'راه تماس عمومی مجموعه است.':'نقش گیرنده هنوز روشن نیست.'}</p><blockquote dir="auto"><MixedText>{contact.quote}</MixedText></blockquote>{safeURL(contact.sourceURL)&&<a href={safeURL(contact.sourceURL)} target="_blank" rel="noreferrer">منبع ایمیل انتخابی <ExternalLink size={12}/></a>}</div>)}
  <p className="muted">عنوان، گیرنده، متن و فایل رزومه را بررسی کنید؛ انتشار ایمیل به‌تنهایی هویت گیرنده را تأیید نمی‌کند.</p>
  {preview?.data&&<p className="muted">سقف روزانه: {preview.data.dailyLimit} · استفاده‌شده: {preview.data.reservedToday||0} · مبنا UTC</p>}
 </>;
 const sendDisabled=!!busy||!!queue||scheduleLocked||!data||!canSend||!selection.presetId||!selection.cvVersionId||!selection.recipients.length||containsExistingQueue;
 const sendHint=!data?'در حال دریافت…':!canSend?'اتصال و اجازهٔ ارسال Gmail همین صندوق لازم است.':!selection.presetId||!selection.cvVersionId?reasons.preset_and_cv_required:!selection.recipients.length?reasons.published_recipient_missing:queue?'نتیجهٔ این نوبت پایین نمایش داده می‌شود.':scheduleLocked?'ابتدا وضعیت ارسال یا زمان‌بندی قبلی را بررسی کنید.':!preview?'ابتدا متن نهایی و رزومه را ببینید؛ هنوز ایمیلی ارسال نمی‌شود.':!checked?'متن و رزومه را بخوانید و تیک بازبینی را بزنید.':'آمادهٔ ارسال از صندوق انتخاب‌شده به گیرندگان همین آگهی.';
 function primarySend(){if(sendDisabled)return;if(!preview){action('preview');return;}if(!checked||!reviewedReady){reviewTarget.current?.scrollIntoView({behavior:'smooth',block:'center'});reviewTarget.current?.focus({preventScroll:true});return;}action('send');}
 return <section className={'opportunity-mail panel'+(compact?' opportunity-mail-compact':'')} aria-label="مکاتبه دربارهٔ همین فرصت" dir="rtl">
  <div className="section-head"><h3><Mail size={19}/>{compact?'ارسال یا زمان‌بندی':'درخواست برای همین فرصت'}</h3><button type="button" className={compact?'text-button':'icon'} onClick={onClose} aria-label={compact?'بازگشت به متن':'بستن مکاتبه'}>{compact?<><ArrowRight size={16}/>بازگشت به متن</>:<X size={18}/>}</button></div>
  <div className="send-action-dock send-action-dock-inline" aria-label="اقدام ارسال همین آگهی"><div><strong>ارسال برای همین آگهی</strong><small>{sendHint}</small></div><button type="button" className="primary" disabled={sendDisabled} onClick={primarySend}><Send size={17}/>{busy==='send'?'در حال ارسال…':preview&&checked&&reviewedReady?'ارسال نهایی ایمیل و رزومه':'ارسال ایمیل و رزومه'}</button></div>
  {!compact&&<p><MixedText>{data?.source?.title||opportunity?.title||'فرصت انتخاب‌شده'}</MixedText></p>}
  <div className="opportunity-mail-actions opportunity-mail-context-actions">{sourceURL&&<a href={sourceURL} target="_blank" rel="noreferrer">اصل آگهی <ExternalLink size={14}/></a>}<button type="button" className="text-button" onClick={onOpenSettings}>تنظیمات حساب</button><button type="button" className="text-button" disabled={!!busy} onClick={load}><RefreshCw size={14}/> بازخوانی وضعیت</button></div>
  {error&&<p className="notice" role="alert"><MixedText>{error}</MixedText></p>}
  {transportUnknown&&<p className="notice" role="status">نتیجهٔ بخشی از ارسال روشن نیست. این دسته دوباره اجرا نمی‌شود؛ وضعیت را در مرکز مکاتبات و پوشهٔ Sent بررسی کنید.</p>}
  {scheduleUnknown&&<p className="notice" role="status">نتیجهٔ زمان‌بندی روشن نیست. پیش از اقدام دیگر، «بازخوانی وضعیت» را بزنید.</p>}
  {!data?<p className="muted">{busy?'در حال آماده‌کردن درخواست…':'اطلاعات آماده نشد؛ دوباره وضعیت را بخوانید.'}</p>:<>
   {compact?<details className="opportunity-mail-extra"><summary>منبع و جزئیات بررسی</summary>{additionalInfo}</details>:additionalInfo}
   {scheduleRecords.length>0&&<div className="opportunity-mail-scheduled" aria-label="وضعیت زمان‌بندی همین فرصت">{scheduleRecords.map(approval=><div key={approval.id}>
    <strong>{scheduleStatuses[approval.status]||approval.status}</strong><p>تهران · {scheduleDate(approval.sendAfter)}</p><p className="muted"><bdi dir="ltr">{approval.sender}</bdi> ← <bdi dir="ltr">{approval.recipient}</bdi></p>
    {approval.message&&<details><summary>متن و پیوست برنامه‌ریزی‌شده</summary><h4 dir="auto"><MixedText>{approval.message.subject}</MixedText></h4><pre dir="ltr">{approval.message.body}</pre><p><MixedText>{approval.attachmentName||'نسخهٔ رزومهٔ ثبت‌شده با این پیام'}</MixedText></p></details>}
    {approval.status==='approved'&&<button type="button" className="secondary" disabled={!!busy} onClick={()=>cancelSchedule(approval)}>{busy==='cancel'?'در حال لغو…':'لغو زمان‌بندی همین ایمیل'}</button>}
   </div>)}</div>}
   {!data.source.publishedRecipients?.length?<p className="notice">{reasons.published_recipient_missing}</p>:<>
    <div className="opportunity-mail-fields two-col">
     {(!compact||!application)&&<><label>قالب ایمیل<select value={selection.presetId} disabled={!!busy||!!queue||!!application||scheduleLocked} onChange={e=>change('presetId',e.target.value)}><option value="">قالب را انتخاب کنید</option>{data.presets.map(x=><option key={x.id} value={x.id}>{x.name||x.subject||'قالب'}{x.isDefault?' · پیش‌فرض':''}</option>)}</select></label>
     <label>رزومهٔ پیوست<select value={selection.cvVersionId} disabled={!!busy||!!queue||!!application||scheduleLocked} onChange={e=>change('cvVersionId',e.target.value)}><option value="">رزومه را انتخاب کنید</option>{data.cvs.map(x=><option key={x.id} value={x.id}>{x.name||'رزومه'}{x.isDefault?' · پیش‌فرض':''}</option>)}</select></label></>}
     <label>فرستنده<select value={selection.mailbox} disabled={!!busy||!!queue||scheduleLocked} onChange={e=>change('mailbox',e.target.value)}><option value="primary">{googleAccountLabel(person,'primary',data?.accounts?.primary?.email)}</option><option value="secondary">{googleAccountLabel(person,'secondary',data?.accounts?.secondary?.email)}</option></select></label>
     <fieldset className="opportunity-recipient-picker" disabled={recipientsLocked}><legend>گیرندگان · {selection.recipients.length.toLocaleString(interfaceLocale('fa-IR'))} انتخاب‌شده</legend><div className="opportunity-recipient-actions"><button type="button" className="text-button" onClick={()=>change('recipients',publishedAddresses)}>انتخاب همه</button><button type="button" className="text-button" onClick={()=>change('recipients',[])}>برداشتن همه</button></div><div className="opportunity-recipient-list">{publishedAddresses.map(address=><label key={address} className="checkline"><input type="checkbox" checked={selection.recipients.includes(address)} onChange={e=>change('recipients',e.target.checked?[...selection.recipients,address]:selection.recipients.filter(item=>item!==address))}/><span><bdi dir="ltr">{address}</bdi><small className="recipient-role">{roleLabels[recipientRole(data.source,address)]||roleLabels.unknown}</small></span></label>)}</div><p className="section-help">همهٔ ایمیل‌های منتشرشده ابتدا انتخاب‌اند؛ برای هر گیرنده ایمیل جدا فرستاده می‌شود.</p></fieldset>
    </div>
    {compact&&application&&<p className="opportunity-mail-attachment"><FileText size={15}/><MixedText>{cvLabel}</MixedText><button type="button" className="text-button" disabled={!!busy||!selection.cvVersionId} onClick={downloadCV}>دریافت رزومه</button></p>}
    {!canSend&&<p className="notice">اتصال و اجازهٔ ارسال Gmail همین صندوق لازم است.</p>}
    {account?.error&&<p className="notice"><MixedText>{account.error}</MixedText></p>}
    {!selection.presetId&&<p className="notice">{application?'قالب A/B/C انتخاب‌شده در این حساب موجود نیست؛ از «تنظیمات حساب» قالب‌های آرش را اضافه کنید.':'قالب ایمیل را انتخاب کنید؛ اگر فهرست خالی است، از تنظیمات حساب قالب بسازید.'}</p>}
    {!selection.cvVersionId&&<p className="notice">{application?'به متن نامه برگردید و نسخهٔ رزومه را انتخاب کنید.':'نسخهٔ رزومهٔ پیوست را انتخاب کنید.'}</p>}
    {!scheduleLocked&&<div className="opportunity-mail-actions">{!compact&&<button type="button" className="secondary" disabled={!!busy||!selection.cvVersionId} onClick={downloadCV}><FileText size={15}/> دریافت همین رزومه برای بازبینی</button>}<button type="button" className="secondary" disabled={!!busy||!!queue||!canSend||!selection.presetId||!selection.cvVersionId||!selection.recipients.length} onClick={()=>action('preview')}><Eye size={15}/>{busy==='preview'?'در حال بررسی…':compact?'پیش‌نمایش نهایی ایمیل':'نمایش ایمیل و پیوست پیش از ارسال'}</button></div>}
    {preview&&<div className="opportunity-mail-review send-preview" ref={reviewTarget} tabIndex={-1}>
     {preview.prepared.blocked.length>0&&<div className="notice" role="alert"><strong>بعضی گیرندگان آمادهٔ ارسال نیستند؛ تیک آن‌ها را بردارید و دوباره پیش‌نمایش بگیرید.</strong>{preview.prepared.blocked.map((item,index)=><p key={item.recipient+':'+index}><bdi dir="ltr">{item.recipient}</bdi> · <MixedText>{message(item.reason)}</MixedText></p>)}</div>}
     {containsExistingQueue&&<p className="notice">برای بعضی گیرندگان پیام قبلی در صف است؛ ارسال دستی دوباره انجام نمی‌شود. برای اقدام روی آن پیام، مرکز مکاتبات را باز کنید یا پس از لغو برنامهٔ قبلی، زمان‌بندی تازه تعیین کنید.</p>}{preview.prepared.entries.map((entry,index)=><details className="opportunity-recipient-preview" key={entry.id} open={index===0}><summary><bdi dir="ltr">{entry.recipient}</bdi> · متن و پیوست</summary><div className="opportunity-mail-envelope"><span>از <bdi dir="ltr">{entry.sender}</bdi></span><span><FileText size={14}/><MixedText>{entry.preview.recipients[0]?.attachmentName||'رزومهٔ انتخاب‌شده'}</MixedText></span></div><h4 dir="auto"><MixedText>{entry.preview.message?.subject}</MixedText></h4><pre dir="ltr" className="opportunity-mail-body">{entry.preview.message?.body}</pre></details>)}
     {!queue&&!scheduleLocked&&<><label className="checkline"><input type="checkbox" checked={checked} disabled={!!busy||!reviewedReady} onChange={e=>{setChecked(e.target.checked);setScheduleConfirmed(false);}}/>گیرندگان، متن و همین رزومه را بررسی کردم.</label><div className="opportunity-mail-send-actions"><button type="button" className="primary" disabled={!!busy||!checked||!reviewedReady||containsExistingQueue} onClick={()=>action('send')}><Send size={16}/>{busy==='send'?'در حال ارسال…':'ارسال ایمیل و رزومه به گیرندگان انتخاب‌شده'}</button>{!compact&&<button type="button" className="text-button" disabled={!!busy||!checked||!reviewedReady||containsExistingQueue} onClick={()=>action('queue')}>فقط ذخیره در صف؛ بدون ارسال</button>}</div>{schedulePanel}</>}
    </div>}
    {(queue||last.length>0)&&<div className="notice opportunity-mail-queued" aria-label="نتیجهٔ ارسال برای هر گیرنده"><strong>نتیجهٔ هر گیرنده</strong>{last.length?last.map((item,index)=><p key={item.id||item.recipient+':'+index}><bdi dir="ltr">{item.recipient}</bdi> · {statuses[item.status]||scheduleStatuses[item.status]||message(item.reason)||item.status}{item.reason&&<small className="recipient-result-reason"><MixedText>{message(item.reason)}</MixedText></small>}</p>):<p>در حال ثبت نتیجه…</p>}{!busy&&selection.recipients.filter(address=>!last.some(item=>item.recipient===address)).map(address=><p key={address}><bdi dir="ltr">{address}</bdi> · این گیرنده اجرا نشد؛ عملیات پیش از رسیدن به آن متوقف شد.</p>)}<p className="section-help">این دسته دوباره اجرا نمی‌شود. برای موارد نامشخص، مرکز مکاتبات و پوشهٔ Sent را بررسی کنید.</p></div>}

   </>}
  </>}
 </section>;
}
