// Private, owner-scoped planning. This module never scrapes or writes LinkedIn.
const CAPABILITIES=Object.freeze({liveAnalytics:false,directProfileEdit:false,automaticPublishing:false,connectionsSync:false});
const SECTIONS=['headline','about','experience'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class LinkedInError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new LinkedInError(status,code);};
const now=()=>new Date().toISOString();
const stmt=(db,sql,...values)=>db.prepare(sql).bind(...values);
const all=async(db,sql,...values)=>(await stmt(db,sql,...values).all()).results||[];
function text(value,name,max,optional=false){if(optional&&(value===undefined||value===null||value===''))return '';if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))fail(400,'invalid_'+name);return value.trim();}
function keys(body,allowed){if(Object.keys(body).some(k=>!allowed.includes(k)))fail(400,'unexpected_field');}
function iso(value,name){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'invalid_'+name);const date=value.slice(0,10).split('-').map(Number);if(date[2]<1||date[2]>new Date(Date.UTC(date[0],date[1],0)).getUTCDate())fail(400,'invalid_'+name);return new Date(value).toISOString();}
function zone(value){if(typeof value!=='string'||value.length>80)fail(400,'invalid_timezone');try{new Intl.DateTimeFormat('en',{timeZone:value});return value;}catch{fail(400,'invalid_timezone');}}
export function linkedInUrl(value,kind='profile'){
 if(typeof value!=='string'||value.length>1000)fail(400,'invalid_linkedin_url');let url;try{url=new URL(value);}catch{fail(400,'invalid_linkedin_url');}
 if(url.protocol!=='https:'||!['linkedin.com','www.linkedin.com'].includes(url.hostname)||url.username||url.password||url.port||url.search||url.hash)fail(400,'invalid_linkedin_url');
 if(kind==='profile'&&!/^\/(?:in|company)\/[A-Za-z0-9%_-]+\/?$/.test(url.pathname))fail(400,'invalid_linkedin_url');
 if(kind==='post'&&!/^\/(?:posts\/[A-Za-z0-9%_-]+\/?|feed\/update\/urn:li:activity:\d+\/?)$/.test(url.pathname))fail(400,'invalid_linkedin_url');
 url.hostname='www.linkedin.com';return url.href;
}
async function payload(request,max=30000){if(Number(request.headers.get('content-length')||0)>max)fail(413,'payload_too_large');const raw=await request.text();if(new TextEncoder().encode(raw).length>max)fail(413,'payload_too_large');let body;try{body=JSON.parse(raw);}catch{fail(400,'invalid_json');}if(!body||Array.isArray(body)||typeof body!=='object')fail(400,'object_required');return body;}
function contextOwner(context){if(typeof context?.userId!=='string'||!context.userId||!['arash','amir'].includes(context.profileId)||typeof context.rest!=='function')fail(403,'workspace_required');return context.userId;}
const draftView=r=>({id:r.id,kind:r.kind,name:r.name,text:r.text,revision:r.revision,createdAt:r.created_at,source:'user_entered',requiresReview:true});
const postView=r=>({id:r.id,title:r.title,text:r.text,scheduledFor:r.scheduled_for,timezone:r.timezone,status:r.status,createdAt:r.created_at,publishedUrl:r.published_url,reportedPublishedAt:r.reported_published_at,publicationEvidence:r.status==='published_by_user'?'user_reported_not_provider_verified':null});
async function drafts(db,owner){return (await all(db,'SELECT * FROM linkedin_drafts WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100',owner)).map(draftView);}
async function providerRecords(db,owner){
 const present=await stmt(db,"SELECT name FROM sqlite_master WHERE type='table' AND name='linkedin_publish_attempts'").first();
 if(!present)return [];
 return all(db,'SELECT post_id,status,provider_urn,created_at,author_sub FROM linkedin_publish_attempts WHERE owner_id=?',owner);
}
const blockingPublication=status=>['published','sending','delivery_unknown','unknown'].includes(status);
function providerEvidence(row){
 const status=['published','sending','delivery_unknown','failed'].includes(row.status)?row.status:'unknown';
 return {status,providerUrn:row.provider_urn||null,createdAt:row.created_at,authorSubject:row.author_sub,source:status==='published'?'linkedin_api_acknowledgment':'linkedin_transport_attempt'};
}
async function ensureManualActionAllowed(db,owner,postId){
 const attempt=(await providerRecords(db,owner)).find(x=>x.post_id===postId);
 if(attempt&&blockingPublication(providerEvidence(attempt).status))fail(409,'provider_publication_requires_review');
}
async function posts(db,owner){
 const [rows,attempts]=await Promise.all([all(db,'SELECT * FROM linkedin_posts WHERE owner_id=? ORDER BY COALESCE(scheduled_for,created_at),rowid DESC LIMIT 100',owner),providerRecords(db,owner)]);
 const byPost=new Map(attempts.map(x=>[x.post_id,x]));
 return rows.map(row=>{const item=postView(row),attempt=byPost.get(row.id);if(!attempt)return {...item,providerPublication:null,manualActionsBlocked:false};const evidence=providerEvidence(attempt);return {...item,providerPublication:evidence,manualActionsBlocked:blockingPublication(evidence.status)};});
}
async function metrics(db,owner){return (await all(db,'SELECT * FROM linkedin_metrics WHERE owner_id=? ORDER BY as_of DESC,rowid DESC LIMIT 100',owner)).map(r=>({id:r.id,...JSON.parse(r.data),asOf:r.as_of,recordedAt:r.recorded_at,source:'manual'}));}
async function contacts(db,owner){return (await all(db,'SELECT * FROM linkedin_contacts WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200',owner)).map(r=>({id:r.id,...JSON.parse(r.data),createdAt:r.created_at,source:JSON.parse(r.data).source||'user_entered',connectionVerified:false}));}
async function contactPage(db,owner,url){
 const q=(url.searchParams.get('q')||'').trim().toLowerCase(),purpose=url.searchParams.get('purpose')||'all',status=url.searchParams.get('status')||'all',limit=Number(url.searchParams.get('limit')||200),offset=Number(url.searchParams.get('offset')||0);
 if(q.length>200||!['all','job','university','research','supervision','other'].includes(purpose)||!['all','to_research','to_contact','contacted','replied','follow_up','closed'].includes(status)||!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(offset)||offset<0||offset>10000)fail(400,'invalid_contact_filter');
 const filter="WHERE owner_id=? AND (?='' OR instr(lower(data),?)>0) AND (?='all' OR json_extract(data,'$.purpose')=?) AND (?='all' OR json_extract(data,'$.status')=?)",values=[owner,q,q,purpose,purpose,status,status];
 const rows=await all(db,'SELECT * FROM linkedin_contacts '+filter+' ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?',...values,limit,offset);const count=await stmt(db,'SELECT count(*) AS n FROM linkedin_contacts '+filter,...values).first();
 return {contacts:rows.map(r=>({id:r.id,...JSON.parse(r.data),createdAt:r.created_at,source:JSON.parse(r.data).source||'user_entered',connectionVerified:false})),total:count.n,limit,offset,connectionsSync:false};
}
export function linkedinRecommendations(profile){
 const resident=profile?.planning?.training?.currentStatus==='internal_medicine_resident';
 const headline=resident?'Medical Doctor | Internal Medicine Resident | Clinical Research & Evidence-Based Care':'Medical Doctor | General Practice Experience | Exploring Australian Medical Pathways';
 const about=resident?'I am a medical doctor currently undertaking internal medicine training. I am interested in evidence-based care, clinical research and professional collaboration. I am exploring Australian medical pathways while documenting my training and preparing to meet the relevant language, registration and college assessment requirements.':'I am a medical doctor with an interest in general practice, patient safety and continuing professional development. I am exploring supervised medical opportunities in Australia and welcome professional conversations about suitable roles and their registration requirements.';
 return [
  {section:'headline',title:'تیتر پیشنهادی پروفایل',text:headline,reason:resident?'Training is still in progress; do not describe a completed specialty or board award.':'State the medical direction without implying Australian registration or a secured position.',source:'rules_based',requiresReview:true},
  {section:'about',title:'متن پیشنهادی About',text:about,reason:'Working draft based on the private profile direction; verify every statement before copying.',source:'rules_based',requiresReview:true},
  {section:'experience',title:'ساختار بخش سوابق',text:'[Verified role title]\n[Institution] | [Confirmed start date] – [Confirmed end date or current]\n• Describe actual responsibilities and supervision arrangements.\n• Add one documented contribution without patient identifiers.\n• Separate training rotations from independent specialist appointments.',reason:'Replace placeholders with verified details; dates and outcomes must not be invented.',source:'rules_based',requiresReview:true},
  {section:'post',title:'پست آغاز یک گفت‌وگوی حرفه‌ای',text:'Preparing for a medical career transition has reinforced the importance of clear documentation, patient safety and continuous learning.\n\nI am reviewing the relevant registration and training requirements and would value practical perspectives from colleagues who have navigated similar pathways. What helped you prepare most effectively?\n\n#MedicalEducation #PatientSafety #ProfessionalDevelopment',reason:'Original discussion draft; no claimed qualification, patient story or fabricated result.',source:'rules_based',requiresReview:true},
 ];
}
function tasksFor(list,sections){const result=SECTIONS.filter(section=>!sections.some(s=>s.section===section)).map(section=>({id:'review_'+section,type:'profile_review',label:'بازبینی '+section,status:'pending'}));for(const post of list){if(post.status==='scheduled_for_manual_publication'&&!post.manualActionsBlocked)result.push({id:post.id,type:'manual_publication',label:post.title,status:Date.parse(post.scheduledFor)<=Date.now()?'due':'planned',scheduledFor:post.scheduledFor});}return result;}

export function parseConnectionsCsv(csv){
 if(typeof csv!=='string'||!csv.trim()||new TextEncoder().encode(csv).length>500000)fail(400,'invalid_csv_size');
 csv=csv.replace(/^\uFEFF/,'');const rows=[];let row=[],field='',quoted=false,closed=false;
 const fieldEnd=()=>{row.push(field);field='';closed=false;};
 const rowEnd=()=>{fieldEnd();if(row.some(x=>x.trim()))rows.push(row);row=[];if(rows.length>1200)fail(400,'csv_row_limit');};
 for(let i=0;i<csv.length;i++){
  const c=csv[i];
  if(quoted){if(c==='"'){if(csv[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c===','){fieldEnd();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&csv[i+1]==='\n')i++;rowEnd();continue;}
  if(closed){if(c===' '||c==='\t')continue;fail(400,'invalid_csv_quoting');}
  if(c==='"'&&!field.length){quoted=true;continue;}field+=c;
 }
 if(quoted)fail(400,'invalid_csv_quoting');if(field.length||row.length)rowEnd();
 const headerIndex=rows.findIndex(r=>{const h=r.map(x=>x.trim().toLowerCase());return h.includes('first name')&&h.includes('last name')&&h.includes('url');});
 if(headerIndex<0)fail(400,'connections_csv_header_required');const header=rows[headerIndex].map(x=>x.trim().toLowerCase());
 const data=rows.slice(headerIndex+1);if(data.length>1000)fail(400,'csv_row_limit');
 return {header,rows:data};
}
async function importConnections(db,owner,csv){
 const parsed=parseConnectionsCsv(csv),index=Object.fromEntries(parsed.header.map((x,i)=>[x,i])),seen=new Set(),prepared=[],reasons={invalid_profile_url:0,missing_name:0,invalid_fields:0,duplicate_in_file:0,existing_contact:0,concurrent_duplicate:0};
 for(const row of parsed.rows){
  const value=key=>String(row[index[key]]||'').trim();let url;
  try{url=linkedInUrl(value('url')).replace(/\/$/,'');}catch{reasons.invalid_profile_url++;continue;}
  const name=[value('first name'),value('last name')].filter(Boolean).join(' ');if(!name){reasons.missing_name++;continue;}
  const role=value('position'),organization=value('company'),connectedOnReported=value('connected on');
  if(name.length>200||role.length>200||organization.length>200||connectedOnReported.length>100||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(name+role+organization+connectedOnReported)){reasons.invalid_fields++;continue;}
  if(seen.has(url)){reasons.duplicate_in_file++;continue;}seen.add(url);
  prepared.push({id:crypto.randomUUID(),data:{name,profileUrl:url,role,organization,purpose:'job',status:'to_research',notes:'',connectedOnReported:connectedOnReported||null,source:'linkedin_connections_csv'},createdAt:now()});
 }
 let imported=0;
 if(prepared.length){
  const candidates=JSON.stringify(prepared.map(x=>x.data.profileUrl));
  const existing=await all(db,"SELECT rtrim(json_extract(data,'$.profileUrl'),'/') AS profile_url FROM linkedin_contacts WHERE owner_id=? AND rtrim(json_extract(data,'$.profileUrl'),'/') IN (SELECT value FROM json_each(?))",owner,candidates);
  const known=new Set(existing.map(x=>x.profile_url));const pending=prepared.filter(x=>!known.has(x.data.profileUrl));reasons.existing_contact=prepared.length-pending.length;
  if(pending.length){
   const result=await stmt(db,"INSERT INTO linkedin_contacts(id,owner_id,data,created_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.data'),json_extract(value,'$.createdAt') FROM json_each(?) AS incoming WHERE NOT EXISTS (SELECT 1 FROM linkedin_contacts c WHERE c.owner_id=? AND rtrim(json_extract(c.data,'$.profileUrl'),'/')=json_extract(incoming.value,'$.data.profileUrl'))",owner,JSON.stringify(pending),owner).run();
   imported=Number(result.meta?.changes||0);reasons.concurrent_duplicate=pending.length-imported;
  }
 }
 return {imported,duplicates:reasons.duplicate_in_file+reasons.existing_contact+reasons.concurrent_duplicate,skipped:reasons.invalid_profile_url+reasons.missing_name+reasons.invalid_fields,totalRows:parsed.rows.length,reasons,source:'linkedin_connections_csv',liveSync:false,emailsImported:false};
}

export async function handleLinkedInRequest(request,env,context,fetcher=fetch){
 const url=new URL(request.url),path=url.pathname;if(!path.startsWith('/api/linkedin/'))return null;
 try{
  const owner=contextOwner(context),db=env.GOOGLE_DB;if(!db)fail(503,'linkedin_storage_not_configured');
  const profile=url.searchParams.get('profile');if(profile&&profile!==context.profileId)fail(403,'profile_access_denied');
  if(request.method!=='GET'&&request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)fail(403,'origin_rejected');
  if(request.method==='GET'){
   if(path==='/api/linkedin/drafts')return json({drafts:await drafts(db,owner)});
   if(path==='/api/linkedin/posts')return json({posts:await posts(db,owner),automaticPublishing:false});
   if(path==='/api/linkedin/metrics')return json({metrics:await metrics(db,owner),liveAnalytics:false});
   if(path==='/api/linkedin/contacts')return json(await contactPage(db,owner,url));
   if(path==='/api/linkedin/workspace'){
    const profiles=await context.rest('immi_profiles','?select=data&profile_id=eq.'+context.profileId);const current=profiles[0]?.data||{};let profileUrl=null;try{if(current.linkedinUrl)profileUrl=linkedInUrl(current.linkedinUrl);}catch{}
    const sections=(await all(db,'SELECT section,current_text,updated_at FROM linkedin_sections WHERE owner_id=? ORDER BY section',owner)).map(r=>({section:r.section,currentText:r.current_text,updatedAt:r.updated_at,source:'user_entered'}));
    const [d,p,m,c,contactCount]=await Promise.all([drafts(db,owner),posts(db,owner),metrics(db,owner),contacts(db,owner),stmt(db,'SELECT count(*) AS n FROM linkedin_contacts WHERE owner_id=?',owner).first()]);
    const recommendations=linkedinRecommendations(current);const deltas={};if(m.length>1)for(const field of ['connections','followers','profileViews','searchAppearances'])if(typeof m[0][field]==='number'&&typeof m[1][field]==='number')deltas[field]=m[0][field]-m[1][field];
    return json({profileUrl,capabilities:CAPABILITIES,sections,recommendations,postSuggestions:recommendations.filter(x=>x.section==='post').map(x=>({title:x.title,text:x.text,source:x.source,requiresReview:true})),drafts:d,posts:p,metrics:m,metricsSummary:{source:'manual',asOf:m[0]?.asOf||null,deltas},contacts:c,contactsTotal:contactCount.n,tasks:tasksFor(p,sections),analysis:{source:'rules_based_private_profile_and_manual_snapshots',generatedAt:now(),providerDataFetched:false,sectionCoverage:{provided:sections.length,total:3,source:'manual_snapshots_only'}}});
   }
   fail(404,'not_found');
  }
  if(request.method!=='POST')fail(405,'method_not_allowed');
  const body=await payload(request,path==='/api/linkedin/contacts/import'?1100000:30000),at=now();
  if(path==='/api/linkedin/contacts/import'){keys(body,['csv']);return json(await importConnections(db,owner,body.csv),201);}
  if(path==='/api/linkedin/sections'){
   keys(body,['section','currentText']);if(!SECTIONS.includes(body.section))fail(400,'invalid_section');const currentText=text(body.currentText,'section_text',10000);
   await stmt(db,'INSERT INTO linkedin_sections(owner_id,section,current_text,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,section) DO UPDATE SET current_text=excluded.current_text,updated_at=excluded.updated_at',owner,body.section,currentText,at).run();return json({section:body.section,currentText,updatedAt:at,source:'user_entered'});
  }
  if(path==='/api/linkedin/drafts'){
   keys(body,['kind','name','text']);if(![...SECTIONS,'post'].includes(body.kind))fail(400,'invalid_draft_kind');const name=text(body.name,'draft_name',120),content=text(body.text,'draft_text',10000),id=crypto.randomUUID();
   const item=await stmt(db,'INSERT INTO linkedin_drafts(id,owner_id,kind,name,text,revision,created_at) SELECT ?,?,?,?,?,COALESCE(MAX(revision),0)+1,? FROM linkedin_drafts WHERE owner_id=? AND kind=? AND name=? RETURNING *',id,owner,body.kind,name,content,at,owner,body.kind,name).first();return json(draftView(item),201);
  }
  if(path==='/api/linkedin/posts'){
   keys(body,['title','text','scheduledFor','timezone']);const title=text(body.title,'post_title',160),content=text(body.text,'post_text',3000),scheduledFor=body.scheduledFor?iso(body.scheduledFor,'schedule'):null,timezone=body.timezone?zone(body.timezone):null;
   if(scheduledFor&&Date.parse(scheduledFor)<=Date.now())fail(400,'schedule_must_be_future');if(scheduledFor&&!timezone)fail(400,'timezone_required');if(!scheduledFor&&timezone)fail(400,'schedule_required');
   const id=crypto.randomUUID(),status=scheduledFor?'scheduled_for_manual_publication':'draft';await stmt(db,'INSERT INTO linkedin_posts(id,owner_id,title,text,scheduled_for,timezone,status,created_at) VALUES(?,?,?,?,?,?,?,?)',id,owner,title,content,scheduledFor,timezone,status,at).run();return json({id,title,text:content,scheduledFor,timezone,status,createdAt:at,automaticPublishing:false},201);
  }
  const published=path.match(/^\/api\/linkedin\/posts\/([a-f0-9-]{36})\/published$/i);
  if(published){
   keys(body,['publishedUrl']);await ensureManualActionAllowed(db,owner,published[1]);const publishedUrl=body.publishedUrl?linkedInUrl(body.publishedUrl,'post'):null;const row=await stmt(db,'UPDATE linkedin_posts SET status=?,published_url=?,reported_published_at=? WHERE id=? AND owner_id=? RETURNING *','published_by_user',publishedUrl,at,published[1],owner).first();if(!row)fail(404,'post_not_found');return json(postView(row));
  }
  if(path==='/api/linkedin/metrics'){
   const fields=['connections','followers','profileViews','searchAppearances'];keys(body,[...fields,'asOf']);const asOf=iso(body.asOf,'as_of');if(Date.parse(asOf)>Date.now()+300000)fail(400,'metric_date_in_future');const data={};for(const field of fields)if(body[field]!==undefined){if(!Number.isInteger(body[field])||body[field]<0||body[field]>1000000000)fail(400,'invalid_metric');data[field]=body[field];}if(!Object.keys(data).length)fail(400,'metric_required');const id=crypto.randomUUID();await stmt(db,'INSERT INTO linkedin_metrics VALUES(?,?,?,?,?)',id,owner,asOf,JSON.stringify(data),at).run();return json({id,...data,asOf,recordedAt:at,source:'manual'},201);
  }
  const reschedule=path.match(/^\/api\/linkedin\/posts\/([a-f0-9-]{36})\/schedule$/i);
  if(reschedule){keys(body,['scheduledFor','timezone']);await ensureManualActionAllowed(db,owner,reschedule[1]);const scheduledFor=iso(body.scheduledFor,'schedule'),timezone=zone(body.timezone);if(Date.parse(scheduledFor)<=Date.now())fail(400,'schedule_must_be_future');const row=await stmt(db,"UPDATE linkedin_posts SET scheduled_for=?,timezone=?,status='scheduled_for_manual_publication' WHERE id=? AND owner_id=? AND status<>'published_by_user' RETURNING *",scheduledFor,timezone,reschedule[1],owner).first();if(!row)fail(404,'post_not_found_or_already_published');return json(postView(row));}
  const contactUpdate=path.match(/^\/api\/linkedin\/contacts\/([a-f0-9-]{36})$/i);
  if(contactUpdate){keys(body,['status','notes']);if(!['to_research','to_contact','contacted','replied','follow_up','closed'].includes(body.status))fail(400,'invalid_contact_state');const row=await stmt(db,'SELECT data FROM linkedin_contacts WHERE id=? AND owner_id=?',contactUpdate[1],owner).first();if(!row)fail(404,'contact_not_found');const data=JSON.parse(row.data);data.status=body.status;if(body.notes!==undefined)data.notes=text(body.notes,'notes',3000,true);await stmt(db,'UPDATE linkedin_contacts SET data=? WHERE id=? AND owner_id=?',JSON.stringify(data),contactUpdate[1],owner).run();return json({id:contactUpdate[1],...data,source:data.source||'user_entered',connectionVerified:false});}
  if(path==='/api/linkedin/contacts'){
   keys(body,['name','profileUrl','role','organization','purpose','status','notes']);const statuses=['to_research','to_contact','contacted','replied','follow_up','closed'];const purposes=['job','university','research','supervision','other'];const status=body.status||'to_research',purpose=body.purpose||'job';if(!statuses.includes(status)||!purposes.includes(purpose))fail(400,'invalid_contact_state');const data={name:text(body.name,'contact_name',200),profileUrl:linkedInUrl(body.profileUrl).replace(/\/$/,''),role:text(body.role,'contact_role',200,true),organization:text(body.organization,'organization',200,true),purpose,status,notes:text(body.notes,'notes',3000,true)};const id=crypto.randomUUID();await stmt(db,'INSERT INTO linkedin_contacts VALUES(?,?,?,?)',id,owner,JSON.stringify(data),at).run();return json({id,...data,createdAt:at,source:'user_entered',connectionVerified:false},201);
  }
  fail(404,'not_found');
 }catch(error){return json({error:error instanceof LinkedInError?error.code:'linkedin_workspace_failed'},error instanceof LinkedInError?error.status:500);}
}
