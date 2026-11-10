// Bounded, deterministic writing from the owner's CV and published clinic
// evidence. No model, external request or inferred personal connection is used.
const clean = value => typeof value === 'string' ? value.replace(/[\x00-\x1f<>]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const INSTRUCTION = /ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|javascript:/i;
const TOPICS = [
 {id:'procedures',match:/\b(?:minor procedures?|wound|suturing|sutur(?:e|es)|splint(?:ing)?|fracture|treatment room)\b/i,
  reason:'I am drawn to a practice where hands-on treatment sits alongside everyday family medicine.',
  benefit:'That experience could help me contribute to your treatment room and acute consultations, with the supervision and local guidance the role requires.'},
 {id:'chronic_care',match:/\b(?:chronic|diabetes|hypertension|cardiovascular|respiratory|preventive|prevention|continuity|follow-up)\b/i,
  reason:'I value the continuity of general practice: getting to know patients and helping them manage their health over time.',
  benefit:'I would bring that experience to follow-up appointments and day-to-day patient care, while learning your local systems under the required supervision.'},
 {id:'acute_care',match:/\b(?:acute|emergency|urgent|24[- ]hour|extended hours|seven[- ]day|7[- ]day)\b/i,
  reason:'The mix of planned consultations and patients who need more urgent attention appeals to me.',
  benefit:'That background could be useful in a busy clinic with varied presentations; I would work within the agreed supervision arrangements and local escalation pathways.'},
 {id:'team_care',match:/\b(?:multidisciplinary|allied health|team|collaborat|referral)\b/i,
  reason:'I am looking for a team where clinicians can learn from one another and keep care connected for patients.',
  benefit:'I would welcome the chance to put that experience to work alongside your team, with clear communication, appropriate referral and the required supervision.'},
 {id:'community',match:/\b(?:community|family|rural|regional|patient.centred|patient.centered)\b/i,
  reason:'I am looking for a practice where I can settle for the long term and build trust with the people I care for.',
  benefit:'I hope to contribute that breadth of experience to your patients and become a dependable member of the practice, with appropriate supervision.'},
 {id:'learning',match:/\b(?:teaching|training|registrar|medical students?|education|supervis)\b/i,
  reason:'A practice that makes room for learning and clinical discussion is particularly appealing as I prepare to enter Australian general practice.',
  benefit:'I would bring that experience with me while remaining open to feedback and the local guidance needed for a supervised role.'},
];
function positiveTopic(topic,value) {
 return clean(value).split(/(?<=[.!?;])\s+|\n+/).some(sentence=>topic.match.test(sentence)
  && !/\b(?:no|not|never|without|lack(?:s|ing)?|unable|cannot|can't|limited)\b/i.test(sentence));
}
function topicFor(clinic, cv) {
 const both = TOPICS.find(topic => positiveTopic(topic,clinic) && positiveTopic(topic,cv));
 return both || TOPICS.find(topic => positiveTopic(topic,clinic)) || null;
}
function sentence(value) { const text=clean(value);return text && /[.!?]$/.test(text) ? text : text + (text ? '.' : ''); }
function candidateFact(value) {
 let fact=clean(value).replace(/^[•·▪◦*-]\s*/, '');
 // Only conventional positive CV capability bullets are changed into prose.
 // Negations, dates, evidence uncertainty and existing first-person sentences
 // are retained rather than turned into affirmative clinical capabilities.
 if(!/\b(?:no|not|never|without|lack(?:s|ing)?|unable|cannot|can't|limited)\b/i.test(fact)){
  fact=fact.replace(/^(Managed|Delivered|Provided|Assessed|Performed|Coordinated|Supported|Treated|Developed|Led)\b/,(_,verb)=>'I have '+verb.toLowerCase())
   .replace(/^Responsible for\s+/i,'My work has included ')
   .replace(/^(Management of|Chronic disease management|Wound care|Minor procedures|Preventive care)\b/i,(_,skill)=>'My clinical experience includes '+skill.charAt(0).toLowerCase()+skill.slice(1));
 }
 return sentence(fact);
}
function clinicFact(name, quote) {
 let fact=clean(quote);
 fact=fact.replace(/^Our\s+(?:(?:family|general|medical|community|local|rural|regional|multidisciplinary|busy)\s+){0,3}(?:practice|clinic|medical cent(?:re|er))\b/i,name)
  .replace(/^The\s+(?:practice|clinic|medical cent(?:re|er))\b/i,name)
  .replace(/^We\s+(provide|offer|deliver|support|welcome|work)\b/i,(_,verb)=>name+' '+({provide:'provides',offer:'offers',deliver:'delivers',support:'supports',welcome:'welcomes',work:'works'}[verb.toLowerCase()]));
 // A quoted 'we/our/I' outside the reviewed patterns is not re-attributed to
 // the applicant. Keep it visibly attributed instead of guessing its grammar.
 if (/^(?:we|our|i)\b/i.test(fact)) return `${name} caught my attention when I read this description of the practice: “${sentence(fact)}”`;
 return fact.toLowerCase().includes(name.toLowerCase()) ? sentence(fact) : `${name} caught my attention. ${sentence(fact)}`;
}

export function suggestEvidencePair(clinicCandidates=[], cvCandidates=[]) {
 let best=null;
 for (const clinic of clinicCandidates) for (const cv of cvCandidates) {
  const shared=TOPICS.filter(topic=>positiveTopic(topic,clinic.text||'')&&positiveTopic(topic,cv.text||''));
  const score=shared.length*10+(clinic.text?.length<350?1:0);
  if (!best || score>best.score) best={clinicQuote:clinic.text,cvQuote:cv.text,topic:shared[0]?.id||topicFor(clinic.text||'',cv.text||'')?.id||'general_practice',score};
 }
 if(!best)return null;
 const {score,...suggestion}=best;
 return {...suggestion,status:'suggested_requires_owner_review'};
}

export function composeClinicParagraphs({clinicName,clinicQuote,cvQuote,confirmed=false,selectedConnection=null,confirmConnection=false}={}) {
 const name=clean(clinicName), clinic=clean(clinicQuote), cv=clean(cvQuote);
 const topic=topicFor(clinic,cv);
 const sharedTopic=TOPICS.find(item=>positiveTopic(item,clinic)&&positiveTopic(item,cv));
 const connectionName=confirmConnection===true?clean(selectedConnection?.name):'';
 const connectionSentence=connectionName&&!INSTRUCTION.test(connectionName)?` I would also welcome the opportunity to speak with ${connectionName} about the practice and whether a supervised GP role might be possible.`:'';
 return {
  clinicReason: name&&clinic ? clinicFact(name,clinic)+' '+(topic?.reason||'I would welcome the chance to learn more about your practice and whether there is a suitable long-term supervised role.')+connectionSentence : '{{clinicEvidence}}',
  candidateValue: cv&&confirmed ? candidateFact(cv)+' '+(sharedTopic?.benefit||'I would welcome a discussion about the experience and support this role would require, and where I could contribute under appropriate supervision.') : '{{cvEvidence}}',
  topic:topic?.id||'general_practice',
  mutualConnections:connectionSentence?{status:'owner_confirmed_contact_reference',contactId:selectedConnection.id,relationshipVerified:false}:{status:'not_asserted',reason:'No independently reviewed owner-specific relationship evidence was supplied.'},
 };
}

export function readGpWritingProfile(profile={}) {
 const raw=profile?.planning?.gpApplicationWriting;
 const opening=clean(raw?.openingParagraph),closing=clean(raw?.closingParagraph);
 const valid=raw?.confirmedByOwner===true&&raw?.writingVersion==='human-four-paragraph-v1'
  && opening.length>=40&&opening.length<=1600&&closing.length>=15&&closing.length<=1000
  && !INSTRUCTION.test(opening+' '+closing)&&!/[{}]/.test(opening+' '+closing);
 const email=clean(raw?.signatureEmail),phone=clean(raw?.signaturePhone);
 return {confirmed:valid,opening:valid?opening:'{{openingParagraph}}',closing:valid?closing:'{{closingParagraph}}',
  signatureEmail:valid&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)?email:'',
  signaturePhone:valid&&/^[+()\d .-]{7,40}$/.test(phone)?phone:'',
  version:'human-four-paragraph-v1',issues:(Array.isArray(raw?.issues)?raw.issues:[]).slice(0,5).filter(item=>typeof item?.code==='string'&&typeof item?.message==='string').map(item=>({code:clean(item.code).slice(0,80),message:clean(item.message).slice(0,600)}))};
}
