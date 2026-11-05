import React,{useLayoutEffect,useState} from 'react';
import {translateInterface} from './ui-translations.mjs';
const ownerKey=id=>['amir','arash'].includes(id)?`masir:language:v1:${id}`:null;
function read(key){if(!key)return 'fa';try{return localStorage.getItem(key)==='en'?'en':'fa';}catch{return 'fa';}}
export function LanguageControl({personId}){
 const key=ownerKey(personId),[preference,setPreference]=useState(()=>({key,value:read(key)}));
 const language=preference.key===key?preference.value:read(key);
 useLayoutEffect(()=>{setPreference({key,value:read(key)});const sync=e=>{if(e.key===key||e.key===null)setPreference({key,value:read(key)});};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[key]);
 useLayoutEffect(()=>{
  if(!key)return;const html=document.documentElement,previous={lang:html.getAttribute('lang'),dir:html.getAttribute('dir'),language:html.getAttribute('data-language')};
  html.lang=language;html.dir=language==='en'?'ltr':'rtl';html.dataset.language=language;
  const restore=language==='en'?translateInterface(document.body):()=>{};
  return()=>{restore();for(const [attr,value]of [['lang',previous.lang],['dir',previous.dir],['data-language',previous.language]])if(value===null)html.removeAttribute(attr);else html.setAttribute(attr,value);};
 },[key,language]);
 function toggle(){if(!key)return;const value=language==='en'?'fa':'en';setPreference({key,value});try{localStorage.setItem(key,value);}catch{}}
 if(!key)return null;
 return <button type="button" className="language-control" data-no-translate="true" onClick={toggle} aria-pressed={language==='en'} aria-label={language==='en'?'Switch interface to Persian':'تغییر زبان رابط به انگلیسی'} title={language==='en'?'English interface labels; source documents, mail and private text remain unchanged. Some interface text is not yet translated.':'ترجمهٔ محلی برچسب‌های رابط؛ متن منابع، ایمیل و اطلاعات خصوصی تغییر نمی‌کند. بخشی از رابط هنوز ترجمه نشده است.'}>{language==='en'?'فارسی':'English'}</button>;
}
export function mountLanguageControl(personId){return <LanguageControl personId={personId}/>;}
