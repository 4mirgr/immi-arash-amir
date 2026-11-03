import React, {useEffect, useId, useState} from 'react';
import {AUSTRALIA_ZONES,calendarMonth,civilParts,dateKey,timeKey,dayAnchor,shiftCalendarMonth,zonedLocalISO} from './calendar-time.mjs';

const zoneAllowed = zone => AUSTRALIA_ZONES.some(([id])=>id===zone);
const weekdays={persian:['ش','ی','د','س','چ','پ','ج'],gregory:['Mon','Tue','Wed','Thu','Fri','Sat','Sun']};
const box={border:'1px solid var(--border, #73809a55)',borderRadius:'.85rem',padding:'1rem',marginBlock:'.8rem',minWidth:0};
export function DualCalendar({value=null,onChange,timezone='Australia/Sydney',onTimezoneChange=()=>{},onValidityChange=()=>{}}) {
  const id=useId(),australiaZone=zoneAllowed(timezone)?timezone:'Australia/Sydney';
  const [mode,setMode]=useState('persian'),[anchor,setAnchor]=useState(()=>dayAnchor(new Date(),'Asia/Tehran'));
  const [selectedDay,setSelectedDay]=useState(''),[clock,setClock]=useState('09:00'),[error,setError]=useState('');
  const activeZone=mode==='persian'?'Asia/Tehran':australiaZone;
  useEffect(()=>{
    let source=new Date(value||Date.now());if(!Number.isFinite(source.getTime()))source=new Date();
    const p=civilParts(source,activeZone);setAnchor(dayAnchor(source,activeZone));setSelectedDay(value?dateKey(p):'');setClock(value?timeKey(p):'09:00');setError('');onValidityChange(false);
  },[value,activeZone]);
  const month=calendarMonth(anchor,mode),title=new Intl.DateTimeFormat(mode==='persian'?'fa-IR-u-ca-persian':'en-AU-u-ca-gregory',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(month.start));
  const dayLabel=new Intl.DateTimeFormat(mode==='persian'?'fa-IR-u-ca-persian':'en-AU',{timeZone:'UTC',dateStyle:'full'});
  function commit(day,time){
    setSelectedDay(day);setClock(time);
    if(!day){setError('');onValidityChange(false);return;}
    try{const iso=zonedLocalISO(day+'T'+time,activeZone);setError('');onValidityChange(false);onChange(iso);}catch(e){setError(e.message||'تاریخ یا ساعت معتبر نیست.');onValidityChange(true);}
  }
  const readable=(zone,locale)=>value?new Intl.DateTimeFormat(locale,{timeZone:zone,dateStyle:'full',timeStyle:'short'}).format(new Date(value)):null;
  return <section style={box} aria-label="تقویم دوگانهٔ زمان‌بندی">
    <div style={{display:'flex',gap:'.5rem',flexWrap:'wrap',marginBottom:'.8rem'}} role="group" aria-label="نوع تقویم">
      <button type="button" className={mode==='persian'?'primary':'secondary'} aria-pressed={mode==='persian'} onClick={()=>setMode('persian')}>هجری شمسی · تهران</button>
      <button type="button" className={mode==='gregory'?'primary':'secondary'} aria-pressed={mode==='gregory'} onClick={()=>setMode('gregory')}>میلادی · استرالیا</button>
    </div>
    <label htmlFor={id+'-zone'}>منطقهٔ زمانی استرالیا</label>
    <select id={id+'-zone'} value={australiaZone} onChange={e=>onTimezoneChange(e.target.value)} style={{width:'100%',marginBottom:'.8rem'}}>{AUSTRALIA_ZONES.map(([zone,label])=><option key={zone} value={zone}>{label}</option>)}</select>
    <div style={{display:'flex',justifyContent:'space-between',gap:'.3rem',alignItems:'center'}}>
      <button type="button" className="secondary" aria-label="ماه قبل" onClick={()=>setAnchor(shiftCalendarMonth(anchor,-1,mode))}>ماه قبل</button>
      <strong dir={mode==='persian'?'rtl':'ltr'}>{title}</strong>
      <button type="button" className="secondary" aria-label="ماه بعد" onClick={()=>setAnchor(shiftCalendarMonth(anchor,1,mode))}>ماه بعد</button>
    </div>
    <div role="group" aria-label={title} dir={mode==='persian'?'rtl':'ltr'} style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:'.25rem',marginBlock:'.7rem'}}>
      {weekdays[mode].map((day,i)=><span key={'weekday-'+i} style={{fontSize:'.8rem',textAlign:'center',paddingBlock:'.35rem'}}>{day}</span>)}
      {Array.from({length:month.offset},(_,i)=><span key={'blank-'+i} aria-hidden="true"/>)}
      {month.days.map(day=><button type="button" key={day.gregorian} className={day.gregorian===selectedDay?'primary':'secondary'} aria-pressed={day.gregorian===selectedDay} aria-label={dayLabel.format(new Date(day.timestamp))} style={{padding:'.4rem .1rem',minWidth:0,minHeight:'2.3rem',fontSize:'1rem'}} onClick={()=>commit(day.gregorian,clock)}>{mode==='persian'?day.calendarDay.toLocaleString('fa-IR'):day.calendarDay}</button>)}
    </div>
    <div style={{display:'flex',gap:'.7rem',alignItems:'center',flexWrap:'wrap'}}>
      <label htmlFor={id+'-clock'}>ساعت به وقت {mode==='persian'?'تهران':'منطقهٔ انتخابی استرالیا'}</label>
      <input id={id+'-clock'} type="time" step="60" value={clock} aria-invalid={!!error} aria-describedby={error?id+'-error':undefined} dir="ltr" style={{width:'9rem'}} onChange={e=>commit(selectedDay,e.target.value)}/>
      <button type="button" className="text-button" onClick={()=>setAnchor(dayAnchor(new Date(),activeZone))}>نمایش ماه امروز</button>
      <button type="button" className="text-button" onClick={()=>{setSelectedDay('');setClock('09:00');setError('');onValidityChange(false);onChange(null);}}>حذف زمان‌بندی</button>
    </div>
    {error&&<p id={id+'-error'} role="alert" className="notice">{error} تا اصلاح زمان، ذخیرهٔ برنامه مسدود است.</p>}
    {value&&!error?<div className="notice" aria-live="polite"><div>تهران · <bdi>{readable('Asia/Tehran','fa-IR-u-ca-persian')}</bdi></div><div>استرالیا · <bdi dir="ltr">{readable(australiaZone,'en-AU-u-ca-gregory')}</bdi></div></div>:!error&&<p className="muted">یک روز را از تقویم انتخاب کنید؛ بدون انتخاب تاریخ، فقط پیش‌نویس ذخیره می‌شود.</p>}
    <p className="muted" style={{fontSize:'.85rem'}}>هر دو نمایش به یک لحظه اشاره می‌کنند. ساعت تابستانی هر شهر خودکار محاسبه می‌شود؛ ساعت‌های مبهم یا حذف‌شده قابل ذخیره نیستند.</p>
  </section>;
}
