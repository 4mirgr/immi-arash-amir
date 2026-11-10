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
 const parts=roleText.replace(/<[^>]*>/g,' ').split(/(?<=[.!?;])\s+|\n+/).map(s=>s.trim()).filter(s=>s&&s.length<=600);
 const uncertain=/\b(?:no|not|cannot|can't|unable|without|may|might|could|subject to|if|potential(?:ly)?)\b/i;
 const rangeEvidence=parts.filter(s=>/\blevel\s*1\s*(?:[-–—]|to|or)\s*2\s*(?:clinical\s+)?supervision\b/i.test(s)&&!uncertain.test(s)).slice(0,2);
 // Team size and registrar teaching are useful context, never proof that an
 // approved Level 1 supervisor is available to this particular applicant.
 const teamEvidence=parts.filter(s=>!uncertain.test(s)&&/\b(?:teaching practice|training practice|registrar training|GP registrars?|multidisciplinary team|established (?:clinical )?team|team of (?:[2-9]|[1-9]\d+) (?:GPs?|doctors)|(?:[2-9]|[1-9]\d+) (?:GPs?|doctors))\b/i.test(s)).slice(0,3);
 const potentialSupervision=parts.filter(s=>/\b(?:supervision|supervisor)\b/i.test(s)&&/\b(?:may|might|could|potential(?:ly)?|subject to)\b/i.test(s)&&!/\b(?:no|not|cannot|can't|unable|without)\b/i.test(s)).slice(0,2);
 const roleRelevant=/\b(?:general practitioner|general practice|rural generalist|GP)\b/i.test(roleText),nonGp=/\b(?:nurs(?:e|ing)|receptionist|practice manager|administrative assistant|dentist|physiotherap(?:ist|y))\b/i.test(title)&&!/\bgeneral practitioner\b/i.test(title);
 const closing=Date.parse(item.closingAt||item.closing_at||''),published=Date.parse(item.publishedAt||item.published_at||'');
 const unavailable=['closed','source_removed','future'].includes(item.status)||(Number.isFinite(closing)&&closing<=at)||(Number.isFinite(published)&&published>at);
 const clearRestrictions=['level1','img','supervision'].filter(key=>signals[key]?.status==='restricted');
 const onlyFellowshipEvidence=parts.filter(s=>!/\b(?:not required|not essential|not mandatory|preferred|working towards|non[- ]VR|not(?:\s+\w+){0,3}\s+only|not restricted to|not limited to)\b/i.test(s)&&(/\b(?:FRACGP|FACRRM)\b[^.!?;]{0,35}\bonly\b|\bonly\b[^.!?;]{0,50}\b(?:FRACGP|FACRRM)\b/i.test(s)||/\b(?:only VR GPs?|VR GPs? only|VR status (?:is )?required|must (?:have|hold) VR status)\b/i.test(s))).slice(0,2);
 const fellowshipRestriction=onlyFellowshipEvidence.length>0||(signals.registration?.excerpts||[]).some(e=>e.status==='restricted'&&/\b(?:FRACGP|FACRRM)\b/i.test(e.text)&&!/\b(?:preferred|not required|not essential|not mandatory|working towards)\b/i.test(e.text));
 let tier=2,reasons=[];
 if(unavailable||nonGp||clearRestrictions.length||fellowshipRestriction){tier=1;reasons.push(unavailable?'این آگهی برای اقدام فعلی در دسترس نیست، مهلتش گذشته یا هنوز زمان انتشارش نرسیده است؛ این به معنی تعطیلی کلینیک نیست.':nonGp?'عنوان این آگهی برای نقش GP نیست؛ بهتر است موقعیت پزشکی مناسب همان مجموعه را پیدا کنیم.':'در متن، مانع مشخصی دربارهٔ نظارت، پذیرش IMG یا مدرک Fellowship آمده است؛ پیش از درخواست باید آن را روشن کنیم.');}
 else if(roleRelevant&&known.level1&&known.img&&known.pesci&&known.sponsorship){tier=5;reasons.push('متن منبع از پذیرش IMG، نظارت Level 1، همراهی برای PESCI و اسپانسرشیپ ویزا صحبت می‌کند؛ این مورد ارزش پیگیری سریع دارد.');}
 else if(roleRelevant&&(known.level1&&known.img||known.img&&known.supervision&&(known.pesci||teamEvidence.length))){tier=4;reasons.push(known.level1?'برای IMG و نظارت Level 1 شواهد خوبی داریم؛ می‌توان درخواست اختصاصی آماده کرد و شرایط باقی‌مانده را از مرکز پرسید.':'منبع از پذیرش IMG و نظارت برای متقاضی می‌گوید و نشانهٔ آموزش یا حمایت PESCI دارد؛ سطح دقیق نظارت را کتبی بپرسید.');}
 else if(roleRelevant&&(Object.values(known).some(Boolean)||rangeEvidence.length||potentialSupervision.length)){tier=3;reasons.push(rangeEvidence.length&&!known.level1?'در متن به بازهٔ Level 1–2 اشاره شده است؛ ظرفیت واقعی Level 1 هنوز تأیید نشده و باید از مرکز پرسیده شود.':'این موقعیت به مسیر GP مربوط است و نشانه‌ای از حمایت دارد؛ چند پرسش مشخص می‌تواند وضعیت آن را روشن کند.');}
 else reasons.push(roleRelevant?'خدمات GP با مسیر آرش مرتبط است، اما هنوز نشانهٔ کافی دربارهٔ پذیرش IMG و حمایت Level 1/PESCI نداریم.':'اطلاعات فعلی برای شناخت نقش و شرایط مرکز کافی نیست؛ ابتدا اصل موقعیت را بررسی کنیم.');
 if(!known.sponsorship&&tier>1)reasons.push(signals.sponsorship.status==='restricted'?'منبع اسپانسرشیپ ویزا را رد کرده است. در حالت آمادگی PESCI این مورد حذف نمی‌شود، اما برای شروع کار باید حق کار جداگانه حل شود.':'اسپانسرشیپ ویزا در منبع روشن نیست؛ نبود این اطلاعات، رد شدن درخواست یا نبود حمایت را ثابت نمی‌کند.');
 if(tier>1&&!known.level1&&!rangeEvidence.length)reasons.push(teamEvidence.length?'تیم یا آموزش در مرکز معرفی شده، ولی این به‌تنهایی ظرفیت نظارت Level 1 را ثابت نمی‌کند.':'ظرفیت واقعی نظارت Level 1 مشخص نیست؛ آن را مستقیماً از مدیر مرکز بپرسید.');
 const weights=goalMode==='pesci_readiness'?{level1:4,pesci:4,img:2,supervision:2,sponsorship:1}:{level1:3,pesci:1,img:2,supervision:3,sponsorship:4};
 const priorityWeight=tier===1?0:Object.entries(weights).reduce((sum,[key,weight])=>sum+(known[key]?weight:0),0)+(rangeEvidence.length&&!known.level1?1:0);
 const nextSteps=[];
 if(tier===1)nextSteps.push('اصل شرط یا تاریخ آگهی را دوباره بخوانید؛ اگر تغییر کرده، نسخهٔ تازه یا موقعیت مناسب‌تر همان مرکز را پیدا کنید.');
 else{
  if(!(Array.isArray(item.contactEvidence)?item.contactEvidence:[]).some(c=>c?.type==='email'&&c?.value)||!text(item.practiceManager))nextSteps.push('نتیجهٔ جست‌وجوی خودکار ایمیل و نام مسئول را در پرونده ببینید. اگر نامی منتشر نشده باشد، نامه با خطاب Practice Manager آماده می‌شود.');
  if(!known.level1)nextSteps.push('کتبی بپرسید آیا مرکز برای همین سمت، سوپروایزر و ظرفیت واقعی Level 1 دارد.');
  else nextSteps.push('از مرکز بخواهید ظرفیت فعلی سوپروایزر و شرایط نظارت همین سمت را تأیید کند.');
  nextSteps.push('شرح شغل و فرم نظارت SPPA-30 همین سمت را بگیرید و با نیازهای ثبت پزشکی تطبیق دهید.');
  if(!known.pesci)nextSteps.push('بپرسید آیا مرکز برای تکمیل مدارک درخواست PESCI همین سمت همراهی می‌کند.');
  if(goalMode==='employment'&&!known.sponsorship)nextSteps.push('وضعیت حق کار، اسپانسرشیپ و زمان شروع پس از ثبت پزشکی را جداگانه روشن کنید.');
 }
 const labels={1:'مانع مشخص برای اقدام فعلی',2:'اطلاعات ناکافی؛ اول تحقیق کنیم',3:'قابل پیگیری با چند پرسش',4:'تناسب خوب برای پیگیری',5:'تناسب قوی؛ پیگیری در اولویت'};
 const sourceUrl=https(item.url||item.sourceUrl);
 const evidence=[...Object.entries(signals).flatMap(([field,signal])=>(signal.excerpts||[]).map(e=>({field,status:e.status,quote:e.text,url:sourceUrl}))),...rangeEvidence.map(quote=>({field:'level1_range',status:'potential',quote,url:sourceUrl})),...teamEvidence.map(quote=>({field:'team_training',status:'supported',quote,url:sourceUrl})),...potentialSupervision.map(quote=>({field:'supervision',status:'potential',quote,url:sourceUrl})),...onlyFellowshipEvidence.map(quote=>({field:'registration',status:'restricted',quote,url:sourceUrl}))].slice(0,22);
 const statuses={supported:'در متن آمده',restricted:'شرط یا محدودیت صریح',potential:'احتمالی؛ نیاز به تأیید',not_stated:'هنوز مشخص نیست',informational:'اطلاعات تکمیلی'};
 const matrixRow=(id,label,status,rows=[],note='')=>({id,label,status,statusLabel:statuses[status],evidence:rows.map(e=>({quote:e.quote||e.text||e,url:sourceUrl,status:e.status||status})),...(note?{note}:{})});
 const matrix=[matrixRow('gp_role','مرتبط‌بودن نقش با GP',nonGp?'restricted':roleRelevant?'supported':'not_stated',roleRelevant&&!nonGp?[{quote:title||parts.find(s=>/\b(?:general practice|GP)\b/i.test(s))||'',status:'supported'}]:[]),
  ...['level1','img','pesci','supervision'].map(id=>matrixRow(id,{level1:'ظرفیت نظارت Level 1',img:'پذیرش پزشک IMG',pesci:'همراهی برای PESCI',supervision:'نظارت برای متقاضی'}[id],signals[id].status==='not_stated'&&((id==='level1'&&rangeEvidence.length)||(id==='supervision'&&potentialSupervision.length))?'potential':signals[id].status,evidence.filter(e=>e.field===id||(id==='level1'&&e.field==='level1_range')).slice(0,3))),
  matrixRow('registration','مدرک یا ثبت پزشکی موردنیاز',fellowshipRestriction?'restricted':signals.registration.status,evidence.filter(e=>e.field==='registration').slice(0,3),'شرط آگهی را باید با مدارک واقعی آرش جداگانه تطبیق داد؛ این امتیاز تأیید صلاحیت شخصی نیست.'),
  matrixRow('team_training','تیم و محیط آموزشی',teamEvidence.length?'supported':'not_stated',teamEvidence.map(quote=>({quote,status:'supported'})),'وجود تیم یا آموزش، جای تأیید سوپروایزر همین سمت را نمی‌گیرد.'),
  matrixRow('sponsorship','اسپانسرشیپ ویزا',signals.sponsorship.status,evidence.filter(e=>e.field==='sponsorship').slice(0,3),'در هدف آمادگی PESCI شرط حذف نیست؛ برای شروع کار باید جداگانه روشن شود.'),
  matrixRow('source_currency','وضعیت آگهی برای اقدام',unavailable?'restricted':'not_stated',[],'باز بودن آگهی و فعال‌بودن کلینیک باید جداگانه بررسی شوند؛ ظاهر یا سن وب‌سایت ملاک تعطیلی نیست.'),
  matrixRow('geography','موقعیت، MMM و DPA','informational',[],'MMM1 حذف نمی‌شود. DPA اطلاعات تکمیلی است و به‌تنهایی منطقهٔ rural یا ظرفیت نظارت را ثابت نمی‌کند.')];
 return {tier,stars:tier,maxStars:5,label:labels[tier],reasons:reasons.slice(0,3),nextSteps,unknowns:fit.unknowns,evidence,matrix,goalMode,priorityWeight,eligibility:'not_assessed',meaning:'source_evidence_fit_not_acceptance_probability',profileContext:'gp_level1_pesci_route_only_no_private_cv_assessed',registrationCautions:[...CAUTIONS],sourceUrl,roleRelevant};
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
