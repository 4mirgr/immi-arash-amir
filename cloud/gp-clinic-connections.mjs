// Private, bounded contact suggestions. A matching employer is not proof of a
// mutual connection, current employment, endorsement or permission to name them.
const normalized=value=>typeof value==='string'?value.toLowerCase().replace(/centre/g,'center').replace(/[^a-z0-9]+/g,' ').replace(/\b(?:pty|ltd|limited|group)\b/g,' ').replace(/\s+/g,' ').trim():'';
const generic=new Set(['medical center','medical practice','general practice','clinic','health','hospital']);
function matches(organization,names){const a=normalized(organization);return a.length>=6&&!generic.has(a)&&names.some(n=>a===n||a.length>=10&&n.length>=10&&(a.startsWith(n+' ')||n.startsWith(a+' ')));}
const safe=value=>typeof value==='string'&&value.length<=200&&!/[\x00-\x1f<>\n]/.test(value)&&!/ignore.{0,30}instructions|system prompt|api.?key|password/i.test(value);
function profileURL(value){try{const u=new URL(value);return u.protocol==='https:'&&['linkedin.com','www.linkedin.com'].includes(u.hostname)&&/^\/in\/[A-Za-z0-9_%.-]+\/?$/.test(u.pathname)?u.origin+u.pathname:null;}catch{return null;}}
export async function readClinicConnections(env,context,clinicNames=[]){
 if(context?.profileId!=='arash'||!context.userId||context.userId.includes(':')||!env?.GOOGLE_DB)return {candidates:[],status:'unavailable'};
 const names=clinicNames.map(normalized).filter(n=>n.length>=6&&!generic.has(n));
 if(!names.length)return {candidates:[],status:'clinic_identity_missing'};
 try{
  const rows=(await env.GOOGLE_DB.prepare('SELECT id,data FROM linkedin_contacts WHERE owner_id=? ORDER BY created_at DESC LIMIT 200').bind(context.userId).all()).results||[];
  const candidates=[];
  for(const row of rows){
   let data;try{data=JSON.parse(row.data);}catch{continue;}
   if(!safe(data.name)||!safe(data.organization)||!matches(data.organization,names)||!/^[a-f0-9-]{36}$/i.test(row.id))continue;
   candidates.push({id:row.id,name:data.name,organization:data.organization,role:safe(data.role)?data.role:'',profileUrl:profileURL(data.profileUrl),source:data.source==='linkedin_connections_csv'?'linkedin_connections_csv':'owner_contact_record',relationshipStatus:'owner_review_required'});
   if(candidates.length===10)break;
  }
  return {candidates,status:candidates.length?'owner_review_required':'no_matching_owned_contact',liveLinkedInGraph:false};
 }catch{return {candidates:[],status:'unavailable',liveLinkedInGraph:false};}
}
