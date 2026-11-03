import React, {useLayoutEffect, useState} from 'react';
import {Moon, Sun} from 'lucide-react';
const ownerKey=id=>['amir','arash'].includes(id)?`masir:theme:v1:${id}`:null;
function readTheme(key){if(!key)return 'dark';try{return localStorage.getItem(key)==='light'?'light':'dark';}catch{return 'dark';}}
export function ThemeControl({personId}){
 const key=ownerKey(personId),[value,setValue]=useState(()=>({key,theme:readTheme(key)}));
 const theme=value.key===key?value.theme:readTheme(key);
 useLayoutEffect(()=>{setValue({key,theme:readTheme(key)});const sync=e=>{if(e.key===key||e.key===null)setValue({key,theme:readTheme(key)});};window.addEventListener('storage',sync);return()=>{window.removeEventListener('storage',sync);document.documentElement.removeAttribute('data-theme');};},[key]);
 useLayoutEffect(()=>{if(key)document.documentElement.dataset.theme=theme;else document.documentElement.removeAttribute('data-theme');},[key,theme]);
 function toggle(){const next=theme==='light'?'dark':'light';setValue({key,theme:next});try{localStorage.setItem(key,next);}catch{}}
 if(!key)return null;
 return <button type="button" className="icon theme-control" onClick={toggle} aria-pressed={theme==='light'} aria-label={theme==='dark'?'تغییر به حالت روشن':'تغییر به حالت تیره'} title={theme==='dark'?'حالت روشن':'حالت تیره'}>{theme==='dark'?<Sun size={18} aria-hidden="true"/>:<Moon size={18} aria-hidden="true"/>}</button>;
}
