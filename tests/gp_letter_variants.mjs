import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGpApplicationPackage} from '../cloud/gp-application-package.mjs';
import {prepareMailOpportunityDraft} from '../cloud/mail-opportunities.mjs';
import {applyManualLetterEdit} from '../cloud/gp-letter-edits.mjs';
import {withPublicEmployerEvidence} from './helpers/mail_opportunity_fixture.mjs';

const now=Date.now(),at=new Date(now).toISOString(),cvVersionId='22222222-2222-4222-8222-222222222222';
const openingParagraphs={A:'I am a synthetic applicant interested in a long-term supervised role within a metropolitan network.',B:'I am a synthetic applicant seeking a long-term supervised role within an independent practice.',C:'I am a synthetic applicant seeking a long-term supervised role serving a regional community.'};
const writing={confirmedByOwner:true,writingVersion:'human-four-paragraph-v1',openingParagraph:'This legacy synthetic opening must not replace a configured variant paragraph.',openingParagraphs,closingParagraph:'Please let me know a convenient time to discuss how I can support your practice.',signatureName:'Dr. Synthetic Applicant',signatureEmail:'owner@example.invalid',signaturePhone:'+61 400 000 000',signatureLinkedIn:'https://www.linkedin.com/in/synthetic-owner/'};
const profile={name:'Previous Profile Display Name',planning:{gpApplicationWriting:writing}},cvText='Managed chronic disease consultations and preventive care in general practice.';
const url='https://riverside.example.org/careers/gp';
const samples=[
 {variant:'A',name:'ForHealth Riverside Medical Centre',fact:'Our metropolitan practice is part of the ForHealth network and provides chronic disease consultations and preventive care.'},
 {variant:'B',name:'Riverside Medical Centre',fact:'Our family practice provides chronic disease consultations and preventive care.'},
 {variant:'C',name:'Riverside Rural Medical Centre',fact:'Our rural practice provides chronic disease consultations and preventive care in MMM 5.'},
];
function publicPackage(sample,changes={}){
 const opportunity={id:'opp_'+'a'.repeat(32),title:'General Practitioner',organization:sample.name,url,summary:sample.fact,fullText:sample.fact+'\nApply to careers@riverside.example.org.',kind:'vacancy',status:'open',lastSeenAt:at,...changes};
 return buildGpApplicationPackage({opportunity,profile,cvText,cvVersionId,clinicQuote:sample.fact,cvQuote:cvText,confirmCvQuote:true,now});
}
function mailCandidate(sample){return withPublicEmployerEvidence({gmailId:'synthetic-mail',receivedAt:now-1000,clinicName:sample.name,sourceUrl:url,notificationEligible:true,recipient:'careers@riverside.example.org',fit:{level1:'unknown',sponsorship:'unknown',registration:'unknown'}},{now,officialSourceURL:url,clinicName:sample.name,clinicalFacts:[sample.fact]});}
const context={profile,cvText,cvVersionId};

test('public packages and private Gmail select the same exact confirmed A/B/C opening and own signature',async()=>{
 for(const sample of samples){
  const pkg=publicPackage(sample),mail=await prepareMailOpportunityDraft(mailCandidate(sample),context,{now});
  for(const item of [pkg,mail]){
   assert.equal(item.readyForReview,true,JSON.stringify(item.missingFields||item.missing));assert.equal(item.variant,sample.variant);
   assert.equal(item.paragraphs.opening,openingParagraphs[sample.variant]);assert.equal(item.paragraphs.closing,writing.closingParagraph);
   assert.equal(item.mailEnvelope.practiceName,sample.name);assert.equal(item.mailEnvelope.practiceManager,null);
   assert.equal(item.mailEnvelope.signatureName,writing.signatureName);assert.equal(item.mailEnvelope.signatureEmail,writing.signatureEmail);
   assert.equal(item.mailEnvelope.signaturePhone,writing.signaturePhone);assert.equal(item.mailEnvelope.signatureLinkedIn,writing.signatureLinkedIn);
   assert(item.body.includes('Kind regards,\n'+writing.signatureName));assert(item.body.includes('LinkedIn: '+writing.signatureLinkedIn));
   assert(item.emailBody.includes('I’ve attached my CV and cover letter'));assert(item.emailBody.includes(sample.name));assert(item.emailBody.includes(writing.signatureName));assert(!item.emailBody.includes(item.paragraphs.clinic));
   assert(!item.body.includes(profile.name));assert(!item.body.includes(writing.openingParagraph));assert.equal(item.automaticSending,false);
  }
 }
});

test('Gmail variant and clinic claims cannot come from a private alert or unbound cached field',async()=>{
 const sample=samples[1],candidate=mailCandidate(sample);
 candidate.sourceText='Our rural practice offers work in MMM 5.';
 candidate.location='MMM 5';candidate.practiceManager='Unverified Private Name';
 candidate.clinicalFacts=['Our rural clinic treats 10000 patients and has guaranteed supervision.'];
 const draft=await prepareMailOpportunityDraft(candidate,context,{now});
 assert.equal(draft.variant,'B');assert.equal(draft.paragraphs.opening,openingParagraphs.B);assert.equal(draft.mailEnvelope.practiceManager,null);
 assert(!/10000|guaranteed|Unverified Private Name/.test(draft.body));
 const unverified=await prepareMailOpportunityDraft({...candidate,clinicalFactBasis:'private_email_statement'},context,{now});assert.equal(unverified.readyForReview,false);assert.equal(unverified.body,'');assert.equal(unverified.variant,'B');
});

test('only a current named employer contact can populate the nullable mail addressee',async()=>{
 const sample=samples[1],person={name:'Taylor Example',role:'practice_manager',quote:'Practice Manager: Taylor Example. Contact our recruitment team.',sourceURL:url,sourceRelation:'same_page',method:'visible_role_label',readAt:at};
 const pkg=publicPackage(sample,{practiceManager:'Unverified Import Name',enrichment:{people:[person]}});
 assert.equal(pkg.mailEnvelope.practiceManager,person.name);assert(pkg.body.startsWith('Dear '+person.name+','));
 assert.equal(publicPackage(sample,{practiceManager:'Unverified Import Name',fullText:sample.fact+'\nPractice Manager: Unverified Import Name. Apply to careers@riverside.example.org.'}).mailEnvelope.practiceManager,null);
 assert.equal(publicPackage(sample,{enrichment:{people:[{...person,sourceURL:'https://another.example.org/team'}]}}).mailEnvelope.practiceManager,null);
 const candidate=mailCandidate(sample);candidate.research.people=[person];
 assert.equal((await prepareMailOpportunityDraft(candidate,context,{now})).mailEnvelope.practiceManager,person.name);
 const ambiguous=structuredClone(candidate);ambiguous.research.people.push({...person,name:'Alex Example'});assert.equal((await prepareMailOpportunityDraft(ambiguous,context,{now})).mailEnvelope.practiceManager,null);
 for(const change of [{sourceURL:'https://another.example.org/team'},{readAt:new Date(now-8*86400000).toISOString()},{readAt:new Date(now+120000).toISOString()},{quote:'Contact our practice manager.'}]){
  const data=structuredClone(candidate);data.research.people=[{...person,...change}];assert.equal((await prepareMailOpportunityDraft(data,context,{now})).mailEnvelope.practiceManager,null);
 }
 const failed=structuredClone(candidate);failed.research.sourcePages.push({sourceURL:url,status:'robots_blocked',readAt:new Date(now+1).toISOString()});
 assert.equal((await prepareMailOpportunityDraft(failed,context,{now})).mailEnvelope.practiceManager,null);
});

test('variant selection preserves closure gates and owner per-letter edits retain the fixed opening and signature',async()=>{
 const sample=samples[2],pkg=publicPackage(sample),edited=applyManualLetterEdit(pkg,{clinicParagraph:'I am interested in joining '+sample.name+' to contribute to the clinical priorities described in your practice information.',valueParagraph:'I would bring my stated general practice experience to your team and work within the agreed supervision plan.',subjectIndex:0,subject:'A personally reviewed synthetic enquiry'});
 assert.equal(edited.paragraphs.opening,openingParagraphs.C);assert.equal(edited.paragraphs.closing,writing.closingParagraph);assert.deepEqual(edited.mailEnvelope,pkg.mailEnvelope);
 assert(edited.body.includes(edited.paragraphs.clinic));assert(edited.body.includes(edited.paragraphs.value));assert(edited.body.endsWith('LinkedIn: '+writing.signatureLinkedIn));
 assert.equal(publicPackage(sample,{status:'closed'}).readyForReview,false);
 assert.equal(publicPackage(sample,{status:'closed'}).emailBody,null);
 const candidate=mailCandidate(sample);candidate.publicationClosed=true;assert.equal((await prepareMailOpportunityDraft(candidate,context,{now})).readyForReview,false);
 assert.equal((await prepareMailOpportunityDraft(candidate,context,{now})).emailBody,null);
});

test('early short-email previews tolerate a typed invalid envelope without weakening send readiness',async()=>{
 const sample=samples[1],long={...sample,name:'Synthetic '+('Clinical '.repeat(28))+'Medical Centre'};
 const pkg=publicPackage(long);assert.equal(pkg.emailBody,null);assert(pkg.body.includes('Synthetic'));
 const absent=buildGpApplicationPackage({opportunity:{title:'General Practitioner',organization:sample.name,url,lastSeenAt:at},profile:{},now});assert.equal(absent.emailBody,null);
 const candidate=mailCandidate(long),draft=await prepareMailOpportunityDraft(candidate,context,{now});assert.equal(draft.emailBody,null);
});
