import {interfaceLocale} from './interface-locale.mjs';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Search,RefreshCw,ExternalLink,BookmarkPlus,Users,Filter,Copy,Clock} from 'lucide-react';
import {api} from './api';
import {MixedText} from './mixed-text';
import {rankNetworkTargets,targetFollowUpDue,networkIntroduction} from './network-target-actions.mjs';
import './linkedin-actions.css';

const array=v=>Array.isArray(v)?v:[];
const text=v=>typeof v==='string'?v:'';
const countries={AU:'استرالیا',IT:'ایتالیا'};
const goals={job:'کار و استخدام',research:'پژوهش و دانشگاه',training:'آموزش بالینی',funding:'فاند و بورس'};
const statuses={to_research:'نیازمند بررسی',shortlisted:'فهرست منتخب',reviewed:'بررسی‌شده',contacted:'تماس به گزارش شما',follow_up:'پیگیری',archived:'بایگانی'};
const opportunityStatuses={open:'باز طبق مهلت ثبت‌شده',closed:'مهلت گذشته',future:'انتشار آینده',unknown:'مهلت نامشخص',source_removed:'نیازمند بررسی منبع'};
const priorities={high:'نشانه‌های متنی مرتبط‌تر',medium:'ارتباط متنی متوسط',review:'نیازمند بررسی بیشتر'};
const typeLabels={job:'شغلی',university:'دانشگاهی',grant:'گرنت',funding:'فاند',scholarship:'بورس'};
const safeURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')?u.href:null;}catch{return null;}};
const linkedInURL=value=>{const url=safeURL(value);return url&&['www.linkedin.com','linkedin.com'].includes(new URL(url).hostname)?url:null;};
const date=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toLocaleDateString(interfaceLocale('fa-IR'),{timeZone:'Asia/Tehran'}):'ثبت نشده';};
const goalFor=item=>item.saved?.goal||(item.opportunityType==='job'?'job':['grant','funding','scholarship'].includes(item.opportunityType)?'funding':'research');
const includesGoal=(item,goal)=>goal==='all'||goalFor(item)===goal||(goal==='training'&&/training|registrar|fellowship|resident/i.test(item.title||''));
function SourceLink({url,children}){const target=safeURL(url);return target?<a className="secondary link" href={target} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true"/>{children}</a>:null;}

export function NetworkTargets({person,notify=()=>{}}){
 const owner=typeof person==='string'?person:person?.id;
 const identity=useRef({owner,epoch:0}),mounted=useRef(false),sequence=useRef(0);
 if(identity.current.owner!==owner)identity.current={owner,epoch:identity.current.epoch+1};
 const epoch=identity.current.epoch;
 const [record,setRecord]=useState(null),[request,setRequest]=useState(null),[filters,setFilters]=useState({owner,country:'all',goal:'all',query:'',view:'suggested',focus:'all'}),[progress,setProgress]=useState(null);
 const scope=owner+':'+epoch;
 const f=filters.owner===owner?filters:{owner,country:'all',goal:'all',query:'',view:'suggested',focus:'all'};
 const state=request?.scope===scope?request:{loading:true,error:''};
 const edits=progress?.scope===scope?progress:{scope,notes:{},goals:{},drafts:{},busy:{},errors:{}};
 const data=record?.scope===scope?record.data:null;
 const valid=()=>mounted.current&&identity.current.owner===owner&&identity.current.epoch===epoch;
 const updateFilter=(key,value)=>setFilters({...f,[key]:value});
 function editField(kind,key,value){setProgress(current=>{const valueForOwner=current?.scope===scope?current:{scope,notes:{},goals:{},drafts:{},busy:{},errors:{}};return {...valueForOwner,[kind]:{...valueForOwner[kind],[key]:value}};});}
 async function load(){
  const id=++sequence.current;setRequest({scope,loading:true,error:''});
  try{const result=await api('linkedin/targets?profile='+encodeURIComponent(owner)+'&country='+encodeURIComponent(f.country)+'&q='+encodeURIComponent(f.query));if(!valid()||id!==sequence.current)return;if(result.profileId!==owner)throw Error('پاسخ با حساب فعلی سازگار نیست.');setRecord({scope,data:result});setRequest({scope,loading:false,error:''});}
  catch(e){if(valid()&&id===sequence.current)setRequest({scope,loading:false,error:e.message||'دریافت ارتباطات هدف انجام نشد.'});}
 }
 useEffect(()=>{mounted.current=true;const timer=setInterval(()=>loadRef.current(),60000);return()=>{mounted.current=false;sequence.current++;clearInterval(timer);};},[]);
 useEffect(()=>{setRecord(null);setProgress(null);setRequest({scope,loading:true,error:''});const timer=setTimeout(load,200);return()=>{sequence.current++;clearTimeout(timer);};},[owner,f.country,f.query]);
 const permitted=item=>owner==='amir'||(item.country!=='IT'&&item.profileScope!=='amir');
 const loadRef=useRef(load);loadRef.current=load;
 const candidates=useMemo(()=>array(data?.targets).filter(permitted).filter(item=>(f.country==='all'||item.country===f.country)&&includesGoal(item,f.goal)&&(!f.query||[item.organization,item.title].filter(Boolean).join(' ').toLowerCase().includes(f.query.toLowerCase()))),[data,owner,f.goal,f.country,f.query]);
 const saved=useMemo(()=>array(data?.savedTargets).map(row=>({...row.snapshot,saved:row})).filter(permitted).filter(item=>(f.country==='all'||item.country===f.country)&&includesGoal(item,f.goal)&&(!f.query||[item.organization,item.title,item.saved?.notes].filter(Boolean).join(' ').toLowerCase().includes(f.query.toLowerCase()))),[data,owner,f.country,f.goal,f.query]);
 const items=rankNetworkTargets(f.view==='saved'?saved:candidates,{focus:f.focus});
 const followUps=saved.filter(item=>targetFollowUpDue(item));
 async function copyIntroduction(key,value){try{await navigator.clipboard.writeText(value);if(valid())notify('متن معرفی کپی شد؛ در LinkedIn خودتان بازبینی و ارسال کنید.');}catch{if(valid())editField('errors',key,'کپی خودکار انجام نشد؛ متن را از کادر انتخاب و کپی کنید.');}}
 async function mutate(key,path,payload){
  editField('busy',key,true);editField('errors',key,'');
  try{await api('linkedin/targets/'+path+'?profile='+encodeURIComponent(owner),{method:'POST',body:JSON.stringify(payload)});if(!valid())return;notify(path==='save'?'این فرصت فقط در پیگیری‌های خصوصی شما ذخیره شد؛ پیامی ارسال نشد.':'وضعیت خصوصی این پیگیری ذخیره شد؛ اقدام بیرونی انجام نشد.');await loadRef.current();}
  catch(e){if(valid())editField('errors',key,e.message||'ذخیره انجام نشد.');}
  finally{if(valid())editField('busy',key,false);}
 }
 return <section className="panel" dir="rtl" aria-label="پیشنهادهای خودکار ارتباطات هدف از منابع عمومی"><div className="section-head"><div><span className="eyebrow">PUBLIC-SOURCE NETWORKING TARGETS</span><h3><Users size={19} aria-hidden="true"/> ارتباطات هدف و پیگیری فرصت‌ها</h3></div><button type="button" className="secondary" disabled={state.loading} onClick={load}><RefreshCw size={15} aria-hidden="true"/>{state.loading?'در حال دریافت…':'تازه‌سازی پیشنهادها'}</button></div>
  <p className="notice">پیشنهادها خودکار از فرصت‌های عمومیِ ذخیره‌شده ساخته می‌شوند. این فهرست، کانکشن‌های LinkedIn شما نیست؛ شخص، سوپروایزر یا ارتباط موجود را تأیید نمی‌کند. ذخیره و تغییر وضعیت، دعوت یا پیام ارسال نمی‌کند.</p>
  <div className="linkedin-action-plan"><div><strong>برنامهٔ ارتباطات این هفته</strong><p className="section-help">اولویت با پیگیری‌های ثبت‌شده و فرصت‌های مرتبط‌تر است؛ متن معرفی آماده می‌شود و ارسال در LinkedIn با خود شماست.</p></div><button type="button" className="secondary" onClick={()=>setFilters({...f,view:'saved',focus:'follow_up'})}><Clock size={15}/>پیگیری‌های آماده: {followUps.length.toLocaleString(interfaceLocale('fa-IR'))}</button></div>
  <div style={{display:'flex',flexWrap:'wrap',gap:'.7rem',alignItems:'end',marginBlock:'1rem'}}>
   <label style={{flex:'1 1 14rem'}}><Search size={14} aria-hidden="true"/> جست‌وجوی مجموعه یا فرصت<input aria-label="جست‌وجوی ارتباطات هدف" value={f.query} maxLength={200} onChange={e=>updateFilter('query',e.target.value)} placeholder="نام مرکز یا موضوع فرصت"/></label>
   <label style={{flex:'1 1 9rem'}}>کشور<select aria-label="کشور ارتباطات هدف" value={f.country} onChange={e=>updateFilter('country',e.target.value)}><option value="all">همهٔ کشورهای مجاز</option><option value="AU">استرالیا</option>{owner==='amir'&&<option value="IT">ایتالیا</option>}</select></label>
   <label style={{flex:'1 1 10rem'}}><Filter size={14} aria-hidden="true"/> هدف<select aria-label="هدف ارتباط" value={f.goal} onChange={e=>updateFilter('goal',e.target.value)}><option value="all">همهٔ هدف‌ها</option>{Object.entries(goals).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label style={{flex:'1 1 11rem'}}>نمایش<select aria-label="نمایش پیشنهاد یا پیگیری" value={f.view} onChange={e=>updateFilter('view',e.target.value)}><option value="suggested">پیشنهادهای منابع عمومی</option><option value="saved">پیگیری‌های خصوصی من</option></select></label>
  </div>
  <label className="linkedin-action-focus">اولویت اقدام<select aria-label="اولویت اقدام در ارتباطات" value={f.focus} onChange={e=>updateFilter('focus',e.target.value)}><option value="all">همه؛ پیگیری‌ها و مرتبط‌ترین‌ها اول</option><option value="actionable">فقط فرصت‌های قابل اقدام و پیگیری‌های آماده</option><option value="follow_up">فقط پیگیری‌های آماده</option></select></label>
  <p className="section-help">یادآوری پیگیری پس از هفت روز از آخرین ثبت «تماس» یا با انتخاب وضعیت «پیگیری» ظاهر می‌شود. به‌معنی ارسال یا دریافت پاسخ نیست.</p>
  {state.error&&<p className="notice" role="alert"><MixedText>{state.error}</MixedText></p>}
  {data&&<p className="muted">{items.length.toLocaleString(interfaceLocale('fa-IR'))} نتیجه در این نمایش · بررسی تا {Number(data.coverage?.candidateLimit||300).toLocaleString(interfaceLocale('fa-IR'))} انتشار و حداکثر {Number(data.coverage?.organizationLimit||50).toLocaleString(interfaceLocale('fa-IR'))} مجموعه؛ پوشش همهٔ بازار کار ادعا نمی‌شود. اولویت متنی، احراز صلاحیت یا احتمال پذیرش نیست.</p>}
  {!state.loading&&!state.error&&!items.length&&<p className="muted">در این فیلتر هدفی ثبت نشده است. فیلتر را تغییر دهید؛ نبود نتیجه به معنی نبود فرصت نیست.</p>}
  <div style={{display:'grid',gap:'.85rem'}}>{items.map((item,index)=>{const own=item.saved,key=own?.id||item.opportunityId||String(index),note=Object.hasOwn(edits.notes,key)?edits.notes[key]:text(own?.notes),selectedGoal=edits.goals[key]||goalFor(item),busy=!!edits.busy[key];return <article key={key} style={{border:'1px solid var(--border,#73809a55)',borderRadius:'.8rem',padding:'1rem',minWidth:0}}><div className="section-head"><div><strong><MixedText>{text(item.organization)||'مجموعهٔ نیازمند بررسی'}</MixedText></strong><small style={{display:'block'}}><MixedText>{[countries[item.country]||item.country,item.state,typeLabels[item.opportunityType]||item.opportunityType].filter(Boolean).join(' · ')}</MixedText></small></div><span className="status">{opportunityStatuses[item.status]||'وضعیت نیازمند بررسی'}</span></div><h4 style={{lineHeight:1.8}}><MixedText>{text(item.title)}</MixedText></h4>
   <p className="muted"><MixedText>{priorities[item.match?.priority]||'پیشنهاد نیازمند بررسی'}</MixedText>{Number(item.organizationHistoryCount)>0&&<> · {Number(item.organizationHistoryCount).toLocaleString(interfaceLocale('fa-IR'))} انتشار در تاریخچهٔ عمومی این مجموعه</>}{item.closingAt&&<> · مهلت ثبت‌شده: {date(item.closingAt)}</>}</p>
   {targetFollowUpDue(item)&&<p className="linkedin-followup-due"><Clock size={14}/>زمان پیگیری رسیده است</p>}
   <div style={{display:'flex',gap:'.6rem',flexWrap:'wrap'}}><SourceLink url={item.url||item.sourceUrl}>بررسی اصل فرصت</SourceLink><SourceLink url={linkedInURL(item.linkedinSearchUrl)}>جست‌وجوی نام مجموعه در LinkedIn؛ هویت تأیید نشده</SourceLink></div>
   {!['closed','future','source_removed'].includes(item.status)&&<details className="linkedin-introduction"><summary>متن معرفی برای LinkedIn</summary><p className="section-help">این پیش‌نویس، سؤال دربارهٔ فرصت و مسئول جذب است؛ نام فرد، رابطهٔ مشترک یا امکان نظارت تأییدشده‌ای ادعا نمی‌کند. پیش از کپی، متن را به لحن خودتان تغییر دهید.</p><textarea dir="ltr" aria-label="متن معرفی قابل ویرایش" rows={5} maxLength={2000} value={Object.hasOwn(edits.drafts,key)?edits.drafts[key]:networkIntroduction(owner,item)} onChange={e=>editField('drafts',key,e.target.value)}/><button type="button" className="secondary" onClick={()=>copyIntroduction(key,Object.hasOwn(edits.drafts,key)?edits.drafts[key]:networkIntroduction(owner,item))}><Copy size={15}/>کپی متن معرفی</button></details>}
   <details style={{marginBlock:'1rem'}}><summary style={{cursor:'pointer'}}>دلیل پیشنهاد و منشأ</summary><ul>{array(item.match?.reasons).map((reason,i)=><li key={i}><MixedText>{text(reason)}</MixedText></li>)}</ul><p className="muted">منبع: <MixedText>{text(item.sourceId)||'ثبت نشده'}</MixedText> · دریافت/انتشار: {date(item.publishedAt)}</p><p className="muted">پیش از ارتباط، نقش واقعی فرد، تناسب سمت، امکان نظارت/پذیرش و مهلت را از منبع اصلی بررسی کنید.</p></details>
   {!own?<div style={{display:'flex',gap:'.65rem',flexWrap:'wrap',alignItems:'center'}}><label>هدف ذخیره<select aria-label={'هدف ذخیره '+text(item.title)} value={selectedGoal} disabled={busy} onChange={e=>editField('goals',key,e.target.value)}>{Object.entries(goals).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><button type="button" className="primary" disabled={busy} onClick={()=>mutate(key,'save',{opportunityId:item.opportunityId,goal:selectedGoal})}><BookmarkPlus size={15} aria-hidden="true"/>{busy?'در حال ذخیره…':'ذخیره در پیگیری‌های من'}</button></div>:<div><p className="muted">هدف ثبت‌شده: {goals[own.goal]||'نیازمند بررسی'} · آخرین تغییر: {date(own.updatedAt)}</p><label>وضعیت خصوصی<select aria-label={'وضعیت پیگیری '+text(item.title)} value={own.status} disabled={busy} onChange={e=>mutate(key,encodeURIComponent(own.id),{status:e.target.value,notes:note})}>{Object.entries(statuses).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label style={{display:'block',marginTop:'.7rem'}}>یادداشت خصوصی<textarea aria-label={'یادداشت پیگیری '+text(item.title)} rows={2} maxLength={2000} value={note} onChange={e=>editField('notes',key,e.target.value)} style={{width:'100%',resize:'vertical'}}/></label><button type="button" className="text-button" disabled={busy} onClick={()=>mutate(key,encodeURIComponent(own.id),{notes:note})}>{busy?'در حال ذخیره…':'ذخیرهٔ یادداشت'}</button></div>}
   {edits.errors[key]&&<p className="notice" role="alert"><MixedText>{edits.errors[key]}</MixedText></p>}
  </article>;})}</div>
  {array(data?.limitations).length>0&&<details style={{marginTop:'1rem'}}><summary style={{cursor:'pointer'}}>حدود پوشش و خودکارسازی</summary><ul>{data.limitations.map((item,i)=><li key={i}><MixedText>{text(item)}</MixedText></li>)}</ul></details>}
 </section>;
}
