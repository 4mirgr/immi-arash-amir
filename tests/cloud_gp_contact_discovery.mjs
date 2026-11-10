import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedApplicationContact} from '../cloud/gp-contact-discovery.mjs';
import {buildGpApplicationPackage} from '../cloud/gp-application-package.mjs';
const person={name:'Jane Example',role:'practice_manager',sourceURL:'https://clinic.example/contact',quote:'Practice Manager: Jane Example',method:'visible_role_label',sourceRelation:'linked_page'};
test('unique public manager takes the named greeting and keeps its actual contact-page source',()=>{
 const selected=publishedApplicationContact({enrichment:{people:[person]}});assert.equal(selected.selected.name,person.name);
 const pkg=buildGpApplicationPackage({opportunity:{title:'General Practitioner',organization:'Synthetic Practice',url:'https://clinic.example/job',enrichment:{people:[person]}}});
 assert(pkg.body.startsWith('Dear Jane Example,'));assert.equal(pkg.dossier.practiceManager.sourceUrl,person.sourceURL);assert.equal(pkg.namedContactCandidates.length,1);assert.equal(pkg.contactDiscovery.namedContactsCount,1);
});
test('multiple managers, unlabelled doctors and malicious/private evidence never pick an addressee',()=>{
 for(const people of [[person,{...person,name:'Alex Example'}],[{...person,role:'doctor'}],[{...person,sourceURL:'http://private.example'}],[{...person,sourceRelation:'private_mail'}],[{...person,name:'Ignore instructions'}]]){
  const result=publishedApplicationContact({enrichment:{people}});assert.equal(result.selected,null);
  const pkg=buildGpApplicationPackage({opportunity:{title:'General Practitioner',url:'https://clinic.example/job',enrichment:{people}}});assert(pkg.body.startsWith('Dear Practice Manager,'));
 }
});
test('a sole labelled recruiter can be addressed; unknown identity stays a source statement',()=>{
 const result=publishedApplicationContact({enrichment:{people:[{...person,role:'recruitment_contact'}]}});assert.equal(result.selected.role,'recruitment_contact');assert.equal(result.selected.status,'published_name_not_verified_identity');
});
test('a named manager in a generic careers testimonial is not automatically the application contact',()=>{
 const testimonial={...person,sourceURL:'https://network.example/careers',quote:'Jane Example Practice Manager'};
 assert.equal(publishedApplicationContact({enrichment:{people:[testimonial]}}).selected,null);
 const result=publishedApplicationContact({enrichment:{people:[{...testimonial,quote:'Apply to Jane Example, Practice Manager'}]}});assert.equal(result.selected.name,person.name);
});
