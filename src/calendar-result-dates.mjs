import {interfaceLanguage,interfaceLocale} from './interface-locale.mjs';
// Calendar result formatting only: provider timestamps and date-only values are
// never rewritten. All-day Google end dates are exclusive civil dates.
const DAY=86400000;
function civilDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const date=new Date(value+'T12:00:00.000Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:null;
}
function numericDate(date,calendar,numberingSystem,timeZone){
 const parts=new Intl.DateTimeFormat('en',{calendar,numberingSystem,timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const get=name=>parts.find(part=>part.type===name)?.value;
 return [get('year')?.padStart(4,numberingSystem==='arabext'?'۰':'0'),get('month'),get('day')].join('/');
}
function time(date,locale,timeZone){return new Intl.DateTimeFormat(locale,{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);}
export function dualCalendarInstant(value,australiaZone='Australia/Sydney'){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!civilDate(value.slice(0,10)))return null;
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
 try{return {jalali:numericDate(date,'persian',interfaceLanguage()==='en'?'latn':'arabext','Asia/Tehran')+(interfaceLanguage()==='en'?', ':'، ')+time(date,interfaceLocale('fa-IR'),'Asia/Tehran'),gregorian:numericDate(date,'gregory','latn',australiaZone)+', '+time(date,'en-GB',australiaZone),australiaZone};}catch{return null;}
}
export function dualCalendarCivil(value){
 const date=civilDate(value);if(!date)return null;
 return {jalali:numericDate(date,'persian',interfaceLanguage()==='en'?'latn':'arabext','UTC'),gregorian:value.replaceAll('-','/')};
}
export function dualCalendarAllDay(start,endExclusive){
 const first=civilDate(start),end=civilDate(endExclusive);if(!first||!end||end<=first)return null;
 const last=new Date(end.getTime()-DAY).toISOString().slice(0,10);
 return {start:dualCalendarCivil(start),end:dualCalendarCivil(last),singleDay:start===last};
}
