import {createCVPDF} from '../src/cv-pdf.mjs';

export const GP_APPLICATION_DOCUMENT_VERSION='gp-pdf-application-v1';
export class GpMailDocumentError extends Error {
 constructor(status,code,document){super(code);this.status=status;this.code=code;if(document)this.document=document;}
}
function singleLine(value,max=200){return typeof value==='string'&&value.trim()&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value)?value.trim():null;}
function practice(value){const result=singleLine(value);if(!result||/\{\{|\}\}|\[Practice Name\]/i.test(result))throw new GpMailDocumentError(400,'gp_application_practice_required');return result;}
export function buildGpApplicationEmail({practiceName,practiceManager,signatureName,signatureEmail,signaturePhone,signatureLinkedIn}={}){
 const name=practice(practiceName),manager=practiceManager==null||practiceManager===''?'Practice Manager':singleLine(practiceManager),doctor=signatureName==null||signatureName===''?'Dr Arash Entezar':singleLine(signatureName);
 if(!manager||!doctor)throw new GpMailDocumentError(400,'gp_application_signature_invalid');
 const signature=[doctor];
 if(signaturePhone){const phone=singleLine(signaturePhone,40);if(!phone||!/^\+?[\d ()-]+$/.test(phone))throw new GpMailDocumentError(400,'gp_application_signature_invalid');signature.push(phone);}
 if(signatureEmail){const email=singleLine(signatureEmail,254);if(!email||!/^[^\s@<>;,"\\]+@[^\s@<>;,"\\]+\.[^\s@<>;,"\\]+$/.test(email))throw new GpMailDocumentError(400,'gp_application_signature_invalid');signature.push(email);}
 if(signatureLinkedIn){let url;try{url=new URL(signatureLinkedIn);}catch{}if(!url||url.protocol!=='https:'||!['linkedin.com','www.linkedin.com'].includes(url.hostname)||!/^\/in\/[^/]+\/?$/.test(url.pathname)||url.username||url.password||url.search||url.hash)throw new GpMailDocumentError(400,'gp_application_signature_invalid');signature.push(url.href);}
 return `Dear ${manager},\n\nI am a General Practitioner with over 5 years of clinical experience and a background as a Medical Director. I have passed the AMC MCQ, meet AHPRA’s English language requirements, and am ready to undertake the PESCI. I am available to begin the application process immediately.\n\nI’ve attached my CV and cover letter for your consideration. I’d welcome the opportunity to speak with you about any supervised GP opportunities at ${name}.\n\nThank you for considering my enquiry.\n\nKind regards,\n${signature.join('\n')}`;
}
async function pdfArtifact(text,name,document){
 if(typeof text!=='string'||!text.trim()||text.length>(document==='cv'?200000:50000))throw new GpMailDocumentError(400,'gp_application_document_missing',document);
 // Nonbreaking hyphens have the same visible meaning in the standard PDF font.
 const result=createCVPDF({cvText:text.replace(/\u2011/g,'-')});
 // The existing native print fallback needs a browser. Server mail must stop
 // rather than silently discard characters or send a fake/empty PDF.
 if(result.requiresPrint||!(result.bytes instanceof Uint8Array))throw new GpMailDocumentError(422,'gp_application_pdf_text_unsupported',document);
 const bytes=result.bytes,hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 return {name,mimeType:'application/pdf',bytes,hash,size:bytes.length};
}
export async function buildGpApplicationAttachments({cvText,practiceName,coverLetter}={}){
 const name=practice(practiceName).replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim();
 if(!name)throw new GpMailDocumentError(400,'gp_application_practice_required');
 const files=await Promise.all([pdfArtifact(cvText,'Dr Arash Entezar – CV.pdf','cv'),pdfArtifact(coverLetter,`Dr Arash Entezar – Cover Letter – ${name}.pdf`,'cover_letter')]);
 if(files.reduce((n,file)=>n+file.size,0)>1000000)throw new GpMailDocumentError(413,'gp_application_documents_too_large');
 return files;
}
