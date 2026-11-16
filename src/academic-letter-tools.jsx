import React,{useEffect,useRef,useState} from 'react';
import {Sparkles} from 'lucide-react';
import {api} from './api';
import {MixedText} from './mixed-text';
export function AcademicLetterTools({opportunityId,selection,ready,disabled,onReady}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef(true),lock=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const hasConnection=Boolean(selection.connectionId),canRefine=ready&&!disabled&&!busy&&!hasConnection;
 const errors={academic_daily_limit:'سهمیهٔ امروزِ ویرایش هوشمند تمام شده است؛ متن مستند فعلی همچنان قابل استفاده است.',academic_draft_failed_checks:'متن پیشنهادی از بررسی‌های اولیه عبور نکرد؛ متن قبلی حفظ شد.',academic_ai_unavailable:'ویرایش هوشمند اکنون در دسترس نیست؛ متن قبلی حفظ شد.',academic_context_changed:'اطلاعات کلینیک یا رزومه تغییر کرده است؛ نامه را دوباره آماده کنید.',academic_draft_in_progress:'ویرایش همین نامه در حال انجام است؛ کمی بعد دوباره بررسی کنید.'};
 async function refine(){
  if(!canRefine||lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   const {variant,cvVersionId,clinicQuote,cvQuote}=selection;
   const result=await api('gp-writing/'+opportunityId+'/refine?profile=arash',{method:'POST',body:JSON.stringify({variant,cvVersionId,clinicQuote,cvQuote,confirmCvQuote:true,contextConsent:true})});
   if(active.current){if(result.profileId!=='arash'||result.opportunityId!==opportunityId||!/^academic_[a-f0-9]{32}$/.test(result.refinementId||''))throw Error('academic_context_changed');onReady(result);}
  }catch(e){if(active.current)setError(errors[e.message]||'ویرایش هوشمند کامل نشد؛ متن قبلی حفظ شد.');}
  finally{if(active.current){lock.current=false;setBusy(false);}}
 }
 return <details className="gp-academic-tools"><summary><Sparkles size={15}/> ویرایش حرفه‌ای بندهای دوم و سوم</summary>
  <p className="section-help">با زدن این دکمه، فقط شواهد منتخب کلینیک و بخش مرتبط رزومهٔ خودتان برای پرداخت متن به Workers AI فرستاده می‌شوند. مدل Qwen3 پیشنهاد می‌دهد؛ شما دقت و لحن را پیش از ارسال بازبینی می‌کنید.</p>
  <p className="section-help">معرفی، جملهٔ پایانی و اطلاعات تماس ثابت می‌مانند. این ویرایش از سهمیهٔ محدود روزانهٔ دستیار استفاده می‌کند و متن تأییدشده را دوباره پردازش نمی‌کند.</p>
  {hasConnection?<p className="section-help">برای حفظ متنِ آشناییِ تأییدشده، ویرایش هوشمند این نامه فعال نیست؛ نسخهٔ مستند فعلی را بازبینی کنید.</p>:!ready&&<p className="section-help">ابتدا درستی شواهد کلینیک و سابقهٔ رزومه را تأیید کنید.</p>}
  <button type="button" className="secondary" disabled={!canRefine} onClick={refine}><Sparkles size={15}/>{busy?'در حال پرداخت متن…':'پرداخت حرفه‌ای متن'}</button>
  {error&&<p className="notice" role="alert"><MixedText>{error}</MixedText></p>}
 </details>;
}
