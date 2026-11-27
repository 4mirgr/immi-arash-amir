// Prioritizes explicit GP/IMG advertisement evidence, never personal eligibility.
import {screenOpportunity} from './opportunity-screening.mjs';
const label='امکان سوپرویژن Level 1';
const conditional=/\b(?:not|no|never|cannot|can't|unable|may|might|could|if|subject to|potential(?:ly)?)\b/i;
function sentences(item){return ['title','summary','fullText'].flatMap(key=>typeof item?.[key]==='string'?item[key].slice(0,25000).replace(/<[^>]*>/g,' ').split(/(?<=[.!?;])\s+|\n+/):[]).map(x=>x.trim()).filter(x=>x&&x.length<=600);}
const normalizeWording=text=>text.replace(/[’‘]/g,"'").replace(/[‐‑]/g,'-');
const levelOneRange='level[ -]*(?:1|one)(?:\\s*(?:[-–—]|to|or)\\s*2)?\\s*(?:clinical\\s+)?supervision';
const levelOneMention=new RegExp('\\b'+levelOneRange+'\\b|\\bsupervision\\s+level[ -]*(?:1|one)\\b','i');
const deniedLevelOne=new RegExp([
 '\\b(?:no|without)\\s+'+levelOneRange+'\\b',
 '\\b'+levelOneRange+'\\s+(?:is\\s+|will be\\s+)?(?:not (?:available|provided|offered|supported)|unavailable|cannot be (?:offered|provided|supported))\\b',
 "\\b(?:cannot|can't|do not|don't|does not|doesn't|will not|won't|unable to|not able to)\\s+(?:currently\\s+)?(?:offer|provide|support)\\s+"+levelOneRange+'\\b',
 "\\b(?:cannot|can't|do not|don't|does not|doesn't|will not|won't|unable to|not able to)\\s+(?:currently\\s+)?(?:accommodate|accept|consider|support)\\b[^.!?;]{0,100}\\b(?:require(?:s|d)?|requiring|need(?:s|ing)?|under|on)\\s+"+levelOneRange+'\\b',
 "\\b(?:do not|don't|does not|doesn't)\\s+(?:currently\\s+)?have\\s+(?:any\\s+)?(?:positions?\\s+for|capacity\\s+for)\\s+(?:PESCI\\s+or\\s+)?"+levelOneRange+'\\b',
].join('|'),'i');
function levelOne(parts){
 const excerpts=[];
 for(const text of parts){
  const wording=normalizeWording(text);
  if(/\b(?:PESCI|supervision)\b[^.!?;]{0,90}\blevel\s*[2-4]\s*(?:or above|and above|minimum|\+)|\blevel\s*[2-4]\s*(?:or above|and above|\+)\s*(?:clinical\s+)?supervision\b/i.test(wording)&&!conditional.test(wording)){excerpts.push({text,status:'restricted',reason:'stated_minimum_supervision_level_above_one'});continue;}
  if(!levelOneMention.test(wording))continue;
  const denied=deniedLevelOne.test(wording)&&!/\b(?:doctors?|candidates?|applicants?)\s+(?:who\s+)?(?:do not|don't|never)\s+(?:require|need)\b/i.test(wording);
  const providerDuty=/\b(?:GP|general practitioner|applicant|candidate|you)\b[^.!?;]{0,70}\b(?:capacity|ability|responsibility|qualified)\s+to\s+(?:offer|provide|support)\b|\byou\s+(?:will|must|would)\s+(?:offer|provide)\b/i.test(wording);
  const affirmative=/\blevel[ -]*(?:1|one)\s+(?:clinical\s+)?supervision\s+(?:is\s+|will be\s+)?(?:available|provided|offered)\b|\b(?:offer|provide|support)\s+level[ -]*(?:1|one)\s+(?:clinical\s+)?supervision\b/i.test(wording);
  const status=denied?'restricted':affirmative&&!providerDuty&&!conditional.test(wording)?'supported':'not_stated';
  excerpts.push({text,status,reason:denied?'explicit_restriction':status==='supported'?'explicit_advertisement_statement':'conditional_or_unspecified_statement'});
 }
 return {label,status:excerpts.some(x=>x.status==='restricted')?'restricted':excerpts.some(x=>x.status==='supported')?'supported':'not_stated',excerpts:excerpts.sort((a,b)=>Number(b.status==='restricted')-Number(a.status==='restricted')).slice(0,3)};
}
function routeBarriers(title,parts){
 const barriers=[];
 const supervisorTitle=/^(?:(?:vr |senior )?(?:general practitioner|GP)\s*[/&:–—-]\s*(?:GP |clinical )?supervisor|(?:GP|general practice|clinical) supervisor)(?=$|\s*[|–—-]|\s*\(|\s+at\b)/i;
 const supervisorHire=parts.find(text=>/\b(?:seeking|hiring|recruiting|looking for)\s+(?:an?\s+)?(?:experienced\s+|senior\s+|vocationally registered\s+)?(?:general practitioner|GP)\s+(?:with the (?:capacity|ability) to|to)\s+(?:offer|provide)\s+level[ -]*(?:1|one)\s+(?:clinical\s+)?supervision\b/i.test(normalizeWording(text)));
 if(supervisorTitle.test(title.trim())||supervisorHire)barriers.push({code:'supervisor_hire',field:'role',text:supervisorHire||title});
 const priorPesci=parts.find(text=>{
  const wording=normalizeWording(text);
  return !/\b(?:not|no|preferred|desirable|may|might|if|whether)\b/i.test(wording)&&(
   /\b(?:must|required to|need to)\s+(?:already\s+)?(?:have\s+)?(?:successfully\s+)?(?:pass(?:ed)?|complete[ds]?)\s+(?:the\s+)?PESCI\b[^.!?;]{0,45}\b(?:before|prior to|at the time of)\s+(?:you\s+apply|applying|(?:an?\s+|your\s+|the\s+)?applications?|being considered)\b/i.test(wording)||
   /\b(?:only (?:consider|accept)|only (?:applicants?|candidates?|IMGs?)\b)[^.!?;]{0,95}\b(?:have|having)\s+(?:already\s+)?(?:passed|completed)\s+(?:the\s+)?PESCI\b/i.test(wording)||
   /\b(?:seeking|looking for|recruiting)\b[^.!?;]{0,110}\b(?:candidate|applicant|doctor|GP)\s+who\s+has already\b[^.!?;]{0,50}\bpassed\s+(?:their\s+|the\s+)?PESCI\b/i.test(wording));
 });
 if(priorPesci)barriers.push({code:'pesci_before_application',field:'pesci',text:priorPesci});
 const resident=parts.find(text=>/\b(?:must|need to|required to)\s+(?:already\s+|currently\s+)?(?:reside|live|be based)\s+in Australia\b|\b(?:must|need to|required to)\s+(?:already\s+|currently\s+)be\s+in Australia\b/i.test(text)&&!/\b(?:not|before (?:commencement|commencing|starting)|after relocation|when commencing)\b/i.test(text));
 if(resident)barriers.push({code:'australian_residence_required',field:'residence',text:resident});
 return barriers;
}
export function assessOpportunityFit(item,profileId='arash',existingScreening=null){
 if(!['amir','arash'].includes(profileId))throw new TypeError('Invalid fit profile');
 const screening=existingScreening?.profileId===profileId&&existingScreening.fields?existingScreening:screenOpportunity(item,profileId),parts=sentences(item);
 const signals={level1:levelOne(parts),...screening.fields};
 // A fellowship prerequisite is source evidence, not a finding that this person lacks it.
 const prerequisites=parts.filter(text=>!/(?:not required|not essential|not mandatory|preferred|working towards)/i.test(text)&&/\b(?:FRACGP|FACRRM|FRACP|fellowship of (?:RACGP|ACRRM|RACP))\b[^.!?;]{0,100}\b(?:required|essential|mandatory)\b|\b(?:must (?:have|hold)|require[ds]?)\b[^.!?;]{0,100}\b(?:FRACGP|FACRRM|FRACP|fellowship)\b/i.test(text));
 if(prerequisites.length)signals.registration={...signals.registration,status:'restricted',excerpts:[...prerequisites.map(text=>({text,status:'restricted',reason:'stated_qualification_prerequisite'})),...signals.registration.excerpts].slice(0,3)};
 const title=typeof item?.title==='string'?item.title.slice(0,600):'',barriers=screening.applicable?routeBarriers(title,parts):[];
 const positives=[],restrictions=barriers.map(({field,text})=>({field,text})),unknowns=[];
 for(const [field,signal]of Object.entries(signals)){
  if(signal.status==='not_stated'&&!barriers.some(barrier=>barrier.field===field))unknowns.push(field);
  for(const quote of signal.excerpts){if(quote.status==='supported')positives.push({field,text:quote.text});if(quote.status==='restricted')restrictions.push({field,text:quote.text});}
 }
 const applicable=profileId==='arash'&&screening.applicable;
 const roleRelevant=/\b(?:general practitioner|general practice|rural generalist|medical officer|medical practitioner|GP)\b/i.test(title)&&!/\b(?:nurs(?:e|ing)|manager|reception|administrator)\b/i.test(title)&&!barriers.some(barrier=>barrier.code==='supervisor_hire');
 const closed=['closed','source_removed','future'].includes(item?.status),register=item?.kind==='employment_register';
 const strong=signals.level1.status==='supported'&&signals.img.status==='supported'&&(signals.supervision.status==='supported'||signals.sponsorship.status==='supported');
 const priority=applicable&&(closed||restrictions.length)?'restricted':applicable&&roleRelevant&&!register&&strong?'high':'clarification';
 return {version:1,profileId,applicable,roleRelevant,priority,signals,positives:positives.slice(0,12),restrictions:restrictions.slice(0,12),barriers,unknowns,sourceUrl:screening.sourceUrl,eligibility:'not_assessed',currentVacancy:'not_verified',profileContext:'route_focus_only_no_private_credentials_assessed',meaning:'text_evidence_not_acceptance_probability',limitations:[
  'Priority compares explicit advertisement wording for the GP/IMG route; no private CV, credential, registration or acceptance outcome is assessed.',
  'Restricted includes stated prerequisites and closed/source-removed records; it is not a personal ineligibility decision.',
  'High means useful explicit follow-up evidence only. Supervision approval, PESCI eligibility, sponsorship and current vacancy still require confirmation.',
  'Unknowns remain unknown; absence of a restriction never becomes permission.'
 ]};
}

/** Sort only a returned page; never imply that later pages were globally ranked. */
export function sortOpportunityPageByFit(items){const rank={high:0,clarification:1,restricted:2};return items.map((item,index)=>({item,index})).sort((a,b)=>(rank[a.item.fit?.priority]??1)-(rank[b.item.fit?.priority]??1)||a.index-b.index).map(x=>x.item);}

/** Own authenticated profile only. Statements are unverified and never affect ranking. */
export function deriveProfileReadiness(input,profileId){
 if(!['amir','arash'].includes(profileId))throw new TypeError('Invalid fit profile');
 const valid=input&&typeof input==='object'&&!Array.isArray(input)&&![input.profileId,input.profile_id,input.id].some(id=>id!=null&&id!==profileId);
 const data=valid?input:{},cv=typeof data.cvText==='string'?data.cvText.slice(0,150000):'',planning=data.planning&&typeof data.planning==='object'?data.planning:{},exam=planning.exams?.amcMcq;
 const state=typeof exam==='string'?exam:exam?.status;
 const negatives=/\b(?:not (?:yet )?passed|failed|preparing|awaiting|not_taken|pending|will|expect(?:ed)?|plan(?:ning)? to|aim(?:ing)? to)\b|قبول نشده|آمادگی/i;
 const mcqSentences=cv.split(/(?<=[.!?;])\s+|\n+/).filter(text=>/\bAMC\b[^.!?;]{0,50}(?:MCQ|part\s*(?:1|one))|\bMCQ\b[^.!?;]{0,50}\bAMC\b/i.test(text));
 const explicitPass=mcqSentences.some(text=>/\bpass(?:ed)?\b|قبول شده/i.test(text)&&!negatives.test(text));
 const amcMcq=negatives.test(String(state||''))||mcqSentences.some(text=>negatives.test(text))?'not_stated':['passed','pass','self_reported_pass'].includes(state)||explicitPass?'self_reported_pass':'not_stated';
 const language=planning.language&&Object.keys(planning.language).length||/\b(?:IELTS|OET|PTE|TOEFL|B2|English proficiency)\b/i.test(cv)?'self_reported_only':'not_stated';
 const gaps=[...(!cv.trim()?['رزومهٔ همین حساب هنوز ثبت نشده است.']:[]),amcMcq==='self_reported_pass'?'قبولی AMC MCQ خوداظهاری است؛ اصل نتیجه و تاریخ آن باید بررسی شود.':'وضعیت و مدرک AMC MCQ برای این پرونده نیازمند تأیید است.',language==='self_reported_only'?'اطلاعات زبان خوداظهاری است؛ نمره، تاریخ و اعتبار نتیجه باید بررسی شود.':'وضعیت آزمون زبان و نتیجهٔ معتبر هنوز مشخص نیست.','ثبت Ahpra و شرایط نظارت، PESCI و اسپانسرشیپ باید برای همین سمت جداگانه تأیید شوند.'];
 return {profileId,hasCV:!!cv.trim(),amcMcq,language,registration:'not_verified',gaps,source:'own_private_profile_self_reported'};
}
