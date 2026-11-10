import {useEffect,useState} from 'react';

// Display locale only. Dates sent to providers, input values and saved records
// remain canonical; choosing English never changes a calendar or time zone.
export function interfaceLanguage(){
 const html=globalThis.document?.documentElement;
 return (html?.dataset?.language||html?.getAttribute?.('lang')||html?.lang)==='en'?'en':'fa';
}
export function interfaceLocale(original='fa-IR'){
 if(interfaceLanguage()!=='en'||typeof original!=='string'||!/^fa(?:-|$)/i.test(original))return original;
 return 'en-GB'+original.replace(/^fa(?:-IR)?/i,'');
}
export function useInterfaceLanguage(){
 const [language,setLanguage]=useState(interfaceLanguage);
 useEffect(()=>{
  const sync=()=>setLanguage(interfaceLanguage());
  globalThis.window?.addEventListener('masir-language-change',sync);sync();
  return()=>globalThis.window?.removeEventListener('masir-language-change',sync);
 },[]);
 return language;
}
