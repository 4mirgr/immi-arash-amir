import React, {useEffect, useRef, useState} from 'react';
import {Calendar, Download, FileText, RefreshCw, Upload, X} from 'lucide-react';
import {api, apiResponse} from './api';
import {DualCalendar} from './dual-calendar';

const types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain'};
function readable(value){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('fa-IR'):'';}
const errorText=e=>e.message||'درخواست سرویس Google انجام نشد.';

export function CalendarDriveTools({person,notify}){
 const editor=useRef(null),current=useRef(person),generation=useRef(0);current.current=person;
 const [status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[events,setEvents]=useState([]),[partial,setPartial]=useState(false),[checked,setChecked]=useState(''),[files,setFiles]=useState([]),[nextPage,setNextPage]=useState(null),[file,setFile]=useState(null);
 const [auZone,setAuZone]=useState('Australia/Sydney'),[invalidStart,setInvalidStart]=useState(false),[invalidEnd,setInvalidEnd]=useState(false);
 const [title,setTitle]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[description,setDescription]=useState(''),[editing,setEditing]=useState(null);
 const suffix=`?profile=${encodeURIComponent(person)}`;
 const active=key=>status?.connected&&status?.capabilities?.[key];
 async function perform(key,operation){const who=person,epoch=generation.current;setBusy(key);setError('');try{await operation(()=>current.current===who&&generation.current===epoch);}catch(e){if(current.current===who&&generation.current===epoch)setError(errorText(e));}finally{if(current.current===who&&generation.current===epoch)setBusy('');}}
 async function check(){await perform('status',async valid=>{const result=await api('google/status'+suffix);if(valid())setStatus(result);});}
 useEffect(()=>{generation.current++;setStatus(null);setError('');setBusy('');setEvents([]);setFiles([]);setNextPage(null);setPartial(false);setChecked('');setEditing(null);setTitle('');setStart('');setEnd('');setDescription('');setFile(null);check();return()=>{generation.current++;};},[person]);
 async function loadEvents(){await perform('calendar',async valid=>{const result=await api('google/calendar/events'+suffix);if(valid()){setEvents(result.events||[]);setPartial(Boolean(result.partial));setChecked(result.checkedAt||'');}});}
 async function loadFiles(page){await perform('files',async valid=>{const result=await api('google/drive/files'+suffix+(page?'&pageToken='+encodeURIComponent(page):''));if(valid()){setFiles(previous=>page?[...previous,...(result.files||[])]:result.files||[]);setNextPage(result.nextPageToken||null);}});}
 function edit(event){setEditing({id:event.id,etag:event.etag});setTitle(event.title||'');setStart(event.start.dateTime);setEnd(event.end.dateTime);setDescription('');if(editor.current)editor.current.open=true;}
 function clearForm(){setEditing(null);setTitle('');setStart('');setEnd('');setDescription('');}
 async function saveEvent(event){event.preventDefault();if(invalidStart||invalidEnd||!title.trim()||!start||!end||new Date(end)<=new Date(start)){setError('عنوان و زمان شروع و پایان معتبر را وارد کنید.');return;}
  const input={summary:title.trim(),start:{dateTime:new Date(start).toISOString(),timeZone:auZone},end:{dateTime:new Date(end).toISOString(),timeZone:auZone}};
  // Do not erase a provider description that was not included in the event list.
  if(!editing||description.trim())input.description=description;
  await perform('save',async valid=>{await api('google/calendar/events'+(editing?'/'+encodeURIComponent(editing.id):'')+suffix,{method:editing?'PUT':'POST',headers:editing?{'If-Match':editing.etag}:{},body:JSON.stringify(input)});if(valid()){clearForm();notify(editing?'تغییر رویداد در تقویم همین حساب ثبت شد.':'رویداد در تقویم همین حساب ثبت شد؛ دعوت‌نامه‌ای ارسال نشد.');const result=await api('google/calendar/events'+suffix);if(valid()){setEvents(result.events||[]);setPartial(Boolean(result.partial));setChecked(result.checkedAt||'');}}});
 }
 async function download(item){await perform('download',async valid=>{const response=await apiResponse('google/drive/files/'+encodeURIComponent(item.id)+'/download'+suffix);const blob=await response.blob();if(!valid())return;const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=item.name||'google-document';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);});}
 async function upload(){if(!file){setError('یک فایل انتخاب کنید.');return;}const ext=file.name.split('.').pop().toLowerCase(),mime=types[ext];if(!mime||file.size<1||file.size>1000000){setError('فقط PDF، DOCX یا TXT با حجم حداکثر یک میلیون بایت مجاز است.');return;}
  await perform('upload',async valid=>{const data=new Uint8Array(await file.arrayBuffer());let raw='';for(let offset=0;offset<data.length;offset+=8192)raw+=String.fromCharCode(...data.subarray(offset,offset+8192));const result=await api('google/drive/files'+suffix,{method:'POST',body:JSON.stringify({name:file.name,mimeType:mime,base64:btoa(raw)})});if(valid()){setFiles(previous=>[result.file,...previous.filter(v=>v.id!==result.file.id)]);setFile(null);notify('فایل به Drive همین حساب اضافه شد؛ عمومی یا مشترک نشد.');}});
 }
 return <section className="calendar-drive-tools" style={{gridColumn:'1 / -1',minWidth:0}} aria-label="تقویم و مدارک">
 <div className="section-head"><div><h3>تقویم و مدارک</h3><p className="section-help">فضای شخصی {person==='arash'?'آرش':'امیر'}{status?.email&&<> · <span dir="ltr" style={{overflowWrap:'anywhere'}}>{status.email}</span></>}</p></div><button type="button" className="secondary" disabled={Boolean(busy)} onClick={check}><RefreshCw size={15}/> بررسی اتصال</button></div>
 {error&&<div className="notice" role="alert">{error}</div>}
 {!status?.connected&&<p className="section-help">{busy==='status'?'در حال بررسی اتصال Google این حساب…':'برای استفاده، Google همین پروفایل را در بخش اتصال حساب متصل کنید و سپس «بررسی اتصال» را بزنید.'}</p>}
 <details className="workspace-disclosure glass-panel">
 <summary><span className="section-head" style={{margin:0}}><strong><Calendar size={18} aria-hidden="true"/> برنامه‌های من</strong><small>{active('calendar')?'Google Calendar':'نیاز به مجوز تقویم'}</small></span><span className="section-help" style={{display:'block'}}>برنامه‌های ذخیره‌شده در تقویم Google را ببینید و ویرایش کنید.</span></summary>
 <p className="section-help">۳۰ روز آینده نمایش داده می‌شود. با «به‌روزرسانی تقویم»، تغییرهای انجام‌شده در Google هم دریافت می‌شوند.</p>
 {!active('calendar')&&<div className="notice">برای دیدن و تغییر برنامه‌ها، مجوز Calendar همین حساب را هنگام اتصال Google فعال کنید.</div>}
 <button type="button" className="secondary" disabled={!active('calendar')||Boolean(busy)} onClick={loadEvents}><RefreshCw size={15}/>{busy==='calendar'?'در حال دریافت…':'به‌روزرسانی تقویم'}</button>
 {checked&&<p className="section-help">آخرین دریافت: {readable(checked)}{events.length===0&&' · برنامه‌ای در این بازه پیدا نشد.'}</p>}
 {events.map(item=><article className="agent-row" key={item.id} style={{flexWrap:'wrap'}}><div style={{flex:'1 1 180px',minWidth:0,overflowWrap:'anywhere'}}><strong dir="auto">{item.title||'بدون عنوان'}</strong><small style={{display:'block'}}>{item.start?.date?'تمام روز: '+item.start.date:readable(item.start?.dateTime)} — {item.end?.date||readable(item.end?.dateTime)}</small></div>{item.start?.dateTime&&item.etag&&<button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>edit(item)}>ویرایش</button>}</article>)}
 {partial&&<button type="button" className="secondary" disabled={Boolean(busy)} onClick={loadEvents}>دریافت بخش بعدی تقویم</button>}
 </details>
 <details ref={editor} className="workspace-disclosure glass-panel">
 <summary><strong><Calendar size={18} aria-hidden="true"/> {editing?'ویرایش برنامه':'ثبت برنامه'}</strong><span className="section-help" style={{display:'block'}}>زمان دوره، آزمون یا جلسه را در تقویم شخصی ثبت کنید.</span></summary>
 <p className="section-help">پس از زدن دکمهٔ ثبت، برنامه در Google Calendar همین حساب ذخیره می‌شود؛ مهمان یا دعوت‌نامه ندارد.</p>
 {!active('calendar')&&<div className="notice">ابتدا Google همین پروفایل را با مجوز Calendar متصل کنید.</div>}
 <form onSubmit={saveEvent}><fieldset disabled={!active('calendar')||Boolean(busy)} style={{border:0,padding:0,margin:0,minWidth:0}}>
 <label htmlFor={'course-title-'+person}>عنوان برنامه</label><input id={'course-title-'+person} required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/>
 <div className="two-col"><div><p className="section-help">شروع برنامه</p><DualCalendar value={start||null} onChange={value=>setStart(value||'')} timezone={auZone} onTimezoneChange={setAuZone} onValidityChange={setInvalidStart}/></div><div><p className="section-help">پایان برنامه</p><DualCalendar value={end||null} onChange={value=>setEnd(value||'')} timezone={auZone} onTimezoneChange={setAuZone} onValidityChange={setInvalidEnd}/></div></div>
 <label htmlFor={'course-description-'+person}>{editing?'توضیح جدید، در صورت نیاز':'توضیح اختیاری'}</label><textarea id={'course-description-'+person} rows={2} maxLength={10000} value={description} onChange={e=>setDescription(e.target.value)}/><div className="form-actions"><button className="primary" type="submit">{busy==='save'?'در حال ثبت…':editing?'ذخیرهٔ تغییرات':'ثبت در تقویم'}</button>{editing&&<button className="secondary" type="button" onClick={clearForm}><X size={14}/> لغو ویرایش</button>}</div>
 </fieldset><p className="section-help">اگر برنامه هم‌زمان در Google تغییر کرده باشد، ابتدا تقویم را به‌روزرسانی و دوباره ویرایش کنید.</p></form>
 </details>
 <details className="workspace-disclosure glass-panel">
 <summary><strong><FileText size={18} aria-hidden="true"/> مدارک من</strong><span className="section-help" style={{display:'block'}}>مدارک را در Drive همین حساب بارگذاری یا دانلود کنید.</span></summary>
 <p className="section-help">فقط فایل‌های مجاز برای این برنامه نمایش داده می‌شوند، نه تمام Drive. دانلود تا ۲ مگابایت و بارگذاری PDF، DOCX یا TXT تا یک مگابایت امکان‌پذیر است.</p>
 {!active('drive')&&<div className="notice">برای استفاده از مدارک، مجوز Drive همین حساب را هنگام اتصال Google فعال کنید.</div>}
 <button type="button" className="secondary" disabled={!active('drive')||Boolean(busy)} onClick={()=>loadFiles()}><RefreshCw size={15}/>{busy==='files'?'در حال دریافت…':'دریافت فایل‌های Drive'}</button>
 {files.map(item=><article className="agent-row" key={item.id} style={{flexWrap:'wrap'}}><div style={{flex:'1 1 180px',minWidth:0,overflowWrap:'anywhere'}}><strong dir="auto">{item.name||'بدون نام'}</strong><small style={{display:'block'}}>{item.size?Math.ceil(item.size/1000)+' KB':''} {item.modifiedTime?readable(item.modifiedTime):''}</small></div><button type="button" className="secondary" disabled={Boolean(busy)} onClick={()=>download(item)}><Download size={15}/> دانلود</button></article>)}
 {nextPage&&<button className="secondary" disabled={Boolean(busy)} type="button" onClick={()=>loadFiles(nextPage)}>فایل‌های بیشتر</button>}
 <label htmlFor={'drive-upload-'+person}>انتخاب مدرک برای بارگذاری</label><input id={'drive-upload-'+person} type="file" accept=".pdf,.docx,.txt" onChange={e=>setFile(e.target.files?.[0]||null)} disabled={!active('drive')||Boolean(busy)}/><button type="button" className="primary" disabled={!active('drive')||Boolean(busy)||!file} onClick={upload}><Upload size={15}/>{busy==='upload'?'در حال بارگذاری…':'بارگذاری مدرک'}</button><p className="section-help">فایل عمومی نمی‌شود و خودکار به رزومه یا ایمیل پیوست نخواهد شد.</p>
 </details></section>;
}
