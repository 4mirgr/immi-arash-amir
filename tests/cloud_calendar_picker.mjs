import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarMonth,civilParts,dateKey,dayAnchor,shiftCalendarMonth,zonedLocalISO} from '../src/calendar-time.mjs';

test('Nowruz is displayed with actual Persian calendar month boundaries',()=>{
 const month=calendarMonth(Date.UTC(2027,2,21,12),'persian');
 assert.equal(month.year,1406);assert.equal(month.month,1);assert.equal(month.days[0].gregorian,'2027-03-21');assert.equal(month.days.length,31);
 const previous=calendarMonth(shiftCalendarMonth(month.start,-1,'persian'),'persian');
 assert.equal(previous.year,1405);assert.equal(previous.month,12);assert.equal(previous.days.length,29);
 assert.equal(calendarMonth(shiftCalendarMonth(previous.start,1,'persian'),'persian').days[0].gregorian,'2027-03-21');
});
test('Persian leap Esfand and Gregorian leap February are independent',()=>{
 assert.equal(calendarMonth(Date.UTC(2025,2,5,12),'persian').days.length,30);
 assert.equal(calendarMonth(Date.UTC(2024,1,14,12),'gregory').days.length,29);
 assert.equal(calendarMonth(Date.UTC(2025,1,14,12),'gregory').days.length,28);
});
test('Tehran and Australian calendars resolve the same scheduled instant',()=>{
 const iso=zonedLocalISO('2026-11-09T12:00','Asia/Tehran');
 assert.equal(iso,'2026-11-09T08:30:00.000Z');
 const p=civilParts(iso,'Australia/Sydney');assert.equal(p.hour,19);assert.equal(p.minute,30);
 assert.equal(zonedLocalISO('2026-11-09T19:30','Australia/Sydney'),iso);
 const persian=civilParts(iso,'Asia/Tehran','persian');assert.deepEqual([persian.year,persian.month,persian.day],[1405,8,18]);
});
test('DST gaps and repeated hours are rejected instead of silently shifting a post',()=>{
 assert.throws(()=>zonedLocalISO('2026-10-04T02:30','Australia/Sydney'),/وجود ندارد/);
 assert.throws(()=>zonedLocalISO('2027-04-04T02:30','Australia/Sydney'),/دو بار/);
 assert.equal(zonedLocalISO('2026-10-04T03:30','Australia/Sydney'),'2026-10-03T16:30:00.000Z');
 assert.equal(zonedLocalISO('2026-10-04T02:30','Australia/Brisbane'),'2026-10-03T16:30:00.000Z');
});
test('Australian half-hour and no-DST zones keep their real offsets',()=>{
 assert.equal(zonedLocalISO('2026-11-09T12:00','Australia/Adelaide'),'2026-11-09T01:30:00.000Z');
 assert.equal(zonedLocalISO('2026-11-09T12:00','Australia/Darwin'),'2026-11-09T02:30:00.000Z');
 assert.equal(zonedLocalISO('2026-11-09T12:00','Australia/Perth'),'2026-11-09T04:00:00.000Z');
});
test('invalid date/time values and unknown zones never produce a schedule',()=>{
 for(const value of ['2026-02-30T12:00','2026-13-01T12:00','2026-10-01T25:00','2026-10-01T12:60','2026-10-01',''])assert.throws(()=>zonedLocalISO(value,'Asia/Tehran'));
 assert.throws(()=>zonedLocalISO('2026-11-09T12:00','Not/AZone'));
});
test('day view chooses the local calendar date near UTC midnight',()=>{
 const instant='2026-11-03T22:00:00Z';
 assert.equal(dateKey(civilParts(dayAnchor(instant,'Asia/Tehran'),'UTC')),'2026-11-04');
 assert.equal(civilParts(dayAnchor(instant,'Australia/Perth'),'UTC').day,4);
});
