// Candidate organizations come from fixed public sources, never a private LinkedIn graph.
const MAX_CANDIDATES=300,MAX_ORGANIZATIONS=50;
const STATUSES=new Set(['to_research','shortlisted','reviewed','contacted','follow_up','archived']);
const GOALS=new Set(['job','research','training','funding']);
const TYPES=new Set(['job','university','grant','funding','scholarship']);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class TargetError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new TargetError(status,code);};
const stmt=(db,sql,...values)=>db.prepare(sql).bind(...values);
const all=async(db,sql,...values)=>(await stmt(db,sql,...values).all()).results||[];
const plain=(value,max=1000)=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').slice(0,max):'';
function safeURL(value){try{const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443'))return url.href;}catch{}return null;}
function parse(value,fallback){try{return JSON.parse(value);}catch{return fallback;}}
function currentStatus(row,now){if(row.status==='source_removed')return 'source_removed';if(row.closing_at&&Date.parse(row.closing_at)<=now)return 'closed';if(row.published_at&&Date.parse(row.published_at)>now)return 'future';return row.closing_at?'open':'unknown';}
export function targetMatch(profileId,row){
 const title=plain(row.title,500).toLowerCase(),summary=plain(row.summary,1500).toLowerCase(),reasons=[];let points=0;
 const desired=profileId==='arash'?/\b(general practitioner|general practice|medical officer|medical practitioner)\b/:/\b(internal medicine|general medicine|medical registrar|physician|acute medicine|geriatric medicine)\b/;
 if(desired.test(title)){points+=4;reasons.push(profileId==='arash'?'عنوان آگهی با مسیر GP/پزشک عمومی هم‌جهت است؛ شرایط ثبت و نظارت باید جدا بررسی شوند.':'عنوان آگهی با داخلی/طب عمومی بیمارستانی هم‌جهت است؛ عنوان شغلی اعتبار آموزش یا تخصص را تأیید نمی‌کند.');}
 if(profileId==='amir'&&['university','scholarship','grant','funding'].includes(row.opportunity_type)){points+=2;reasons.push('فرصت دانشگاهی/پژوهشی برای بررسی مسیر تحصیلی ثبت شده؛ معادل‌بودن مدرک و فاند هنوز ارزیابی نشده‌اند.');}
 if(profileId==='amir'&&/\b(clinical|medical|health|biomed|neuro|cardio|oncolog|immun|epidem)/.test(title)){points++;reasons.push('نشانهٔ موضوع پزشکی/سلامت در عنوان دیده می‌شود؛ تناسب دقیق پروژه نیازمند مطالعه است.');}
 if(/\b(supervision|sponsor(?:ship)?|international medical graduate|\bimg\b)\b/.test(title+' '+summary)){points++;reasons.push('اشاره‌ای به نظارت، IMG یا اسپانسر در متن وجود دارد؛ این اشاره تأیید شرایط شما یا تعهد کارفرما نیست.');}
 if(row.trust==='official'){points++;reasons.push('منشأ ثبت آگهی رسمی است؛ هویت مخاطب LinkedIn هنوز شناسایی نشده است.');}
 if(row.kind==='employment_register')reasons.push('این مورد بانک/فهرست استخدامی است، نه پیشنهاد شغلی مشخص.');
 if(row.country==='IT')reasons.push('شرایط دانشگاه ایتالیا، زبان و پذیرش باید به‌صورت مستقل بررسی شوند.');
 if(!reasons.length)reasons.push('فقط هم‌پوشانی عمومی با منابع پروژه دیده شده؛ عنوان، مسئول ارتباط و شرایط نیازمند بررسی‌اند.');
 return {priority:points>=5?'high':points>=2?'medium':'review',reasons,meaning:'text_signals_not_eligibility_or_probability',_points:points};
}
const columns=`e.id,e.organization_id,e.source_id,e.country,e.state,e.title,e.url,e.opportunity_type,e.trust,e.profile_scope,e.published_at,e.closing_at,e.status,e.first_seen_at,e.last_seen_at,
 json_extract(e.data,'$.summary') AS summary,json_extract(e.data,'$.kind') AS kind,json_extract(e.data,'$.sourceUrl') AS source_url,json_extract(o.data,'$.name') AS organization_name`;
const visibleWhere="(e.country<>'IT' OR ?='amir') AND (e.profile_scope='both' OR ?='amir')";
function targetView(row,profileId,historyCount=1){
 const organization=plain(row.organization_name,300)||'مجموعهٔ منبع عمومی';
 const match=targetMatch(profileId,row);delete match._points;
 return {opportunityId:row.id,organizationId:row.organization_id,organization,title:plain(row.title,500),country:row.country,state:row.state,opportunityType:row.opportunity_type,trust:row.trust,url:safeURL(row.url),sourceUrl:safeURL(row.source_url),sourceId:row.source_id,publishedAt:row.published_at||null,closingAt:row.closing_at||null,lastSeenAt:row.last_seen_at||null,status:currentStatus(row,Date.now()),match,organizationHistoryCount:historyCount,linkedinSearchUrl:'https://www.linkedin.com/search/results/people/?keywords='+encodeURIComponent(organization+' '+(profileId==='arash'?'medical recruitment':'medical research recruitment')),linkedinSearchEvidence:'search_link_not_verified_profile'};
}
function savedView(row){return {id:row.id,opportunityId:row.opportunity_id,status:row.status,goal:row.goal,notes:row.notes,createdAt:row.created_at,updatedAt:row.updated_at,snapshot:parse(row.snapshot_json,{})};}
async function body(request){if(Number(request.headers.get('Content-Length')||0)>12000)fail(413,'payload_too_large');const raw=await request.text();if(new TextEncoder().encode(raw).length>12000)fail(413,'payload_too_large');let result;try{result=JSON.parse(raw);}catch{fail(400,'invalid_payload');}if(!result||Array.isArray(result)||typeof result!=='object')fail(400,'invalid_payload');return result;}
function onlyKeys(value,allowed){if(Object.keys(value).some(key=>!allowed.includes(key)))fail(400,'unexpected_field');}
function ownContext(context){if(typeof context?.userId!=='string'||!context.userId||!['amir','arash'].includes(context.profileId))fail(403,'workspace_required');return context;}
export async function handleNetworkTargetsRequest(request,env,context){
 const url=new URL(request.url),path=url.pathname,update=path.match(/^\/api\/linkedin\/targets\/([a-f0-9-]{36})$/i);
 if(!['/api/linkedin/targets','/api/linkedin/targets/save'].includes(path)&&!update)return null;
 try{
  const {userId,profileId}=ownContext(context);if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==profileId)fail(403,'profile_access_denied');
  if(!env.GOOGLE_DB||!env.OPPORTUNITY_DB)fail(503,'network_target_storage_not_configured');
  if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail(403,'origin_rejected');
  if(path==='/api/linkedin/targets'&&request.method==='GET'){
   const country=url.searchParams.get('country')||'all',type=url.searchParams.get('type')||'all',q=(url.searchParams.get('q')||'').trim().toLowerCase();
   if(!['all','AU','IT'].includes(country)||!['all',...TYPES].includes(type)||q.length>200)fail(400,'invalid_target_filter');if(profileId==='arash'&&country==='IT')fail(403,'italy_scope_not_permitted');
   const clauses=[visibleWhere,"e.status NOT IN ('closed','source_removed')","(e.closing_at IS NULL OR e.closing_at>?)","(e.published_at IS NULL OR e.published_at<=?)"],args=[profileId,profileId,new Date().toISOString(),new Date().toISOString()];
   if(country!=='all'){clauses.push('e.country=?');args.push(country);}if(type!=='all'){clauses.push('e.opportunity_type=?');args.push(type);}if(q){clauses.push("instr(lower(e.title||' '||o.data),?)>0");args.push(q);}
   const rows=await all(env.OPPORTUNITY_DB,`SELECT ${columns} FROM opportunity_editions e JOIN opportunity_organizations o ON o.id=e.organization_id WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(e.published_at,e.first_seen_at) DESC,e.id LIMIT ?`,...args,MAX_CANDIDATES);
   rows.sort((a,b)=>targetMatch(profileId,b)._points-targetMatch(profileId,a)._points||Date.parse(b.published_at||b.first_seen_at)-Date.parse(a.published_at||a.first_seen_at));
   const grouped=new Map();for(const row of rows)if(!grouped.has(row.organization_id)&&grouped.size<MAX_ORGANIZATIONS)grouped.set(row.organization_id,row);
   const ids=[...grouped.keys()];const counts=ids.length?await all(env.OPPORTUNITY_DB,`SELECT e.organization_id,COUNT(*) AS n FROM opportunity_editions e WHERE ${visibleWhere} AND e.organization_id IN (SELECT value FROM json_each(?)) GROUP BY e.organization_id`,profileId,profileId,JSON.stringify(ids)):[];
   const history=new Map(counts.map(r=>[r.organization_id,r.n]));
   const savedRows=await all(env.GOOGLE_DB,'SELECT * FROM linkedin_network_targets WHERE owner_id=? ORDER BY updated_at DESC,id LIMIT 200',userId);
   const savedTargets=savedRows.map(savedView).filter(row=>profileId==='amir'||row.snapshot.country!=='IT');const saved=new Map(savedTargets.map(row=>[row.opportunityId,row]));
   return json({profileId,generatedAt:new Date().toISOString(),source:'public_opportunity_cache',liveLinkedInGraph:false,targets:[...grouped.values()].map(row=>({...targetView(row,profileId,history.get(row.organization_id)||1),saved:saved.get(row.id)||null})),savedTargets,coverage:{candidateLimit:MAX_CANDIDATES,organizationLimit:MAX_ORGANIZATIONS,reviewedCandidates:rows.length,groupedOrganizations:grouped.size},limitations:['این پیشنهادها از آگهی‌های عمومیِ ذخیره‌شده ساخته می‌شوند؛ شبکهٔ زندهٔ کانکشن‌های LinkedIn نیستند.','لینک LinkedIn فقط جست‌وجوی نام مجموعه است؛ نام یا سمت هیچ سوپروایزر یا استخدام‌کننده‌ای تأیید نشده است.','چینش بر پایهٔ نشانه‌های متن و مخاطب پنل است؛ احراز شرایط یا احتمال پذیرش نیست.','ثبت تماس یا پیگیری صرفاً گزارش شماست؛ برنامه هیچ دعوت، پیام یا ایمیلی ارسال نمی‌کند.']});
  }
  if(path==='/api/linkedin/targets/save'&&request.method==='POST'){
   const input=await body(request);onlyKeys(input,['opportunityId','goal']);if(typeof input.opportunityId!=='string'||!/^opp_[a-f0-9]{32}$/.test(input.opportunityId)||input.goal!==undefined&&!GOALS.has(input.goal))fail(400,'invalid_target');
   const row=await stmt(env.OPPORTUNITY_DB,`SELECT ${columns} FROM opportunity_editions e JOIN opportunity_organizations o ON o.id=e.organization_id WHERE e.id=? AND ${visibleWhere}`,input.opportunityId,profileId,profileId).first();if(!row)fail(404,'opportunity_not_found');
   const history=await stmt(env.OPPORTUNITY_DB,`SELECT COUNT(*) AS n FROM opportunity_editions e WHERE e.organization_id=? AND ${visibleWhere}`,row.organization_id,profileId,profileId).first();
   const snapshot=targetView(row,profileId,history.n);if(!snapshot.url)fail(409,'source_url_requires_review');const at=new Date().toISOString(),id=crypto.randomUUID(),goal=input.goal||(row.opportunity_type==='job'?'job':row.opportunity_type==='university'?'research':'funding');
   let saved=await stmt(env.GOOGLE_DB,"INSERT INTO linkedin_network_targets(id,owner_id,opportunity_id,status,goal,notes,snapshot_json,created_at,updated_at) VALUES(?,?,?,'to_research',?,'',?,?,?) ON CONFLICT(owner_id,opportunity_id) DO NOTHING RETURNING *",id,userId,row.id,goal,JSON.stringify(snapshot),at,at).first();
   saved ||= await stmt(env.GOOGLE_DB,'SELECT * FROM linkedin_network_targets WHERE owner_id=? AND opportunity_id=?',userId,row.id).first();return json({...savedView(saved),outreachSent:false},201);
  }
  if(update&&request.method==='POST'){
   const input=await body(request);onlyKeys(input,['status','notes']);if(!Object.keys(input).length||input.status!==undefined&&!STATUSES.has(input.status)||input.notes!==undefined&&(typeof input.notes!=='string'||input.notes.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.notes)))fail(400,'invalid_target_update');
   const old=await stmt(env.GOOGLE_DB,'SELECT * FROM linkedin_network_targets WHERE owner_id=? AND id=?',userId,update[1]).first();if(!old)fail(404,'target_not_found');if(profileId!=='amir'&&parse(old.snapshot_json,{}).country==='IT')fail(403,'italy_scope_not_permitted');
   const at=new Date().toISOString();const saved=await stmt(env.GOOGLE_DB,'UPDATE linkedin_network_targets SET status=?,notes=?,updated_at=? WHERE owner_id=? AND id=? RETURNING *',input.status||old.status,input.notes??old.notes,at,userId,old.id).first();return json({...savedView(saved),outreachSent:false,statusEvidence:'user_reported_not_provider_verified'});
  }
  fail(405,'method_not_allowed');
 }catch(error){return json({error:error instanceof TargetError?error.code:'network_targets_request_failed'},error instanceof TargetError?error.status:500);}
}
