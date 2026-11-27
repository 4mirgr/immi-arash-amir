import {interfaceLocale} from './interface-locale.mjs';
import React,{useMemo,useState} from 'react';
import {Search,ExternalLink,Copy,MapPin} from 'lucide-react';
import {MixedText} from './mixed-text';

const STATES=[['NSW','نیو ساوت ولز','New South Wales'],['VIC','ویکتوریا','Victoria'],['QLD','کوئینزلند','Queensland'],['WA','استرالیای غربی','Western Australia'],['SA','استرالیای جنوبی','South Australia'],['TAS','تاسمانی','Tasmania'],['NT','قلمرو شمالی','Northern Territory'],['ACT','قلمرو پایتخت','Australian Capital Territory Canberra']];
const CHANNELS={workforce:'شبکهٔ نیروی سلامت',clinic:'کلینیک و مرکز محلی',social:'شبکهٔ اجتماعی عمومی',government:'دولتی و رسمی'};
const TARGETS=[['jobs','آگهی استخدام'],['clinics','کلینیک‌های محلی'],['supervisors','سوپروایزر و آموزش GP'],['linkedin_jobs','فرصت‌های کاری LinkedIn'],['linkedin','پست‌های عمومی LinkedIn'],['facebook','پست‌های عمومی Facebook'],['telegram','صفحات عمومی Telegram']];
const text=value=>typeof value==='string'?value:'';
function safeLink(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
const sourceInState=(source,state)=>state==='all'||source.state===state||['AU','ALL','NATIONAL'].includes(source.state)||Array.isArray(source.states)&&source.states.includes(state);
const queryTerms={jobs:'(jobs OR vacancy OR careers)',clinics:'("medical centre" OR "general practice" OR clinic) (careers OR recruitment)',supervisors:'("GP supervisor" OR "clinical supervisor" OR "supervised practice")',linkedin_jobs:'site:linkedin.com/jobs/view',linkedin:'site:linkedin.com/posts',facebook:'site:facebook.com',telegram:'site:t.me'};

// Discovery links only. This component neither scrapes a network nor sends a message.
export function GPDiscovery({sources=[],notify=()=>{}}){
 const [state,setState]=useState('all'),[target,setTarget]=useState('jobs'),[place,setPlace]=useState('');
 const [rural,setRural]=useState(true),[img,setImg]=useState(true),[pesci,setPesci]=useState(false),[supervision,setSupervision]=useState(false),[levelOne,setLevelOne]=useState(false),[visa,setVisa]=useState(false);
 const [channel,setChannel]=useState('all'),[trust,setTrust]=useState('all'),[showAll,setShowAll]=useState(false);
 const query=useMemo(()=>[
  '("general practitioner" OR "GP doctor")',
  state==='all'?'Australia':STATES.find(([id])=>id===state)?.[2]||'Australia',
  place.trim().slice(0,80),rural?'(rural OR regional OR remote)':'',
  img?'(IMG OR "international medical graduate" OR "limited registration")':'',
  pesci?'PESCI':'',supervision?'(supervision OR supervised)':'',levelOne?'("level 1" OR "level one")':'',visa?'("visa sponsorship" OR "employer sponsorship" OR "visa support")':'',queryTerms[target]||queryTerms.jobs,
 ].filter(Boolean).join(' '),[state,target,place,rural,img,pesci,supervision,levelOne,visa]);
 const searchUrl='https://www.google.com/search?'+new URLSearchParams({q:query});
 const linkedinJobs=target==='linkedin_jobs';
 const linkedinState=state==='all'?'':state==='ACT'?'Australian Capital Territory':STATES.find(([id])=>id===state)?.[2]||'';
 const linkedinLocation=[place.trim().slice(0,80),linkedinState,'Australia'].filter(Boolean).join(', ');
 const linkedinKeywords='General Practitioner';
 const linkedinFocusedKeywords=[linkedinKeywords,rural?'(rural OR regional OR remote)':'',img?'(IMG OR "international medical graduate" OR "limited registration")':'',pesci?'PESCI':'',supervision?'(supervision OR supervised)':'',levelOne?'("level 1" OR "level one")':'',visa?'("visa sponsorship" OR "employer sponsorship" OR "visa support")':''].filter(Boolean).join(' ');
 const linkedinUrl=keywords=>'https://www.linkedin.com/jobs/search/?'+new URLSearchParams({keywords,location:linkedinLocation,sortBy:'DD'});

 const filtered=useMemo(()=>(Array.isArray(sources)?sources:[]).filter(source=>safeLink(source.url)&&sourceInState(source,state)&&(channel==='all'||source.channel===channel)&&(trust==='all'||source.trust===trust)),[sources,state,channel,trust]);
 const visible=showAll?filtered:filtered.slice(0,6);
 function filter(setter,value){setter(value);setShowAll(false);}
 async function copy(value,label){try{await navigator.clipboard.writeText(value);notify(label+' کپی شد؛ هیچ پیامی ارسال نشد.');}catch{notify('کپی انجام نشد؛ دسترسی Clipboard مرورگر را بررسی کنید.');}}
 const questions=[
  'I am currently offshore and enquiring about a supervised general practitioner role in Australia as an international medical graduate. Please assess my eligibility from my CV and verified examination records rather than assuming I already hold Australian registration.',
  'Is a current position available at this exact practice, rather than only a candidate register?',
  'Can the practice consider an offshore applicant who has not yet completed PESCI? If so, what is the sequence for interview, a conditional offer, PESCI and an Ahpra application, and which steps can be assessed before travel?',
  'Which Ahpra registration pathway can this specific role support? Is Level 1 supervision available for this position, who is the proposed supervisor, and who will confirm the supervision plan?',
  'Where PESCI is applicable, can you provide the position, practice-site and supervision details required by the relevant provider? I understand that PESCI is context-specific and does not itself constitute employment, registration or visa approval.',
  'Is the employer willing and currently able to sponsor an eligible work visa? Which employing entity and visa pathway are being considered, and what eligibility checks and conditions apply before sponsorship or an offer can proceed?',
  'What conditions would apply to an offshore conditional offer, including PESCI where applicable, Ahpra approval, English evidence, credential checks and visa grant? Are any conditions required before the practice will interview or issue a conditional offer?',
  'Please confirm the exact practice location, current MMM and DPA classification, and the original position description. I understand that rural location, MMM or DPA status alone does not confirm sponsorship or supervision availability.'
 ].join('\n\n');
 return <section className="panel" aria-label="کاوش اختصاصی GP و rural برای آرش" style={{gridColumn:'1 / -1'}}>
  <details open>
   <summary style={{cursor:'pointer'}}><strong><MapPin size={18} style={{verticalAlign:'middle',marginInlineEnd:8}}/>کاوش اختصاصی آرش؛ کلینیک، GP و مناطق rural</strong></summary>
   <p className="muted"><MixedText>این ابزار مسیرهای جست‌وجو در تمام ایالت‌ها و قلمروهای استرالیا را آماده می‌کند. پیوندهای این بخش جست‌وجوی دستی‌اند؛ نتیجهٔ موتور جست‌وجو، آگهی باز، سوپروایزر تأییدشده یا جاب‌آفر قطعی محسوب نمی‌شود.</MixedText></p>
   <div className="inbox-filters" style={{gap:10,flexWrap:'wrap'}}>
    <label>ایالت یا قلمرو<select aria-label="ایالت کاوش GP" value={state} onChange={event=>filter(setState,event.target.value)}><option value="all">تمام استرالیا · ۸ حوزه</option>{STATES.map(([id,label])=><option key={id} value={id}>{label} · {id}</option>)}</select></label>
    <label>محل جست‌وجو<select aria-label="محل کاوش GP" value={target} onChange={event=>setTarget(event.target.value)}>{TARGETS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    <label style={{flex:'1 1 220px'}}>{linkedinJobs?'شهر یا منطقه، اختیاری':'شهر یا نام مرکز، اختیاری'}<input aria-label="شهر یا مرکز برای کاوش GP" value={place} maxLength={80} onChange={event=>setPlace(event.target.value)} placeholder={linkedinJobs?'مثلاً Townsville':'مثلاً Townsville یا نام یک کلینیک'} style={{width:'100%'}}/></label>
   </div>
   <fieldset style={{border:'1px solid var(--border, #314057)',borderRadius:10,padding:12,marginTop:12}}><legend>کلیدواژه‌های جست‌وجو</legend><div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
    <label className="checkline"><input type="checkbox" checked={rural} onChange={event=>setRural(event.target.checked)}/><MixedText>rural / regional / remote</MixedText></label>
    <label className="checkline"><input type="checkbox" checked={img} onChange={event=>setImg(event.target.checked)}/><MixedText>IMG و limited registration</MixedText></label>
    <label className="checkline"><input type="checkbox" checked={pesci} onChange={event=>setPesci(event.target.checked)}/><MixedText>PESCI</MixedText></label>
    <label className="checkline"><input type="checkbox" checked={supervision} onChange={event=>setSupervision(event.target.checked)}/>سوپرویژن</label>
    <label className="checkline"><input type="checkbox" checked={levelOne} onChange={event=>setLevelOne(event.target.checked)}/><span>عبارت Level 1</span></label>
    <label className="checkline"><input type="checkbox" checked={visa} onChange={event=>setVisa(event.target.checked)}/><span>عبارت visa sponsorship</span></label>
   </div><p className="muted" style={{marginBottom:0}}>این گزینه‌ها واژه‌های جست‌وجو را تغییر می‌دهند و هیچ سرنخ ذخیره‌شده‌ای را حذف نمی‌کنند. نبودن عبارت Level 1 یا sponsorship در متن، به‌تنهایی نشانهٔ نامناسب‌بودن مرکز نیست؛ باید از کارفرما پرسید.</p></fieldset>
   {linkedinJobs&&<div className="notice"><p>برای شروع، جست‌وجوی گستردهٔ GP را در محدودهٔ انتخاب‌شده باز کنید. واژه‌های دقیق‌تر در پیوند جداگانه‌اند تا آگهی‌هایی که Level 1 یا sponsorship را صریح ننوشته‌اند از جست‌وجوی اولیه کنار نروند.</p><p><strong>محدودهٔ LinkedIn Jobs:</strong> <bdi dir="ltr">{linkedinLocation}</bdi></p><div className="form-actions" style={{flexWrap:'wrap'}}><a className="primary link" href={linkedinUrl(linkedinKeywords)} target="_blank" rel="noreferrer"><Search size={15}/>جست‌وجوی گسترده در LinkedIn Jobs</a>{linkedinFocusedKeywords!==linkedinKeywords&&<a className="secondary link" href={linkedinUrl(linkedinFocusedKeywords)} target="_blank" rel="noreferrer">LinkedIn Jobs با واژه‌های انتخابی <ExternalLink size={14}/></a>}</div><p className="muted">این پیوند در خود LinkedIn باز می‌شود و ممکن است ورود بخواهد. بازکردن جست‌وجو به معنی اتصال حساب، خواندن همهٔ نتایج یا واردشدن آگهی‌ها به بانک سایت نیست.</p></div>}
   <details style={{marginTop:10}}><summary>عبارت آمادهٔ جست‌وجو</summary><p dir="ltr" style={{overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{query}</p>{linkedinJobs&&<><p>عبارت گستردهٔ LinkedIn Jobs</p><p dir="ltr">{linkedinKeywords}</p><p>عبارت LinkedIn Jobs با واژه‌های انتخابی</p><p dir="ltr" style={{overflowWrap:'anywhere'}}>{linkedinFocusedKeywords}</p></>}</details>
   <div className="form-actions" style={{flexWrap:'wrap',marginTop:12}}><a className="primary link" href={searchUrl} target="_blank" rel="noreferrer"><Search size={15}/>{linkedinJobs?'جست‌وجوی آگهی‌های عمومی LinkedIn در وب':target==='linkedin'?'جست‌وجوی پست‌های عمومی LinkedIn در وب':'بازکردن جست‌وجوی عمومی'}</a><button type="button" className="secondary" onClick={()=>copy(query,'عبارت جست‌وجو')}><Copy size={15}/>کپی عبارت</button><button type="button" className="secondary" onClick={()=>copy(questions,'پرسش‌های بررسی مرکز')}>کپی پرسش‌های بررسی مرکز</button></div>
   <p className="muted"><MixedText>جست‌وجوی شبکه‌های اجتماعی فقط صفحات عمومیِ قابل نمایه‌شدن را پیدا می‌کند؛ ورود، گروه خصوصی و همهٔ پست‌ها پوشش داده نمی‌شوند. محدودبودن نتیجه را با حذف یکی از کلیدواژه‌ها بررسی کنید. rural بودن به معنی MMM، DPA، اسپانسرشیپ یا اجازهٔ PESCI نیست.</MixedText></p>
   <details style={{marginTop:14}}><summary>منابع محلی و مسیرهای کشف ({filtered.length.toLocaleString(interfaceLocale('fa-IR'))})</summary>
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
