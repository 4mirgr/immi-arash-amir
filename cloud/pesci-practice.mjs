import communication from '../library/pesci/PESCI-PRACTICE-COMM-001.json' with {type:'json'};
import paediatric from '../library/pesci/PESCI-PRACTICE-PAED-002.json' with {type:'json'};
import abdominal from '../library/pesci/PESCI-PRACTICE-ABDO-003.json' with {type:'json'};
import mentalHealth from '../library/pesci/PESCI-PRACTICE-MH-004.json' with {type:'json'};
import diabetes from '../library/pesci/PESCI-PRACTICE-DM-005.json' with {type:'json'};
const CASES=Object.freeze([communication,paediatric,abdominal,mentalHealth,diabetes]);
const byId=new Map(CASES.map(item=>[item.id,item]));
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
function summary(item){return {id:item.id,version:item.version,title:item.title,topic:item.topic,practiceSeconds:item.timing?.practice_seconds||600,officialExam:false,reviewStatus:item.review_status};}
function sessionView(row){let reflections=[];try{reflections=JSON.parse(row.reflections_json);}catch{}return {id:row.id,caseId:row.case_id,caseVersion:row.case_version,answer:row.answer,reflections,elapsedSeconds:row.elapsed_seconds,createdAt:row.created_at,source:'user_self_reflection',officialScore:null,achievementVerified:false};}
export async function handlePesciPracticeRequest(request,env,context){
 const url=new URL(request.url),base='/api/pesci/practice';if(url.pathname!==base&&!url.pathname.startsWith(base+'/'))return null;
 try{
  if(typeof context?.userId!=='string'||!context.userId||context.profileId!=='arash')return json({error:'pesci_workspace_not_available'},403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!=='arash')return json({error:'profile_access_denied'},403);
  const owner=context.userId,path=url.pathname.slice(base.length);
  if(request.method==='GET'&&path==='')return json({profileId:'arash',cases:CASES.map(summary),educational:true,officialExam:false,limitation:'Original discussion practice; clinician review required. Not a validated PESCI mock or score.'});
  if(path==='/sessions'){
   if(!env.GOOGLE_DB)return json({error:'practice_storage_not_configured'},503);
   if(request.method==='GET'){
    const rows=(await statement(env.GOOGLE_DB,'SELECT * FROM pesci_practice_sessions WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 40',owner).all()).results||[];
    return json({profileId:'arash',sessions:rows.map(sessionView),officialExam:false});
   }
   if(request.method==='POST'){
    if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'origin_rejected'},403);
    if(Number(request.headers.get('Content-Length')||0)>50000)return json({error:'payload_too_large'},413);
    const raw=await request.text();if(new TextEncoder().encode(raw).length>50000)return json({error:'payload_too_large'},413);
    let body;try{body=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
    if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['caseId','answer','reflections','elapsedSeconds'].includes(key)))return json({error:'invalid_session'},400);
    const item=byId.get(body.caseId);if(!item)return json({error:'case_not_found'},404);
    if(typeof body.answer!=='string'||body.answer.length>10000||!body.answer.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(body.answer)||!Number.isInteger(body.elapsedSeconds)||body.elapsedSeconds<0||body.elapsedSeconds>7200)return json({error:'invalid_session'},400);
    const refs=body.reflections??[];if(!Array.isArray(refs)||refs.length>item.reflection_rubric.length||refs.some(value=>!Number.isInteger(value)||value<0||value>=item.reflection_rubric.length)||new Set(refs).size!==refs.length)return json({error:'invalid_reflections'},400);
    const id=crypto.randomUUID(),createdAt=new Date().toISOString();
    await statement(env.GOOGLE_DB,'INSERT INTO pesci_practice_sessions(id,owner_id,case_id,case_version,answer,reflections_json,elapsed_seconds,created_at) VALUES(?,?,?,?,?,?,?,?)',id,owner,item.id,item.version,body.answer.trim(),JSON.stringify(refs),body.elapsedSeconds,createdAt).run();
    return json({id,caseId:item.id,caseVersion:item.version,answer:body.answer.trim(),reflections:refs,elapsedSeconds:body.elapsedSeconds,createdAt,source:'user_self_reflection',officialScore:null,achievementVerified:false},201);
   }
   return json({error:'method_not_allowed'},405);
  }
  if(request.method==='GET'&&/^\/[A-Z0-9-]+$/.test(path)){
   const item=byId.get(path.slice(1));return item?json({profileId:'arash',case:item,officialExam:false}):json({error:'case_not_found'},404);
  }
  return json({error:'not_found'},404);
 }catch{return json({error:'practice_request_failed'},500);}
}
