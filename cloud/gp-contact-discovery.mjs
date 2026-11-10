// Only public, already-read evidence reaches this selector. Ambiguous people
// remain candidates, never an invented addressee or verified recruiter identity.
export function publishedApplicationContact(opportunity={}){
 const raw=Array.isArray(opportunity.enrichment?.people)?opportunity.enrichment.people:[];
 const candidates=[];
 for(const person of raw){
  if(!person||!['practice_manager','recruitment_contact'].includes(person.role)||!['same_page','linked_page'].includes(person.sourceRelation)||typeof person.name!=='string'||!/^\p{L}[\p{L} .’'-]{2,100}$/u.test(person.name)||/\b(?:team|enquiries|contact|vacanc|support|password|ignore|find|out|more|administrative|staff|clinical)\b/i.test(person.name)||typeof person.quote!=='string'||!person.quote.trim())continue;
  let url;try{url=new URL(person.sourceURL);if(url.protocol!=='https:'||url.username||url.password)continue;}catch{continue;}
  const entry={name:person.name,role:person.role,sourceURL:url.href,quote:person.quote.slice(0,700),method:person.method||'visible_role_label',sourceRelation:person.sourceRelation,status:'published_name_not_verified_identity'};
  if(!candidates.some(c=>c.name.toLowerCase()===entry.name.toLowerCase()&&c.role===entry.role))candidates.push(entry);
  if(candidates.length>=10)break;
 }
 // A manager in a network testimonial is not necessarily the application
 // contact. Require a team/contact directory or explicit local/contact wording.
 const addressable=candidates.filter(c=>/(?:contact|about|team|staff)/i.test(new URL(c.sourceURL).pathname)||/\b(?:contact|apply|application|recruitment|enquiries|led locally by)\b|practice manager\s*:/i.test(c.quote));
 const managers=addressable.filter(c=>c.role==='practice_manager');
 const relevant=managers.length?managers:addressable.filter(c=>c.role==='recruitment_contact');
 return {selected:relevant.length===1?relevant[0]:null,candidates,status:relevant.length===1?'published_contact_found':relevant.length>1?'multiple_contacts_require_review':candidates.length?'published_role_requires_recipient_review':'published_contact_not_found'};
}
