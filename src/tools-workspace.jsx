import React,{useEffect,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {useInterfaceLanguage} from './interface-locale.mjs';
import './tools-workspace.css';

// Opening a menu is only a view action. Child tools retain their own account,
// consent and request guards, and are first mounted when their menu is opened.
export function openToolSection(id){
 if(typeof window==='undefined'||typeof id!=='string')return;
 window.dispatchEvent(new CustomEvent('masir:open-tool-section',{detail:{id}}));
}

export function ToolsSection({id,title,hint,icon:Icon,children,requestedId,requestSequence=0}){
 const [open,setOpen]=useState(false),[loaded,setLoaded]=useState(false),element=useRef(null);
 function reveal(){setLoaded(true);setOpen(true);}
 useEffect(()=>{
  const requested=event=>{if(event.detail?.id===id){reveal();requestAnimationFrame(()=>element.current?.scrollIntoView({block:'start',behavior:'auto'}));}};
  const hash=()=>{if(globalThis.location?.hash==='#'+id)reveal();};
  hash();window.addEventListener('masir:open-tool-section',requested);window.addEventListener('hashchange',hash);
  return()=>{window.removeEventListener('masir:open-tool-section',requested);window.removeEventListener('hashchange',hash);};
 },[id]);
 useEffect(()=>{if(requestedId===id)reveal();},[id,requestedId,requestSequence]);
 return <details id={id} ref={element} className="tools-section" open={open} onToggle={event=>{if(event.target!==event.currentTarget)return;const expanded=event.currentTarget.open;setOpen(expanded);if(expanded)setLoaded(true);}}>
  <summary><span className="tools-section-icon">{Icon&&<Icon size={20}/>}</span><span className="tools-section-label"><strong>{title}</strong>{hint&&<small>{hint}</small>}</span><ChevronDown size={19} className="tools-section-chevron"/></summary>
  {loaded&&<div className="tools-section-body">{children}</div>}
 </details>;
}

export function ToolsWorkspace({title,hint,children,actions,attention,className=''}){
 const language=useInterfaceLanguage(),t=(fa,en)=>language==='en'?en:fa;
 return <div className={'tools-workspace '+className}>
  <header className="tools-workspace-heading"><div><h3>{title}</h3><p>{hint||t('بخش موردنیازتان را باز کنید؛ جزئیات داخل همان بخش قرار دارد.','Open the section you need; its details stay inside that section.')}</p></div>{actions&&<div className="tools-heading-actions">{actions}</div>}</header>
  {attention}
  <div className="tools-menu-list">{children}</div>
 </div>;
}
