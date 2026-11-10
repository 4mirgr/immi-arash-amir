import test from 'node:test';
import assert from 'node:assert/strict';
import {interfaceLanguage,interfaceLocale} from '../src/interface-locale.mjs';
import {dualCalendarInstant,dualCalendarCivil,dualCalendarAllDay} from '../src/calendar-result-dates.mjs';
function language(value,run){const prior=globalThis.document;globalThis.document={documentElement:{dataset:{language:value}}};try{return run();}finally{if(prior===undefined)delete globalThis.document;else globalThis.document=prior;}}
test('English interface uses Latin numbers and English month names without changing selected calendar',()=>language('en',()=>{
 assert.equal(interfaceLanguage(),'en');assert.equal(interfaceLocale('fa-IR'),'en-GB');assert.equal(interfaceLocale('fa'),'en-GB');assert.equal(interfaceLocale('fa-IR-u-ca-persian'),'en-GB-u-ca-persian');assert.equal(interfaceLocale('en-AU'),'en-AU');
 assert.equal((1234).toLocaleString(interfaceLocale('fa-IR')),'1,234');
 const month=new Intl.DateTimeFormat(interfaceLocale('fa-IR-u-ca-persian'),{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date('2026-11-05T12:00:00Z'));assert(!/[\u0600-\u06ff]/u.test(month));assert(month.includes('1405'));
}));
test('Persian interface retains Persian numbering and Jalali output',()=>language('fa',()=>{
 assert.equal(interfaceLanguage(),'fa');assert.equal(interfaceLocale('fa-IR-u-ca-persian'),'fa-IR-u-ca-persian');assert.equal((1234).toLocaleString(interfaceLocale('fa-IR')),'۱٬۲۳۴');assert.equal(dualCalendarCivil('2026-11-05').jalali,'۱۴۰۵/۰۸/۱۴');
}));
test('English dual-date results keep canonical civil boundaries and the original instant',()=>language('en',()=>{
 const instant='2026-11-05T14:00:00Z';const result=dualCalendarInstant(instant);assert.equal(result.jalali,'1405/08/14, 17:30');assert.equal(result.gregorian,'2026/11/06, 01:00');assert.equal(instant,'2026-11-05T14:00:00Z');
 const allDay=dualCalendarAllDay('2026-11-05','2026-11-06');assert.deepEqual(allDay,{start:{jalali:'1405/08/14',gregorian:'2026/11/05'},end:{jalali:'1405/08/14',gregorian:'2026/11/05'},singleDay:true});assert.equal(dualCalendarCivil('2026-03-21').jalali,'1405/01/01');
}));
