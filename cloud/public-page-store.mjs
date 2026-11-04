import {analyzePublicPage} from './public-page-analysis.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results||[];
export function evidenceSections(analysis){
 if(['navigation','unrelated'].includes(analysis.category))return [];
 if(analysis.profileId==='arash'&&['call','admission','funding'].includes(analysis.category)){return analysis.topics?.some(t=>['gp_img_supervision','pesci'].includes(t))?[analysis.category==='funding'?'development':'pathway']:[];}
 if(analysis.category==='career')return ['jobs'];
 if(analysis.category==='development')return ['development'];
 if(analysis.category==='call'&&analysis.country==='AU')return ['jobs','study'];
 if(analysis.category==='admission')return ['study','pathway'];
 if(['call','funding'].includes(analysis.category))return ['study'];
 return [analysis.country==='IT'?'study':'pathway'];
}
export async function enqueuePublicPages(db,rows){
 if(!Array.isArray(rows)||rows.length>100)throw Error('page_batch_limit');
 const valid=rows.map(row=>{
  if(!/^page_[a-f0-9]{32}$/.test(row.id)||!['AU','IT'].includes(row.country))throw Error('invalid_public_page');
  const url=new URL(row.url);if(url.protocol!=='https:'||url.username||url.password||url.port)throw Error('invalid_public_url');
  const profileScope=row.country==='IT'?'amir':'both';
  return {...row,profileScope};
 });
 const payload=JSON.stringify(valid);if(new TextEncoder().encode(payload).length>500000)throw Error('page_batch_limit');
 if(!valid.length)return {enqueued:0};
 await stmt(db,"INSERT INTO public_page_queue(id,url,country,profile_scope,data) SELECT json_extract(value,'$.id'),json_extract(value,'$.url'),json_extract(value,'$.country'),json_extract(value,'$.profileScope'),value FROM json_each(?) WHERE 1 ON CONFLICT(url) DO UPDATE SET data=json_set(json_patch(public_page_queue.data,excluded.data),'$.institutionIds',json((SELECT json_group_array(value) FROM (SELECT value FROM json_each(public_page_queue.data,'$.institutionIds') UNION SELECT value FROM json_each(excluded.data,'$.institutionIds')))),'$.officialBases',json((SELECT json_group_array(value) FROM (SELECT value FROM json_each(public_page_queue.data,'$.officialBases') UNION SELECT value FROM json_each(excluded.data,'$.officialBases'))))) WHERE public_page_queue.country=excluded.country AND public_page_queue.profile_scope=excluded.profile_scope",payload).run();
 return {enqueued:valid.length};
}
export async function storePublicReading(db,record){
 const row=await stmt(db,'SELECT * FROM public_page_queue WHERE id=?',record.id).first();
 if(!row||row.url!==record.url)throw Error('page_not_registered');
 if(!Number.isFinite(Date.parse(record.readAt)))throw Error('invalid_read_date');
 const read=['read','read_partial'].includes(record.status)&&typeof record.text==='string'&&!!record.text.trim();
 const status=read?record.status:String(record.status||'failed').replace(/[^a-z_]/g,'').slice(0,60)||'failed';
 const text=read?record.text.slice(0,50000):'';
 const bound={...record,text,title:String(record.title||'').slice(0,500),country:row.country,institutionIds:JSON.parse(row.data).institutionIds||[]};
 const writes=[stmt(db,'UPDATE public_page_queue SET status=?,read_at=?,title=?,content_hash=?,lease_until=0,last_error=? WHERE id=?',status,record.readAt,bound.title,record.contentHash||null,read?null:status,row.id)];
 if(read)writes.push(stmt(db,'INSERT INTO public_page_content(page_id,read_at,status,title,content_type,text,content_hash,limitations) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET read_at=excluded.read_at,status=excluded.status,title=excluded.title,content_type=excluded.content_type,text=excluded.text,content_hash=excluded.content_hash,limitations=excluded.limitations',row.id,record.readAt,status,bound.title,String(record.contentType||'').slice(0,100),text,record.contentHash||null,JSON.stringify(record.limitations||[])));
 // Invalidate prior extraction on every result, including an unreadable changed page.
 writes.push(stmt(db,'DELETE FROM public_page_evidence WHERE page_id=?',row.id));
 let analysisCount=0;
if(read)for(const profileId of row.profile_scope==='amir'?['amir']:['amir','arash']){
  const analysis=analyzePublicPage(bound,{profileId,country:row.country});if(!analysis)continue;analysisCount++;
  writes.push(stmt(db,'INSERT INTO public_page_evidence(page_id,profile_id,category,sections,analysis,read_at) VALUES(?,?,?,?,?,?)',row.id,profileId,analysis.category,JSON.stringify(evidenceSections(analysis)),JSON.stringify(analysis),record.readAt));
 }
 await db.batch(writes);return {id:row.id,status,analyzed:analysisCount>0};
}
export async function handlePublicPagesRequest(request,env,context){
 const url=new URL(request.url);if(url.pathname!=='/api/research/pages')return null;
 if(typeof context?.userId!=='string'||!context.userId||!['amir','arash'].includes(context.profileId))return json({error:'workspace_required'},403);
 if(url.searchParams.has('profile')&&url.searchParams.get('profile')!==context.profileId)return json({error:'profile_access_denied'},403);
 if(request.method!=='GET')return json({error:'method_not_allowed'},405);
 const country=url.searchParams.get('country')||(context.profileId==='amir'?'IT':'AU'),section=url.searchParams.get('section')||'all',status=url.searchParams.get('status')||'all',q=(url.searchParams.get('q')||'').trim().toLowerCase(),limit=Number(url.searchParams.get('limit')||15),offset=Number(url.searchParams.get('offset')||0);
 if(country==='IT'&&context.profileId!=='amir')return json({error:'italy_scope_not_permitted'},403);
 if(!['IT','AU'].includes(country)||!['all','study','pathway','development','jobs'].includes(section)||!['all','read','needs_review'].includes(status)||q.length>150||!Number.isInteger(limit)||limit<1||limit>30||!Number.isInteger(offset)||offset<0||offset>10000)return json({error:'invalid_evidence_filter'},400);
 if(!env.OPPORTUNITY_DB)return json({error:'public_evidence_storage_missing'},503);
 try{
  const db=env.OPPORTUNITY_DB,args=[context.profileId,country,context.profileId];
  const where=["p.country=? AND (p.profile_scope='both' OR ?='amir')"];
  if(section!=='all'){where.push('EXISTS (SELECT 1 FROM json_each(e.sections) WHERE value=?)');args.push(section);}
  if(status==='read')where.push("p.status IN ('read','read_partial')");
  if(status==='needs_review')where.push("p.status NOT IN ('read')");
  if(q){where.push("instr(lower(p.title||' '||p.url||' '||coalesce(e.analysis,'')),?)>0");args.push(q);}
  const base=' FROM public_page_queue p LEFT JOIN public_page_evidence e ON e.page_id=p.id AND e.profile_id=? WHERE '+where.join(' AND ');
  const rows=await all(db,'SELECT p.id,p.url,p.title,p.status,p.read_at,p.data,e.category,e.analysis'+base+' ORDER BY p.read_at DESC,p.id LIMIT ? OFFSET ?',...args,limit,offset);
  const count=await stmt(db,'SELECT count(*) n'+base,...args).first();
  const coverage=await all(db,"SELECT status,count(*) n FROM public_page_queue WHERE country=? AND (profile_scope='both' OR ?='amir') GROUP BY status",country,context.profileId);
  const totals={pending:0,read:0,failed:0,partial:0};for(const r of coverage){if(['pending','reading'].includes(r.status))totals.pending+=r.n;else if(['read','read_partial'].includes(r.status)){totals.read+=r.n;if(r.status==='read_partial')totals.partial+=r.n;}else totals.failed+=r.n;}
  return json({profileId:context.profileId,pages:rows.map(row=>({id:row.id,url:row.url,title:row.title,status:row.status,readAt:row.read_at,institutionIds:JSON.parse(row.data).institutionIds||[],category:row.category,analysis:row.analysis?JSON.parse(row.analysis):null})),total:count.n,coverage,queue:totals,limitations:['Extracted evidence requires human review; no personal eligibility or current vacancy is verified.','Blocked and queued pages are not represented as read; partial readings retain their limits.']});
 }catch{return json({error:'public_evidence_unavailable'},500);}
}
