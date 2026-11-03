import React,{useState} from 'react';
import {LinkedInPanel} from './linkedin-panel';
import {LinkedInInsights} from './linkedin-insights';
import {NetworkTargets} from './network-targets';
const tabs=[['profile','پروفایل و محتوا'],['targets','ارتباطات هدف'],['insights','آمار و دسترسی‌ها']];
export function LinkedInWorkspace({person,notify}){
 const [selected,setSelected]=useState({person,tab:'profile'}),tab=selected.person===person?selected.tab:'profile';
 return <div><div className="panel" style={{marginBottom:'1rem'}}><div role="tablist" aria-label="بخش‌های LinkedIn" style={{display:'flex',gap:'.6rem',flexWrap:'wrap'}}>{tabs.map(([id,title])=><button key={id} type="button" role="tab" aria-selected={tab===id} className={tab===id?'primary':'secondary'} onClick={()=>setSelected({person,tab:id})}>{title}</button>)}</div></div><div role="tabpanel" key={person+':'+tab}>{tab==='profile'?<LinkedInPanel person={person} notify={notify}/>:tab==='targets'?<NetworkTargets person={person} notify={notify}/>:<LinkedInInsights person={person} notify={notify}/>}</div></div>;
}
