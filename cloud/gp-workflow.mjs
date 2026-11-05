// Source-follow-up priority plus private owner-reported preparation stages.
// Neither a tier nor a saved stage grants eligibility or authorizes transport.
import {assessOpportunityFit} from './opportunity-fit.mjs';

export const GP_GOAL_MODES=Object.freeze(['pesci_readiness','employment']);
export const GP_WORKFLOW_STAGES=Object.freeze([
 {id:'clinic_identified',label:'کلینیک شناسایی شد',requiresEvidence:false},
 {id:'contact_identified',label:'مسئول یا راه تماس مشخص شد',requiresEvidence:false},
 {id:'supervision_confirmed',label:'پاسخ دربارهٔ نظارت دریافت شد',requiresEvidence:true},
 {id:'position_documents',label:'مدارک سمت و نظارت دریافت شد',requiresEvidence:true},
 {id:'application_ready',label:'پرونده برای بررسی نهایی آماده است',requiresEvidence:true},
]);
const CAUTIONS=Object.freeze([
 'این اولویت، شواهد متن را مقایسه می‌کند؛ صلاحیت شخصی، جاب‌آفر یا احتمال پذیرش را تعیین نمی‌کند.',
 'PESCI به سمت مشخص وابسته است؛ شرح شغل و طرح نظارت همان سمت باید بررسی شوند.',
 'MMM1 از جست‌وجو حذف نمی‌شود؛ DPA، MMM و شرایط Medicare/19AB جداگانه بررسی می‌شوند.',
 'راهنمای FSP ورودی ۲۰۲۷.۱، نیاز به Level 1 را با شرایط ورود FSP سازگار نمی‌داند؛ مسیر ثبت و Fellowship جدا بررسی شوند.',
]);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(code,status=400)=>{throw Object.assign(Error(code),{status});};
const text=value=>typeof value==='string'?value:'';
function https(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
const positive=signal=>signal?.status==='supported';

export function assessFiveTier(source,goalMode='pesci_readiness',at=Date.now()){
 if(!GP_GOAL_MODES.includes(goalMode))throw new TypeError('Invalid GP goal mode');
 const item=source&&typeof source==='object'?source:{},fit=assessOpportunityFit(item,'arash');
 const signals=fit.signals,known=Object.fromEntries(['level1','img','supervision','pesci','sponsorship'].map(key=>[key,positive(signals[key])]));
 const title=text(item.title),roleText=[title,text(item.summary),text(item.fullText)].join('\n').slice(0,60000);
 const rangeEvidence=roleText.split(/(?<=[.!?;])\s+|\n+/).map(s=>s.trim()).filter(s=>s.length<=600&&/\blevel\s*1\s*(?:[-–—]|to|or)\s*2\s*(?:clinical\s+)?supervision\b/i.test(s)&&!/\b(?:no|not|cannot|can't|unable|without)\b/i.test(s)).slice(0,2);
 const roleRelevant=/\b(?:general practitioner|general practice|rural generalist|GP)\b/i.test(roleText),nonGp=/\b(?:nurs(?:e|ing)|receptionist|practice manager|administrative assistant|dentist|physiotherap(?:ist|y))\b/i.test(title)&&!/\bgeneral practitioner\b/i.test(title);
 const closing=Date.parse(item.closingAt||item.closing_at||''),published=Date.parse(item.publishedAt||item.published_at||'');
 const unavailable=['closed','source_removed','future'].includes(item.status)||(Number.isFinite(closing)&&closing<=at)||(Number.isFinite(published)&&published>at);
 const clearRestrictions=['level1','img','supervision'].filter(key=>signals[key]?.status==='restricted');
 const fellowshipRestriction=(signals.registration?.excerpts||[]).some(e=>e.status==='restricted'&&/\b(?:FRACGP|FACRRM)\b/i.test(e.text)&&!/\b(?:preferred|not required|not essential|not mandatory|working towards)\b/i.test(e.text));
 let tier=2,reasons=[];
 if(unavailable||nonGp||clearRestrictions.length||fellowshipRestriction){tier=1;reasons.push(unavailable?'این رکورد برای درخواست جاری باز یا به‌روز نیست.':nonGp?'عنوان آگهی، نقش پزشک GP نیست.':'در متن یک محدودیت صریح دربارهٔ نظارت، IMG یا مدرک لازم آمده است؛ پیش از اقدام آن را روشن کنید.');}
 else if(roleRelevant&&known.level1&&known.img&&known.pesci){tier=5;reasons.push('در متن، Level 1، پذیرش IMG و حمایت PESCI صریحاً آمده است؛ تأیید واقعی مرکز همچنان لازم است.');}
 else if(roleRelevant&&(known.level1&&known.img||known.img&&known.pesci&&known.supervision)){tier=4;reasons.push(known.level1?'برای Level 1 و IMG شواهد صریح داریم؛ جزئیات حمایت PESCI را روشن کنید.':'حمایت IMG، PESCI و نظارت در متن آمده؛ سطح دقیق نظارت هنوز باید تأیید شود.');}
 else if(roleRelevant&&(Object.values(known).some(Boolean)||rangeEvidence.length)){tier=3;reasons.push(rangeEvidence.length&&!known.level1?'در متن به بازهٔ Level 1–2 اشاره شده است؛ ظرفیت واقعی Level 1 هنوز تأیید نشده و باید از مرکز پرسیده شود.':'نقش GP مرتبط است و دست‌کم یک نشانهٔ حمایت وجود دارد؛ بخش‌های نامشخص نیاز به پرس‌وجو دارند.');}
 else reasons.push(roleRelevant?'نقش GP مرتبط است، اما تعهد صریح دربارهٔ IMG، Level 1 و PESCI ثبت نشده است.':'برای تشخیص نقش GP شواهد کافی نداریم؛ ابتدا نوع خدمت و موقعیت را روشن کنید.');
 const weights=goalMode==='pesci_readiness'?{level1:4,pesci:4,img:2,supervision:2,sponsorship:1}:{level1:3,pesci:1,img:2,supervision:3,sponsorship:4};
 const priorityWeight=tier===1?0:Object.entries(weights).reduce((sum,[key,weight])=>sum+(known[key]?weight:0),0)+(rangeEvidence.length&&!known.level1?1:0);
 const nextSteps=[];
 if(tier===1)nextSteps.push('اصل محدودیت یا تاریخ آگهی را بررسی کنید؛ برای نسخهٔ تازه یا نقش مناسب‌تر همان مرکز پرس‌وجو کنید.');
 else{
  if(!(Array.isArray(item.contactEvidence)?item.contactEvidence:[]).some(c=>c?.type==='email'&&c?.value)||!text(item.practiceManager))nextSteps.push('راه تماس منتشرشده و نام مسئول جذب یا مدیر مرکز را در منبع رسمی پیدا کنید.');
  if(!known.level1)nextSteps.push('ظرفیت واقعی Level 1، حضور سوپروایزر و طرح نظارت را کتبی از مرکز بپرسید.');
  nextSteps.push('شرح شغل و فرم نظارت SPPA-30 مربوط به همان سمت را دریافت و بررسی کنید.');
  if(!known.pesci)nextSteps.push('بپرسید مرکز برای تکمیل مدارکِ درخواست PESCI همان سمت همکاری می‌کند یا خیر.');
  if(goalMode==='employment'&&!known.sponsorship)nextSteps.push('وضعیت حق کار، اسپانسرشیپ و شروع مشروط به ثبت پزشکی را جداگانه روشن کنید.');
 }
 const labels={1:'مانع یا محدودیت صریح در رکورد',2:'نیاز به تحقیق اولیه',3:'پیگیری با پرسش‌های مشخص',4:'شواهد مناسب برای پیگیری',5:'شواهد قوی برای پیگیری'};
 const sourceUrl=https(item.url||item.sourceUrl),evidence=[...Object.entries(signals).flatMap(([field,signal])=>(signal.excerpts||[]).map(e=>({field,status:e.status,quote:e.text,url:sourceUrl}))),...rangeEvidence.map(quote=>({field:'level1_range',status:'potential',quote,url:sourceUrl}))].slice(0,15);
 return {tier,label:labels[tier],reasons,nextSteps,unknowns:fit.unknowns,evidence,goalMode,priorityWeight,eligibility:'not_assessed',meaning:'source_followup_priority_not_acceptance_probability',registrationCautions:[...CAUTIONS],sourceUrl,roleRelevant};
}

async function payload(request){
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))fail('json_required');
 if(Number(request.headers.get('Content-Length')||0)>5000)fail('payload_too_large',413);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>5000)fail('payload_too_large',413);
 let input;try{input=JSON.parse(raw);}catch{fail('invalid_payload');}
 if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_payload');return input;
}
function keys(input,allowed){if(Object.keys(input).some(key=>!allowed.includes(key)))fail('unexpected_workflow_field');}
async function settings(db,owner){const row=await db.prepare('SELECT goal_mode,updated_at FROM gp_workflow_settings WHERE owner_id=? AND profile_id=?').bind(owner,'arash').first();return {goalMode:row?.goal_mode||'pesci_readiness',updatedAt:row?.updated_at||null,automaticSending:false};}
export async function readGpGoalMode(env,context){
 if(context?.profileId!=='arash')return 'employment';
 if(!env?.GOOGLE_DB||typeof context.userId!=='string'||!context.userId||context.userId.includes(':'))return 'pesci_readiness';
 try{const record=await settings(env.GOOGLE_DB,context.userId);return GP_GOAL_MODES.includes(record.goalMode)?record.goalMode:'pesci_readiness';}catch{return 'pesci_readiness';}
}
async function sourceFor(db,id){const row=await db.prepare('SELECT * FROM opportunity_editions WHERE id=?').bind(id).first();if(!row||row.country!=='AU'||row.profile_scope==='amir'||row.opportunity_type&&row.opportunity_type!=='job')fail('opportunity_not_available',404);let source={};try{const parsed=JSON.parse(row.data||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))source=parsed;}catch{}return {...source,id:row.id,country:row.country,opportunityType:row.opportunity_type||source.opportunityType||'job',title:row.title||source.title,status:row.status,kind:row.kind||source.kind,url:row.url||source.url,closingAt:row.closing_at||source.closingAt,publishedAt:row.published_at||source.publishedAt};}
async function progress(db,owner,id,item){
 const [row,preference]=await Promise.all([db.prepare('SELECT stage,note,evidence_url,updated_at FROM gp_opportunity_progress WHERE owner_id=? AND opportunity_id=? AND profile_id=?').bind(owner,id,'arash').first(),settings(db,owner)]);
 return {opportunityId:id,stage:row?.stage||'clinic_identified',note:row?.note||'',evidenceUrl:row?.evidence_url||'',updatedAt:row?.updated_at||null,status:'owner_reported',officiallyVerified:false,stages:GP_WORKFLOW_STAGES,assessment:assessFiveTier(item,preference.goalMode),automaticSending:false,achievementVerified:false};
}
export async function handleGpWorkflowRequest(request,env,context){
 const url=new URL(request.url),stageMatch=/^\/api\/gp-workflow\/opportunities\/(opp_[a-f0-9]{32})$/.exec(url.pathname),isSettings=url.pathname==='/api/gp-workflow/settings';
 if(!stageMatch&&!isSettings)return null;
 try{
  if(context?.profileId!=='arash'||typeof context.userId!=='string'||!context.userId||context.userId.includes(':'))fail('arash_workspace_required',403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)fail('profile_access_denied',403);
  if(!['GET','POST'].includes(request.method))fail('method_not_allowed',405);
  if(request.method==='POST'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail('origin_rejected',403);
  const db=env.GOOGLE_DB;if(!db)fail('gp_workflow_storage_missing',503);
  if(isSettings){
   if(request.method==='POST'){const input=await payload(request);keys(input,['goalMode']);if(!GP_GOAL_MODES.includes(input.goalMode))fail('invalid_goal_mode');await db.prepare('INSERT INTO gp_workflow_settings(owner_id,profile_id,goal_mode,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET goal_mode=excluded.goal_mode,updated_at=excluded.updated_at').bind(context.userId,'arash',input.goalMode,new Date().toISOString()).run();}
   return json(await settings(db,context.userId));
  }
  if(!env.OPPORTUNITY_DB)fail('gp_workflow_source_storage_missing',503);
  const id=stageMatch[1],item=await sourceFor(env.OPPORTUNITY_DB,id);
  if(request.method==='POST'){
   const input=await payload(request);keys(input,['stage','note','evidenceUrl','confirm']);
   const stage=GP_WORKFLOW_STAGES.find(s=>s.id===input.stage);if(!stage||input.confirm!==true||typeof input.note!=='string'||input.note.length>1500)fail('invalid_progress_update');
   const note=input.note.trim();if(stage.requiresEvidence&&note.length<12)fail('supporting_note_required');
   const evidenceUrl=input.evidenceUrl==null?'':input.evidenceUrl;if(typeof evidenceUrl!=='string'||evidenceUrl.length>2000||evidenceUrl&&!https(evidenceUrl))fail('invalid_evidence_url');
   await db.prepare('INSERT INTO gp_opportunity_progress(owner_id,opportunity_id,profile_id,stage,note,evidence_url,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,opportunity_id) DO UPDATE SET stage=excluded.stage,note=excluded.note,evidence_url=excluded.evidence_url,updated_at=excluded.updated_at').bind(context.userId,id,'arash',stage.id,note,evidenceUrl?https(evidenceUrl):'',new Date().toISOString()).run();
  }
  return json(await progress(db,context.userId,id,item));
 }catch(error){return json({error:Number.isInteger(error.status)?error.message:'gp_workflow_unavailable'},Number.isInteger(error.status)?error.status:503);}
}
