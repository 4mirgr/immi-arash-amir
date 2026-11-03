// Conservative text evidence, never an eligibility or acceptance decision.
const LABELS={sponsorship:'اسپانسرشیپ ویزای کار',img:'پذیرش پزشک بین‌المللی',supervision:'سوپرویژن برای متقاضی',pesci:'PESCI',registration:'شرط ثبت پزشکی'};
const rules={
 sponsorship:{
  restricted:[/\b(?:no|without)\s+(?:visa\s+|work\s+visa\s+|employer\s+)?sponsorship\b/i,/\b(?:visa\s+|work\s+visa\s+|employer\s+)?sponsorship\s+(?:is\s+|will\s+be\s+)?(?:not\s+(?:available|provided|offered|supported)|unavailable)\b/i,/\b(?:cannot|can't|do\s+not|does\s+not|will\s+not)\s+(?:offer|provide|support)\s+(?:visa\s+|work\s+visa\s+|employer\s+)?sponsorship\b/i],
  supported:[/\b(?:visa|work\s+visa|employer)\s+sponsorship\s+(?:is\s+)?(?:available|provided|offered)\b/i,/\b(?:we\s+)?(?:offer|provide)\s+(?:visa|work\s+visa|employer)\s+sponsorship\b/i]
 },
 img:{
  restricted:[/\b(?:international\s+medical\s+graduates?|IMGs?)\s+(?:are\s+)?(?:not\s+(?:eligible|accepted)|ineligible)\b/i,/\b(?:cannot|do\s+not|does\s+not)\s+(?:accept|consider)\s+(?:applications?\s+from\s+)?(?:international\s+medical\s+graduates?|IMGs?)\b/i],
  supported:[/\b(?:international\s+medical\s+graduates?|IMGs?)\s+(?:are\s+)?(?:welcome|encouraged\s+to\s+apply|eligible\s+to\s+apply)\b/i,/\b(?:applications?\s+from\s+)?(?:international\s+medical\s+graduates?|IMGs?)\s+(?:will\s+be|are)\s+(?:accepted|considered)\b/i,/\b(?:we\s+)?(?:welcome|accept)\s+applications?\s+from\s+(?:international\s+medical\s+graduates?|IMGs?)\b/i]
 },
 supervision:{
  restricted:[/\b(?:no|without)\s+(?:clinical\s+)?supervision\s+(?:is\s+)?(?:available|provided|offered)\b/i,/\b(?:clinical\s+)?supervision\s+(?:is\s+)?(?:not\s+(?:available|provided|offered)|unavailable)\b/i,/\b(?:cannot|do\s+not)\s+(?:offer|provide)\s+(?:clinical\s+)?supervision\b/i],
  supported:[/\b(?:clinical\s+)?supervision\s+(?:is\s+|will\s+be\s+)?(?:available|provided|offered)\s+(?:to|for)\s+(?:you|the\s+(?:successful\s+)?(?:applicant|candidate)|IMGs?|international\s+medical\s+graduates?)\b/i,/\byou\s+will\s+(?:be\s+supervised\s+by|work\s+under\s+(?:clinical\s+)?supervision)\b/i,/\bwe\s+(?:offer|provide)\s+(?:clinical\s+)?supervision\s+(?:to|for)\s+(?:you|IMGs?|international\s+medical\s+graduates?|the\s+(?:successful\s+)?(?:applicant|candidate))\b/i]
 },
 pesci:{
  restricted:[/\bPESCI\s+(?:is\s+)?(?:required|mandatory)\b/i,/\b(?:must|need\s+to)\s+(?:have\s+)?(?:pass|passed|complete|completed)\s+(?:the\s+)?PESCI\b/i,/\b(?:cannot|do\s+not|does\s+not)\s+(?:offer|provide|support)\s+(?:support\s+for\s+)?PESCI\b/i],
  supported:[/\b(?:we\s+)?(?:offer|provide)\s+(?:support|preparation|assistance)\s+(?:for|with)\s+(?:the\s+)?PESCI\b/i,/\bPESCI\s+(?:support|preparation|assistance)\s+(?:is\s+)?(?:available|provided|offered)\b/i]
 },
 registration:{
  restricted:[/\b(?:must\s+(?:have|hold)|require[ds]?|essential(?:\s+criteria)?)\b[^.!?;\n]{0,100}\b(?:AHPRA|Medical\s+Board\s+of\s+Australia|(?:general|specialist|limited|provisional)\s+registration)\b/i,/\b(?:general|specialist|limited|provisional)\s+registration\b[^.!?;\n]{0,70}\b(?:required|essential|mandatory)\b/i,/\b(?:AHPRA|Medical\s+Board\s+of\s+Australia)\s+registration\s+(?:is\s+)?(?:required|essential|mandatory)\b/i],
  supported:[/\b(?:eligible|eligibility)\s+for\s+(?:(?:general|specialist|limited|provisional)\s+)?registration\s+with\s+(?:AHPRA|the\s+Medical\s+Board\s+of\s+Australia)\b/i]
 }
};
function plain(value){return typeof value==='string'?value.slice(0,25000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').replace(/[ \t]+/g,' ').trim():'';}
// Conditional or negated propositions cannot be positive source commitments.
const uncertain=/\b(?:no|not|never|unable|may|might|could|potential(?:ly)?|subject\s+to|not\s+(?:guaranteed|currently)|not\s+only|whether|if|not\s+eligible|not\s+accepted|not\s+offered|not\s+provided|not\s+available|cannot|can't|does\s+not|do\s+not|will\s+not)\b/i;
const unrelated=/\b(?:research\s+(?:grant|funding)|event\s+sponsorship|sponsor(?:ship)?\s+(?:a\s+)?(?:conference|event|charity)|supervis(?:e|ion\s+of)\s+(?:junior|medical\s+students?|students?|trainees?))\b/i;
function sourceUrl(record){try{const u=new URL(record.url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function screenOpportunity(record,profileId){
 if(!['amir','arash'].includes(profileId))throw new TypeError('Invalid screening profile');
 const item=record&&typeof record==='object'?record:{};
 const applicable=item.country==='AU'&&(!item.opportunityType||item.opportunityType==='job');
 const sentences=applicable?['title','summary','fullText'].flatMap(key=>plain(item[key]).split(/(?<=[.!?;])\s+|\n+/)).map(s=>s.trim()).filter(Boolean):[];
 const fields={};
 for(const [key,rule]of Object.entries(rules)){
  const excerpts=[];
  for(const sentence of sentences){
   if(sentence.length>1200)continue; // Missing punctuation or broad page text stays unknown.
   let status=null,reason=null;
   if(!(['registration','pesci'].includes(key)&&/\b(?:not\s+(?:required|mandatory|essential)|no\s+[^.!?;]{0,60}\brequired)\b/i.test(sentence))&&rule.restricted.some(re=>re.test(sentence))){status='restricted';reason=key==='registration'||key==='pesci'?'stated_requirement_or_restriction':'explicit_restriction';}
   else if(!uncertain.test(sentence)&&!unrelated.test(sentence)&&rule.supported.some(re=>re.test(sentence))){status='supported';reason='explicit_advertisement_statement';}
   if(status&&!excerpts.some(e=>e.text===sentence))excerpts.push({text:sentence.slice(0,600),status,reason});
  }
  fields[key]={label:LABELS[key],status:excerpts.some(e=>e.status==='restricted')?'restricted':excerpts.some(e=>e.status==='supported')?'supported':'not_stated',excerpts:excerpts.sort((a,b)=>Number(b.status==='restricted')-Number(a.status==='restricted')).slice(0,3)};
 }
 return {version:1,profileId,applicable,scope:'advertisement_text_only',eligibility:'not_assessed',fields,sourceUrl:sourceUrl(item),limitations:['Only collected title, summary and advertisement text are screened; linked position descriptions may contain other conditions.','Supported means explicit wording, not confirmed personal eligibility, sponsorship approval, supervision level or a job offer.','Restricted means a stated prerequisite or restriction; the applicant has not been assessed.','No statement remains unknown. Check the complete original advertisement and regulator requirements.']};
}
