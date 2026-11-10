import {interfaceLocale} from './interface-locale.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {api} from './api';
import {MixedText} from './mixed-text';

const SECTIONS=new Set(['all','study','pathway','development','jobs']);
const HEADINGS={all:'محتوای خوانده‌شده و شواهد استخراج‌شده',study:'شواهد خوانده‌شدهٔ تحصیل و فاند',pathway:'شرایط و راهنمای مسیر از منابع خوانده‌شده',development:'مهارت‌ها و رویدادها از منابع خوانده‌شده',jobs:'شواهد خوانده‌شدهٔ فرصت‌های کاری'};
const CATEGORIES={call:'فراخوان',admission:'پذیرش و مدارک',funding:'فاند و حمایت مالی',career:'استخدام',development:'مهارت و رویداد',guidance:'راهنمای مسیر',navigation:'صفحهٔ راهنما و پیوندها',unrelated:'ارتباط محتوایی تأیید نشده'};
const TOPICS={medicine:'پزشکی',biomedical_life_sciences:'زیست‌پزشکی و علوم زیستی',public_health:'سلامت عمومی',gp_img_supervision:'پزشکی عمومی، IMG و سوپرویژن',pesci:'PESCI',language_evidence:'شواهد زبان'};
const STATUSES={http_rejected:'پاسخ HTTP غیرقابل تلاش خودکار',access_denied:'دسترسی به صفحه رد شد',reading_storage_failed:'ذخیرهٔ نتیجه ناموفق؛ منتظر تلاش محدود',pdf_reader_required:'PDF نیازمند پردازشگر جداگانه',empty_text:'متن قابل استخراج دریافت نشد',unsupported_content:'نوع محتوا پشتیبانی نمی‌شود',crawl_delay_exceeds_budget:'فاصلهٔ دریافت بیشتر از بودجهٔ نوبت است',pending:'در صف خواندن',queued:'در صف خواندن',reading:'خواندن در حال اجرا',read:'محتوا خوانده شده',read_partial:'فقط بخشی از محتوا خوانده شده',robots_blocked:'robots اجازهٔ دریافت نمی‌دهد',robots_unavailable:'سیاست robots قابل بررسی نبود',fetch_failed:'دریافت ناموفق',failed:'دریافت ناموفق',body_too_large:'بزرگ‌تر از سقف دریافت',foreign_host:'دامنهٔ مقصد نیازمند بررسی',redirect_limit:'تغییر مسیر بیش از سقف',homepage_http_error:'خطای دریافت صفحه',http_error:'خطای دریافت صفحه',pdf_parser_unavailable:'ابزار خواندن PDF در دسترس نیست',unsupported_content_type:'نوع محتوا پشتیبانی نمی‌شود',invalid_url:'نشانی خارج از قواعد دریافت'};
const text=value=>typeof value==='string'?value:'';
const list=value=>Array.isArray(value)?value:[];
const count=value=>Number.isFinite(value)?value.toLocaleString(interfaceLocale('fa-IR')):'نامشخص';
const date=value=>{try{return value?new Intl.DateTimeFormat(interfaceLocale('fa-IR'),{timeZone:'Asia/Tehran',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'ثبت نشده';}catch{return 'ثبت نشده';}};
const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}};

function Excerpts({label,values}){
 const rows=list(values).filter(value=>text(value?.text).trim());
 if(!rows.length)return null;
 return <details style={{marginTop:10}}><summary>{label} ({count(rows.length)})</summary>{rows.slice(0,8).map((row,index)=><blockquote key={index} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',margin:'10px 0',paddingInlineStart:12,borderInlineStart:'2px solid var(--border, #314057)'}}><MixedText>{row.text}</MixedText></blockquote>)}{rows.length>8&&<small className="muted">بخشی از شواهد نمایش داده شده است؛ متن منبع را هم بررسی کنید.</small>}</details>;
}

// Read-only public evidence inside the authenticated owner's appropriate panel.
export function ExtractedEvidence({person,section='all',country=person==='amir'?'IT':'AU'}){
 const selectedSection=SECTIONS.has(section)?section:'all';
 const identity=person+':'+country+':'+selectedSection;
 const owner=useRef({identity,epoch:0});
 if(owner.current.identity!==identity)owner.current={identity,epoch:owner.current.epoch+1};
 const epoch=owner.current.epoch,validScope=['amir','arash'].includes(person)&&['IT','AU'].includes(country)&&!(person==='arash'&&country==='IT');
 const generation=useRef(0);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[submittedQuery,setSubmittedQuery]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(0);
 const [record,setRecord]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 const current=record?.identity===identity?record.data:null;

 useEffect(()=>{setOpen(false);setQuery('');setSubmittedQuery('');setStatus('all');setPage(0);setRecord(null);setBusy(false);setError('');generation.current++;},[identity]);
 useEffect(()=>{
  const requestNumber=++generation.current;
  if(!open||!validScope)return;
  const requestedIdentity=identity,requestedEpoch=epoch;
  const valid=()=>owner.current.identity===requestedIdentity&&owner.current.epoch===requestedEpoch&&generation.current===requestNumber;
  setBusy(true);setError('');
  const params=new URLSearchParams({profile:person,country,section:selectedSection,q:submittedQuery,limit:'15',offset:String(page*15),status});
  api('research/pages?'+params).then(data=>{if(valid()){if(!data||data.profileId!==person)throw Error('پاسخ این درخواست با حساب فعلی هم‌خوانی ندارد؛ داده‌ای نمایش داده نشد.');setRecord({identity:requestedIdentity,data});}}).catch(err=>{if(valid()){setRecord(null);setError(err.message||'دریافت شواهد انجام نشد.');}}).finally(()=>{if(valid())setBusy(false);});
  return()=>{generation.current++;};
 },[identity,epoch,validScope,open,submittedQuery,status,page,refresh]);

 if(!validScope)return null;
 const pages=list(current?.pages),total=Number.isFinite(current?.total)?current.total:0;
 return <section className="panel" aria-label={HEADINGS[selectedSection]+' · '+(country==='IT'?'ایتالیا':'استرالیا')} style={{gridColumn:'1 / -1'}}><details open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary style={{cursor:'pointer'}}><strong>{HEADINGS[selectedSection]} · {country==='IT'?'ایتالیا':'استرالیا'}</strong></summary>
  <p className="notice">پیوند کشف‌شده، صفحهٔ خوانده‌شده و تحلیل تأییدشده یکسان نیستند. متن‌های این بخش شواهد استخراج‌شده از محتوای دریافتی‌اند؛ پذیرش، صلاحیت پزشکی، فاند باز یا پیشنهاد قطعی را تأیید نمی‌کنند.</p>
  <form className="inbox-filters" onSubmit={event=>{event.preventDefault();setPage(0);setSubmittedQuery(query.trim());}}>
   <input aria-label={'جست‌وجو در '+HEADINGS[selectedSection]} value={query} maxLength={150} onChange={event=>setQuery(event.target.value)} placeholder="نام مرکز، موضوع یا عبارت داخل محتوا…"/>
   <select aria-label={'وضعیت خواندن منابع '+selectedSection} value={status} onChange={event=>{setStatus(event.target.value);setPage(0);}}><option value="all">همهٔ وضعیت‌ها</option><option value="read">محتوا خوانده شده</option><option value="needs_review">خوانده‌نشده، محدود یا نیازمند رسیدگی</option></select>
   <button type="submit" className="secondary" disabled={busy}>جست‌وجوی شواهد</button><button type="button" className="text-button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>بررسی تازهٔ وضعیت</button>
  </form>
  {error&&<p role="alert" className="notice"><MixedText>{error}</MixedText></p>}
  {current&&<p className="muted" role="status">در صف: {count(current.queue?.pending)} · خوانده‌شده (شامل ناقص): {count(current.queue?.read)} · خواندن ناقص: {count(current.queue?.partial)} · ناموفق یا محدود: {count(current.queue?.failed)} · {count(total)} نتیجه با فیلتر فعلی</p>}
  {busy&&<p className="muted">در حال دریافت دادهٔ ذخیره‌شدهٔ همین پنل…</p>}
  {!busy&&current&&!pages.length&&<p className="muted">شاهدی با این فیلتر دریافت نشد؛ خالی‌بودن فهرست به معنی بررسی موفق همهٔ صفحات نیست.</p>}
  {pages.map((item,index)=>{const read=['read','read_partial'].includes(item.status),analysis=read&&item.analysis&&typeof item.analysis==='object'?item.analysis:null,link=safeLink(item.url),summary=text(analysis?.summary),archive=list(analysis?.archiveEvidence).filter(value=>text(value?.text).trim()),uncertainty=list(analysis?.uncertainty).filter(value=>text(value?.text).trim());return <article className="inbox-message" key={text(item.id)||index}>
   <div className="section-head" style={{flexWrap:'wrap',gap:8,alignItems:'start'}}><h4 style={{margin:0,overflowWrap:'anywhere',flex:1}}><MixedText>{text(item.title)||'صفحهٔ منبع؛ عنوان استخراج نشده'}</MixedText></h4><span className="status amber">{STATUSES[item.status]||(read?STATUSES.read:'وضعیت نیازمند رسیدگی')}</span></div>
   <p className="muted">{read?'زمان خواندن':'آخرین تلاش ثبت‌شده'} به وقت تهران: {date(item.readAt)}{read?' · '+(CATEGORIES[item.category||analysis?.category]||'نوع محتوا نیازمند بررسی'):''}</p>
   {read&&analysis&&<p className="muted">استخراج ماشینی؛ نیازمند بازبینی محتوایی. شرایط شخصی شما هنوز ارزیابی نشده است.</p>}
   {analysis&&<div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:10}}><span className="status amber">{analysis.healthRelevance==='explicit'?'اشارهٔ صریح به سلامت در متن استخراج‌شده':analysis.healthRelevance==='not_stated'?'ارتباط با سلامت در متن بررسی‌شده تصریح نشده':'ارتباط موضوعی هنوز ارزیابی نشده'}</span>{list(analysis.topics).filter(topic=>TOPICS[topic]).map(topic=><span key={topic} className="status"><MixedText>{TOPICS[topic]}</MixedText></span>)}</div>}
   {analysis?.partialReading&&<p className="notice">ارزیابی محدود به بخش دریافت یا استخراج‌شده است؛ کل منبع ارزیابی نشده است.{Number.isFinite(analysis.textEvaluatedCharacters)&&<> تعداد نویسهٔ بررسی‌شده: {count(analysis.textEvaluatedCharacters)}.</>}</p>}
   {archive.length>0&&<div className="notice"><p>متن، نشانه‌هایی از بسته‌شدن یا بایگانی فراخوان دارد؛ بازبودن موقعیت از این صفحه تأیید نمی‌شود.</p><Excerpts label="عبارت‌های منبع دربارهٔ بسته‌شدن یا بایگانی" values={archive}/></div>}
   {summary?<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><MixedText>{summary}</MixedText></p>:<p className="muted">{read?(analysis?'خلاصهٔ قابل اتکایی از این صفحه ثبت نشده؛ متن منبع و شواهد را بررسی کنید.':'محتوا دریافت شده؛ تحلیل محتوایی این صفحه هنوز ثبت نشده است.'):'محتوا خوانده نشده است؛ خلاصه یا شرایطی برای آن ساخته نشده است.'}</p>}
   {analysis&&<><Excerpts label="شرط‌ها و عدم‌قطعیت‌های ذکرشده" values={uncertainty}/><Excerpts label="شرایط، مدارک و پیش‌نیازهای ذکرشده" values={analysis.requirements}/><Excerpts label="شواهد فاند و حمایت مالی" values={analysis.funding}/><Excerpts label="مهلت‌های ذکرشده؛ نیازمند تأیید تازگی" values={analysis.deadlines}/><Excerpts label="گام‌ها و اقدام‌های ذکرشده در منبع" values={analysis.actions}/></>}
   {link&&<a className="secondary link" href={link} target="_blank" rel="noreferrer">بازکردن اصل منبع</a>}
   {list(analysis?.limitations).length>0&&<details style={{marginTop:10}}><summary>حدود این استخراج</summary><ul>{analysis.limitations.filter(value=>typeof value==='string').map((value,i)=><li key={i}><MixedText>{value}</MixedText></li>)}</ul></details>}
  </article>;})}
  {current&&total>15&&<div className="form-actions" style={{marginTop:14}}><button type="button" className="secondary" disabled={busy||page===0} onClick={()=>setPage(value=>Math.max(0,value-1))}>قبلی</button><span>صفحهٔ {count(page+1)} از {count(Math.ceil(total/15))}</span><button type="button" className="secondary" disabled={busy||(page+1)*15>=total} onClick={()=>setPage(value=>value+1)}>بعدی</button></div>}
  {list(current?.limitations).length>0&&<details style={{marginTop:14}}><summary>پوشش و محدودیت‌های دریافت</summary><ul>{current.limitations.filter(value=>typeof value==='string').map((value,i)=><li key={i}><MixedText>{value}</MixedText></li>)}</ul></details>}
 </details></section>;
}
