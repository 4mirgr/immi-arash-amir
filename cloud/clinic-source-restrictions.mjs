// Public wording retained beside positive clinic facts. A restriction attached
// to one job edition is never promoted to a permanent clinic-wide policy.
import {assessOpportunityFit} from './opportunity-fit.mjs';

const bad=/ignore.{0,50}instructions?|system prompt|api[ _-]?key|password|credit.?card|javascript:|<script/i;
const clean=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,600):'';
const codes=/^source_(?:level1_restricted|sponsorship_restricted|registration_restricted|img_restricted|supervision_restricted|applications_closed|deadline_expired|australian_residence_required)$/;
const url=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}};
export function clinicRestrictionScope(item){
 const quote=item?.quote||'',clinicNamed=/\b(?:our|this|the)\s+(?:practice|clinic|medical cent(?:re|er)|surgery)\b/i.test(quote),specificRole=/\b(?:this|the advertised)\s+(?:GP\s+)?(?:position|role|vacancy|job)\b/i.test(quote);
 const refusal=/\b(?:cannot|can't|does not|doesn't|do not|don't|unable|has no|is not able)\b/i.test(quote);
 if(clinicNamed&&refusal&&!specificRole&&['source_level1_restricted','source_sponsorship_restricted','source_supervision_restricted','source_img_restricted'].includes(item?.code))return 'clinic_policy';
 const broadEligibility=clinicNamed&&/\b(?:policy|all (?:appointments|GPs|doctors|practitioners|positions)|only (?:employs?|engages?|recruits?))\b/i.test(quote);
 if(['source_registration_restricted','source_australian_residence_required'].includes(item?.code))return broadEligibility?'clinic_policy':'current_role';
 if(['source_applications_closed','source_deadline_expired'].includes(item?.code))return 'current_role';
 if(['clinic_policy','current_role'].includes(item?.scope))return item.scope;
 let rolePage=false;try{rolePage=/\b(?:jobs?|careers?|vacanc\w*|positions?|recruitment)\b/i.test(new URL(item?.sourceURL).pathname.replace(/[-_/]+/g,' '));}catch{}
 const roleWording=/\b(?:this|the|a|our)\s+(?:GP\s+)?(?:position|role|vacancy|job)|\b(?:applications?|applicants?|candidates?|recruiting|hiring|seeking|recruitment|FRACGP|FACRRM)\b/i.test(item?.quote||'');
 return rolePage||roleWording||['source_applications_closed','source_deadline_expired'].includes(item?.code)?'current_role':'clinic_policy';
}
export function mergeClinicSourceRestrictions(...groups){
 const out=new Map();for(const item of groups.flatMap(group=>Array.isArray(group)?group:[])){
  const sourceURL=url(item?.sourceURL),quote=clean(item?.quote),checkedAt=item?.checkedAt||item?.readAt;
  if(!codes.test(item?.code||'')||!sourceURL||!quote||bad.test(quote)||!Number.isFinite(Date.parse(checkedAt||'')))continue;
  const entry={code:item.code,sourceURL,quote,checkedAt,scope:clinicRestrictionScope(item)};out.set(entry.code+'\n'+sourceURL+'\n'+entry.quote,entry);
 }
 return [...out.values()].slice(-48);
}
export function readClinicSourceRestrictions(pages,{now=Date.now()}={}){
 const out=[],checkedAt=new Date(now).toISOString(),add=(code,quote,sourceURL)=>out.push({code,quote,sourceURL,checkedAt});
 for(const page of Array.isArray(pages)?pages.slice(0,3):[]){
  const sourceURL=url(page.finalUrl||page.url);if(!sourceURL||!['read','read_partial'].includes(page.status))continue;
  const text=typeof page.text==='string'?page.text.slice(0,50000):'',assessment=assessOpportunityFit({title:page.title||'',country:'AU',opportunityType:'job',fullText:text,url:sourceURL},'arash');
  for(const field of ['level1','sponsorship','registration','img','supervision'])for(const quote of assessment.signals[field]?.excerpts||[]){
   if(quote.status!=='restricted'||field==='sponsorship'&&/^\s*(?:no|without)\s+(?:(?:work\s+)?visa\s+|employer\s+)?sponsorship\s+(?:(?:is|will be)\s+)?(?:required|needed|necessary)\s*[.!?]?\s*$/i.test(quote.text))continue;
   add('source_'+field+'_restricted',quote.text,sourceURL);
  }
  for(const clause of text.split(/\n+|(?<=[.!?;])\s+/).filter(value=>value.length>=3&&value.length<=1200)){
   if(/\b(?:applications?\s+(?:(?:are|is|have|has)\s+)?(?:now\s+|been\s+)?closed|(?:GP\s+)?(?:position|vacancy|role|job)\s+(?:(?:has\s+been|is|was)\s+)?(?:filled|closed|withdrawn)|(?:position|vacancy|role|job)\s+(?:is\s+)?no\s+longer\s+(?:available|open)|(?:not|no\s+longer)\s+(?:currently\s+)?(?:recruiting|hiring)\s+(?:GPs?|general practitioners?))\b/i.test(clause)&&!/\b(?:vaccinations?|immunisations?|immunizations?|patient intake|appointments?)\b/i.test(clause))add('source_applications_closed',clause,sourceURL);
   if(!/\b(?:not required|not essential|not mandatory|preferred|working towards|non[- ]VR|not restricted|not limited)\b/i.test(clause)&&/\b(?:FRACGP|FACRRM)\b[^.!?;]{0,40}\bonly\b|\bonly\b[^.!?;]{0,40}\b(?:FRACGP|FACRRM)\b|\b(?:VR GPs? only|only VR GPs?|must (?:have|hold) VR status)\b/i.test(clause))add('source_registration_restricted',clause,sourceURL);
   if(/\b(?:must|need to|required to)\s+(?:reside|live|be based)\s+in Australia\b/i.test(clause))add('source_australian_residence_required',clause,sourceURL);
   const deadline=clause.match(/\b(?:closing date|applications? close|application deadline|deadline for applications?)\s*[:–—-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/i);if(deadline&&Date.parse(deadline[1])+86400000-1<=now)add('source_deadline_expired',deadline[0],sourceURL);
  }
 }
 return mergeClinicSourceRestrictions(out);
}
