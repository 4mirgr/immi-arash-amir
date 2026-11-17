import test from 'node:test';
import assert from 'node:assert/strict';
import {visiblePageText} from '../cloud/public-page-worker.mjs';
import {extractPublicContacts} from '../cloud/public-contact-extraction.mjs';
import {buildClinicResearchContext} from '../cloud/clinic-research-context.mjs';
const root='https://clinic.example/',readAt='2026-11-17T10:00:00.000Z';

test('HTML block boundaries keep punctuation-free services distinct from neighbouring content',()=>{
 const service='Our practice provides chronic disease management and preventive care';
 const training='We train medical students and GP registrars through our teaching programme';
 const html='<html><title>Example Medical Centre</title><nav>Guaranteed Level 1 supervision</nav><main><p>'+('Welcome to the practice website and our local community '.repeat(30))+'</p><p>Our practice provides <strong>chronic disease management</strong> and preventive care</p><p>'+training+'</p><div hidden>Our clinic provides emergency care</div></main></html>';
 const page=visiblePageText(html),research=buildClinicResearchContext({rootURL:root,observedAt:readAt,pages:[{url:root,finalUrl:root,status:'read',readAt,...page}]});
 assert(page.text.split('\n').includes(service));assert(page.text.split('\n').includes(training));
 assert(research.facts.some(x=>x.category==='services'&&x.text===service));assert(research.facts.some(x=>x.category==='training'&&x.text===training));
 assert(!page.text.includes('Guaranteed'));assert(!page.text.includes('emergency care'));assert(page.text.length<=50000);
});

test('generic mailto labels retain the exact published destination as attribute evidence',()=>{
 const extracted=extractPublicContacts({html:'<main><p>Practice enquiries: <a href="mailto:manager%40clinic.example?subject=GP%20enquiry">Email our practice</a></p></main>',sourceURL:root,readAt});
 const email=extracted.contacts.find(x=>x.type==='email');assert(email);assert.equal(email.value,'manager@clinic.example');assert(email.quote.includes(email.value));assert(email.quote.includes('Email our practice'));assert.equal(email.method,'visible_link');assert.equal(email.sourceURL,root);assert(!email.quote.includes('subject='));
});

test('multiple explicit mailto destinations stay separate and query/header injection is not a contact',()=>{
 const html='<main><a href="mailto:one%40clinic.example,two%40clinic.example;three%40clinic.example?cc=hidden%40other.example&amp;subject=Private">Email practice</a><a href="mailto:bad%0Aaddress%40clinic.example">Contact</a></main>',extracted=extractPublicContacts({html,sourceURL:root,readAt});
 assert.deepEqual(extracted.contacts.map(x=>x.value),['one@clinic.example','two@clinic.example','three@clinic.example']);assert(extracted.contacts.every(x=>x.quote.includes(x.value)&&!x.quote.includes('other.example')&&!x.quote.includes('Private')));assert(extracted.contacts.length<=20);
});

test('canonical www aliases expose same-clinic links while unrelated domains remain outside follow-up',()=>{
 const extracted=extractPublicContacts({html:'<nav><a href="https://www.clinic.example/contact">Contact</a><a href="https://www.clinic.example/services">Our services</a><a href="https://www.clinic.example.attacker.example/team">Our team</a></nav>',sourceURL:root,readAt});
 assert.deepEqual(extracted.followLinks.map(x=>x.url),['https://www.clinic.example/contact','https://www.clinic.example/services']);assert(extracted.followLinks.every(x=>x.navigationOnly));assert.deepEqual(extracted.contacts,[]);
});
