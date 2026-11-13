import React,{useEffect,useRef,useState} from 'react';
import {FileText,Copy,RefreshCw,ExternalLink} from 'lucide-react';
import {api} from './api';
import {MixedText} from './mixed-text';
import {useInterfaceLanguage} from './interface-locale.mjs';
import {EN_CLINIC_ENQUIRY} from './locales/en-clinic-enquiry.mjs';
import './clinic-enquiry.css';
const missing={fresh_public_read_required:'اطلاعات تماس به بازخوانی تازه نیاز دارد.',published_email_required:'ایمیل منتشرشده و قابل استناد در دسترس نیست.',published_clinic_name_required:'نام منتشرشدهٔ مرکز هنوز روشن نیست.',clinic_services_quote_required:'دربارهٔ خدمات یا ویژگی‌های مرکز شاهد کافی نداریم؛ متن تماس را به توصیف خدمات تبدیل نمی‌کنیم.',writing_profile_confirmation_required:'پاراگراف ثابت آغاز و پایان باید در پروندهٔ خصوصی خودتان تأیید شده باشد.',owned_cv_evidence_required:'نسخهٔ رزومهٔ خودتان و شاهد مرتبط از آن لازم است.'};
const safe=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}};
export function ClinicEnquiry({person='arash',itemId,notify=()=>{}}){
 const language=useInterfaceLanguage(),t=value=>language==='en'?(EN_CLINIC_ENQUIRY[value]||value):value,key=person+':'+itemId,scope=useRef(key),generation=useRef(0),active=useRef(true);scope.current=key;
 const [snapshot,setSnapshot]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false),[copyState,setCopyState]=useState('');
 useEffect(()=>{active.current=true;generation.current++;setSnapshot(null);setBusy(false);setError('');setNote('');setConfirmed(false);setCopyState('');return()=>{active.current=false;generation.current++;};},[key]);
 const data=snapshot?.key===key?snapshot.value:null;
 async function load(){if(person!=='arash'||busy)return;const expected=key,epoch=++generation.current;setBusy(true);setError('');setConfirmed(false);setCopyState('');try{const value=await api('clinic-bank/enquiry?'+new URLSearchParams({profile:person,id:itemId}));if(active.current&&scope.current===expected&&generation.current===epoch){setSnapshot({key:expected,value});setNote('');}}catch{if(active.current&&scope.current===expected&&generation.current===epoch)setError('دریافت پیش‌نویس موقتاً انجام نشد؛ دوباره تلاش کنید.');}finally{if(active.current&&scope.current===expected&&generation.current===epoch)setBusy(false);}}
 const parts=data?.draft?.paragraphs||{},clinic=note.trim().replace(/\s+/g,' ')||parts.clinic;
 const canPrepare=data?.source?.status==='current_public_observation'&&data?.recipients?.length>0&&data?.clinic?.name&&parts.opening&&clinic&&parts.value&&parts.closing;
 const body=canPrepare?(note.trim()?'Dear Practice Manager,\n\n'+[parts.opening,clinic,parts.value,parts.closing].join('\n\n')+'\n\nKind regards,\n'+data.draft.doctorName:data.draft.body):null;
 async function copy(){if(!body||!confirmed||busy||scope.current!==key)return;const expected=key;try{await navigator.clipboard.writeText(body);if(active.current&&scope.current===expected){setCopyState('متن کپی شد؛ هیچ پیامی ارسال نشد.');notify(t('متن کپی شد؛ هیچ پیامی ارسال نشد.'));}}catch{if(active.current&&scope.current===expected)setCopyState('کپی خودکار ممکن نشد؛ متن را از پیش‌نمایش انتخاب و کپی کنید.');}}
 return <details className="clinic-enquiry" data-no-translate="true"><summary><FileText size={14}/>{t('پیش‌نویس معرفی به این مرکز')}</summary><div className="clinic-enquiry-body">
  {person!=='arash'?<p>{t('پیش‌نویس فقط برای حساب آرش در دسترس است.')}</p>:<>
   <p className="section-help">{t('این مرکز سرنخ است، نه آگهی استخدام. این ابزار فقط متن قابل بازبینی می‌سازد؛ پیام یا زمان‌بندی ایجاد نمی‌کند.')}</p>
   <button className="secondary" type="button" disabled={busy} onClick={load}><RefreshCw size={14} className={busy?'spin':''}/>{t(busy?'در حال آماده‌سازی…':'آماده‌سازی پیش‌نویس')}</button>
   {error&&<p role="status" className="notice">{t(error)}</p>}
   {data&&<>
    {data.missingEvidence?.length>0&&<ul className="section-help">{data.missingEvidence.map(code=><li key={code}>{t(missing[code]||'دریافت پیش‌نویس موقتاً انجام نشد؛ دوباره تلاش کنید.')}</li>)}</ul>}
    {data.recipients?.length>0&&<details><summary>{t('ایمیل‌های منتشرشده؛ فقط برای بررسی')}</summary>{data.recipients.map(contact=><div className="clinic-enquiry-recipient" key={contact.value}><bdi dir="ltr">{contact.value}</bdi>{safe(contact.sourceURL)&&<a href={contact.sourceURL} target="_blank" rel="noreferrer">{t('منبع تماس')}<ExternalLink size={12}/></a>}</div>)}</details>}
    {parts.opening&&parts.value&&parts.closing&&data.source?.status==='current_public_observation'&&<label>{t('نکتهٔ اختصاصی شما دربارهٔ مرکز، اختیاری')}<textarea data-private dir="ltr" value={note} maxLength={2000} rows={3} onChange={event=>{setNote(event.target.value);setConfirmed(false);setCopyState('');}}/><small className="section-help">{t('اگر شاهد خدمات کافی نیست، یک پاراگراف انگلیسی دقیق بنویسید. این متن شخصی است و به‌عنوان شاهد سایت مرکز ذخیره نمی‌شود.')}</small></label>}
    {data.draft?.clinicQuote&&<details><summary>{t('شاهد خدمات مرکز از صفحهٔ عمومی')}</summary><blockquote data-private dir="auto">{data.draft.clinicQuote}</blockquote>{safe(data.draft.clinicQuoteSourceURL)&&<a href={data.draft.clinicQuoteSourceURL} target="_blank" rel="noreferrer">{t('منبع خدمات مرکز')}<ExternalLink size={12}/></a>}</details>}
    {data.draft?.cvQuote&&<details><summary>{t('شاهد انتخاب‌شده از رزومهٔ خودتان')}</summary><blockquote data-private dir="auto">{data.draft.cvQuote}</blockquote></details>}
    {body&&<><p><strong>{t('موضوع')}: </strong><span dir="auto"><MixedText>{data.draft.subject}</MixedText></span></p><label>{t('متن پیشنهادی؛ هنوز بازبینی نشده')}<textarea className="clinic-enquiry-preview" data-private readOnly dir="ltr" rows={12} value={body}/></label><label className="checkline"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>{t('متن و اطلاعات مرکز و رزومه را بررسی کرده‌ام؛ فقط می‌خواهم متن را کپی کنم.')}</label><button className="secondary" type="button" disabled={!confirmed||busy} onClick={copy}><Copy size={14}/>{t('کپی متن معرفی')}</button></>}
    {copyState&&<p role="status" className="section-help">{t(copyState)}</p>}
    <p className="section-help">{t('این نسخه فقط آماده‌سازی است. ارسال مستقیم و پیگیری دوره‌ای مراکز بدون آگهی هنوز به مسیر جداگانهٔ تأییدشده نیاز دارد.')}</p>
   </>}
  </>}
 </div></details>;
}
