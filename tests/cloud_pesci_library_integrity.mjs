import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
const directory=new URL('../library/pesci/',import.meta.url);
const files=readdirSync(directory).filter(name=>name.endsWith('.json'));
const entries=files.map(file=>({file,data:JSON.parse(readFileSync(new URL(file,directory),'utf8'))}));

test('educational PESCI library has unique stable filenames, safe provenance and explicit review limits',()=>{
 const ids=new Set();assert(entries.length>=9);
 for(const {file,data}of entries){
  assert.equal(data.id+'.json',file);assert(!ids.has(data.id));ids.add(data.id);
  assert(Number.isInteger(data.version)&&data.version>=1);
  assert.equal(data.kind,'original-educational-practice');assert.equal(data.official_exam_item,false);
  assert.equal(data.review_status,'requires-qualified-clinician-review');assert.equal(data.timing.official_timing,false);
  assert(Number.isSafeInteger(data.timing.practice_seconds)&&data.timing.practice_seconds>0);
  assert(data.title&&data.topic&&data.setting&&data.case&&data.disclaimer);
  assert(Array.isArray(data.prompts)&&data.prompts.length>=4&&data.prompts.every(x=>typeof x==='string'&&x.trim()));
  assert(Array.isArray(data.reflection_rubric)&&data.reflection_rubric.length>=4);
  assert(data.source_retrieved_at&&data.format_source.startsWith('https://'));
  if(data.sourceUrls){assert(data.sourceUrls.length>=2);assert(data.sourceUrls.every(u=>new URL(u).protocol==='https:'));}
  assert.equal(data.officialScore,undefined);assert.equal(data.passThreshold,undefined);
 }
});

test('new scenario variants retain specific reviewed sources and do not claim official timing or validated scoring',()=>{
 const expected={
  'PESCI-PRACTICE-PAED-006':'https://www.rch.org.au/clinicalguide/guideline_index/Febrile_child/',
  'PESCI-PRACTICE-ABDO-007':'https://www.rch.org.au/clinicalguide/guideline_index/Abdominal_pain_-_acute/',
  'PESCI-PRACTICE-DM-008':'https://www.racgp.org.au/clinical-resources/clinical-guidelines/key-racgp-guidelines/view-all-racgp-guidelines/management-of-type-2-diabetes',
  'PESCI-PRACTICE-MH-009':'https://www.healthdirect.gov.au/warning-signs-of-suicide'
 };
 for(const [id,source]of Object.entries(expected)){
  const data=entries.find(x=>x.data.id===id)?.data;assert(data,'Missing '+id);
  assert(data.sourceUrls.includes(source));assert(data.source_notes.length>100);
  assert.equal(data.prompts.length,5);assert.equal(data.reflection_rubric.length,5);
  assert.equal(data.timing.official_timing,false);assert(data.disclaimer.includes('unvalidated'));
 }
});
