import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPublicContacts} from '../cloud/public-contact-extraction.mjs';
const sourceURL='https://clinic.example.org/jobs/gp',readAt='2026-11-04T12:00:00Z';
const extract=html=>extractPublicContacts({html,sourceURL,readAt});
test('published contacts retain source, quotes and conservative role; footer is general',()=>{
 const r=extract('<main><p>Send your CV by email to jobs@clinic.example.org</p><p>Phone: +61 2 9000 1111</p><p>Organization: Example Medical Centre</p></main><footer><a href="mailto:reception@clinic.example.org">Contact reception</a></footer>');
 assert.equal(r.contacts.find(x=>x.value==='jobs@clinic.example.org').contactRole,'application');assert.equal(r.contacts.find(x=>x.value==='reception@clinic.example.org').contactRole,'organization_general');assert.equal(r.contacts.find(x=>x.type==='phone').value,'+61 2 9000 1111');assert.equal(r.organizations[0].name,'Example Medical Centre');assert.ok(r.contacts.every(x=>x.sourceURL===sourceURL&&x.sourceRelation==='same_page'&&x.quote));assert.equal(r.readAt,readAt);
});
test('hidden, navigation, form, script and privacy contacts do not become published contacts',()=>{
 const r=extract('<nav>nav@example.org</nav><div hidden><div>hidden@example.org</div></div><div aria-hidden="true">aria@example.org</div><p style="display:none !important">css@example.org</p><form>form@example.org</form><script>globalThis.PWNED=true; script@example.org</script><p>Data protection officer: dpo@example.org</p><p>Visible: real@example.org</p>');
 assert.deepEqual(r.contacts.map(x=>x.value),['real@example.org']);assert.equal(globalThis.PWNED,undefined);
});
test('JobPosting hiring organization is explicit; application contact and exact ambiguous dates stay separate',()=>{
 const value={'@context':'https://schema.org','@graph':[{'@type':'JobPosting',hiringOrganization:{'@type':'Organization',name:'Regional Practice',url:'https://regional.example.org',contactPoint:{email:'office@regional.example.org',telephone:'+61 8 9000 2222'}},applicationContact:{email:'applications@regional.example.org'},datePosted:'03/11/2026',validThrough:'2026-12-01T17:00:00+11:00'}]};
 const r=extract('<script type="application/ld+json">'+JSON.stringify(value)+'</script>');assert.equal(r.organizations[0].name,'Regional Practice');assert.equal(r.contacts.find(x=>x.value==='office@regional.example.org').contactRole,'organization_general');assert.equal(r.contacts.find(x=>x.value==='applications@regional.example.org').contactRole,'application');assert.deepEqual(r.publicationDates.map(x=>x.value),['03/11/2026','2026-12-01T17:00:00+11:00']);
});
test('follow queue is same-host, public, bounded depth one and never authentication or social traversal',()=>{
 const links=['/contact','/about','/team','/careers','/jobs/one','/admissions','/clinic','/account/contact','/auth/jobs','/jobs?token=secret','/jobs/file.pdf','https://other.example.org/jobs','http://clinic.example.org/jobs','https://127.0.0.1/jobs','https://user:pass@clinic.example.org/jobs','https://www.linkedin.com/company/example','https://www.linkedin.com/messaging/thread/x'];
 const r=extract(links.map(href=>'<a href="'+href+'">Careers contact</a>').join(''));assert.equal(r.followLinks.length,6);assert.ok(r.followLinks.every(x=>new URL(x.url).hostname==='clinic.example.org'&&x.depth===1));assert.ok(r.contacts.some(x=>x.type==='social'));assert.ok(!r.contacts.some(x=>/127\.0\.0|messaging|user:pass/.test(x.value)));
});
test('no URL/email invention, plain text phone label required, bounds and malformed JSON safe',()=>{
 const r=extractPublicContacts({text:'Deadline 03/11/2026\nReference 123456789\nEmail: person@example.org',sourceURL,readAt});assert.equal(r.contacts.length,1);assert.equal(r.contacts[0].contactRole,'unknown');assert.equal(r.organizations.length,0);
 const many=extract(Array.from({length:80},(_,i)=>'<p>person'+i+'@example.org</p>').join('')+'<script type="application/ld+json">{"@type": "JobPosting", bad }</script>');assert.equal(many.contacts.length,20);assert.equal(extractPublicContacts({html:'person@example.org',sourceURL:'https://2130706433/jobs'}).contacts.length,0);
});
test('visible HTML wins over supplied text and entities decode without executing markup',()=>{
 const r=extractPublicContacts({html:'<div hidden>hidden@example.org</div><a href="mailto:real%40example.org">Email us</a>',text:'hidden@example.org',sourceURL,readAt});assert.deepEqual(r.contacts.map(x=>x.value),['real@example.org']);assert.equal(extract('<p>Email: real&#64;example.org</p>').contacts[0].value,'real@example.org');
});
test('hidden JSON-LD is excluded and nearby privacy links do not erase a general contact',()=>{
 const job={'@type':'JobPosting',hiringOrganization:{name:'Hidden employer',email:'hidden@example.org'}};
 const r=extract('<div hidden><script type="application/ld+json">'+JSON.stringify(job)+'</script></div><footer><a href="/privacy">Privacy</a><a href="mailto:reception@example.org">Contact reception</a></footer>');
 assert.equal(r.organizations.length,0);assert.deepEqual(r.contacts.map(x=>x.value),['reception@example.org']);assert.equal(r.contacts[0].contactRole,'organization_general');
});
test('stored public text preserves literal websites with provenance, no follow crawling',()=>{
 const r=extractPublicContacts({text:'Contact website: https://clinic.example.org/contact\nPublic profile: https://www.linkedin.com/company/clinic-example',sourceURL,readAt});
 assert.deepEqual(r.contacts.map(x=>x.type),['website','social']);assert.ok(r.contacts.every(x=>x.method==='visible_text'&&x.sourceURL===sourceURL));assert.equal(r.followLinks.length,0);
});
test('adversarial nesting stops conservatively instead of exposing unparsed hidden content',()=>{
 const r=extract('<div>'.repeat(200)+'secret@example.org'+'</div>'.repeat(200));assert.equal(r.contacts.length,0);assert.ok(r.limitations.some(x=>x.includes('budget reached')));
});
test('flattened long page classifies each local contact despite remote privacy and quotes the real value',()=>{
 const body='University public information. '+('Research and teaching information. '.repeat(50))+'Send your CV by email to gp.jobs@example.org. '+('Clinical department information. '.repeat(50))+'Data protection officer: dpo@example.org; privacy requests only. '+('Campus facilities information. '.repeat(50))+'Contact reception Phone: +61 2 9000 5555. Official website: https://clinic.example.org/contact.';
 const r=extractPublicContacts({text:body,sourceURL,readAt});
 const application=r.contacts.find(x=>x.value==='gp.jobs@example.org');assert.ok(application);assert.equal(application.contactRole,'application');assert.ok(application.quote.includes(application.value));assert.ok(!application.quote.includes('University public information'));assert.ok(!r.contacts.some(x=>x.value==='dpo@example.org'));
 const phone=r.contacts.find(x=>x.type==='phone');assert.ok(phone);assert.equal(phone.contactRole,'organization_general');assert.ok(phone.quote.includes(phone.value));const website=r.contacts.find(x=>x.type==='website');assert.ok(website.quote.includes(website.value));
});
test('plain-text websites cannot consume the contact budget before a phone at the end',()=>{
 const body=Array.from({length:30},(_,i)=>'https://clinic.example.org/page'+i).join(' ')+' Phone: +61 8 9000 4444';const r=extractPublicContacts({text:body,sourceURL,readAt});assert.ok(r.contacts.some(x=>x.type==='phone'));assert.ok(r.contacts.length<=20);
});
test('a later privacy label does not suppress a preceding application email on the same flattened line',()=>{
 const r=extractPublicContacts({text:'Send your CV by email to jobs@example.org Privacy DPO: dpo@example.org',sourceURL,readAt});assert.deepEqual(r.contacts.map(x=>x.value),['jobs@example.org']);assert.equal(r.contacts[0].contactRole,'application');
});
