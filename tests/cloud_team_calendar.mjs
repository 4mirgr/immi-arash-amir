import test from 'node:test';
import assert from 'node:assert/strict';
import {teamTaskCalendar} from '../src/team-calendar.mjs';
const task={id:'11111111-1111-4111-8111-111111111111',title:'Synthetic joint review',description:'Public sources only',dueAt:'2026-11-20T10:30:00+03:30'};
test('calendar export uses the selected instant with no invitations or provider identity',()=>{const result=teamTaskCalendar(task,Date.UTC(2026,10,12));assert(result.includes('DTSTART:20261120T070000Z'));assert(result.includes('DTEND:20261120T073000Z'));assert(result.includes('METHOD:PUBLISH'));assert(!result.includes('ATTENDEE'));assert(!result.includes('ORGANIZER'));assert(!result.includes('mailto:'));});
test('untrusted title lines cannot inject calendar properties and UTF-8 lines are bounded',()=>{const result=teamTaskCalendar({...task,title:'بررسی'.repeat(30),description:'Text, semi; slash\\\r\nATTENDEE:evil@example.invalid'});assert(!result.includes('\r\nATTENDEE:'));assert(result.includes('Text\\, semi\\; slash\\\\\\nATTENDEE:'));for(const line of result.split('\r\n'))assert(new TextEncoder().encode(line).length<=75,line);});
test('missing dates or invalid task IDs cannot create calendar exports',()=>{assert.equal(teamTaskCalendar({...task,dueAt:null}),null);assert.equal(teamTaskCalendar({...task,id:'not-a-task'}),null);});
