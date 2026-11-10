import {interfaceLocale} from './interface-locale.mjs';
import React from 'react';
import {ArrowLeft,BriefcaseBusiness,GraduationCap,Mail,FileText,ChevronDown,ChevronLeft,ShieldCheck,Activity} from 'lucide-react';

export const ARASH_TONES={overview:'green',opportunities:'green',mail:'cyan',cv:'amber',pesci:'violet',linkedin:'cyan',roadmap:'amber',development:'violet',sources:'cyan',automation:'amber',settings:'cyan'};
export function WorkspaceFold({enabled=true,title,hint,tone='cyan',children}){
 if(!enabled)return <>{children}</>;
 return <details className={'arash-fold neon-'+tone}><summary><span className="neon-marker"/><span><strong>{title}</strong>{hint&&<small>{hint}</small>}</span><ChevronDown size={18} className="fold-chevron"/></summary><div className="fold-content">{children}</div></details>;
}
export function ArashNavigation({items,tab,onNavigate}){
 const item=([id,title,Icon])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>onNavigate(id)} className={(tab===id?'active ':'')+'neon-'+ARASH_TONES[id]}><Icon size={19}/><span>{title}</span>{tab===id&&<span className="nav-current-dot"/>}</button>;
 return <nav className="arash-navigation" aria-label="منوی پنل آرش">
  <span className="nav-caption">کارهای اصلی</span>
  {items.filter(([id])=>['overview','opportunities','mail','cv','pesci'].includes(id)).map(item)}
  <details className="nav-fold neon-cyan" open={['linkedin','roadmap','development'].includes(tab)||undefined}><summary><span className="neon-marker"/>رشد حرفه‌ای و برنامه<ChevronDown size={15}/></summary>{items.filter(([id])=>['linkedin','roadmap','development'].includes(id)).map(item)}</details>
  <details className="nav-fold neon-amber" open={['sources','automation','settings'].includes(tab)||undefined}><summary><span className="neon-marker"/>منابع، اتصال‌ها و ابزارها<ChevronDown size={15}/></summary>{items.filter(([id])=>['sources','automation','settings'].includes(id)).map(item)}</details>
 </nav>;
}
export function ArashHome({onNavigate,online,googleConnected,leadCount,draftCount,hasCV}){
 return <div className="arash-home">
  <div className="arash-start glass-panel"><div><span className="eyebrow">دو مسیر اصلی شما</span><h2>امروز از کجا شروع کنیم؟</h2><p>اول فرصت مناسب را پیدا کنید؛ رزومه، مکاتبه و تمرین در دسترس شماست.</p></div><span className="home-identity"><ShieldCheck size={17}/> فضای شخصی دکتر انتظار</span></div>
  <div className="arash-route-grid">
   <button className="arash-route glass-panel neon-green" onClick={()=>onNavigate('opportunities')}><span className="route-top"><BriefcaseBusiness size={25}/><span>مسیر کاری</span></span><strong>پیداکردن فرصت شغلی</strong><p>آگهی‌های استرالیا، فیلتر ایالت و مناطق rural، شرایط ثبت و سوپرویژن</p><span className="route-action">دیدن فرصت‌های کاری <ArrowLeft size={18}/></span></button>
   <button className="arash-route glass-panel neon-violet" onClick={()=>onNavigate('pesci')}><span className="route-top"><GraduationCap size={25}/><span>آمادگی حرفه‌ای</span></span><strong>تمرین و آمادگی PESCI</strong><p>انتخاب کیس، تمرین زمان‌دار، خواندن انگلیسی و خودبازبینی پاسخ</p><span className="route-action">شروع تمرین بالینی <ArrowLeft size={18}/></span></button>
  </div>
  <div className="arash-workflow"><span className="nav-caption">بعد از پیدا کردن فرصت</span><div className="arash-quick-grid">
   <button className="arash-quick glass-panel neon-amber" onClick={()=>onNavigate('cv')}><FileText size={23}/><span><strong>۱. رزومه را آماده کنید</strong><small>{hasCV?'بررسی نسخه‌ها و دانلود رزومه':'تکمیل اطلاعات و ساخت نسخهٔ رزومه'}</small></span><ChevronLeft size={17}/></button>
   <button className="arash-quick glass-panel neon-cyan" onClick={()=>onNavigate('mail')}><Mail size={23}/><span><strong>۲. مکاتبه و پاسخ‌ها</strong><small>{googleConnected?'Gmail شما متصل است؛ پیام‌های مرتبط را بررسی کنید':'ابتدا Google خودتان را متصل کنید'}</small></span><ChevronLeft size={17}/></button>
   <button className="arash-quick glass-panel neon-green" onClick={()=>onNavigate('roadmap')}><ShieldCheck size={23}/><span><strong>۳. شرایط و قدم بعدی</strong><small>مدارک، مسیر ثبت پزشکی و کارهای لازم</small></span><ChevronLeft size={17}/></button>
  </div></div>
  <WorkspaceFold title="وضعیت داده‌ها و ابزارهای من" hint="وضعیت اتصال و آمار بانک شخصی؛ برای دیدن باز کنید" tone="cyan"><div className="arash-health-grid"><div><Activity size={18}/><strong>{online?'ارتباط با سرور برقرار است':'ارتباط با سرور برقرار نیست'}</strong><small>وضعیت اتصال سایت؛ نشان‌دهندهٔ اجرای جست‌وجو نیست</small></div><div><Mail size={18}/><strong>{googleConnected?'Google همین حساب متصل است':'Google نیاز به اتصال دارد'}</strong><small>{draftCount.toLocaleString(interfaceLocale('fa-IR'))} پیش‌نویس ذخیره‌شده؛ ارسال‌شده محسوب نمی‌شود</small></div><div><BriefcaseBusiness size={18}/><strong>{leadCount.toLocaleString(interfaceLocale('fa-IR'))} سرنخ در بانک مراکز</strong><small>اطلاعات تماس؛ آگهی باز یا جاب‌آفر تأییدشده نیست</small></div></div><button className="text-button" onClick={()=>onNavigate('settings')}>رفتن به اتصال‌ها و تنظیمات <ArrowLeft size={15}/></button></WorkspaceFold>
 </div>;
}
