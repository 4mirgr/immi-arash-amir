import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, ClipboardCheck, GraduationCap, BookOpen, AlertCircle } from 'lucide-react';
import { api } from './api';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value : '';
const statusLabels = {todo:'برنامه‌ریزی‌نشده',doing:'در حال انجام',done:'انجام‌شده به گزارش شما',blocked:'متوقف؛ نیازمند رفع مانع'};
const labels = {priority:'اولویت عملی',gaps:'ابهام‌ها و پیش‌نیازهای پرونده',conclusion:'نتیجهٔ مشروط',mainGap:'مانع اصلی',date:'تاریخ',status:'وضعیت',note:'توضیح',kind:'نوع',amount:'مبلغ',currency:'واحد پول',period:'دوره',coverage:'پوشش',conditions:'شرایط',year:'سال',tuition:'شهریه',stipend:'کمک‌هزینه',open:'باز طبق منبع',closed:'بسته',expired:'منقضی',unknown:'نامشخص',not_verified:'تأیید نشده',portal:'درگاه جست‌وجو',ongoing:'مستمر',requires_review:'نیازمند بازبینی',changed:'تغییر محتوای منبع؛ نیازمند بازبینی',unchanged:'تغییری در محتوای بررسی‌شده دیده نشد',ok:'دریافت موفق منبع',available:'دریافت موفق؛ نه بازبینی مجدد تحلیل',changed_review_required:'محتوای منبع تغییر کرده؛ بازبینی تحلیل لازم است',check_failed:'دریافت منبع ناموفق؛ تحلیل پیشین به‌روز تلقی نمی‌شود',not_checked:'هنوز پایش نشده',error:'خطای دریافت منبع',lastSuccessAt:'آخرین دریافت موفق',lastCheckedAt:'آخرین پایش',checkedAt:'زمان بررسی',url:'نشانی'};
const display = value => typeof value === 'string' ? (labels[value] || value) : typeof value === 'number' ? value.toLocaleString('fa-IR') : typeof value === 'boolean' ? (value?'بله':'خیر') : '';
const headings = {pathways:'تحلیل مسیر و برنامهٔ اقدام',study:'تحصیل پژوهشی و فاند',development:'مهارت‌ها و رویدادهای علمی'};
const safeURL = value => {try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')?u.href:null;}catch{return null;}};
const date = value => {const d=new Date(value);return value&&!Number.isNaN(d.getTime())?d.toLocaleDateString('fa-IR'):text(value)||'ثبت نشده';};
const included = (item, category) => item.group ? item.group===category : category==='study'?item.type==='study':category==='development'?['development','event'].includes(item.type):!['study','development','event'].includes(item.type);

function DetailsValue({value,depth=0}) {
  if(value==null)return <span className="muted">تعیین نشده</span>;
  if(typeof value!=='object')return <span dir="auto">{display(value)}</span>;
  if(depth>3)return <span dir="auto">{JSON.stringify(value)}</span>;
  if(Array.isArray(value))return <ul>{value.map((v,i)=><li key={i}><DetailsValue value={v} depth={depth+1}/></li>)}</ul>;
  return <div style={{display:'grid',gap:'.3rem'}}>{Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=><div key={k}><b>{labels[k]||k}: </b><DetailsValue value={v} depth={depth+1}/></div>)}</div>;
}
function TextList({items}) {return <ul>{list(items).map((item,i)=><li key={i} style={{marginBlock:'.4rem'}} dir="auto">{typeof item==='string'?item:<DetailsValue value={item}/>}</li>)}</ul>;}
function Sources({urls}) {
  return <div style={{display:'flex',flexWrap:'wrap',gap:'.65rem'}}>{list(urls).map((entry,i)=>{const raw=typeof entry==='string'?entry:entry?.url,url=safeURL(raw);if(!url)return null;return <a key={i} href={url} target="_blank" rel="noreferrer" className="secondary link" style={{overflowWrap:'anywhere',fontSize:'.85rem'}}><ExternalLink size={14} aria-hidden="true"/>{typeof entry==='object'&&text(entry.label)||new URL(url).hostname}</a>;})}</div>;
}

export function RoadmapPanel({person,category='pathways',notify=()=>{},cloud=true}) {
  const profile=typeof person==='string'?person:person?.id;
  const [result,setResult]=useState(null),[requestState,setRequestState]=useState(null),[actionStates,setActionStates]=useState(null),[notes,setNotes]=useState(null),[busy,setBusy]=useState(null),[actionError,setActionError]=useState(null);
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
  if(!allowed)return <section className="panel"><h3>{headings[category]||headings.pathways}</h3><p>این بخش برای فضای کاری فعلی در دسترس نیست.</p></section>;
  const items=list(workspace?.items).filter(item=>included(item,category)&&(item.audience==='both'||!item.audience||item.audience===profile));
  const analysis=workspace?.analysis||{};
  return <div dir="rtl" style={{display:'grid',gap:'1.2rem',minWidth:0}}>
    <section className="panel"><div className="section-head"><div><span className="eyebrow">EVIDENCE → PERSONAL ACTION</span><h3>{category==='study'?<GraduationCap size={20} aria-hidden="true"/>:category==='development'?<BookOpen size={20} aria-hidden="true"/>:<ClipboardCheck size={20} aria-hidden="true"/>} {headings[category]||headings.pathways}</h3></div><button className="secondary" onClick={load} disabled={state.loading||!cloud}><RefreshCw size={15} aria-hidden="true"/>{state.loading?'در حال دریافت…':'بازخوانی برنامه'}</button></div>
      <p className="muted">فضای کاری مستقل {profile==='amir'?'دکتر گرامی':'دکتر انتظار'} · وضعیت اقدامات و یادداشت‌ها فقط متعلق به همین حساب است.</p>
      <div className="notice">تحلیل، پیشنهاد اقدام و تطبیق مشروط با اطلاعات پرونده است؛ تأیید صلاحیت یا درصد احتمال پذیرش نیست. ثبت «انجام‌شده» مدرک تازه یا دستاورد تأییدشده به CV اضافه نمی‌کند.</div>
      {workspace?.checkedAt&&<p className="muted">تاریخ بررسی محتوای منابع: <time dateTime={workspace.checkedAt}>{date(workspace.checkedAt)}</time>. بازخوانی برنامه به معنی بررسی دوبارهٔ وب‌سایت‌ها نیست؛ تغییر منبع نیازمند بازبینی تحلیل است.</p>}
      {!cloud&&<p className="notice">این برنامهٔ شخصی به ورود در نسخهٔ آنلاین وابسته است؛ در محیط محلی اتصال آن برقرار نیست.</p>}
      {state.error&&<div className="notice" role="alert"><AlertCircle size={16} aria-hidden="true"/> {state.error}</div>}
    </section>
    {category==='pathways'&&workspace&&<section className="panel"><h3>جمع‌بندی متناسب با پروندهٔ شما</h3><p style={{lineHeight:1.95}} dir="auto">{text(analysis.summary)}</p><div className="two-col"><section><h3>اطلاعات موجود؛ با همان سطح اعتبار پرونده</h3><TextList items={analysis.knownFacts}/></section><section><h3>مدارک و پاسخ‌های تعیین‌کنندهٔ باقی‌مانده</h3><TextList items={analysis.unknowns}/></section></div>{list(analysis.scenarios).map((scenario,i)=><div className="notice" key={i} style={{marginTop:'1rem'}}><strong>{text(scenario.title)}</strong><p dir="auto">{text(scenario.conclusion)}</p><TextList items={scenario.actions}/></div>)}</section>}
    {workspace&&!items.length&&!state.loading&&<section className="panel"><p className="muted">هنوز مورد بررسی‌شده‌ای برای این دسته ثبت نشده است؛ نبود نتیجه به معنی نبود فرصت نیست.</p></section>}
    {items.map((item,itemIndex)=><article className="panel" key={item.id||itemIndex} style={{minWidth:0}}><div className="section-head"><h3>{text(item.title)}</h3><span className="status" dir="auto">{text(item.country)} · {date(item.checkedAt||workspace.checkedAt)}</span></div>
      <p style={{lineHeight:2}} dir="auto">{text(item.evidenceSummary)}</p>
      {item.personalAssessment&&<div className="notice"><strong>تطبیق با پروندهٔ شما</strong><DetailsValue value={item.personalAssessment}/></div>}
      {item.funding&&<div className="notice"><strong>فاند و پوشش هزینه</strong><DetailsValue value={item.funding}/></div>}
      {(item.deadline||item.status)&&<div style={{marginBlock:'.85rem'}}><strong>مهلت و وضعیت: </strong><DetailsValue value={item.deadline||item.status}/></div>}
      <Sources urls={item.sourceUrls}/>
      <details style={{marginBlock:'1rem'}}><summary style={{cursor:'pointer',fontWeight:600}}>شرایط، محدودیت‌ها و جزئیات مستند</summary><h4>شرایط مهم</h4><TextList items={item.requirements}/>{list(item.caveats).length>0&&<><h4>محدودیت‌ها و نکات احتیاط</h4><TextList items={item.caveats}/></>}{item.review&&<DetailsValue value={item.review}/>}</details>
      <h4>گام‌های عملی پیشنهادی</h4>
      {list(item.actions).map((raw,i)=>{const action=typeof raw==='string'?{id:'',text:raw,status:'todo'}:raw||{};const saved=updates[action.id]||action,id=`roadmap-${itemIndex}-${i}`,note=Object.hasOwn(noteValues,action.id)?noteValues[action.id]:text(saved.note),status=Object.hasOwn(statusLabels,saved.status)?saved.status:'todo';return <div className="step" key={action.id||i} style={{alignItems:'start',marginBlock:'.9rem'}}><span className="step-num">{i+1}</span><div style={{flex:1,minWidth:0}}><p dir="auto" style={{marginTop:0,lineHeight:1.85}}>{text(action.text)||text(action.label)}</p>{action.id&&<><div style={{display:'flex',gap:'.6rem',alignItems:'center',flexWrap:'wrap'}}><label htmlFor={id+'-status'}>وضعیت شخصی</label><select id={id+'-status'} value={status} disabled={!!pending[action.id]} onChange={e=>saveAction(action,e.target.value)} style={{width:'auto',maxWidth:'100%'}}>{Object.entries(statusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>{saved.updatedAt&&<small className="muted">ثبت: {date(saved.updatedAt)}</small>}</div><label htmlFor={id+'-note'} style={{display:'block',marginTop:'.7rem'}}>یادداشت خصوصی این اقدام</label><textarea id={id+'-note'} maxLength={1500} rows={2} value={note} onChange={e=>noteChange(action.id,e.target.value)} style={{width:'100%',resize:'vertical'}}/><button className="text-button" disabled={!!pending[action.id]} onClick={()=>saveAction(action,status)}>{pending[action.id]?'در حال ذخیره…':'ذخیرهٔ یادداشت'}</button>{errors[action.id]&&<p role="alert" className="notice">{errors[action.id]}</p>}</>}</div></div>;})}
    </article>)}
    {list(workspace?.sourceChecks).length>0&&<section className="panel"><details><summary style={{cursor:'pointer'}}>وضعیت پایش منابع؛ دریافت خودکار جای بازبینی علمی را نمی‌گیرد</summary><div style={{display:'grid',gap:'.8rem',marginTop:'1rem'}}>{list(workspace.sourceChecks).map((check,i)=><div className="notice" key={check.id||i}><strong dir="auto">{text(check.title)||text(check.sourceId)||text(check.url)}</strong><p>{display(check.status)||'وضعیت ثبت نشده'}{check.lastSuccessAt&&<> · آخرین دریافت: {date(check.lastSuccessAt)}</>}</p>{safeURL(check.url)&&<Sources urls={[check.url]}/>}</div>)}</div></details></section>}
    {list(workspace?.limitations).length>0&&<section className="panel"><h3>حدود این تحلیل</h3><TextList items={workspace.limitations}/></section>}
  </div>;
}
