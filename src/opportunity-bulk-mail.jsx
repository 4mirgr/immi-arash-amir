import {interfaceLocale} from './interface-locale.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {Mail,Send,RefreshCw,FileText,X} from 'lucide-react';
import {api,apiResponse} from './api';
import {MixedText} from './mixed-text';
import {googleAccountLabel} from './google-account-labels.mjs';
import {prepareRecipientBatch,sendRecipientBatch} from './opportunity-recipient-batch.mjs';
import './opportunity-bulk-mail.css';

const rows=v=>Array.isArray(v)?v:v?.items||v?.versions||v?.presets||[];
const name=item=>typeof item.organization==='string'?item.organization:item.organization?.name||item.organizationName||item.title||'مرکز انتخاب‌شده';
const emails=values=>[...new Set((Array.isArray(values)?values:[]).filter(v=>typeof v==='string'&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)).map(v=>v.toLowerCase()))];
const messages={batch_limit_reached:'سقف هر نوبت ۲۰ پیام است؛ موارد اضافی ارسال نمی‌شوند.',duplicate_recipient:'این نشانی در آگهی دیگری هم انتخاب شده؛ فقط یک پیام برای آن آماده می‌شود.',recipient_suppressed:'این نشانی در فهرست عدم ارسال حساب شماست.',daily_quota_reached:'سقف امروز تکمیل شده است.',published_recipient_missing:'ایمیلی برای درخواست در منبع منتشر نشده است.',source_observation_stale:'دریافت منبع قدیمی است؛ منبع باید دوباره بررسی شود.',source_closed_or_future:'آگهی اکنون قابل اقدام نیست.',opportunity_closed_or_future:'آگهی اکنون قابل اقدام نیست.',application_changed_review_required:'اطلاعات نامه تغییر کرده؛ متن تازه را دوباره بررسی کنید.',sender_connection_changed:'اتصال فرستنده تغییر کرده؛ بازبینی تازه لازم است.',batch_consumed:'این نوبت قبلاً استفاده شده است؛ نتیجه‌ها را بررسی کنید.',queue_unknown:'نتیجهٔ ثبت صف روشن نیست؛ از تکرار ارسال خودداری کنید.',delivery_unknown:'نتیجهٔ ارسال روشن نیست؛ پوشهٔ Sent همین حساب را بررسی کنید.'};
const reason=value=>messages[value]||value||'این مورد آماده نشد؛ از پروندهٔ همان آگهی بررسی کنید.';
const statuses={sent:'ارسال تأیید شد',queued:'در صف؛ ارسال نشده',not_attempted:'هنوز اقدام نشده؛ ادامهٔ این نوبت متوقف شد',sending:'در حال بررسی نتیجه؛ دوباره ارسال نکنید',reused:'پیام قبلی؛ دوباره ارسال نشد',failed:'ارسال نشد',delivery_unknown:'نتیجهٔ ارسال نامشخص',queue_unknown:'وضعیت صف نامشخص',cancelled:'ادامه متوقف شد',blocked:'متوقف شد'};

export function OpportunityBulkMail({person,opportunities,onClose,onOpenSettings,onBusyChange,notify=()=>{}}){
 const scope=person+':'+opportunities.map(item=>item.id).join(','),identity=useRef(scope),mounted=useRef(true),operation=useRef(0),lock=useRef(false);
 if(identity.current!==scope){identity.current=scope;operation.current++;}
 const active=seq=>mounted.current&&identity.current===scope&&operation.current===seq;
 const [data,setData]=useState(null),[cvId,setCvId]=useState(''),[presetId,setPresetId]=useState(''),[variant,setVariant]=useState('auto'),[mailbox,setMailbox]=useState('primary');
 const [drafts,setDrafts]=useState([]),[prepared,setPrepared]=useState(null),[reviewed,setReviewed]=useState(false),[results,setResults]=useState([]),[busy,setBusy]=useState(''),[error,setError]=useState(''),[consumed,setConsumed]=useState(false);
 const account=data?.accounts?.[mailbox],canSend=account?.connected&&account.capabilities?.gmailSend===true;
 useEffect(()=>{onBusyChange?.(Boolean(busy));return()=>onBusyChange?.(false);},[busy,onBusyChange]);
 useEffect(()=>{mounted.current=true;loadSetup();return()=>{mounted.current=false;operation.current++;lock.current=false;};},[scope]);
 function clearReview(){setPrepared(null);setReviewed(false);setResults([]);setConsumed(false);}
 function change(setter,value){operation.current++;setter(value);setDrafts([]);clearReview();setError('');}
 async function loadSetup(){
  if(lock.current)return;lock.current=true;const seq=++operation.current;setBusy('setup');setError('');
  try{
   const [cvs,presets,primary,secondary]=await Promise.all([api('cv/versions?profile='+person),api('presets?profile='+person),api('google/status?profile='+person+'&mailbox=primary').catch(()=>({connected:false})),api('google/status?profile='+person+'&mailbox=secondary').catch(()=>({connected:false}))]);
   if(!active(seq))return;const versions=rows(cvs),templates=rows(presets);setData({cvs:versions,presets:templates,accounts:{primary,secondary}});setCvId(versions.find(item=>item.isDefault||item.is_default)?.id||versions[0]?.id||'');setPresetId(templates.find(item=>item.isDefault||item.is_default)?.id||'');
  }catch(e){if(active(seq))setError(reason(e.message));}finally{if(active(seq)){setBusy('');lock.current=false;}}
 }
 async function downloadCV(){
  if(lock.current||!cvId)return;lock.current=true;const seq=++operation.current;setBusy('cv');setError('');
  try{const response=await apiResponse('cv/export?'+new URLSearchParams({profile:person,id:cvId,format:'docx'})),blob=await response.blob();if(!active(seq))return;const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=person+'-application-cv.docx';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){if(active(seq))setError(reason(e.message));}finally{if(active(seq)){lock.current=false;setBusy('');}}
 }
 async function prepareDrafts(){
  if(lock.current||!cvId||!canSend||(person!=='arash'&&!presetId))return;
  lock.current=true;const seq=++operation.current;setBusy('drafts');setError('');clearReview();const next=[];
  try{
   for(const opportunity of opportunities){
    if(!active(seq))return;
    try{
     const source=await api('opportunities/'+opportunity.id+'/mail?profile='+person);if(!active(seq))return;
     if(source.opportunityId!==opportunity.id)throw Error('شناسهٔ آگهی دریافت‌شده همخوان نیست.');
     const recipients=emails(source.publishedRecipients);
     if(!recipients.length)throw Error('published_recipient_missing');
     if(source.scheduling?.approvals?.some(item=>['approved','sending'].includes(item.status)))throw Error('این آگهی زمان‌بندی فعال دارد؛ ابتدا وضعیت آن را در پروندهٔ آگهی بررسی کنید.');
     let pack=null;
     if(person==='arash'){
      pack=await api('gp-applications/'+opportunity.id+'/package?'+new URLSearchParams({profile:person,variant,cvVersionId:cvId}));if(!active(seq))return;
      if(pack.profileId!=='arash'||pack.opportunityId!==opportunity.id||pack.cvVersionId!==cvId||!pack.previewBody||!pack.suggestedSelection?.clinicQuote||!pack.suggestedSelection?.cvQuote||!['A','B','C'].includes(pack.variant))throw Error('نامهٔ منبع‌دار این مرکز کامل نیست؛ پروندهٔ آگهی را باز کنید.');
      if(!data.presets.some(item=>item.name===pack.templateName))throw Error('قالب A/B/C این حساب موجود نیست؛ از تنظیمات حساب آن را اضافه کنید.');
     }
     next.push({opportunity,source,pack,recipients,reviewed:false,error:''});
    }catch(e){next.push({opportunity,recipients:[],reviewed:false,error:reason(e.message)});}
    if(active(seq))setDrafts([...next]);
   }
  }finally{if(active(seq)){setBusy('');lock.current=false;}}
 }
 function chooseRecipients(id,recipients){if(lock.current||consumed)return;setDrafts(current=>current.map(item=>item.opportunity.id===id?{...item,recipients:emails(recipients),reviewed:false}:item));clearReview();}
 function approveDraft(id,value){setDrafts(current=>current.map(item=>item.opportunity.id===id?{...item,reviewed:value}:item));clearReview();}
 async function finalPreview(){
  const ready=drafts.filter(item=>!item.error&&item.recipients.length);
  if(lock.current||!ready.length||ready.some(item=>!item.reviewed)||!canSend)return;
  lock.current=true;const seq=++operation.current;setBusy('preview');setError('');setPrepared(null);setReviewed(false);setResults([]);setConsumed(false);
  try{
   const plans=[];
   for(const draft of ready){
    if(!active(seq))return;let application,selectedPreset=presetId;
    if(person==='arash'){
     const pack=draft.pack;application={variant:pack.variant,subjectIndex:0,clinicQuote:pack.suggestedSelection.clinicQuote,cvQuote:pack.suggestedSelection.cvQuote,confirmCvQuote:true};
     const canonical=await api('gp-applications/'+draft.opportunity.id+'/package?profile='+person,{method:'POST',body:JSON.stringify({...application,cvVersionId:cvId})});if(!active(seq))return;
     if(!canonical.readyForReview||canonical.profileId!==person||canonical.opportunityId!==draft.opportunity.id||canonical.cvVersionId!==cvId||canonical.body!==pack.previewBody||canonical.subjects?.[0]!==pack.subjects?.[0]||canonical.templateName!==pack.templateName)throw Error('application_changed_review_required');
     selectedPreset=data.presets.find(item=>item.name===canonical.templateName)?.id;
    }
    plans.push({opportunityId:draft.opportunity.id,presetId:selectedPreset,cvVersionId:cvId,mailbox,recipients:draft.recipients,...(application?{application}:{})});
   }
   const result=await prepareRecipientBatch({api,person,plans,isActive:()=>active(seq)});if(active(seq))setPrepared(result);
  }catch(e){if(active(seq))setError(reason(e.message));}finally{if(active(seq)){setBusy('');lock.current=false;}}
 }
 async function send(){
  if(lock.current||!prepared?.entries?.length||!reviewed||consumed)return;
  lock.current=true;const seq=++operation.current;setBusy('send');setError('');setConsumed(true);setReviewed(false);setResults([]);
  try{
   const result=await sendRecipientBatch({api,person,prepared,isActive:()=>active(seq),confirmReviewed:true,onProgress:(item,all)=>{if(active(seq))setResults([...all]);}});
   if(active(seq)){setResults(result.results||result.items||[]);notify('نتیجهٔ هر نشانی در همین بخش نمایش داده شد.');}
  }catch(e){if(active(seq))setError(reason(e.message));}finally{if(active(seq)){setBusy('');lock.current=false;}}
 }
 const readyDrafts=drafts.filter(item=>!item.error&&item.recipients.length),count=readyDrafts.reduce((sum,item)=>sum+item.recipients.length,0);
 return <section className="opportunity-bulk-mail panel" aria-label="ارسال دسته‌ای برای آگهی‌های منتخب" dir="rtl">
  <div className="section-head"><div><h3><Mail size={18}/> ارسال برای آگهی‌های منتخب</h3><p className="section-help">برای هر مرکز نامهٔ خودش و برای هر نشانی یک ایمیل جدا آماده می‌شود؛ گیرنده‌ها آدرس یکدیگر را نمی‌بینند.</p></div><button type="button" className="icon" aria-label="بستن ارسال دسته‌ای" disabled={!!busy} onClick={onClose}><X size={17}/></button></div>
  <p className="section-help">{opportunities.length.toLocaleString(interfaceLocale('fa-IR'))} آگهی · سقف هر نوبت ۲۰ پیام و سقف واقعی همان حساب است. انتخاب پیش‌فرض همهٔ ایمیل‌های منتشرشدهٔ هر آگهی است؛ ارسال فقط پس از بازبینی و تأیید شما انجام می‌شود.</p>
  {error&&<p className="notice" role="alert"><MixedText>{error}</MixedText></p>}
  {!data?<button className="secondary" disabled={!!busy} type="button" onClick={loadSetup}><RefreshCw size={15}/>{busy?'در حال دریافت…':'دریافت دوبارهٔ تنظیمات'}</button>:<>
   <div className="bulk-mail-settings">
    <label>رزومهٔ پیوست<select aria-label="رزومهٔ ارسال دسته‌ای" value={cvId} disabled={!!busy||consumed} onChange={e=>change(setCvId,e.target.value)}><option value="">رزومه را انتخاب کنید</option>{data.cvs.map(item=><option key={item.id} value={item.id}>{item.name||'رزومه'}{item.isDefault?' · پیش‌فرض':''}</option>)}</select></label>
    <label>فرستنده<select aria-label="فرستندهٔ ارسال دسته‌ای" value={mailbox} disabled={!!busy||consumed} onChange={e=>change(setMailbox,e.target.value)}><option value="primary">{googleAccountLabel(person,'primary',data.accounts.primary?.email)}</option><option value="secondary">{googleAccountLabel(person,'secondary',data.accounts.secondary?.email)}</option></select></label>
    {person==='arash'?<label>سبک نامه<select aria-label="سبک نامهٔ دسته‌ای" value={variant} disabled={!!busy||consumed} onChange={e=>change(setVariant,e.target.value)}><option value="auto">متناسب با هر مرکز</option><option value="A">A · شبکهٔ درمانی</option><option value="B">B · کلینیک مستقل</option><option value="C">C · منطقهٔ روستایی</option></select></label>:<label>قالب ایمیل<select aria-label="قالب ارسال دسته‌ای" value={presetId} disabled={!!busy||consumed} onChange={e=>change(setPresetId,e.target.value)}><option value="">قالب را انتخاب کنید</option>{data.presets.map(item=><option key={item.id} value={item.id}>{item.name||item.subject||'قالب'}</option>)}</select></label>}
   </div>
   {cvId&&<button type="button" className="text-button" disabled={!!busy} onClick={downloadCV}><FileText size={14}/>دریافت همین رزومه برای بازبینی</button>}
   {!canSend&&<p className="notice">اتصال و مجوز ارسال Gmail همین صندوق لازم است. <button type="button" className="text-button" onClick={onOpenSettings}>تنظیمات حساب</button></p>}
   <button className="secondary" type="button" disabled={!!busy||!cvId||!canSend||consumed||(person!=='arash'&&!presetId)} onClick={prepareDrafts}><FileText size={15}/>{busy==='drafts'?'در حال آماده‌سازی مرکزها…':'آماده‌کردن نامه‌ها و گیرنده‌ها'}</button>
   {drafts.length>0&&<div className="bulk-mail-drafts">{drafts.map(draft=><details key={draft.opportunity.id} className="bulk-mail-draft"><summary><MixedText>{name(draft.opportunity)}</MixedText><span>{draft.error?'نیازمند بررسی':draft.recipients.length.toLocaleString(interfaceLocale('fa-IR'))+' گیرنده'}</span></summary>
    {draft.error?<p className="notice"><MixedText>{draft.error}</MixedText></p>:<>
     <fieldset disabled={!!busy||consumed} className="bulk-mail-recipients"><legend>گیرنده‌های همین آگهی</legend><div><button type="button" className="text-button" onClick={()=>chooseRecipients(draft.opportunity.id,draft.source.publishedRecipients)}>انتخاب همه</button><button type="button" className="text-button" onClick={()=>chooseRecipients(draft.opportunity.id,[])}>برداشتن همه</button></div>{emails(draft.source.publishedRecipients).map(address=><label className="checkline" key={address}><input type="checkbox" checked={draft.recipients.includes(address)} onChange={e=>chooseRecipients(draft.opportunity.id,e.target.checked?[...draft.recipients,address]:draft.recipients.filter(value=>value!==address))}/><bdi dir="ltr">{address}</bdi></label>)}</fieldset>
     {draft.pack?.writingStatus?.issues?.length>0&&<div className="notice"><strong>پیش از ارسال، {draft.pack.writingStatus.issues.length.toLocaleString(interfaceLocale('fa-IR'))} نکتهٔ رزومه و نامه را بررسی کنید.</strong><details><summary>دیدن اختلاف‌ها و نکته‌های پرونده</summary><ul>{draft.pack.writingStatus.issues.map((issue,index)=><li key={issue.code||index}><MixedText>{issue.message||issue.code}</MixedText></li>)}</ul></details></div>}
     {draft.pack&&<><h4 dir="auto"><MixedText>{draft.pack.subjects?.[0]}</MixedText></h4><pre dir="ltr">{draft.pack.previewBody}</pre><details className="bulk-mail-evidence"><summary>جمله‌های منبع و رزومه که در نامه استفاده می‌شوند</summary><blockquote dir="auto"><MixedText>{draft.pack.suggestedSelection.clinicQuote}</MixedText></blockquote><blockquote dir="auto"><MixedText>{draft.pack.suggestedSelection.cvQuote}</MixedText></blockquote></details></>}
     <label className="checkline"><input type="checkbox" checked={draft.reviewed} disabled={!!busy||consumed||!draft.recipients.length} onChange={e=>approveDraft(draft.opportunity.id,e.target.checked)}/>{person==='arash'?'متن این مرکز، جملهٔ رزومه و گیرنده‌ها را بررسی کردم.':'گیرنده‌های این مرکز را بررسی کردم؛ متن نهایی را در مرحلهٔ بعد می‌خوانم.'}</label>
    </>}
   </details>)}</div>}
   {readyDrafts.length>0&&!consumed&&<div className="bulk-mail-actions"><span>{count.toLocaleString(interfaceLocale('fa-IR'))} گیرندهٔ انتخاب‌شده</span><button type="button" className="secondary" disabled={!!busy||readyDrafts.some(item=>!item.reviewed)} onClick={finalPreview}>{busy==='preview'?'در حال بررسی نهایی…':'پیش‌نمایش نهایی منتخب‌ها'}</button></div>}
   {prepared&&<div className="bulk-mail-final"><h4>بازبینی نهایی؛ {prepared.entries.length.toLocaleString(interfaceLocale('fa-IR'))} پیام</h4>{prepared.entries.map(entry=><details key={entry.id||entry.opportunityId+entry.recipient}><summary><bdi dir="ltr">{entry.recipient}</bdi><MixedText>{name(opportunities.find(item=>item.id===entry.opportunityId)||{})}</MixedText></summary><p className="section-help">از <bdi dir="ltr">{entry.sender}</bdi> · <MixedText>{entry.preview.recipients?.[0]?.attachmentName||'رزومهٔ انتخاب‌شده'}</MixedText></p><h4 dir="auto"><MixedText>{entry.preview.message?.subject}</MixedText></h4><pre dir="ltr">{entry.preview.message?.body}</pre></details>)}
    {(prepared.blocked?.length>0||prepared.duplicates?.length>0)&&<details><summary>مواردی که ارسال نمی‌شوند</summary>{[...(prepared.blocked||[]),...(prepared.duplicates||[])].map((item,index)=><p key={index} className="section-help"><bdi dir="ltr">{item.recipient||'—'}</bdi> · <MixedText>{reason(item.reason)}</MixedText></p>)}</details>}
    {!consumed&&prepared.entries.length>0&&<><label className="checkline"><input type="checkbox" disabled={!!busy} checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>متن، گیرنده و رزومهٔ همهٔ پیام‌های آماده را بررسی کردم؛ فقط همین {prepared.entries.length.toLocaleString(interfaceLocale('fa-IR'))} پیام ارسال شوند.</label><button type="button" className="primary" disabled={!!busy||!reviewed} onClick={send}><Send size={16}/>{busy==='send'?'در حال ارسال و دریافت نتیجه…':'ارسال پیام‌های بازبینی‌شده'}</button></>}
   </div>}
   {results.length>0&&<div className="bulk-mail-results" role="status"><h4>نتیجهٔ همین نوبت</h4>{results.map((item,index)=><p key={item.id||item.recipient+':'+index}><bdi dir="ltr">{item.recipient||'—'}</bdi><span>{statuses[item.status]||reason(item.reason)||item.status}</span></p>)}</div>}
   {consumed&&<p className="section-help">این نوبت مصرف شد؛ پیام قبلی یا نتیجهٔ نامشخص خودکار دوباره ارسال نمی‌شود. وضعیت هر نشانی را پیش از اقدام تازه بررسی کنید.</p>}
  </>}
 </section>;
}
