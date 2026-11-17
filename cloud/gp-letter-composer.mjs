// Bounded, deterministic writing from the owner's CV and published clinic
// evidence. This fallback is not an LLM and never researches or invents facts.
const clean=value=>typeof value==='string'?value.replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim():'';
const INSTRUCTION=/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|send.{0,40}(?:token|secret)|javascript:/i;
const NEGATIVE=/\b(?:no|not|never|without|lack(?:s|ing)?|unable|cannot|can't|limited)\b/i;
const TOPICS=[
 {id:'procedures',match:/\b(?:minor procedures?|wound|suturing|sutur(?:e|es)|splint(?:ing)?|fracture|treatment room)\b/i,interest:'general practice combining clinical consultations with practical treatment'},
 {id:'chronic_care',match:/\b(?:chronic|diabetes|hypertension|cardiovascular|respiratory|preventive|prevention|continuity|follow-up)\b/i,interest:'longitudinal general practice that brings ongoing disease management and prevention together'},
 {id:'acute_care',match:/\b(?:acute|emergency|urgent|24[- ]hour|extended hours|seven[- ]day|7[- ]day)\b/i,interest:'general practice with a broad clinical scope and accessible patient care'},
 {id:'team_care',match:/\b(?:multidisciplinary|allied health|team|collaborat\w*|referral)\b/i,interest:'collaborative general practice with clear communication between clinicians'},
 {id:'community',match:/\b(?:community|family|rural|regional|patient.centred|patient.centered)\b/i,interest:'a long-term role in community general practice'},
 {id:'learning',match:/\b(?:teaching|training|registrar|medical students?|education|supervis\w*)\b/i,interest:'an environment where clinical work is accompanied by learning and professional discussion'},
];
// Narrow service matches distinguish an actual overlap from a related field.
// A wound-care statement does not establish competence in all minor surgery.
const SERVICES=[
 {id:'chronic_disease',match:/\bchronic(?: disease)?\b/i,label:'chronic disease care'},
 {id:'diabetes',match:/\bdiabet(?:es|ic)\b/i,label:'diabetes care'},
 {id:'hypertension',match:/\bhypertension\b/i,label:'hypertension management'},
 {id:'prevention',match:/\b(?:preventive|preventative|prevention)\b/i,label:'preventive care'},
 {id:'wound',match:/\bwound\b/i,label:'wound care'},
 {id:'minor_procedures',match:/\bminor (?:procedures?|surgery)\b/i,label:'minor procedures'},
 {id:'suturing',match:/\b(?:suturing|sutures?)\b/i,label:'suturing'},
 {id:'fracture',match:/\bfractures?\b/i,label:'fracture care'},
 {id:'acute',match:/\bacute\b/i,label:'acute presentations'},
 {id:'emergency',match:/\bemergency\b/i,label:'emergency care'},
 {id:'occupational',match:/\boccupational (?:health|medicine)\b/i,label:'occupational health'},
 {id:'paediatrics',match:/\b(?:paediatrics?|pediatrics?|child(?:ren)?(?:'s)? health)\b/i,label:'children’s health'},
 {id:'mental_health',match:/\bmental health\b/i,label:'mental health care'},
];
const UNSUPPORTED=Object.freeze(['patient_statistics','crisis_history','supervision_approval','sponsorship','personal_connections','verified_credentials','eligibility']);
const safeFact=value=>{const result=clean(value);return result&&result.length<=700&&!INSTRUCTION.test(result)&&!/[{}]/.test(result)?result:'';};
const clauses=value=>clean(value).split(/(?<=[.!?;])\s+|\n+/).filter(Boolean);
function positiveTopic(topic,value){return clauses(value).some(part=>topic.match.test(part)&&!NEGATIVE.test(part));}
const positiveTopics=value=>TOPICS.filter(topic=>positiveTopic(topic,value));
const services=value=>SERVICES.filter(service=>positiveTopic(service,value));
const sentence=value=>{const result=clean(value).replace(/[.;:,]+$/,'');return result?result+'.':'';};
const list=values=>values.length<2?values[0]||'':values.length===2?values.join(' and '):values.slice(0,-1).join(', ')+', and '+values.at(-1);
const words=value=>clean(value).split(/\s+/).filter(Boolean).length;
function sourceURL(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function readAt(value){const time=Date.parse(value||'');return Number.isFinite(time)?new Date(time).toISOString():null;}
const CV_ACTION_BOUNDARY=/(?:,\s*(?:and\s+)?|\s+(?:and|while|alongside)\s+)(?=(?:I\s+(?:have\s+)?)?(?:manag\w*|treat\w*|assess\w*|provid\w*|deliver\w*|perform\w*|coordinat\w*|train\w*|conduct\w*|contribut\w*|support\w*|develop\w*|teach\w*|taught|led|research|training|(?:clinical|medical)\s+(?:research|training))\b)/i;
const NONCLINICAL_QUALIFIER=/\b(?:research|thesis|publication|published|study|studies|course|certificate|certification|CPD|training|trained|teaching|taught|webinar)\b/i;
const cvClauses=value=>clauses(value).flatMap(part=>part.split(CV_ACTION_BOUNDARY)).filter(Boolean);
function cvKind(value){
 if(NEGATIVE.test(value))return 'limitation';
 // An explicit care-delivery clause is still clinical experience when a later
 // clause mentions staff training or research. Conversely, "provided research
 // support" and a course about a procedure do not establish performed care.
 const lead=(cvClauses(value)[0]||'').replace(/^[•·▪◦*-]\s*/,'').replace(/^(?:My\s+(?:clinical\s+)?(?:work|experience)\s+(?:has\s+)?include(?:s|d)|I\s+have\s+(?:clinical\s+)?experience\s+(?:in|with))\s+/i,'');
 const clinicalAction=/^(?:I\s+(?:have\s+)?(?:been\s+)?)?(?:manag(?:e|ed|ing)|treat(?:ed|ing)?|assess(?:ed|ing)?|provid(?:e|ed|ing)|deliver(?:ed|ing)?|perform(?:ed|ing)?|coordinat(?:e|ed|ing))\s+(?:(?:the|a|an)\s+)?(?:patients?|clinical\s+(?:care|consultations?)|consultations?|chronic\s+(?:diseases?|illness(?:es)?)|acute\s+(?:care|presentations?|consultations?)|diabetes|hypertension|wound\s+care|suturing|minor\s+procedures?|referrals?)\b/i;
 if(clinicalAction.test(lead)&&!NONCLINICAL_QUALIFIER.test(lead))return 'clinical_self_report';
 // Coursework or research on a treatment is not clinical scope evidence.
 if(/\b(?:research|thesis|publication|published|study|studies)\b/i.test(value))return 'research';
 if(/\b(?:course|certificate|certification|CPD|training|trained|teaching|taught|webinar)\b/i.test(value))return 'training';
 return 'clinical_self_report';
}
export function cvEvidenceScope(value){const fact=safeFact(value);return fact?cvKind(fact):null;}
function evidenceSummary(value,{cv=false}={}){
 const cvScope=cv?cvKind(value):null,scoped=cv&&cvScope==='clinical_self_report'?cvClauses(value).filter(part=>cvKind(part)==='clinical_self_report').join('. '):value;
 return {topics:positiveTopics(scoped).map(x=>x.id),services:services(scoped).map(x=>x.id),cvScope};
}
function summaryMatch(clinic,cv,hasClinic,hasCv){
 const sharedTopics=clinic.topics.filter(id=>cv.topics.includes(id)),sharedServices=cv.cvScope==='clinical_self_report'?clinic.services.filter(id=>cv.services.includes(id)):[];
 const status=!hasClinic||!hasCv?'missing_evidence':sharedServices.length?'direct_service_overlap':sharedTopics.length&&cv.cvScope==='clinical_self_report'?'related_context':'insufficient_overlap';
 return {status,sharedTopics,clinicTopics:clinic.topics,cvTopics:cv.topics,sharedServices,cvScope:cv.cvScope};
}
function matchEvidence(clinic,cv){
 return summaryMatch(evidenceSummary(clinic),evidenceSummary(cv,{cv:true}),Boolean(clinic),Boolean(cv));
}
function clinicFact(name,quote){
 const fact=quote.replace(/^Our\s+(?:(?:family|general|medical|community|local|rural|regional|multidisciplinary|busy)\s+){0,3}(?:practice|clinic|medical cent(?:re|er))\b/i,name)
  .replace(/^The\s+(?:practice|clinic|medical cent(?:re|er))\b/i,name)
  .replace(/^We\s+(provide|offer|deliver|support|welcome|work)\b/i,(_,verb)=>name+' '+({provide:'provides',offer:'offers',deliver:'delivers',support:'supports',welcome:'welcomes',work:'works'}[verb.toLowerCase()]));
 if(/^(?:we|our|i)\b/i.test(fact))return `${name} describes its work as follows: “${sentence(quote)}”`;
 return fact.toLowerCase().includes(name.toLowerCase())?sentence(fact):`${name} describes its work as follows: “${sentence(fact)}”`;
}
function servicesPhrase(quote){
 if(NEGATIVE.test(quote))return null;
 const match=/\b(?:provid(?:e|es|ing)|offer(?:s|ing)?|deliver(?:s|ing)?)\s+(.+)/i.exec(quote);if(!match)return null;
 const phrase=match[1].replace(/\s+(?:Contact|Email|Phone|Call)\b[\s\S]*$/i,'').replace(/[.;:,]+$/,'');
 if(!phrase||words(phrase)>27||/\b(?:we|our|I|your|you|a GP|general practitioner (?:to|with))\b/i.test(phrase)||!positiveTopics(phrase).length)return null;
 return phrase;
}
function clinicParagraph(name,clinic,topic){
 if(!name||!clinic)return '{{clinicEvidence}}';
 if(NEGATIVE.test(clinic))return `${clinicFact(name,clinic)} I would wish to clarify these requirements before considering whether a supervised appointment could be appropriate.`;
 const phrase=servicesPhrase(clinic),interest=topic?.interest||'a long-term supervised role in general practice';
 if(phrase)return `The provision of ${phrase} at ${name} aligns with my interest in ${interest}.`;
 return `${clinicFact(name,clinic)} I am seeking ${interest}.`;
}
const GERUNDS={managed:'managing',delivered:'delivering',provided:'providing',assessed:'assessing',performed:'performing',coordinated:'coordinating',supported:'supporting',treated:'treating',developed:'developing',led:'leading'};
function capabilityPhrase(value){
 let fact=value.replace(/^[•·▪◦*-]\s*/, '').replace(/[.;:,]+$/,'');
 // Converting only the first verb in a coordinated past-tense CV bullet leaves
 // mixed tenses ("experience managing..., provided... and coordinated...").
 // Such bullets are preserved as a complete first-person sentence instead.
 if(/(?:,\s*(?:and\s+)?|\s+and\s+)(?:[a-z]+ed|led|taught|undertook|oversaw|gave|ran|wrote|read|built)\b/i.test(fact))return null;
 fact=fact.replace(/^(?:My\s+(?:(?:clinical|professional|previous)\s+)?(?:experience|work|background)\s+(?:has\s+)?include(?:s|d)|My\s+(?:clinical|professional)\s+experience\s+(?:is|has been)\s+in|I\s+have\s+(?:clinical\s+)?experience\s+(?:in|with)|Experience\s+(?:in|with))\s+/i,'');
 fact=fact.replace(/^(?:I\s+(?:have\s+)?|I\s+have\s+been\s+)?(Managed|Delivered|Provided|Assessed|Performed|Coordinated|Supported|Treated|Developed|Led)\b\s*/i,(_,verb)=>GERUNDS[verb.toLowerCase()]+' ')
  .replace(/^(?:I\s+(?:am|was)\s+)?Responsible for\s+/i,'')
  .replace(/^I have worked in\s+/i,'working in ').replace(/^I have worked as\s+/i,'working as ')
  .replace(/^(?:I\s+(?:have\s+)?|I\s+have\s+been\s+)?served as\s+/i,'serving as ')
  .replace(/^(Medical Director|Technical Manager)\b/i,'serving as $1');
 if(/^(?:I|My|Dr\.?|He|She|The)\b/i.test(fact)||words(fact)>42)return null;
 if(/^(?:Management of|Chronic disease management|Wound care|Minor procedures|Preventive care|managing|delivering|providing|assessing|performing|coordinating|supporting|treating|developing|leading|working|serving)\b/i.test(fact)||fact!==value.replace(/[.;:,]+$/,''))return fact.charAt(0).toLowerCase()+fact.slice(1);
 return null;
}
function cvSentence(value){
 const fact=value.replace(/^[•·▪◦*-]\s*/,'');
 if(/^(?:Managed|Delivered|Provided|Assessed|Performed|Coordinated|Supported|Treated|Developed|Led|Completed|Served)\b/.test(fact))return sentence('I have '+fact.charAt(0).toLowerCase()+fact.slice(1));
 return sentence(fact);
}
function candidateParagraph(cv,match){
 if(!cv)return '{{cvEvidence}}';
 if(match.cvScope==='limitation')return `${sentence(cv)} I would want to discuss the role’s clinical requirements openly and establish an appropriate scope of work and supervision before proceeding.`;
 if(match.cvScope==='research'||match.cvScope==='training')return `${cvSentence(cv)} I would welcome the opportunity to build on this knowledge in an appropriately supervised role, while discussing the practical experience and preparation required for your clinical services.`;
 const capability=capabilityPhrase(cv),experience=capability?'experience'+(/^(?:managing|delivering|providing|assessing|performing|coordinating|supporting|treating|developing|leading|working|serving)\b/.test(capability)?' ':' in ')+capability:null,background=experience?'My '+experience:null;
 const shared=SERVICES.filter(service=>match.sharedServices.includes(service.id)).slice(0,3).map(x=>x.label);
 if(shared.length){
  const target=list(shared),opening=experience?`I would bring ${experience} to the ${target} you provide.`:`${cvSentence(cv)} I would bring this background to the ${target} you provide.`;
  return `${opening} My priority would be to put this experience to practical use within your clinical model, with careful attention to your protocols and the supervision arrangements agreed for the role.`;
 }
 const opening=background?`${background} is the clinical background I would bring to a supervised appointment.`:cvSentence(cv);
 if(match.sharedTopics.length)return `${opening} The related focus in your practice’s description provides a useful basis for discussing where I could contribute and which clinical responsibilities would require further preparation or supervision.`;
 return `${opening} I would welcome a discussion of your clinical priorities and the responsibilities that could be undertaken within an agreed supervised scope of practice.`;
}

export function suggestEvidencePair(clinicCandidates=[],cvCandidates=[]){
 let best=null;
 const prepare=(candidates,cv)=>candidates.map(item=>safeFact(item?.text)).filter(Boolean).map(text=>({text,summary:evidenceSummary(text,{cv}),short:words(text)<=35}));
 // Each source/CV fact is summarized once. The bounded pair matrix compares cached
 // summaries rather than repeating all regexes for every 24×24 combination.
 const clinics=prepare(clinicCandidates,false),cvs=prepare(cvCandidates,true);
 for(const clinic of clinics)for(const cv of cvs){
  const clinicText=clinic.text,cvText=cv.text;
  const evidenceMatch=summaryMatch(clinic.summary,cv.summary,true,true),score=evidenceMatch.sharedServices.length*100+evidenceMatch.sharedTopics.length*10+(clinic.short?2:0)+(evidenceMatch.cvScope==='clinical_self_report'?1:-1000);
  if(!best||score>best.score)best={clinicQuote:clinicText,cvQuote:cvText,topic:evidenceMatch.sharedTopics[0]||evidenceMatch.clinicTopics[0]||'general_practice',evidenceMatch,score};
 }
 if(!best)return null;const {score,...suggestion}=best;return {...suggestion,status:'suggested_requires_owner_review'};
}

export function composeClinicParagraphs({clinicName,clinicQuote,cvQuote,confirmed=false,selectedConnection=null,confirmConnection=false,clinicSourceURL=null,clinicReadAt=null}={}){
 const name=safeFact(clinicName),clinic=safeFact(clinicQuote),cv=safeFact(cvQuote),evidenceMatch=matchEvidence(clinic,cv);
 const topic=TOPICS.find(item=>evidenceMatch.sharedTopics.includes(item.id))||positiveTopics(clinic)[0]||null;
 const connectionName=confirmConnection===true?safeFact(selectedConnection?.name):'',connectionSentence=connectionName&&connectionName.length<=140?` I would also welcome the opportunity to speak with ${connectionName} about the practice and the requirements of a supervised GP role.`:'';
 const clinicReason=clinicParagraph(name,clinic,topic)+(name&&clinic?connectionSentence:''),candidateValue=cv&&confirmed?candidateParagraph(cv,evidenceMatch):'{{cvEvidence}}';
 const gaps=[];
 if(!clinic)gaps.push('clinic_facts_missing');if(!cv)gaps.push('cv_facts_missing');if(!confirmed)gaps.push('cv_not_confirmed');
 if(clinic&&NEGATIVE.test(clinic))gaps.push('clinic_statement_limitation_requires_review');if(evidenceMatch.cvScope==='limitation')gaps.push('cv_limitation_requires_review');
 if(['research','training'].includes(evidenceMatch.cvScope))gaps.push('cv_clinical_scope_not_established');if(clinic&&cv&&!evidenceMatch.sharedServices.length)gaps.push('no_specific_service_overlap');
 return {clinicReason,candidateValue,topic:topic?.id||'general_practice',evidenceMatch,
  factBasis:{clinic:clinic?[{text:clinic,sourceURL:sourceURL(clinicSourceURL),readAt:readAt(clinicReadAt)}]:[],cv:cv?[{text:cv,status:confirmed?'owner_confirmed_self_report':'owner_confirmation_required'}]:[],sharedTopics:evidenceMatch.sharedTopics,unsupportedInferences:[...UNSUPPORTED]},
  writingQuality:{method:'deterministic_evidence_composer',version:'evidence-four-paragraph-v2',status:!name||!clinic||!cv||!confirmed?'incomplete':gaps.length?'evidence_review_required':'evidence_matched_draft',needsOwnerReview:true,paragraphWordCounts:{clinic:words(clinicReason),value:words(candidateValue)},preferredClinicWordRange:[25,35],gaps},
  mutualConnections:connectionSentence?{status:'owner_confirmed_contact_reference',contactId:selectedConnection.id,relationshipVerified:false}:{status:'not_asserted',reason:'No independently reviewed owner-specific relationship evidence was supplied.'}};
}

export function readGpWritingProfile(profile={}){
 const raw=profile?.planning?.gpApplicationWriting,opening=clean(raw?.openingParagraph),closing=clean(raw?.closingParagraph);
 const valid=raw?.confirmedByOwner===true&&raw?.writingVersion==='human-four-paragraph-v1'&&opening.length>=40&&opening.length<=1600&&closing.length>=15&&closing.length<=1000&&!INSTRUCTION.test(opening+' '+closing)&&!/[{}]/.test(opening+' '+closing);
 const rawEmail=typeof raw?.signatureEmail==='string'?raw.signatureEmail:'',rawPhone=typeof raw?.signaturePhone==='string'?raw.signaturePhone:'',email=clean(rawEmail),phone=clean(rawPhone),name=safeFact(profile.name||profile.fullName||profile.full_name);
 const signatureEmail=valid&&!/[\r\n]/.test(rawEmail)&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)?email:'';
 const digits=phone.replace(/\D/g,''),signaturePhone=valid&&!/[\r\n]/.test(rawPhone)&&/^[+()\d .-]{7,40}$/.test(phone)&&digits.length>=7&&digits.length<=15?phone:'',signatureName=valid&&name&&name.length<=150?name:'';
 const missingSignatureFields=[];for(const [missing,code]of[[!signatureName,'signature_name_required'],[!signatureEmail,'signature_email_required'],[!signaturePhone,'signature_phone_required']])if(missing)missingSignatureFields.push(code);
 return {confirmed:valid,opening:valid?opening:'{{openingParagraph}}',closing:valid?closing:'{{closingParagraph}}',signatureName,signatureEmail,signaturePhone,missingSignatureFields,
  signatureStatus:{complete:missingSignatureFields.length===0,namePresent:Boolean(signatureName),emailPresent:Boolean(signatureEmail),phonePresent:Boolean(signaturePhone),source:'own_private_writing_profile',status:missingSignatureFields.length?'owner_contact_confirmation_required':'owner_confirmed_profile_contacts'},
  version:'human-four-paragraph-v1',issues:(Array.isArray(raw?.issues)?raw.issues:[]).slice(0,5).filter(item=>typeof item?.code==='string'&&typeof item?.message==='string').map(item=>({code:clean(item.code).slice(0,80),message:clean(item.message).slice(0,600)}))};
}
