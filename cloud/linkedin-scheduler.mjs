// Only an explicit, immutable per-post approval can reach the existing publisher.
import {handleLinkedInOAuthRequest} from './linkedin-oauth.mjs';
const BASE='/api/linkedin/scheduler',GRACE=86400000;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const first=(db,sql,...args)=>stmt(db,sql,...args).first();
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const configured=env=>env.LINKEDIN_SCHEDULER_ENABLED==='true'&&env.GOOGLE_DB&&env.GOOGLE_TOKEN_KEY&&env.LINKEDIN_CLIENT_ID&&env.LINKEDIN_CLIENT_SECRET&&env.LINKEDIN_REDIRECT_URI;
const validId=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
function view(row){return {id:row.id,postId:row.post_id,scheduledFor:new Date(row.scheduled_at).toISOString(),status:row.status,reason:row.reason||null,providerUrn:row.provider_urn||null,authorSubject:row.author_sub,approvedAt:new Date(row.approved_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString(),textOnly:true};}
async function input(request){if(Number(request.headers.get('Content-Length')||0)>1000)throw Error('invalid_input');const raw=await request.text();if(new TextEncoder().encode(raw).length>1000)throw Error('invalid_input');const body=JSON.parse(raw);if(!body||Array.isArray(body)||Object.keys(body).some(key=>key!=='postId')||!validId(body.postId))throw Error('invalid_input');return body;}
function eligibleAccount(row,profileId,scheduledAt,now){let scopes=[];try{scopes=JSON.parse(row?.scopes_json||'[]');}catch{}return row?.profile_id===profileId&&row.status==='connected'&&scopes.includes('w_member_social')&&row.expires_at>Math.max(scheduledAt,now)+30000;}
export async function handleLinkedInSchedulerRequest(request,env,context){
 const url=new URL(request.url);if(url.pathname!==BASE&&!url.pathname.startsWith(BASE+'/'))return null;
 try{
  if(typeof context?.userId!=='string'||!context.userId||!['amir','arash'].includes(context.profileId))return json({error:'workspace_required'},403);
  if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)return json({error:'profile_access_denied'},403);
  if(!env.GOOGLE_DB)return json({error:'scheduler_storage_missing'},503);
  const owner=context.userId,db=env.GOOGLE_DB;
  if(request.method==='GET'&&url.pathname===BASE){const rows=(await stmt(db,'SELECT * FROM linkedin_scheduled_approvals WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100',owner).all()).results||[];return json({profileId:context.profileId,enabled:Boolean(configured(env)),approvals:rows.map(view),textOnly:true,maxPerRun:1,publicationGraceHours:24,existingManualPostsAutomaticallyApproved:false});}
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'origin_rejected'},403);
  let body;try{body=await input(request);}catch{return json({error:'invalid_input'},400);}const at=Date.now();
  if(url.pathname===BASE+'/cancel'){
   const row=await first(db,'UPDATE linkedin_scheduled_approvals SET status=\'cancelled\',reason=\'owner_cancelled\',updated_at=? WHERE owner_id=? AND post_id=? AND status IN (\'approved\',\'blocked\',\'missed\',\'failed\') RETURNING *',at,owner,body.postId);
   if(row)return json({approval:view(row),publicationSent:false});const existing=await first(db,'SELECT status FROM linkedin_scheduled_approvals WHERE owner_id=? AND post_id=?',owner,body.postId);return json({error:existing?'approval_cannot_be_cancelled':'approval_not_found'},existing?409:404);
  }
  if(url.pathname!==BASE+'/approve')return json({error:'not_found'},404);
  if(!configured(env))return json({error:'scheduler_not_enabled'},503);
  const post=await first(db,'SELECT * FROM linkedin_posts WHERE owner_id=? AND id=?',owner,body.postId);if(!post)return json({error:'post_not_found'},404);
  const when=Date.parse(post.scheduled_for);if(post.status!=='scheduled_for_manual_publication'||!Number.isFinite(when)||when<=at+1000||typeof post.text!=='string'||!post.text.trim()||post.text.length>3000)return json({error:'future_scheduled_post_required'},400);
  const account=await first(db,'SELECT * FROM linkedin_accounts WHERE owner_id=?',owner);if(!eligibleAccount(account,context.profileId,when,at))return json({error:'connected_publish_grant_must_cover_schedule'},409);
  if(await first(db,'SELECT id FROM linkedin_publish_attempts WHERE owner_id=? AND post_id=?',owner,post.id))return json({error:'publication_attempt_exists'},409);
  const old=await first(db,'SELECT * FROM linkedin_scheduled_approvals WHERE owner_id=? AND post_id=?',owner,post.id);
  const digest=await hash(post.text),fingerprint=await hash(account.token_cipher);
  if(old&&old.status!=='cancelled'){
   if(old.status==='approved'&&old.content_hash===digest&&old.author_sub===account.linkedin_sub&&old.grant_fingerprint===fingerprint&&old.scheduled_at===when)return json({approval:view(old),reused:true,publicationSent:false});
   return json({error:'cancel_existing_approval_first'},409);
  }
  const row=await first(db,"INSERT INTO linkedin_scheduled_approvals(id,owner_id,profile_id,post_id,author_sub,content_hash,grant_fingerprint,scheduled_at,status,approved_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'approved',?,?) ON CONFLICT(owner_id,post_id) DO UPDATE SET profile_id=excluded.profile_id,author_sub=excluded.author_sub,content_hash=excluded.content_hash,grant_fingerprint=excluded.grant_fingerprint,scheduled_at=excluded.scheduled_at,status='approved',reason=NULL,provider_urn=NULL,approved_at=excluded.approved_at,updated_at=excluded.updated_at WHERE linkedin_scheduled_approvals.status='cancelled' RETURNING *",crypto.randomUUID(),owner,context.profileId,post.id,account.linkedin_sub,digest,fingerprint,when,at,at);
  if(!row)return json({error:'approval_changed_try_again'},409);
  return json({approval:view(row),publicationSent:false,reused:false},201);
 }catch{return json({error:'scheduler_request_failed'},500);}
}
async function finish(db,row,status,reason,now,urn=null){await stmt(db,"UPDATE linkedin_scheduled_approvals SET status=?,reason=?,provider_urn=?,updated_at=? WHERE id=? AND owner_id=? AND status='dispatching'",status,reason,urn,now,row.id,row.owner_id).run();return {postId:row.post_id,status,reason,providerUrn:urn};}
export async function dispatchScheduledLinkedIn(env,fetcher=fetch,now=Date.now()){
 if(!configured(env))return {enabled:false,processed:0};
 const db=env.GOOGLE_DB,row=await first(db,"UPDATE linkedin_scheduled_approvals SET status='dispatching',updated_at=? WHERE id=(SELECT id FROM linkedin_scheduled_approvals WHERE status='approved' AND scheduled_at<=? ORDER BY scheduled_at,id LIMIT 1) AND status='approved' RETURNING *",now,now);
 if(!row)return {enabled:true,processed:0};
 try{
  if(now-row.scheduled_at>GRACE)return {processed:1,result:await finish(db,row,'missed','schedule_expired',now)};
  const post=await first(db,'SELECT * FROM linkedin_posts WHERE owner_id=? AND id=?',row.owner_id,row.post_id),account=await first(db,'SELECT * FROM linkedin_accounts WHERE owner_id=?',row.owner_id);
  if(!post||post.status!=='scheduled_for_manual_publication'||Date.parse(post.scheduled_for)!==row.scheduled_at||await hash(post.text)!==row.content_hash)return {processed:1,result:await finish(db,row,'blocked','post_changed',now)};
  if(!eligibleAccount(account,row.profile_id,row.scheduled_at,now)||account.linkedin_sub!==row.author_sub||await hash(account.token_cipher)!==row.grant_fingerprint)return {processed:1,result:await finish(db,row,'blocked','connection_changed_or_expired',now)};
  let prevented=false;
  const guardedFetch=async(url,options)=>{
   const payload=JSON.parse(options.body||'{}');const latest=await first(db,'SELECT status FROM linkedin_scheduled_approvals WHERE id=? AND owner_id=?',row.id,row.owner_id),latestPost=await first(db,'SELECT text,scheduled_for,status FROM linkedin_posts WHERE owner_id=? AND id=?',row.owner_id,row.post_id),latestAccount=await first(db,'SELECT * FROM linkedin_accounts WHERE owner_id=?',row.owner_id);
   if(url!=='https://api.linkedin.com/rest/posts'||options.redirect!=='manual'||latest?.status!=='dispatching'||!latestPost||latestPost.status!=='scheduled_for_manual_publication'||Date.parse(latestPost.scheduled_for)!==row.scheduled_at||await hash(latestPost.text)!==row.content_hash||await hash(payload.commentary||'')!==row.content_hash||payload.author!=='urn:li:person:'+row.author_sub||!eligibleAccount(latestAccount,row.profile_id,row.scheduled_at,now)||latestAccount.linkedin_sub!==row.author_sub||await hash(latestAccount.token_cipher)!==row.grant_fingerprint){prevented=true;throw Error('scheduled_snapshot_changed');}
   return fetcher(url,options);
  };
  const request=new Request('https://scheduler.internal/api/linkedin/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({postId:row.post_id})});
  const response=await handleLinkedInOAuthRequest(request,env,{userId:row.owner_id,profileId:row.profile_id},guardedFetch),result=await response.json();
  const status=prevented?'blocked':result.status==='published'?'published':['sending','delivery_unknown'].includes(result.status)?'delivery_unknown':'failed';
  return {processed:1,result:await finish(db,row,status,prevented?'snapshot_changed_before_transport':response.ok?'provider_result':'provider_request_rejected',now,result.providerUrn||null)};
 }catch{return {processed:1,result:await finish(db,row,'delivery_unknown','dispatch_interrupted_no_retry',now)};}
}
