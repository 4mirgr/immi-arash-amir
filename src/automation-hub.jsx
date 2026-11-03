import React,{useState} from 'react';
import {AiAssistant} from './ai-assistant';
import {MailAutomation} from './mail-automation';
import {TelegramSettings} from './telegram-settings';
import {OwnerBackup} from './owner-backup';
import {OperationsPanel} from './operations-panel';
const tabs=[['operations','وضعیت و کنترل'],['ai','دستیار AI'],['mail','آماده‌سازی مکاتبات'],['telegram','اعلان تلگرام'],['backup','پشتیبان خصوصی']];
export function AutomationHub({person,notify}){const [view,setView]=useState({person,tab:'ai'}),tab=view.person===person?view.tab:'ai';return <div><section className="panel"><h3>ابزارهای خودکار همین حساب</h3><div role="tablist" aria-label="اتوماسیون" style={{display:'flex',gap:'.5rem',flexWrap:'wrap'}}>{tabs.map(([id,label])=><button type="button" role="tab" aria-selected={tab===id} className={id===tab?'primary':'secondary'} key={id} onClick={()=>setView({person,tab:id})}>{label}</button>)}</div></section><div role="tabpanel" key={person+':'+tab}>{tab==='operations'?<OperationsPanel person={person} notify={notify}/>:tab==='ai'?<AiAssistant person={person} notify={notify}/>:tab==='mail'?<MailAutomation person={person} notify={notify}/>:tab==='telegram'?<TelegramSettings person={person} notify={notify}/>:<OwnerBackup person={person} notify={notify}/>}</div></div>;}
