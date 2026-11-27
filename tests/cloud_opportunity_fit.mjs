import test from 'node:test';
import assert from 'node:assert/strict';
import {assessOpportunityFit as assess,sortOpportunityPageByFit as sort,deriveProfileReadiness} from '../cloud/opportunity-fit.mjs';
const job=(fullText,extra={})=>({title:'General Practitioner',country:'AU',opportunityType:'job',status:'unknown',url:'https://jobs.example.invalid/gp',fullText,...extra});
test('explicit Level1 and IMG support prioritizes evidence without personal acceptance claims',()=>{const text='Level 1 supervision is available. International medical graduates are welcome. Visa sponsorship is available.';const fit=assess(job(text));assert.equal(fit.priority,'high');assert.equal(fit.signals.level1.status,'supported');assert(fit.positives.some(x=>x.field==='level1'&&x.text==='Level 1 supervision is available.'));assert(fit.unknowns.includes('registration'));assert.equal(fit.eligibility,'not_assessed');assert.equal(fit.currentVacancy,'not_verified');assert.equal(fit.score,undefined);});
test('negative and conditional wording cannot create Level1 support or a fake opportunity',()=>{const no=assess(job('We cannot provide Level 1 supervision. International medical graduates are not eligible. Visa sponsorship is not available.'));assert.equal(no.priority,'restricted');assert.equal(no.signals.level1.status,'restricted');assert(no.restrictions.some(x=>x.text.includes('cannot provide')));const maybe=assess(job('Level 1 supervision may be available subject to assessment. International medical graduates are welcome.'));assert.equal(maybe.priority,'clarification');assert.equal(maybe.signals.level1.status,'not_stated');assert(maybe.unknowns.includes('sponsorship'));});
test('explicit prerequisites remain source constraints; fellowships are never assumed missing',()=>{const fit=assess(job('FRACGP is required. AHPRA general registration is mandatory.'));assert.equal(fit.priority,'restricted');assert(fit.restrictions.some(x=>x.text==='FRACGP is required.'));assert.equal(fit.profileContext,'route_focus_only_no_private_credentials_assessed');assert.equal(assess(job('FRACGP is preferred but not required.')).signals.registration.status,'not_stated');});
test('an employment register, closed record or unrelated role cannot be promoted by positive text',()=>{const text='Level 1 supervision is available. International medical graduates are welcome. Visa sponsorship is available.';assert.equal(assess(job(text,{kind:'employment_register'})).priority,'clarification');assert.equal(assess(job(text,{status:'closed'})).priority,'restricted');assert.equal(assess(job(text,{title:'General Practice Nurse'})).priority,'clarification');assert.equal(assess(job(text,{country:'IT',opportunityType:'scholarship'})).applicable,false);assert.equal(assess(job(text),'amir').applicable,false);});
test('fit sorting is stable and limited to the supplied page',()=>{const rows=[{id:'a',fit:{priority:'clarification'}},{id:'b',fit:{priority:'high'}},{id:'c',fit:{priority:'clarification'}},{id:'d',fit:{priority:'restricted'}}];assert.deepEqual(sort(rows).map(x=>x.id),['b','a','c','d']);assert.deepEqual(rows.map(x=>x.id),['a','b','c','d']);});
test('PESCI level 2 or above is an explicit Level1 route constraint',()=>{const quote='We welcome doctors following the PESCI pathway level 2 or above.';const fit=assess(job(quote));assert.equal(fit.signals.level1.status,'restricted');assert.equal(fit.priority,'restricted');assert.equal(fit.signals.level1.excerpts[0].text,quote);});
test('employer exclusions use the restriction wording rather than a Level 1 keyword match',()=>{
 for(const quote of [
  'We cannot accommodate doctors who require Level 1 supervision.',
  'We are unable to provide Level 1 Supervision at this stage.',
  'We can’t currently accept candidates requiring Level 1–2 supervision.',
  'We do not have any positions for PESCI or Level 1 supervision.',
  'Level 3 or above supervision is available.',
 ]){
  const result=assess(job('Visa sponsorship is available. '+quote));
  assert.equal(result.signals.level1.status,'restricted',quote);
  assert.equal(result.priority,'restricted',quote);
  assert.equal(result.signals.level1.excerpts[0].text,quote);
 }
 assert.notEqual(assess(job('We cannot accommodate doctors who do not require Level 1 supervision.')).signals.level1.status,'restricted');
 assert.equal(assess(job('Our practice has capacity to provide Level 1 supervision.')).signals.level1.status,'supported');
});
test('supervisor hiring and pre-application gates are separate from onboarding requirements',()=>{
 const supervisor=assess(job('The clinic is seeking an experienced General Practitioner with the capacity to provide Level 1 supervision.',{title:'General Practitioner / GP Supervisor'}));
 assert.equal(supervisor.signals.level1.status,'not_stated');assert.equal(supervisor.priority,'restricted');assert.equal(supervisor.roleRelevant,false);
 assert.equal(supervisor.barriers[0].code,'supervisor_hire');
 assert.equal(assess(job('A GP supervisor is available for the successful applicant.')).barriers.length,0);
 for(const clause of [
  'Applicants must have passed PESCI before applying.',
  'We are currently seeking a Level 1 GP candidate who has already sat and successfully passed their PESCI.',
  'We only consider candidates who have already passed PESCI.',
  'Applicants must already be based in Australia.',
 ])assert.equal(assess(job(clause)).barriers.length,1,clause);
 for(const clause of ['Successful applicants must pass PESCI before starting work.','PESCI is required for this supervised role.','You must be based in Australia before commencing.'])assert.equal(assess(job(clause)).barriers.length,0,clause);
});

test('own CV readiness is self-report only and rejects cross-profile or negated MCQ',()=>{
 const pass=deriveProfileReadiness({id:'arash',cvText:'AMC MCQ passed. IELTS completed.'},'arash');assert.equal(pass.amcMcq,'self_reported_pass');assert.equal(pass.language,'self_reported_only');assert.equal(pass.registration,'not_verified');assert.equal(pass.cvText,undefined);
 for(const cvText of ['AMC MCQ not yet passed.','AMC MCQ failed. Preparing for IELTS.','Will pass AMC MCQ next year.'])assert.equal(deriveProfileReadiness({cvText},'arash').amcMcq,'not_stated');
 assert.equal(deriveProfileReadiness({id:'amir',cvText:'AMC MCQ passed.'},'arash').hasCV,false);
 assert.equal(deriveProfileReadiness({cvText:'AMC MCQ passed.',planning:{exams:{amcMcq:{status:'pending'}}}},'arash').amcMcq,'not_stated');
});
