// Bounded, deterministic writing from the owner's CV and published clinic
// evidence. This fallback is not an LLM and never researches or invents facts.
const clean=value=>typeof value==='string'?value.replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim():'';
const INSTRUCTION=/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|send.{0,40}(?:token|secret)|javascript:/i;
const NEGATIVE=/\b(?:no|not|never|without|lack(?:s|ing)?|unable|cannot|can't|limited)\b/i;
const TOPICS=[
 {id:'learning',match:/\b(?:teaching|training|registrar|medical students?|education|supervis\w*)\b/i,interest:'learning through clinical discussion and feedback'},
 {id:'team_care',match:/\b(?:multidisciplinary|allied health|team|collaborat\w*|referral)\b/i,interest:'working with colleagues and coordinating patient care'},
 {id:'chronic_care',match:/\b(?:chronic|diabetes|hypertension|cardiovascular|respiratory|preventive|prevention|continuity|follow-up)\b/i,interest:'longitudinal general practice that brings ongoing disease management and prevention together'},
 {id:'acute_care',match:/\b(?:acute|emergency|urgent|24[- ]hour|extended hours|seven[- ]day|7[- ]day)\b/i,interest:'general practice with a broad clinical scope and accessible patient care'},
 {id:'community',match:/\b(?:community|family|rural|regional|patient.centred|patient.centered)\b/i,interest:'a long-term role in community general practice'},
 {id:'procedures',match:/\b(?:minor procedures?|wound|suturing|sutur(?:e|es)|splint(?:ing)?|fracture|treatment room)\b/i,interest:'combining clinical consultations with hands-on patient care'},
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
 {id:'skin_health',match:/\b(?:skin (?:care|health|checks?|cancer|medicine)|dermatolog\w*)\b/i,label:'skin health care'},
 {id:'women_health',match:/\b(?:women(?:'s|’s)? health|antenatal care)\b/i,label:'women’s health care'},
 {id:'older_people',match:/\b(?:aged care|elderly|older patients?|older people)\b/i,label:'care for older people'},
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
const GP_NETWORKS=['IPN','ForHealth','Sonic HealthPlus','Ochre Health','Partnered Health','Healius','NCN Health'];
// This chooses letter emphasis from publisher wording, never a registration,
// visa or independently verified MMM classification. Unknown stays B.
export function classifyGpApplicationVariant({practiceName='',sourceText='',location='',city=''}={}){
 const name=clean(practiceName),statements=[sourceText,location,city].filter(value=>typeof value==='string').flatMap(value=>value.slice(0,50000).split(/\n+|(?<=[.!?;])\s+/)).map(clean).filter(value=>value&&!INSTRUCTION.test(value));
 const positive=statements.filter(value=>!NEGATIVE.test(value));
 const quotedMMM=positive.flatMap(value=>[...value.matchAll(/\b(?:MMM|MM|Modified\s+Monash(?:\s+Model)?)\s*(?:category|classification)?\s*[:=\-]?\s*([1-7])(?:\s*(?:[-–—]|to)\s*(?:(?:MMM|MM)\s*)?([1-7]))?\b/gi)].map(match=>[Number(match[1]),Number(match[2]||match[1])])).filter(([low,high])=>high>=low);
 const mixedMMM=quotedMMM.some(([low])=>low<=2)&&quotedMMM.some(([,high])=>high>=3);
 const rural=!mixedMMM&&(quotedMMM.some(([low])=>low>=3)||positive.some(value=>/\b(?:rural|regional|remote)\s+(?:(?:general|medical|family|Australian)\s+){0,2}(?:clinic|practice|community|communities|town|location|area|position|role)\b|\brural generalist\b|\b(?:based|located|situated|work(?:ing)?)\s+in\s+(?:(?:a|our|the)\s+)?(?:rural|regional|remote)\b/i.test(value))||[location,city].some(value=>typeof value==='string'&&!INSTRUCTION.test(value)&&!/\b(?:not|no|non[- ])\b/i.test(value)&&/^\s*(?:regional|rural|remote)\b/i.test(value)));
 const urban=!mixedMMM&&(quotedMMM.some(([,high])=>high<=2)||positive.some(value=>/\b(?:metropolitan|urban)\b/i.test(value)));
 const network=GP_NETWORKS.find(item=>{
  const escaped=item.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),named=new RegExp('\\b'+escaped+'\\b','i');
  return named.test(name)||positive.some(value=>new RegExp('(?:part of (?:the )?'+escaped+'\\b|\\b'+escaped+' (?:network|medical centres?|practices?))','i').test(value));
 })||null;
 const variant=rural?'C':network&&urban?'A':'B';
 return {variant,network,reasons:[rural?'explicit_rural_or_mmm3_7_source_wording':network&&urban?'published_network_and_urban_wording':'independent_or_unknown_location_or_network_default'],eligibility:'not_assessed'};
}
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
 if(!phrase||words(phrase)>27||/\b(?:we|our|I|your|you|a GP|general practitioner (?:to|with))\b/i.test(phrase)||!positiveTopics(phrase).length&&!services(phrase).length)return null;
 return phrase;
}
function supportingClinicFact(name,primary,candidates,primaryURL,now){
 const root=sourceURL(primaryURL);if(!root||!Number.isFinite(now))return null;
 const primaryTopics=positiveTopics(primary).map(topic=>topic.id),options=[];
 for(const item of (Array.isArray(candidates)?candidates:[]).slice(0,36)){
  const fact=safeFact(item?.text),url=sourceURL(item?.sourceURL||item?.sourceUrl),at=readAt(item?.readAt);
  if(!fact||!url||!at||Date.parse(at)>now+60000||now-Date.parse(at)>7*86400000||new URL(url).hostname.replace(/^www\./,'')!==new URL(root).hostname.replace(/^www\./,'')||fact===primary||primary.includes(fact)||fact.includes(primary)||NEGATIVE.test(fact)||!/^(?:Our (?:practice|clinic|team)|We)\b/i.test(fact)&&!fact.toLowerCase().includes(name.toLowerCase())||/\b(?:sponsorship|visa|PESCI|Level\s*[1-4]|patients?\s+per|patient (?:numbers?|volume)|crisis|shortage)\b/i.test(fact))continue;
  // A shared domain may contain several branches. A linked page's generic
  // "our clinic" cannot establish that it describes this particular practice.
  if(url!==root&&!fact.toLowerCase().includes(name.toLowerCase()))continue;
  const topics=positiveTopics(fact);if(!topics.length)continue;
  const services=servicesPhrase(fact),setting=fact.match(/\b(?:is|operates as)\s+((?:a|an)\s+[^.!?;]+)/i)?.[1]?.replace(/[.;:,]+$/,'');
  const preciseSetting=setting&&words(setting)<=27&&!/\b(?:our|your|you)\b|\b(?:contact|phone|email)\s*:/i.test(setting)?setting:null;
  const sentence=services?`I am also drawn to your work in ${services}.`:preciseSetting?`Your role as ${preciseSetting} also appeals to me.`:null;
  if(sentence)options.push({text:fact,sourceURL:url,readAt:at,sentence,distinct:topics.some(topic=>!primaryTopics.includes(topic.id))});
 }
 return options.find(item=>item.distinct)||options[0]||null;
}
function clinicParagraph(name,clinic,topic){
 if(!name||!clinic)return '{{clinicEvidence}}';
 if(NEGATIVE.test(clinic))return `${clinicFact(name,clinic)} I would wish to clarify these requirements before considering whether a supervised appointment could be appropriate.`;
 const phrase=servicesPhrase(clinic),topics=positiveTopics(clinic).map(item=>item.id);
 // Keep a specific teaching/community description (including a named
 // affiliation) instead of reducing it to generic "clinical learning".
 const describedSetting=clinic.match(/\b(?:is|operates as)\s+((?:a|an)\s+[^.!?;]+)/i)?.[1]?.replace(/[.;:,]+$/,'');
 const setting=describedSetting&&words(describedSetting)<=32&&!/\b(?:we|our|your|you)\b|\b(?:contact|phone|email)\s*:/i.test(describedSetting)&&(positiveTopics(describedSetting).length||services(describedSetting).length)?describedSetting:null;
 const feature=phrase||(
  topics.includes('learning')?'emphasis on clinical learning':
  topics.includes('team_care')?'team approach to patient care':
  topics.includes('chronic_care')?'work in continuing patient care':
  topics.includes('acute_care')?'acute clinical work':
  topics.includes('community')?'work in community general practice':
  topics.includes('procedures')?'hands-on clinical work':
  services(clinic).length?'work in '+list(services(clinic).slice(0,2).map(item=>item.label)):null);
 if(!feature)return `I would welcome a discussion about joining ${name} and the clinical work described by your practice. I would like to understand how I could contribute within an appropriately supervised role.`;
 const reason=topic?.id==='learning'?'I would value regular case discussion and feedback as part of a practice where clinical development is integrated into day-to-day patient care.':
  topic?.id==='team_care'?'I would value a setting where shared clinical decisions and coordinated follow-up help patients receive consistent care across the team.':
  topic?.id==='chronic_care'?'I would value the opportunity to combine continuity, preventive care and thoughtful follow-up in a long-term role with your team.':
  topic?.id==='acute_care'?'I would welcome the clinical variety and the opportunity to contribute to responsive, well-coordinated care alongside an experienced team.':
  topic?.id==='community'?'I would value building lasting relationships with patients and colleagues while contributing to the community through consistent day-to-day care.':
  topic?.id==='procedures'?'I would value a role that combines considered clinical assessment, practical patient care and the opportunity to follow patients through their treatment.':
  'I would value the opportunity to understand your clinical priorities and contribute to a stable, collaborative practice over the long term.';
 return `I am particularly interested in joining ${name} ${!phrase&&setting?'because it is '+setting:'for its '+feature}. ${reason}`;
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
const safeStrengths=value=>Array.isArray(value)?[...new Set(value.map(safeFact).filter(fact=>fact&&!NEGATIVE.test(fact)&&!/ندارم|نمی‌توانم|نمی توانم|بدون تجربه/.test(fact)))].slice(0,6):[];
function clinicalApproach(strengths,match){
 const source=safeStrengths(strengths).join(' ');if(!source)return null;
 const triage=/\b(?:triage|acuity|prioriti[sz]\w*|critical)\b|بحران|تریاژ|اولویت/i.test(source),follow=/\b(?:follow[- ]?up|vitals?|reassess\w*|bedside|paraclin\w*)\b|پایش|علائم|پیگیری|بالین|پاراکلینیک/i.test(source),team=/\b(?:team\w*|coordinat\w*|collaborat\w*)\b|همکاری|هماهنگی|کادر/i.test(source),advice=/\b(?:advice|consult\w*|guidance)\b|مشورت|مشاوره/i.test(source);
 const preferred=match.preferredTopic;
 if(preferred==='team_care'&&team&&advice)return 'I value coordination across the clinical team and seeking advice when a case needs another perspective.';
 if((preferred==='acute_care'||!preferred&&match.sharedTopics.includes('acute_care'))&&triage&&follow)return 'My approach is to prioritise by clinical urgency, reassess patients as their condition evolves and '+(advice?'seek advice when needed.':team?'coordinate care with colleagues.':'follow important clinical changes through.');
 if(follow&&(preferred==='chronic_care'||!preferred&&match.sharedTopics.includes('chronic_care')||!team&&!advice))return 'I place importance on reassessment and following clinical changes through'+(advice?', seeking colleagues’ advice when needed.':team?', with clear communication across the clinical team.':'.');
 if(team&&advice)return 'I value coordination across the clinical team and seeking advice when a case needs another perspective.';
 if(team)return 'I place importance on working with colleagues and coordinating care across the clinical team.';
 if(advice)return 'I place importance on seeking clinical advice and discussing cases when another perspective is needed.';
 if(triage)return 'My approach is to prioritise patients according to clinical urgency.';
 return null;
}
function candidateParagraph(cv,match,professionalStrengths,name){
 if(!cv)return '{{cvEvidence}}';
 if(match.cvScope==='limitation')return `${sentence(cv)} I would want to discuss the role’s clinical requirements openly and establish an appropriate scope of work and supervision before proceeding.`;
 if(match.cvScope==='research'||match.cvScope==='training')return `${cvSentence(cv)} I would welcome the opportunity to build on this knowledge in an appropriately supervised role, while discussing the practical experience and preparation required for your clinical services.`;
 const opening=professionalBackground(cv);
 const approach=clinicalApproach(professionalStrengths,match);
 const primary=match.preferredTopic,emphasise=topic=>primary?primary===topic:match.sharedTopics.includes(topic);
 const sharedServices=SERVICES.filter(item=>match.sharedServices.includes(item.id)&&!['wound','minor_procedures','suturing','fracture'].includes(item.id)).slice(0,2).map(item=>item.label);
 const clinic=name?`${name}’s`:'your';
 const focus=emphasise('chronic_care')?`I would bring this experience to ${clinic} ${sharedServices.length?list(sharedServices):'clinical work'}, supporting sound clinical decisions, clear patient communication and coordinated follow-up within the agreed supervision arrangements.`:
  emphasise('acute_care')?`At ${name||'your practice'}, I would contribute a considered approach to varied presentations: careful assessment, timely escalation and clear discussion with colleagues within the agreed supervision plan.`:
  emphasise('team_care')?`I would bring this experience to ${clinic} clinical team, with clear communication about patient care, coordinated follow-up and an active response to supervision and feedback.`:
  emphasise('learning')?`I would contribute to ${clinic} clinical work while making active use of case discussion and feedback, adapting my decisions and practice to your protocols and agreed supervision arrangements.`:
  match.sharedTopics.includes('procedures')?`At ${name||'your practice'}, I would bring a careful approach to assessment and clinical decisions, working with your team to provide consistent care within the agreed supervision arrangements.`:
  `I would bring this experience to ${clinic} day-to-day clinical work, with careful assessment, clear teamwork and a commitment to learning your protocols within an agreed supervised scope of practice.`;
 return `${opening}${approach?' '+approach:''} ${focus}`;
}

// Describe clinical responsibility rather than listing routine procedures as
// distinguishing accomplishments. Every asserted background feature must be
// present in the selected CV fact; the second sentence expresses intentions.
function professionalBackground(cv){
 const clinical=cvClauses(cv).filter(part=>cvKind(part)==='clinical_self_report').join('. ');
 const role=/\b(?:Medical Director|Technical Manager)(?:\s+of\s+[^.;,]{1,100})?/i.exec(clinical)?.[0];
 if(role)return `My background includes experience serving as ${role}.`;
 const traits=[];
 if(/\bchronic(?: disease)?\b/i.test(clinical))traits.push('chronic disease management');
 else if(/\bdiabet(?:es|ic)\b/i.test(clinical)&&/\bhypertension\b/i.test(clinical))traits.push('management of diabetes and hypertension');
 else if(/\bdiabet(?:es|ic)\b/i.test(clinical))traits.push('diabetes care');
 else if(/\bhypertension\b/i.test(clinical))traits.push('hypertension management');
 if(/\b(?:acute|emergency)\b/i.test(clinical))traits.push(/\bemergency\b/i.test(clinical)?'emergency care':'care for acute presentations');
 if(/\b(?:preventive|preventative|prevention)\b/i.test(clinical))traits.push('preventive care');
 if(/\b(?:teamwork|multidisciplinary|collaborat\w*|team coordination)\b/i.test(clinical))traits.push('working with a clinical team');
 if(/\breferrals?\b/i.test(clinical))traits.push('referral coordination');
 if(traits.length)return `My clinical work has included ${list(traits.slice(0,3))}.`;
 if(/\b(?:general practice|general practitioner|clinical (?:experience|practice|work)|patient (?:care|assessment)|patient.centred|patient.centered)\b/i.test(clinical))return 'My background includes clinical work in patient care.';
 if(/\b(?:wound|suturing|sutures?|cannul\w*|catheter\w*|epistaxis|minor procedures?|minor surgery|splint\w*|fractures?)\b/i.test(clinical))return 'My clinical work has included hands-on patient care.';
 const capability=capabilityPhrase(cv);
 return capability?`My background includes experience ${/^(?:managing|delivering|providing|assessing|performing|coordinating|supporting|treating|developing|leading|working|serving)\b/.test(capability)?'':'in '}${capability}.`:cvSentence(cv);
}

function professionalEvidenceWeight(value){
 if(cvKind(value)!=='clinical_self_report')return 0;
 let score=0;
 if(/\b(?:general practice|general practitioner|chronic|diabetes|hypertension|acute|emergency|preventive|prevention)\b/i.test(value))score+=50;
 if(/\b(?:medical director|technical manager|clinical (?:judg\w*|decision\w*)|teamwork|collaborat\w*|multidisciplinary|referral|patient.centred|patient.centered)\b/i.test(value))score+=50;
 return score;
}
export function cvEvidencePriority(value){const fact=safeFact(value);return fact?professionalEvidenceWeight(fact):0;}

export function suggestEvidencePair(clinicCandidates=[],cvCandidates=[]){
 let best=null;
 const prepare=(candidates,cv)=>candidates.map(item=>safeFact(item?.text)).filter(Boolean).map(text=>({text,summary:evidenceSummary(text,{cv}),short:words(text)<=35,professionalWeight:cv?professionalEvidenceWeight(text):0}));
 // Each source/CV fact is summarized once. The bounded pair matrix compares cached
 // summaries rather than repeating all regexes for every 24×24 combination.
 const clinics=prepare(clinicCandidates,false),cvs=prepare(cvCandidates,true);
 for(const clinic of clinics)for(const cv of cvs){
  const clinicText=clinic.text,cvText=cv.text;
  const evidenceMatch=summaryMatch(clinic.summary,cv.summary,true,true),score=(evidenceMatch.sharedServices.length?200:0)+Math.min(evidenceMatch.sharedServices.length,2)*20+evidenceMatch.sharedTopics.length*10+cv.professionalWeight+(clinic.short?2:0)+(evidenceMatch.cvScope==='clinical_self_report'?1:-1000);
  if(!best||score>best.score)best={clinicQuote:clinicText,cvQuote:cvText,topic:evidenceMatch.sharedTopics[0]||evidenceMatch.clinicTopics[0]||'general_practice',evidenceMatch,score};
 }
 if(!best)return null;const {score,...suggestion}=best;return {...suggestion,status:'suggested_requires_owner_review'};
}

export function composeClinicParagraphs({clinicName,clinicQuote,cvQuote,confirmed=false,selectedConnection=null,confirmConnection=false,clinicSourceURL=null,clinicReadAt=null,supportingClinicFacts=[],professionalStrengths=[],styleFocus=null,now=Date.now()}={}){
 const name=safeFact(clinicName),clinic=safeFact(clinicQuote),cv=safeFact(cvQuote),evidenceMatch=matchEvidence(clinic,cv);
 const focusTopics={teamwork:'team_care',continuity:'chronic_care',acute:'acute_care',training:'learning'},requestedFocus=Object.hasOwn(focusTopics,styleFocus)?focusTopics[styleFocus]:null;
 const focused=TOPICS.find(item=>item.id===requestedFocus&&positiveTopic(item,clinic));
 const topic=focused||TOPICS.find(item=>evidenceMatch.sharedTopics.includes(item.id))||positiveTopics(clinic)[0]||null;
 const candidateMatch=focused&&evidenceMatch.sharedTopics.includes(focused.id)?{...evidenceMatch,preferredTopic:focused.id}:evidenceMatch;
 const connectionName=confirmConnection===true?safeFact(selectedConnection?.name):'',connectionSentence=connectionName&&connectionName.length<=140?` I would also welcome the opportunity to speak with ${connectionName} about the practice and the requirements of a supervised GP role.`:'';
 const strengths=safeStrengths(professionalStrengths);
 const supporting=name&&clinic&&!NEGATIVE.test(clinic)?supportingClinicFact(name,clinic,supportingClinicFacts,clinicSourceURL,now):null;
 const baseReason=clinicParagraph(name,clinic,topic),boundary=baseReason.indexOf('. ');
 const clinicReason=(supporting&&boundary>=0?baseReason.slice(0,boundary+1)+' '+supporting.sentence+' '+baseReason.slice(boundary+2):baseReason)+(name&&clinic?connectionSentence:''),candidateValue=cv&&confirmed?candidateParagraph(cv,candidateMatch,strengths,name):'{{cvEvidence}}';
 const gaps=[];
 if(!clinic)gaps.push('clinic_facts_missing');if(!cv)gaps.push('cv_facts_missing');if(!confirmed)gaps.push('cv_not_confirmed');
 if(clinic&&NEGATIVE.test(clinic))gaps.push('clinic_statement_limitation_requires_review');if(evidenceMatch.cvScope==='limitation')gaps.push('cv_limitation_requires_review');
 if(['research','training'].includes(evidenceMatch.cvScope))gaps.push('cv_clinical_scope_not_established');if(clinic&&cv&&!evidenceMatch.sharedServices.length)gaps.push('no_specific_service_overlap');
 return {clinicReason,candidateValue,topic:topic?.id||'general_practice',evidenceMatch,
  factBasis:{clinic:clinic?[{text:clinic,sourceURL:sourceURL(clinicSourceURL),readAt:readAt(clinicReadAt)},...(supporting?[{text:supporting.text,sourceURL:supporting.sourceURL,readAt:supporting.readAt}]:[])]:[],cv:cv?[{text:cv,status:confirmed?'owner_confirmed_self_report':'owner_confirmation_required'}]:[],professionalStrengths:strengths.map(text=>({text,status:'owner_reported_professional_strength'})),sharedTopics:evidenceMatch.sharedTopics,unsupportedInferences:[...UNSUPPORTED]},
  writingQuality:{method:'deterministic_evidence_composer',version:'evidence-four-paragraph-v4',status:!name||!clinic||!cv||!confirmed?'incomplete':gaps.length?'evidence_review_required':'evidence_matched_draft',needsOwnerReview:true,valueEmphasis:'clinic_specific_clinical_contribution',styleFocus:{requested:['clinical_breadth',...Object.keys(focusTopics)].includes(styleFocus)?styleFocus:null,applied:focused?styleFocus:'clinical_breadth',sourceSupported:Boolean(focused)},paragraphWordCounts:{clinic:words(clinicReason),value:words(candidateValue)},preferredClinicWordRange:[30,55],gaps},
  mutualConnections:connectionSentence?{status:'owner_confirmed_contact_reference',contactId:selectedConnection.id,relationshipVerified:false}:{status:'not_asserted',reason:'No independently reviewed owner-specific relationship evidence was supplied.'}};
}

export function readGpWritingProfile(profile={},{variant='B'}={}){
 const raw=profile?.planning?.gpApplicationWriting,openingVariant=['A','B','C'].includes(variant)?variant:'B';
 const configured=raw?.openingParagraphs!==undefined;
 const opening=clean(configured?raw?.openingParagraphs?.[openingVariant]:raw?.openingParagraph),closing=clean(raw?.closingParagraph);
 const valid=raw?.confirmedByOwner===true&&raw?.writingVersion==='human-four-paragraph-v1'&&opening.length>=40&&opening.length<=1600&&closing.length>=15&&closing.length<=1000&&!INSTRUCTION.test(opening+' '+closing)&&!/[{}]/.test(opening+' '+closing);
 const ownerName=typeof raw?.signatureName==='string'&&!/[\r\n<>]/.test(raw.signatureName)?safeFact(raw.signatureName):'';
 const rawEmail=typeof raw?.signatureEmail==='string'?raw.signatureEmail:'',rawPhone=typeof raw?.signaturePhone==='string'?raw.signaturePhone:'',email=clean(rawEmail),phone=clean(rawPhone),name=ownerName||safeFact(profile.name||profile.fullName||profile.full_name);
 const signatureEmail=valid&&!/[\r\n]/.test(rawEmail)&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)?email:'';
 const digits=phone.replace(/\D/g,''),signaturePhone=valid&&!/[\r\n]/.test(rawPhone)&&/^[+()\d .-]{7,40}$/.test(phone)&&digits.length>=7&&digits.length<=15?phone:'',signatureName=valid&&name&&name.length<=150?name:'';
 let signatureLinkedIn='';
 if(valid&&typeof raw?.signatureLinkedIn==='string'&&!/[\s<>]/.test(raw.signatureLinkedIn))try{const url=new URL(raw.signatureLinkedIn);if(url.protocol==='https:'&&['linkedin.com','www.linkedin.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port&&/^\/in\/[\w%.-]+\/?$/.test(url.pathname)){url.search='';url.hash='';signatureLinkedIn=url.href;}}catch{}
 const missingSignatureFields=[];for(const [missing,code]of[[!signatureName,'signature_name_required'],[!signatureEmail,'signature_email_required'],[!signaturePhone,'signature_phone_required']])if(missing)missingSignatureFields.push(code);
 return {confirmed:valid,opening:valid?opening:'{{openingParagraph}}',openingVariant,openingSource:configured?'owner_confirmed_variant':'legacy_owner_opening',closing:valid?closing:'{{closingParagraph}}',clinicalStrengths:valid?safeStrengths(raw?.clinicalStrengths):[],signatureName,signatureEmail,signaturePhone,signatureLinkedIn,missingSignatureFields,
  signatureStatus:{complete:missingSignatureFields.length===0,namePresent:Boolean(signatureName),emailPresent:Boolean(signatureEmail),phonePresent:Boolean(signaturePhone),linkedInPresent:Boolean(signatureLinkedIn),source:'own_private_writing_profile',status:missingSignatureFields.length?'owner_contact_confirmation_required':'owner_confirmed_profile_contacts'},
  version:'human-four-paragraph-v1',issues:(Array.isArray(raw?.issues)?raw.issues:[]).slice(0,5).filter(item=>typeof item?.code==='string'&&typeof item?.message==='string').map(item=>({code:clean(item.code).slice(0,80),message:clean(item.message).slice(0,600)}))};
}
