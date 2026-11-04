// Extractive reading evidence only. No model, private profile, network or action execution.
const MAX_TEXT=50000,MAX_EXCERPTS=6,MAX_EXCERPT=700;
const patterns={
 health:/\b(?:medicin[ae]?|medical|health|sanit[aà]|salute|clinical?|clinic[ao]|biomedic\w*|biolog\w*|life sciences?|scienze della vita|farmac\w*|pharmac\w*|neuroscien\w*|oncolog\w*|cardiovas\w*|immunolog\w*|epidemiolog\w*|general practitioner|rural generalist|PESCI|IMGs?)\b/i,
 medicine:/\b(?:medicin[ae]?|medical|clinical?|clinic[ao]|sanit[aà])\b/i,
 biomedical:/\b(?:biomedic\w*|biolog\w*|life sciences?|scienze della vita|farmac\w*|pharmac\w*|neuroscien\w*|immunolog\w*)\b/i,
 publicHealth:/\b(?:public health|salute pubblica|epidemiolog\w*|population health)\b/i,
 gp:/\b(?:general practitioner|general practice|rural generalist|supervision|supervised practice|IMGs?|international medical graduates?)\b/i,
 pesci:/\bPESCI\b/i,
 language:/\b(?:IELTS|OET|TOEFL|English language|lingua inglese|language certificate|certificazione linguistica)\b/i,
 call:/\b(?:bando|bandi|call for (?:applications?|proposals?|candidates?)|concorso|concorsi|selection notice|avviso di selezione|selezione pubblica)\b/i,
 admission:/\b(?:admission|ammissione|accesso al|access requirements|requisiti di accesso|entry requirements|doctoral|dottorat\w*|Ph\.?D\.?)\b/i,
 funding:/\b(?:scholarships?|funding|funded|(?:(?:research|funded|doctoral|postdoctoral) fellowships?|fellowships? (?:funding|award|stipend))|bors[ae] (?:di|per il|per) (?:studio|ricerca|dottorat\w*)|finanziament\w*|grant(?:s)?|stipend(?:s)?|contribut[oi])\b/i,
 career:/\b(?:vacanc(?:y|ies)|job offer|job opportunities|employment|recruitment|careers?|(?:research|medical|GP|academic|vacant) positions?|positions? available|posto di lavoro|posti di lavoro|assunzion\w*|reclutament\w*)\b/i,
 development:/\b(?:CPD|continuing professional development|congress|conference|convegno|convegni|workshop|formazione|training course|corso di formazione)\b/i,
 requirements:/\b(?:must|mandatory|required|requirements?|prerequisite|essential criteria|eligib(?:le|ility)|requisit\w*|obbligatori\w*|necessari\w*|dev(?:e|ono)|laurea|degree|qualification|document[oi]|curriculum|certificat\w*|registration|Ahpra|AMC|fellowship|specializzazione)\b/i,
 deadline:/\b(?:deadline|closing date|applications? close|submit by|due date|scadenz[ae]|entro il|termine per|termine di presentazione)\b/i,
 action:/\b(?:apply|submit|upload|register|complete the application|read the (?:full )?call|consultare|consulta il|presentare domanda|presentazione della domanda|inviare|candidarsi|verificare|scaricare)\b/i,
 guidance:/\b(?:guidance|guidelines?|procedure|procedura|how to|come (?:presentare|candidarsi|richiedere)|support|assistance|international applicants?|candidati internazionali)\b/i
};
const injection=/\b(?:ignore (?:all |the |any )?(?:previous|prior|system) instructions?|system prompt|developer message|reveal (?:the )?(?:secret|token|password)|send (?:the |your )?(?:API key|password|access token)|disregard (?:all |the )?(?:previous|prior) instructions?|ignora(?:re)? (?:tutte )?(?:le )?istruzioni precedenti|rivela(?:re)? (?:la |il |le )?(?:password|token|credenziali)|invia(?:re)? (?:la |il |le )?(?:password|token|credenziali|chiave API))\b/i;
const boilerplateTitle=/\b(?:privacy policy|cookie policy|informativa privacy|informativa sul trattamento|politica (?:dei|sui) cookie|accessibilit[aà]|accessibility statement|legal notice)\b/i;
const boilerplateLine=/^(?:accept (?:all )?cookies|manage cookies|cookie (?:settings|preferences|policy)|privacy policy|informativa privacy|all rights reserved|tutti i diritti riservati|copyright\b|skip to (?:main )?content|salta (?:al|il) contenuto)/i;

function sourceUrl(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^\d+(?:\.\d+){3}$/.test(u.hostname)||u.hostname.includes(':')||/(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname))return null;u.hash='';return u.href;}catch{return null;}
}
function clean(value,max){return typeof value==='string'?value.slice(0,max).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').replace(/[ \t]+/g,' ').trim():'';}
function sentences(text){
 // Preserve negation and numeric decimal amounts; punctuation only splits before whitespace.
 return [...new Set(text.split(/\n+|(?<=[.!?;])\s+(?=[A-ZÀ-ÖØ-Þ0-9])/u).map(x=>x.trim()).filter(x=>x.length>=18&&!boilerplateLine.test(x)&&!injection.test(x)))];
}
function excerpts(parts,pattern){return parts.filter(x=>pattern.test(x)).slice(0,MAX_EXCERPTS).map(text=>({text:text.slice(0,MAX_EXCERPT)}));}

/** null means there is no usable, actually-read content to evaluate. */
export function analyzePublicPage(record,{profileId='amir',country='IT'}={}){
 if(!['amir','arash'].includes(profileId)||!['IT','AU'].includes(country))throw new TypeError('Invalid analysis scope');
 if(country==='IT'&&profileId!=='amir')throw new TypeError('Italy analysis is Amir-only');
 if(!record||!['read','read_partial'].includes(record.status))return null;
 const url=sourceUrl(record.url),text=clean(record.text,MAX_TEXT),title=clean(record.title,500);
 if(!url||text.length<60||typeof record.readAt!=='string'||!Number.isFinite(Date.parse(record.readAt)))return null;
 const partialReading=record.status==='read_partial'||clean(record.text,MAX_TEXT+1).length>MAX_TEXT;
 const parts=sentences(text),omittedLongPassages=parts.filter(x=>x.length>MAX_EXCERPT).length,usable=boilerplateTitle.test(title)?[]:parts.filter(x=>x.length<=MAX_EXCERPT);
 const combined=[title,...usable].join('\n'),healthRelevance=usable.some(x=>patterns.health.test(x))?'explicit':'not_stated';
 const jobUrl=/\/(?:jobs?|vacancies|careers?)(?:\/|$)|viewFullSingle|job-details/i.test(new URL(url).pathname);
 const clinicalTitle=/\b(?:general practitioner|rural generalist|medical officer|medical practitioner|staff specialist|registrar|resident medical|clinical fellow)\b/i.test(title);
 const careerTitle=/\b(?:vacanc(?:y|ies)|careers?|job (?:details|opportunities)|recruitment|employment)\b/i.test(title);
 const sourceCareer=country==='AU'&&((jobUrl&&(healthRelevance==='explicit'||patterns.career.test(combined)))||(clinicalTitle&&patterns.career.test(combined))||(careerTitle&&patterns.health.test(combined)));
 let category='unrelated';
 if(usable.length){
  if(sourceCareer)category='career';
  else if(patterns.call.test(combined))category='call';
  else if(patterns.admission.test(combined))category='admission';
  else if(patterns.funding.test(combined))category='funding';
  else if(patterns.career.test(combined))category='career';
  else if(patterns.development.test(combined))category='development';
  else if(patterns.guidance.test(combined)||healthRelevance==='explicit')category='guidance';
  else if(usable.length<5||/\b(?:home page|homepage|sitemap|site map|indice|menu|university homepage)\b/i.test(title))category='navigation';
 }
 const requirements=excerpts(usable,patterns.requirements),funding=excerpts(usable,patterns.funding),deadlines=excerpts(usable,patterns.deadline),actions=excerpts(usable,patterns.action);
 const chosen=[...usable.filter(x=>patterns.health.test(x)),...usable.filter(x=>patterns.call.test(x)||patterns.admission.test(x)||patterns.funding.test(x)),...usable];
 const summary=[...new Set(chosen)].slice(0,3).map(x=>x.slice(0,MAX_EXCERPT)).join(' ').slice(0,1800);
 const archiveEvidence=usable.filter(x=>/\b(?:applications? (?:are |have been )?closed|call (?:is |has )?(?:closed|expired)|bando (?:scaduto|chiuso)|bandi scaduti|termine (?:scaduto|decorso)|selezione conclusa)\b/i.test(x)&&!/\b(?:not|non)\b/i.test(x)).slice(0,3).map(text=>({text:text.slice(0,MAX_EXCERPT)}));
 const uncertainty=usable.filter(x=>/\b(?:not guaranteed|subject to|may be|might|non garant|subordinat[oa]|salvo disponibilit[aà]|eventual[ei])\b/i.test(x)).slice(0,3).map(text=>({text:text.slice(0,MAX_EXCERPT)}));
 const topics=[];for(const [key,pattern] of [['medicine',patterns.medicine],['biomedical_life_sciences',patterns.biomedical],['public_health',patterns.publicHealth],['gp_img_supervision',patterns.gp],['pesci',patterns.pesci],['language_evidence',patterns.language]])if(usable.some(x=>pattern.test(x)))topics.push(key);
 return {version:1,profileId,country,category,topics,healthRelevance,partialReading,sourceReadStatus:record.status,textEvaluatedCharacters:text.length,omittedLongPassages,summary,requirements,funding,deadlines,actions,archiveEvidence,uncertainty,sourceUrl:url,readAt:record.readAt,institutionIds:Array.isArray(record.institutionIds)?[...new Set(record.institutionIds.filter(x=>typeof x==='string'&&x.length<=200))].slice(0,30):[],eligibility:'not_assessed',currentCallStatus:'not_verified',reviewStatus:'machine_extracted_requires_review',limitations:[
  'Evidence was extracted from retrieved page text only; this is not a personal eligibility, clinical registration or admission decision.',
  'The page can be a call index, overview or archive. An extract never proves an individual call is currently open or fully funded.',
  'Displayed deadlines and amounts are verbatim source text; timezone, exact cutoff, currency period and applicability require full-call verification.',
  'PDF annexes and further linked pages are independent documents and are not read merely because this page links to them.',
  ...(omittedLongPassages?['Some long passages were omitted rather than truncating legal conditions or negation; read the full original source.']:[]),
  ...(partialReading?['Reading is partial: only the retrieved/extracted portion, capped at 50000 characters, was evaluated; the full source has not been assessed.']:[]),
  ...(Array.isArray(record.limitations)?record.limitations.filter(x=>typeof x==='string').slice(0,3).map(x=>x.slice(0,500)):[])
 ]};
}
