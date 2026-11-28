import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGpApplicationEmail,buildGpApplicationAttachments,GpMailDocumentError,GP_APPLICATION_DOCUMENT_VERSION} from '../cloud/gp-mail-documents.mjs';
const envelope={practiceName:'St Mary’s Medical Centre',practiceManager:'Jane Smith',signatureName:'Dr Arash Entezar',signaturePhone:'+61 400 000 000',signatureEmail:'arash@example.invalid',signatureLinkedIn:'https://www.linkedin.com/in/synthetic-doctor/'};
test('short application email preserves the approved wording and verified signature fields',()=>{
 const body=buildGpApplicationEmail(envelope);
 assert.equal(body,`Dear Jane Smith,\n\nI am a General Practitioner with over 5 years of clinical experience and a background as a Medical Director. I have passed the AMC MCQ, meet AHPRA’s English language requirements, and am ready to undertake the PESCI. I am available to begin the application process immediately.\n\nI’ve attached my CV and cover letter for your consideration. I’d welcome the opportunity to speak with you about any supervised GP opportunities at St Mary’s Medical Centre.\n\nThank you for considering my enquiry.\n\nKind regards,\nDr Arash Entezar\n+61 400 000 000\narash@example.invalid\nhttps://www.linkedin.com/in/synthetic-doctor/`);
 assert.match(buildGpApplicationEmail({practiceName:'Synthetic Practice'}),/^Dear Practice Manager,/);
 for(const field of ['practiceName','practiceManager','signatureName','signaturePhone','signatureEmail'])assert.throws(()=>buildGpApplicationEmail({...envelope,[field]:'injected\r\nheader'}),GpMailDocumentError);
 assert.throws(()=>buildGpApplicationEmail({...envelope,signatureLinkedIn:'https://attacker.invalid/in/name'}),GpMailDocumentError);
});
test('two searchable PDF artifacts have exact Unicode names, stable bytes and content fingerprints',async()=>{
 const input={practiceName:envelope.practiceName,cvText:'Dr Arash Entezar\nClinical Experience\nEvidence-based care with non\u2011breaking hyphens.',coverLetter:'Dear Jane Smith,\n\nI value your clinic’s teaching focus.\n\nKind regards,\nDr Arash Entezar'};
 const first=await buildGpApplicationAttachments(input),again=await buildGpApplicationAttachments(input);
 assert.equal(GP_APPLICATION_DOCUMENT_VERSION,'gp-pdf-application-v1');
 assert.deepEqual(first.map(f=>f.name),['Dr Arash Entezar – CV.pdf','Dr Arash Entezar – Cover Letter – St Mary’s Medical Centre.pdf']);
 assert.deepEqual(first,again);
 for(const file of first){assert.equal(file.mimeType,'application/pdf');assert.equal(file.size,file.bytes.length);assert.match(Buffer.from(file.bytes).toString('latin1'),/^%PDF-1.4/);assert.match(file.hash,/^[a-f0-9]{64}$/);}
 assert.match(Buffer.from(first[0].bytes).toString('latin1'),/non-breaking hyphens/);
 const changed=await buildGpApplicationAttachments({...input,coverLetter:input.coverLetter+'\nNew evidence.'});
 assert.equal(changed[0].hash,first[0].hash);assert.notEqual(changed[1].hash,first[1].hash);
});
test('unsupported PDF characters stop with an actionable typed error and identify the document',async()=>{
 for(const document of ['cv','cover_letter'])await assert.rejects(buildGpApplicationAttachments({practiceName:'Synthetic',cvText:document==='cv'?'فارسی':'English CV',coverLetter:document==='cover_letter'?'فارسی':'English letter'}),error=>error.status===422&&error.code==='gp_application_pdf_text_unsupported'&&error.document===document);
});
