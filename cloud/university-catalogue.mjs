// Read-only, Amir-only Italy directory. Scan observations never become vacancies.
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleUniversityCatalogueRequest(request,env,context){
 const url=new URL(request.url);if(url.pathname!=='/api/discovery/universities')return null;
 if(typeof context?.userId!=='string'||!context.userId||context.profileId!=='amir')return json({error:'italy_scope_not_permitted'},403);
 if(url.searchParams.has('profile')&&url.searchParams.get('profile')!=='amir')return json({error:'profile_access_denied'},403);
 if(request.method!=='GET')return json({error:'method_not_allowed'},405);
 if(!env.OPPORTUNITY_DB)return json({error:'catalogue_storage_missing'},503);
 const q=(url.searchParams.get('q')||'').trim().toLowerCase(),status=url.searchParams.get('status')||'all';
 const limit=Number(url.searchParams.get('limit')||20),offset=Number(url.searchParams.get('offset')||0);
 if(q.length>150||!['all','checked','not_checked','needs_review'].includes(status)||!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>1000)return json({error:'invalid_catalogue_filter'},400);
 try{
  const clauses=["country='IT' AND profile_scope='amir'"],args=[];
  if(q){clauses.push("instr(lower(name||' '||data),?)>0");args.push(q);}
  if(status==='needs_review')clauses.push("scan_status NOT IN ('checked','not_checked')");
  else if(status!=='all'){clauses.push('scan_status=?');args.push(status);}
  const where=' WHERE '+clauses.join(' AND '),db=env.OPPORTUNITY_DB;
  const rows=(await db.prepare('SELECT * FROM university_catalogue'+where+' ORDER BY name,id LIMIT ? OFFSET ?').bind(...args,limit,offset).all()).results||[];
  const related=(await db.prepare('SELECT institution_id,data FROM university_related_checks WHERE institution_id IN (SELECT value FROM json_each(?)) ORDER BY checked_at DESC,id').bind(JSON.stringify(rows.map(row=>row.id))).all()).results||[];
  const count=await db.prepare('SELECT count(*) n FROM university_catalogue'+where).bind(...args).first();
  const coverage=(await db.prepare("SELECT scan_status,count(*) n FROM university_catalogue WHERE profile_scope='amir' GROUP BY scan_status").bind().all()).results||[];
  return json({profileId:'amir',institutions:rows.map(row=>({...JSON.parse(row.data),scanStatus:row.scan_status,scanCheckedAt:row.scan_checked_at,scan:row.scan_data?JSON.parse(row.scan_data):null,relatedChecks:related.filter(x=>x.institution_id===row.id).map(x=>JSON.parse(x.data))})),total:count.n,limit,offset,coverage,meaning:'official_directory_and_bounded_technical_scan_not_vacancies',automaticOpportunityCoverage:false});
 }catch{return json({error:'university_catalogue_unavailable'},500);}
}
