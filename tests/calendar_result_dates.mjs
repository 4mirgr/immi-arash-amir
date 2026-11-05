import test from 'node:test';
import assert from 'node:assert/strict';
import {dualCalendarInstant,dualCalendarCivil,dualCalendarAllDay} from '../src/calendar-result-dates.mjs';
test('server instant gives padded Jalali date and explicit Australian civil day for the same instant',()=>{
 const result=dualCalendarInstant('2026-11-05T12:00:00Z');assert.equal(result.jalali,'۱۴۰۵/۰۸/۱۴، ۱۵:۳۰');assert.equal(result.gregorian,'2026/11/05, 23:00');
 const boundary=dualCalendarInstant('2026-11-05T14:00:00Z');assert.equal(boundary.jalali,'۱۴۰۵/۰۸/۱۴، ۱۷:۳۰');assert.equal(boundary.gregorian,'2026/11/06, 01:00');
 const perth=dualCalendarInstant('2026-11-05T14:00:00Z','Australia/Perth');assert.equal(perth.gregorian,'2026/11/05, 22:00');assert.equal(perth.jalali,boundary.jalali);
});
test('all-day dates keep provider civil day and subtract exclusive Google end once',()=>{
 assert.deepEqual(dualCalendarAllDay('2026-11-05','2026-11-06'),{start:{jalali:'۱۴۰۵/۰۸/۱۴',gregorian:'2026/11/05'},end:{jalali:'۱۴۰۵/۰۸/۱۴',gregorian:'2026/11/05'},singleDay:true});
 const month=dualCalendarAllDay('2026-10-31','2026-11-02');assert.equal(month.end.gregorian,'2026/11/01');assert.equal(month.singleDay,false);
 assert.equal(dualCalendarCivil('2024-02-29').gregorian,'2024/02/29');
});
test('Nowruz and invalid server data do not fabricate dates',()=>{
 assert.equal(dualCalendarCivil('2026-03-21').jalali,'۱۴۰۵/۰۱/۰۱');
 for(const value of [null,'','2026-02-30','2026-11-05T12:00:00','2026-11-05'])assert.equal(dualCalendarInstant(value),null);
 assert.equal(dualCalendarInstant('2026-11-05T12:00:00Z','not-a-zone'),null);
 assert.equal(dualCalendarAllDay('2026-11-05','2026-11-05'),null);assert.equal(dualCalendarAllDay('2026-11-05','2026-02-30'),null);
});
