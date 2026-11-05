import React,{useEffect,useRef,useState} from 'react';
import {Menu,X} from 'lucide-react';
import {UI_TRANSLATIONS} from './ui-translations.mjs';
import './mobile-workspace-nav.css';

function useInterfaceLanguage(){
 const [english,setEnglish]=useState(()=>document.documentElement.lang==='en');
 useEffect(()=>{const update=()=>setEnglish(document.documentElement.lang==='en'),observer=new MutationObserver(update);observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});update();return()=>observer.disconnect();},[]);
 return english;
}
export function MobileWorkspaceNavigation({person,items,tab,onNavigate,tones}){
 const english=useInterfaceLanguage(),[open,setOpen]=useState(false),root=useRef(null),toggle=useRef(null);
 const available=items.filter(([id])=>person==='arash'?id!=='study':id!=='pesci');
 const title=label=>english?(UI_TRANSLATIONS[label]||label):label;
 const groups=[
  [person==='arash'?'کار و آمادگی':'مسیرهای اصلی',person==='arash'?'Work and preparation':'Main pathways',person==='arash'?['overview','opportunities','mail','cv','pesci','roadmap']:['overview','roadmap','study','opportunities','mail','cv']],
  ['رشد حرفه‌ای','Professional development',['linkedin','development']],
  ['اتصال‌ها و ابزارها','Connections and tools',['sources','automation','settings']],
 ];
 function close(focus=false){setOpen(false);if(focus)requestAnimationFrame(()=>toggle.current?.focus());}
 function choose(id){close(open);onNavigate(id);}
 useEffect(()=>setOpen(false),[person,tab]);
 useEffect(()=>{
  if(!open)return;const outside=event=>{if(!root.current?.contains(event.target))close();},escape=event=>{if(event.key==='Escape'){event.preventDefault();close(true);}};
  const media=window.matchMedia('(max-width:760px)'),resize=()=>{if(!media.matches)close();};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);media.addEventListener('change',resize);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);media.removeEventListener('change',resize);};
 },[open]);
 function item([id,label,Icon],short){return <button type="button" key={id} className={(id===tab?'active ':'')+'neon-'+(tones[id]||'cyan')} aria-current={id===tab?'page':undefined} aria-label={title(label)} onClick={()=>choose(id)}><Icon size={18} aria-hidden="true"/><span>{short||title(label)}</span></button>;}
 const menuActive=!['overview','opportunities','mail'].includes(tab),menuId='mobile-sections-'+person;
 return <nav ref={root} className="mobile-workspace-nav" data-no-translate="true" aria-label={english?'Top workspace navigation':'ناوبری بالای پنل'}>
  <div className="mobile-nav-rail">
   {available.filter(([id])=>['overview','opportunities','mail'].includes(id)).map(entry=>item(entry,({overview:english?'Home':'خانه',opportunities:english?'Jobs':'فرصت‌ها',mail:english?'Mail':'مکاتبات'})[entry[0]]))}
   <button ref={toggle} type="button" className={'mobile-nav-toggle neon-'+(tones[tab]||'cyan')+(menuActive?' active':'')} onClick={()=>setOpen(value=>!value)} aria-expanded={open} aria-controls={menuId} aria-label={english?'All sections':'همه بخش‌ها'}>{open?<X size={18} aria-hidden="true"/>:<Menu size={18} aria-hidden="true"/>}<span>{english?'Sections':'بخش‌ها'}</span></button>
  </div>
  {open&&<div id={menuId} className="mobile-nav-drawer" role="region" aria-label={english?'All workspace sections':'همهٔ بخش‌های پنل'}>
   <div className="mobile-nav-current"><span>{english?'Current section':'بخش فعلی'}</span><strong>{title(available.find(([id])=>id===tab)?.[1]||'')}</strong></div>
   {groups.map(([fa,en,ids])=><section className="mobile-nav-group" key={en}><h2>{english?en:fa}</h2><div>{available.filter(([id])=>ids.includes(id)).map(entry=>item(entry))}</div></section>)}
  </div>}
 </nav>;
}
