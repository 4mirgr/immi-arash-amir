// Official public evidence + this owner's private preparation only. No applications,
// provider writes, private Google data sharing or eligibility guarantees.
import strategy from './research-bridge-evidence.json' with {type:'json'};
import definitions from './au-funding-sources.json' with {type:'json'};
import {evidenceClosed} from './evidence-deadline.mjs';
const BASE='/api/research-funding';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TASK_IDS=['english','research_cv','transcript','degree_translation','proposal','writing_sample','referees','supervisor','eligibility','funding_budget','visa_conditions','clinical_plan'];
const STATUS=['todo','in_progress','done'];
const DEGREE=['either','phd','research_masters'];
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const parse=v=>{try{const x=JSON.parse(v);return x&&typeof x==='object'?x:{};}catch{return {};}};
const safeURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port?u.href:null;}catch{return null;}};
function planView(row){
 const tasks=parse(row?.tasks_json),saved=Array.isArray(tasks)?tasks.filter(task=>task&&typeof task==='object'&&!Array.isArray(task)&&TASK_IDS.includes(task.id)&&STATUS.includes(task.status)):[];
 return{fundingGoal:'full_funding',preferredDegree:DEGREE.includes(row?.preferred_degree)?row.preferred_degree:'either',tasks:TASK_IDS.map(id=>({id,title:strategy.requirements.find(item=>item.id===id)?.title||id,status:STATUS.includes(saved.find(t=>t.id===id)?.status)?saved.find(t=>t.id===id).status:'todo'})),updatedAt:row?.updated_at||null,meaning:'owner_reported_preparation_not_verified_credentials'};
}
function snapshot(source,row,now){
 const stored=parse(row?.data),expected=safeURL(source.url||source.feedUrl),observed=Date.parse(row?.read_at||'');
 const actual=Boolean(row&&stored.id===source.id&&safeURL(row.url)===expected);
 const data=actual?stored:{id:source.id,title:source.title||source.name,institution:source.institution,url:expected,summary:source.summary,requirements:source.requirements||[],degreeTypes:source.degreeTypes||[],fundingCoverage:'unknown',internationalEligibility:'unknown',status:source.catalogKind==='program'?'program':'unknown',checkedAt:source.reviewedAt||null};
 const fresh=actual&&['program','open','closed','unknown'].includes(row.status)&&(!row.check_status||['updated','not_modified'].includes(row.check_status)||Number(row.last_attempt_at)<observed)&&Number.isFinite(observed)&&observed<=now+60000&&now-observed<=14*86400000;
 const openingDay=data.openingDate?.date,openingInFuture=typeof openingDay==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(openingDay)&&openingDay>new Date(now).toISOString().slice(0,10);
 const status=evidenceClosed(data,now)?'closed':data.status==='program'?'program':fresh&&data.status==='open'&&!openingInFuture?'open':'unknown';
 return{...data,fundingCoverage:typeof data.fundingCoverage==='string'?data.fundingCoverage:data.fundingCoverage?.classification||'unknown',fundingCoverageEvidence:data.fundingCoverage?.evidence||[],internationalEligibility:typeof data.internationalEligibility==='string'?data.internationalEligibility:data.internationalEligibility?.status==='international_mentioned_not_individual_assessment'?'conditional':'unknown',id:source.id,url:expected,status,degreeTypes:(data.degreeTypes||[]).map(value=>/phd|doctor/i.test(value)?'phd':/master|mphil/i.test(value)?'research_masters':null).filter(Boolean),sourceType:'official',reading:{status:actual?(row.check_status==='failed'&&Number(row.last_attempt_at)>=observed?'fetch_failed':'read'):'not_checked',readAt:actual?row.read_at:null},currentSourceVerified:fresh,applicationAutomatic:false};
}
const TOPICS=[['internal_medicine','پزشکی داخلی',/internal medicine|physician|پزشکی داخلی|متخصص داخلی/i],['cardiometabolic','قلب و متابولیسم',/cardiolog|cardiovascular|diabet|metabolic|قلب|دیابت/i],['public_health','سلامت عمومی',/public health|epidemiolog|population health|بهداشت|اپیدمیولوژی/i],['clinical_research','پژوهش بالینی',/clinical research|clinical trial|پژوهش بالینی|کارآزمایی/i]];
async function profileReview(context){
 if(typeof context.rest!=='function')return{review:{available:false},cvText:''};
 try{const rows=await context.rest('immi_profiles','?select=data&profile_id=eq.amir&user_id=eq.'+encodeURIComponent(context.userId)+'&limit=1'),data=rows?.[0]?.data,p=data?.planning||{},cvText=typeof data?.cvText==='string'?data.cvText:'';if(!data)return{review:{available:false},cvText:''};return{cvText,review:{available:true,cvReviewed:Boolean(cvText.trim()),basis:'saved_cv_and_current_planning',fundingGoal:'full_funding',trainingIncomplete:p.training?.currentStatus==='internal_medicine_resident'||p.training?.completionStatus==='uncertain',boardPending:p.board?.status==='pending',languageUncertified:p.language?.examStatus==='not_taken'||p.language?.certificateStatus==='none_reported'}};}catch{return{review:{available:false},cvText:''};}
}
function profileMatch(item,cvText){
 const content=[item.title,item.summary,...(item.requirements||[])].join(' ');
 return{basis:cvText?'saved_cv_text':'profile_not_available',matchedTopics:cvText?TOPICS.filter(([,label,pattern])=>pattern.test(cvText)&&pattern.test(content)).map(([id,label])=>({id,label})):[],eligibilityConfirmed:false};
}
export async function handleResearchFundingRequest(request,env,context,now=Date.now()){
 const u=new URL(request.url);if(u.pathname!==BASE&&!u.pathname.startsWith(BASE+'/'))return null;
 if(!UUID.test(context?.userId||'')||context.profileId!=='amir'||u.searchParams.has('profile')&&u.searchParams.get('profile')!=='amir')return json({error:'profile_access_denied'},403);
 if(!env.GOOGLE_DB||!env.OPPORTUNITY_DB)return json({error:'research_funding_not_configured'},503);
 const db=env.GOOGLE_DB,owner=context.userId;
 try{
  if(request.method==='GET'&&(u.pathname===BASE||u.pathname===BASE+'/plan')){
   const saved=await db.prepare('SELECT preferred_degree,tasks_json,updated_at FROM research_funding_plans WHERE owner_id=? AND profile_id=\'amir\'').bind(owner).first();
   if(u.pathname.endsWith('/plan'))return json({profileId:'amir',plan:planView(saved)});
   const rows=(await env.OPPORTUNITY_DB.prepare('SELECT p.source_id,p.url,p.status,p.read_at,p.data,c.status AS check_status,c.last_attempt_at FROM au_funding_pages p LEFT JOIN registered_source_checks c ON c.source_id=p.source_id').bind().all()).results||[];
   const ownProfile=await profileReview(context);
   const catalog=definitions.map(source=>{const item=snapshot(source,rows.find(row=>row.source_id===source.id),now);return{...item,profileMatch:profileMatch(item,ownProfile.cvText)};});
   return json({profileId:'amir',catalog,opportunities:[],plan:planView(saved),profileReview:ownProfile.review,strategy,capabilities:{automaticSourceRefresh:true,sourceRefreshMechanism:'registered_hourly_rotation',applicationAutomatic:false,clinicalRegistrationAutomatic:false,teamSharingAutomatic:false},generatedAt:new Date(now).toISOString()});
  }
  if(request.method!=='POST'||u.pathname!==BASE+'/plan')return json({error:'not_found'},404);
  if(request.headers.get('Origin')!==u.origin)return json({error:'origin_rejected'},403);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>12000)return json({error:'payload_too_large'},413);
  let input;try{input=JSON.parse(raw);}catch{return json({error:'invalid_preparation_plan'},400);}
  if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['preferredDegree','tasks'].includes(key))||!DEGREE.includes(input.preferredDegree)||!Array.isArray(input.tasks)||input.tasks.length>TASK_IDS.length)return json({error:'invalid_preparation_plan'},400);
  const seen=new Set();for(const task of input.tasks){if(!task||Array.isArray(task)||Object.keys(task).some(key=>!['id','status'].includes(key))||!TASK_IDS.includes(task.id)||!STATUS.includes(task.status)||seen.has(task.id))return json({error:'invalid_preparation_plan'},400);seen.add(task.id);}
  const tasks=TASK_IDS.map(id=>({id,status:input.tasks.find(task=>task.id===id)?.status||'todo'})),at=new Date(now).toISOString();
  await db.prepare('INSERT INTO research_funding_plans(owner_id,profile_id,preferred_degree,tasks_json,updated_at) VALUES(?,\'amir\',?,?,?) ON CONFLICT(owner_id) DO UPDATE SET preferred_degree=excluded.preferred_degree,tasks_json=excluded.tasks_json,updated_at=excluded.updated_at').bind(owner,input.preferredDegree,JSON.stringify(tasks),at).run();
  return json({profileId:'amir',plan:planView({preferred_degree:input.preferredDegree,tasks_json:JSON.stringify(tasks),updated_at:at}),applicationSubmitted:false,credentialsVerified:false});
 }catch{return json({error:'research_funding_storage_unavailable'},503);}
}
