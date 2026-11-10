import {translateUIString} from './ui-translations.mjs';
import {interfaceLanguage,interfaceLocale} from './interface-locale.mjs';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, ClipboardCheck, GraduationCap, BookOpen, AlertCircle, Search, Filter } from 'lucide-react';
import { api } from './api';
import { MixedText } from './mixed-text';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value : '';
const statusLabels = {todo:'برنامه‌ریزی‌نشده',doing:'در حال انجام',done:'انجام‌شده به گزارش شما',blocked:'متوقف؛ نیازمند رفع مانع'};
const labels = {AUD:'دلار استرالیا',EUR:'یورو',year_2027:'سال ۲۰۲۷',month_net_indicative_2026_call:'ماهانه؛ خالص طبق فراخوان ۲۰۲۶',year_gross_2026_call_selected_programmes:'سالانه؛ ناخالص طبق فراخوان ۲۰۲۶',vacancy_specific:'وابسته به موقعیت',month_current_programme_page:'ماهانه طبق صفحهٔ برنامه',competitive_stipend_and_fees:'کمک‌هزینه و شهریه؛ رقابتی',competitive_stipend_plus_separate_tuition:'کمک‌هزینه؛ شهریه جداگانه و رقابتی',competitive_phd_scholarship:'بورس دکتری رقابتی',funded_position_allowances:'موقعیت دارای تأمین مالی مشروط',competitive_research_grant:'گرنت پژوهشی رقابتی',priority:'اولویت عملی',gaps:'ابهام‌ها و پیش‌نیازهای پرونده',conclusion:'نتیجهٔ مشروط',mainGap:'مانع اصلی',date:'تاریخ',status:'وضعیت',note:'توضیح',kind:'نوع',amount:'مبلغ',currency:'واحد پول',period:'دوره',coverage:'پوشش',conditions:'شرایط',year:'سال',tuition:'شهریه',stipend:'کمک‌هزینه',open:'باز طبق منبع',closed:'بسته',expired:'منقضی',unknown:'نامشخص',not_verified:'تأیید نشده',portal:'درگاه جست‌وجو',ongoing:'مستمر',requires_review:'نیازمند بازبینی',changed:'تغییر محتوای منبع؛ نیازمند بازبینی',unchanged:'تغییری در محتوای بررسی‌شده دیده نشد',ok:'دریافت موفق منبع',available:'دریافت موفق؛ نه بازبینی مجدد تحلیل',changed_review_required:'محتوای منبع تغییر کرده؛ بازبینی تحلیل لازم است',check_failed:'دریافت منبع ناموفق؛ تحلیل پیشین به‌روز تلقی نمی‌شود',not_checked:'هنوز پایش نشده',error:'خطای دریافت منبع',lastSuccessAt:'آخرین دریافت موفق',lastCheckedAt:'آخرین پایش',checkedAt:'زمان بررسی',url:'نشانی',upcoming_submission_deadline:'مهلت آینده طبق منبع',course_specific_deadline:'مهلت وابسته به دوره',vacancy_specific_deadline:'مهلت وابسته به موقعیت',country_specific_call_check_required:'فراخوان کشور نیازمند بررسی',upcoming_requires_confirmation:'رویداد آینده؛ نیازمند تأیید',recommended_skill_plan:'پیشنهاد تقویت مهارت',source_access_blocked:'دسترسی منبع مسدود است',monitoring_no_verified_future_call:'رصد منبع؛ فراخوان آینده تأیید نشده',skill_plan_past_course_reference:'برنامهٔ مهارت با مرجع آموزشی گذشته'};
const display = value => typeof value === 'string' ? (labels[value] || value) : typeof value === 'number' ? value.toLocaleString(interfaceLocale('fa-IR')) : typeof value === 'boolean' ? (value?'بله':'خیر') : '';
const headings = {pathways:'تحلیل مسیر و برنامهٔ اقدام',study:'تحصیل پژوهشی و فاند',development:'مهارت‌ها و رویدادهای علمی'};
const countryNames = {AU:'استرالیا',IT:'ایتالیا',IR:'ایران',DE:'آلمان',EU:'اروپا'};
const safeURL = value => {try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')?u.href:null;}catch{return null;}};
const date = value => {const d=new Date(value);return value&&!Number.isNaN(d.getTime())?d.toLocaleDateString(interfaceLocale('fa-IR'),{timeZone:'Asia/Tehran'}):text(value)||'ثبت نشده';};
const included = (item, category) => item.group ? item.group===category : category==='study'?item.type==='study':category==='development'?['development','event'].includes(item.type):!['study','development','event'].includes(item.type);
const deadlineValue = item => typeof item.deadline==='string'?item.deadline:item.deadline?.date;
const deadlineTime = item => {const value=Date.parse(deadlineValue(item));return Number.isFinite(value)?value:null;};
const isClosed = item => ['closed','expired'].includes(item.status)||['closed','expired'].includes(item.deadline?.status)||(deadlineTime(item)!==null&&deadlineTime(item)+86400000<Date.now());
const needsReview = item => !!item.review || /requires|unknown|blocked|monitoring|unavailable/.test([item.status,item.deadline?.status].filter(Boolean).join(' '));
const short = (value,max=175) => {const original=text(value),s=interfaceLanguage()==='en'?translateUIString(original):original;return s.length>max?s.slice(0,max).replace(/\s+\S*$/,'')+'…':s;};
const sortNotes = {important:'اولویت با هشدار بازبینی منبع، سپس مهلت نزدیکِ نگذشته است؛ این چینش احتمال قبولی نیست.',newest:'ابتدا تاریخ جدیدترِ بررسی منبع، سپس مهلت جدیدتر نمایش داده می‌شود.',relevant:'ابتدا موارد اختصاصی همین کاربر و قابل پیگیری، سپس موارد مشترک یا بسته نمایش داده می‌شوند؛ امتیاز پذیرش محاسبه نمی‌شود.'};

function DetailsValue({value,depth=0}) {
  if(value==null)return <span className="muted">تعیین نشده</span>;
  if(typeof value!=='object')return <MixedText>{String(display(value))}</MixedText>;
  if(depth>3)return <MixedText>{JSON.stringify(value)}</MixedText>;
  if(Array.isArray(value))return <ul>{value.map((v,i)=><li key={i}><DetailsValue value={v} depth={depth+1}/></li>)}</ul>;
  return <div style={{display:'grid',gap:'.3rem'}}>{Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=><div key={k}><b><MixedText>{labels[k]||k}</MixedText>: </b><DetailsValue value={v} depth={depth+1}/></div>)}</div>;
}
function TextList({items}) {return <ul>{list(items).map((item,i)=><li key={i} style={{marginBlock:'.4rem'}}>{typeof item==='string'?<MixedText>{item}</MixedText>:<DetailsValue value={item}/>}</li>)}</ul>;}
function Sources({urls}) {
  return <div style={{display:'flex',flexWrap:'wrap',gap:'.65rem'}}>{list(urls).map((entry,i)=>{const raw=typeof entry==='string'?entry:entry?.url,url=safeURL(raw);if(!url)return null;return <a key={i} href={url} target="_blank" rel="noreferrer" className="secondary link" style={{overflowWrap:'anywhere',fontSize:'.85rem'}}><ExternalLink size={14} aria-hidden="true"/><MixedText>{typeof entry==='object'&&text(entry.label)||new URL(url).hostname}</MixedText></a>;})}</div>;
}
function FundingHighlight({funding}) {
  if(!funding)return null;
  if(typeof funding==='string')return <span><MixedText>{short(funding,100)}</MixedText></span>;
  const amount=typeof funding.amount==='number'?funding.amount.toLocaleString(interfaceLocale('fa-IR')):text(funding.amount);
  return <span><MixedText>{amount?[amount,String(display(funding.currency)),String(display(funding.period))].filter(Boolean).join(' · '):short(String(display(funding.kind))||'شرایط تأمین مالی در جزئیات',90)}</MixedText></span>;
}

export function RoadmapPanel({person,category='pathways',notify=()=>{},cloud=true}) {
  const profile=typeof person==='string'?person:person?.id;
  const [result,setResult]=useState(null),[requestState,setRequestState]=useState(null),[actionStates,setActionStates]=useState(null),[notes,setNotes]=useState(null),[busy,setBusy]=useState(null),[actionError,setActionError]=useState(null);
  const [filters,setFilters]=useState({profile,category,query:'',country:'all',status:'all',sort:'important'});
  const identity=useRef({profile,epoch:0}),mounted=useRef(false),requestId=useRef(0);
  if(identity.current.profile!==profile)identity.current={profile,epoch:identity.current.epoch+1};
  const context=()=>({profile,epoch:identity.current.epoch});
  const current=c=>mounted.current&&identity.current.profile===c.profile&&identity.current.epoch===c.epoch;
  const allowed=['amir','arash'].includes(profile)&&!(category==='study'&&profile!=='amir');
  const workspace=result?.profile===profile?result.data:null;
  const state=requestState?.profile===profile?requestState:{loading:false,error:''};
  const updates=actionStates?.profile===profile?actionStates.values:{};
  const noteValues=notes?.profile===profile?notes.values:{};
  const pending=busy?.profile===profile?busy.values:{};
  const errors=actionError?.profile===profile?actionError.values:{};
  const selected=filters.profile===profile&&filters.category===category?filters:{profile,category,query:'',country:'all',status:'all',sort:'important'};
  const setFilter=(key,value)=>setFilters({...selected,[key]:value});
  async function load(){
    if(!allowed||!cloud)return;
    const c=context(),id=++requestId.current;setRequestState({profile,loading:true,error:''});
    try{const data=await api('roadmap?profile='+encodeURIComponent(profile));if(!current(c)||id!==requestId.current)return;if(data.profileId!==profile)throw Error('پاسخ این درخواست متعلق به فضای کاری فعلی نیست.');setResult({profile,data});setRequestState({profile,loading:false,error:''});}
    catch(e){if(current(c)&&id===requestId.current)setRequestState({profile,loading:false,error:e.status===404?'برنامهٔ تحلیلی در این محیط هنوز در دسترس نیست.':e.message||'دریافت برنامه انجام نشد.'});}
  }
  useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;requestId.current++;};},[profile,cloud,allowed]);
  function noteChange(id,value){setNotes(previous=>({profile,values:{...(previous?.profile===profile?previous.values:{}),[id]:value}}));}
  async function saveAction(action,status){
    if(!allowed||pending[action.id])return;
    const c=context(),id=action.id,note=Object.hasOwn(noteValues,id)?noteValues[id]:text(action.note);
    setBusy(previous=>({profile,values:{...(previous?.profile===profile?previous.values:{}),[id]:true}}));
    setActionError(previous=>({profile,values:{...(previous?.profile===profile?previous.values:{}),[id]:''}}));
    try{const response=await api('roadmap/actions?profile='+encodeURIComponent(profile),{method:'POST',body:JSON.stringify({actionId:id,status,note})});if(!current(c))return;const saved=response.action||response;setActionStates(previous=>({profile,values:{...(previous?.profile===profile?previous.values:{}),[id]:{...action,...saved,status:saved.status||status,note:saved.note??note}}}));notify('وضعیت اقدام فقط در برنامهٔ شخصی شما ذخیره شد؛ رزومه تغییری نکرد.');}
    catch(e){if(current(c))setActionError(previous=>({profile,values:{...(previous?.profile===profile?previous.values:{}),[id]:e.message||'ذخیره انجام نشد.'}}));}
    finally{if(current(c))setBusy(previous=>({profile,values:{...(previous?.profile===profile?previous.values:{}),[id]:false}}));}
  }
  const allItems=list(workspace?.items).filter(item=>included(item,category)&&(item.audience==='both'||!item.audience||item.audience===profile));
  const actionStatus=a=>(updates[a?.id]||a)?.status||'todo';
  const pendingCount=item=>list(item.actions).filter(a=>actionStatus(a)!=='done').length;
  const countryOptions=[...new Set(allItems.map(i=>text(i.country)).filter(Boolean))].sort();
  const visibleItems=useMemo(()=>{
    const q=selected.query.trim().toLocaleLowerCase();
    const matches=allItems.filter(item=>(selected.country==='all'||item.country===selected.country)&&(!q||[item.title,item.evidenceSummary,item.country,...list(item.requirements)].join(' ').toLocaleLowerCase().includes(q))&&(selected.status==='all'||selected.status==='closed'&&isClosed(item)||selected.status==='followup'&&!isClosed(item)||selected.status==='review'&&needsReview(item)||selected.status==='progress'&&list(item.actions).some(a=>actionStatus(a)==='doing')));
    return matches.sort((a,b)=>{
      if(selected.sort==='newest')return (Date.parse(b.checkedAt)||0)-(Date.parse(a.checkedAt)||0)||(deadlineTime(b)||0)-(deadlineTime(a)||0)||text(a.id).localeCompare(text(b.id));
      if(selected.sort==='relevant')return Number(isClosed(a))-Number(isClosed(b))||Number(b.audience===profile)-Number(a.audience===profile)||text(a.id).localeCompare(text(b.id));
      const alertA=!!a.review,alertB=!!b.review;
      const soon=i=>isClosed(i)?Number.POSITIVE_INFINITY:deadlineTime(i)??Number.POSITIVE_INFINITY;
      return Number(alertB)-Number(alertA)||Number(isClosed(a))-Number(isClosed(b))||soon(a)-soon(b)||Number(b.audience===profile)-Number(a.audience===profile)||text(a.id).localeCompare(text(b.id));
    });
  },[workspace,category,profile,selected.query,selected.country,selected.status,selected.sort,updates]);
  if(!allowed)return <section className="panel"><h3>{headings[category]||headings.pathways}</h3><p>این بخش برای فضای کاری فعلی در دسترس نیست.</p></section>;
  const analysis=workspace?.analysis||{};
  return <div dir="rtl" style={{display:'grid',gap:'1rem',minWidth:0}}>
    <section className="panel"><div className="section-head"><div><h3>{category==='study'?<GraduationCap size={20} aria-hidden="true"/>:category==='development'?<BookOpen size={20} aria-hidden="true"/>:<ClipboardCheck size={20} aria-hidden="true"/>} {headings[category]||headings.pathways}</h3><p className="muted">فضای مستقل {profile==='amir'?'دکتر گرامی':'دکتر انتظار'} · هر کارت را برای دیدن تحلیل و اقدام‌ها باز کنید.</p></div><button className="secondary" onClick={load} disabled={state.loading||!cloud}><RefreshCw size={15} aria-hidden="true"/>{state.loading?'در حال دریافت…':'بازخوانی'}</button></div>
      {workspace&&<p className="muted">{allItems.length.toLocaleString(interfaceLocale('fa-IR'))} مورد · {allItems.reduce((n,item)=>n+pendingCount(item),0).toLocaleString(interfaceLocale('fa-IR'))} گام باز · بررسی منابع: <time dateTime={workspace.checkedAt}>{date(workspace.checkedAt)}</time></p>}
      {!cloud&&<p className="notice">این برنامهٔ شخصی به ورود در نسخهٔ آنلاین وابسته است؛ در محیط محلی اتصال آن برقرار نیست.</p>}
      {state.error&&<div className="notice" role="alert"><AlertCircle size={16} aria-hidden="true"/> <MixedText>{state.error}</MixedText></div>}
      <details style={{marginTop:'.5rem'}}><summary style={{cursor:'pointer'}}>اعتبار تحلیل و حریم خصوصی</summary><p>این پیشنهادها تأیید صلاحیت یا درصد پذیرش نیستند. یادداشت‌ها و وضعیت اقدام‌ها خصوصی‌اند؛ ثبت «انجام‌شده» مدرک یا دستاورد تأییدشده به رزومه اضافه نمی‌کند. بازخوانی برنامه به معنی بررسی دوبارهٔ منابع نیست.</p><TextList items={workspace?.limitations}/></details>
    </section>
    {category==='pathways'&&workspace&&<section className="panel"><h3>جمع‌بندی پروندهٔ شما</h3><p style={{lineHeight:1.9}}><MixedText>{text(analysis.summary)}</MixedText></p><details><summary style={{cursor:'pointer',fontWeight:600}}>اطلاعات پرونده، موارد باز و سناریوهای مسیر</summary><div className="two-col" style={{marginTop:'1rem'}}><section><h4>اطلاعات موجود</h4><TextList items={analysis.knownFacts}/></section><section><h4>موارد تعیین‌کنندهٔ باقی‌مانده</h4><TextList items={analysis.unknowns}/></section></div>{list(analysis.scenarios).map((scenario,i)=><details key={i} style={{marginBlock:'.9rem'}}><summary style={{cursor:'pointer'}}><MixedText>{text(scenario.title)}</MixedText></summary><p><MixedText>{text(scenario.conclusion)}</MixedText></p><TextList items={scenario.actions}/></details>)}</details></section>}
    {workspace&&allItems.length>0&&<section className="panel" aria-label="فیلتر و چینش برنامه"><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(10rem,1fr))',gap:'.8rem',alignItems:'end'}}>
      <label><span><Search size={14} aria-hidden="true"/> جست‌وجو</span><input aria-label="جست‌وجوی برنامه" value={selected.query} onChange={e=>setFilter('query',e.target.value)} placeholder="عنوان، مهارت یا شرط…" style={{width:'100%'}}/></label>
      <label><span>کشور</span><select aria-label="کشور برنامه" value={selected.country} onChange={e=>setFilter('country',e.target.value)} style={{width:'100%'}}><option value="all">همهٔ کشورها</option>{countryOptions.map(c=><option key={c} value={c}>{countryNames[c]||c}</option>)}</select></label>
      <label><span><Filter size={14} aria-hidden="true"/> نمایش</span><select aria-label="وضعیت برنامه" value={selected.status} onChange={e=>setFilter('status',e.target.value)} style={{width:'100%'}}><option value="all">همهٔ موارد</option><option value="followup">قابل پیگیری / مهلت نگذشته</option><option value="closed">بسته یا مهلت‌گذشته</option><option value="review">نیازمند بررسی / تأیید</option><option value="progress">اقدام در حال انجام</option></select></label>
      <label><span>چینش</span><select aria-label="چینش برنامه" value={selected.sort} onChange={e=>setFilter('sort',e.target.value)} style={{width:'100%'}}><option value="important">مهم‌ترین</option><option value="newest">جدیدترین</option><option value="relevant">مرتبط‌ترین با حساب من</option></select></label>
    </div><p className="muted" style={{marginBottom:0}}>{visibleItems.length.toLocaleString(interfaceLocale('fa-IR'))} از {allItems.length.toLocaleString(interfaceLocale('fa-IR'))} مورد · {sortNotes[selected.sort]}</p>{selected.status==='followup'&&<small className="muted">این فیلتر باز بودن فراخوان یا احراز شرایط شما را تضمین نمی‌کند؛ مهلت نامشخص هم قابل پیگیری است.</small>}</section>}
    {workspace&&!visibleItems.length&&!state.loading&&<section className="panel"><p className="muted">{allItems.length?'موردی با این فیلترها پیدا نشد.':'هنوز مورد بررسی‌شده‌ای برای این دسته ثبت نشده است؛ نبود نتیجه به معنی نبود فرصت نیست.'}</p>{allItems.length>0&&<button className="text-button" onClick={()=>setFilters({profile,category,query:'',country:'all',status:'all',sort:'important'})}>پاک‌کردن فیلترها</button>}</section>}
    {visibleItems.map((item,itemIndex)=><article className="panel" key={item.id||itemIndex} style={{minWidth:0,padding:'1.1rem 1.25rem'}}>
      <div className="section-head" style={{alignItems:'start',gap:'.8rem'}}><h3 style={{margin:0,fontSize:'1.05rem',lineHeight:1.8}}><MixedText>{text(item.title)}</MixedText></h3><span className="status" style={{whiteSpace:'nowrap'}}>{countryNames[item.country]||text(item.country)}</span></div>
      <p className="muted" style={{lineHeight:1.85,marginBlock:'.7rem'}}><MixedText>{short(item.evidenceSummary)}</MixedText></p>
      <div style={{display:'flex',gap:'.6rem',flexWrap:'wrap',alignItems:'center',fontSize:'.85rem',marginBottom:'.7rem'}}><span className="status">{isClosed(item)?'بسته / مهلت‌گذشته':item.review?'بازبینی منبع لازم است':'بررسی مشروط'}</span>{deadlineValue(item)&&<span>مهلت ثبت‌شده: {date(deadlineValue(item))}</span>}{item.funding&&<span className="status"><FundingHighlight funding={item.funding}/></span>}<span className="muted">{pendingCount(item).toLocaleString(interfaceLocale('fa-IR'))} گام باز</span></div>
      <details><summary style={{cursor:'pointer',fontWeight:600}}>بازکردن تحلیل و گام‌ها</summary><div style={{marginTop:'1rem'}}>
        <p style={{lineHeight:1.95}}><MixedText>{text(item.evidenceSummary)}</MixedText></p>
        {item.review&&<div className="notice"><DetailsValue value={item.review}/></div>}
        {item.personalAssessment&&<details style={{marginBlock:'1rem'}}><summary style={{cursor:'pointer'}}>تطبیق با پروندهٔ شما</summary><div className="notice"><DetailsValue value={item.personalAssessment}/></div></details>}
        {item.funding&&<details style={{marginBlock:'1rem'}}><summary style={{cursor:'pointer'}}>فاند و پوشش هزینه</summary><DetailsValue value={item.funding}/></details>}
        {(item.deadline||item.status)&&<details style={{marginBlock:'1rem'}}><summary style={{cursor:'pointer'}}>مهلت و وضعیت دقیق</summary><DetailsValue value={item.deadline||item.status}/></details>}
        <details style={{marginBlock:'1rem'}}><summary style={{cursor:'pointer'}}>شرایط، محدودیت‌ها و منابع</summary><h4>شرایط مهم</h4><TextList items={item.requirements}/>{list(item.caveats).length>0&&<><h4>محدودیت‌ها</h4><TextList items={item.caveats}/></>}<p className="muted">بررسی محتوای منبع: {date(item.checkedAt||workspace.checkedAt)}</p><Sources urls={item.sourceUrls}/></details>
        <details style={{marginBlock:'1rem'}}><summary style={{cursor:'pointer',fontWeight:600}}>اقدام‌های من و یادداشت خصوصی ({list(item.actions).length.toLocaleString(interfaceLocale('fa-IR'))})</summary>
          {list(item.actions).map((raw,i)=>{const action=typeof raw==='string'?{id:'',text:raw,status:'todo'}:raw||{};const saved=updates[action.id]||action,id=`roadmap-${itemIndex}-${i}`,note=Object.hasOwn(noteValues,action.id)?noteValues[action.id]:text(saved.note),status=Object.hasOwn(statusLabels,saved.status)?saved.status:'todo';return <div className="step" key={action.id||i} style={{alignItems:'start',marginBlock:'.9rem'}}><span className="step-num">{i+1}</span><div style={{flex:1,minWidth:0}}><p style={{marginTop:0,lineHeight:1.85}}><MixedText>{text(action.text)||text(action.label)}</MixedText></p>{action.id&&<><div style={{display:'flex',gap:'.6rem',alignItems:'center',flexWrap:'wrap'}}><label htmlFor={id+'-status'}>وضعیت شخصی</label><select id={id+'-status'} value={status} disabled={!!pending[action.id]} onChange={e=>saveAction(action,e.target.value)} style={{width:'auto',maxWidth:'100%'}}>{Object.entries(statusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{saved.updatedAt&&<small className="muted">ثبت: {date(saved.updatedAt)}</small>}</div><label htmlFor={id+'-note'} style={{display:'block',marginTop:'.7rem'}}>یادداشت خصوصی این اقدام</label><textarea id={id+'-note'} maxLength={1500} rows={2} value={note} onChange={e=>noteChange(action.id,e.target.value)} style={{width:'100%',resize:'vertical'}}/><button className="text-button" disabled={!!pending[action.id]} onClick={()=>saveAction(action,status)}>{pending[action.id]?'در حال ذخیره…':'ذخیرهٔ یادداشت'}</button>{errors[action.id]&&<p role="alert" className="notice"><MixedText>{errors[action.id]}</MixedText></p>}</>}</div></div>;})}
        </details>
      </div></details>
    </article>)}
    {list(workspace?.sourceChecks).length>0&&<section className="panel"><details><summary style={{cursor:'pointer'}}>وضعیت پایش منابع</summary><p className="muted">دریافت خودکار جای بازبینی علمی را نمی‌گیرد.</p><div style={{display:'grid',gap:'.8rem'}}>{list(workspace.sourceChecks).map((check,i)=><div className="notice" key={check.id||i}><strong><MixedText>{text(check.title)||text(check.sourceId)||text(check.url)}</MixedText></strong><p><MixedText>{String(display(check.status)||'وضعیت ثبت نشده')}</MixedText>{check.lastSuccessAt&&<> · آخرین دریافت: {date(check.lastSuccessAt)}</>}</p>{safeURL(check.url)&&<Sources urls={[check.url]}/>}</div>)}</div></details></section>}
  </div>;
}
