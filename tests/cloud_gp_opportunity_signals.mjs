import test from 'node:test';
import assert from 'node:assert/strict';
import {gpOpportunitySignals as signals} from '../cloud/gp-opportunity-signals.mjs';
test('rural wording and an advertised MMM are separate from actual geographic eligibility',()=>{const a=signals({title:'General Practitioner',fullText:'A regional role. MMM 5-7. Not a DPA location.'});assert(a.generalPracticeTitle);assert(a.ruralWording);assert.deepEqual(a.monashMentioned,[5,6,7]);assert.deepEqual(a.dpaExcerpts,['Not a DPA location.']);assert.equal(a.eligibility,'not_assessed');assert.equal(signals({title:'General Practice Nurse'}).generalPracticeTitle,false);});
test('town names, generic Monash mentions and invalid classifications do not invent codes',()=>{const a=signals({title:'GP',city:'Broome',fullText:'Monash University. MM 8. Category 5. 7 years of practice.'});assert.deepEqual(a.monashMentioned,[]);assert.equal(a.ruralWording,false);assert.deepEqual(a.dpaExcerpts,[]);});
