import React,{useEffect,useState} from 'react';
import {AiAssistant} from './ai-assistant';
import {MailAutomation} from './mail-automation';
import {TelegramSettings} from './telegram-settings';
import {OwnerBackup} from './owner-backup';
import {OperationsPanel} from './operations-panel';
const tabs=[['operations','وضعیت و کنترل'],['ai','دستیار AI'],['mail','آماده‌سازی مکاتبات'],['telegram','اعلان تلگرام'],['backup','پشتیبان خصوصی']];
const validTab=value=>tabs.some(([id])=>id===value)?value:'operations';
export function AutomationHub({person,notify,initialTab='operations',onNavigate}){
 const preferred=validTab(initialTab),[view,setView]=useState({person,tab:preferred}),tab=view.person===person?view.tab:preferred;
 useEffect(()=>{setView({person,tab:preferred});},[person,preferred]);
 const openTab=value=>setView({person,tab:validTab(value)});
 return <div><section className="panel glass-panel"><h3>کارهای بعدی همین حساب</h3><p className="section-help">وضعیت رصد را ببینید، متن آماده کنید، اعلان‌ها را وصل کنید یا از اطلاعات شخصی پشتیبان بگیرید.</p><div role="tablist" aria-label="ابزارهای اتوماسیون" style={{display:'flex',gap:'.5rem',flexWrap:'wrap'}}>{tabs.map(([id,label])=><button type="button" role="tab" aria-selected={tab===id} className={id===tab?'primary':'secondary'} key={id} onClick={()=>openTab(id)}>{label}</button>)}</div></section><div role="tabpanel" key={person+':'+tab}>{tab==='operations'?<OperationsPanel person={person} notify={notify}/>:tab==='ai'?<AiAssistant person={person} notify={notify} onOpenTab={openTab}/>:tab==='mail'?<MailAutomation person={person} notify={notify} onNavigate={onNavigate}/>:tab==='telegram'?<TelegramSettings person={person} notify={notify}/>:<OwnerBackup person={person} notify={notify}/>}</div></div>;
}
