// Deliberately shared task board. The verified worker context is its only identity
// source; this module never fetches providers or copies owner-private material.
const BASE='/api/team-board',LIMIT=40,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const clean=(value,max)=>typeof value==='string'&&value.trim().length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)?value.trim():null;
const allowed=(row,context)=>row.creator_id===context.userId||row.assignee===context.profileId||row.assignee==='both';
function view(row,context){return{id:row.id,title:row.title,description:row.description,assignee:row.assignee,creatorProfile:row.creator_profile,status:row.status,dueAt:row.due_at,createdAt:row.created_at,updatedAt:row.updated_at,canUpdate:allowed(row,context)};}
async function input(request){const raw=await request.text();if(new TextEncoder().encode(raw).length>6000)throw Error('payload_too_large');let value;try{value=JSON.parse(raw);}catch{throw Error('invalid_payload');}if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_payload');return value;}
const keys=(value,fields)=>!Object.keys(value).some(k=>!fields.includes(k));
function due(value){if(value===undefined||value===null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('invalid_due_at');const day=value.slice(0,10),calendar=Date.parse(day+'T12:00:00Z');if(!Number.isFinite(calendar)||new Date(calendar).toISOString().slice(0,10)!==day||Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)throw Error('invalid_due_at');return new Date(value).toISOString();}
export async function handleTeamBoardRequest(request,env,context){
 const url=new URL(request.url);if(url.pathname!==BASE&&!url.pathname.startsWith(BASE+'/'))return null;
 if(!UUID.test(context?.userId||'')||!['amir','arash'].includes(context?.profileId))return json({error:'workspace_required'},403);
 if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)return json({error:'profile_access_denied'},403);
 if(!env.GOOGLE_DB)return json({error:'team_board_not_configured'},503);
 const db=env.GOOGLE_DB;
 try{
  if(request.method==='GET'&&url.pathname===BASE){const rows=(await db.prepare('SELECT * FROM team_board_tasks ORDER BY CASE status WHEN \'done\' THEN 1 ELSE 0 END,coalesce(due_at,\'9999\'),created_at DESC LIMIT ?').bind(LIMIT).all()).results||[];return json({profileId:context.profileId,tasks:rows.map(r=>view(r,context)),taskLimit:LIMIT,canCreate:rows.length<LIMIT,sharing:'explicit_tasks_only',providerConnectionsShared:false});}
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(request.headers.get('Origin')!==url.origin)return json({error:'origin_rejected'},403);
  const body=await input(request),now=new Date().toISOString();
  if(url.pathname===BASE+'/tasks'){
   if(!keys(body,['title','description','assignee','dueAt','confirmShared']))return json({error:'unexpected_field'},400);
   if(body.confirmShared!==true)return json({error:'explicit_sharing_required'},400);
   const title=clean(body.title,180),description=body.description===undefined?'':clean(body.description,1000);
   if(!title||description===null||!['amir','arash','both'].includes(body.assignee))return json({error:'invalid_team_task'},400);
   const dueAt=due(body.dueAt),id=crypto.randomUUID();
   const row=await db.prepare("INSERT INTO team_board_tasks(id,creator_id,creator_profile,title,description,assignee,status,due_at,created_at,updated_at) SELECT ?,?,?,?,?,?,'todo',?,?,? WHERE (SELECT count(*) FROM team_board_tasks)<? RETURNING *").bind(id,context.userId,context.profileId,title,description,body.assignee,dueAt,now,now,LIMIT).first();
   if(!row)return json({error:'team_task_limit_reached'},409);return json({task:view(row,context),shared:true},201);
  }
  const match=url.pathname.match(/^\/api\/team-board\/tasks\/([a-f0-9-]{36})$/i);
  if(match&&UUID.test(match[1])){
   if(!keys(body,['status'])||!['todo','in_progress','done'].includes(body.status))return json({error:'invalid_team_status'},400);
   const row=await db.prepare("UPDATE team_board_tasks SET status=?,updated_at=? WHERE id=? AND (creator_id=? OR assignee=? OR assignee='both') RETURNING *").bind(body.status,now,match[1],context.userId,context.profileId).first();
   if(!row)return json({error:'team_task_not_available'},404);return json({task:view(row,context),shared:true});
  }
  return json({error:'not_found'},404);
 }catch(e){const code=['payload_too_large','invalid_payload','invalid_due_at'].includes(e.message)?e.message:'team_board_unavailable';return json({error:code},code==='payload_too_large'?413:code==='team_board_unavailable'?503:400);}
}
