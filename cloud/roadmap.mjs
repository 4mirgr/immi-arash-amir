import {evidenceDeadlinePassed} from './evidence-deadline.mjs';
import eligibility from './eligibility-evidence.json' with {type:'json'};
import study from './study-evidence.json' with {type:'json'};
import development from './development-evidence.json' with {type:'json'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const groups=[['pathways',eligibility],['study',study],['development',development]];
const records=v=>Array.isArray(v)?v:(v.routes||v.items||[]);
export const ROADMAP_EVIDENCE=Object.freeze(groups.flatMap(([group,data])=>records(data).map(item=>({...item,group}))));
export async function roadmapActionId(itemId,text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return itemId+':'+[...new Uint8Array(bytes)].slice(0,16).map(v=>v.toString(16).padStart(2,'0')).join('');}
export function evidenceFor(profileId){return ROADMAP_EVIDENCE.filter(x=>(x.audience==='both'||x.audience===profileId)&&(!(x.group==='study'||x.country==='IT')||profileId==='amir'));}
export function analyseProfile(profileId,profile={}){
 const p=profile.planning||{},training=p.training||{},board=p.board||{},language=p.language||{};
 const knownFacts=[],unknowns=[],scenarios=[];
 if(typeof profile.cvText==='string'&&profile.cvText.trim())knownFacts.push('رزومهٔ ذخیره‌شدهٔ همین حساب موجود است؛ وجود متن رزومه به معنی تأیید مستقل مدارک نیست.');
 if(profileId==='amir'){
  if(p.academicContact?.email)knownFacts.push('ایمیل دانشگاهی به گزارش شما ثبت شده؛ مالکیت، دسترسی و اختیار نمایندگی دانشگاه تأیید نشده‌اند.');
  if(training.completionStatus==='uncertain')knownFacts.push('زمان اتمام دوره در پرونده نامشخص ثبت شده؛ هیچ تاریخ برآوردی، فراغت از تحصیل تلقی نشده است.');
  if(Array.isArray(training.completionScenarios))for(const s of training.completionScenarios)if(typeof s.label==='string')knownFacts.push('سناریوی زمان‌بندی ثبت‌شده: '+s.label);
  if(language.levelEvidence==='self_reported'&&typeof language.level==='string')knownFacts.push('سطح زبان '+language.level+' خوداظهاری است، نه نتیجهٔ آزمون.');
  if(language.examStatus==='not_taken'||language.certificateStatus==='none_reported')knownFacts.push('نتیجهٔ رسمی زبان در پرونده گزارش نشده است؛ آمادگی آزمون هنوز یک پیش‌نیاز باز است.');
  if(typeof language.preferredExam==='string')knownFacts.push('آزمون ترجیحی ثبت‌شده: '+language.preferredExam);
  if(board.status==='pending')knownFacts.push('نتیجهٔ بورد هنوز تعیین نشده است؛ هر دو سناریو مستقل نگه داشته می‌شوند.');
  unknowns.push('تاریخ قطعی پایان دوره و امکان آزادسازی مدارک/شروع کار خارج از کشور','عنوان دقیق مدرک تخصص و اینکه در ایران مجوز مستقل متخصص بودن می‌دهد یا خیر','نتیجهٔ بورد، ریزنمرات، گردش‌ها و مستندات آموزش','نمره و تاریخ آزمون زبان معتبر؛ سابقهٔ پژوهش، معدل و معادل‌بودن مدرک برای هر دانشگاه');
  scenarios.push({title:'دوره هنوز تمام نشده است',conclusion:'فعلاً احراز مسیر ارزیابی متخصص تکمیل‌شده را اعلام نمی‌کنیم. بررسی آموزش کوتاه‌مدت فقط مشروط به نامهٔ دوره، صلاحیت مسیر و تعهد بازگشت است و جای مهاجرت دائم را نمی‌گیرد.',actions:['نامهٔ رسمی وضعیت دوره، آموزش‌های انجام‌شده و زمان احتمالی اتمام تهیه کنید.','هم‌زمان زبان و پروندهٔ پژوهشی را آماده کنید؛ تاریخ شروع دانشگاه را با تعهدات دوره تطبیق دهید.']});
  scenarios.push({title:'پایان دوره و قبولی بورد',conclusion:'پروندهٔ ارزیابی تخصص می‌تواند از نظر مستندسازی قوی‌تر شود؛ پذیرش به عنوان دقیق مدرک قابل راستی‌آزمایی و ارزیابی RACP وابسته است، نه صرف قبولی بورد ایران.',actions:['صلاحیت مدرک برای specialist recognition را با عنوان رسمی مدرک کتبی از RACP بپرسید.','شرح گردش‌ها، برنامهٔ آموزش، سوپرویژن، تجربه و معرفان را با معیارهای ارزیابی مستند کنید.']});
  scenarios.push({title:'پایان دوره بدون اخذ بورد',conclusion:'نه رد خودکار اعلام می‌شود و نه specialist eligibility تأیید می‌شود. باید معلوم شود مدرک موجود به چه صلاحیت تخصصی مستقلی در کشور آموزش منجر می‌شود؛ اگر کافی نباشد مسیر استاندارد/آموزشی یا پژوهشی جدا بررسی می‌شود.',actions:['مدرک پایان دوره و وضعیت مجوز تخصصی را جدا از نتیجهٔ بورد ارائه کنید.','برای برنامه‌های پژوهشی، شرایط پذیرش دانشگاه و مدرک معادل را جدا از مجوز طبابت بررسی کنید.']});
  return {summary:'دو مسیر موازیِ مستند: آماده‌سازی پروندهٔ بالینی مشروط به پایان دوره و نوع مدرک، و بررسی تحصیل پژوهشیِ دارای تأمین مالی. نقش علمی یا پیشنهاد استاد، جای ثبت‌نام پزشکی یا ارزیابی رسمی را نمی‌گیرد.',knownFacts,unknowns,scenarios};
 }
 unknowns.push('نتیجه و تاریخ رسمی AMC MCQ و آزمون زبان، وضعیت اعتبار آزمون‌ها و راستی‌آزمایی مدارک','مسیر ثبت‌نام دقیق، کارفرما و شرح شغل مشخص، سوپروایزر و طرح نظارت','لزوم PESCI برای همان سمت، تأیید محل کار و شرایط ویزا/اسپانسرشیپ');
 scenarios.push({title:'نتایج و مدارک معتبر + پیشنهاد شغلی مناسب',conclusion:'با تأیید مدارک و نیاز همان سمت، آماده‌سازی PESCI و طرح نظارت قابل پیگیری است. نمرهٔ MCQ یا نامهٔ ارزیابی به تنهایی مجوز کار مستقل یا تضمین اسپانسرشیپ نیست.',actions:['نتایج و تاریخ‌های رسمی را کنار شرح شغل و سطح نظارت تطبیق دهید.','از کارفرما حمایت از طرح نظارت، نوع ثبت‌نام و اسپانسرشیپ را کتبی بگیرید.']});
 scenarios.push({title:'پیشنهاد هنوز قطعی نیست یا مدارک نیازمند تکمیل‌اند',conclusion:'ابتدا مانع واقعی همان موقعیت را رفع کنید؛ ثبت‌نام در کورس و جمع‌کردن گواهی عمومی، جانشین پیش‌نیاز قانونی یا پیشنهاد شغلی نمی‌شود.',actions:['با کیس‌های مستند و بدون مشخصات بیمار، ارتباط بالینی، ارجاع ایمن و مدیریت خطر را تمرین کنید.','رزومه و مکاتبه را به نیاز همان آگهی متصل کنید؛ ادعای ثبت‌نام یا مهارتی که مدرکش آماده نیست اضافه نکنید.']});
 return {summary:'تمرکز بر استخدامِ واقع‌بینانه با نظارت و تطبیق PESCI با سمت واقعی است. ادعاهای آزمون و ارزیابیِ پرونده باید با نتیجه، تاریخ و نوع مسیر تأیید شوند؛ کاهش MMM به‌تنهایی احتمال پذیرش را ثابت نمی‌کند.',knownFacts,unknowns,scenarios};
}
async function progress(db,owner){return (await db.prepare('SELECT action_id,status,note,updated_at FROM roadmap_actions WHERE owner_id=?').bind(owner).all()).results||[];}
export const deadlinePassed=evidenceDeadlinePassed;
function assessItem(item,profileId,profile){
 const planning=profile.planning||{},language=planning.language||{};
 const closed=['closed','expired'].includes(item.status)||['closed','expired'].includes(item.deadline?.status)||deadlinePassed(item);
 if(item.group==='study')return {status:closed?'فراخوان مرجع/بسته؛ برای اقدام فعلی مناسب اعلام نمی‌شود':'بررسی مشروط؛ صلاحیت پذیرش هنوز احراز نشده',priority:closed?'رصد دور بعد و آماده‌سازی پرونده':'ابتدا معادل‌بودن مدرک، زبان و تناسب پژوهش',gaps:[...(language.examStatus==='not_taken'||language.certificateStatus==='none_reported'?['مدرک رسمی زبان در پرونده گزارش نشده است؛ سطح B2 جای نمرهٔ پذیرش دانشگاه را نمی‌گیرد.']:[]),'معدل، ریزنمرات، سابقهٔ پژوهشی و امکان شروع دوره باید با شرایط همین برنامه بررسی شوند.','تاریخ پایان تعهدات آموزشی باید با شروع و مهلت ارائهٔ مدارک برنامه سازگار باشد.','شهریه، کمک‌هزینهٔ زندگی و بیمه را جداگانه بررسی کنید؛ بورسیهٔ رقابتی تضمین دریافت بودجه نیست.'],conclusion:'این مسیر تحصیل/پژوهش است و به‌تنهایی مجوز طبابت استرالیا یا کشور میزبان ایجاد نمی‌کند.'};
 if(item.group==='development')return {status:closed?'رویداد گذشته/مرجع آموزشی':'پیشنهاد رشد؛ پذیرش و دسترسی باید تأیید شود',priority:profileId==='amir'?'خروجی قابل ارائه: پروتکل پژوهش/ممیزی یا کار بالینی مستند':'خروجی قابل ارائه: مهارت بالینی، ارتباط، ایمنی و کیس مستند',conclusion:'فقط پس از شرکت واقعی و تأیید مدرک، افزودن دستاورد به رزومه بررسی شود. عنوان گواهی یا حضور در کنگره معادل تأیید RACP، Ahpra یا دانشگاه مقصد نیست.'};
 return {status:'مشروط به تأیید مدارک و معیارهای همین مسیر',conclusion:profileId==='amir'?'پایان دوره و عنوان صلاحیت تخصصی باید مستقل از نتیجهٔ بورد روشن شوند. پیشنهاد استاد یا بیمارستان به‌تنهایی معادل comparability یا ورود به سال معین نیست.':'نتیجه و تاریخ آزمون، ارزیابی مدارک و شرایط سمت/نظارت باید کنار هم تأیید شوند؛ کیفیت تطبیق مهم‌تر از تعداد مکاتبات است.'};
}
export async function handleRoadmapRequest(request,env,context){
 const url=new URL(request.url);if(url.pathname!=='/api/roadmap'&&url.pathname!=='/api/roadmap/actions')return null;
 try{
  if(!context?.userId||!['amir','arash'].includes(context.profileId)||typeof context.rest!=='function')return json({error:'workspace_required'},403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)return json({error:'profile_access_denied'},403);
  if(url.searchParams.get('category')==='study'&&context.profileId!=='amir')return json({error:'profile_access_denied'},403);
  if(!env.GOOGLE_DB)return json({error:'roadmap_storage_not_configured'},503);
  const evidence=evidenceFor(context.profileId),owner=context.userId;
  const entries=await Promise.all(evidence.flatMap(item=>(item.actions||[]).map(async action=>{const text=typeof action==='string'?action:action.text;const id=await roadmapActionId(item.id,text);return [id,{id,text}];})));
  const actions=new Map(entries);let actionIndex=0;
  if(request.method==='GET'&&url.pathname==='/api/roadmap'){
   const own=await context.rest('immi_profiles','?select=data&profile_id=eq.'+context.profileId);
   const states=new Map((await progress(env.GOOGLE_DB,owner)).map(row=>[row.action_id,row]));
   const items=evidence.map(item=>({...item,personalAssessment:assessItem(item,context.profileId,own[0]?.data||{}),actions:(item.actions||[]).map((_,i)=>{const action=entries[actionIndex++][1],saved=states.get(action.id);return {...action,status:saved?.status||'todo',note:saved?.note||'',updatedAt:saved?.updated_at||null};})}));
   let sourceChecks=[];if(env.OPPORTUNITY_DB){const visible=new Set(evidence.flatMap(x=>x.sourceUrls||[]));const rows=(await env.OPPORTUNITY_DB.prepare('SELECT source_url,status,last_success_at,change_detected_at,error_code FROM evidence_source_checks').bind().all()).results||[];sourceChecks=rows.filter(x=>visible.has(x.source_url)).map(x=>({url:x.source_url,status:x.status,lastSuccessAt:x.last_success_at?new Date(x.last_success_at).toISOString():null,changeDetectedAt:x.change_detected_at?new Date(x.change_detected_at).toISOString():null,errorCode:x.error_code}));}
   const changed=new Set(sourceChecks.filter(x=>(x.status==='changed_review_required'||x.changeDetectedAt)).map(x=>x.url));for(const item of items)if((item.sourceUrls||[]).some(url=>changed.has(url)))item.review={status:'منبع تغییر کرده است؛ بازبینی انسانی لازم است',note:'تاریخ تحلیل پیشین حفظ شده و صلاحیت یا مهلت تازه از checksum نتیجه‌گیری نشده است.'};
   return json({profileId:context.profileId,checkedAt:'2026-11-03',analysis:analyseProfile(context.profileId,own[0]?.data||{}),items,sourceChecks,limitations:['تحلیل بر مبنای منابع بررسی‌شده و اطلاعات همین پرونده است؛ نظر رسمی ارزیاب یا پیش‌بینی درصد قبولی نیست.','ثبت انجام کار، مدرک تأییدشده یا دستاورد تازه در رزومه ایجاد نمی‌کند.','پایش تغییر صفحه، تحلیل خودکار محتوای تازه نیست؛ تغییرات نیازمند بازبینی‌اند.']});
  }
  if(request.method==='POST'&&url.pathname==='/api/roadmap/actions'){
   if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'origin_rejected'},403);
   if(Number(request.headers.get('Content-Length')||0)>6000)return json({error:'payload_too_large'},413);
   const raw=await request.text();if(new TextEncoder().encode(raw).length>6000)return json({error:'payload_too_large'},413);
   let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
   if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['actionId','status','note'].includes(k))||!actions.has(body.actionId)||!['todo','doing','done','blocked'].includes(body.status)||(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>1500)))return json({error:'invalid_action'},400);
   const at=new Date().toISOString(),note=body.note||'';
   await env.GOOGLE_DB.prepare('INSERT INTO roadmap_actions(owner_id,action_id,status,note,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,action_id) DO UPDATE SET status=excluded.status,note=excluded.note,updated_at=excluded.updated_at').bind(owner,body.actionId,body.status,note,at).run();
   return json({actionId:body.actionId,status:body.status,note,updatedAt:at,achievementVerified:false});
  }
  return json({error:'method_not_allowed'},405);
 }catch{return json({error:'roadmap_request_failed'},500);}
}
