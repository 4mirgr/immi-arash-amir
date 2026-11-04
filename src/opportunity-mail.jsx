import React,{useEffect,useRef,useState} from 'react';
import {Mail,Eye,Send,X,ExternalLink,RefreshCw,FileText} from 'lucide-react';
import {api,apiResponse} from './api';
import {MixedText} from './mixed-text';

const reasons={published_recipient_missing:'در متن همین آگهی ایمیلی منتشر نشده است؛ از لینک درخواست رسمی استفاده کنید.',recipient_not_published:'گیرنده در نسخهٔ جاری آگهی نیست؛ دوباره بازبینی کنید.',source_observation_stale:'مشاهدهٔ منبع قدیمی است؛ ابتدا دریافت تازهٔ آگهی لازم است.',opportunity_closed_or_future:'این آگهی اکنون قابل اقدام نیست؛ مهلت و اصل منبع را بررسی کنید.',preset_and_cv_required:'قالب ایمیل و نسخهٔ رزومهٔ همین پروفایل را انتخاب کنید.',template_placeholders_require_review:'متغیرهای قالب هنوز تکمیل نشده‌اند؛ قالب را در مرکز مکاتبات ویرایش کنید.',application_changed_review_required:'قالب، رزومه، منبع یا اتصال تغییر کرده است؛ بازبینی تازه لازم است.',recipient_suppressed:'گیرنده در فهرست عدم مکاتبهٔ شماست.',daily_quota_reached:'سهمیهٔ امروز تکمیل شده است.',sender_connection_changed:'اتصال فرستنده تغییر کرده است؛ دوباره بازبینی کنید.',recipient_unavailable:'گیرنده برای آماده‌سازی در دسترس نیست.',google_connection_required:'اتصال Google همین صندوق لازم است.',preset_not_found:'قالب انتخاب‌شده دیگر در دسترس نیست.',cv_not_found:'نسخهٔ رزومهٔ انتخاب‌شده در دسترس نیست.'};
const statuses={queued:'در صف؛ هنوز ارسال نشده',sent:'Gmail ارسال را تأیید کرد',sending:'نتیجه در حال بررسی است؛ دوباره ارسال نکنید',delivery_unknown:'نتیجه نامشخص است؛ پوشهٔ Sent همین حساب را بررسی کنید',failed:'ارسال ناموفق؛ تلاش مجدد خودکار انجام نمی‌شود',suppressed:'گیرنده در فهرست عدم ارسال است',blocked_google_connection:'اتصال Google در دسترس نیست',blocked_account_changed:'حساب Google تغییر کرده است؛ ارسال متوقف شد',not_claimed:'ارسال نشد؛ وضعیت، سهمیه یا اجازه تغییر کرده است'};
const rows=value=>Array.isArray(value)?value:value?.versions||value?.items||[];
const safeURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const email=value=>String(value||'').toLowerCase();

export function OpportunityMail({person,opportunity,onClose=()=>{},notify=()=>{},onOpenSettings=()=>{}}){
 const oppId=opportunity?.id||'',scope=person+':'+oppId;
 const identity=useRef({scope,epoch:0});if(identity.current.scope!==scope)identity.current={scope,epoch:identity.current.epoch+1};
 const epoch=identity.current.epoch,alive=useRef(true),operation=useRef(0),lock=useRef(false);
 const [stored,setStored]=useState(null),[form,setForm]=useState(null),[review,setReview]=useState(null),[checked,setChecked]=useState(false),[queued,setQueued]=useState(null),[result,setResult]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const valid=()=>alive.current&&identity.current.scope===scope&&identity.current.epoch===epoch;
 const data=stored?.epoch===epoch&&stored.scope===scope?stored.data:null;
 const selection=form?.epoch===epoch&&form.scope===scope?form.value:{presetId:'',cvVersionId:'',mailbox:'primary',recipient:''};
 const payloadKey=JSON.stringify(selection),latest=useRef(payloadKey);latest.current=payloadKey;
 const preview=review?.scope===scope&&review.epoch===epoch&&review.payloadKey===payloadKey?review:null;
 const queue=queued?.scope===scope&&queued.epoch===epoch&&queued.payloadKey===payloadKey?queued:null;
 const last=result?.scope===scope&&result.epoch===epoch?result.item:null;
 const sourceURL=safeURL(data?.source?.url||opportunity?.url||opportunity?.sourceUrl);
 const account=data?.accounts?.[selection.mailbox],canSend=account?.connected&&account.capabilities?.gmailSend===true;
 const path=action=>'opportunities/'+encodeURIComponent(oppId)+'/mail'+(action?'/'+action:'')+'?profile='+encodeURIComponent(person);
 const googlePath=action=>'google/'+action+'?profile='+encodeURIComponent(person)+'&mailbox='+selection.mailbox;
 const message=value=>reasons[value]||value;
 function resetReview(){setReview(null);setChecked(false);setQueued(null);setResult(null);}
 function change(key,value){operation.current++;setForm({scope,epoch,value:{...selection,[key]:value}});resetReview();setError('');}
 async function load(){
  if(lock.current)return;lock.current=true;const request=++operation.current;setBusy('load');setError('');resetReview();
  try{
   const accountError=e=>({connected:false,error:message(e.message)});
   const [source,presets,cvs,primary,secondary]=await Promise.all([api(path('')),api('presets?profile='+encodeURIComponent(person)),api('cv/versions?profile='+encodeURIComponent(person)),api('google/status?profile='+encodeURIComponent(person)+'&mailbox=primary').catch(accountError),person==='amir'?api('google/status?profile=amir&mailbox=secondary').catch(accountError):Promise.resolve(null)]);
   if(!valid()||request!==operation.current)return;
   const templates=rows(presets),versions=rows(cvs);setStored({scope,epoch,data:{source,presets:templates,cvs:versions,accounts:{primary,secondary}}});
   setForm({scope,epoch,value:{presetId:templates.find(x=>x.isDefault||x.is_default)?.id||'',cvVersionId:versions.find(x=>x.isDefault||x.is_default)?.id||'',mailbox:'primary',recipient:source.publishedRecipients?.length===1?source.publishedRecipients[0]:''}});
  }catch(e){if(valid()&&request===operation.current)setError(message(e.message));}
  finally{if(valid()){lock.current=false;setBusy('');}}
 }
 useEffect(()=>{alive.current=true;lock.current=false;setStored(null);setForm(null);setError('');load();return()=>{alive.current=false;operation.current++;};},[scope]);
 async function checkedAccount(expected, mailbox){
  // Email identity is displayed by status; the server review hash and queue also pin Google subject.
  const current=await api('google/status?profile='+encodeURIComponent(person)+'&mailbox='+encodeURIComponent(mailbox));
  if(!current.connected||current.capabilities?.gmailSend!==true||email(current.email)!==email(expected))throw Error('sender_connection_changed');
  return current;
 }
 async function action(kind){
  if(lock.current||!data||!selection.presetId||!selection.cvVersionId||!selection.recipient||!canSend)return;
  if(['queue','send'].includes(kind)&&(!preview||!checked||queue))return;
  if(kind==='dispatch'&&(!queue||queue.item.status!=='queued'||queue.consumed||queue.item.reused!==false))return;
  const fixed={...selection},fixedPreview=preview?.data,fixedQueue=queue;
  const expected=kind==='dispatch'?fixedQueue.sender:kind==='preview'?account.email:fixedPreview.sender;
  const dispatchPath='google/mail/dispatch?profile='+encodeURIComponent(person)+'&mailbox='+encodeURIComponent(fixed.mailbox);
  lock.current=true;const request=++operation.current,selectedKey=payloadKey;let dispatchStarted=false;setBusy(kind);setError('');
  const fresh=()=>valid()&&operation.current===request&&latest.current===selectedKey;
  async function dispatch(record){
   await checkedAccount(expected,fixed.mailbox);if(!fresh())return;
   // Consume this approval before transport; ambiguous results never expose a retry.
   setQueued({...record,consumed:true});setResult({scope,epoch,item:{status:'sending'}});dispatchStarted=true;
   const response=await api(dispatchPath,{method:'POST',body:JSON.stringify({ids:[record.item.id]})});
   if(!fresh())return;
   const matching=Array.isArray(response.items)?response.items.filter(value=>value.id===record.item.id):[];
   const item=matching.length===1?matching[0]:{status:'delivery_unknown'};
   setResult({scope,epoch,item});notify(statuses[item.status]||'نتیجهٔ ارسال را در مرکز مکاتبات بررسی کنید.');
  }
  try{
   await checkedAccount(expected,fixed.mailbox);if(!fresh())return;
   if(kind==='dispatch'){await dispatch(fixedQueue);return;}
   const isQueue=kind==='queue'||kind==='send';
   const response=await api(path(isQueue?'queue':'preview'),{method:'POST',body:JSON.stringify({...fixed,...(isQueue?{confirmReviewed:true,reviewHash:fixedPreview.reviewHash}:{})})});
   if(!fresh())return;
   if(kind==='preview'){
    if(email(response.sender)!==email(expected)||response.recipients?.length!==1||email(response.recipients[0].recipient)!==email(fixed.recipient)||(response.mailbox&&response.mailbox!==fixed.mailbox)||(response.opportunityId&&response.opportunityId!==oppId)||!response.reviewHash)throw Error('application_changed_review_required');
    setReview({scope,epoch,payloadKey:selectedKey,data:response});setChecked(false);setQueued(null);setResult(null);
   }else{
    const all=Array.isArray(response.items)?response.items:[];
    const matching=all.filter(item=>email(item.recipient)===email(fixed.recipient)&&email(item.sender)===email(expected)&&item.cvVersionId===fixed.cvVersionId&&item.subject===fixedPreview.message?.subject&&item.attachmentName===fixedPreview.recipients[0]?.attachmentName);
    if(all.length!==1||matching.length!==1||response.excluded?.length||(response.mailbox&&response.mailbox!==fixed.mailbox)||(response.opportunityId&&response.opportunityId!==oppId))throw Error(response.excluded?.[0]?.reason||'application_changed_review_required');
    const item=matching[0],newQueue=item.reused===false&&item.status==='queued'&&typeof item.id==='string'&&item.id.length>0;
    const record={scope,epoch,payloadKey:selectedKey,item,sender:expected,consumed:!newQueue};
    setQueued(record);setChecked(false);
    if(!newQueue){notify('این پیام تازه و قابل ارسال تشخیص داده نشد؛ وضعیت را در مرکز مکاتبات بررسی کنید.');return;}
    if(kind==='send'){await dispatch(record);return;}
    notify('پیام و رزومه در صف قرار گرفت؛ هنوز ارسال نشده است.');
   }
  }catch(e){if(fresh()){setError(message(e.message));if(dispatchStarted)setResult({scope,epoch,item:{status:'delivery_unknown'}});else resetReview();}}
  finally{if(valid()){lock.current=false;setBusy('');}}
 }
 async function downloadCV(){if(!selection.cvVersionId||lock.current)return;lock.current=true;setBusy('cv');const request=++operation.current;try{const response=await apiResponse('cv/export?profile='+encodeURIComponent(person)+'&id='+encodeURIComponent(selection.cvVersionId)+'&format=docx'),blob=await response.blob();if(!valid()||request!==operation.current)return;const href=URL.createObjectURL(blob),link=document.createElement('a');link.href=href;link.download=person+'-application-cv.docx';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}catch(e){if(valid())setError(message(e.message));}finally{if(valid()){lock.current=false;setBusy('');}}}
 return <section className="opportunity-mail panel" aria-label="مکاتبه دربارهٔ همین فرصت" dir="rtl">
  <div className="section-head"><h3><Mail size={19}/> درخواست برای همین فرصت</h3><button type="button" className="icon" onClick={onClose} aria-label="بستن مکاتبه"><X size={18}/></button></div>
  <p><MixedText>{data?.source?.title||opportunity?.title||'فرصت انتخاب‌شده'}</MixedText></p>
  <div className="opportunity-mail-actions">{sourceURL&&<a href={sourceURL} target="_blank" rel="noreferrer">اصل آگهی و روش درخواست <ExternalLink size={14}/></a>}<button type="button" className="text-button" onClick={onOpenSettings}>قالب، رزومه یا اتصال حساب</button><button type="button" className="text-button" disabled={!!busy} onClick={load}><RefreshCw size={14}/> بررسی دوباره</button></div>
  {error&&<p className="notice" role="alert"><MixedText>{error}</MixedText></p>}
  {!data?<p className="muted">{busy?'دریافت اطلاعات اختصاصی همین پروفایل…':'اطلاعات آماده نشد؛ منبع و تنظیمات را بررسی کنید.'}</p>:<>
   {data.source.trust!=='official'&&<p className="notice">این منبع رسمی تأیید نشده است؛ هویت مرکز و محتوای درخواست را مستقل بررسی کنید.</p>}
   {!data.source.publishedRecipients?.length?<p className="notice">{reasons.published_recipient_missing}</p>:<>
    <div className="opportunity-mail-fields two-col">
     <label>قالب ایمیل<select value={selection.presetId} disabled={!!busy||!!queue} onChange={e=>change('presetId',e.target.value)}><option value="">قالب را انتخاب کنید</option>{data.presets.map(x=><option key={x.id} value={x.id}>{x.name||x.subject||'قالب'}{x.isDefault?' · پیش‌فرض':''}</option>)}</select></label>
     <label>نسخهٔ رزومهٔ پیوست<select value={selection.cvVersionId} disabled={!!busy||!!queue} onChange={e=>change('cvVersionId',e.target.value)}><option value="">رزومه را انتخاب کنید</option>{data.cvs.map(x=><option key={x.id} value={x.id}>{x.name||'رزومه'}{x.isDefault?' · پیش‌فرض':''}</option>)}</select></label>
     <label>صندوق فرستنده<select value={selection.mailbox} disabled={!!busy||!!queue} onChange={e=>change('mailbox',e.target.value)}><option value="primary">Google اصلی {person==='arash'?'آرش':'امیر'}</option>{person==='amir'&&<option value="secondary">ایمیل دوم امیر</option>}</select></label>
     <label>گیرندهٔ عمومی مرتبط با این فرصت<select dir="ltr" value={selection.recipient} disabled={!!busy||!!queue} onChange={e=>change('recipient',e.target.value)}><option value="">انتخاب گیرنده</option>{data.source.publishedRecipients.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
    </div>
    {data.source.recipientDetails?.find(contact=>contact.value===selection.recipient)&&(()=>{const contact=data.source.recipientDetails.find(contact=>contact.value===selection.recipient);return <div className="notice"><p>{contact.sourceRelation==='linked_page'?'این ایمیل در صفحهٔ مرتبط مجموعه منتشر شده و گیرندهٔ خاص همین آگهی تأیید نشده است.':'این ایمیل از محتوای عمومی همین صفحه استخراج شده است.'} {contact.contactRole==='application'?'نقش ذکرشده: درخواست همکاری.':contact.contactRole==='organization_general'?'نقش ذکرشده: تماس عمومی مجموعه.':'نقش گیرنده روشن نیست.'}</p><blockquote dir="auto"><MixedText>{contact.quote}</MixedText></blockquote>{safeURL(contact.sourceURL)&&<a href={safeURL(contact.sourceURL)} target="_blank" rel="noreferrer">منبع ایمیل انتخابی</a>}</div>;})()}
    <p className="muted">فرستنده: <bdi dir="ltr">{account?.email||'متصل نیست'}</bdi> · {canSend?'مجوز Gmail برقرار است':'اتصال و مجوز ارسال همین صندوق لازم است'}</p>
    {account?.error&&<p className="notice"><MixedText>{account.error}</MixedText></p>}
    {(!data.presets.length||!data.cvs.length)&&<p className="notice">برای درخواست، یک قالب ایمیل و یک نسخهٔ ذخیره‌شدهٔ رزومهٔ همین پروفایل لازم است؛ آن‌ها را از تنظیمات و مرکز مکاتبات آماده کنید.</p>}
    <p className="muted">انتشار ایمیل در آگهی، هویت گیرنده یا مناسب‌بودن درخواست را تضمین نمی‌کند. عنوان، متن و رزومه را پیش از ارسال بررسی کنید.</p>
    <div className="opportunity-mail-actions"><button type="button" className="secondary" disabled={!!busy||!selection.cvVersionId} onClick={downloadCV}><FileText size={15}/> دریافت همین رزومه برای بازبینی</button><button type="button" className="secondary" disabled={!!busy||!!queue||!canSend||!selection.presetId||!selection.cvVersionId||!selection.recipient} onClick={()=>action('preview')}><Eye size={15}/> {busy==='preview'?'در حال بررسی…':'نمایش ایمیل و پیوست پیش از ارسال'}</button></div>
    {preview&&<div className="opportunity-mail-review send-preview"><h4>متن و پیوست ثابت این درخواست</h4><p>از <bdi dir="ltr">{preview.data.sender}</bdi> به <bdi dir="ltr">{selection.recipient}</bdi></p><p>پیوست: <MixedText>{preview.data.recipients[0]?.attachmentName||'نسخهٔ رزومهٔ انتخاب‌شده'}</MixedText></p><p className="muted">سقف روزانه: {preview.data.dailyLimit} · جایگاه استفاده‌شده: {preview.data.reservedToday||0} · مبنا UTC</p><h4 dir="auto"><MixedText>{preview.data.message?.subject}</MixedText></h4><pre dir="auto" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{preview.data.message?.body}</pre>
     {!queue&&<><label className="checkline"><input type="checkbox" checked={checked} disabled={!!busy} onChange={e=>setChecked(e.target.checked)}/> آگهی، گیرنده، متن و همین فایل رزومه را بازبینی کردم.</label><button type="button" className="primary" disabled={!!busy||!checked} onClick={()=>action('send')}><Send size={16}/> {busy==='send'?'در حال آماده‌سازی و ارسال…':'ارسال همین ایمیل و رزومه'}</button><button type="button" className="text-button" disabled={!!busy||!checked} onClick={()=>action('queue')}>فقط ذخیره در صف؛ بدون ارسال</button></>}
    </div>}
    {queue&&<div className="notice opportunity-mail-queued"><strong>{statuses[last?.status||queue.item.status]||queue.item.status}</strong>{queue.consumed&&!last?<p>این رکورد قبلی یا غیرقابل ارسال است؛ برای جلوگیری از ارسال تکراری، وضعیت را در مرکز مکاتبات بررسی کنید.</p>:!last&&!queue.consumed&&queue.item.status==='queued'?<><p>با دکمهٔ زیر ایمیل واقعی همراه همین رزومه از <bdi dir="ltr">{queue.sender}</bdi> به <bdi dir="ltr">{queue.item.recipient}</bdi> ارسال می‌شود.</p><button type="button" className="primary" disabled={!!busy} onClick={()=>action('dispatch')}><Send size={16}/> {busy==='dispatch'?'در حال ارسال…':'ارسال همین ایمیل و رزومه'}</button></>:null}{last&&<p>تلاش مجدد خودکار انجام نمی‌شود؛ نتیجهٔ نامشخص را در پوشهٔ Sent همین حساب بررسی کنید.</p>}</div>}
   </>}
  </>}
 </section>;
}
