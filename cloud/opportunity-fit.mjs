// Prioritizes explicit GP/IMG advertisement evidence, never personal eligibility.
import {screenOpportunity} from './opportunity-screening.mjs';
const label='امکان سوپرویژن Level 1';
const conditional=/\b(?:not|no|never|cannot|can't|unable|may|might|could|if|subject to|potential(?:ly)?)\b/i;
function sentences(item){return ['title','summary','fullText'].flatMap(key=>typeof item?.[key]==='string'?item[key].slice(0,25000).replace(/<[^>]*>/g,' ').split(/(?<=[.!?;])\s+|\n+/):[]).map(x=>x.trim()).filter(x=>x&&x.length<=600);}
function levelOne(parts){
 const excerpts=[];
 for(const text of parts){
  if(/\b(?:PESCI|supervision)\b[^.!?;]{0,90}\blevel\s*[2-4]\s*(?:or above|and above|minimum|\+)/i.test(text)&&!conditional.test(text)){excerpts.push({text,status:'restricted',reason:'stated_minimum_supervision_level_above_one'});continue;}
  if(!/\blevel\s*(?:1|one)\s*(?:clinical\s+)?supervision\b|\bsupervision\s+level\s*(?:1|one)\b/i.test(text))continue;
  const denied=/\b(?:no|without)\s+level\s*(?:1|one)\s+supervision\b|\blevel\s*(?:1|one)\s+supervision\s+(?:is\s+)?(?:not (?:available|provided|offered)|unavailable)\b|\b(?:cannot|can't|do not|unable to)\s+(?:offer|provide|support)\s+level\s*(?:1|one)\s+supervision\b/i.test(text);
  const affirmative=/\blevel\s*(?:1|one)\s+(?:clinical\s+)?supervision\s+(?:is\s+|will be\s+)?(?:available|provided|offered)\b|\b(?:offer|provide|support)\s+level\s*(?:1|one)\s+(?:clinical\s+)?supervision\b/i.test(text);
  const status=denied?'restricted':affirmative&&!conditional.test(text)?'supported':'not_stated';
  excerpts.push({text,status,reason:denied?'explicit_restriction':status==='supported'?'explicit_advertisement_statement':'conditional_or_unspecified_statement'});
 }
 return {label,status:excerpts.some(x=>x.status==='restricted')?'restricted':excerpts.some(x=>x.status==='supported')?'supported':'not_stated',excerpts:excerpts.sort((a,b)=>Number(b.status==='restricted')-Number(a.status==='restricted')).slice(0,3)};
}
export function assessOpportunityFit(item,profileId='arash',existingScreening=null){
 if(!['amir','arash'].includes(profileId))throw new TypeError('Invalid fit profile');
 const screening=existingScreening?.profileId===profileId&&existingScreening.fields?existingScreening:screenOpportunity(item,profileId),parts=sentences(item);
 const signals={level1:levelOne(parts),...screening.fields};
 // A fellowship prerequisite is source evidence, not a finding that this person lacks it.
 const prerequisites=parts.filter(text=>!/(?:not required|not essential|not mandatory|preferred|working towards)/i.test(text)&&/\b(?:FRACGP|FACRRM|FRACP|fellowship of (?:RACGP|ACRRM|RACP))\b[^.!?;]{0,100}\b(?:required|essential|mandatory)\b|\b(?:must (?:have|hold)|require[ds]?)\b[^.!?;]{0,100}\b(?:FRACGP|FACRRM|FRACP|fellowship)\b/i.test(text));
 if(prerequisites.length)signals.registration={...signals.registration,status:'restricted',excerpts:[...prerequisites.map(text=>({text,status:'restricted',reason:'stated_qualification_prerequisite'})),...signals.registration.excerpts].slice(0,3)};
 const positives=[],restrictions=[],unknowns=[];
 for(const [field,signal]of Object.entries(signals)){
  if(signal.status==='not_stated')unknowns.push(field);
  for(const quote of signal.excerpts){if(quote.status==='supported')positives.push({field,text:quote.text});if(quote.status==='restricted')restrictions.push({field,text:quote.text});}
 }
 const applicable=profileId==='arash'&&screening.applicable;
 const roleRelevant=/\b(?:general practitioner|general practice|rural generalist|medical officer|medical practitioner|GP)\b/i.test(String(item?.title||''))&&!/\b(?:nurs(?:e|ing)|manager|reception|administrator)\b/i.test(String(item?.title||''));
 const closed=['closed','source_removed','future'].includes(item?.status),register=item?.kind==='employment_register';
 const strong=signals.level1.status==='supported'&&signals.img.status==='supported'&&(signals.supervision.status==='supported'||signals.sponsorship.status==='supported');
 const priority=applicable&&(closed||restrictions.length)?'restricted':applicable&&roleRelevant&&!register&&strong?'high':'clarification';
 return {version:1,profileId,applicable,roleRelevant,priority,signals,positives:positives.slice(0,12),restrictions:restrictions.slice(0,12),unknowns,sourceUrl:screening.sourceUrl,eligibility:'not_assessed',currentVacancy:'not_verified',profileContext:'route_focus_only_no_private_credentials_assessed',meaning:'text_evidence_not_acceptance_probability',limitations:[
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
