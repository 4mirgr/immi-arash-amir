import React,{useLayoutEffect,useState} from 'react';
import {translateInterface} from './ui-translations.mjs';
const publicKey='masir:language:v1:public';
const ownerKey=id=>['amir','arash'].includes(id)?`masir:language:v1:${id}`:publicKey;
function read(key){if(!key)return 'fa';try{return (localStorage.getItem(key)||localStorage.getItem(publicKey))==='en'?'en':'fa';}catch{return 'fa';}}
export function LanguageControl({personId}){
 const key=ownerKey(personId),[preference,setPreference]=useState(()=>({key,value:read(key)}));
 const language=preference.key===key?preference.value:read(key);
 useLayoutEffect(()=>{setPreference({key,value:read(key)});const sync=e=>{if(e.key===key||e.key===null)setPreference({key,value:read(key)});};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[key]);
 useLayoutEffect(()=>{
  if(!key)return;const html=document.documentElement,previous={lang:html.getAttribute('lang'),dir:html.getAttribute('dir'),language:html.getAttribute('data-language')};
  html.lang=language;html.dir=language==='en'?'ltr':'rtl';html.dataset.language=language;
  window.dispatchEvent(new CustomEvent('masir-language-change',{detail:{language}}));
  const restore=language==='en'?translateInterface(document.body):()=>{};
  return()=>{restore();for(const [attr,value]of [['lang',previous.lang],['dir',previous.dir],['data-language',previous.language]])if(value===null)html.removeAttribute(attr);else html.setAttribute(attr,value);};
 },[key,language]);
 function toggle(){if(!key)return;const value=language==='en'?'fa':'en';setPreference({key,value});try{localStorage.setItem(key,value);localStorage.setItem(publicKey,value);}catch{}}
 if(!key)return null;
 return <button type="button" className="language-control" data-no-translate="true" onClick={toggle} aria-pressed={language==='en'} aria-label={language==='en'?'Switch interface to Persian':'تغییر زبان رابط به انگلیسی'} title={language==='en'?'Switch the interface to Persian.':'نمایش رابط به زبان انگلیسی'}>{language==='en'?'Persian':'English'}</button>;
}
export function mountLanguageControl(personId){return <LanguageControl personId={personId}/>;}
