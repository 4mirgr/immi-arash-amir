import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMailPublicJobLead,isMailGPJobAnchor,publicGPAttributeSearchQuery,publicGPHeadlineMatchesPage,publishedGPEmployerName,isMailTrackingSourceURL} from '../cloud/mail-public-job-headline.mjs';
import {mailEmployerSearchQuery} from '../cloud/mail-lead-search.mjs';

const url='https://email.s.seek.com.au/uni/ss/c/synthetic-opaque-link',headline='General Practitioner — $40K sign-on bonus — Adelaide northern suburbs';
test('opaque GP job anchors create only unverified owner-private headline/location leads',()=>{
 const lead=buildMailPublicJobLead({url,label:headline});assert(lead);assert.equal(isMailGPJobAnchor({url,label:headline}),true);assert.equal(lead.sourceLabelKind,'visible_anchor');assert.equal(lead.publicationVerified,false);assert.deepEqual(lead.states,['SA']);assert.deepEqual(lead.localities,['Adelaide']);assert.equal(isMailTrackingSourceURL(url),true);
});
test('personalized subjects, contact details, non-GP jobs and unsafe destinations cannot become search leads',()=>{
 for(const label of ['The latest General Practitioner Adelaide jobs','Dear Arash, General Practitioner Adelaide opportunity','General Practitioner Adelaide call candidate@example.org','Nurse General Practice Adelaide','General Practitioner Adelaide password'])assert.equal(buildMailPublicJobLead({url,label}),null,label);
 assert.equal(buildMailPublicJobLead({url,label:headline,sourceLabelKind:'message_subject'}),null);assert.equal(buildMailPublicJobLead({url:'https://127.0.0.1/lead',label:headline}),null);assert.equal(buildMailPublicJobLead({url:'https://clinic.example.org/login',label:headline}),null);
});
test('search queries use only fixed role/city/state values and never a label, salary, subject or tracking token',()=>{
 const lead=buildMailPublicJobLead({url,label:headline}),query=publicGPAttributeSearchQuery(lead);assert.equal(query,'general practitioner job Adelaide South Australia Australia');assert(!query.includes('40K'));assert(!query.includes('northern'));assert(!query.includes('synthetic-opaque'));
 assert.equal(mailEmployerSearchQuery({clinicName:'',title:headline,publicJobLead:lead}),query);assert.equal(mailEmployerSearchQuery({clinicName:'',title:'The latest '+headline}),null);
 assert.equal(publicGPAttributeSearchQuery({...lead,states:['PRIVATE_STATE'],localities:['PRIVATE_LOCATION']}),query);assert.equal(publicGPAttributeSearchQuery(buildMailPublicJobLead({url,label:'General Practitioner — named clinical role'})),null);
 for(const label of ['General Practitioner - excellent earnings loyal patients - QLD','General Practitioner - supportive team varied caseload - Western Australia']){const typed=buildMailPublicJobLead({url,label}),safeQuery=mailEmployerSearchQuery({clinicName:'',title:label,publicJobLead:typed});assert(safeQuery==='general practitioner job Queensland Australia'||safeQuery==='general practitioner job Western Australia Australia');assert(!/earnings|loyal|supportive|caseload/i.test(safeQuery));}
 for(const malformed of [{...lead,headline:'General Practitioner - Newcastle UK - coastal clinic 20k bonus'},{...lead,version:999},'invalid typed headline',null])assert.equal(mailEmployerSearchQuery({clinicName:'',title:'General Practitioner - PRIVATE TITLE QLD',publicJobLead:malformed}),null);
 assert.equal(mailEmployerSearchQuery({clinicName:'',title:'General Practitioner personal invitation for Dr Synthetic',publicJobLead:null}),null);
});
test('a broad GP/city result cannot establish the original ad without its distinctive actual public details',()=>{
 const lead=buildMailPublicJobLead({url,label:headline}),page={status:'read',title:'General Practitioner',text:'A GP position in Adelaide, South Australia northern suburbs with a $40,000 sign-on bonus.'};assert(publicGPHeadlineMatchesPage(lead,page));
 for(const text of ['General Practitioner position in Adelaide.','A GP position in Perth northern suburbs with a $40,000 sign-on bonus.','GP in Adelaide, South Australia southern suburbs; sign-on bonus $10,000.','GP in Adelaide, South Australia northern suburbs; sign-on bonus $10,000.','GP in Adelaide, South Australia southern suburbs; sign-on bonus $40,000.'])assert.equal(publicGPHeadlineMatchesPage(lead,{...page,text}),false,text);
 assert.equal(publicGPHeadlineMatchesPage(lead,{...page,status:'robots_blocked'}),false);assert.equal(publicGPHeadlineMatchesPage(buildMailPublicJobLead({url,label:'General Practitioner Adelaide'}),page),false);
 const hourly=buildMailPublicJobLead({url,label:'General Practitioner - $150 per hour - Adelaide northern suburbs'});assert.equal(publicGPHeadlineMatchesPage(hourly,{...page,text:'GP position in Adelaide South Australia northern suburbs. $100 per hour.'}),false);
});
test('explicit foreign GP ads and ambiguous city-only pages cannot be relabelled as Australian opportunities',()=>{
 for(const label of ['General Practitioner - Newcastle UK - coastal clinic 20k bonus','General Practitioner - New Zealand - northern clinic','GP - Newcastle NSW / UK - coastal clinic'])assert.equal(buildMailPublicJobLead({url,label}),null);
 const lead=buildMailPublicJobLead({url,label:'General Practitioner - Newcastle NSW - coastal clinic 20k bonus'});assert(lead);assert(publicGPHeadlineMatchesPage(lead,{status:'read',title:'General Practitioner coastal clinic',text:'Newcastle NSW Australia GP position. Coastal clinic with 20k bonus.'}));
 for(const text of ['Newcastle UK GP position. Coastal clinic with 20k bonus.','Newcastle GP position. Coastal clinic with 20k bonus.'])assert.equal(publicGPHeadlineMatchesPage(lead,{status:'read',title:'General Practitioner coastal clinic',text}),false);
});
test('an actually read unambiguous JobPosting hiring organization supplies only an employer lookup name',()=>{
 const source='https://jobs.example.org/role/123',page={status:'read',url:source,enrichment:{organizations:[{name:'Synthetic Medical Centre',sourceURL:source,method:'jsonld_jobposting'}]}};assert.equal(publishedGPEmployerName(page),'Synthetic Medical Centre');
 assert.equal(publishedGPEmployerName({...page,status:'http_error'}),'');assert.equal(publishedGPEmployerName({...page,enrichment:{organizations:[...page.enrichment.organizations,{name:'Other Medical Centre',sourceURL:source,method:'jsonld_jobposting'}]}}),'');assert.equal(publishedGPEmployerName({...page,enrichment:{organizations:[{...page.enrichment.organizations[0],sourceURL:'https://different.example.org/role/123'}]}}),'');
});
