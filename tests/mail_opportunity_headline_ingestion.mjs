import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMailOpportunityCandidates} from '../cloud/mail-opportunities.mjs';

function digest(links,plainBody){return {id:'synthetic-digest',threadId:'synthetic-thread',direction:'received',labels:['INBOX'],dateTimestamp:Date.now(),from:'GP Alerts <alerts@medical.example.com.au>',subject:'Your GP job opportunities in Australia',plainBody,links};}
test('separate GP anchor headlines survive opaque newsletter links as private unverified leads',async()=>{
 const first={url:'https://mail.example.org/track/click?token=synthetic-one',label:'General Practitioner Sydney — mixed billing $450K'},second={url:'https://mail.example.org/track/click?token=synthetic-two',label:'General Practitioner Melbourne — teaching practice $350K'};
 const candidates=await extractMailOpportunityCandidates(digest([first,second],first.label+'\nDetails for the first role.\n'+second.label+'\nDetails for the second role.'));
 assert.equal(candidates.length,2);assert.notEqual(candidates[0].key,candidates[1].key);
 assert.equal(candidates[0].publicJobLead.headline,first.label);assert.equal(candidates[1].publicJobLead.headline,second.label);assert.deepEqual(candidates[0].publicJobLead.states,['NSW']);assert.deepEqual(candidates[1].publicJobLead.states,['VIC']);
 for(const candidate of candidates){assert.equal(candidate.publicJobLead.publicationVerified,false);assert.equal(candidate.clinicName,'');assert(!candidate.recipient);assert.equal(candidate.provenance.publicationVerified,false);assert(!candidate.publicJobLead.headline.includes('Your GP job opportunities'));}
 assert(!candidates[0].sourceText.includes(second.label));assert(!candidates[1].sourceText.includes(first.label));
});
test('repeated generic anchors cannot borrow another listing’s clinic, contact or supervision text',async()=>{
 const links=[{url:'https://mail.example.org/track/one',label:'General Practitioner opportunity'},{url:'https://mail.example.org/track/two',label:'General Practitioner opportunity'}],body='Australia GP vacancies. Harbour Medical Centre provides chronic disease management. Apply to owner@harbour.example.org. Level 1 supervision and employer visa sponsorship are confirmed.';
 const candidates=await extractMailOpportunityCandidates(digest(links,body));assert.equal(candidates.length,2);
 for(const candidate of candidates){assert.equal(candidate.clinicName,'');assert(!candidate.recipient);assert.equal(candidate.fit.level1,'unknown');assert.equal(candidate.fit.sponsorship,'unknown');assert.deepEqual(candidate.clinicalFacts,[]);}
});
test('private or quoted labels do not become public search attributes and non-GP anchors stay excluded',async()=>{
 const privateLabel={url:'https://mail.example.org/jobs/one',label:'General Practitioner personal invitation for Dr Synthetic'},quoted={url:'https://mail.example.org/track/quoted',label:'General Practitioner Sydney — teaching practice',quoted:true},nurse={url:'https://mail.example.org/jobs/nurse',label:'Practice Nurse Melbourne'};
 const candidates=await extractMailOpportunityCandidates(digest([privateLabel,quoted,nurse],'Australia GP job opportunities. '+privateLabel.label));
 assert.equal(candidates.length,1);assert.equal(candidates[0].publicJobLead,null);assert(!candidates.some(candidate=>candidate.sourceUrl===quoted.url||candidate.sourceUrl===nurse.url));
});
test('an explicitly foreign GP anchor is excluded even on a recognized jobs URL',async()=>{
 const foreign={url:'https://recruit.example.org/jobs/uk-gp',label:'General Practitioner Newcastle UK — Old Harbour Medical Centre'};
 const candidates=await extractMailOpportunityCandidates(digest([foreign],'Australian GP job alerts also cover international roles. '+foreign.label+'\nOld Harbour Medical Centre offers a GP position.'));
 assert.deepEqual(candidates,[]);
});
test('a mixed foreign/Australian digest retains only the Australian role without borrowing the excluded clinic’s statements',async()=>{
 const local={url:'https://recruit.example.org/jobs/au-gp',label:'General Practitioner Geelong VIC — Safe Medical Centre'},foreign={url:'https://recruit.example.org/jobs/uk-gp',label:'General Practitioner Newcastle UK — Old Harbour Medical Centre'};
 const body='Australian GP job opportunities.\n'+local.label+'\nSafe Medical Centre provides preventive care.\n'+foreign.label+'\nOld Harbour Medical Centre provides emergency care. Level 1 supervision and visa sponsorship are confirmed. Please email uk@oldharbour.example.org.';
 const candidates=await extractMailOpportunityCandidates(digest([local,foreign],body));assert.equal(candidates.length,1);assert.equal(candidates[0].sourceUrl,local.url);assert.equal(candidates[0].clinicName,'Safe Medical Centre');assert(!candidates[0].sourceText.includes('Old Harbour'));assert(!candidates[0].recipient);assert.equal(candidates[0].fit.level1,'unknown');assert.equal(candidates[0].fit.sponsorship,'unknown');
});
