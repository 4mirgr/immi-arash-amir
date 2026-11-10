// UI coordinates only. Never persist provider tokens, correspondence, CV text,
// source quotes, review hashes, recipients or permission to send.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const OPP=/^opp_[a-f0-9]{32}$/;
const TABS=['overview','opportunities','mail','cv','pesci','linkedin','roadmap','study','development','sources','automation','settings'];
const TTL=7*86400000;
function key(owner,profile,section){return UUID.test(owner||'')&&['arash','amir'].includes(profile)&&['navigation','opportunities'].includes(section)?`masir-ui:v1:${owner}:${profile}:${section}`:null;}
function sanitize(section,value,profile){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const out={};
 const one=(name,values)=>{if(values.includes(value[name]))out[name]=value[name];};
 if(section==='navigation'){one('tab',TABS.filter(tab=>profile!=='arash'||tab!=='study'));}
 else{
  one('country',profile==='amir'?['AU','IT']:['AU']);one('state',['all','NSW','QLD','VIC','WA','SA','TAS','NT','ACT']);
  one('kind',['all','vacancy','employment_register']);one('clinicalFocus',['all','medical','gp']);one('sort',['fit','newest','deadline']);
  for(const field of ['official','unofficial','includeClosed','ruralOnly'])if(typeof value[field]==='boolean')out[field]=value[field];
  if(Array.isArray(value.types)&&value.types.length<=5)out.types=[...new Set(value.types.filter(t=>['job','university','grant','funding','scholarship'].includes(t)&& (profile!=='arash'||t==='job')))];
  if(Number.isInteger(value.page)&&value.page>=0&&value.page<=10000)out.page=value.page;
  if(value.openOpportunityId===null||OPP.test(value.openOpportunityId||''))out.openOpportunityId=value.openOpportunityId;
  if(UUID.test(value.cvVersionId||''))out.cvVersionId=value.cvVersionId;
  one('variant',['auto','A','B','C']);one('step',['letter','mail']);
  if(Number.isInteger(value.subjectIndex)&&value.subjectIndex>=0&&value.subjectIndex<3)out.subjectIndex=value.subjectIndex;
 }
 return Object.keys(out).length?out:null;
}
export function readCheckpoint(owner,profile,section,storage){
 try{const id=key(owner,profile,section);if(!id)return null;const data=JSON.parse((storage||globalThis.sessionStorage).getItem(id)||'null');if(!data||data.owner!==owner||data.profile!==profile||data.version!==1||!Number.isFinite(data.savedAt)||data.savedAt>Date.now()+60000||Date.now()-data.savedAt>TTL)return null;return sanitize(section,data.value,profile);}catch{return null;}
}
export function writeCheckpoint(owner,profile,section,value,storage){
 try{const id=key(owner,profile,section),clean=sanitize(section,value,profile);if(!id||!clean)return;(storage||globalThis.sessionStorage).setItem(id,JSON.stringify({version:1,owner,profile,savedAt:Date.now(),value:clean}));}catch{/* Storage may be disabled. In-memory work must continue. */}
}
