import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceDeadlineCutoff,evidenceDeadlinePassed,evidenceClosed} from '../cloud/evidence-deadline.mjs';
import {deadlinePassed} from '../cloud/roadmap.mjs';

test('precise deadline expires at its recorded instant, without a phantom extra day',()=>{
 const date='2026-11-12T13:30:00+03:30',cutoff=Date.parse('2026-11-12T10:00:00Z');
 for(const deadline of [date,{date}]){
  const item={deadline};assert.equal(evidenceDeadlineCutoff(item),cutoff);
  assert.equal(evidenceDeadlinePassed(item,cutoff-1),false);assert.equal(evidenceDeadlinePassed(item,cutoff),true);assert.equal(deadlinePassed(item,cutoff+3600000),true);
 }
});
test('date-only source records retain the whole recorded day, distinct from a precise midnight',()=>{
 const day={deadline:{date:'2026-11-12'}},exact={deadline:'2026-11-12T00:00:00Z'};
 assert.equal(evidenceDeadlinePassed(day,Date.parse('2026-11-12T23:59:59Z')),false);
 assert.equal(evidenceDeadlinePassed(day,Date.parse('2026-11-13T00:00:00Z')),true);
 assert.equal(evidenceDeadlinePassed(exact,Date.parse('2026-11-12T00:00:00Z')),true);
});
test('malformed calendar days and timezone-free timestamps stay unknown instead of host-dependent expiry',()=>{
 for(const deadline of ['2026-02-30','2026-02-30T10:00:00Z','2026-13-01','11/12/2026','2026-11-12T10:00:00','2026-11-12T11:80:00Z',null,{},'not a date']){
  assert.equal(evidenceDeadlineCutoff({deadline}),null,String(deadline));assert.equal(evidenceDeadlinePassed({deadline},Date.parse('2027-01-01')),false);
 }
 assert.equal(evidenceDeadlineCutoff({deadline:'2028-02-29'}),Date.parse('2028-03-01T00:00:00Z'));
});
test('explicit closed status wins, while unknown or portal-only dates never establish an open call',()=>{
 const now=Date.parse('2026-11-12T10:00:00Z');
 assert.equal(evidenceClosed({status:'closed'},now),true);assert.equal(evidenceClosed({deadline:{status:'expired'}},now),true);
 assert.equal(evidenceClosed({deadline:{status:'portal',date:null}},now),false);
 assert.equal(evidenceDeadlinePassed({deadline:'2026-11-12T00:00:00Z'},NaN),false);
});
