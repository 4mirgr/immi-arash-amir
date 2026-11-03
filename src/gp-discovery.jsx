import React,{useMemo,useState} from 'react';
import {Search,ExternalLink,Copy,MapPin} from 'lucide-react';
import {MixedText} from './mixed-text';

const STATES=[['NSW','نیو ساوت ولز','New South Wales'],['VIC','ویکتوریا','Victoria'],['QLD','کوئینزلند','Queensland'],['WA','استرالیای غربی','Western Australia'],['SA','استرالیای جنوبی','South Australia'],['TAS','تاسمانی','Tasmania'],['NT','قلمرو شمالی','Northern Territory'],['ACT','قلمرو پایتخت','Australian Capital Territory Canberra']];
const CHANNELS={workforce:'شبکهٔ نیروی سلامت',clinic:'کلینیک و مرکز محلی',social:'شبکهٔ اجتماعی عمومی',government:'دولتی و رسمی'};
const TARGETS=[['jobs','آگهی استخدام'],['clinics','کلینیک‌های محلی'],['supervisors','سوپروایزر و آموزش GP'],['linkedin','پست‌های عمومی LinkedIn'],['facebook','پست‌های عمومی Facebook'],['telegram','صفحات عمومی Telegram']];
const text=value=>typeof value==='string'?value:'';
function safeLink(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
const sourceInState=(source,state)=>state==='all'||source.state===state||['AU','ALL','NATIONAL'].includes(source.state)||Array.isArray(source.states)&&source.states.includes(state);
const queryTerms={jobs:'(jobs OR vacancy OR careers)',clinics:'("medical centre" OR "general practice" OR clinic) (careers OR recruitment)',supervisors:'("GP supervisor" OR "clinical supervisor" OR "supervised practice")',linkedin:'site:linkedin.com/posts',facebook:'site:facebook.com',telegram:'site:t.me'};

// Discovery links only. This component neither scrapes a network nor sends a message.
export function GPDiscovery({sources=[],notify=()=>{}}){
 const [state,setState]=useState('all'),[target,setTarget]=useState('jobs'),[place,setPlace]=useState('');
 const [rural,setRural]=useState(true),[img,setImg]=useState(true),[pesci,setPesci]=useState(false),[supervision,setSupervision]=useState(false);
 const [channel,setChannel]=useState('all'),[trust,setTrust]=useState('all'),[showAll,setShowAll]=useState(false);
 const query=useMemo(()=>[
  '("general practitioner" OR "GP doctor")',
  state==='all'?'Australia':STATES.find(([id])=>id===state)?.[2]||'Australia',
  place.trim().slice(0,80),rural?'(rural OR regional OR remote)':'',
  img?'(IMG OR "international medical graduate" OR "limited registration")':'',
  pesci?'PESCI':'',supervision?'(supervision OR supervised)':'',queryTerms[target]||queryTerms.jobs,
 ].filter(Boolean).join(' '),[state,target,place,rural,img,pesci,supervision]);
 const searchUrl='https://www.google.com/search?'+new URLSearchParams({q:query});
 const filtered=useMemo(()=>(Array.isArray(sources)?sources:[]).filter(source=>safeLink(source.url)&&sourceInState(source,state)&&(channel==='all'||source.channel===channel)&&(trust==='all'||source.trust===trust)),[sources,state,channel,trust]);
 const visible=showAll?filtered:filtered.slice(0,6);
 function filter(setter,value){setter(value);setShowAll(false);}
 async function copy(value,label){try{await navigator.clipboard.writeText(value);notify(label+' کپی شد؛ هیچ پیامی ارسال نشد.');}catch{notify('کپی انجام نشد؛ دسترسی Clipboard مرورگر را بررسی کنید.');}}
 const questions=['I am enquiring about a general practitioner position for an international medical graduate.','Could you confirm whether a current vacancy is available, rather than only a candidate register?', 'Which Ahpra registration pathway and level of supervision can this position support?', 'Can this specific position and supervision arrangement support the relevant PESCI process?', 'Is visa sponsorship available, and what conditions must be met before an offer can be made?', 'Please confirm the exact practice location, current MMM and DPA classification, and the original position description.'].join('\n\n');
 return <section className="panel" aria-label="کاوش اختصاصی GP و rural برای آرش" style={{gridColumn:'1 / -1'}}>
  <details open>
   <summary style={{cursor:'pointer'}}><strong><MapPin size={18} style={{verticalAlign:'middle',marginInlineEnd:8}}/>کاوش اختصاصی آرش؛ کلینیک، GP و مناطق rural</strong></summary>
   <p className="muted"><MixedText>این ابزار مسیرهای جست‌وجو در تمام ایالت‌ها و قلمروهای استرالیا را آماده می‌کند. پیوندهای این بخش جست‌وجوی دستی‌اند؛ نتیجهٔ موتور جست‌وجو، آگهی باز، سوپروایزر تأییدشده یا جاب‌آفر قطعی محسوب نمی‌شود.</MixedText></p>
   <div className="inbox-filters" style={{gap:10,flexWrap:'wrap'}}>
    <label>ایالت یا قلمرو<select aria-label="ایالت کاوش GP" value={state} onChange={event=>filter(setState,event.target.value)}><option value="all">تمام استرالیا · ۸ حوزه</option>{STATES.map(([id,label])=><option key={id} value={id}>{label} · {id}</option>)}</select></label>
    <label>محل جست‌وجو<select aria-label="محل کاوش GP" value={target} onChange={event=>setTarget(event.target.value)}>{TARGETS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    <label style={{flex:'1 1 220px'}}>شهر یا نام مرکز، اختیاری<input aria-label="شهر یا مرکز برای کاوش GP" value={place} maxLength={80} onChange={event=>setPlace(event.target.value)} placeholder="مثلاً Townsville یا نام یک کلینیک" style={{width:'100%'}}/></label>
   </div>
   <fieldset style={{border:'1px solid var(--border, #314057)',borderRadius:10,padding:12,marginTop:12}}><legend>کلیدواژه‌های جست‌وجو</legend><div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
    <label className="checkline"><input type="checkbox" checked={rural} onChange={event=>setRural(event.target.checked)}/><MixedText>rural / regional / remote</MixedText></label>
    <label className="checkline"><input type="checkbox" checked={img} onChange={event=>setImg(event.target.checked)}/><MixedText>IMG و limited registration</MixedText></label>
    <label className="checkline"><input type="checkbox" checked={pesci} onChange={event=>setPesci(event.target.checked)}/><MixedText>PESCI</MixedText></label>
    <label className="checkline"><input type="checkbox" checked={supervision} onChange={event=>setSupervision(event.target.checked)}/>سوپرویژن</label>
   </div></fieldset>
   <details style={{marginTop:10}}><summary>عبارت آمادهٔ جست‌وجو</summary><p dir="ltr" style={{overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{query}</p></details>
   <div className="form-actions" style={{flexWrap:'wrap',marginTop:12}}><a className="primary link" href={searchUrl} target="_blank" rel="noreferrer"><Search size={15}/>بازکردن جست‌وجوی عمومی</a><button type="button" className="secondary" onClick={()=>copy(query,'عبارت جست‌وجو')}><Copy size={15}/>کپی عبارت</button><button type="button" className="secondary" onClick={()=>copy(questions,'پرسش‌های بررسی مرکز')}>کپی پرسش‌های بررسی مرکز</button></div>
   <p className="muted"><MixedText>جست‌وجوی شبکه‌های اجتماعی فقط صفحات عمومیِ قابل نمایه‌شدن را پیدا می‌کند؛ ورود، گروه خصوصی و همهٔ پست‌ها پوشش داده نمی‌شوند. محدودبودن نتیجه را با حذف یکی از کلیدواژه‌ها بررسی کنید. rural بودن به معنی MMM، DPA، اسپانسرشیپ یا اجازهٔ PESCI نیست.</MixedText></p>
   <details style={{marginTop:14}}><summary>منابع محلی و مسیرهای کشف ({filtered.length.toLocaleString('fa-IR')})</summary>
    <div className="inbox-filters" style={{gap:10,flexWrap:'wrap',marginTop:12}}><label>نوع منبع<select aria-label="نوع منبع GP" value={channel} onChange={event=>filter(setChannel,event.target.value)}><option value="all">همهٔ مسیرها</option>{Object.entries(CHANNELS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>منشأ<select aria-label="منشأ منبع GP" value={trust} onChange={event=>filter(setTrust,event.target.value)}><option value="all">رسمی و غیررسمی</option><option value="official">رسمی</option><option value="unofficial">غیررسمی؛ نیازمند تأیید</option></select></label></div>
    {!visible.length&&<p className="muted">منبع بررسی‌شده‌ای با این فیلتر در فهرست نیست؛ جست‌وجوی عمومی بالا همچنان قابل استفاده است.</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:12,marginTop:12}}>{visible.map((source,index)=><article className="inbox-message" key={source.id||index} style={{minWidth:0,margin:0}}>
     <h4 style={{marginTop:0,overflowWrap:'anywhere'}}><MixedText>{text(source.name)||'منبع کشف'}</MixedText></h4>
     <p className="muted"><MixedText>{(source.state||'AU')+' · '+(CHANNELS[source.channel]||'مسیر عمومی')}</MixedText></p>
     <p><span className="status amber">پیوند دستی؛ خوراک خودکار نیست</span></p>
     <small>{source.trust==='official'?'منشأ رسمی':'منشأ غیررسمی؛ نیازمند راستی‌آزمایی'} · بازبینی: <bdi dir="ltr">{text(source.reviewedAt)||'ثبت نشده'}</bdi></small>
     {source.coverage&&<p className="muted"><MixedText>{text(source.coverage)}</MixedText></p>}
     {source.limitations&&<p className="muted"><MixedText>{Array.isArray(source.limitations)?source.limitations.filter(v=>typeof v==='string').join(' · '):text(source.limitations)}</MixedText></p>}
     <a className="secondary link" href={safeLink(source.url)} target="_blank" rel="noreferrer">بازکردن منبع <ExternalLink size={14}/></a>
    </article>)}</div>
    {filtered.length>6&&<button type="button" className="text-button" style={{marginTop:12}} onClick={()=>setShowAll(value=>!value)}>{showAll?'نمایش کوتاه':'نمایش همهٔ منابع همین فیلتر'}</button>}
   </details>
  </details>
 </section>;
}
