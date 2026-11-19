// Synthetic public-employer evidence for positive preparation/transport tests.
// Raw mail ingestion intentionally does not receive this proof automatically.
import assert from 'node:assert/strict';
import {MAIL_LEAD_DISCOVERY_VERSION} from '../../cloud/mail-lead-discovery.mjs';
import {prepareMailOpportunityDraft} from '../../cloud/mail-opportunities.mjs';

export function withPublicEmployerEvidence(candidate,options={}){
 const now=options.now??Date.now(),at=new Date(now).toISOString(),name=options.clinicName||candidate.clinicName||'Harbour Medical Centre';
 const official=options.officialSourceURL||'https://harbour.example.org/careers/gp';
 const recipients=options.recipients??candidate.recipients??[candidate.recipient].filter(Boolean);
 const facts=options.clinicalFacts||[name+' provides chronic disease management, preventive care and wound care.'];
 const contactEvidence=recipients.map(value=>({type:'email',value,quote:'Applications: '+value,sourceURL:official,readAt:at,method:'visible_text',contactRole:'application',sourceRelation:'same_page'}));
 return {...candidate,clinicName:name,recipient:recipients[0]||null,recipients,clinicalFacts:facts,clinicalFactBasis:'source_published_statement',clinicalSourceUrl:official,
  contactBasis:recipients.length?{kind:'source_published_research_contact',sourceUrl:official,readAt:at}:null,
  researchStatus:'read',researchReadAt:at,research:{...candidate.research,version:MAIL_LEAD_DISCOVERY_VERSION,observedAt:at,validUntil:now+7*86400000,publicEmployerVerified:true,
   verification:{version:MAIL_LEAD_DISCOVERY_VERSION,officialSourceURL:official,clinicName:name,checkedAt:at,identityEvidence:[{quote:name,sourceURL:official,readAt:at,method:'published_employer_name',authority:'visible_brand_heading'}]},
   facts:facts.map(text=>({category:'services',text,sourceURL:official,readAt:at})),contactEvidence,
   sourcePages:[{url:official,sourceURL:official,status:'read',readAt:at,kind:'employer'}],
  },
 };
}

export async function seedVerifiedMailOpportunity(db,id,writing,options={}){
 const row=db.prepare('SELECT * FROM private_mail_opportunities WHERE id=?').get(id);assert(row,'Synthetic private opportunity exists before research');
 const data=withPublicEmployerEvidence(JSON.parse(row.data_json),options),draft=await prepareMailOpportunityDraft(data,writing,{now:options.now??Date.now()});
 assert.equal(draft.readyForReview,true,JSON.stringify(draft.missing));
 db.prepare('UPDATE private_mail_opportunities SET data_json=?,draft_json=? WHERE id=?').run(JSON.stringify(data),JSON.stringify(draft),id);
 return {data,draft};
}
