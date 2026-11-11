import React,{useEffect,useRef,useState} from 'react';
import {Mail,RefreshCw,ChevronDown} from 'lucide-react';
import {api} from './api';
import {MixedText} from './mixed-text';
import {interfaceLocale} from './interface-locale.mjs';
import './periodic-outreach.css';

export function PeriodicOutreach({person,onOpen,onBatch,disabled=false}){
 const [cadence,setCadence]=useState('daily'),[snapshot,setSnapshot]=useState(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const epoch=useRef(0),flight=useRef(null),scope=person+':'+cadence;
 useEffect(()=>{
  let mounted=true;const seq=++epoch.current;setSnapshot(null);setFailed(false);
  async function load(){if(flight.current===seq)return;flight.current=seq;setBusy(true);
   try{const data=await api('mail-automation/suggestions?'+new URLSearchParams({profile:person,cadence}));if(mounted&&epoch.current===seq){setSnapshot({scope,data});setFailed(false);}}
   catch{if(mounted&&epoch.current===seq)setFailed(true);}finally{if(mounted&&epoch.current===seq)setBusy(false);if(flight.current===seq)flight.current=null;}}
  load();const tick=()=>{if(document.visibilityState==='visible'&&navigator.onLine!==false)load();};const timer=setInterval(tick,60000);window.addEventListener('online',tick);
  return()=>{mounted=false;clearInterval(timer);window.removeEventListener('online',tick);};
 },[person,cadence]);
 const data=snapshot?.scope===scope?snapshot.data:null,items=Array.isArray(data?.suggestions)?data.suggestions:[];
 return <details className="periodic-outreach arash-fold neon-green" open>
  <summary><span><strong>پیشنهادهای دوره‌ای مکاتبه</strong><small>آگهی‌های تازه و مرتبط؛ متن هر درخواست پیش از ارسال بررسی می‌شود.</small></span><ChevronDown size={17}/></summary>
  <div className="periodic-outreach-body">
   <div className="periodic-outreach-controls"><label>بازهٔ پیشنهاد<select disabled={disabled} value={cadence} onChange={e=>setCadence(e.target.value)}><option value="daily">۲۴ ساعت گذشته</option><option value="weekly">۷ روز گذشته</option></select></label>{busy&&<span className="muted" role="status"><RefreshCw size={14}/>در حال بررسی…</span>}{items.length>0&&<button type="button" className="secondary" disabled={disabled} onClick={()=>onBatch(items)}><Mail size={15}/>آماده‌سازی این دسته</button>}</div>
   {failed&&<p className="notice" role="status">دریافت پیشنهاد تازه انجام نشد؛ تلاش بعدی خودکار است.</p>}
   {!busy&&data&&!items.length&&<p className="section-help">فعلاً آگهی تازه‌ای با اطلاعات تماس مناسب برای پیشنهاد مکاتبه پیدا نشد. جست‌وجوی منابع ادامه دارد؛ نتایج دیگر در فهرست پایین در دسترس‌اند.</p>}
   <div className="periodic-outreach-items">{items.map(item=><article key={item.id}><div><strong dir="auto"><MixedText>{typeof item.organization==='string'?item.organization:item.organization?.name||item.title}</MixedText></strong><small dir="auto"><MixedText>{item.title}</MixedText></small><span className="muted"><bdi>{item.state||'AU'}</bdi> · {item.firstParty?'منبع دست‌اول':'منبع رسمی'} · {Number(item.publishedRecipientCount||0).toLocaleString(interfaceLocale('fa-IR'))} ایمیل منتشرشده</span></div><button type="button" className="primary" disabled={disabled} onClick={()=>onOpen(item)}><Mail size={15}/>بررسی و ارسال</button></article>)}</div>
   <p className="section-help">پیشنهادها از جست‌وجوی زمان‌بندی‌شده ساخته می‌شوند؛ نشانی‌های تکراری، منع مکاتبه و درخواست‌های قبلی کنار گذاشته می‌شوند. آماده‌سازی دسته به‌تنهایی ایمیلی نمی‌فرستد.</p>
  </div>
 </details>;
}
